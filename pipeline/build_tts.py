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

from factory import CURRENT_ASSETS, load_scenes, load_source


SCENE_AUDIO = CURRENT_ASSETS / "scenes"
TICKS = 10_000_000
BREAK_RE = re.compile(r"[\u3002\uff01\uff1f\uff1b\uff0c\u3001\uff1a]$")


def ffprobe_duration(path: Path) -> float:
    process = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(process.stdout.strip())


def text_hash(text: str, voice: str, rate: str, pitch: str, boundary: str) -> str:
    return hashlib.sha256(f"{voice}|{rate}|{pitch}|{boundary}|{text}".encode()).hexdigest()[:16]


def validate_scenes(scenes: list[dict]) -> None:
    if not isinstance(scenes, list) or not scenes:
        raise SystemExit("scenes.json must be a non-empty JSON array")
    for index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict) or not scene.get("id") or not scene.get("narration"):
            raise SystemExit(f"scene {index} must include id and narration")


def group_words(words: list[dict], scene_id: str, scene_start: float) -> list[dict]:
    cues: list[dict] = []
    group: list[dict] = []
    for word in words:
        group.append(word)
        text = "".join(item["text"] for item in group)
        duration = group[-1]["end"] - group[0]["start"]
        should_break = bool(BREAK_RE.search(word["text"])) or len(text) >= 18 or duration >= 3.0
        if should_break:
            cues.append(
                {
                    "start": scene_start + group[0]["start"],
                    "end": scene_start + group[-1]["end"],
                    "text": text,
                    "scene_id": scene_id,
                }
            )
            group = []
    if group:
        cues.append(
            {
                "start": scene_start + group[0]["start"],
                "end": scene_start + group[-1]["end"],
                "text": "".join(item["text"] for item in group),
                "scene_id": scene_id,
            }
        )
    return cues


async def synth_scene(scene: dict, voice: str, rate: str, pitch: str, force: bool) -> tuple[Path, list[dict]]:
    SCENE_AUDIO.mkdir(parents=True, exist_ok=True)
    audio_path = SCENE_AUDIO / f"{scene['id']}.mp3"
    meta_path = SCENE_AUDIO / f"{scene['id']}.words.json"
    stamp_path = SCENE_AUDIO / f"{scene['id']}.build.json"
    boundary = "WordBoundary"
    build_hash = text_hash(scene["narration"], voice, rate, pitch, boundary)

    if not force and audio_path.exists() and meta_path.exists() and stamp_path.exists():
        stamp = json.loads(stamp_path.read_text(encoding="utf-8"))
        words = json.loads(meta_path.read_text(encoding="utf-8"))
        if stamp.get("hash") == build_hash and stamp.get("boundary") == boundary and words:
            return audio_path, words

    communicate = edge_tts.Communicate(scene["narration"], voice=voice, rate=rate, pitch=pitch, boundary=boundary)
    words: list[dict] = []
    with audio_path.open("wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS
                duration = chunk["duration"] / TICKS
                words.append({"start": start, "end": start + duration, "text": chunk["text"]})

    if not words:
        raise RuntimeError(f"edge-tts returned no WordBoundary metadata for scene: {scene['id']}")

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
            "ffmpeg",
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
        load_source(Path(args.source), args.theme)

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
        duration = ffprobe_duration(audio_path)
        timeline_scenes.append({**scene, "start": round(cursor, 3), "duration": round(duration, 3)})
        all_cues.extend(group_words(words, scene["id"], cursor))
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
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c:a", "libmp3lame", "-q:a", "2", str(narration)],
        check=True,
    )
    timeline = {
        "duration": round(ffprobe_duration(narration), 3),
        "voice": args.voice,
        "rate": args.rate,
        "pitch": args.pitch,
        "scenes": timeline_scenes,
        "cues": all_cues,
    }
    (CURRENT_ASSETS / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nCreated: {narration}\nCreated: {CURRENT_ASSETS / 'timeline.json'}\nDuration: {timeline['duration']:.2f}s")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--theme", default="default")
    parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
    parser.add_argument("--rate", default="+12%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--gap", type=float, default=0.28)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
