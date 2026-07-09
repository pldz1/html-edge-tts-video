#!/usr/bin/env python3
"""List edge-tts voices and build a local voice preview manifest."""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

import edge_tts

from factory import LOCAL_ASSETS

PREVIEW_DIR = LOCAL_ASSETS / "voice-preview"
DEFAULT_TEXT = "这是一段中文配音试听，用来比较声音、语速和整体气质。"
DEFAULT_VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunxiaNeural",
    "zh-CN-YunyangNeural",
]


def slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")


async def chinese_voices() -> list[dict]:
    voices = await edge_tts.list_voices()
    return sorted(
        [voice for voice in voices if voice.get("ShortName", "").startswith("zh-")],
        key=lambda voice: voice.get("ShortName", ""),
    )


def voice_label(voice: dict) -> str:
    gender = voice.get("Gender", "")
    locale = voice.get("Locale", "")
    short_name = voice.get("ShortName", "")
    return " / ".join(part for part in [short_name, locale, gender] if part)


async def list_voices(args: argparse.Namespace) -> None:
    voices = await chinese_voices()
    if args.json:
        print(json.dumps(voices, ensure_ascii=False, indent=2))
        return
    for voice in voices:
        print(voice_label(voice))


async def build_preview(args: argparse.Namespace) -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    available = {voice["ShortName"]: voice for voice in await chinese_voices()}
    selected = args.voice or DEFAULT_VOICES
    missing = [voice for voice in selected if voice not in available]
    if missing:
        raise SystemExit(f"Unknown edge-tts voice: {', '.join(missing)}")

    samples = []
    for voice_name in selected:
        audio_path = PREVIEW_DIR / f"{slug(voice_name)}.mp3"
        print(f"preview: {voice_name}")
        communicate = edge_tts.Communicate(
            args.text,
            voice=voice_name,
            rate=args.rate,
            pitch=args.pitch,
            boundary="WordBoundary",
        )
        with audio_path.open("wb") as audio:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.write(chunk["data"])
        voice = available[voice_name]
        samples.append(
            {
                "voice": voice_name,
                "locale": voice.get("Locale", ""),
                "gender": voice.get("Gender", ""),
                "text": args.text,
                "rate": args.rate,
                "pitch": args.pitch,
                "audio": f"/.local/assets/voice-preview/{audio_path.name}",
            }
        )

    manifest = {
        "text": args.text,
        "rate": args.rate,
        "pitch": args.pitch,
        "samples": samples,
    }
    manifest_path = PREVIEW_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Created: {manifest_path}")
    print("Open: http://127.0.0.1:8765/tools/voices.html")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("--json", action="store_true")
    list_parser.set_defaults(func=list_voices)

    preview_parser = subparsers.add_parser("preview")
    preview_parser.add_argument("--voice", action="append", help="Voice ShortName. Can be repeated.")
    preview_parser.add_argument("--text", default=DEFAULT_TEXT)
    preview_parser.add_argument("--rate", default="+12%")
    preview_parser.add_argument("--pitch", default="+0Hz")
    preview_parser.set_defaults(func=build_preview)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    asyncio.run(args.func(args))


if __name__ == "__main__":
    main()
