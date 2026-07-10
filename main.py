#!/usr/bin/env python3
"""Main CLI for the HTML edge-tts video factory."""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from pipeline.factory import DEFAULT_THEME, LOCAL_WORK, ROOT, STARTER_SOURCE, load_source


PYTHON = sys.executable


def run(command: list[str]) -> None:
    try:
        subprocess.run(command, cwd=ROOT, check=True)
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
    load_source(Path(args.source), args.theme)


def validate_source(source: str | None, theme: str) -> None:
    command = [PYTHON, "pipeline/validate_sources.py", "--theme", theme]
    if source:
        command.extend(["--source", source])
    run(command)


def install(_: argparse.Namespace) -> None:
    run([PYTHON, "-m", "pip", "install", "-r", "requirements.txt"])
    run([PYTHON, "-m", "playwright", "install", "chromium"])


def tts(args: argparse.Namespace) -> None:
    validate_source(args.source, args.theme)
    command = [
        PYTHON,
        "pipeline/build_tts.py",
        "--voice",
        args.voice,
        "--rate",
        args.rate,
        "--pitch",
        args.pitch,
        "--gap",
        str(args.gap),
        "--theme",
        args.theme,
    ]
    if args.source:
        command.extend(["--source", args.source])
    if args.force:
        command.append("--force")
    run(command)


def offline(args: argparse.Namespace) -> None:
    validate_source(args.source, args.theme)
    command = [PYTHON, "pipeline/build_offline_preview.py", "--theme", args.theme]
    if args.source:
        command.extend(["--source", args.source])
    run(command)


def preview(args: argparse.Namespace) -> None:
    if args.source:
        load_source(Path(args.source), args.theme)
    run([PYTHON, "pipeline/serve.py"])


def captions(args: argparse.Namespace) -> None:
    if args.source:
        load_source(Path(args.source), args.theme)
    run([PYTHON, "pipeline/serve.py"])


def studio(args: argparse.Namespace) -> None:
    if args.source:
        load_source(Path(args.source), args.theme)
    run([PYTHON, "pipeline/serve.py"])


def render(args: argparse.Namespace) -> None:
    validate_source(args.source, args.theme)
    command = [
        PYTHON,
        "pipeline/render_video.py",
        "--size",
        args.size,
        "--output",
        args.output,
        "--theme",
        args.theme,
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


def check(args: argparse.Namespace) -> None:
    command = [PYTHON, "pipeline/validate_sources.py", "--theme", args.theme]
    if args.source:
        command.extend(["--source", args.source])
    run(command)
    run(["node", "--check", "themes/default/runtime.js"])
    run(["node", "--check", "tools/captions.js"])
    run(["node", "--check", "tools/studio.js"])
    run(["node", "--check", "tools/voices.js"])
    python_files = [ROOT / "main.py", *sorted((ROOT / "pipeline").glob("*.py"))]
    run([PYTHON, "-m", "py_compile", *map(str, python_files)])


def add_source_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source", help="Folder containing scenes.json and body.html.")
    parser.add_argument("--theme", default=DEFAULT_THEME)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run HTML video factory tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("--target", default=str(LOCAL_WORK / "starter"))
    init_parser.add_argument("--force", action="store_true")
    init_parser.set_defaults(func=copy_source_template)

    load_parser = subparsers.add_parser("load")
    load_parser.add_argument("--source", required=True, help="Folder containing scenes.json and body.html.")
    load_parser.add_argument("--theme", default=DEFAULT_THEME)
    load_parser.set_defaults(func=load)

    subparsers.add_parser("install").set_defaults(func=install)

    offline_parser = subparsers.add_parser("offline")
    add_source_args(offline_parser)
    offline_parser.set_defaults(func=offline)

    preview_parser = subparsers.add_parser("preview")
    add_source_args(preview_parser)
    preview_parser.set_defaults(func=preview)

    captions_parser = subparsers.add_parser("captions")
    add_source_args(captions_parser)
    captions_parser.set_defaults(func=captions)

    studio_parser = subparsers.add_parser("studio")
    add_source_args(studio_parser)
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
    render_parser.set_defaults(func=render)

    voices_parser = subparsers.add_parser("voices")
    voices_parser.add_argument("--json", action="store_true")
    voices_parser.set_defaults(func=voices)

    voice_preview_parser = subparsers.add_parser("voice-preview")
    voice_preview_parser.add_argument("--voice", action="append")
    voice_preview_parser.add_argument(
        "--text",
        default="这是一段中文配音试听，用来比较声音、语速和整体气质。",
    )
    voice_preview_parser.add_argument("--rate", default="+12%")
    voice_preview_parser.add_argument("--pitch", default="+0Hz")
    voice_preview_parser.set_defaults(func=voice_preview)

    tts_parser = subparsers.add_parser("tts")
    add_source_args(tts_parser)
    tts_parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
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
