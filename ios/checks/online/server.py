#!/usr/bin/env python3
# Stands in for NVIDIA's API in checks/online: the same endpoints and streaming format, with canned answers.
# Prints the port it listens on, then serves until it's stopped.
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ["moonshotai/kimi-k2-instruct", "meta/llama-3.3-70b-instruct", "nvidia/nv-embedqa-e5-v5"]
state = {"retired": set(), "mode": "normal", "chat": 0}
lock = threading.Lock()

CARDS = 'Here are the cards:\n```json\n[{"front":"Online: what is mitosis?","back":"Cell division into two identical cells."}]\n```'
QUIZ = '[{"question":"Which stage lines chromosomes up?","options":["A. Prophase","B. Metaphase","C. Anaphase","D. Telophase"],"answer":1}]'
MAP = '[{"title":"Online map","children":[{"title":"Stages","children":[{"title":"Metaphase"}]}]}]'
MATH = '[{"unicode":"x² + 1","latex":"x^{2} + 1"}]'


def structured(system, said):
    if "live notes" in system:
        return "NONE." if "nothing new" in said else "- New point"
    if "flashcards" in system:
        return CARDS
    if "multiple-choice" in system:
        return QUIZ
    if "mind map" in system:
        return MAP
    if '"unicode"' in system:
        return MATH
    if "Choose the folder" in system:
        return '"biology."'
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def refused(self):
        key = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if key == "bad":
            self.reply(401, {"error": "Unauthorized"})
        elif key == "busy":
            self.reply(429, {"error": "Too Many Requests"})
        else:
            return False
        return True

    def event(self, delta):
        chunk = {"object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
        self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
        self.wfile.flush()

    def do_GET(self):
        if self.path == "/v1/stats":
            with lock:
                self.reply(200, {"chat": state["chat"]})
        elif self.path == "/v1/models":
            if not self.refused():
                self.reply(200, {"object": "list", "data": [{"id": m, "object": "model"} for m in MODELS]})
        else:
            self.reply(404, {"error": "Not Found"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/v1/control":
            with lock:
                if "retire" in body:
                    state["retired"].add(body["retire"])
                if "mode" in body:
                    state["mode"] = body["mode"]
            self.reply(200, {})
            return
        if self.path != "/v1/chat/completions":
            self.reply(404, {"error": "Not Found"})
            return
        if self.refused():
            return
        model = body.get("model")
        with lock:
            state["chat"] += 1
            mode = state["mode"]
            gone = model not in MODELS or model in state["retired"]
        if gone:
            self.reply(404, {"error": f"Model {model} not found"})
            return

        system = body["messages"][0]["content"]
        shaped = structured(system, body["messages"][-1]["content"])
        if shaped is not None and mode == "garbled":
            shaped = "I couldn't put that into a list."
        if shaped is not None:
            pieces, pause = [shaped[i:i + 20] for i in range(0, len(shaped), 20)], 0
        else:
            words = 3000 if mode == "slow" else 20
            pieces = ["<think>Hidden reasoning.</think>", f"Online answer from {model}"] + [" word"] * words
            pause = 0.005 if mode == "slow" else 0.002

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            self.event({"role": "assistant", "reasoning_content": "Let me think about it."})
            for piece in pieces:
                self.event({"content": piece})
                time.sleep(pause)
            self.wfile.write(b"data: [DONE]\n\n")
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
