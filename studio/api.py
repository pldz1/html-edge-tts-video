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
    DEFAULT_ASPECT_RATIO,
    LOCAL,
    LOCAL_ASSETS,
    LOCAL_OUTPUT,
    LOCAL_WORK,
    PROJECT_MANIFEST_FILE,
    PROJECT_OUTPUT_DIR,
    ROOT,
    STARTER_SOURCE,
    activate_source,
    active_source_root,
    atomic_write_json,
    atomic_write_text,
    is_local_project,
    migrate_legacy_current,
    normalize_aspect_ratio,
    project_paths,
    reconcile_active_project,
    rel,
    resolve_source,
    slug,
    shell_relative_url,
)
from pipeline.validate_sources import (
    has_embedded_visual,
    validate_body,
    validate_captions,
    validate_scenes,
    validate_shell,
)
from pipeline.prompt_composer import compose_prompt, detect_language


PYTHON = sys.executable
OUTPUT_EXTENSIONS = {".mp4", ".webm"}
JOB_LOG_LIMIT = 500
RENDER_SIZES = {"480p", "720p", "1080p", "2k", "1440p", "4k", "2160p"}
CAPTURE_MODES = {"auto", "video", "frames"}
RENDER_PROGRESS_PREFIX = "RENDER_PROGRESS "
VOICE_PREVIEW_DIR = LOCAL / "voice-preview"
VOICE_OPTIONS = [
    {"id": "zh-CN-XiaoxiaoNeural", "label": "晓晓", "locale": "zh-CN", "gender": "Female"},
    {"id": "zh-CN-YunxiNeural", "label": "云希", "locale": "zh-CN", "gender": "Male"},
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
DEFAULT_VOICE_BY_LANGUAGE = {
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    "en-US": "en-US-JennyNeural",
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


def normalize_tts_settings(value: Any | None = None, language: str = "en-US") -> dict[str, str]:
    data = value if isinstance(value, dict) else {}
    settings = {**DEFAULT_TTS_SETTINGS}
    settings["voice"] = DEFAULT_VOICE_BY_LANGUAGE.get(language, settings["voice"])
    settings["voice"] = str(data.get("voice") or settings["voice"]).strip()
    settings["rate"] = str(data.get("rate") or settings["rate"]).strip()
    settings["pitch"] = str(data.get("pitch") or settings["pitch"]).strip()
    settings["gap"] = str(data.get("gap") or settings["gap"]).strip()
    return settings


def voice_matches_language(voice: str, language: str) -> bool:
    locale = next((item["locale"] for item in VOICE_OPTIONS if item["id"] == voice), "")
    if language == "zh-CN":
        return locale == "zh-CN"
    if language == "en-US":
        return locale.startswith("en-")
    return True


def new_project_id() -> str:
    existing_ids = set()
    if LOCAL_WORK.exists():
        for child in LOCAL_WORK.iterdir():
            manifest = read_json_file(child / PROJECT_MANIFEST_FILE) if child.is_dir() else None
            if isinstance(manifest, dict):
                existing_ids.add(str(manifest.get("id") or "").lower())
    while True:
        value = uuid.uuid4().hex[:8]
        if value not in existing_ids and not (LOCAL_WORK / value).exists():
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
    language: str | None = None,
    aspect_ratio: str | None = None,
) -> dict[str, Any]:
    manifest_path = source_root / PROJECT_MANIFEST_FILE
    existing = read_json_file(manifest_path)
    data = existing if isinstance(existing, dict) else {}
    legacy_settings = read_json_file(source_root / PROJECT_SETTINGS_FILE)
    legacy_settings = legacy_settings if isinstance(legacy_settings, dict) else {}
    current_id = str(project_id or data.get("id") or "").strip().lower()
    if source_root.resolve() == STARTER_SOURCE.resolve():
        current_id = "starter"
    elif not re.fullmatch(r"[0-9a-f]{8}", current_id):
        folder_id = source_root.name.lower()
        if re.fullmatch(r"[0-9a-f]{8}", folder_id):
            current_id = folder_id
        elif is_local_project(source_root):
            current_id = new_project_id()
        else:
            current_id = hashlib.sha256(str(source_root.resolve()).encode("utf-8")).hexdigest()[:8]
    now = utc_now()
    requested_language = str(language or data.get("language") or "auto")
    if requested_language not in {"auto", "zh-CN", "en-US"}:
        requested_language = "auto"
    scenes = read_json_file(source_root / "scenes.json")
    language_text = " ".join(
        str(scene.get(key) or "")
        for scene in scenes if isinstance(scene, dict)
        for key in ["title", "summary", "narration"]
    ) if isinstance(scenes, list) else ""
    resolved_language = detect_language(language_text) if requested_language == "auto" else requested_language
    retained = {key: value for key, value in data.items() if key not in {"contentTheme", "engine", "theme"}}
    starter = source_root.resolve() == STARTER_SOURCE.resolve()
    stored_aspect_ratio = data.get("aspectRatio")
    if stored_aspect_ratio is not None and aspect_ratio is not None:
        if normalize_aspect_ratio(stored_aspect_ratio) != normalize_aspect_ratio(aspect_ratio):
            raise ApiError(409, "project aspect ratio is fixed after creation")
    resolved_aspect_ratio = (
        DEFAULT_ASPECT_RATIO
        if starter
        else normalize_aspect_ratio(stored_aspect_ratio or aspect_ratio)
    )
    manifest = {
        **retained,
        "version": 5,
        "id": current_id,
        "name": (
            "Starter"
            if starter
            else str(name or data.get("name") or project_name_from_source(source_root)).strip() or "Untitled project"
        ),
        "active": bool(data.get("active", starter and not data)),
        "system": starter,
        "readOnly": starter,
        "aspectRatio": resolved_aspect_ratio,
        "language": requested_language,
        "resolvedLanguage": resolved_language,
        "createdAt": str(data.get("createdAt") or now),
        "updatedAt": str(data.get("updatedAt") or now),
        "activatedAt": data.get("activatedAt") or (now if bool(data.get("active", starter and not data)) else None),
        "tts": normalize_tts_settings(data.get("tts") or legacy_settings.get("tts"), resolved_language),
    }
    if is_local_project(source_root):
        source_root.mkdir(parents=True, exist_ok=True)
        if manifest != existing:
            atomic_write_json(manifest_path, manifest)
        legacy_path = source_root / PROJECT_SETTINGS_FILE
        if legacy_path.exists():
            legacy_path.unlink()
    return manifest


def migrate_local_projects() -> None:
    migrate_legacy_current()
    LOCAL_WORK.mkdir(parents=True, exist_ok=True)
    for child in list(LOCAL_WORK.iterdir()):
        if child.name.startswith(".") or not child.is_dir() or not (child / "scenes.json").exists() or not (child / "body.html").exists():
            continue
        ensure_project_manifest(child)
    reconcile_active_project(repair=True)


def read_project_settings(source_root: Path) -> dict[str, Any]:
    manifest = ensure_project_manifest(source_root)
    return {"tts": normalize_tts_settings(manifest.get("tts"), str(manifest.get("resolvedLanguage") or "en-US"))}


def write_project_settings(source_root: Path, settings: dict[str, Any]) -> None:
    manifest = ensure_project_manifest(source_root)
    if "tts" in settings:
        manifest["tts"] = normalize_tts_settings(
            settings["tts"], str(manifest.get("resolvedLanguage") or "en-US")
        )
    manifest["updatedAt"] = utc_now()
    if is_local_project(source_root):
        atomic_write_json(source_root / PROJECT_MANIFEST_FILE, manifest)


def active_source_settings() -> dict[str, Any]:
    source = active_source_root()
    if not source:
        return {"tts": normalize_tts_settings()}
    return read_project_settings(source)


def safe_project_path(value: str) -> Path:
    migrate_local_projects()
    project_id = str(value or "").strip().lower()
    if project_id == "starter":
        return STARTER_SOURCE.resolve()
    if not re.fullmatch(r"[0-9a-f]{8}", project_id):
        raise ApiError(400, "project id must be 8 hexadecimal characters")
    for child in LOCAL_WORK.iterdir():
        if not child.is_dir():
            continue
        manifest = read_json_file(child / PROJECT_MANIFEST_FILE)
        if isinstance(manifest, dict) and str(manifest.get("id") or "").lower() == project_id:
            return child.resolve()
    return (LOCAL_WORK / project_id).resolve()


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
        "language": str(manifest.get("language") or "auto"),
        "resolvedLanguage": str(manifest.get("resolvedLanguage") or "zh-CN"),
        "aspectRatio": normalize_aspect_ratio(manifest.get("aspectRatio")),
        "settings": read_project_settings(resolved["root"]),
        "active": bool(active and active.resolve() == resolved["root"].resolve()),
    }


