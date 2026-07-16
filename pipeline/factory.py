#!/usr/bin/env python3
"""Shared project and runtime path helpers for the HTML video factory."""
from __future__ import annotations

import json
import hashlib
import os
import re
import time
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
LOCAL_WORK = LOCAL / "work"
LOCAL_PLAYWRIGHT = LOCAL / "playwright"
PLAYWRIGHT_BROWSERS = LOCAL_PLAYWRIGHT / "browsers"
PLAYWRIGHT_RECORDINGS = LOCAL_PLAYWRIGHT / "recordings"
PLAYWRIGHT_PROFILES = LOCAL_PLAYWRIGHT / "profiles"
PLAYWRIGHT_SCREENSHOTS = LOCAL_PLAYWRIGHT / "screenshots"
PLAYWRIGHT_TRACES = LOCAL_PLAYWRIGHT / "traces"
PLAYWRIGHT_TMP = LOCAL_PLAYWRIGHT / "tmp"
PROJECT_MANIFEST_FILE = "manifest.json"
PROJECT_GENERATED_DIR = "generated"
PROJECT_OUTPUT_DIR = "output"
DEFAULT_ASPECT_RATIO = "16:9"
ASPECT_RATIOS = ("16:9", "9:16")
STARTER_SOURCE = LOCAL_WORK / "starter"
SHELL = Path(__file__).resolve().parent / "shell"
SHELL_PATH = "/pipeline/shell/index.html"

ACTIVE_PROJECT_LOCK = threading.RLock()


@dataclass(frozen=True)
class ProjectPaths:
    root: Path
    scenes: Path
    body: Path
    media: Path
    captions: Path
    manifest: Path
    generated: Path
    output: Path


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def slug(value: str) -> str:
    out = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")
    return out or "video"


def atomic_write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    replace_with_retry(temp, path)


def atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    temp.write_text(value, encoding="utf-8")
    replace_with_retry(temp, path)


def replace_with_retry(temp: Path, target: Path) -> None:
    for attempt in range(6):
        try:
            temp.replace(target)
            return
        except PermissionError:
            if attempt == 5:
                temp.unlink(missing_ok=True)
                raise
            time.sleep(0.04 * (attempt + 1))


