#!/usr/bin/env python3
"""Build an estimated timeline and silent narration for offline layout preview."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

try:
    from .build_tts import group_words
    from .factory import load_scenes, project_paths
    from .toolchain import ffmpeg_executable
except ImportError:  # Direct script execution: python pipeline/build_offline_preview.py
    from build_tts import group_words
    from factory import load_scenes, project_paths
    from toolchain import ffmpeg_executable


SPOKEN_TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|[\u3400-\u9fff]")


def estimated_word_boundaries(text: str, duration: float) -> list[dict]:
    tokens = [match.group(0) for match in SPOKEN_TOKEN_RE.finditer(text)]
    if not tokens:
        return [{"start": 0.0, "end": duration, "text": text}]
    step = duration / len(tokens)
    return [
        {
            "start": index * step,
            "end": min(duration, (index + 1) * step),
            "text": token,
        }
        for index, token in enumerate(tokens)
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    args = parser.parse_args()

    paths = project_paths(Path(args.source) if args.source else None)
    assets = paths.generated
    scenes = load_scenes(paths.root)
    timeline_scenes = []
    cues = []
    cursor = 0.0

    for index, scene in enumerate(scenes):
        duration = max(8, min(27, len(scene["narration"]) / 6.5))
        timeline_scenes.append({**scene, "start": round(cursor, 3), "duration": round(duration, 3)})
        words = estimated_word_boundaries(scene["narration"], duration)
        cues.extend(group_words(words, scene["id"], cursor, scene["narration"]))
        cursor += duration + (0 if index == len(scenes) - 1 else 0.28)

    assets.mkdir(parents=True, exist_ok=True)
    (assets / "timeline.json").write_text(
        json.dumps(
            {
                "duration": round(cursor, 3),
                "estimated": True,
                "scenes": timeline_scenes,
                "cues": cues,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    subprocess.run(
        [
            ffmpeg_executable(),
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=24000:cl=mono",
            "-t",
            str(cursor),
            "-q:a",
            "9",
            str(assets / "narration.mp3"),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"Offline timeline created: {cursor:.2f}s (silent audio)")


if __name__ == "__main__":
    main()
