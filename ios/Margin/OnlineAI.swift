import Foundation
import Security

/// Large open models on NVIDIA's servers, reached with the user's own free key from build.nvidia.com.
/// They answer first when there's a key; the on-device model takes over whenever a request fails.
final class OnlineAI: @unchecked Sendable {
    static let shared = OnlineAI()
    nonisolated(unsafe) static var endpoint = URL(string: "https://integrate.api.nvidia.com/v1")!

    struct Model: Identifiable, Hashable, Sendable {
        let id: String
        let title: String
    }

    /// Best first. NVIDIA retires models now and then, so the first one the key can still reach is used.
    static let models = [
        Model(id: "deepseek-ai/deepseek-v4-pro", title: "DeepSeek V4 Pro"),
        Model(id: "deepseek-ai/deepseek-v4-flash", title: "DeepSeek V4 Flash"),
        Model(id: "moonshotai/kimi-k2-instruct", title: "Kimi K2"),
        Model(id: "deepseek-ai/deepseek-v3.1", title: "DeepSeek V3.1"),
        Model(id: "qwen/qwen3-235b-a22b", title: "Qwen3 235B"),
        Model(id: "openai/gpt-oss-120b", title: "gpt-oss 120B"),
        Model(id: "meta/llama-3.3-70b-instruct", title: "Llama 3.3 70B"),
    ]

    enum Problem: LocalizedError {
        case noKey, rejectedKey, busy, retired, noneAvailable, empty, failed(Int)

        var errorDescription: String? {
            switch self {
            case .noKey: "Add your NVIDIA API key in Settings."
            case .rejectedKey: "NVIDIA didn't accept the API key. Check it in Settings."
            case .busy: "NVIDIA's free tier is busy right now. Try again in a minute."
            case .retired: "That model isn't available from NVIDIA any more. Choose another one in Settings."
            case .noneAvailable: "This key can't reach any of the models Margin uses."
            case .empty: "NVIDIA's model sent back an empty answer."
            case let .failed(status): "NVIDIA couldn't answer (error \(status)). Try again later."
            }
        }
    }

