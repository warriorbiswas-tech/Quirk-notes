// clang -c checks/assistant/engine.c -o /tmp/engine-online.o && swiftc -import-objc-header checks/assistant/engine.h Margin/Geometry.swift Margin/AI.swift Margin/OnlineAI.swift checks/online/main.swift /tmp/engine-online.o -o /tmp/online && /tmp/online
// Online AI against a stand-in for NVIDIA's API (server.py, next to this file): choosing a model, streaming with the reasoning hidden,
// JSON without a grammar, retired models, rejected keys, a busy free tier, stopping, and the on-device model taking over.
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let server = Process()
server.executableURL = URL(fileURLWithPath: "/usr/bin/env")
server.arguments = ["python3", URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("server.py").path]
let serverOutput = Pipe()
server.standardOutput = serverOutput
try server.run()

func check(_ ok: Bool, _ what: @autoclosure () -> String) {
    if !ok {
        print("FAIL: \(what())")
        server.terminate()
        exit(1)
    }
}
final class Box: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    func add(_ s: String) { lock.withLock { values.append(s) } }
    var all: [String] { lock.withLock { values } }
}

let firstLine = String(decoding: serverOutput.fileHandleForReading.availableData, as: UTF8.self).split(separator: "\n").first
guard let port = firstLine.flatMap({ Int($0) }) else { check(false, "the stand-in server didn't start"); exit(1) }
OnlineAI.endpoint = URL(string: "http://127.0.0.1:\(port)/v1")!

func control(_ change: [String: String]) async throws {
    var request = URLRequest(url: OnlineAI.endpoint.appendingPathComponent("control"))
    request.httpMethod = "POST"
    request.httpBody = try JSONSerialization.data(withJSONObject: change)
    _ = try await URLSession.shared.data(for: request)
}
func chatRequests() async throws -> Int {
    let (data, _) = try await URLSession.shared.data(from: OnlineAI.endpoint.appendingPathComponent("stats"))
    return (try JSONSerialization.jsonObject(with: data) as? [String: Int])?["chat"] ?? -1
}

