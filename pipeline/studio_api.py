#!/usr/bin/env python3
"""JSON API helpers for the local Studio web UI."""
from __future__ import annotations

import json
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

from factory import (
    CURRENT_ASSETS,
    CURRENT_META,
    CURRENT_SOURCE,
    DEFAULT_THEME,
    LOCAL_OUTPUT,
    LOCAL_WORK,
    ROOT,
    STARTER_SOURCE,
    active_source_root,
    active_theme,
    load_source,
    rel,
    resolve_source,
    slug,
    theme_url,
)
from validate_sources import validate_body, validate_scenes, validate_theme


PYTHON = sys.executable
OUTPUT_EXTENSIONS = {".mp4", ".webm"}
JOB_LOG_LIMIT = 500
RENDER_SIZES = {"480p", "720p", "1080p", "2k", "1440p", "4k", "2160p"}
CAPTURE_MODES = {"auto", "video", "frames"}


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


def safe_project_path(value: str) -> Path:
    name = slug(value)
    if not name:
        raise ApiError(400, "project slug is required")
    root = LOCAL_WORK.resolve()
    path = (LOCAL_WORK / name).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ApiError(400, "invalid project path") from exc
    return path


def source_summary(source_root: Path) -> dict[str, Any]:
    resolved = resolve_source(source_root)
    scenes = read_json_file(resolved["scenes"]) or []
    scene_count = len(scenes) if isinstance(scenes, list) else 0
    narration_chars = 0
    title = resolved["root"].name
    if isinstance(scenes, list) and scenes:
        first = scenes[0]
        if isinstance(first, dict):
            title = str(first.get("title") or title)
        narration_chars = sum(
            len(scene.get("narration", ""))
            for scene in scenes
            if isinstance(scene, dict) and isinstance(scene.get("narration"), str)
        )
    updated_at = max(resolved["scenes"].stat().st_mtime, resolved["body"].stat().st_mtime)
    active = active_source_root()
    return {
        "slug": resolved["root"].name,
        "title": title,
        "path": str(resolved["root"]),
        "relativePath": rel(resolved["root"]),
        "sceneCount": scene_count,
        "narrationChars": narration_chars,
        "updatedAt": datetime.fromtimestamp(updated_at, timezone.utc).isoformat(),
        "hasCaptions": bool(resolved["captions"]),
        "hasMedia": bool(resolved["media"]),
        "active": bool(active and active.resolve() == resolved["root"].resolve()),
    }


