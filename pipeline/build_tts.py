#!/usr/bin/env python3
"""Generate edge-tts audio, WordBoundary caption timing, and one narration MP3."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import subprocess
from pathlib import Path

import edge_tts

try:
    from .factory import CURRENT_ASSETS, load_scenes, load_source, persist_current_assets
    from .toolchain import ffmpeg_executable, media_duration
except ImportError:  # Direct script execution: python pipeline/build_tts.py
    from factory import CURRENT_ASSETS, load_scenes, load_source, persist_current_assets
    from toolchain import ffmpeg_executable, media_duration


SCENE_AUDIO = CURRENT_ASSETS / "scenes"
TICKS = 10_000_000
HARD_BREAK_RE = re.compile(r"[\u3002\uff01\uff1f\uff1b.!?;][\u201d\u2019\"'\uff09\u3011\u300b]*\s*$")
SOFT_BREAK_RE = re.compile(r"[\uff0c\u3001\uff1a,:][\u201d\u2019\"'\uff09\u3011\u300b]*\s*$")
LEADING_DEPENDENT_RE = re.compile(r"^[\s\u201c\u2018\"']*(?:\u7684|\u4e86|\u7740|\u8fc7|\u548c|\u4e0e|\u53ca|\u6216|\u800c|\u4f46|\u5e76)")
CONNECTOR_WORD_RE = re.compile(r"^(?:\u548c|\u4e0e|\u53ca|\u6216|\u800c|\u4f46|\u5e76|and|or|but)$", re.IGNORECASE)
TARGET_CAPTION_UNITS = 18.0
MAX_CAPTION_UNITS = 26.0
ABSOLUTE_CAPTION_UNITS = 36.0
MIN_TAIL_UNITS = 7.0
MAX_CAPTION_SECONDS = 3.6
ABSOLUTE_CAPTION_SECONDS = 5.2


def audio_duration(path: Path) -> float:
    return media_duration(path)


def text_hash(text: str, voice: str, rate: str, pitch: str, boundary: str) -> str:
    return hashlib.sha256(f"{voice}|{rate}|{pitch}|{boundary}|{text}".encode()).hexdigest()[:16]


def validate_scenes(scenes: list[dict]) -> None:
    if not isinstance(scenes, list) or not scenes:
        raise SystemExit("scenes.json must be a non-empty JSON array")
    for index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict) or not scene.get("id") or not scene.get("narration"):
            raise SystemExit(f"scene {index} must include id and narration")


def caption_units(text: str) -> float:
    """Approximate rendered width in CJK-character units."""
    units = 0.0
    for char in text.strip():
        if char.isspace():
            units += 0.3
        elif char.isascii() and (char.isalnum() or char in "-_/"):
            units += 0.55
        elif char.isascii():
            units += 0.45
        else:
            units += 1.0
    return units


def source_word_pieces(words: list[dict], narration: str) -> list[dict]:
    """Attach original spaces and punctuation to Edge WordBoundary items."""
    positions: list[int] = []
    cursor = 0
    folded_narration = narration.casefold()
    for word in words:
        raw = str(word.get("text") or "")
        position = narration.find(raw, cursor)
        if position < 0:
            position = folded_narration.find(raw.casefold(), cursor)
        if position < 0:
            # Provider-normalized text is not always a source substring. Keep
            # timing usable and fall back to readable spacing in that case.
            fallback: list[dict] = []
            previous = ""
            for item in words:
                value = str(item.get("text") or "")
                separator = " " if previous[-1:].isascii() and value[:1].isascii() else ""
                fallback.append({**item, "display_text": separator + value})
                previous = value
            return fallback
        positions.append(position)
        cursor = position + len(raw)

    prepared = []
    for index, word in enumerate(words):
        start = 0 if index == 0 else positions[index]
        end = positions[index + 1] if index + 1 < len(words) else len(narration)
        prepared.append({**word, "display_text": narration[start:end]})
    return prepared


def group_text(group: list[dict]) -> str:
    return "".join(str(item.get("display_text") or item.get("text") or "") for item in group).strip()


def group_words(words: list[dict], scene_id: str, scene_start: float, narration: str) -> list[dict]:
    prepared = source_word_pieces(words, narration)
    groups: list[list[dict]] = []
    group: list[dict] = []
    protect_phrase = False

    for index, word in enumerate(prepared):
        raw_word = str(word.get("text") or "").strip()
        if group and CONNECTOR_WORD_RE.fullmatch(raw_word):
            current_units = caption_units(group_text(group))
            current_duration = float(group[-1]["end"]) - float(group[0]["start"])
            if current_units >= TARGET_CAPTION_UNITS or current_duration >= 3.2:
                groups.append(group)
                group = []
                protect_phrase = False

        group.append(word)
        text = group_text(group)
        duration = float(group[-1]["end"]) - float(group[0]["start"])
        units = caption_units(text)
        hard_break = bool(HARD_BREAK_RE.search(text))
        soft_break = bool(SOFT_BREAK_RE.search(text)) and (units >= 8 or duration >= 1.5)
        size_break = units >= MAX_CAPTION_UNITS or duration >= MAX_CAPTION_SECONDS
        should_break = hard_break or soft_break or size_break

        if size_break and index + 1 < len(prepared) and not hard_break:
            remaining_text = group_text(prepared[index + 1 :])
            if LEADING_DEPENDENT_RE.search(remaining_text):
                protect_phrase = True
            combined_units = caption_units(text + remaining_text)
            combined_duration = float(prepared[-1]["end"]) - float(group[0]["start"])
            if caption_units(remaining_text) <= MIN_TAIL_UNITS and combined_units <= ABSOLUTE_CAPTION_UNITS and combined_duration <= ABSOLUTE_CAPTION_SECONDS:
                protect_phrase = True

        if protect_phrase and not hard_break:
            if units < ABSOLUTE_CAPTION_UNITS and duration < ABSOLUTE_CAPTION_SECONDS:
                should_break = False

        if should_break:
            groups.append(group)
            group = []
            protect_phrase = False

    if group:
        groups.append(group)

    if len(groups) > 1:
        tail = groups[-1]
        previous = groups[-2]
        previous_text = group_text(previous)
        combined = previous + tail
        combined_duration = float(combined[-1]["end"]) - float(combined[0]["start"])
        if (
            caption_units(group_text(tail)) <= MIN_TAIL_UNITS
            and not HARD_BREAK_RE.search(previous_text)
            and caption_units(group_text(combined)) <= ABSOLUTE_CAPTION_UNITS
            and combined_duration <= ABSOLUTE_CAPTION_SECONDS
        ):
            groups[-2:] = [combined]

    return [
        {
            "start": scene_start + float(group[0]["start"]),
            "end": scene_start + float(group[-1]["end"]),
            "text": group_text(group),
            "scene_id": scene_id,
        }
        for group in groups
        if group_text(group)
    ]


async def synth_scene(scene: dict, voice: str, rate: str, pitch: str, force: bool) -> tuple[Path, list[dict]]:
    SCENE_AUDIO.mkdir(parents=True, exist_ok=True)
    audio_path = SCENE_AUDIO / f"{scene['id']}.mp3"
    temp_audio_path = SCENE_AUDIO / f"{scene['id']}.mp3.part"
    meta_path = SCENE_AUDIO / f"{scene['id']}.words.json"
    stamp_path = SCENE_AUDIO / f"{scene['id']}.build.json"
    boundary = "WordBoundary"
    build_hash = text_hash(scene["narration"], voice, rate, pitch, boundary)

    if not force and audio_path.exists() and meta_path.exists() and stamp_path.exists():
        stamp = json.loads(stamp_path.read_text(encoding="utf-8"))
        words = json.loads(meta_path.read_text(encoding="utf-8"))
        if stamp.get("hash") == build_hash and stamp.get("boundary") == boundary and words:
            return audio_path, words

    words: list[dict] = []
    temp_audio_path.unlink(missing_ok=True)
    try:
        communicate = edge_tts.Communicate(
            scene["narration"],
            voice=voice,
            rate=rate,
            pitch=pitch,
            boundary=boundary,
        )
        with temp_audio_path.open("wb") as audio:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = chunk["offset"] / TICKS
                    duration = chunk["duration"] / TICKS
                    words.append({"start": start, "end": start + duration, "text": chunk["text"]})

        if not temp_audio_path.exists() or temp_audio_path.stat().st_size == 0:
            raise RuntimeError("edge-tts returned an empty audio stream")
        if not words:
            raise RuntimeError("edge-tts returned no WordBoundary metadata")
        audio_duration(temp_audio_path)
        temp_audio_path.replace(audio_path)
    except Exception as exc:  # noqa: BLE001 - add scene and voice context to provider failures.
        temp_audio_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"edge-tts failed for scene {scene['id']!r} with voice {voice!r}: {exc}"
        ) from exc

    meta_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    stamp_path.write_text(
        json.dumps(
            {
                "hash": build_hash,
                "voice": voice,
                "rate": rate,
                "pitch": pitch,
                "boundary": boundary,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return audio_path, words


def write_gap_audio(path: Path, duration: float) -> None:
    subprocess.run(
        [
            ffmpeg_executable(),
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=24000:cl=mono",
            "-t",
            str(duration),
            "-q:a",
            "9",
            str(path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


async def main_async(args: argparse.Namespace) -> None:
    if args.source:
        load_source(Path(args.source))

    scenes = load_scenes()
    validate_scenes(scenes)
    CURRENT_ASSETS.mkdir(parents=True, exist_ok=True)
    SCENE_AUDIO.mkdir(parents=True, exist_ok=True)

    timeline_scenes: list[dict] = []
    all_cues: list[dict] = []
    concat: list[str] = []
    cursor = 0.0

    for index, scene in enumerate(scenes, 1):
        print(f"[{index:02d}/{len(scenes):02d}] {scene['id']}")
        audio_path, words = await synth_scene(scene, args.voice, args.rate, args.pitch, args.force)
        duration = audio_duration(audio_path)
        timeline_scenes.append({**scene, "start": round(cursor, 3), "duration": round(duration, 3)})
        all_cues.extend(group_words(words, scene["id"], cursor, scene["narration"]))
        concat.append(f"file '{audio_path.as_posix()}'")

        if index != len(scenes):
            silence = SCENE_AUDIO / f"gap-{index:02d}.mp3"
            write_gap_audio(silence, args.gap)
            concat.append(f"file '{silence.as_posix()}'")
            cursor += duration + args.gap
        else:
            cursor += duration

    concat_file = CURRENT_ASSETS / "concat.txt"
    concat_file.write_text("\n".join(concat), encoding="utf-8")
    narration = CURRENT_ASSETS / "narration.mp3"
    subprocess.run(
        [ffmpeg_executable(), "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c:a", "libmp3lame", "-q:a", "2", str(narration)],
        check=True,
    )
    timeline = {
        "duration": round(audio_duration(narration), 3),
        "voice": args.voice,
        "rate": args.rate,
        "pitch": args.pitch,
        "scenes": timeline_scenes,
        "cues": all_cues,
    }
    (CURRENT_ASSETS / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    persist_current_assets()
    print(f"\nCreated: {narration}\nCreated: {CURRENT_ASSETS / 'timeline.json'}\nDuration: {timeline['duration']:.2f}s")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--voice", default="en-US-JennyNeural")
    parser.add_argument("--rate", default="+12%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--gap", type=float, default=0.28)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