let models = FileManager.default.temporaryDirectory.appendingPathComponent("online-models-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: models) }
ModelFile.directory = models
func onDevice(_ installed: Bool) {
    if installed {
        _ = FileManager.default.createFile(atPath: ModelFile.writing.path.path, contents: Data())
    } else {
        try? FileManager.default.removeItem(at: ModelFile.writing.path)
    }
}
UserDefaults.standard.removeObject(forKey: "onlineModel")

onDevice(false)
check(!AI.isAvailable, "nothing can answer yet")
OnlineAI.shared.setKey("good", saving: false)
check(AI.isAvailable, "a key is enough without the on-device model")

// The best model the key can reach is chosen, skipping the ones NVIDIA doesn't offer it.
let chosen = try await OnlineAI.shared.check()
check(chosen.id == "moonshotai/kimi-k2-instruct", "chose \(chosen.id)")

// Answers stream, and the reasoning never shows, whether it comes in its own field or in <think> tags.
let partials = Box()
let summary = try await AI.summary(of: "Mitosis divides a cell.") { partials.add($0) }
check(summary.hasPrefix("Online answer from moonshotai/kimi-k2-instruct"), "online answer: \(summary.prefix(60))")
check(!summary.contains("Hidden") && !summary.contains("think"), "reasoning is hidden")
check(partials.all.count >= 2, "streamed \(partials.all.count) updates")
check(partials.all.allSatisfy { !$0.contains("Hidden") && !$0.contains("Let me think") }, "partial answers never show the reasoning")

// Structured answers without a grammar: JSON inside prose and a code fence, option labels, a loosely written folder name.
let cards = try await AI.flashcards(from: "Mitosis")
check(cards.first?.front == "Online: what is mitosis?", "flashcards decode from a fenced answer")
let quiz = try await AI.quiz(from: "Mitosis")
check(quiz.first?.options.first == "Prophase" && quiz.first?.answer == 1, "a quiz decodes and loses its option labels")
let map = try await AI.mindMap(from: "Mitosis")
check(map.title == "Online map" && map.children?.first?.children?.first?.title == "Metaphase", "a mind map decodes")
let math = try await AI.math(fromRecognized: "x2 + 1")
check(math.unicode == "x² + 1" && math.latex == "x^{2} + 1", "math decodes")
check(try await AI.folder(for: "Mitosis", among: ["Biology", "History"]) == "Biology", "a folder comes from the list")
check(mock_calls() == 0, "the on-device model wasn't needed")

// A long note is read in far fewer, larger pieces online.
let book = (0..<6000).map { "Fact \($0): cells divide in stages. " }.joined()
var before = try await chatRequests()
_ = try await AI.digest(book)
let pieces = TextTools.chunks(book, size: 60_000).count
check(try await chatRequests() - before == pieces, "a long note is read online in \(pieces) pieces")

// Live notes get only new bullets, nothing when nothing new was said, and a long stretch of talk in pieces.
check(try await AI.smartNotes(adding: "Mitosis has four stages.", to: "") == "- New point", "new bullets come back")
check(try await AI.smartNotes(adding: "As I said, nothing new.", to: "- New point") == "", "NONE adds nothing")
let stretch = String(repeating: "Anaphase pulls them apart. ", count: 3000)
let stretchPieces = TextTools.chunks(stretch, size: 30_000).count
before = try await chatRequests()
check(try await AI.smartNotes(adding: stretch, to: "") == Array(repeating: "- New point", count: stretchPieces).joined(separator: "\n"), "a long stretch gets bullets from each piece")
check(try await chatRequests() - before == stretchPieces, "a long stretch is read in \(stretchPieces) pieces")

// A translation goes in pieces small enough to leave room for a longer answer.
let source = String(repeating: "Mitosis makes two cells. ", count: 400)
before = try await chatRequests()
_ = try await AI.translate(source, to: "Hindi")
check(try await chatRequests() - before == TextTools.chunks(source, size: 3000).count, "a translation goes in pieces")

// A model NVIDIA retires makes way for the next best one.
try await control(["retire": "moonshotai/kimi-k2-instruct"])
let afterRetiring = try await AI.complete(system: "s", prompt: "p")
check(afterRetiring.hasPrefix("Online answer from meta/llama-3.3-70b-instruct"), "the next model answers: \(afterRetiring.prefix(60))")

// A model chosen in Settings is used as it is, and isn't swapped for another when it's gone.
OnlineAI.shared.preferredModel = "meta/llama-3.3-70b-instruct"
check(try await AI.complete(system: "s", prompt: "p").hasPrefix("Online answer from meta/llama-3.3-70b-instruct"), "the chosen model answers")
OnlineAI.shared.preferredModel = "openai/gpt-oss-120b"
do {
    _ = try await AI.complete(system: "s", prompt: "p")
    check(false, "a chosen model that's gone, with nothing on the iPad, should fail")
} catch OnlineAI.Problem.retired {}
OnlineAI.shared.preferredModel = "auto"

// An online answer that isn't the JSON asked for goes to the on-device model, when there is one.
try await control(["mode": "garbled"])
do {
    _ = try await AI.flashcards(from: "Mitosis")
    check(false, "prose instead of JSON, with nothing on the iPad, should fail")
} catch AIError.badResponse {}
onDevice(true)
let rescued = try await AI.flashcards(from: "Mitosis")
check(rescued.first?.front == "What is mitosis?", "the on-device model makes the cards instead")
check(try await AI.folder(for: "Mitosis", among: ["Biology", "History"]) == "Biology", "and picks the folder")
try await control(["mode": "normal"])

// A rejected key, a busy free tier and no connection all hand the question to the on-device model, and Settings can say why.
OnlineAI.shared.setKey("bad", saving: false)
check(try await AI.complete(system: "s", prompt: "p").hasPrefix("Answer"), "the on-device model answers when the key is rejected")
check(OnlineAI.shared.lastProblem == OnlineAI.Problem.rejectedKey.errorDescription, "the problem is kept: \(OnlineAI.shared.lastProblem ?? "none")")
OnlineAI.shared.setKey("busy", saving: false)
check(try await AI.complete(system: "s", prompt: "p").hasPrefix("Answer"), "the on-device model answers when NVIDIA is busy")
check(OnlineAI.shared.lastProblem == OnlineAI.Problem.busy.errorDescription, "busy is kept: \(OnlineAI.shared.lastProblem ?? "none")")
OnlineAI.shared.setKey("good", saving: false)
let reachable = OnlineAI.endpoint
OnlineAI.endpoint = URL(string: "http://127.0.0.1:9/v1")!
check(try await AI.complete(system: "s", prompt: "p").hasPrefix("Answer"), "the on-device model answers offline")
OnlineAI.endpoint = reachable
check(try await AI.complete(system: "s", prompt: "p").hasPrefix("Online answer"), "online again once NVIDIA is back")
check(OnlineAI.shared.lastProblem == nil, "a good answer clears the problem")

// Without the on-device model, the online problem is what the user sees.
onDevice(false)
OnlineAI.shared.setKey("bad", saving: false)
do {
    _ = try await AI.complete(system: "s", prompt: "p")
    check(false, "a rejected key with nothing on the iPad should fail")
} catch OnlineAI.Problem.rejectedKey {}

// Stopping ends the answer at once and doesn't pass the question on.
OnlineAI.shared.setKey("good", saving: false)
onDevice(true)
try await control(["mode": "slow"])
let calls = mock_calls()
let long = Task { try await AI.complete(system: "s", prompt: "p") }
try await Task.sleep(for: .milliseconds(300))
let stopped = Date()
long.cancel()
do {
    _ = try await long.value
    check(false, "a stopped answer should throw")
} catch is CancellationError {}
check(Date().timeIntervalSince(stopped) < 1, "stops promptly")
check(mock_calls() == calls, "a stopped question isn't handed to the on-device model")
try await control(["mode": "normal"])
before = try await chatRequests()
check(try await AI.complete(system: "s", prompt: "p").hasPrefix("Online answer"), "works after a stop")
check(try await chatRequests() == before + 1, "one request per question")

UserDefaults.standard.removeObject(forKey: "onlineModel")
server.terminate()
print("ok")