def list_projects() -> list[dict[str, Any]]:
    migrate_local_projects()
    projects = []
    for child in sorted(LOCAL_WORK.iterdir(), key=lambda item: item.name.lower()):
        if child.name.startswith(".") or not child.is_dir():
            continue
        try:
            projects.append(source_summary(child))
        except SystemExit:
            continue
    return projects


def list_outputs(limit: int | None = None, project_slug: str | None = None, project_path: str | None = None) -> list[dict[str, Any]]:
    files: list[Path] = []
    if project_path:
        project_outputs = Path(project_path) / PROJECT_OUTPUT_DIR
        if project_outputs.exists():
            files.extend(
                item for item in project_outputs.iterdir()
                if item.is_file() and item.suffix.lower() in OUTPUT_EXTENSIONS
            )
    legacy_files = (
        [
            item
            for item in LOCAL_OUTPUT.iterdir()
            if item.is_file() and item.suffix.lower() in OUTPUT_EXTENSIONS
        ]
        if LOCAL_OUTPUT.exists()
        else []
    )
    if project_slug or project_path:
        legacy_files = [item for item in legacy_files if output_belongs_to_project(item, project_slug, project_path)]
    files.extend(legacy_files)
    files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    if limit:
        files = files[:limit]
    return [output_record(item) for item in files]


