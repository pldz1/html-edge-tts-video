#!/usr/bin/env python3
"""Resolve the Python-managed binaries used by the video pipeline."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

try:
    from .factory import LOCAL_PLAYWRIGHT, PLAYWRIGHT_BROWSERS
except ImportError:  # Direct script execution
    from factory import LOCAL_PLAYWRIGHT, PLAYWRIGHT_BROWSERS


_DURATION_RE = re.compile(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)")


def configure_playwright_environment(env: dict[str, str] | None = None) -> dict[str, str]:
    """Pin Python Playwright's managed browser store to the project-local cache."""
    LOCAL_PLAYWRIGHT.mkdir(parents=True, exist_ok=True)
    PLAYWRIGHT_BROWSERS.mkdir(parents=True, exist_ok=True)
    target = os.environ if env is None else env
    target["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS.resolve())
    return target


def ffmpeg_executable() -> str:
    """Return FFmpeg installed with the active Python environment."""
    executable = Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve()
    bundled_dir = Path(imageio_ffmpeg.__file__).resolve().parent / "binaries"
    try:
        executable.relative_to(bundled_dir)
    except ValueError as exc:
        raise RuntimeError(
            "The pipeline requires the FFmpeg bundled with imageio-ffmpeg; "
            "system PATH and IMAGEIO_FFMPEG_EXE overrides are not supported. "
            "Run: python main.py install"
        ) from exc
    return str(executable)


def media_duration(path: Path) -> float:
    """Read duration with the managed FFmpeg binary, without a system ffprobe dependency."""
    process = subprocess.run(
        [ffmpeg_executable(), "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    match = _DURATION_RE.search(process.stderr)
    if not match:
        raise RuntimeError(f"FFmpeg could not determine duration for: {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
