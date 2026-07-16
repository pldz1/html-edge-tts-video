#!/usr/bin/env python3
"""Record the HTML composition shell with Playwright, then mux narration using FFmpeg."""
from __future__ import annotations

import argparse
import asyncio
import math
import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.async_api import async_playwright
from playwright.async_api import Error as PlaywrightError

try:
    from .factory import PLAYWRIGHT_RECORDINGS, ROOT, load_scenes, normalize_aspect_ratio, output_path, project_paths, read_json, shell_url
    from .toolchain import configure_playwright_environment, ffmpeg_executable
except ImportError:  # Direct script execution: python pipeline/render_video.py
    from factory import PLAYWRIGHT_RECORDINGS, ROOT, load_scenes, normalize_aspect_ratio, output_path, project_paths, read_json, shell_url
    from toolchain import configure_playwright_environment, ffmpeg_executable


SIZES = {
    "480p": (854, 480),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "1440p": (2560, 1440),
    "4k": (3840, 2160),
    "2160p": (3840, 2160),
}


def output_dimensions(size: str, aspect_ratio: str) -> tuple[int, int]:
    width, height = SIZES[size]
    return (height, width) if normalize_aspect_ratio(aspect_ratio) == "9:16" else (width, height)


def dimensions_match_aspect(width: int, height: int, aspect_ratio: str) -> bool:
    expected = 16 / 9 if normalize_aspect_ratio(aspect_ratio) == "16:9" else 9 / 16
    return abs((width / height) - expected) <= 0.01

LANDSCAPE_DESIGN_SIZE = (1280, 720)
PORTRAIT_DESIGN_SIZE = (720, 1280)
PROGRESS_PREFIX = "RENDER_PROGRESS "
RENDER_PROJECT_ROOT: Path | None = None


@dataclass(frozen=True)
class RenderGeometry:
    """Separate CSS layout coordinates from encoded output pixels."""

    output_width: int
    output_height: int
    viewport_width: int
    viewport_height: int
    device_scale_factor: float


