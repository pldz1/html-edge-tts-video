#!/usr/bin/env python3
"""Editable caption source helpers for the current factory workspace."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from .factory import STARTER_SOURCE, active_source_root, ensure_current, load_scenes, project_paths
except ImportError:  # Direct script execution: python pipeline/captions.py
    from factory import STARTER_SOURCE, active_source_root, ensure_current, load_scenes, project_paths


KIND = "html-edge-tts-captions"
VERSION = 1
LEGACY_TIME_EPSILON = 0.05
TIME_EPSILON = 0.002


def cue_id(index: int) -> str:
    return f"cue-{index + 1:04d}"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def timeline_path() -> Path:
    return project_paths().generated / "timeline.json"


def captions_path() -> Path:
    return project_paths().captions


def source_captions_path() -> Path | None:
    """Return the authored captions path for the loaded project, when available."""
    source_root = active_source_root()
    if not source_root.exists() or not source_root.is_dir():
        return None
    return source_root / "captions.json"


def caption_storage_paths() -> list[Path]:
    """List the direct authored caption target."""
    paths = [path for path in [source_captions_path(), captions_path()] if path is not None]
    unique: list[Path] = []
    for path in paths:
        if not any(path.resolve() == saved.resolve() for saved in unique):
            unique.append(path)
    return unique


def load_timeline() -> dict:
    path = timeline_path()
    if not path.exists():
        raise SystemExit("timeline.json is missing; run python main.py tts --source <folder> first")
    timeline = read_json(path)
    if not isinstance(timeline, dict) or not isinstance(timeline.get("cues"), list):
        raise SystemExit("timeline.json must contain a cues array")
    if not timeline_matches_source(timeline):
        raise SystemExit("timeline/audio do not match current scenes; rerun python main.py tts --source <folder>")
    return timeline


def timeline_matches_source(timeline: dict) -> bool:
    source_signature = [(scene.get("id"), scene.get("narration")) for scene in load_scenes()]
    timeline_signature = [
        (scene.get("id"), scene.get("narration"))
        for scene in timeline.get("scenes", [])
        if isinstance(scene, dict)
    ]
    return source_signature == timeline_signature


def normalize_cue(raw: dict, index: int, fallback: dict | None = None) -> dict:
    fallback = fallback or {}
    return {
        "id": str(raw.get("id") or fallback.get("id") or cue_id(index)),
        "scene_id": str(raw.get("scene_id") or fallback.get("scene_id") or ""),
        "start": round(float(raw.get("start", fallback.get("start", 0))), 3),
        "end": round(float(raw.get("end", fallback.get("end", 0))), 3),
        "text": str(raw.get("text", fallback.get("text", ""))),
    }


def timeline_signature(timeline: dict) -> list[dict]:
    return [normalize_cue(cue, index) for index, cue in enumerate(timeline.get("cues", []))]


def default_doc(timeline: dict) -> dict:
    cues = [normalize_cue(cue, index) for index, cue in enumerate(timeline.get("cues", []))]
    return {
        "version": VERSION,
        "kind": KIND,
        "source": "timeline.cues",
        "timeline_signature": timeline_signature(timeline),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cues": cues,
    }


def coerce_doc(value: Any, timeline: dict, stamp_signature: bool = False) -> dict:
    raw_cues = value.get("cues") if isinstance(value, dict) else value
    if not isinstance(raw_cues, list):
        raise ValueError("captions.json must be an object with cues or a cues array")

    timeline_cues = timeline.get("cues", [])
    if len(raw_cues) != len(timeline_cues):
        raise ValueError("captions.json cue count does not match timeline.json")

    cues = []
    for index, raw in enumerate(raw_cues):
        if not isinstance(raw, dict):
            raise ValueError(f"caption cue {index + 1} must be an object")
        try:
            cues.append(normalize_cue(raw, index, normalize_cue(timeline_cues[index], index)))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"caption cue {index + 1} has invalid timing") from exc

    doc = {
        "version": VERSION,
        "kind": KIND,
        "source": "manual",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cues": cues,
    }
    signature = timeline_signature(timeline) if stamp_signature else (
        value.get("timeline_signature") if isinstance(value, dict) else None
    )
    if isinstance(signature, list):
        doc["timeline_signature"] = signature
    return doc


def cue_timing_is_valid(cue: dict, duration: float) -> bool:
    start = cue.get("start")
    end = cue.get("end")
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return False
    if not math.isfinite(start) or not math.isfinite(end):
        return False
    return start >= 0 and end > start and end <= duration + LEGACY_TIME_EPSILON


def cue_identity_matches(current: dict, generated: dict) -> bool:
    return current["id"] == generated["id"] and current["scene_id"] == generated["scene_id"]


def signature_matches_current(doc: dict, timeline: dict) -> bool:
    signature = doc.get("timeline_signature")
    if not isinstance(signature, list):
        return False

    generated_signature = timeline_signature(timeline)
    if len(signature) != len(generated_signature):
        return False

    for index, raw in enumerate(signature):
        if not isinstance(raw, dict):
            return False
        try:
            saved = normalize_cue(raw, index)
            generated = generated_signature[index]
        except (TypeError, ValueError):
            return False
        if not cue_identity_matches(saved, generated):
            return False
        if saved["text"] != generated["text"]:
            return False
        if abs(saved["start"] - generated["start"]) > TIME_EPSILON:
            return False
        if abs(saved["end"] - generated["end"]) > TIME_EPSILON:
            return False
    return True


def legacy_captions_match_timeline(doc: dict, timeline: dict) -> bool:
    cues = doc.get("cues")
    timeline_cues = timeline.get("cues")
    if not isinstance(cues, list) or not isinstance(timeline_cues, list):
        return False
    if len(cues) != len(timeline_cues):
        return False

    for index, cue in enumerate(cues):
        generated = normalize_cue(timeline_cues[index], index)
        try:
            current = normalize_cue(cue, index)
        except (TypeError, ValueError):
            return False
        if not cue_identity_matches(current, generated):
            return False
        if abs(current["start"] - generated["start"]) > LEGACY_TIME_EPSILON:
            return False
        if abs(current["end"] - generated["end"]) > LEGACY_TIME_EPSILON:
            return False
    return True


def captions_match_timeline(doc: dict, timeline: dict) -> bool:
    cues = doc.get("cues")
    timeline_cues = timeline.get("cues")
    duration = float(timeline.get("duration") or 0)
    if not isinstance(cues, list) or not isinstance(timeline_cues, list):
        return False
    if len(cues) != len(timeline_cues):
        return False

    has_signature = isinstance(doc.get("timeline_signature"), list)
    if has_signature and not signature_matches_current(doc, timeline):
        return False
    if not has_signature and not legacy_captions_match_timeline(doc, timeline):
        return False

    for index, cue in enumerate(cues):
        generated = normalize_cue(timeline_cues[index], index)
        try:
            current = normalize_cue(cue, index)
        except (TypeError, ValueError):
            return False
        if not cue_identity_matches(current, generated):
            return False
        if not cue_timing_is_valid(current, duration):
            return False
    return True


def load_effective_doc(timeline: dict | None = None) -> tuple[dict, bool]:
    ensure_current()
    timeline = timeline or load_timeline()
    paths = caption_storage_paths()
    path = next((candidate for candidate in paths if candidate.exists()), None)
    if path is None:
        return default_doc(timeline), False

    try:
        doc = coerce_doc(read_json(path), timeline)
    except (json.JSONDecodeError, TypeError, ValueError):
        return default_doc(timeline), False
    if not captions_match_timeline(doc, timeline):
        return default_doc(timeline), False
    return doc, True


def save_doc(value: Any, timeline: dict | None = None) -> dict:
    ensure_current()
    if active_source_root().resolve() == STARTER_SOURCE.resolve():
        raise ValueError("starter is read-only; activate an editable project before saving captions")
    timeline = timeline or load_timeline()
    doc = coerce_doc(value, timeline, stamp_signature=True)
    if not captions_match_timeline(doc, timeline):
        raise ValueError("captions do not match current timeline timing")

    source_path = source_captions_path()
    if source_path is None:
        raise ValueError("loaded project source folder is unavailable; reload the project before saving captions")
    targets = caption_storage_paths()

    for path in targets:
        write_json(path, doc)

    return {
        "doc": doc,
        "saved": [str(path) for path in targets],
        "sourcePath": str(source_path),
        "workspacePath": str(captions_path()),
    }
