# Agent Instructions

This repository is a HTML video skill package.

## Toolchain policy

All automated browser work, including previews used for capture and video rendering, must use the
Chromium Headless Shell downloaded by the Python `playwright` package with `--only-shell chromium`.
Do not install or launch headed Chromium, and do not launch, automate, detect, or fall back to a
locally installed Edge, Chrome, or other system browser. Do not add browser executable
environment-variable overrides.

All audio/video probing, composition, muxing, and encoding in `pipeline/` must invoke the FFmpeg
binary provided by the Python environment (`imageio-ffmpeg`), never a system `ffmpeg` or `ffprobe`
found on `PATH`. Dependencies and the Playwright Chromium Headless Shell are installed only through
`python main.py install`. A temporary package mirror, when needed, must be supplied as an install
command option and must not be written to user or system package-manager configuration.

Use `SKILL.md` as the entrypoint and `docs/agent-skill.md` as the full workflow and constraints.

This is a skill package. Per-video source folders contain `scenes.json`, a self-contained
`body.html`, optional `media/`, and optional editor-created `captions.json`. The skill package loads
a source folder into `.local/current/` and renders through the stable shell under `themes/default/`.
Content Themes under `docs/content-themes/` guide source generation and never skin Studio. Do not
ask users or web AI to generate `app.js`.

Source folders put project CSS and optional deterministic JavaScript inside `body.html`. They must
start with an `intro` scene, include a short `category` per scene, and keep playback controls,
progress bars, headers, footers, timecodes, and transport UI out of `body.html`.

Before finishing code changes, run:

```bash
python main.py check
```

Do not treat generated files under `.local/`, `assets/`, or `output/` as source.
