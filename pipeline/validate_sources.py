#!/usr/bin/env python3
"""Validate a loaded or provided video source folder and theme runtime."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

try:
    from .factory import CURRENT_SOURCE, ensure_theme, load_source, theme_runtime
except ImportError:  # Direct script execution: python pipeline/validate_sources.py
    from factory import CURRENT_SOURCE, ensure_theme, load_source, theme_runtime


ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
FORBIDDEN_BODY_MARKERS = {
    "topbar": "body.html must not include template chrome such as headers",
    "transport": "body.html must not include playback controls",
    "playbutton": "body.html must not include playback controls",
    "scrubber": "body.html must not include playback controls",
    "progress-line": "body.html must not draw per-scene progress bars; the theme owns the chapter rail",
    "chapterrail": "body.html must not include the chapter rail; it is generated from scenes.json",
    "chapter-rail": "body.html must not include the chapter rail; it is generated from scenes.json",
}


def embedded_script_source(body: str) -> str:
    """Return inline script contents for deterministic-source checks."""
    return "\n".join(
        match.group(1)
        for match in re.finditer(r"<script\b[^>]*>([\s\S]*?)</script\s*>", body, re.IGNORECASE)
    )


def validate_visual_source(source: str, label: str = "embedded JavaScript") -> None:
    if not source.strip():
        return
    if "requestAnimationFrame" in source:
        fail(f"{label} must use renderAtTime() instead of an independent requestAnimationFrame loop")
    for url in re.findall(r"https?://[^'\"\s<]+", source):
        if "three" in url.lower() and not re.search(r"three@\d+\.\d+\.\d+", url):
            fail(f"Three.js CDN imports in {label} must pin an exact three@x.y.z version")


def validate_embedded_visual_contract(source: str) -> None:
    mentions_visual = re.search(r"\b(?:mount|renderAtTime)\b", source)
    if not mentions_visual:
        return
    exported = all(
        re.search(rf"export\s+(?:async\s+)?function\s+{name}\b", source)
        for name in ["mount", "renderAtTime"]
    )
    registered = bool(
        re.search(r"window\.(?:__videoVisual|videoVisual)\s*=", source)
        and re.search(r"\bmount\b", source)
        and re.search(r"\brenderAtTime\b", source)
    )
    if not exported and not registered:
        fail("scripted visuals in body.html must export mount() and renderAtTime()")


def has_embedded_visual(body: str) -> bool:
    scripts = embedded_script_source(body)
    return bool(re.search(r"\bmount\b", scripts) and re.search(r"\brenderAtTime\b", scripts))


def fail(message: str) -> None:
    raise SystemExit(f"source validation failed: {message}")


def validate_scenes(scenes_file: Path) -> list[dict]:
    if not scenes_file.exists():
        fail("missing scenes.json; run python main.py load --source <folder>")

    try:
        scenes = json.loads(scenes_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"scenes.json is invalid JSON: {exc}")

    if not isinstance(scenes, list) or not scenes:
        fail("scenes.json must be a non-empty JSON array")

    seen: set[str] = set()
    for index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            fail(f"scene {index} must be an object")

        scene_id = scene.get("id")
        if not isinstance(scene_id, str) or not ID_RE.match(scene_id):
            fail(f"scene {index} has invalid id {scene_id!r}; use lowercase letters, digits, and hyphens")
        if scene_id in seen:
            fail(f"duplicate scene id: {scene_id}")
        seen.add(scene_id)

        narration = scene.get("narration")
        if not isinstance(narration, str) or not narration.strip():
            fail(f"scene {scene_id} must include non-empty narration")

        category = scene.get("category")
        if not isinstance(category, str) or not category.strip():
            fail(f"scene {scene_id} must include a short category for the generated chapter rail")
        if len(category.strip()) > 12:
            fail(f"scene {scene_id} category is too long; keep it to 12 characters or fewer")

    if scenes[0]["id"] != "intro":
        fail("the first scene must use id 'intro' and introduce what the video will cover")

    return scenes


def validate_body(body_file: Path, scenes: list[dict]) -> None:
    if not body_file.exists():
        fail("missing body.html; source folders must contain scenes.json and body.html")
    body = body_file.read_text(encoding="utf-8")
    body_lower = body.lower()
    for marker, message in FORBIDDEN_BODY_MARKERS.items():
        if marker in body_lower:
            fail(message)
    scripts = embedded_script_source(body)
    validate_visual_source(scripts)
    validate_embedded_visual_contract(scripts)

    missing = [scene["id"] for scene in scenes if f'data-scene="{scene["id"]}"' not in body and f"data-scene='{scene['id']}'" not in body]
    if missing:
        fail(f"body.html is missing data-scene sections for: {', '.join(missing)}")

    card_markers = ["comparison-card", "metric-card", "diagram-node", "step-chip", "formula-token", "concept-node"]
    component_count = sum(body_lower.count(marker) for marker in card_markers)
    if component_count > len(scenes) * 8:
        print(
            f"Source quality warning: body.html contains {component_count} card-like components; "
            "prefer one dominant composition per scene."
        )


def validate_visual_js(visual_file: Path) -> None:
    if not visual_file.exists():
        return
    source = visual_file.read_text(encoding="utf-8")
    for export_name in ["mount", "renderAtTime"]:
        if not re.search(rf"export\s+(?:async\s+)?function\s+{export_name}\b", source):
            fail(f"visual.js must export {export_name}()")
    validate_visual_source(source, "visual.js")


def validate_captions(captions_file: Path) -> None:
    if not captions_file.exists():
        return
    try:
        captions = json.loads(captions_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"captions.json is invalid JSON: {exc}")

    cues = captions.get("cues") if isinstance(captions, dict) else captions
    if not isinstance(cues, list):
        fail("captions.json must be an object with a cues array or a cues array")
    for index, cue in enumerate(cues, 1):
        if not isinstance(cue, dict):
            fail(f"caption cue {index} must be an object")
        if "text" in cue and not isinstance(cue["text"], str):
            fail(f"caption cue {index} text must be a string")
        for name in ["start", "end"]:
            if name in cue and not isinstance(cue[name], (int, float)):
                fail(f"caption cue {index} {name} must be a number")


def validate_theme(theme: str) -> None:
    theme_dir = ensure_theme(theme)
    index_source = (theme_dir / "index.html").read_text(encoding="utf-8")
    runtime = theme_runtime(theme)
    if runtime.parent == theme_dir and "runtime.js" not in index_source:
        fail(f"theme {theme!r} index.html must load its runtime.js")
    if runtime.parent != theme_dir and "../default/runtime.js" not in index_source:
        fail(f"theme {theme!r} index.html must load ../default/runtime.js")
    source = runtime.read_text(encoding="utf-8")
    required = [
        "compositionReady",
        "getCompositionDuration",
        "renderAtTime",
        "startCompositionPlayback",
    ]
    for name in required:
        if name not in source:
            fail(f"theme runtime is missing {name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    parser.add_argument("--theme", default="default")
    args = parser.parse_args()

    if args.source:
        load_source(Path(args.source), args.theme)

    scenes_file = CURRENT_SOURCE / "scenes.json"
    body_file = CURRENT_SOURCE / "body.html"
    captions_file = CURRENT_SOURCE / "captions.json"
    visual_file = CURRENT_SOURCE / "visual.js"
    scenes = validate_scenes(scenes_file)
    validate_body(body_file, scenes)
    validate_captions(captions_file)
    validate_visual_js(visual_file)
    validate_theme(args.theme)
    chars = sum(len(scene["narration"]) for scene in scenes)
    print(f"Source validation passed: {len(scenes)} scenes, {chars} narration characters")


if __name__ == "__main__":
    main()
