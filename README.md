# HTML edge-tts Video Skill Package

This repo is a skill package: it loads a video source folder, resolves the content language, generates TTS and caption
timing, records a stable HTML theme shell, then writes an MP4 into the active project's `output/`
folder.

AI output is intentionally small:

```text
my-video-source/
  scenes.json
  body.html (self-contained styles and optional JavaScript)
  media/ optional
  captions.json optional after manual subtitle edits
```

The skill package owns a stable shell:

```text
themes/default/
  index.html
  runtime.js
  theme.css
```

Content Themes live under `docs/content-themes/` and control prompts, project visuals, and allowed
renderers. Select one in `/studio/create` or with `python main.py prompt --content-theme <name>`.

The rendered video is clean: preview controls, scrubbers, headers, timecodes, and transport bars are
hidden in render mode. The bottom chapter rail reads labels from `scenes.json.category`, reads timing
from the generated `timeline.json`, and renders as one continuous progress rail.

## Start Now

Render the tracked starter:

```bash
python main.py tts --source templates/starter
python main.py check
python main.py render --output starter.mp4
```

Studio-managed projects use an immutable 8-character ID and keep their metadata and resources together:

```text
.local/work/a7f31c2d/
  manifest.json
  scenes.json
  body.html (self-contained styles and optional JavaScript)
  media/ optional
  captions.json optional, created by caption editor
  generated/ narration and timeline cache
  output/ rendered videos
```

`manifest.json` owns the editable project name, language, Content Theme, renderer, and TTS settings. The folder ID does not change when
the project is renamed. Standalone source folders outside `.local/work/` remain supported.

Build it:

```bash
python main.py tts --source .local/work/a7f31c2d
python main.py check
python main.py render --output my-video.mp4
```

Edit generated captions like a meeting transcript:

```bash
python main.py captions --source .local/work/a7f31c2d
```

Open:

```text
http://127.0.0.1:8765/captions
```

This creates or updates `captions.json`. It changes only on-screen subtitles, not narration audio.

Use files downloaded from a web AI:

```bash
python main.py tts --source C:\Users\you\Downloads\my-video-source
python main.py check
python main.py render --output my-video.mp4
```

For a Studio-managed project, the final MP4 appears in:

```text
.local/work/<project-id>/output/
```

Standalone external sources continue to use `.local/output/`.

## Source Format

`scenes.json` is the narration, scene order, and chapter rail source:

```json
[
  {
    "id": "intro",
    "category": "总览",
    "title": "视频从哪里开始",
    "summary": "先说明本视频的切入点和路线。",
    "narration": "中文旁白。"
  }
]
```

Rules:

- The first scene must use `id: "intro"` and introduce what the video will cover.
- Every scene needs `category`, `title`, `summary`, and `narration`.
- `category` should be a short label in the selected content language, up to 12 characters.

`body.html` is the self-contained visual content. Add one section per scene and keep project CSS in
`<style>`:

```html
<section class="content-scene scene" data-scene="intro">
  <div class="scene-copy">
    <div class="eyebrow">INTRO</div>
    <h1>标题</h1>
    <p class="summary">画面摘要。</p>
  </div>
</section>
```

Prefer visual explanation over text-only slides. Put structured HTML/CSS/SVG graphics inside
`visual-board`: `diagram-flow`, `comparison-grid`, `metric-grid`, `formula-strip`, `concept-map`, or
small inline SVG diagrams. For Canvas, Three.js, or WebGL, add a `<script type="module">` to
`body.html` and export the deterministic functions documented in `docs/agent-skill.md`.

Do not put app/runtime behavior into `body.html`. Avoid:

```text
app.js
play buttons
scrubbers
timecodes
top bars
transport bars
progress-line
chapter rail markup
```

Local media can be referenced relative to the source folder:

```html
<img src="media/diagram.png" alt="">
```

The theme runtime rebases these URLs when it loads `body.html`.

`captions.json` is optional. It is created by the local caption editor after TTS has generated real
WordBoundary timing. Do not ask a web AI to generate it.

## Normal Loop

When narration changes:

```bash
python main.py tts --source <source-folder>
python main.py check
python main.py render --output my-video.mp4
```

When only `body.html` or media changes:

```bash
python main.py load --source <source-folder>
python main.py check
python main.py preview
python main.py render --output my-video.mp4
```

Stable shell preview URL:

```text
http://127.0.0.1:8765/themes/default/index.html
```

Voice preview URL:

```text
http://127.0.0.1:8765/voices
```

## Commands

```bash
python main.py install        # install Python dependencies, managed FFmpeg, and Playwright Chromium
python main.py init           # copy templates/starter to .local/work/starter
python main.py load --source <folder>
python main.py voices         # list supported edge-tts voices
python main.py voice-preview  # generate local voice samples
python main.py tts --source <folder>
python main.py offline --source <folder>
python main.py preview
python main.py captions       # edit on-screen subtitles from timeline cues
python main.py check
python main.py render --output my-video.mp4
```

To use a mirror for this installation only (without changing global pip or environment settings):

```bash
python main.py install --pip-index-url https://<your-python-mirror>/simple --playwright-download-host https://<your-playwright-mirror>
```

Omit either option to use its default official source. Rendering never uses installed Edge or Chrome;
it launches only the Chromium downloaded by Python Playwright. FFmpeg is supplied by the active Python
environment through `imageio-ffmpeg`, rather than a system `PATH` executable.

Render size examples:

```bash
python main.py render --size 1080p --output tutorial-1080p.mp4
python main.py render --width 1080 --height 1920 --output vertical.mp4
```

Scene transitions default to a deterministic `0.4` second dip-to-black with no black hold. Adjust
exports with `--transition 0.3`, or disable transitions with `--transition 0`.

## Build Workspace

`main.py tts --source <folder>` copies source files into:

```text
.local/current/source/
```

and writes generated audio/timeline into the active cache:

```text
.local/current/assets/
```

For a managed project this cache is mirrored to `.local/work/<project-id>/generated/`. These folders
are ignored build state, not authored source.

## Git Boundary

Do not commit generated or local work:

```text
.local/
```

Legacy compatibility paths are also ignored for older checkouts:

```text
.factory/
work/
assets/
output/
```

Commit reusable skill-package changes here:

```text
SKILL.md
agents/
DESIGN.md
docs/
main.py
pipeline/
templates/starter/
themes/
studio/
```

`main.py` is the single CLI entrypoint.
