#!/usr/bin/env python3
"""Serve preview tools and caption editing API for the active factory workspace."""
from __future__ import annotations

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from captions import default_doc, load_effective_doc, load_timeline, save_doc
from factory import ROOT, active_theme, theme_url


class FactoryHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass

    def send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/captions":
            try:
                timeline = load_timeline()
                doc, saved = load_effective_doc(timeline)
            except SystemExit as exc:
                self.send_error_json(409, str(exc))
                return
            self.send_json(
                200,
                {
                    "captions": doc,
                    "generated": default_doc(timeline),
                    "saved": saved,
                    "duration": timeline.get("duration"),
                    "scenes": timeline.get("scenes", []),
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/captions":
            self.send_error_json(404, "unknown endpoint")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error_json(400, "invalid content length")
            return
        if length <= 0 or length > 2_000_000:
            self.send_error_json(400, "invalid request body size")
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = save_doc(payload)
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            self.send_error_json(400, str(exc))
            return
        except SystemExit as exc:
            self.send_error_json(409, str(exc))
            return

        self.send_json(200, result)


def main() -> None:
    os.chdir(ROOT)
    print(f"Preview: {theme_url(active_theme())}")
    print("Studio: http://127.0.0.1:8765/tools/studio.html")
    print("Caption editor: http://127.0.0.1:8765/tools/captions.html")
    print("Voice preview: http://127.0.0.1:8765/tools/voices.html")
    ThreadingHTTPServer(("127.0.0.1", 8765), FactoryHandler).serve_forever()


if __name__ == "__main__":
    main()
