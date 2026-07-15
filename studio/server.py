#!/usr/bin/env python3
"""Serve the Studio web app and its local JSON API."""
from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from pipeline.captions import default_doc, load_effective_doc, load_timeline, save_doc
from pipeline.factory import CURRENT_SOURCE, ROOT, active_theme, theme_path
from studio.api import ApiError, handle_get, handle_post


class FactoryHandler(SimpleHTTPRequestHandler):
    def log_message(self, message: str, *args: object) -> None:
        if self.path.startswith("/api/"):
            print(f"[http] {self.command} {self.path} - {message % args}", flush=True)

    def copyfile(self, source, outputfile) -> None:
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            # Browsers commonly cancel asset requests during reloads or navigation.
            # Treat those disconnects as normal and avoid noisy tracebacks on Windows.
            return

    def send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    def send_redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def read_json_body(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ApiError(400, "invalid content length") from exc
        if length <= 0 or length > 2_000_000:
            raise ApiError(400, "invalid request body size")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(400, str(exc)) from exc

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        tool_routes = {
            "": "/studio/web/studio/index.html",
            "/": "/studio/web/studio/index.html",
            "/studio": "/studio/web/studio/index.html",
            "/studio/main": "/studio/web/studio/index.html",
            "/studio/new": "/studio/web/studio/index.html",
            "/studio/prompt": "/studio/web/studio/index.html",
            "/studio/create": "/studio/web/studio/index.html",
            "/studio/import": "/studio/web/studio/index.html",
            "/studio/voice": "/studio/web/voices/index.html",
            "/voices": "/studio/web/voices/index.html",
            "/captions": "/studio/web/captions/index.html",
        }
        if path in tool_routes:
            # Serve the app entry internally so the browser keeps the friendly
            # route. Studio uses that route to select the main/prompt/import view.
            self.path = tool_routes[path]
            super().do_GET()
            return

        # captions.json is optional until the user saves manual edits. Return
        # JSON null so the theme can use generated timeline cues without a
        # noisy missing-resource error in every preview iframe.
        if path == "/.local/current/source/captions.json" and not (CURRENT_SOURCE / "captions.json").exists():
            self.send_json(200, None)
            return

        try:
            studio_response = handle_get(path, query)
        except ApiError as exc:
            self.send_error_json(exc.status, exc.message)
            return
        if studio_response:
            status, payload = studio_response
            self.send_json(status, payload)
            return

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
                    "previewUrl": theme_path(active_theme()),
                    "audioUrl": "/.local/current/assets/narration.mp3",
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json_body()
        except ApiError as exc:
            self.send_error_json(exc.status, exc.message)
            return

        if not isinstance(payload, dict) and path != "/api/captions":
            self.send_error_json(400, "request body must be a JSON object")
            return

        try:
            studio_response = handle_post(path, payload if isinstance(payload, dict) else {})
        except ApiError as exc:
            self.send_error_json(exc.status, exc.message)
            return
        if studio_response:
            status, result = studio_response
            self.send_json(status, result)
            return

        if path == "/api/captions":
            try:
                result = save_doc(payload)
            except (TypeError, ValueError) as exc:
                self.send_error_json(400, str(exc))
                return
            except SystemExit as exc:
                self.send_error_json(409, str(exc))
                return

            self.send_json(200, result)
            return

        self.send_error_json(404, "unknown endpoint")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Studio web app and JSON API.")
    parser.add_argument("--host", default="127.0.0.1", help="Interface or hostname to bind.")
    parser.add_argument("--port", type=int, default=8765, choices=range(1, 65536), metavar="PORT")
    return parser.parse_args()


def display_host(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        return "127.0.0.1"
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def main() -> None:
    args = parse_args()
    os.chdir(ROOT)
    origin = f"http://{display_host(args.host)}:{args.port}"
    print(f"Preview: {origin}{theme_path(active_theme())}")
    print(f"Studio: {origin}/")
    print(f"Caption editor: {origin}/captions")
    print(f"Voice preview: {origin}/voices")
    server = ThreadingHTTPServer((args.host, args.port), FactoryHandler)
    try:
        print(
            f"[server] Listening on {args.host}:{args.port} for browser and API activity. "
            "Press Ctrl+C to stop.",
            flush=True,
        )
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] Shutdown requested.", flush=True)
    finally:
        server.server_close()
        print("[server] Stopped.", flush=True)


if __name__ == "__main__":
    main()
