#!/usr/bin/env python3
"""Shared helpers for loading video source folders into the factory workspace."""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
LOCAL_WORK = LOCAL / "work"
LOCAL_OUTPUT = LOCAL / "output"
LOCAL_ASSETS = LOCAL / "assets"
LOCAL_PLAYWRIGHT = LOCAL / "playwright"
FACTORY = LOCAL
CURRENT = LOCAL / "current"
CURRENT_SOURCE = CURRENT / "source"
CURRENT_ASSETS = CURRENT / "assets"
CURRENT_META = CURRENT / "project.json"
STARTER_SOURCE = ROOT / "templates" / "starter"
THEMES = ROOT / "themes"
DEFAULT_THEME = "default"


def rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def slug(value: str) -> str:
    out = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")
    return out or "video"


def clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def find_first(source: Path, candidates: list[str]) -> Path | None:
    for candidate in candidates:
        path = source / candidate
        if path.exists():
            return path
    return None


def resolve_source_root(source: Path) -> Path:
    raw = source.expanduser()
    candidates = [raw if raw.is_absolute() else (ROOT / raw)]

    if not raw.is_absolute():
        parts = raw.parts
        if parts and parts[0] == "work":
            candidates.append(LOCAL_WORK.joinpath(*parts[1:]))
        elif parts and parts[0] != ".local":
            candidates.append(LOCAL_WORK / raw)

    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.exists() and resolved.is_dir():
            return resolved

    return candidates[0].resolve()


def resolve_source(source: Path) -> dict[str, Path | None]:
    source = resolve_source_root(source)
    if not source.exists() or not source.is_dir():
        raise SystemExit(f"source folder does not exist: {source}")

    scenes = find_first(source, ["scenes.json", "content/scenes.json"])
    body = find_first(source, ["body.html", "content/body.html", "index.html", "content/index.html"])
    media = find_first(source, ["media", "content/media"])
    captions = find_first(source, ["captions.json", "content/captions.json"])

    if not scenes:
        raise SystemExit(f"source is missing scenes.json: {source}")
    if not body:
        raise SystemExit(f"source is missing body.html: {source}")
    if media and not media.is_dir():
        raise SystemExit(f"media path must be a directory: {media}")

    return {"root": source, "scenes": scenes, "body": body, "media": media, "captions": captions}


def ensure_theme(theme: str) -> Path:
    theme_dir = THEMES / theme
    missing = [name for name in ["index.html", "runtime.js", "theme.css"] if not (theme_dir / name).exists()]
    if missing:
        raise SystemExit(f"theme {theme!r} is missing: {', '.join(missing)}")
    return theme_dir


def load_source(source: Path, theme: str = DEFAULT_THEME) -> None:
    resolved = resolve_source(source)
    ensure_theme(theme)

    clean_dir(CURRENT_SOURCE)
    CURRENT_ASSETS.mkdir(parents=True, exist_ok=True)

    shutil.copy2(resolved["scenes"], CURRENT_SOURCE / "scenes.json")
    shutil.copy2(resolved["body"], CURRENT_SOURCE / "body.html")
    if resolved["captions"]:
        shutil.copy2(resolved["captions"], CURRENT_SOURCE / "captions.json")
    if resolved["media"]:
        shutil.copytree(resolved["media"], CURRENT_SOURCE / "media", dirs_exist_ok=True)

    CURRENT_META.parent.mkdir(parents=True, exist_ok=True)
    CURRENT_META.write_text(
        json.dumps(
            {
                "source": str(resolved["root"]),
                "theme": theme,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Loaded source: {resolved['root']}")
    print(f"Theme: {theme}")
    print(f"Factory workspace: {rel(CURRENT)}")


def ensure_current() -> None:
    missing = []
    for path in [CURRENT_SOURCE / "scenes.json", CURRENT_SOURCE / "body.html"]:
        if not path.exists():
            missing.append(rel(path))
    if missing:
        raise SystemExit(
            "no loaded source; run: python main.py load --source templates/starter "
            f"(missing {', '.join(missing)})"
        )


def active_theme() -> str:
    if CURRENT_META.exists():
        try:
            meta = json.loads(CURRENT_META.read_text(encoding="utf-8"))
            theme = meta.get("theme")
            if isinstance(theme, str) and theme:
                return theme
        except json.JSONDecodeError:
            pass
    return DEFAULT_THEME


def active_source_root() -> Path | None:
    if not CURRENT_META.exists():
        return None
    try:
        meta = json.loads(CURRENT_META.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    source = meta.get("source")
    if not isinstance(source, str) or not source:
        return None
    path = Path(source)
    if path.exists():
        return path
    try:
        legacy_relative = path.resolve().relative_to((ROOT / "work").resolve())
    except ValueError:
        return path
    migrated = LOCAL_WORK / legacy_relative
    return migrated if migrated.exists() else path


def load_scenes() -> list[dict]:
    ensure_current()
    return json.loads((CURRENT_SOURCE / "scenes.json").read_text(encoding="utf-8"))


def theme_url(theme: str | None = None) -> str:
    name = theme or active_theme()
    ensure_theme(name)
    return f"http://127.0.0.1:8765/themes/{name}/index.html"


def output_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    parts = path.parts
    if parts and parts[0] == ".local":
        return ROOT / path
    if parts and parts[0] == "output":
        return LOCAL_OUTPUT.joinpath(*parts[1:])
    return LOCAL_OUTPUT / path