class RenderProgress:
    """Report measured capture and FFmpeg progress to terminals and Studio."""

    def __init__(self, duration: float, total_frames: int, mode: str) -> None:
        self.duration = max(0.001, duration)
        self.total_frames = max(1, total_frames)
        self.mode = mode
        self.started = time.perf_counter()
        self.last_emitted = 0.0
        self.rendered_frames = 0
        self.rendered_seconds = 0.0
        self.encoded_frames = 0
        self.encoded_seconds = 0.0
        self.ffmpeg_fps = 0.0
        self.speed = 0.0
        self.phase = "rendering"
        self._lock = threading.Lock()
        self._tty = sys.stdout.isatty()

    @staticmethod
    def _clock(seconds: float | None) -> str:
        if seconds is None or not math.isfinite(seconds):
            return "--:--"
        value = max(0, round(seconds))
        hours, remainder = divmod(value, 3600)
        minutes, secs = divmod(remainder, 60)
        return f"{hours:d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"

    def _snapshot_locked(self) -> dict[str, object]:
        elapsed = max(0.001, time.perf_counter() - self.started)
        rendered_percent = min(100.0, self.rendered_frames * 100 / self.total_frames)
        encoded_by_time = self.encoded_seconds * 100 / self.duration
        encoded_by_frame = self.encoded_frames * 100 / self.total_frames
        encoded_percent = min(100.0, max(encoded_by_time, encoded_by_frame))

        if self.phase == "rendering" and self.mode == "video":
            percent = min(100.0, self.rendered_seconds * 100 / self.duration)
        elif self.phase == "completed":
            percent = 100.0
        else:
            percent = encoded_percent

        eta: float | None = None
        if self.phase == "rendering" and self.mode == "video":
            eta = max(0.0, self.duration - self.rendered_seconds)
        elif self.speed > 0 and self.encoded_seconds > 0:
            eta = max(0.0, self.duration - self.encoded_seconds) / self.speed
        elif 0 < percent < 100:
            eta = elapsed * (100.0 - percent) / percent
        if self.phase == "completed":
            eta = 0.0

        capture_fps = self.rendered_frames / elapsed
        return {
            "phase": self.phase,
            "percent": round(percent, 2),
            "renderedPercent": round(rendered_percent, 2),
            "encodedPercent": round(encoded_percent, 2),
            "renderedFrames": self.rendered_frames,
            "encodedFrames": self.encoded_frames,
            "totalFrames": self.total_frames,
            "renderedSeconds": round(self.rendered_seconds, 3),
            "encodedSeconds": round(self.encoded_seconds, 3),
            "durationSeconds": round(self.duration, 3),
            "captureFps": round(capture_fps, 2),
            "encodeFps": round(self.ffmpeg_fps, 2),
            "speed": round(self.speed, 4),
            "elapsedSeconds": round(elapsed, 2),
            "etaSeconds": round(eta, 2) if eta is not None and math.isfinite(eta) else None,
        }

    def _emit_locked(self, force: bool = False) -> None:
        now = time.perf_counter()
        if not force and now - self.last_emitted < 0.75:
            return
        self.last_emitted = now
        snapshot = self._snapshot_locked()
        if self._tty:
            phase = {
                "rendering": "Rendering",
                "encoding": "Encoding ",
                "finalizing": "Finalizing",
                "completed": "Completed ",
            }.get(str(snapshot["phase"]), str(snapshot["phase"]).title())
            line = (
                f"{phase} {float(snapshot['percent']):6.2f}% | "
                f"capture {snapshot['renderedFrames']}/{snapshot['totalFrames']} | "
                f"encode {snapshot['encodedFrames']}/{snapshot['totalFrames']} | "
                f"{float(snapshot['encodeFps']):.1f} fps | "
                f"{float(snapshot['speed']):.3f}x | "
                f"ETA {self._clock(snapshot['etaSeconds'])}"
            )
            print(f"\r{line:<100}", end="\n" if self.phase == "completed" else "", flush=True)
        else:
            print(PROGRESS_PREFIX + json.dumps(snapshot, separators=(",", ":")), flush=True)

    def update_rendered(self, frames: int, seconds: float, force: bool = False) -> None:
        with self._lock:
            self.rendered_frames = max(self.rendered_frames, frames)
            self.rendered_seconds = max(self.rendered_seconds, min(self.duration, seconds))
            self._emit_locked(force)

    def update_encoded(self, values: dict[str, str], force: bool = False) -> None:
        with self._lock:
            self.encoded_frames = max(self.encoded_frames, _progress_int(values.get("frame")))
            self.encoded_seconds = max(self.encoded_seconds, _progress_seconds(values))
            self.ffmpeg_fps = _progress_float(values.get("fps"), self.ffmpeg_fps)
            self.speed = _progress_float((values.get("speed") or "").rstrip("x"), self.speed)
            if self.mode == "video" or self.rendered_frames >= self.total_frames:
                self.phase = "encoding"
            self._emit_locked(force)

    def finalizing(self) -> None:
        with self._lock:
            self.phase = "finalizing"
            self._emit_locked(True)

    def complete(self) -> None:
        with self._lock:
            self.phase = "completed"
            self.rendered_frames = self.total_frames
            self.rendered_seconds = self.duration
            self.encoded_frames = self.total_frames
            self.encoded_seconds = self.duration
            self._emit_locked(True)


def _progress_float(value: str | None, fallback: float = 0.0) -> float:
    try:
        parsed = float(value or "")
    except ValueError:
        return fallback
    return parsed if math.isfinite(parsed) else fallback


def _progress_int(value: str | None) -> int:
    try:
        return max(0, int(value or "0"))
    except ValueError:
        return 0


def _progress_seconds(values: dict[str, str]) -> float:
    for key in ("out_time_us", "out_time_ms"):
        if key in values:
            return max(0.0, _progress_float(values[key]) / 1_000_000)
    value = values.get("out_time") or ""
    try:
        hours, minutes, seconds = value.split(":", 2)
        return max(0.0, int(hours) * 3600 + int(minutes) * 60 + float(seconds))
    except (TypeError, ValueError):
        return 0.0