def active_scenes_summary() -> dict[str, Any]:
    paths = project_paths()
    scenes_path = paths.scenes
    body_path = paths.body
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
    paths = project_paths()
    timeline_path = paths.generated / "timeline.json"
    narration_path = paths.generated / "narration.mp3"
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

    source_scenes = read_json_file(paths.scenes)
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
        result["error"] = "timeline/audio do not match the active project source"
    return result


def active_project_meta(source_root: Path | None = None) -> dict[str, Any] | None:
    source = source_root or active_source_root()
    manifest = ensure_project_manifest(source)
    return {
        "id": manifest["id"],
        "name": manifest["name"],
        "path": str(source),
        "relativePath": rel(source),
        "language": manifest.get("language", "auto"),
        "resolvedLanguage": manifest.get("resolvedLanguage", "zh-CN"),
        "aspectRatio": normalize_aspect_ratio(manifest.get("aspectRatio")),
        "settings": read_project_settings(source),
        "loadedAt": manifest.get("activatedAt"),
    }


def guide_state(state: dict[str, Any]) -> dict[str, str]:
    has_projects = bool(state["projectCount"])
    has_source = bool(state["projectSummary"]["hasSource"])
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
            "body": "Choose a project from the list. Studio previews it directly from its project folder.",
        }
    if not has_ready_timeline:
        return {
            "stage": "build",
            "title": "Generate TTS and the timeline next",
            "body": "The active project is ready. Run Check first, then TTS or Silent Preview.",
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
    migrate_local_projects()
    active_project = active_project_meta()
    output_project_id = active_project["id"] if active_project else None
    output_path = active_project["path"] if active_project else None
    state: dict[str, Any] = {
        "activeProject": active_project,
        "hasStarter": STARTER_SOURCE.exists(),
        "projectSummary": active_scenes_summary(),
        "settings": active_source_settings(),
        "timeline": timeline_summary(),
        "projectCount": len(list_projects()),
        "outputs": list_outputs(limit=5, project_slug=output_project_id, project_path=output_path),
        "urls": {
            "studio": "/studio",
            "shell": shell_relative_url(active_source_root()),
            "captions": "/captions",
            "voices": "/voices",
        },
    }
    state["guide"] = guide_state(state)
    return state


def validate_source_text(
    scenes_json: str,
    body_html: str,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
) -> dict[str, Any]:
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
            scenes = validate_scenes(scenes_path, aspect_ratio=aspect_ratio)
            validate_body(body_path, scenes)
            validate_shell()
        except SystemExit as exc:
            raise ApiError(422, str(exc)) from exc
    return {
        "ok": True,
        "sceneCount": len(scenes),
        "narrationChars": sum(len(scene["narration"]) for scene in scenes),
        "resolvedLanguage": detect_language(" ".join(str(scene.get("narration") or "") for scene in scenes)),
        "hasEmbeddedStyle": "<style" in body_html.lower(),
        "hasEmbeddedVisual": has_embedded_visual(body_html),
    }


def validate_project(source_root: Path) -> dict[str, Any]:
    try:
        resolved = resolve_source(source_root)
        manifest = ensure_project_manifest(resolved["root"])
        scenes = validate_scenes(
            resolved["scenes"],
            aspect_ratio=normalize_aspect_ratio(manifest.get("aspectRatio")),
        )
        validate_body(resolved["body"], scenes)
        if resolved["captions"]:
            validate_captions(resolved["captions"])
        validate_shell()
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
    try:
        aspect_ratio = normalize_aspect_ratio(payload.get("aspectRatio"))
    except ValueError as exc:
        raise ApiError(400, str(exc)) from exc
    if overwrite and project_id == "starter":
        raise ApiError(400, "starter is read-only; save the source as a new project")
    if overwrite:
        if not project_id:
            raise ApiError(400, "project id is required when replacing a project")
        target = safe_project_path(project_id)
        if not target.exists():
            raise ApiError(404, f"project not found: {project_id}")
        existing_manifest = ensure_project_manifest(target)
        existing_aspect_ratio = normalize_aspect_ratio(existing_manifest.get("aspectRatio"))
        if "aspectRatio" in payload and aspect_ratio != existing_aspect_ratio:
            raise ApiError(409, "project aspect ratio is fixed after creation")
        aspect_ratio = existing_aspect_ratio
        name = name or str(existing_manifest["name"])
    else:
        project_id = new_project_id()
        target = LOCAL_WORK / project_id
    name = name or "Untitled project"
    validation = validate_source_text(scenes_json, body_html, aspect_ratio)

    write_target = target
    if not overwrite:
        write_target = LOCAL_WORK / f".{project_id}.creating"
        shutil.rmtree(write_target, ignore_errors=True)
    write_target.mkdir(parents=True, exist_ok=True)
    atomic_write_text(write_target / "scenes.json", scenes_json.strip() + "\n")
    atomic_write_text(write_target / "body.html", body_html.strip() + "\n")
    existing = existing_manifest if overwrite else {}
    language = str(payload.get("language") or existing.get("language") or "auto")
    ensure_project_manifest(
        write_target,
        name=name,
        project_id=project_id,
        language=language,
        aspect_ratio=aspect_ratio,
    )
    if payload.get("tts") is not None:
        write_project_settings(write_target, {"tts": payload.get("tts")})
    if not overwrite:
        write_target.replace(target)
    if overwrite:
        shutil.rmtree(project_paths(target).generated, ignore_errors=True)
    captions = target / "captions.json"
    if overwrite and captions.exists():
        captions.unlink()
    activate_source(target)
    return {"project": source_summary(target), "validation": validation, "state": studio_state()}


def activate_project(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    if value in {"starter", ".local/work/starter", "templates/starter"}:
        source_root = STARTER_SOURCE
    else:
        source_root = safe_project_path(value)
    ensure_project_manifest(source_root)
    try:
        resolve_source(source_root)
        activate_source(source_root)
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
        raise ApiError(409, "no active project; activate or create a project first")
    if not source_root.exists() or not source_root.is_dir():
        raise ApiError(404, f"project not found: {source_root.name}")
    write_project_settings(source_root, {"tts": payload.get("tts") or payload})
    return {"project": source_summary(source_root), "settings": read_project_settings(source_root)}


def update_project_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    name = str(payload.get("name") or "").strip()
    if not value:
        raise ApiError(400, "project id is required")
    if value == "starter":
        raise ApiError(400, "starter is read-only")
    if not name:
        raise ApiError(400, "project name is required")
    source_root = safe_project_path(value)
    if not source_root.exists() or not source_root.is_dir():
        raise ApiError(404, f"project not found: {value}")
    manifest = ensure_project_manifest(source_root, name=name)
    manifest["updatedAt"] = utc_now()
    atomic_write_json(source_root / PROJECT_MANIFEST_FILE, manifest)
    return {"project": source_summary(source_root)}


def delete_project(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("id") or "").strip()
    if not value:
        raise ApiError(400, "project id is required")
    if value in {"starter", ".local/work/starter", "templates/starter"}:
        raise ApiError(400, "starter cannot be deleted")
    target = safe_project_path(value)
    if not target.exists() or not target.is_dir():
        raise ApiError(404, f"project not found: {target.name}")
    active = active_source_root()
    was_active = bool(active and active.resolve() == target.resolve())
    shutil.rmtree(target)
    if was_active:
        activate_source(STARTER_SOURCE)
    return {"deleted": target.name, "wasActive": was_active, "state": studio_state()}


def active_job() -> dict[str, Any] | None:
    with JOBS_LOCK:
        for job in JOBS.values():
            if job.get("status") in {"queued", "running"}:
                return job
    return None


def job_snapshot(job: dict[str, Any]) -> dict[str, Any]:
    progress = job.get("progress")
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
        "progress": dict(progress) if isinstance(progress, dict) else None,
    }


def parse_render_progress(line: str) -> dict[str, Any] | None:
    if not line.startswith(RENDER_PROGRESS_PREFIX):
        return None
    try:
        progress = json.loads(line[len(RENDER_PROGRESS_PREFIX) :])
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(progress, dict):
        return None
    try:
        progress["percent"] = min(100.0, max(0.0, float(progress.get("percent", 0))))
    except (TypeError, ValueError):
        progress["percent"] = 0.0
    return progress


def progress_console_line(progress: dict[str, Any]) -> str:
    percent = float(progress.get("percent") or 0)
    rendered = int(progress.get("renderedFrames") or 0)
    encoded = int(progress.get("encodedFrames") or 0)
    total = int(progress.get("totalFrames") or 0)
    fps = float(progress.get("encodeFps") or 0)
    speed = float(progress.get("speed") or 0)
    eta = progress.get("etaSeconds")
    eta_text = f"{max(0, round(float(eta)))}s" if eta is not None else "--"
    return (
        f"{progress.get('phase', 'rendering')} {percent:.2f}% "
        f"capture={rendered}/{total} encode={encoded}/{total} "
        f"fps={fps:.1f} speed={speed:.3f}x eta={eta_text}"
    )


def append_job_log(job_id: str, line: str) -> None:
    clean_line = line.rstrip()
    progress = parse_render_progress(clean_line)
    task = "job"
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        task = str(job.get("task") or task)
        if progress is not None:
            job["progress"] = progress
        else:
            job["log"].append(clean_line)
            if len(job["log"]) > JOB_LOG_LIMIT:
                job["log"] = job["log"][-JOB_LOG_LIMIT:]
    if clean_line:
        output = progress_console_line(progress) if progress is not None else clean_line
        print(f"[job:{job_id} {task}] {output}", flush=True)


def set_job_fields(job_id: str, **fields: Any) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def finish_render_progress(job_id: str, succeeded: bool) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job.get("task") != "render":
            return
        progress = dict(job.get("progress") or {})
        progress["phase"] = "completed" if succeeded else "failed"
        if succeeded:
            progress.update({"percent": 100.0, "etaSeconds": 0.0})
        job["progress"] = progress


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
        finish_render_progress(job_id, exit_code == 0)
        if exit_code == 0 and job.get("task") == "render":
            output_name = str(job.get("outputName") or "").strip()
            if output_name:
                project_path = str(job.get("projectPath") or "").strip()
                output_file = (Path(project_path) / PROJECT_OUTPUT_DIR / output_name) if project_path else LOCAL_OUTPUT / output_name
                if output_file.exists() and not project_path:
                    register_output(
                        output_file,
                        str(job.get("projectId") or "").strip() or None,
                        project_path or None,
                    )
        print(f"[job:{job_id} {job['task']}] {'completed' if exit_code == 0 else 'failed'} (exit {exit_code})", flush=True)
    except Exception as exc:  # noqa: BLE001 - surface background failures to the UI.
        append_job_log(job_id, f"Job failed before completion: {exc}")
        set_job_fields(job_id, status="failed", exitCode=-1, finishedAt=utc_now())
        finish_render_progress(job_id, False)


def clean_output_name(value: str) -> str:
    stem = Path(value or "studio-render.mp4").stem
    name = slug(stem or "studio-render")
    return f"{name}.mp4"


def command_for_job(payload: dict[str, Any], source_root: Path | None = None) -> tuple[str, list[str]]:
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

    source = source_root or active_source_root()
    source_args = ["--source", str(source)]

    if task == "tts":
        if source and source.exists() and source.is_dir():
            manifest = ensure_project_manifest(source)
            language = str(manifest.get("resolvedLanguage") or "en-US")
            saved_tts = normalize_tts_settings(manifest.get("tts"), language)
        else:
            language = "en-US"
            saved_tts = normalize_tts_settings(language=language)
        if not payload.get("voice") and not voice_matches_language(saved_tts["voice"], language):
            saved_tts["voice"] = DEFAULT_VOICE_BY_LANGUAGE.get(language, DEFAULT_TTS_SETTINGS["voice"])
        overrides = {
            key: payload[key]
            for key in ["voice", "rate", "pitch", "gap"]
            if payload.get(key) not in {None, ""}
        }
        tts_settings = normalize_tts_settings({**saved_tts, **overrides}, language)
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
            *source_args,
        ]
        if payload.get("force"):
            command.append("--force")
        return task, command

    if task == "offline":
        return task, [PYTHON, "main.py", "offline", *source_args]

    if task == "check":
        return task, [PYTHON, "main.py", "check", *source_args]

    size = str(payload.get("size") or "720p").lower()
    capture = str(payload.get("capture") or "auto").lower()
    if size not in RENDER_SIZES:
        raise ApiError(400, "invalid render size")
    if capture not in CAPTURE_MODES:
        raise ApiError(400, "invalid capture mode")
    fps = int(payload.get("fps") or 15)
    fps = min(max(fps, 1), 60)
    try:
        transition = float(payload.get("transition", 0.4))
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "transition must be a number between 0 and 2 seconds") from exc
    if not 0 <= transition <= 2:
        raise ApiError(400, "transition must be between 0 and 2 seconds")
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
        "--transition",
        f"{transition:g}",
        *source_args,
    ]


