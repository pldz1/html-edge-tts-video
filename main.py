#!/usr/bin/env python3
"""Main CLI for the HTML edge-tts video factory."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from pipeline.factory import (
    ASPECT_RATIOS,
    DEFAULT_ASPECT_RATIO,
    LOCAL_WORK,
    PLAYWRIGHT_BROWSERS,
    PROJECT_MANIFEST_FILE,
    ROOT,
    SHELL,
    STARTER_SOURCE,
    atomic_write_json,
    default_manifest,
    ensure_starter_manifest,
    iter_project_roots,
    load_source,
    normalize_aspect_ratio,
    project_paths,
    read_json,
)
from pipeline.prompt_composer import compose_prompt, detect_language


PYTHON = sys.executable


def run(command: list[str], env: dict[str, str] | None = None) -> None:
    try:
        subprocess.run(command, cwd=ROOT, check=True, env=env)
    except KeyboardInterrupt:
        print("\nInterrupted. Shutting down…")
        return
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.returncode)


def copy_source_template(args: argparse.Namespace) -> None:
    target = Path(args.target).expanduser().resolve()
    if target == STARTER_SOURCE.resolve():
        raise SystemExit("starter is read-only; choose a new project folder")
    if target.exists() and any(target.iterdir()) and not args.force:
        raise SystemExit(f"Refusing to overwrite non-empty target: {target}; use --force")
    existing = read_json(target / PROJECT_MANIFEST_FILE)
    requested_aspect_ratio = normalize_aspect_ratio(args.aspect_ratio)
    if isinstance(existing, dict) and existing.get("aspectRatio"):
        if normalize_aspect_ratio(existing.get("aspectRatio")) != requested_aspect_ratio:
            raise SystemExit("Project aspect ratio is fixed after creation; choose a new target folder")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(STARTER_SOURCE / "scenes.json", target / "scenes.json")
    shutil.copy2(STARTER_SOURCE / "body.html", target / "body.html")
    manifest = default_manifest(target, active=False)
    if isinstance(existing, dict):
        manifest = {**manifest, **existing}
    manifest.update({
        "aspectRatio": requested_aspect_ratio,
        "system": False,
        "readOnly": False,
    })
    atomic_write_json(target / PROJECT_MANIFEST_FILE, manifest)
    print(f"Created editable source folder: {target}")
    print(f"Aspect ratio: {requested_aspect_ratio}")
    print("Edit scenes.json and body.html, then run:")
    print(f"python main.py tts --source {target}")


def load(args: argparse.Namespace) -> None:
    load_source(Path(args.source))


def validate_source(source: str | None) -> None:
    command = [PYTHON, "pipeline/validate_sources.py"]
    if source:
        command.extend(["--source", source])
    run(command)


def install(args: argparse.Namespace) -> None:
    pip_command = [PYTHON, "-m", "pip", "install", "-r", "requirements.txt"]
    if args.pip_index_url:
        pip_command.extend(["--index-url", args.pip_index_url])
        print(f"Using one-time Python package index: {args.pip_index_url}")
    run(pip_command)

    from pipeline.toolchain import configure_playwright_environment

    playwright_env = configure_playwright_environment(os.environ.copy())
    if args.playwright_download_host:
        playwright_env["PLAYWRIGHT_DOWNLOAD_HOST"] = args.playwright_download_host
        print(f"Using one-time Playwright download host: {args.playwright_download_host}")
    print("Installing Playwright Chromium Headless Shell (no system or headed browser required).")
    run([PYTHON, "-m", "playwright", "install", "--only-shell", "chromium"], env=playwright_env)


def tts(args: argparse.Namespace) -> None:
    validate_source(args.source)
    voice = args.voice
    if not voice:
        scenes = json.loads(project_paths(Path(args.source) if args.source else None).scenes.read_text(encoding="utf-8"))
        language = detect_language(" ".join(str(scene.get("narration") or "") for scene in scenes if isinstance(scene, dict)))
        voice = {
            "zh-CN": "zh-CN-XiaoxiaoNeural",
        }.get(language, "en-US-JennyNeural")
    command = [
        PYTHON,
        "pipeline/build_tts.py",
        "--voice",
        voice,
        "--rate",
        args.rate,
        "--pitch",
        args.pitch,
        "--gap",
        str(args.gap),
    ]
    if args.source:
        command.extend(["--source", args.source])
    if args.force:
        command.append("--force")
    run(command)


def offline(args: argparse.Namespace) -> None:
    validate_source(args.source)
    command = [PYTHON, "pipeline/build_offline_preview.py"]
    if args.source:
        command.extend(["--source", args.source])
    run(command)


def captions(args: argparse.Namespace) -> None:
    if args.source:
        load_source(Path(args.source))
    run([PYTHON, "studio/server.py"])


def studio(args: argparse.Namespace) -> None:
    if args.source:
        load_source(Path(args.source))
    run([PYTHON, "studio/server.py", "--host", args.host, "--port", str(args.port)])


def render(args: argparse.Namespace) -> None:
    validate_source(args.source)
    if (args.width is None) != (args.height is None):
        raise SystemExit("--width and --height must be supplied together")
    if args.width is not None and (args.width <= 0 or args.height <= 0):
        raise SystemExit("--width and --height must be positive")
    command = [
        PYTHON,
        "pipeline/render_video.py",
        "--size",
        args.size,
        "--output",
        args.output,
        "--capture",
        args.capture,
        "--fps",
        str(args.fps),
        "--crf",
        str(args.crf),
        "--preset",
        args.preset,
        "--frame-format",
        args.frame_format,
        "--jpeg-quality",
        str(args.jpeg_quality),
        "--transition",
        str(args.transition),
    ]
    if args.source:
        command.extend(["--source", args.source])
    if args.width is not None:
        command.extend(["--width", str(args.width), "--height", str(args.height)])
    run(command)


def voices(args: argparse.Namespace) -> None:
    command = [PYTHON, "pipeline/voice_preview.py", "list"]
    if args.json:
        command.append("--json")
    run(command)


def voice_preview(args: argparse.Namespace) -> None:
    command = [
        PYTHON,
        "pipeline/voice_preview.py",
        "preview",
        "--text",
        args.text,
        "--rate",
        args.rate,
        "--pitch",
        args.pitch,
    ]
    for voice in args.voice or []:
        command.extend(["--voice", voice])
    run(command)


def prompt(args: argparse.Namespace) -> None:
    result = compose_prompt({
        "topic": args.topic,
        "audience": args.audience,
        "tone": args.tone,
        "sceneCount": args.scene_count,
        "notes": args.notes,
        "language": args.language,
        "target": args.target,
        "aspectRatio": args.aspect_ratio,
    })
    print(result["prompt"], end="")


def check(args: argparse.Namespace) -> None:
    command = [PYTHON, "pipeline/validate_sources.py"]
    command.extend(["--source", args.source or str(STARTER_SOURCE)])
    run(command)
    run(["node", "--check", str(SHELL / "runtime.js")])
    run(["node", "--check", "studio/web/captions/captions.js"])
    run(["node", "--check", "studio/web/studio/studio.js"])
    run(["node", "--check", "studio/web/voices/voices.js"])
    python_files = [
        ROOT / "main.py",
        *sorted((ROOT / "pipeline").glob("*.py")),
        *sorted((ROOT / "studio").glob("*.py")),
    ]
    run([PYTHON, "-m", "py_compile", *map(str, python_files)])
    validate_project_manifests()


def validate_project_manifests() -> None:
    ensure_starter_manifest()
    ids: set[str] = set()
    active: list[str] = []
    for root in iter_project_roots():
        manifest = read_json(root / PROJECT_MANIFEST_FILE)
        if not isinstance(manifest, dict):
            continue  # Agent-authored projects receive a manifest when Studio first discovers them.
        if manifest.get("version") != 5 or not isinstance(manifest.get("active"), bool):
            raise SystemExit(f"Project manifest must use version 5 and a boolean active field: {root}")
        try:
            aspect_ratio = normalize_aspect_ratio(manifest.get("aspectRatio"))
        except ValueError as exc:
            raise SystemExit(f"Invalid project aspect ratio in {root}: {exc}") from exc
        project_id = str(manifest.get("id") or "").strip().lower()
        if not project_id:
            raise SystemExit(f"Project manifest is missing id: {root}")
        if project_id in ids:
            raise SystemExit(f"Duplicate project manifest id: {project_id}")
        ids.add(project_id)
        if manifest.get("active") is True:
            active.append(project_id)
        if root.resolve() == STARTER_SOURCE.resolve():
            if project_id != "starter" or manifest.get("system") is not True or manifest.get("readOnly") is not True:
                raise SystemExit("Starter manifest must use id=starter, system=true, and readOnly=true")
            if aspect_ratio != DEFAULT_ASPECT_RATIO:
                raise SystemExit("Starter manifest must use aspectRatio=16:9")
    if len(active) != 1:
        raise SystemExit(f"Expected exactly one active project manifest; found {len(active)}")
    print(f"Project manifest validation passed: active={active[0]}")


def doctor(args: argparse.Namespace) -> None:
    del args
    from pipeline.toolchain import configure_playwright_environment, ffmpeg_executable

    configure_playwright_environment()
    ffmpeg = Path(ffmpeg_executable())
    print(f"FFmpeg: {ffmpeg}")
    print(f"Playwright browser cache: {PLAYWRIGHT_BROWSERS.resolve()}")
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            browser.close()
        shells = sorted(PLAYWRIGHT_BROWSERS.glob("chromium_headless_shell-*/**/chrome-headless-shell.exe"))
        if not shells:
            raise RuntimeError("managed chrome-headless-shell executable was not found")
        executable = shells[-1].resolve()
    except Exception as exc:  # noqa: BLE001 - doctor must report environment failures clearly.
        raise SystemExit(f"Playwright Chromium Headless Shell check failed: {exc}\nRun: python main.py install") from exc
    print(f"Chromium Headless Shell: {executable}")
    print("Toolchain doctor passed")


def smoke(args: argparse.Namespace) -> None:
    from pipeline.toolchain import configure_playwright_environment

    configure_playwright_environment()
    process = subprocess.Popen(
        [PYTHON, "studio/server.py", "--host", "127.0.0.1", "--port", str(args.port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    origin = f"http://127.0.0.1:{args.port}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        deadline = time.time() + 12
        state = None
        while time.time() < deadline:
            if process.poll() is not None:
                raise SystemExit(f"Studio smoke server exited early; port {args.port} may already be in use")
            try:
                with opener.open(f"{origin}/api/studio/state", timeout=1) as response:
                    state = json.loads(response.read().decode("utf-8"))
                    break
            except OSError:
                time.sleep(0.2)
        if not isinstance(state, dict):
            raise SystemExit("Studio smoke server did not become ready")

        from playwright.sync_api import sync_playwright

        shell = str(state["urls"]["shell"])
        separator = "&" if "?" in shell else "?"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.goto(f"{origin}/studio", wait_until="domcontentloaded")
            page.wait_for_function(
                "expected => document.querySelector('#workspaceProjectId')?.textContent.trim() === expected",
                arg=str(state["activeProject"]["id"]),
            )
            page.goto(f"{origin}{shell}{separator}render=1", wait_until="networkidle")
            page.wait_for_function("window.compositionReady === true || Boolean(window.compositionError)")
            error = page.evaluate("() => window.compositionError || ''")
            browser.close()
        if error:
            raise SystemExit(f"Studio composition smoke failed: {error}")
        print(f"Studio smoke passed: {state['activeProject']['id']}")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def add_source_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source", help="Folder containing scenes.json and body.html.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run HTML video factory tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("--target", default=str(LOCAL_WORK / "new-video"))
    init_parser.add_argument("--force", action="store_true")
    init_parser.add_argument(
        "--aspect-ratio",
        choices=ASPECT_RATIOS,
        default=DEFAULT_ASPECT_RATIO,
        help="Immutable project canvas orientation (default: 16:9).",
    )
    init_parser.set_defaults(func=copy_source_template)

    load_parser = subparsers.add_parser("load")
    load_parser.add_argument("--source", required=True, help="Folder containing scenes.json and body.html.")
    load_parser.set_defaults(func=load)

    install_parser = subparsers.add_parser(
        "install",
        help="Install Python dependencies and Playwright Chromium Headless Shell.",
        description=(
            "Install requirements.txt (including imageio-ffmpeg) and only Playwright's Chromium "
            "Headless Shell. No headed Chromium, system Chrome, or system Edge is installed or used."
        ),
    )
    install_parser.add_argument(
        "--pip-index-url",
        help="One-time Python package index URL; does not modify pip configuration.",
    )
    install_parser.add_argument(
        "--playwright-download-host",
        help="One-time host for the Playwright Chromium Headless Shell download; does not persist in the environment.",
    )
    install_parser.set_defaults(func=install)

    offline_parser = subparsers.add_parser("offline")
    add_source_args(offline_parser)
    offline_parser.set_defaults(func=offline)

    captions_parser = subparsers.add_parser("captions")
    add_source_args(captions_parser)
    captions_parser.set_defaults(func=captions)

    studio_parser = subparsers.add_parser("studio")
    add_source_args(studio_parser)
    studio_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Interface or hostname to bind (default: 127.0.0.1).",
    )
    studio_parser.add_argument(
        "--port",
        type=int,
        default=8765,
        choices=range(1, 65536),
        metavar="PORT",
        help="TCP port to bind (default: 8765).",
    )
    studio_parser.set_defaults(func=studio)

    check_parser = subparsers.add_parser("check")
    add_source_args(check_parser)
    check_parser.set_defaults(func=check)

    doctor_parser = subparsers.add_parser("doctor", help="Verify managed FFmpeg and Chromium Headless Shell.")
    doctor_parser.set_defaults(func=doctor)

    smoke_parser = subparsers.add_parser("smoke", help="Load the active Studio composition in managed headless Chromium.")
    smoke_parser.add_argument("--port", type=int, default=8876, choices=range(1, 65536), metavar="PORT")
    smoke_parser.set_defaults(func=smoke)

    render_parser = subparsers.add_parser("render")
    add_source_args(render_parser)
    render_parser.add_argument("--size", default="720p", choices=["480p", "720p", "1080p", "2k", "1440p", "4k", "2160p"])
    render_parser.add_argument("--width", type=int)
    render_parser.add_argument("--height", type=int)
    render_parser.add_argument("--output", default="codex-edge-tts-tutorial.mp4")
    render_parser.add_argument("--capture", default="auto", choices=["auto", "video", "frames"])
    render_parser.add_argument("--fps", type=int, default=15)
    render_parser.add_argument("--crf", type=int, default=14)
    render_parser.add_argument("--preset", default="slow")
    render_parser.add_argument("--frame-format", default="jpeg", choices=["jpeg", "png"])
    render_parser.add_argument("--jpeg-quality", type=int, default=96)
    render_parser.add_argument(
        "--transition",
        type=float,
        default=0.4,
        help="Dip-to-background duration in seconds, from 0 (off) to 2.",
    )
    render_parser.set_defaults(func=render)

    voices_parser = subparsers.add_parser("voices")
    voices_parser.add_argument("--json", action="store_true")
    voices_parser.set_defaults(func=voices)

    voice_preview_parser = subparsers.add_parser("voice-preview")
    voice_preview_parser.add_argument("--voice", action="append")
    voice_preview_parser.add_argument(
        "--text",
        default="This is an English voice preview for comparing voices, rate, and overall delivery.",
    )
    voice_preview_parser.add_argument("--rate", default="+12%")
    voice_preview_parser.add_argument("--pitch", default="+0Hz")
    voice_preview_parser.set_defaults(func=voice_preview)

    prompt_parser = subparsers.add_parser("prompt", help="Compose the two-file slide-video source prompt.")
    prompt_parser.add_argument("--topic", required=True)
    prompt_parser.add_argument("--audience", default="")
    prompt_parser.add_argument("--tone", default="Clear and concise")
    prompt_parser.add_argument("--scene-count", default="5")
    prompt_parser.add_argument("--notes", default="")
    prompt_parser.add_argument("--language", choices=["auto", "zh-CN", "en-US"], default="auto")
    prompt_parser.add_argument("--target", choices=["agent", "web-ai"], default="agent")
    prompt_parser.add_argument("--aspect-ratio", choices=ASPECT_RATIOS, default=DEFAULT_ASPECT_RATIO)
    prompt_parser.set_defaults(func=prompt)

    tts_parser = subparsers.add_parser("tts")
    add_source_args(tts_parser)
    tts_parser.add_argument("--voice", default=None, help="Defaults from the detected narration language.")
    tts_parser.add_argument("--rate", default="+12%")
    tts_parser.add_argument("--pitch", default="+0Hz")
    tts_parser.add_argument("--gap", type=float, default=0.28)
    tts_parser.add_argument("--force", action="store_true")
    tts_parser.set_defaults(func=tts)

    return parser


def main() -> None:
    try:
        args = build_parser().parse_args()
        args.func(args)
    except KeyboardInterrupt:
        print("\nCancelled.")


if __name__ == "__main__":
    main()