def read_ffmpeg_progress(stream: object, reporter: RenderProgress) -> None:
    values: dict[str, str] = {}
    for raw_line in iter(stream.readline, b""):
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        if "=" not in line:
            print(f"FFmpeg: {line}", flush=True)
            continue
        key, value = line.split("=", 1)
        if key == "progress":
            reporter.update_encoded(values, force=value == "end")
            if value == "end":
                reporter.finalizing()
            values = {}
        else:
            values[key] = value


def start_progress_reader(
    process: subprocess.Popen[bytes],
    reporter: RenderProgress,
) -> threading.Thread:
    assert process.stderr is not None
    thread = threading.Thread(
        target=read_ffmpeg_progress,
        args=(process.stderr, reporter),
        daemon=True,
    )
    thread.start()
    return thread


def ffmpeg_progress_args() -> list[str]:
    return [
        "-loglevel",
        "error",
        "-nostats",
        "-stats_period",
        "0.5",
        "-progress",
        "pipe:2",
    ]


def resolve_render_geometry(width: int, height: int) -> RenderGeometry:
    """Keep common output sizes on a direction-matched 720p design canvas.

    A larger browser viewport triggers responsive re-layout instead of producing a
    sharper version of the same frame.  Prefer the largest integer CSS viewport
    with the requested aspect ratio that fits inside the design canvas, then use
    Chromium's device scale factor for the additional output pixels.
    """
    if width <= 0 or height <= 0:
        raise ValueError("Render width and height must be positive")

    common = math.gcd(width, height)
    aspect_width = width // common
    aspect_height = height // common
    design_width, design_height = (
        PORTRAIT_DESIGN_SIZE if height > width else LANDSCAPE_DESIGN_SIZE
    )
    multiplier = min(design_width // aspect_width, design_height // aspect_height)

    if multiplier > 0:
        viewport_width = aspect_width * multiplier
        viewport_height = aspect_height * multiplier
        scale = common / multiplier
        if scale >= 1:
            return RenderGeometry(width, height, viewport_width, viewport_height, scale)

    # Very small or unusual custom dimensions cannot always be represented by an
    # exact integer viewport. Preserve their prior direct-rendering behavior.
    return RenderGeometry(width, height, width, height, 1.0)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/__project__" or parsed.path.startswith("/__project__/"):
            if RENDER_PROJECT_ROOT is None:
                return str(ROOT / ".missing-project")
            relative = unquote(parsed.path.removeprefix("/__project__/")).replace("/", os.sep)
            target = (RENDER_PROJECT_ROOT / relative).resolve()
            try:
                target.relative_to(RENDER_PROJECT_ROOT.resolve())
            except ValueError:
                return str(ROOT / ".invalid-project-path")
            return str(target)
        return super().translate_path(path)


def serve() -> None:
    os.chdir(ROOT)
    try:
        ThreadingHTTPServer(("127.0.0.1", 8765), QuietHandler).serve_forever()
    except OSError:
        print("Using existing server on http://127.0.0.1:8765")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
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
    parser.add_argument("--transition", type=float, default=0.4)
    args = parser.parse_args()
    if not 0 <= args.transition <= 2:
        parser.error("--transition must be between 0 and 2 seconds")
    if (args.width is None) != (args.height is None):
        parser.error("--width and --height must be supplied together")
    if args.width is not None and (args.width <= 0 or args.height <= 0):
        parser.error("--width and --height must be positive")
    return args


def ensure_render_assets_match_source(source: Path, assets: Path) -> None:
    timeline_file = assets / "timeline.json"
    narration = assets / "narration.mp3"
    if not timeline_file.exists() or not narration.exists():
        raise SystemExit("Run: python main.py tts --source <folder>")

    try:
        timeline = json.loads(timeline_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"timeline.json is invalid; rerun python main.py tts --source <folder> ({exc})") from exc

    source_signature = [(scene.get("id"), scene.get("narration")) for scene in load_scenes(source)]
    timeline_signature = [
        (scene.get("id"), scene.get("narration"))
        for scene in timeline.get("scenes", [])
        if isinstance(scene, dict)
    ]
    if source_signature != timeline_signature:
        raise SystemExit("Generated timeline/audio do not match current scenes; rerun: python main.py tts --source <folder>")


async def launch_browser(playwright: object) -> object:
    try:
        print("Using browser: Playwright Chromium Headless Shell")
        return await playwright.chromium.launch(headless=True)
    except PlaywrightError as exc:
        reason = str(exc).splitlines()[0]
        raise SystemExit(
            f"Could not launch Playwright Chromium Headless Shell ({reason}).\n"
            "Run: python main.py install\n"
            "This project intentionally does not use system Chrome or Edge."
        ) from exc


def resolved_capture_mode(value: str, width: int, height: int) -> str:
    if value != "auto":
        return value
    return "frames" if max(width, height) >= 1080 else "video"


def ffmpeg_common_output_args(
    args: argparse.Namespace,
    output: Path,
    width: int,
    height: int,
) -> list[str]:
    return [
        "-vf",
        f"scale={width}:{height}:flags=lanczos,setsar=1",
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


async def wait_for_composition(page: object) -> None:
    await page.wait_for_function(
        "window.compositionReady === true || window.demoReady === true || Boolean(window.compositionError)"
    )
    error = await page.evaluate("() => window.compositionError || ''")
    if error:
        raise SystemExit(f"Composition failed to initialize: {error}")


def render_page_url(transition: float) -> str:
    return f"{shell_url(RENDER_PROJECT_ROOT)}&render=1&transition={transition:g}"


async def load_render_page(
    browser: object,
    geometry: RenderGeometry,
    transition: float,
) -> tuple[object, object, float]:
    context = await browser.new_context(
        viewport={"width": geometry.viewport_width, "height": geometry.viewport_height},
        device_scale_factor=geometry.device_scale_factor,
    )
    page = await context.new_page()
    await page.goto(render_page_url(transition), wait_until="networkidle")
    await wait_for_composition(page)
    duration = float(
        await page.evaluate(
            """() => {
              const durationFn = window.getCompositionDuration || window.getDemoDuration;
              if (!durationFn) throw new Error('Shell runtime is missing getCompositionDuration()');
              return durationFn();
            }"""
        )
    )
    return context, page, duration


async def capture_frames(
    browser: object,
    geometry: RenderGeometry,
    narration: Path,
    output: Path,
    args: argparse.Namespace,
) -> None:
    context, page, duration = await load_render_page(browser, geometry, args.transition)
    frame_count = max(1, math.ceil(duration * args.fps))
    reporter = RenderProgress(duration, frame_count, "frames")
    print(
        f"Rendering frames: {frame_count} frames at {args.fps} fps "
        f"({geometry.output_width}x{geometry.output_height}, {args.frame_format})\n"
        f"Layout viewport: {geometry.viewport_width}x{geometry.viewport_height} CSS px; "
        f"pixel scale: {geometry.device_scale_factor:g}x"
    )

    process = subprocess.Popen(
        [
            ffmpeg_executable(),
            "-y",
            *ffmpeg_progress_args(),
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
            *ffmpeg_common_output_args(
                args,
                output,
                geometry.output_width,
                geometry.output_height,
            ),
        ],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    progress_thread = start_progress_reader(process, reporter)
    reporter.update_rendered(0, 0, force=True)

    assert process.stdin is not None
    pipe_error: BrokenPipeError | None = None
    try:
        for frame in range(frame_count):
            seconds = min(duration, frame / args.fps)
            await page.evaluate("(seconds) => window.renderAtTime(seconds)", seconds)
            screenshot_args: dict[str, object] = {"type": args.frame_format}
            if args.frame_format == "jpeg":
                screenshot_args["quality"] = args.jpeg_quality
            image = await page.screenshot(**screenshot_args)
            process.stdin.write(image)
            reporter.update_rendered(
                frame + 1,
                min(duration, (frame + 1) / args.fps),
            )
    except BrokenPipeError as exc:
        pipe_error = exc
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError as exc:
            pipe_error = pipe_error or exc
        await context.close()

    exit_code = process.wait()
    progress_thread.join(timeout=2)
    if pipe_error is not None:
        raise SystemExit("FFmpeg stopped while receiving rendered frames") from pipe_error
    if exit_code != 0:
        raise subprocess.CalledProcessError(process.returncode, "ffmpeg image2pipe render")
    reporter.complete()


async def capture_video(
    browser: object,
    geometry: RenderGeometry,
    narration: Path,
    output: Path,
    args: argparse.Namespace,
) -> None:
    tmp = PLAYWRIGHT_RECORDINGS
    tmp.mkdir(parents=True, exist_ok=True)

    context = await browser.new_context(
        viewport={"width": geometry.viewport_width, "height": geometry.viewport_height},
        device_scale_factor=geometry.device_scale_factor,
        record_video_dir=str(tmp),
        record_video_size={"width": geometry.output_width, "height": geometry.output_height},
    )
    recording_started = time.perf_counter()
    page = await context.new_page()
    await page.goto(render_page_url(args.transition), wait_until="networkidle")
    await wait_for_composition(page)
    duration = float(
        await page.evaluate(
            """() => {
              const durationFn = window.getCompositionDuration || window.getDemoDuration;
              if (!durationFn) throw new Error('Shell runtime is missing getCompositionDuration()');
              return durationFn();
            }"""
        )
    )
    frame_count = max(1, math.ceil(duration * args.fps))
    reporter = RenderProgress(duration, frame_count, "video")
    preroll = max(0, time.perf_counter() - recording_started)
    print(f"Trimming video preroll: {preroll:.3f}s")
    await page.evaluate(
        """() => {
          const startFn = window.startCompositionPlayback || window.startDeterministicPlayback;
          if (!startFn) throw new Error('Shell runtime is missing startCompositionPlayback()');
          return startFn();
        }"""
    )
    playback_started = time.perf_counter()
    reporter.update_rendered(0, 0, force=True)
    while True:
        elapsed = time.perf_counter() - playback_started
        if elapsed >= duration:
            break
        reporter.update_rendered(
            min(frame_count, math.floor(elapsed * args.fps)),
            elapsed,
        )
        await page.wait_for_timeout(400)
    reporter.update_rendered(frame_count, duration, force=True)
    await page.wait_for_timeout(1200)
    video = page.video
    await context.close()
    visual = Path(await video.path())

    reporter.update_encoded({}, force=True)
    process = subprocess.Popen(
        [
            ffmpeg_executable(),
            "-y",
            *ffmpeg_progress_args(),
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
            *ffmpeg_common_output_args(
                args,
                output,
                geometry.output_width,
                geometry.output_height,
            ),
        ],
        cwd=ROOT,
        stderr=subprocess.PIPE,
    )
    progress_thread = start_progress_reader(process, reporter)
    exit_code = process.wait()
    progress_thread.join(timeout=2)
    if exit_code != 0:
        raise subprocess.CalledProcessError(exit_code, "ffmpeg recorded-video render")
    reporter.complete()


async def main() -> None:
    global RENDER_PROJECT_ROOT
    args = parse_args()
    paths = project_paths(Path(args.source) if args.source else None)
    RENDER_PROJECT_ROOT = paths.root
    configure_playwright_environment()

    manifest = read_json(paths.manifest)
    aspect_ratio = normalize_aspect_ratio(
        manifest.get("aspectRatio") if isinstance(manifest, dict) else None
    )
    width, height = (
        (args.width, args.height)
        if args.width is not None
        else output_dimensions(args.size, aspect_ratio)
    )
    if not dimensions_match_aspect(width, height, aspect_ratio):
        raise SystemExit(
            f"Requested {width}x{height} does not match this project's immutable "
            f"{aspect_ratio} aspect ratio"
        )
    geometry = resolve_render_geometry(width, height)
    narration = paths.generated / "narration.mp3"
    ensure_render_assets_match_source(paths.root, paths.generated)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    async with async_playwright() as p:
        browser = await launch_browser(p)
        output = output_path(args.output, paths.root)
        output.parent.mkdir(parents=True, exist_ok=True)
        mode = resolved_capture_mode(args.capture, width, height)
        print(f"Capture mode: {mode}")
        if mode == "frames":
            await capture_frames(browser, geometry, narration, output, args)
        else:
            await capture_video(browser, geometry, narration, output, args)
        await browser.close()
    print(f"Created: {output}")


if __name__ == "__main__":
    asyncio.run(main())
