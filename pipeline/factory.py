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
PROJECT_MANIFEST_FILE = "manifest.json"
PROJECT_GENERATED_DIR = "generated"
PROJECT_OUTPUT_DIR = "output"
STARTER_SOURCE = ROOT / "templates" / "starter"
THEMES = ROOT / "themes"
DEFAULT_THEME = "default"
THEME_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


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


def is_local_project(path: Path) -> bool:
    try:
        path.resolve().relative_to(LOCAL_WORK.resolve())
        return True
    except ValueError:
        return False


def project_generated_dir(path: Path) -> Path | None:
    return path.resolve() / PROJECT_GENERATED_DIR if is_local_project(path) else None


def project_output_dir(path: Path) -> Path | None:
    return path.resolve() / PROJECT_OUTPUT_DIR if is_local_project(path) else None


def persist_current_assets(source: Path | None = None) -> None:
    source_root = source or active_source_root()
    if not source_root or not CURRENT_ASSETS.exists():
        return
    target = project_generated_dir(source_root)
    if not target:
        return
    clean_dir(target)
    shutil.copytree(CURRENT_ASSETS, target, dirs_exist_ok=True)


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
    body_css = find_first(source, ["body.css", "content/body.css"])
    visual_js = find_first(source, ["visual.js", "content/visual.js"])
    media = find_first(source, ["media", "content/media"])
    captions = find_first(source, ["captions.json", "content/captions.json"])

    if not scenes:
        raise SystemExit(f"source is missing scenes.json: {source}")
    if not body:
        raise SystemExit(f"source is missing body.html: {source}")
    if media and not media.is_dir():
        raise SystemExit(f"media path must be a directory: {media}")

    return {
        "root": source,
        "scenes": scenes,
        "body": body,
        "body_css": body_css,
        "visual_js": visual_js,
        "media": media,
        "captions": captions,
    }


def ensure_theme(theme: str) -> Path:
    if not THEME_NAME_RE.fullmatch(theme):
        raise SystemExit(f"invalid theme name: {theme!r}")
    theme_dir = THEMES / theme
    missing = [name for name in ["index.html", "theme.css"] if not (theme_dir / name).exists()]
    if missing:
        raise SystemExit(f"theme {theme!r} is missing: {', '.join(missing)}")
    return theme_dir


def theme_runtime(theme: str) -> Path:
    theme_dir = ensure_theme(theme)
    runtime = theme_dir / "runtime.js"
    if runtime.exists():
        return runtime
    fallback = THEMES / DEFAULT_THEME / "runtime.js"
    if not fallback.exists():
        raise SystemExit(f"theme {theme!r} has no runtime.js and the default runtime is missing")
    return fallback


def list_themes() -> list[dict[str, str | bool]]:
    if not THEMES.exists():
        return []
    result = []
    for theme_dir in sorted(THEMES.iterdir(), key=lambda path: path.name):
        if not theme_dir.is_dir() or not THEME_NAME_RE.fullmatch(theme_dir.name):
            continue
        try:
            ensure_theme(theme_dir.name)
            runtime = theme_runtime(theme_dir.name)
        except SystemExit:
            continue
        index_source = (theme_dir / "index.html").read_text(encoding="utf-8")
        if runtime.parent == theme_dir:
            if "runtime.js" not in index_source:
                continue
        elif "../default/runtime.js" not in index_source:
            continue
        result.append(
            {
                "id": theme_dir.name,
                "label": theme_dir.name.replace("-", " ").title(),
                "inheritsRuntime": not (theme_dir / "runtime.js").exists(),
            }
        )
    return result


def load_source(
    source: Path,
    theme: str = DEFAULT_THEME,
    *,
    content_theme: str | None = None,
    language: str | None = None,
    engine: str | None = None,
) -> None:
    resolved = resolve_source(source)
    ensure_theme(theme)
    source_manifest = resolved["root"] / PROJECT_MANIFEST_FILE
    try:
        manifest = json.loads(source_manifest.read_text(encoding="utf-8")) if source_manifest.exists() else {}
    except json.JSONDecodeError:
        manifest = {}
    content_theme = content_theme or str(manifest.get("contentTheme") or "editorial")
    language = language or str(manifest.get("resolvedLanguage") or manifest.get("language") or "auto")
    engine = engine or str(manifest.get("engine") or "dom")
    previous_source = active_source_root()
    same_source = bool(previous_source and previous_source.resolve() == resolved["root"].resolve())

    if previous_source and not same_source:
        persist_current_assets(previous_source)

    clean_dir(CURRENT_SOURCE)
    if same_source:
        CURRENT_ASSETS.mkdir(parents=True, exist_ok=True)
    else:
        clean_dir(CURRENT_ASSETS)
        generated = project_generated_dir(resolved["root"])
        if generated and generated.exists():
            shutil.copytree(generated, CURRENT_ASSETS, dirs_exist_ok=True)

    shutil.copy2(resolved["scenes"], CURRENT_SOURCE / "scenes.json")
    shutil.copy2(resolved["body"], CURRENT_SOURCE / "body.html")
    if resolved["body_css"]:
        shutil.copy2(resolved["body_css"], CURRENT_SOURCE / "body.css")
    if resolved["visual_js"]:
        shutil.copy2(resolved["visual_js"], CURRENT_SOURCE / "visual.js")
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
                "content_theme": content_theme,
                "language": language,
                "engine": engine,
                "loaded_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Loaded source: {resolved['root']}")
    print(f"Theme: {theme}")
    print(f"Content theme: {content_theme} ({engine}, {language})")
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


def active_content_settings() -> dict[str, str]:
    defaults = {"contentTheme": "editorial", "language": "auto", "engine": "dom"}
    if not CURRENT_META.exists():
        return defaults
    try:
        meta = json.loads(CURRENT_META.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return defaults
    return {
        "contentTheme": str(meta.get("content_theme") or defaults["contentTheme"]),
        "language": str(meta.get("language") or defaults["language"]),
        "engine": str(meta.get("engine") or defaults["engine"]),
    }


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


def theme_path(theme: str | None = None) -> str:
    name = theme or active_theme()
    ensure_theme(name)
    return f"/themes/{name}/index.html"


def theme_url(theme: str | None = None) -> str:
    """Return the private renderer URL used by the local capture pipeline."""
    return f"http://127.0.0.1:8765{theme_path(theme)}"


def output_path(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    parts = path.parts
    if parts and parts[0] == ".local":
        return ROOT / path
    if parts and parts[0] == "output":
        return LOCAL_OUTPUT.joinpath(*parts[1:])
    source = active_source_root()
    project_output = project_output_dir(source) if source else None
    return (project_output or LOCAL_OUTPUT) / path
