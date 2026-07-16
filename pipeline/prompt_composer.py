#!/usr/bin/env python3
"""Compose the canonical Web AI two-file source-generation prompt."""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

try:
    from .factory import ASPECT_RATIOS, DEFAULT_ASPECT_RATIO, normalize_aspect_ratio
except ImportError:  # Direct script execution: python pipeline/prompt_composer.py
    from factory import ASPECT_RATIOS, DEFAULT_ASPECT_RATIO, normalize_aspect_ratio


ROOT = Path(__file__).resolve().parents[1]
PROMPT_TEMPLATE = ROOT / "docs" / "source-prompt.md"
LANGUAGE_LABELS = {
    "zh-CN": "Use Simplified Chinese for narration and all visible explanatory text.",
    "en-US": "Use natural US English for narration and all visible explanatory text.",
}


def detect_language(text: str, fallback: str = "zh-CN") -> str:
    value = str(text or "")
    han = len(re.findall(r"[\u3400-\u9fff]", value))
    latin = len(re.findall(r"[A-Za-z]", value))
    if han >= 2 and han >= latin * 0.08:
        return "zh-CN"
    if latin >= 4:
        return "en-US"
    return fallback


def compose_prompt(payload: dict[str, Any]) -> dict[str, str]:
    if "target" in payload:
        raise ValueError("target is not supported; prompts are always generated for Web AI")
    requested_language = str(payload.get("language") or "auto")
    inference_text = " ".join(str(payload.get(key) or "") for key in ["topic", "audience", "notes"])
    language = detect_language(inference_text) if requested_language == "auto" else requested_language
    if language not in LANGUAGE_LABELS:
        raise ValueError("language must be auto, zh-CN, or en-US")

    aspect_ratio = normalize_aspect_ratio(payload.get("aspectRatio"))
    aspect_instruction = {
        "16:9": (
            "Create a 16:9 landscape video canvas. Use presentation-friendly horizontal "
            "compositions and compact chapter categories."
        ),
        "9:16": (
            "Create a 9:16 portrait video canvas. Prefer a single vertical reading flow, avoid "
            "wide multi-column layouts, and keep each scene category to 2-3 CJK characters or "
            "one short English word of at most 8 letters so the one-line chapter rail stays legible."
        ),
    }[aspect_ratio]

    replacements = {
        "{{TOPIC}}": str(payload.get("topic") or "<Describe the video topic>"),
        "{{AUDIENCE}}": str(payload.get("audience") or "General audience"),
        "{{TONE}}": str(payload.get("tone") or "Clear and concise"),
        "{{SCENE_COUNT}}": str(payload.get("sceneCount") or "5"),
        "{{LANGUAGE_INSTRUCTION}}": LANGUAGE_LABELS[language],
        "{{ASPECT_RATIO}}": aspect_ratio,
        "{{ASPECT_RATIO_INSTRUCTION}}": aspect_instruction,
        "{{NOTES}}": str(payload.get("notes") or "None"),
    }
    prompt = PROMPT_TEMPLATE.read_text(encoding="utf-8")
    for marker, value in replacements.items():
        prompt = prompt.replace(marker, value)

    return {
        "prompt": f"{prompt.strip()}\n",
        "language": language,
        "aspectRatio": aspect_ratio,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compose a Web AI two-file HTML slide-video source prompt.")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--audience", default="")
    parser.add_argument("--tone", default="Clear and concise")
    parser.add_argument("--scene-count", default="5")
    parser.add_argument("--notes", default="")
    parser.add_argument("--language", choices=["auto", "zh-CN", "en-US"], default="auto")
    parser.add_argument("--aspect-ratio", choices=ASPECT_RATIOS, default=DEFAULT_ASPECT_RATIO)
    args = parser.parse_args()
    result = compose_prompt({
        "topic": args.topic,
        "audience": args.audience,
        "tone": args.tone,
        "sceneCount": args.scene_count,
        "notes": args.notes,
        "language": args.language,
        "aspectRatio": args.aspect_ratio,
    })
    print(result["prompt"], end="")


if __name__ == "__main__":
    main()
