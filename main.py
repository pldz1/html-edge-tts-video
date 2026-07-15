#!/usr/bin/env python3
"""Main CLI for the HTML edge-tts video factory."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from pipeline.factory import CURRENT_SOURCE, LOCAL_WORK, ROOT, SHELL, STARTER_SOURCE, load_source
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
    if target.exists() and any(target.iterdir()) and not args.force:
        raise SystemExit(f"Refusing to overwrite non-empty target: {target}; use --force")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(STARTER_SOURCE, target, dirs_exist_ok=True)
    print(f"Created editable source folder: {target}")
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

    playwright_env = os.environ.copy()
    if args.playwright_download_host:
        playwright_env["PLAYWRIGHT_DOWNLOAD_HOST"] = args.playwright_download_host
        print(f"Using one-time Playwright download host: {args.playwright_download_host}")
    print("Installing Playwright Chromium Headless Shell (no system or headed browser required).")
    run([PYTHON, "-m", "playwright", "install", "--only-shell", "chromium"], env=playwright_env)


def tts(args: argparse.Namespace) -> None:
    validate_source(args.source)
    voice = args.voice
    if not voice:
        scenes = json.loads((CURRENT_SOURCE / "scenes.json").read_text(encoding="utf-8"))
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
    if args.width and args.height:
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
    })
    print(result["prompt"], end="")


def check(args: argparse.Namespace) -> None:
    command = [PYTHON, "pipeline/validate_sources.py"]
    if args.source:
        command.extend(["--source", args.source])
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


def add_source_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source", help="Folder containing scenes.json and body.html.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run HTML video factory tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("--target", default=str(LOCAL_WORK / "new-video"))
    init_parser.add_argument("--force", action="store_true")
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