def read_json(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def is_local_project(path: Path) -> bool:
    try:
        path.resolve().relative_to(LOCAL_WORK.resolve())
        return True
    except ValueError:
        return False


def project_generated_dir(path: Path) -> Path:
    return path.resolve() / PROJECT_GENERATED_DIR


def project_output_dir(path: Path) -> Path:
    return path.resolve() / PROJECT_OUTPUT_DIR


def normalize_aspect_ratio(value: object = None) -> str:
    """Return the canonical immutable project aspect ratio."""
    raw = str(value or DEFAULT_ASPECT_RATIO).strip().replace(" ", "")
    aliases = {
        "landscape": "16:9",
        "horizontal": "16:9",
        "portrait": "9:16",
        "vertical": "9:16",
    }
    normalized = aliases.get(raw.lower(), raw)
    if normalized not in ASPECT_RATIOS:
        raise ValueError("aspectRatio must be 16:9 or 9:16")
    return normalized


def default_manifest(source_root: Path, *, active: bool = False) -> dict:
    starter = source_root.resolve() == STARTER_SOURCE.resolve()
    now = datetime.now(timezone.utc).isoformat()
    folder_id = source_root.name.lower()
    project_id = (
        folder_id
        if re.fullmatch(r"[0-9a-f]{8}", folder_id)
        else hashlib.sha256(str(source_root.resolve()).encode("utf-8")).hexdigest()[:8]
    )
    return {
        "version": 5,
        "id": "starter" if starter else project_id,
        "name": "Starter" if starter else source_root.name,
        "active": active,
        "system": starter,
        "readOnly": starter,
        "aspectRatio": DEFAULT_ASPECT_RATIO,
        "language": "auto",
        "resolvedLanguage": "zh-CN" if starter else "en-US",
        "createdAt": now,
        "updatedAt": now,
        "activatedAt": now if active else None,
        "tts": {
            "voice": "zh-CN-XiaoxiaoNeural" if starter else "en-US-JennyNeural",
            "rate": "+12%",
            "pitch": "+0Hz",
            "gap": "0.28",
        },
    }


def ensure_starter_manifest() -> dict:
    if not STARTER_SOURCE.exists():
        raise SystemExit(f"starter source is missing: {STARTER_SOURCE}")
    path = STARTER_SOURCE / PROJECT_MANIFEST_FILE
    existing = read_json(path)
    if isinstance(existing, dict):
        manifest = {**default_manifest(STARTER_SOURCE), **existing}
        manifest.update({
            "id": "starter",
            "system": True,
            "readOnly": True,
            "aspectRatio": DEFAULT_ASPECT_RATIO,
            "version": 5,
        })
    else:
        other_active = False
        if LOCAL_WORK.exists():
            other_active = any(
                isinstance(data := read_json(child / PROJECT_MANIFEST_FILE), dict)
                and data.get("active") is True
                for child in LOCAL_WORK.iterdir()
                if child.is_dir() and child.resolve() != STARTER_SOURCE.resolve()
            )
        manifest = default_manifest(STARTER_SOURCE, active=not other_active)
    if manifest != existing:
        atomic_write_json(path, manifest)
    return manifest


def iter_project_roots() -> list[Path]:
    LOCAL_WORK.mkdir(parents=True, exist_ok=True)
    roots = [
        child
        for child in LOCAL_WORK.iterdir()
        if not child.name.startswith(".")
        and child.is_dir()
        and (child / "scenes.json").exists()
        and (child / "body.html").exists()
    ]
    return sorted(roots, key=lambda item: (item.resolve() != STARTER_SOURCE.resolve(), item.name.lower()))


def active_source_root() -> Path:
    """Return the selected project without creating a mirrored workspace."""
    ensure_starter_manifest()
    candidates: list[tuple[str, Path]] = []
    for root in iter_project_roots():
        manifest = read_json(root / PROJECT_MANIFEST_FILE)
        if isinstance(manifest, dict) and manifest.get("active") is True:
            candidates.append((str(manifest.get("activatedAt") or ""), root))
    if not candidates:
        activate_source(STARTER_SOURCE)
        return STARTER_SOURCE.resolve()
    return max(candidates, key=lambda item: item[0])[1].resolve()


def activate_source(source: Path) -> Path:
    """Persist one active project. A later reconciliation repairs interrupted multi-file writes."""
    with ACTIVE_PROJECT_LOCK:
        target = resolve_source_root(source)
        if not is_local_project(target):
            return target
        now = datetime.now(timezone.utc).isoformat()
        roots = iter_project_roots()
        if target not in [item.resolve() for item in roots]:
            roots.append(target)
        for root in roots:
            path = root / PROJECT_MANIFEST_FILE
            existing = read_json(path)
            manifest = existing if isinstance(existing, dict) else default_manifest(root)
            selected = root.resolve() == target.resolve()
            changed = manifest.get("active") is not selected
            manifest["active"] = selected
            if selected:
                manifest["activatedAt"] = now
            if changed or not path.exists():
                atomic_write_json(path, manifest)
        return target


def reconcile_active_project(*, repair: bool = True) -> Path:
    """Ensure Studio has exactly one active project, falling back to starter."""
    with ACTIVE_PROJECT_LOCK:
        ensure_starter_manifest()
        roots = iter_project_roots()
        active: list[tuple[str, Path]] = []
        for root in roots:
            data = read_json(root / PROJECT_MANIFEST_FILE)
            if isinstance(data, dict) and data.get("active") is True:
                active.append((str(data.get("activatedAt") or ""), root))
        winner = max(active, key=lambda item: item[0])[1] if active else STARTER_SOURCE
        if repair and len(active) != 1:
            activate_source(winner)
        return winner.resolve()


def resolve_source_root(source: Path) -> Path:
    raw = source.expanduser()
    return (raw if raw.is_absolute() else ROOT / raw).resolve()


def resolve_source(source: Path) -> dict[str, Path | None]:
    root = resolve_source_root(source)
    if not root.exists() or not root.is_dir():
        raise SystemExit(f"source folder does not exist: {root}")
    scenes = root / "scenes.json"
    body = root / "body.html"
    media = root / "media"
    captions = root / "captions.json"
    if not scenes.exists():
        raise SystemExit(f"source is missing scenes.json: {root}")
    if not body.exists():
        raise SystemExit(f"source is missing body.html: {root}")
    if media.exists() and not media.is_dir():
        raise SystemExit(f"media path must be a directory: {media}")
    return {
        "root": root,
        "scenes": scenes,
        "body": body,
        "media": media if media.exists() else None,
        "captions": captions if captions.exists() else None,
        "manifest": root / PROJECT_MANIFEST_FILE,
        "generated": project_generated_dir(root),
        "output": project_output_dir(root),
    }


def project_paths(source: Path | None = None) -> ProjectPaths:
    resolved = resolve_source(source or active_source_root())
    root = resolved["root"]
    assert isinstance(root, Path)
    return ProjectPaths(
        root=root,
        scenes=resolved["scenes"],
        body=resolved["body"],
        media=root / "media",
        captions=root / "captions.json",
        manifest=root / PROJECT_MANIFEST_FILE,
        generated=root / PROJECT_GENERATED_DIR,
        output=root / PROJECT_OUTPUT_DIR,
    )


def ensure_shell() -> Path:
    missing = [name for name in ["index.html", "shell.css", "runtime.js"] if not (SHELL / name).exists()]
    if missing:
        raise SystemExit(f"render shell is missing: {', '.join(missing)}")
    return SHELL


def load_source(source: Path, *, language: str | None = None) -> None:
    """Validate and select a project without copying it."""
    del language
    resolved = resolve_source(source)
    root = resolved["root"]
    assert isinstance(root, Path)
    ensure_shell()
    if is_local_project(root):
        activate_source(root)
    print(f"Selected source: {root}")
    print("Runtime mode: direct project paths")


def load_scenes(source: Path | None = None) -> list[dict]:
    return json.loads(project_paths(source).scenes.read_text(encoding="utf-8"))


def shell_path() -> str:
    ensure_shell()
    return SHELL_PATH


def project_web_base(source: Path) -> str:
    try:
        relative = source.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return "/__project__"
    return f"/{quote(relative, safe='/')}"


def shell_url(source: Path | None = None) -> str:
    """Return the renderer URL with an explicit project base."""
    root = project_paths(source).root
    base = quote(project_web_base(root), safe="")
    return f"http://127.0.0.1:8765{shell_path()}?projectBase={base}"


def shell_relative_url(source: Path | None = None) -> str:
    root = project_paths(source).root
    base = quote(project_web_base(root), safe="")
    return f"{shell_path()}?projectBase={base}"


def output_path(value: str, source: Path | None = None) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute() or path.drive or len(path.parts) != 1 or path.name in {"", ".", ".."}:
        raise SystemExit("--output must be a filename; renders are always written to the project's output directory")
    return project_paths(source).output / path
