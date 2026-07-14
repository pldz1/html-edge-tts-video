#!/usr/bin/env python3
"""Compose one source-generation prompt for Studio, agents, and web AI."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / "docs" / "prompts"
CONTENT_THEMES = ROOT / "docs" / "content-themes"
LANGUAGE_LABELS = {
    "zh-CN": "Use Simplified Chinese for titles, summaries, categories, narration, labels, and explanatory text.",
    "en-US": "Use natural US English for titles, summaries, categories, narration, labels, and explanatory text.",
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


def load_theme(theme_id: str) -> dict[str, Any]:
    theme_dir = CONTENT_THEMES / theme_id
    manifest = theme_dir / "theme.json"
    prompt = theme_dir / "prompt.md"
    body_css = theme_dir / "body.css"
    if not manifest.exists() or not prompt.exists() or not body_css.exists():
        raise ValueError(f"unknown or incomplete content theme: {theme_id}")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    data["prompt"] = prompt.read_text(encoding="utf-8").strip()
    return data


def list_content_themes(locale: str = "zh-CN") -> list[dict[str, Any]]:
    result = []
    if not CONTENT_THEMES.exists():
        return result
    for theme_dir in sorted(path for path in CONTENT_THEMES.iterdir() if path.is_dir()):
        try:
            theme = load_theme(theme_dir.name)
        except (ValueError, json.JSONDecodeError):
            continue
        label = theme.get("label") if isinstance(theme.get("label"), dict) else {}
        description = theme.get("description") if isinstance(theme.get("description"), dict) else {}
        result.append({
            "id": theme["id"],
            "label": label.get(locale) or label.get("en-US") or theme["id"],
            "description": description.get(locale) or description.get("en-US") or "",
            "labels": label,
            "descriptions": description,
            "defaultEngine": theme.get("defaultEngine", "dom"),
            "engines": theme.get("engines", ["dom"]),
        })
    return result


def compose_prompt(payload: dict[str, Any]) -> dict[str, str]:
    requested_language = str(payload.get("language") or "auto")
    inference_text = " ".join(str(payload.get(key) or "") for key in ["topic", "audience", "notes"])
    language = detect_language(inference_text) if requested_language == "auto" else requested_language
    if language not in LANGUAGE_LABELS:
        raise ValueError("language must be auto, zh-CN, or en-US")
    theme_id = str(payload.get("contentTheme") or "editorial")
    theme = load_theme(theme_id)
    engine = str(payload.get("engine") or "auto")
    if engine == "auto":
        engine = str(theme.get("defaultEngine") or "dom")
    if engine not in theme.get("engines", []):
        raise ValueError(f"content theme {theme_id!r} does not support engine {engine!r}")
    target = str(payload.get("target") or "web-ai")
    if target not in {"agent", "web-ai"}:
        raise ValueError(f"unsupported prompt target: {target}")

    replacements = {
        "{{TOPIC}}": str(payload.get("topic") or "<Describe the video topic>"),
        "{{AUDIENCE}}": str(payload.get("audience") or "<Describe the audience>"),
        "{{TONE}}": str(payload.get("tone") or "Clear and concise"),
        "{{SCENE_COUNT}}": str(payload.get("sceneCount") or "5"),
        "{{LANGUAGE_INSTRUCTION}}": LANGUAGE_LABELS.get(language, f"Use {language} consistently for all video content."),
        "{{NOTES}}": str(payload.get("notes") or "None"),
    }
    base = (PROMPTS / "base.md").read_text(encoding="utf-8")
    for marker, value in replacements.items():
        base = base.replace(marker, value)
    engine_prompt = (PROMPTS / "engines" / f"{engine}.md").read_text(encoding="utf-8").strip()
    target_prompt = (PROMPTS / "targets" / f"{target}.md").read_text(encoding="utf-8").strip()
    prompt = "\n\n".join([base.strip(), theme["prompt"], engine_prompt, target_prompt]) + "\n"
    return {"prompt": prompt, "language": language, "contentTheme": theme_id, "engine": engine, "target": target}


def main() -> None:
    parser = argparse.ArgumentParser(description="Compose a video-source generation prompt.")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--audience", default="")
    parser.add_argument("--tone", default="Clear and concise")
    parser.add_argument("--scene-count", default="5")
    parser.add_argument("--notes", default="")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--content-theme", default="editorial")
    parser.add_argument("--engine", default="auto")
    parser.add_argument("--target", choices=["agent", "web-ai"], default="agent")
    args = parser.parse_args()
    result = compose_prompt({
        "topic": args.topic,
        "audience": args.audience,
        "tone": args.tone,
        "sceneCount": args.scene_count,
        "notes": args.notes,
        "language": args.language,
        "contentTheme": args.content_theme,
        "engine": args.engine,
        "target": args.target,
    })
    print(result["prompt"], end="")


if __name__ == "__main__":
    main()
