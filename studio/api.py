#!/usr/bin/env python3
"""JSON API helpers for the local Studio web UI."""
from __future__ import annotations

import json
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from pipeline.factory import (
    CURRENT_ASSETS,
    CURRENT_META,
    CURRENT_SOURCE,
    DEFAULT_THEME,
    LOCAL_ASSETS,
    LOCAL_OUTPUT,
    LOCAL_WORK,
    PROJECT_MANIFEST_FILE,
    PROJECT_OUTPUT_DIR,
    ROOT,
    STARTER_SOURCE,
    active_source_root,
    active_theme,
    is_local_project,
    load_source,
    output_path,
    persist_current_assets,
    rel,
    resolve_source,
    slug,
    theme_url,
)
from pipeline.validate_sources import validate_body, validate_scenes, validate_theme


PYTHON = sys.executable
OUTPUT_EXTENSIONS = {".mp4", ".webm"}
JOB_LOG_LIMIT = 500
RENDER_SIZES = {"480p", "720p", "1080p", "2k", "1440p", "4k", "2160p"}
CAPTURE_MODES = {"auto", "video", "frames"}
VOICE_PREVIEW_DIR = LOCAL_ASSETS / "voice-preview"
VOICE_OPTIONS = [
    {"id": "en-US-JennyNeural", "label": "Jenny", "locale": "en-US", "gender": "Female"},
    {"id": "en-US-GuyNeural", "label": "Guy", "locale": "en-US", "gender": "Male"},
    {"id": "en-US-AriaNeural", "label": "Aria", "locale": "en-US", "gender": "Female"},
    {"id": "en-US-DavisNeural", "label": "Davis", "locale": "en-US", "gender": "Male"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia", "locale": "en-GB", "gender": "Female"},
    {"id": "en-GB-RyanNeural", "label": "Ryan", "locale": "en-GB", "gender": "Male"},
    {"id": "en-AU-NatashaNeural", "label": "Natasha", "locale": "en-AU", "gender": "Female"},
    {"id": "en-AU-WilliamNeural", "label": "William", "locale": "en-AU", "gender": "Male"},
]
DEFAULT_TTS_SETTINGS = {
    "voice": "en-US-JennyNeural",
    "rate": "+12%",
    "pitch": "+0Hz",
    "gap": "0.28",
}
PROJECT_SETTINGS_FILE = ".studio.json"
OUTPUT_INDEX_FILE = LOCAL_OUTPUT / ".studio-outputs.json"


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(message)


JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_time(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()


def read_json_file(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def read_output_index() -> dict[str, dict[str, Any]]:
    data = read_json_file(OUTPUT_INDEX_FILE)
    if not isinstance(data, dict):
        return {}
    return {
        name: entry
        for name, entry in data.items()
        if isinstance(name, str) and isinstance(entry, dict)
    }


def write_output_index(index: dict[str, dict[str, Any]]) -> None:
    LOCAL_OUTPUT.mkdir(parents=True, exist_ok=True)
    OUTPUT_INDEX_FILE.write_text(
        json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def output_record(path: Path) -> dict[str, Any]:
    relative_path = rel(path)
    return {
        "name": path.name,
        "path": str(path),
        "relativePath": relative_path,
        "url": f"/{quote(relative_path, safe='/')}",
        "size": path.stat().st_size,
        "modifiedAt": file_time(path),
        "extension": path.suffix.lower().lstrip("."),
    }


def register_output(path: Path, project_slug: str | None, project_path: str | None) -> None:
    index = read_output_index()
    index[path.name] = {
        "projectSlug": project_slug or "",
        "projectPath": project_path or "",
        "updatedAt": utc_now(),
    }
    write_output_index(index)


def output_belongs_to_project(path: Path, project_slug: str | None, project_path: str | None) -> bool:
    if not project_slug and not project_path:
        return False

    index = read_output_index()
    entry = index.get(path.name)
    if entry:
        entry_slug = str(entry.get("projectSlug") or "").strip()
        entry_path = str(entry.get("projectPath") or "").strip()
        if project_path and entry_path:
            return entry_path == project_path
        if project_slug and entry_slug:
            return entry_slug == project_slug
        return False

    # Backward-compatible fallback for older exports that used the project slug as filename.
    stem = path.stem.lower()
    slug_prefix = (project_slug or "").strip().lower()
    return bool(slug_prefix and (stem == slug_prefix or stem.startswith(f"{slug_prefix}-")))


def project_display_name(value: str) -> str:
    cleaned = re.sub(r"[-_.]+", " ", value).strip()
    return cleaned or "New video project"


def normalize_tts_settings(value: Any | None = None) -> dict[str, str]:
    data = value if isinstance(value, dict) else {}
    settings = {**DEFAULT_TTS_SETTINGS}
    settings["voice"] = str(data.get("voice") or settings["voice"]).strip()
    settings["rate"] = str(data.get("rate") or settings["rate"]).strip()
    settings["pitch"] = str(data.get("pitch") or settings["pitch"]).strip()
    settings["gap"] = str(data.get("gap") or settings["gap"]).strip()
    return settings


def new_project_id() -> str:
    while True:
        value = uuid.uuid4().hex[:8]
        if not (LOCAL_WORK / value).exists():
            return value


def project_name_from_source(source_root: Path) -> str:
    scenes = read_json_file(source_root / "scenes.json")
    if isinstance(scenes, list) and scenes and isinstance(scenes[0], dict):
        title = str(scenes[0].get("title") or "").strip()
        if title:
            return title
    return project_display_name(source_root.name)


def ensure_project_manifest(
    source_root: Path,
    *,
    name: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    manifest_path = source_root / PROJECT_MANIFEST_FILE
    existing = read_json_file(manifest_path)
    data = existing if isinstance(existing, dict) else {}
    legacy_settings = read_json_file(source_root / PROJECT_SETTINGS_FILE)
    legacy_settings = legacy_settings if isinstance(legacy_settings, dict) else {}
    current_id = str(project_id or data.get("id") or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{8}", current_id):
        folder_id = source_root.name.lower()
        if re.fullmatch(r"[0-9a-f]{8}", folder_id):
            current_id = folder_id
        elif is_local_project(source_root):
            current_id = new_project_id()
        else:
            current_id = hashlib.sha256(str(source_root.resolve()).encode("utf-8")).hexdigest()[:8]
    now = utc_now()
    manifest = {
        **data,
        "version": 1,
        "id": current_id,
        "name": str(name or data.get("name") or project_name_from_source(source_root)).strip() or "Untitled project",
        "theme": str(data.get("theme") or DEFAULT_THEME),
        "createdAt": str(data.get("createdAt") or now),
        "updatedAt": str(data.get("updatedAt") or now),
        "tts": normalize_tts_settings(data.get("tts") or legacy_settings.get("tts")),
    }
    if is_local_project(source_root):
        source_root.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        legacy_path = source_root / PROJECT_SETTINGS_FILE
        if legacy_path.exists():
            legacy_path.unlink()
    return manifest


def update_active_source_path(old_path: Path, new_path: Path) -> None:
    meta = read_json_file(CURRENT_META)
    if not isinstance(meta, dict):
        return
    source = str(meta.get("source") or "").strip()
    if not source or Path(source).resolve() != old_path.resolve():
        return
    meta["source"] = str(new_path.resolve())
    CURRENT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def migrate_local_projects() -> None:
    LOCAL_WORK.mkdir(parents=True, exist_ok=True)
    for child in list(LOCAL_WORK.iterdir()):
        if not child.is_dir() or not (child / "scenes.json").exists() or not (child / "body.html").exists():
            continue
        manifest = ensure_project_manifest(child)
        target = LOCAL_WORK / manifest["id"]
        if child.resolve() == target.resolve():
            continue
        if target.exists():
            manifest = ensure_project_manifest(child, project_id=new_project_id())
            target = LOCAL_WORK / manifest["id"]
        old_path = child.resolve()
        child.rename(target)
        update_active_source_path(old_path, target.resolve())
        active = active_source_root()
        if active and active.resolve() == target.resolve():
            persist_current_assets(target)


def read_project_settings(source_root: Path) -> dict[str, Any]:
    manifest = ensure_project_manifest(source_root)
    return {"tts": normalize_tts_settings(manifest.get("tts"))}


def write_project_settings(source_root: Path, settings: dict[str, Any]) -> None:
    manifest = ensure_project_manifest(source_root)
    if "tts" in settings:
        manifest["tts"] = normalize_tts_settings(settings["tts"])
    manifest["updatedAt"] = utc_now()
    if is_local_project(source_root):
        (source_root / PROJECT_MANIFEST_FILE).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def active_source_settings() -> dict[str, Any]:
    source = active_source_root()
    if not source:
        return {"tts": normalize_tts_settings()}
    return read_project_settings(source)


def safe_project_path(value: str) -> Path:
    migrate_local_projects()
    project_id = str(value or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{8}", project_id):
        raise ApiError(400, "project id must be 8 hexadecimal characters")
    path = (LOCAL_WORK / project_id).resolve()
    return path


def source_summary(source_root: Path) -> dict[str, Any]:
    resolved = resolve_source(source_root)
    manifest = ensure_project_manifest(resolved["root"])
    scenes = read_json_file(resolved["scenes"]) or []
    scene_count = len(scenes) if isinstance(scenes, list) else 0
    narration_chars = 0
    title = str(manifest["name"])
    if isinstance(scenes, list) and scenes:
        narration_chars = sum(
            len(scene.get("narration", ""))
            for scene in scenes
            if isinstance(scene, dict) and isinstance(scene.get("narration"), str)
        )
    updated_at = max(resolved["scenes"].stat().st_mtime, resolved["body"].stat().st_mtime)
    active = active_source_root()
    return {
        "id": manifest["id"],
        "name": title,
        "title": title,
        "path": str(resolved["root"]),
        "relativePath": rel(resolved["root"]),
        "sceneCount": scene_count,
        "narrationChars": narration_chars,
        "updatedAt": datetime.fromtimestamp(updated_at, timezone.utc).isoformat(),
        "hasCaptions": bool(resolved["captions"]),
        "hasMedia": bool(resolved["media"]),
        "settings": read_project_settings(resolved["root"]),
        "active": bool(active and active.resolve() == resolved["root"].resolve()),
    }


def list_projects() -> list[dict[str, Any]]:
    migrate_local_projects()
    projects = []
    for child in sorted(LOCAL_WORK.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir():
            continue
        try:
            projects.append(source_summary(child))
        except SystemExit:
            continue
    return projects


def list_outputs(limit: int | None = None, project_slug: str | None = None, project_path: str | None = None) -> list[dict[str, Any]]:
    LOCAL_OUTPUT.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    if project_path:
        project_outputs = Path(project_path) / PROJECT_OUTPUT_DIR
        if project_outputs.exists():
            files.extend(
                item for item in project_outputs.iterdir()
                if item.is_file() and item.suffix.lower() in OUTPUT_EXTENSIONS
            )
    legacy_files = [
        item
        for item in LOCAL_OUTPUT.iterdir()
        if item.is_file() and item.suffix.lower() in OUTPUT_EXTENSIONS
    ]
    if project_slug or project_path:
        legacy_files = [item for item in legacy_files if output_belongs_to_project(item, project_slug, project_path)]
    files.extend(legacy_files)
    files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    if limit:
        files = files[:limit]
    return [output_record(item) for item in files]


def current_scenes_summary() -> dict[str, Any]:
    scenes_path = CURRENT_SOURCE / "scenes.json"
    body_path = CURRENT_SOURCE / "body.html"
    scenes = read_json_file(scenes_path) if scenes_path.exists() else None
    scene_count = len(scenes) if isinstance(scenes, list) else 0
    narration_chars = 0
    title = ""
    if isinstance(scenes, list) and scenes:
        first = scenes[0]
        if isinstance(first, dict):
            title = str(first.get("title") or "")
        narration_chars = sum(
            len(scene.get("narration", ""))
            for scene in scenes
            if isinstance(scene, dict) and isinstance(scene.get("narration"), str)
        )
    source = active_source_root()
    if source:
        manifest = ensure_project_manifest(source)
        title = str(manifest.get("name") or title)
    return {
        "hasSource": scenes_path.exists() and body_path.exists(),
        "sceneCount": scene_count,
        "narrationChars": narration_chars,
        "title": title,
    }


def timeline_summary() -> dict[str, Any]:
    timeline_path = CURRENT_ASSETS / "timeline.json"
    narration_path = CURRENT_ASSETS / "narration.mp3"
    result: dict[str, Any] = {
        "exists": timeline_path.exists(),
        "hasNarration": narration_path.exists(),
        "matchesSource": False,
        "duration": None,
        "error": None,
    }
    if not timeline_path.exists():
        return result

    timeline = read_json_file(timeline_path)
    if not isinstance(timeline, dict):
        result["error"] = "timeline.json is invalid"
        return result

    source_scenes = read_json_file(CURRENT_SOURCE / "scenes.json")
    source_signature = [
        (scene.get("id"), scene.get("narration"))
        for scene in source_scenes
        if isinstance(scene, dict)
    ] if isinstance(source_scenes, list) else []
    timeline_signature = [
        (scene.get("id"), scene.get("narration"))
        for scene in timeline.get("scenes", [])
        if isinstance(scene, dict)
    ]
    result["matchesSource"] = bool(source_signature and source_signature == timeline_signature)
    result["duration"] = timeline.get("duration")
    if not result["matchesSource"]:
        result["error"] = "timeline/audio do not match current scenes"
    return result


def active_project_meta() -> dict[str, Any] | None:
    source = active_source_root()
    meta = read_json_file(CURRENT_META) if CURRENT_META.exists() else {}
    if not source:
        return None
    manifest = ensure_project_manifest(source)
    return {
        "id": manifest["id"],
        "name": manifest["name"],
        "path": str(source),
        "relativePath": rel(source),
        "theme": active_theme(),
        "settings": read_project_settings(source),
        "loadedAt": meta.get("loaded_at") if isinstance(meta, dict) else None,
    }


def guide_state(state: dict[str, Any]) -> dict[str, str]:
    has_projects = bool(state["projectCount"])
    has_source = bool(state["current"]["hasSource"])
    timeline = state["timeline"]
    has_ready_timeline = bool(timeline["exists"] and timeline["hasNarration"] and timeline["matchesSource"])
    has_outputs = bool(state["outputs"])
    if not has_projects and not has_source:
        return {
            "stage": "create",
            "title": "Create a video source first",
            "body": "Fill in the prompt, use a web AI to generate scenes.json and body.html, then paste them here to save a local project.",
        }
    if not has_source:
        return {
            "stage": "load",
            "title": "Choose a local project",
            "body": "Load source files from the project list. Studio will place them in the current factory workspace.",
        }
    if not has_ready_timeline:
        return {
            "stage": "build",
            "title": "Generate TTS and the timeline next",
            "body": "The current source is loaded. Run Check first, then TTS or Silent Preview.",
        }
    if not has_outputs:
        return {
            "stage": "preview",
            "title": "Ready to preview and render",
            "body": "The timeline and narration are ready. Review the visuals, then edit captions or render an MP4.",
        }
    return {
        "stage": "done",
        "title": "A rendered result is ready to view",
        "body": "You can continue iterating on the source files or play the latest finished video directly from Outputs.",
    }


def studio_state() -> dict[str, Any]:
    theme = active_theme()
    active_project = active_project_meta()
    output_project_id = active_project["id"] if active_project else None
    output_path = active_project["path"] if active_project else None
    state: dict[str, Any] = {
        "activeProject": active_project,
        "theme": theme,
        "hasStarter": STARTER_SOURCE.exists(),
        "current": current_scenes_summary(),
        "settings": active_source_settings(),
        "timeline": timeline_summary(),
        "projectCount": len(list_projects()),
        "outputs": list_outputs(limit=5, project_slug=output_project_id, project_path=output_path),
        "urls": {
            "studio": "/studio",
            "studioPrompt": "/studio/prompt",
            "studioImport": "/studio/import",
            "studioNew": "/studio/new",
            "preview": theme_url(theme),
            "captions": "/captions",
            "voices": "/voices",
        },
    }
    state["guide"] = guide_state(state)
    return state


def validate_source_text(scenes_json: str, body_html: str, theme: str | None = None) -> dict[str, Any]:
    if not scenes_json.strip():
        raise ApiError(400, "scenesJson is required")
    if not body_html.strip():
        raise ApiError(400, "bodyHtml is required")
    with tempfile.TemporaryDirectory(prefix="studio-source-") as temp_dir:
        temp = Path(temp_dir)
        scenes_path = temp / "scenes.json"
        body_path = temp / "body.html"
        scenes_path.write_text(scenes_json, encoding="utf-8")
        body_path.write_text(body_html, encoding="utf-8")
        try:
            scenes = validate_scenes(scenes_path)
            validate_body(body_path, scenes)
            validate_theme(theme or active_theme() or DEFAULT_THEME)
        except SystemExit as exc:
            raise ApiError(422, str(exc)) from exc
    return {
        "ok": True,
        "sceneCount": len(scenes),
        "narrationChars": sum(len(scene["narration"]) for scene in scenes),
    }


def validate_project(source_root: Path, theme: str | None = None) -> dict[str, Any]:
    try:
        resolved = resolve_source(source_root)
        scenes = validate_scenes(resolved["scenes"])
        validate_body(resolved["body"], scenes)
        if resolved["captions"]:
            from validate_sources import validate_captions

            validate_captions(resolved["captions"])
        validate_theme(theme or active_theme() or DEFAULT_THEME)
    except SystemExit as exc:
        raise ApiError(422, str(exc)) from exc
    return {
        "ok": True,
        "sceneCount": len(scenes),
        "narrationChars": sum(len(scene["narration"]) for scene in scenes),
    }


def create_project(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    project_id = str(payload.get("project") or payload.get("id") or "").strip().lower()
    scenes_json = str(payload.get("scenesJson") or "")
    body_html = str(payload.get("bodyHtml") or "")
    overwrite = bool(payload.get("overwrite"))
    validation = validate_source_text(scenes_json, body_html, str(payload.get("theme") or active_theme()))

    if overwrite:
        if not project_id:
            raise ApiError(400, "project id is required when replacing a project")
        target = safe_project_path(project_id)
        if not target.exists():
            raise ApiError(404, f"project not found: {project_id}")
        existing_manifest = ensure_project_manifest(target)
        name = name or str(existing_manifest["name"])
    else:
        project_id = new_project_id()
        target = LOCAL_WORK / project_id
    name = name or "Untitled project"

    target.mkdir(parents=True, exist_ok=True)
    (target / "scenes.json").write_text(scenes_json.strip() + "\n", encoding="utf-8")
    (target / "body.html").write_text(body_html.strip() + "\n", encoding="utf-8")
    ensure_project_manifest(target, name=name, project_id=project_id)
    if payload.get("tts") is not None:
        write_project_settings(target, {"tts": payload.get("tts")})
    active = active_source_root()
    if active and active.resolve() == target.resolve():
        shutil.rmtree(CURRENT_ASSETS, ignore_errors=True)
        CURRENT_ASSETS.mkdir(parents=True, exist_ok=True)
    captions = target / "captions.json"
    if overwrite and captions.exists():
        captions.unlink()
    return {"project": source_summary(target), "validation": validation}


def create_blank_project(payload: dict[str, Any]) -> dict[str, Any]:
    display_name = str(payload.get("name") or "").strip() or "New video project"
    project_id = new_project_id()
    target = LOCAL_WORK / project_id
    scenes = [
        {
            "id": "intro",
            "category": "Overview",
            "title": display_name,
            "summary": f"Start planning the topic, scenes, and narration for {display_name} here.",
            "narration": f"This is the new video project {display_name}. Next, describe the topic, audience, and key points to cover.",
        }
    ]
    body_html = f"""<section class=\"content-scene scene\" data-scene=\"intro\">
  <div class=\"scene-copy\">
    <div class=\"eyebrow\">INTRO</div>
    <h1>{display_name}</h1>
    <p class=\"summary\">Start planning the topic, scenes, and narration for {display_name} here.</p>
  </div>
  <div class=\"visual-board\"></div>
</section>
"""
    target.mkdir(parents=True, exist_ok=True)
    (target / "scenes.json").write_text(json.dumps(scenes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (target / "body.html").write_text(body_html, encoding="utf-8")
    ensure_project_manifest(target, name=display_name, project_id=project_id)
    write_project_settings(target, {"tts": DEFAULT_TTS_SETTINGS})
    try:
        load_source(target, str(payload.get("theme") or DEFAULT_THEME))
    except SystemExit as exc:
        raise ApiError(422, str(exc)) from exc
    return {"project": source_summary(target), "state": studio_state()}


def load_project(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    if value in {"starter", "templates/starter"}:
        source_root = STARTER_SOURCE
    else:
        source_root = safe_project_path(value)
    try:
        load_source(source_root, str(payload.get("theme") or DEFAULT_THEME))
    except SystemExit as exc:
        raise ApiError(422, str(exc)) from exc
    return {"project": source_summary(source_root), "state": studio_state()}


def project_source(query: dict[str, list[str]]) -> dict[str, Any]:
    value = (query.get("project") or query.get("id") or [""])[0].strip()
    source_root = safe_project_path(value) if value else active_source_root()
    if not source_root:
        raise ApiError(404, "project not found")
    try:
        resolved = resolve_source(source_root)
    except SystemExit as exc:
        raise ApiError(422, str(exc)) from exc
    return {
        "project": source_summary(source_root),
        "files": {
            "scenesJson": resolved["scenes"].read_text(encoding="utf-8"),
            "bodyHtml": resolved["body"].read_text(encoding="utf-8"),
        },
    }


def save_project_settings(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    source_root = safe_project_path(value) if value else active_source_root()
    if not source_root:
        raise ApiError(409, "no loaded source; load or create a project first")
    if not source_root.exists() or not source_root.is_dir():
        raise ApiError(404, f"project not found: {source_root.name}")
    write_project_settings(source_root, {"tts": payload.get("tts") or payload})
    return {"project": source_summary(source_root), "settings": read_project_settings(source_root)}


def update_project_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    name = str(payload.get("name") or "").strip()
    if not value:
        raise ApiError(400, "project id is required")
    if not name:
        raise ApiError(400, "project name is required")
    source_root = safe_project_path(value)
    if not source_root.exists() or not source_root.is_dir():
        raise ApiError(404, f"project not found: {value}")
    manifest = ensure_project_manifest(source_root, name=name)
    manifest["updatedAt"] = utc_now()
    (source_root / PROJECT_MANIFEST_FILE).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"project": source_summary(source_root)}


def delete_project(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    if not value:
        raise ApiError(400, "project id is required")
    if value in {"starter", "templates/starter"}:
        raise ApiError(400, "starter cannot be deleted")
    target = safe_project_path(value)
    if not target.exists() or not target.is_dir():
        raise ApiError(404, f"project not found: {target.name}")
    active = active_source_root()
    was_active = bool(active and active.resolve() == target.resolve())
    shutil.rmtree(target)
    if was_active and CURRENT_META.exists():
        CURRENT_META.unlink()
    if was_active:
        remaining = [LOCAL_WORK / item["id"] for item in list_projects()]
        if remaining:
            load_source(remaining[0], active_theme())
    return {"deleted": target.name, "wasActive": was_active, "state": studio_state()}


def active_job() -> dict[str, Any] | None:
    with JOBS_LOCK:
        for job in JOBS.values():
            if job.get("status") in {"queued", "running"}:
                return job
    return None


def job_snapshot(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "task": job["task"],
        "status": job["status"],
        "exitCode": job.get("exitCode"),
        "createdAt": job["createdAt"],
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "command": job["command"],
        "log": job["log"][-JOB_LOG_LIMIT:],
    }


def append_job_log(job_id: str, line: str) -> None:
    clean_line = line.rstrip()
    task = "job"
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        task = str(job.get("task") or task)
        job["log"].append(clean_line)
        if len(job["log"]) > JOB_LOG_LIMIT:
            job["log"] = job["log"][-JOB_LOG_LIMIT:]
    if clean_line:
        print(f"[job:{job_id} {task}] {clean_line}", flush=True)


def set_job_fields(job_id: str, **fields: Any) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def run_job(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        command = list(job["command"])
    set_job_fields(job_id, status="running", startedAt=utc_now())
    print(f"[job:{job_id} {job['task']}] started: {' '.join(command)}", flush=True)
    try:
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        set_job_fields(job_id, pid=process.pid)
        assert process.stdout is not None
        for line in process.stdout:
            append_job_log(job_id, line)
        exit_code = process.wait()
        set_job_fields(
            job_id,
            status="succeeded" if exit_code == 0 else "failed",
            exitCode=exit_code,
            finishedAt=utc_now(),
        )
        if exit_code == 0 and job.get("task") == "render":
            output_name = str(job.get("outputName") or "").strip()
            if output_name:
                project_path = str(job.get("projectPath") or "").strip()
                output_file = (Path(project_path) / PROJECT_OUTPUT_DIR / output_name) if project_path else LOCAL_OUTPUT / output_name
                if output_file.exists():
                    register_output(
                        output_file,
                        str(job.get("projectId") or "").strip() or None,
                        project_path or None,
                    )
        print(f"[job:{job_id} {job['task']}] {'completed' if exit_code == 0 else 'failed'} (exit {exit_code})", flush=True)
    except Exception as exc:  # noqa: BLE001 - surface background failures to the UI.
        append_job_log(job_id, f"Job failed before completion: {exc}")
        set_job_fields(job_id, status="failed", exitCode=-1, finishedAt=utc_now())


def clean_output_name(value: str) -> str:
    stem = Path(value or "studio-render.mp4").stem
    name = slug(stem or "studio-render")
    return f"{name}.mp4"


def command_for_job(payload: dict[str, Any]) -> tuple[str, list[str]]:
    task = str(payload.get("task") or "").strip().lower()
    if task not in {"tts", "offline", "check", "render", "voice-preview"}:
        raise ApiError(400, "unknown job task")

    if task == "voice-preview":
        text = str(payload.get("text") or "").strip()
        voice = str(payload.get("voice") or "zh-CN-XiaoxiaoNeural").strip()
        rate = str(payload.get("rate") or "+0%").strip()
        pitch = str(payload.get("pitch") or "+0Hz").strip()
        if not text or len(text) > 3000:
            raise ApiError(400, "voice preview text must contain 1 to 3000 characters")
        if voice not in {item["id"] for item in VOICE_OPTIONS}:
            raise ApiError(400, "unsupported voice")
        if not re.fullmatch(r"[+-](?:[0-9]|[1-4][0-9]|50)%", rate):
            raise ApiError(400, "rate must be between -50% and +50%")
        if not re.fullmatch(r"[+-](?:[0-9]|1[0-9]|2[0-4])Hz", pitch):
            raise ApiError(400, "pitch must be between -24Hz and +24Hz")
        return task, [
            PYTHON,
            "main.py",
            "voice-preview",
            "--voice",
            voice,
            "--text",
            text,
            "--rate",
            rate,
            "--pitch",
            pitch,
        ]

    if task == "tts":
        tts_settings = normalize_tts_settings(payload)
        source = active_source_root()
        if source and source.exists() and source.is_dir():
            write_project_settings(source, {"tts": tts_settings})
        command = [
            PYTHON,
            "main.py",
            "tts",
            "--voice",
            tts_settings["voice"],
            "--rate",
            tts_settings["rate"],
            "--pitch",
            tts_settings["pitch"],
            "--gap",
            tts_settings["gap"],
        ]
        if payload.get("force"):
            command.append("--force")
        return task, command

    if task == "offline":
        return task, [PYTHON, "main.py", "offline"]

    if task == "check":
        return task, [PYTHON, "main.py", "check"]

    size = str(payload.get("size") or "720p").lower()
    capture = str(payload.get("capture") or "auto").lower()
    if size not in RENDER_SIZES:
        raise ApiError(400, "invalid render size")
    if capture not in CAPTURE_MODES:
        raise ApiError(400, "invalid capture mode")
    fps = int(payload.get("fps") or 15)
    fps = min(max(fps, 1), 60)
    return task, [
        PYTHON,
        "main.py",
        "render",
        "--size",
        size,
        "--capture",
        capture,
        "--fps",
        str(fps),
        "--output",
        clean_output_name(str(payload.get("output") or "studio-render.mp4")),
    ]


def start_job(payload: dict[str, Any]) -> dict[str, Any]:
    running = active_job()
    if running:
        raise ApiError(409, f"{running['task']} is already running")
    task, command = command_for_job(payload)
    if task in {"tts", "offline", "check", "render"} and not (CURRENT_SOURCE / "scenes.json").exists():
        raise ApiError(409, "no loaded source; load or create a project first")

    job_id = uuid.uuid4().hex[:12]
    active_project = active_project_meta()
    output_name = ""
    if task == "render":
        output_name = clean_output_name(str(payload.get("output") or "studio-render.mp4"))
    job = {
        "id": job_id,
        "task": task,
        "command": command,
        "projectId": active_project["id"] if active_project else None,
        "projectPath": active_project["path"] if active_project else None,
        "outputName": output_name,
        "status": "queued",
        "exitCode": None,
        "createdAt": utc_now(),
        "startedAt": None,
        "finishedAt": None,
        "log": [],
    }
    with JOBS_LOCK:
        JOBS[job_id] = job
    thread = threading.Thread(target=run_job, args=(job_id,), daemon=True)
    thread.start()
    time.sleep(0.02)
    with JOBS_LOCK:
        return {"job": job_snapshot(JOBS[job_id])}


def get_job(query: dict[str, list[str]]) -> dict[str, Any]:
    job_id = (query.get("id") or [""])[0]
    if not job_id:
        raise ApiError(400, "job id is required")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise ApiError(404, "job not found")
        return {"job": job_snapshot(job)}


def voice_preview_state() -> dict[str, Any]:
    VOICE_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    manifest = read_json_file(VOICE_PREVIEW_DIR / "manifest.json")
    if not isinstance(manifest, dict):
        manifest = {"samples": [], "history": []}
    history = manifest.get("history")
    if not isinstance(history, list):
        history = manifest.get("samples") if isinstance(manifest.get("samples"), list) else []
    return {
        "voices": VOICE_OPTIONS,
        "manifest": manifest,
        "history": history[:20],
        "outputUrl": "/.local/assets/voice-preview/",
    }


def handle_get(path: str, query: dict[str, list[str]]) -> tuple[int, Any] | None:
    if path == "/api/studio/state":
        return 200, studio_state()
    if path == "/api/projects":
        return 200, {"projects": list_projects()}
    if path == "/api/projects/source":
        return 200, project_source(query)
    if path == "/api/outputs":
        active_project = active_project_meta()
        return 200, {
            "outputs": list_outputs(
                project_slug=active_project["id"] if active_project else None,
                project_path=active_project["path"] if active_project else None,
            )
        }
    if path == "/api/voice-preview":
        return 200, voice_preview_state()
    if path == "/api/jobs":
        return 200, get_job(query)
    return None


def handle_post(path: str, payload: dict[str, Any]) -> tuple[int, Any] | None:
    if path == "/api/projects":
        return 201, create_project(payload)
    if path == "/api/projects/blank":
        return 201, create_blank_project(payload)
    if path == "/api/projects/load":
        return 200, load_project(payload)
    if path == "/api/projects/settings":
        return 200, save_project_settings(payload)
    if path == "/api/projects/update":
        return 200, update_project_metadata(payload)
    if path == "/api/projects/delete":
        return 200, delete_project(payload)
    if path == "/api/source/validate":
        if payload.get("project") or payload.get("id"):
            return 200, validate_project(safe_project_path(str(payload.get("project") or payload.get("id"))))
        return 200, validate_source_text(str(payload.get("scenesJson") or ""), str(payload.get("bodyHtml") or ""))
    if path == "/api/jobs":
        return 202, start_job(payload)
    return None
