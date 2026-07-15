#!/usr/bin/env python3
"""Validate a loaded or provided video source folder and render shell."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

try:
    from .factory import CURRENT_SOURCE, SHELL, ensure_shell, load_source
except ImportError:  # Direct script execution: python pipeline/validate_sources.py
    from factory import CURRENT_SOURCE, SHELL, ensure_shell, load_source


ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
FORBIDDEN_BODY_MARKERS = {
    "topbar": "body.html must not include template chrome such as headers",
    "transport": "body.html must not include playback controls",
    "playbutton": "body.html must not include playback controls",
    "scrubber": "body.html must not include playback controls",
    "progress-line": "body.html must not draw per-scene progress bars; the shell owns the chapter rail",
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
    stripped_body = body_lower.lstrip("\ufeff \t\r\n")
    required_document_markers = ["<html", "<head", "</head>", "<body", "</body>", "</html>"]
    if not stripped_body.startswith("<!doctype html>") or any(
        marker not in body_lower for marker in required_document_markers
    ):
        fail(
            "body.html must be a complete HTML document from <!doctype html> through </html>; "
            "do not return a <style>/<section> fragment or omit closing tags"
        )
    for marker, message in FORBIDDEN_BODY_MARKERS.items():
        if marker in body_lower:
            fail(message)
    if "<style" not in body_lower:
        fail("body.html must include its project styling in a <style> element")

    script_tags = list(re.finditer(r"<script\b([^>]*)>([\s\S]*?)</script\s*>", body, re.IGNORECASE))
    if len(script_tags) > 1:
        fail("body.html may include at most one deterministic module script")
    if script_tags:
        attributes, scripts = script_tags[0].groups()
        if not re.search(r"\btype\s*=\s*(['\"])module\1", attributes, re.IGNORECASE):
            fail("the optional body.html script must use type=\"module\"")
        if re.search(r"\bsrc\s*=", attributes, re.IGNORECASE):
            fail("keep the optional module inline in body.html; import pinned dependencies from inside it")
        validate_visual_source(scripts)
        validate_embedded_visual_contract(scripts)
        if not has_embedded_visual(body):
            fail("the optional body.html module must export mount() and renderAtTime()")

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


def validate_shell() -> None:
    shell = ensure_shell()
    index_source = (shell / "index.html").read_text(encoding="utf-8")
    runtime = SHELL / "runtime.js"
    if "runtime.js" not in index_source:
        fail("shell index.html must load runtime.js")
    if "shell.css" not in index_source:
        fail("shell index.html must load shell.css")
    source = runtime.read_text(encoding="utf-8")
    required = [
        "compositionReady",
        "getCompositionDuration",
        "renderAtTime",
        "startCompositionPlayback",
    ]
    for name in required:
        if name not in source:
            fail(f"shell runtime is missing {name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source")
    args = parser.parse_args()

    if args.source:
        load_source(Path(args.source))

    scenes_file = CURRENT_SOURCE / "scenes.json"
    body_file = CURRENT_SOURCE / "body.html"
    captions_file = CURRENT_SOURCE / "captions.json"
    scenes = validate_scenes(scenes_file)
    validate_body(body_file, scenes)
    validate_captions(captions_file)
    validate_shell()
    chars = sum(len(scene["narration"]) for scene in scenes)
    print(f"Source validation passed: {len(scenes)} scenes, {chars} narration characters")


if __name__ == "__main__":
    main()
