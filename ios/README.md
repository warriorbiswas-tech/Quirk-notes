# Quire Notes for iPad

A note-taking and PDF annotation app for iPad, built for lectures, textbooks and meetings. The AI runs on large models at NVIDIA with your own free key, and on the iPad itself when you're offline.

- **Ink and PDFs:** PencilKit writing on paper or PDF pages, highlighter, shapes, dashed pen, lasso, study tape, whiteout and redaction, comments, stamps, signatures.
- **Pages:** tabs for the notes you have open, subfolders, notebook covers, whiteboards, an endless page that grows as you write, page duplication, read-only mode, stickers of your own, and cutting a photo's subject out of its background.
- **Live Text:** handwriting turns into type where it's written, through Scribble.
- **Recording:** audio that stays in step with your notes, so tapping a stroke plays what was being said when you wrote it, with a live transcript.
- **Study:** chat with a note, summaries, key points and action items, flashcards with spaced review, quizzes, mind maps, teach-back, explaining or solving a selected area step by step, homework from a photo, filing notes into folders, and filling in what your notes missed from a recording.
- **Sync:** every note goes to a folder you choose in iCloud Drive.

## AI

Add a free API key from [build.nvidia.com](https://build.nvidia.com) in Settings › Online AI and the study tools use a large open model on NVIDIA's servers. Quire Notes asks NVIDIA which models the key can reach and uses the best of DeepSeek V4 Pro, DeepSeek V4 Flash, Kimi K2, DeepSeek V3.1, Qwen3 235B, gpt-oss 120B and Llama 3.3 70B, or the one you choose. The key stays in the iPad's keychain, and the notes a tool works on are sent to NVIDIA. The free tier allows about 40 requests a minute.

Without a key, without a connection, or whenever NVIDIA can't answer, the same tools run on the iPad, and nothing leaves it. Recordings are always transcribed on the iPad. The on-device models download once from Hugging Face, each pinned to a checksum:

| Job | Model | Engine |
| --- | --- | --- |
| Writing | Qwen3 1.7B, Q4_K_M | [llama.cpp](https://github.com/ggml-org/llama.cpp) |
| Transcription | Whisper small.en, Q5_1 | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) |
| Other languages (optional) | Whisper small, Q5_1 | whisper.cpp |

## Building

Open `Margin.xcodeproj` in Xcode and run on an iPad with iPadOS 17 or later. The engines in `Vendor/` have no Simulator slice, so AI features are unavailable there and everything else works.

Without a Mac: every push to `main` that changes the app builds an unsigned `Quire-Notes.ipa`. Open the latest run under Actions › iPad app, download `Quire-Notes-ipa` from Artifacts and unzip it, then install `Quire-Notes.ipa` with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io) from a Windows PC or Mac, signing in with your Apple ID. With a free Apple ID the app has to be reinstalled every 7 days. Downloads expire after 30 days; Run workflow on the same page builds a fresh one.

## Checks

From this folder:

```sh
swiftc Margin/Geometry.swift checks/main.swift -o /tmp/margin-check && /tmp/margin-check
swiftc Margin/Sync.swift checks/sync/main.swift -o /tmp/sync-check && /tmp/sync-check
checks/run-engines.sh <models folder> <work folder>
clang -fsanitize=address,undefined -F Vendor/macos Margin/LlamaEngine.c checks/bridge/fake-llama.c checks/bridge/main.c -o /tmp/bridge && /tmp/bridge
clang -c -fsanitize=thread checks/assistant/engine.c -o /tmp/engine.o && swiftc -sanitize=thread -import-objc-header checks/assistant/engine.h Margin/Geometry.swift Margin/AI.swift Margin/OnlineAI.swift checks/assistant/main.swift /tmp/engine.o -o /tmp/assistant && /tmp/assistant
clang -c checks/assistant/engine.c -o /tmp/engine-online.o && swiftc -import-objc-header checks/assistant/engine.h Margin/Geometry.swift Margin/AI.swift Margin/OnlineAI.swift checks/online/main.swift /tmp/engine-online.o -o /tmp/online && /tmp/online
swiftc -O Margin/Geometry.swift Margin/Sync.swift checks/stress/main.swift -o /tmp/margin-stress && /tmp/margin-stress
```

`bridge` runs the app's llama.cpp bridge against a fake llama.cpp under the address and undefined-behaviour sanitizers, checking its buffers, prompt cache, stopping and refusals. `assistant` runs the assistant's Swift code against a stand-in engine under the thread sanitizer: streaming, stopping, leaving the screen, many questions at once, long notes, notes and a transcript sharing one request, live notes and translations in pieces, and structured answers. `online` runs the online AI against a stand-in for NVIDIA's API (`checks/online/server.py`): choosing a model, hidden reasoning, JSON without a grammar, retired models, rejected keys, a busy free tier, stopping, and handing questions to the on-device model when NVIDIA can't answer.

`run-engines.sh` runs the real AI code against the real models on a Mac. The stress test throws random input at everything that runs without a screen, then has three devices edit, trash, delete and sync at random, and fails if they don't end up with the same notes or if any edit is lost. It takes about a minute; it prints its seed, and passing that seed back replays the same random input.
