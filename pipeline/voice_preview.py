#!/usr/bin/env python3
"""List edge-tts voices and build a local voice preview manifest."""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import edge_tts

try:
    from .factory import LOCAL
except ImportError:  # Direct script execution: python pipeline/voice_preview.py
    from factory import LOCAL

PREVIEW_DIR = LOCAL / "voice-preview"
DEFAULT_TEXT = "This is an English voice preview for comparing voices, rate, and overall delivery."
DEFAULT_VOICES = [
    "en-US-JennyNeural",
    "en-US-GuyNeural",
    "en-US-AriaNeural",
    "en-US-DavisNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
]


def slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")


async def english_voices() -> list[dict]:
    voices = await edge_tts.list_voices()
    return sorted(
        [voice for voice in voices if voice.get("ShortName", "").startswith("en-")],
        key=lambda voice: voice.get("ShortName", ""),
    )


def voice_label(voice: dict) -> str:
    gender = voice.get("Gender", "")
    locale = voice.get("Locale", "")
    short_name = voice.get("ShortName", "")
    return " / ".join(part for part in [short_name, locale, gender] if part)


async def list_voices(args: argparse.Namespace) -> None:
    voices = await english_voices()
    if args.json:
        print(json.dumps(voices, ensure_ascii=False, indent=2))
        return
    for voice in voices:
        print(voice_label(voice))


async def build_preview(args: argparse.Namespace) -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    print("voice-preview: loading edge-tts voice catalog", flush=True)
    available = {voice["ShortName"]: voice for voice in await english_voices()}
    selected = args.voice or DEFAULT_VOICES
    missing = [voice for voice in selected if voice not in available]
    if missing:
        raise SystemExit(f"Unknown edge-tts voice: {', '.join(missing)}")

    previous_manifest_path = PREVIEW_DIR / "manifest.json"
    try:
        previous_manifest = json.loads(previous_manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        previous_manifest = {}

    samples = []
    created_at = datetime.now(timezone.utc)
    stamp = created_at.strftime("%Y%m%d-%H%M%S-%f")
    for voice_name in selected:
        audio_path = PREVIEW_DIR / f"{slug(voice_name)}-{stamp}.mp3"
        print(f"voice-preview: generating {voice_name}", flush=True)
        temp_path = audio_path.with_suffix(".mp3.part")
        for attempt in range(1, 4):
            try:
                communicate = edge_tts.Communicate(
                    args.text,
                    voice=voice_name,
                    rate=args.rate,
                    pitch=args.pitch,
                    boundary="WordBoundary",
                )
                with temp_path.open("wb") as audio:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            audio.write(chunk["data"])
                if not temp_path.exists() or temp_path.stat().st_size == 0:
                    raise RuntimeError("edge-tts returned an empty audio stream")
                temp_path.replace(audio_path)
                break
            except Exception:  # noqa: BLE001 - retry transient edge-tts/network failures.
                temp_path.unlink(missing_ok=True)
                if attempt >= 3:
                    raise
                print(f"voice-preview: attempt {attempt} failed, retrying", flush=True)
                await asyncio.sleep(0.8 * attempt)
        voice = available[voice_name]
        samples.append(
            {
                "id": f"{slug(voice_name)}-{stamp}",
                "voice": voice_name,
                "locale": voice.get("Locale", ""),
                "gender": voice.get("Gender", ""),
                "text": args.text,
                "rate": args.rate,
                "pitch": args.pitch,
                "audio": f"/.local/voice-preview/{audio_path.name}",
                "createdAt": created_at.isoformat(),
            }
        )
        print(f"voice-preview: saved {audio_path.name}", flush=True)

    previous_history = previous_manifest.get("history")
    if not isinstance(previous_history, list):
        previous_history = previous_manifest.get("samples", [])
    candidates = [*samples, *[item for item in previous_history if isinstance(item, dict)]]
    seen: set[str] = set()
    history = []
    for item in candidates:
        audio = item.get("audio")
        if not isinstance(audio, str) or not audio or audio in seen:
            continue
        seen.add(audio)
        history.append(item)
        if len(history) >= 20:
            break

    manifest = {
        "text": args.text,
        "rate": args.rate,
        "pitch": args.pitch,
        "samples": samples,
        "history": history,
        "updatedAt": created_at.isoformat(),
    }
    manifest_path = PREVIEW_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"voice-preview: manifest updated {manifest_path}", flush=True)
    print("voice-preview: complete", flush=True)


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