def start_job(payload: dict[str, Any]) -> dict[str, Any]:
    running = active_job()
    if running:
        raise ApiError(409, f"{running['task']} is already running")
    requested_task = str(payload.get("task") or "").strip().lower()
    source_snapshot = None if requested_task == "voice-preview" else active_source_root()
    task, command = command_for_job(payload, source_snapshot)
    if task in {"tts", "offline", "check", "render"}:
        try:
            project_paths(source_snapshot)
        except SystemExit as exc:
            raise ApiError(409, str(exc)) from exc

    job_id = uuid.uuid4().hex[:12]
    active_project = None if task == "voice-preview" else active_project_meta(source_snapshot)
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
        "progress": (
            {"phase": "queued", "percent": 0.0, "etaSeconds": None}
            if task == "render"
            else None
        ),
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
    legacy = LOCAL_ASSETS / "voice-preview"
    if legacy.exists() and not VOICE_PREVIEW_DIR.exists():
        legacy.rename(VOICE_PREVIEW_DIR)
    VOICE_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    manifest = read_json_file(VOICE_PREVIEW_DIR / "manifest.json")
    if not isinstance(manifest, dict):
        manifest = {"samples": [], "history": []}
    changed = False
    for key in ["samples", "history"]:
        entries = manifest.get(key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("audio"), str):
                migrated = entry["audio"].replace("/.local/assets/voice-preview/", "/.local/voice-preview/")
                changed = changed or migrated != entry["audio"]
                entry["audio"] = migrated
    if changed:
        atomic_write_json(VOICE_PREVIEW_DIR / "manifest.json", manifest)
    history = manifest.get("history")
    if not isinstance(history, list):
        history = manifest.get("samples") if isinstance(manifest.get("samples"), list) else []
    return {
        "voices": VOICE_OPTIONS,
        "manifest": manifest,
        "history": history[:20],
        "outputUrl": "/.local/voice-preview/",
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
    if path == "/api/prompt":
        try:
            return 200, compose_prompt(payload)
        except (ValueError, OSError, json.JSONDecodeError) as exc:
            raise ApiError(422, str(exc)) from exc
    if path == "/api/projects":
        return 201, create_project(payload)
    if path in {"/api/projects/activate", "/api/projects/load"}:
        return 200, activate_project(payload)
    if path == "/api/projects/settings":
        return 200, save_project_settings(payload)
    if path == "/api/projects/update":
        return 200, update_project_metadata(payload)
    if path == "/api/projects/delete":
        return 200, delete_project(payload)
    if path == "/api/source/validate":
        if payload.get("project") or payload.get("id"):
            return 200, validate_project(safe_project_path(str(payload.get("project") or payload.get("id"))))
        try:
            aspect_ratio = normalize_aspect_ratio(payload.get("aspectRatio"))
        except ValueError as exc:
            raise ApiError(400, str(exc)) from exc
        return 200, validate_source_text(
            str(payload.get("scenesJson") or ""),
            str(payload.get("bodyHtml") or ""),
            aspect_ratio,
        )
    if path == "/api/jobs":
        return 202, start_job(payload)
    return None
