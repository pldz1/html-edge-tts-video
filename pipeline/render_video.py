#!/usr/bin/env python3
"""Record the themed HTML composition with Playwright, then mux narration using FFmpeg."""
from __future__ import annotations

import argparse
import asyncio
import math
import json
import os
import subprocess
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright
from playwright.async_api import Error as PlaywrightError

from factory import CURRENT_ASSETS, LOCAL_PLAYWRIGHT, ROOT, active_theme, load_scenes, load_source, output_path, theme_url


SYSTEM_BROWSERS = [
    str(Path(os.environ.get("ProgramFiles", "")) / "Google/Chrome/Application/chrome.exe"),
    str(Path(os.environ.get("ProgramFiles(x86)", "")) / "Google/Chrome/Application/chrome.exe"),
    str(Path(os.environ.get("ProgramFiles", "")) / "Microsoft/Edge/Application/msedge.exe"),
    str(Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft/Edge/Application/msedge.exe"),
]
SIZES = {
    "480p": (854, 480),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "1440p": (2560, 1440),
    "4k": (3840, 2160),
    "2160p": (3840, 2160),
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass


def serve() -> None:
    os.chdir(ROOT)
    ThreadingHTTPServer(("127.0.0.1", 8765), QuietHandler).serve_forever()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--theme", default=None)
    parser.add_argument("--size", default="720p", choices=sorted(SIZES))
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--output", default="codex-edge-tts-tutorial.mp4")
    parser.add_argument("--capture", default="auto", choices=["auto", "video", "frames"])
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--crf", type=int, default=14)
    parser.add_argument("--preset", default="slow")
    parser.add_argument("--frame-format", default="jpeg", choices=["jpeg", "png"])
    parser.add_argument("--jpeg-quality", type=int, default=96)
    return parser.parse_args()


def ensure_render_assets_match_source() -> None:
    timeline_file = CURRENT_ASSETS / "timeline.json"
    narration = CURRENT_ASSETS / "narration.mp3"
    if not timeline_file.exists() or not narration.exists():
        raise SystemExit("Run: python main.py tts --source <folder>")

    try:
        timeline = json.loads(timeline_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"timeline.json is invalid; rerun python main.py tts --source <folder> ({exc})") from exc

    source_signature = [(scene.get("id"), scene.get("narration")) for scene in load_scenes()]
    timeline_signature = [
        (scene.get("id"), scene.get("narration"))
        for scene in timeline.get("scenes", [])
        if isinstance(scene, dict)
    ]
    if source_signature != timeline_signature:
        raise SystemExit("Generated timeline/audio do not match current scenes; rerun: python main.py tts --source <folder>")


async def launch_browser(playwright: object) -> object:
    base_args: dict[str, object] = {"headless": True}
    explicit_browser = os.environ.get("CHROME_EXECUTABLE")
    candidates = [Path(path) for path in SYSTEM_BROWSERS if path and Path(path).is_file()]

    if explicit_browser and Path(explicit_browser).is_file():
        launch_args = {**base_args, "executable_path": explicit_browser}
        try:
            print(f"Using browser: {explicit_browser}")
            return await playwright.chromium.launch(**launch_args)
        except PlaywrightError as exc:
            reason = str(exc).splitlines()[0]
            print(f"Explicit browser launch failed, trying bundled Chromium: {explicit_browser} ({reason})")

    try:
        print("Using browser: Playwright bundled Chromium")
        return await playwright.chromium.launch(**base_args)
    except PlaywrightError as exc:
        reason = str(exc).splitlines()[0]
        print(f"Bundled Chromium launch failed, trying system browsers ({reason})")

    for executable in candidates:
        launch_args = {**base_args, "executable_path": str(executable)}
        try:
            print(f"Using browser: {executable}")
            return await playwright.chromium.launch(**launch_args)
        except PlaywrightError as exc:
            reason = str(exc).splitlines()[0]
            print(f"Browser launch failed, trying next option: {executable} ({reason})")

    raise SystemExit(
        "Could not launch a browser. Run: python main.py install "
        "or set CHROME_EXECUTABLE to a working Chrome/Edge executable."
    )


def resolved_capture_mode(value: str, width: int, height: int) -> str:
    if value != "auto":
        return value
    return "frames" if max(width, height) >= 1080 else "video"


def ffmpeg_common_output_args(args: argparse.Namespace, output: Path) -> list[str]:
    return [
        "-c:v",
        "libx264",
        "-preset",
        args.preset,
        "-crf",
        str(args.crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        str(output),
    ]


async def load_render_page(browser: object, theme: str, width: int, height: int) -> tuple[object, object, float]:
    context = await browser.new_context(viewport={"width": width, "height": height})
    page = await context.new_page()
    await page.goto(f"{theme_url(theme)}?render=1", wait_until="networkidle")
    await page.wait_for_function("window.compositionReady === true || window.demoReady === true")
    duration = float(
        await page.evaluate(
            """() => {
              const durationFn = window.getCompositionDuration || window.getDemoDuration;
              if (!durationFn) throw new Error('Theme runtime is missing getCompositionDuration()');
              return durationFn();
            }"""
        )
    )
    return context, page, duration


async def capture_frames(
    browser: object,
    theme: str,
    width: int,
    height: int,
    narration: Path,
    output: Path,
    args: argparse.Namespace,
) -> None:
    context, page, duration = await load_render_page(browser, theme, width, height)
    frame_count = max(1, math.ceil(duration * args.fps))
    print(
        f"Rendering frames: {frame_count} frames at {args.fps} fps "
        f"({width}x{height}, {args.frame_format})"
    )

    process = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-f",
            "image2pipe",
            "-framerate",
            str(args.fps),
            "-i",
            "-",
            "-i",
            str(narration),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            *ffmpeg_common_output_args(args, output),
        ],
        cwd=ROOT,
        stdin=subprocess.PIPE,
    )

    assert process.stdin is not None
    try:
        for frame in range(frame_count):
            seconds = min(duration, frame / args.fps)
            await page.evaluate("(seconds) => window.renderAtTime(seconds)", seconds)
            screenshot_args: dict[str, object] = {"type": args.frame_format}
            if args.frame_format == "jpeg":
                screenshot_args["quality"] = args.jpeg_quality
            image = await page.screenshot(**screenshot_args)
            process.stdin.write(image)
            if frame and frame % (args.fps * 5) == 0:
                print(f"Captured {frame}/{frame_count} frames")
    except BrokenPipeError as exc:
        raise SystemExit("FFmpeg stopped while receiving rendered frames") from exc
    finally:
        process.stdin.close()
        await context.close()

    if process.wait() != 0:
        raise subprocess.CalledProcessError(process.returncode, "ffmpeg image2pipe render")


async def capture_video(
    browser: object,
    theme: str,
    width: int,
    height: int,
    narration: Path,
    output: Path,
    args: argparse.Namespace,
) -> None:
    tmp = LOCAL_PLAYWRIGHT
    tmp.mkdir(parents=True, exist_ok=True)

    context = await browser.new_context(
        viewport={"width": width, "height": height},
        record_video_dir=str(tmp),
        record_video_size={"width": width, "height": height},
    )
    recording_started = time.perf_counter()
    page = await context.new_page()
    await page.goto(f"{theme_url(theme)}?render=1", wait_until="networkidle")
    await page.wait_for_function("window.compositionReady === true || window.demoReady === true")
    duration = float(
        await page.evaluate(
            """() => {
              const durationFn = window.getCompositionDuration || window.getDemoDuration;
              if (!durationFn) throw new Error('Theme runtime is missing getCompositionDuration()');
              return durationFn();
            }"""
        )
    )
    preroll = max(0, time.perf_counter() - recording_started)
    print(f"Trimming video preroll: {preroll:.3f}s")
    await page.evaluate(
        """() => {
          const startFn = window.startCompositionPlayback || window.startDeterministicPlayback;
          if (!startFn) throw new Error('Theme runtime is missing startCompositionPlayback()');
          return startFn();
        }"""
    )
    await page.wait_for_timeout(int((duration + 1.2) * 1000))
    video = page.video
    await context.close()
    visual = Path(await video.path())

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{preroll:.3f}",
            "-i",
            str(visual),
            "-i",
            str(narration),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            *ffmpeg_common_output_args(args, output),
        ],
        check=True,
    )


async def main() -> None:
    args = parse_args()
    if args.source:
        load_source(Path(args.source), args.theme or "default")

    theme = args.theme or active_theme()
    width, height = (args.width, args.height) if args.width and args.height else SIZES[args.size]
    narration = CURRENT_ASSETS / "narration.mp3"
    ensure_render_assets_match_source()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    async with async_playwright() as p:
        browser = await launch_browser(p)
        output = output_path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        mode = resolved_capture_mode(args.capture, width, height)
        print(f"Capture mode: {mode}")
        if mode == "frames":
            await capture_frames(browser, theme, width, height, narration, output, args)
        else:
            await capture_video(browser, theme, width, height, narration, output, args)
        await browser.close()
    print(f"Created: {output}")


if __name__ == "__main__":
    asyncio.run(main())
