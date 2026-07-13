#!/usr/bin/env python3
"""Build an estimated timeline and silent narration for offline layout preview."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

from factory import CURRENT_ASSETS, load_scenes, load_source, persist_current_assets
from toolchain import ffmpeg_executable


BREAK_RE = re.compile(r".{1,22}?[\u3002\uff01\uff1f\uff1b\uff0c\u3001\uff1a]|.{1,22}$")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--theme", default="default")
    args = parser.parse_args()

    if args.source:
        load_source(Path(args.source), args.theme)

    scenes = load_scenes()
    timeline_scenes = []
    cues = []
    cursor = 0.0

    for index, scene in enumerate(scenes):
        duration = max(8, min(27, len(scene["narration"]) / 6.5))
        timeline_scenes.append({**scene, "start": round(cursor, 3), "duration": round(duration, 3)})
        chunks = BREAK_RE.findall(scene["narration"]) or [scene["narration"]]
        cue_duration = duration / len(chunks)
        for cue_index, text in enumerate(chunks):
            cues.append(
                {
                    "start": round(cursor + cue_index * cue_duration, 3),
                    "end": round(cursor + (cue_index + 1) * cue_duration - 0.08, 3),
                    "text": text.strip(),
                    "scene_id": scene["id"],
                }
            )
        cursor += duration + (0 if index == len(scenes) - 1 else 0.28)

    CURRENT_ASSETS.mkdir(parents=True, exist_ok=True)
    (CURRENT_ASSETS / "timeline.json").write_text(
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
            str(CURRENT_ASSETS / "narration.mp3"),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    persist_current_assets()
    print(f"Offline timeline created: {cursor:.2f}s (silent audio)")


if __name__ == "__main__":
    main()
