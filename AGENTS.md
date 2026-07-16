# Agent Instructions

This repository is a HTML video skill package.

## Toolchain policy

All automated browser work, including previews used for capture and video rendering, must use the
Chromium Headless Shell downloaded by the Python `playwright` package with `--only-shell chromium`.
Do not install or launch headed Chromium, and do not launch, automate, detect, or fall back to a
locally installed Edge, Chrome, or other system browser. Do not add browser executable
environment-variable overrides.

All Python Playwright state must stay under `.local/playwright/`. This includes the managed browser
store (`browsers/`), recordings, temporary profiles, screenshots, traces, and render scratch files.
Code agents must use this project-local cache for any Playwright automation or diagnostics and must
not populate Playwright's user-level cache. `PLAYWRIGHT_BROWSERS_PATH` may be set only by the
project's Python entrypoints to `.local/playwright/browsers`; it is a managed-cache location, not a
browser executable override.

All audio/video probing, composition, muxing, and encoding in `pipeline/` must invoke the FFmpeg
binary provided by the Python environment (`imageio-ffmpeg`), never a system `ffmpeg` or `ffprobe`
found on `PATH`. Dependencies and the Playwright Chromium Headless Shell are installed only through
`python main.py install`. A temporary package mirror, when needed, must be supplied as an install
command option and must not be written to user or system package-manager configuration.

Use `SKILL.md` as the entrypoint and `docs/agent-skill.md` as the full workflow and constraints.

This is a skill package. Per-video source folders contain `scenes.json`, a self-contained
`body.html`, optional `media/`, optional editor-created `captions.json`, an untracked Studio
`manifest.json`, and project-local `generated/` and `output/` directories. Pipeline commands and the
stable shell under `pipeline/shell/` read the selected project directly. Do not recreate a
`.local/current/` mirror or copy project source into a global runtime workspace.
Use the single prompt template under `docs/source-prompt.md` and let AI choose presentation styling
from the subject. Do not ask users or web AI to generate `app.js`.

Source folders put project CSS and optional deterministic JavaScript inside `body.html`. They must
start with an `intro` scene, include a short `category` per scene, and keep playback controls,
progress bars, headers, footers, timecodes, and transport UI out of `body.html`.
Choose `16:9` (default) or `9:16` when creating a project and persist it as the manifest's immutable
`aspectRatio`; never retrofit orientation by changing render dimensions. Create portrait agent
projects with `python main.py init --target <folder> --aspect-ratio 9:16`. For portrait projects,
keep each `category` to 2-3 CJK characters or one short English word of at most 8 letters.

Before finishing code changes, run:

```bash
python main.py check
```

Only `.local/work/starter/body.html` and `scenes.json` are tracked source under `.local/`. The
starter manifest is generated locally with `active: true` on first use and is not tracked. Treat all
other files under `.local/`, `assets/`, or `output/` as generated state.