    private let lock = NSLock()
    private var key: String?
    private var resolved: Model?
    private var retired: Set<String> = []
    private var problem: String?
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        // Reasoning models can think for a while before the first word, but they send something all along.
        configuration.timeoutIntervalForRequest = 90
        return URLSession(configuration: configuration)
    }()

    var isConfigured: Bool { lock.withLock { !(key ?? "").isEmpty } }

    /// Why the last request failed, until one succeeds.
    var lastProblem: String? { lock.withLock { problem } }

    /// "auto", or the id of the model chosen in Settings.
    var preferredModel: String {
        get { UserDefaults.standard.string(forKey: "onlineModel") ?? "auto" }
        set {
            UserDefaults.standard.set(newValue, forKey: "onlineModel")
            lock.withLock { resolved = nil }
        }
    }

    func loadKey() {
        let saved = Keychain.read()
        lock.withLock {
            key = saved
            resolved = nil
        }
    }

    func setKey(_ newKey: String?, saving: Bool = true) {
        if saving { Keychain.save(newKey) }
        lock.withLock {
            key = newKey
            resolved = nil
            retired = []
            problem = nil
        }
    }

    /// The model that answers: the one chosen in Settings, or else the best one this key can reach.
    func currentModel() async throws -> Model {
        let chosen = preferredModel
        if chosen != "auto" { return Self.models.first { $0.id == chosen } ?? Model(id: chosen, title: chosen) }
        if let known = lock.withLock({ resolved }) { return known }
        let reachable = try await reachableModels()
        let skipped = lock.withLock { retired }
        guard let best = Self.models.first(where: { reachable.contains($0.id) && !skipped.contains($0.id) }) else { throw Problem.noneAvailable }
        lock.withLock { resolved = best }
        return best
    }

    /// Confirms the key with a tiny request and says which model will answer.
    func check() async throws -> Model {
        lock.withLock {
            resolved = nil
            retired = []
        }
        return try await recording {
            let model = try await currentModel()
            _ = try await stream(model.id, messages: [("user", "Reply with OK.")], maxTokens: 16, onPartial: nil)
            return model
        }
    }

    func generate(messages: [(role: String, text: String)], maxTokens: Int32, onPartial: (@Sendable (String) -> Void)?) async throws -> String {
        try await recording {
            let model = try await currentModel()
            do {
                return try await stream(model.id, messages: messages, maxTokens: maxTokens, onPartial: onPartial)
            } catch Problem.retired where preferredModel == "auto" {
                // Retired since the list was fetched, so the next best one answers.
                lock.withLock {
                    retired.insert(model.id)
                    resolved = nil
                }
                return try await stream(try await currentModel().id, messages: messages, maxTokens: maxTokens, onPartial: onPartial)
            }
        }
    }

    private func recording<T>(_ work: () async throws -> T) async throws -> T {
        do {
            let result = try await work()
            lock.withLock { problem = nil }
            return result
        } catch {
            if Task.isCancelled { throw CancellationError() }
            lock.withLock { problem = error.localizedDescription }
            throw error
        }
    }

    private func authorized(_ path: String) throws -> URLRequest {
        guard let key = lock.withLock({ key }), !key.isEmpty else { throw Problem.noKey }
        var request = URLRequest(url: Self.endpoint.appendingPathComponent(path))
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        return request
    }

    private static func verify(_ response: URLResponse) throws {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200: return
        case 401, 403: throw Problem.rejectedKey
        case 404: throw Problem.retired
        case 429: throw Problem.busy
        default: throw Problem.failed(status)
        }
    }

    private func reachableModels() async throws -> Set<String> {
        struct List: Decodable {
            struct Entry: Decodable { let id: String }
            let data: [Entry]
        }
        let (data, response) = try await session.data(for: try authorized("models"))
        try Self.verify(response)
        return Set(try JSONDecoder().decode(List.self, from: data).data.map(\.id))
    }

    private struct Chunk: Decodable {
        struct Choice: Decodable {
            struct Delta: Decodable { let content: String? }
            let delta: Delta?
        }
        let choices: [Choice]
    }

    private func stream(_ model: String, messages: [(role: String, text: String)], maxTokens: Int32, onPartial: (@Sendable (String) -> Void)?) async throws -> String {
        var request = try authorized("chat/completions")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let body: [String: Any] = [
            "model": model,
            "messages": messages.map { ["role": $0.role, "content": $0.text] },
            // Reasoning counts against the limit too, so allow well past the length of the answer itself.
            "max_tokens": min(4096, max(1024, Int(maxTokens) * 3)),
            "temperature": 0.4,
            "top_p": 0.9,
            "stream": true,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await session.bytes(for: request)
        try Self.verify(response)
        var raw = ""
        var nextPartial = Date.distantPast
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" { break }
            // Reasoning arrives in its own field, which is left out, or inside <think> tags, which visibleAnswer drops.
            guard let chunk = try? JSONDecoder().decode(Chunk.self, from: Data(payload.utf8)), let piece = chunk.choices.first?.delta?.content else { continue }
            raw += piece
            let now = Date()
            if let onPartial, now >= nextPartial {
                nextPartial = now.addingTimeInterval(0.1)
                onPartial(TextTools.visibleAnswer(raw))
            }
        }
        let answer = TextTools.visibleAnswer(raw)
        guard !answer.isEmpty else { throw Problem.empty }
        onPartial?(answer)
        return answer
    }
}

/// The key lives in the keychain, on this device only.
private enum Keychain {
    private static let item: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "margin.nvidia",
        kSecAttrAccount as String: "api-key",
    ]

    static func read() -> String? {
        var query = item
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String?) {
        SecItemDelete(item as CFDictionary)
        guard let value, !value.isEmpty else { return }
        var entry = item
        entry[kSecValueData as String] = Data(value.utf8)
        // Recording keeps Margin running with the screen locked, and the live notes still need the key then.
        entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(entry as CFDictionary, nil)
    }
}