def list_projects() -> list[dict[str, Any]]:
    LOCAL_WORK.mkdir(parents=True, exist_ok=True)
    projects = []
    for child in sorted(LOCAL_WORK.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir():
            continue
        try:
            projects.append(source_summary(child))
        except SystemExit:
            continue
    return projects


def list_outputs(limit: int | None = None) -> list[dict[str, Any]]:
    LOCAL_OUTPUT.mkdir(parents=True, exist_ok=True)
    files = [
        item
        for item in LOCAL_OUTPUT.iterdir()
        if item.is_file() and item.suffix.lower() in OUTPUT_EXTENSIONS
    ]
    files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    if limit:
        files = files[:limit]
    return [
        {
            "name": item.name,
            "path": str(item),
            "relativePath": rel(item),
            "url": f"/.local/output/{quote(item.name)}",
            "size": item.stat().st_size,
            "modifiedAt": file_time(item),
            "extension": item.suffix.lower().lstrip("."),
        }
        for item in files
    ]


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
    return {
        "slug": source.name,
        "path": str(source),
        "relativePath": rel(source),
        "theme": active_theme(),
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
            "title": "先创建一个视频源",
            "body": "填写提示词，去 Web AI 生成 scenes.json 和 body.html，然后粘贴回来保存为本地项目。",
        }
    if not has_source:
        return {
            "stage": "load",
            "title": "选择一个本地项目",
            "body": "从左侧项目列表加载源文件，Studio 会把它放入当前工厂工作区。",
        }
    if not has_ready_timeline:
        return {
            "stage": "build",
            "title": "下一步生成 TTS 和时间线",
            "body": "当前源文件已经加载，可以先 Check，再运行 TTS 或 Offline Preview。",
        }
    if not has_outputs:
        return {
            "stage": "preview",
            "title": "可以预览并渲染",
            "body": "时间线和旁白已就绪，检查画面后可以编辑字幕或渲染 MP4。",
        }
    return {
        "stage": "done",
        "title": "已有可查看的渲染结果",
        "body": "你可以继续迭代源文件，也可以从 Outputs 里直接播放最近的成片。",
    }


def studio_state() -> dict[str, Any]:
    theme = active_theme()
    state: dict[str, Any] = {
        "activeProject": active_project_meta(),
        "theme": theme,
        "hasStarter": STARTER_SOURCE.exists(),
        "current": current_scenes_summary(),
        "timeline": timeline_summary(),
        "projectCount": len(list_projects()),
        "outputs": list_outputs(limit=5),
        "urls": {
            "studio": "/tools/studio.html",
            "preview": theme_url(theme),
            "captions": "/tools/captions.html",
            "voices": "/tools/voices.html",
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
    raw_slug = str(payload.get("slug") or payload.get("name") or "").strip()
    scenes_json = str(payload.get("scenesJson") or "")
    body_html = str(payload.get("bodyHtml") or "")
    overwrite = bool(payload.get("overwrite"))
    validation = validate_source_text(scenes_json, body_html, str(payload.get("theme") or active_theme()))

    target = safe_project_path(raw_slug or "video")
    if target.exists() and any(target.iterdir()) and not overwrite:
        raise ApiError(409, f"project already exists: {target.name}")

    target.mkdir(parents=True, exist_ok=True)
    (target / "scenes.json").write_text(scenes_json.strip() + "\n", encoding="utf-8")
    (target / "body.html").write_text(body_html.strip() + "\n", encoding="utf-8")
    captions = target / "captions.json"
    if overwrite and captions.exists():
        captions.unlink()
    return {"project": source_summary(target), "validation": validation}


def load_project(payload: dict[str, Any]) -> dict[str, Any]:
    value = str(payload.get("project") or payload.get("slug") or "").strip()
    if value in {"starter", "templates/starter"}:
        source_root = STARTER_SOURCE
    else:
        source_root = safe_project_path(value)
    try:
        load_source(source_root, str(payload.get("theme") or DEFAULT_THEME))
    except SystemExit as exc:
        raise ApiError(422, str(exc)) from exc
    return {"project": source_summary(source_root), "state": studio_state()}


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
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["log"].append(line.rstrip())
        if len(job["log"]) > JOB_LOG_LIMIT:
            job["log"] = job["log"][-JOB_LOG_LIMIT:]


def set_job_fields(job_id: str, **fields: Any) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def run_job(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        command = list(job["command"])
    set_job_fields(job_id, status="running", startedAt=utc_now())
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
    except Exception as exc:  # noqa: BLE001 - surface background failures to the UI.
        append_job_log(job_id, f"Job failed before completion: {exc}")
        set_job_fields(job_id, status="failed", exitCode=-1, finishedAt=utc_now())


def clean_output_name(value: str) -> str:
    stem = Path(value or "studio-render.mp4").stem
    name = slug(stem or "studio-render")
    return f"{name}.mp4"


def command_for_job(payload: dict[str, Any]) -> tuple[str, list[str]]:
    task = str(payload.get("task") or "").strip().lower()
    if task not in {"tts", "offline", "check", "render"}:
        raise ApiError(400, "unknown job task")

    if task == "tts":
        command = [
            PYTHON,
            "main.py",
            "tts",
            "--voice",
            str(payload.get("voice") or "zh-CN-XiaoxiaoNeural"),
            "--rate",
            str(payload.get("rate") or "+12%"),
            "--pitch",
            str(payload.get("pitch") or "+0Hz"),
            "--gap",
            str(payload.get("gap") or "0.28"),
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
    job = {
        "id": job_id,
        "task": task,
        "command": command,
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


def handle_get(path: str, query: dict[str, list[str]]) -> tuple[int, Any] | None:
    if path == "/api/studio/state":
        return 200, studio_state()
    if path == "/api/projects":
        return 200, {"projects": list_projects()}
    if path == "/api/outputs":
        return 200, {"outputs": list_outputs()}
    if path == "/api/jobs":
        return 200, get_job(query)
    return None


def handle_post(path: str, payload: dict[str, Any]) -> tuple[int, Any] | None:
    if path == "/api/projects":
        return 201, create_project(payload)
    if path == "/api/projects/load":
        return 200, load_project(payload)
    if path == "/api/source/validate":
        if payload.get("project") or payload.get("slug"):
            return 200, validate_project(safe_project_path(str(payload.get("project") or payload.get("slug"))))
        return 200, validate_source_text(str(payload.get("scenesJson") or ""), str(payload.get("bodyHtml") or ""))
    if path == "/api/jobs":
        return 202, start_job(payload)
    return None
