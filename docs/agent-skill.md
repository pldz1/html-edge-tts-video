# Agent Workflow

This repository is an HTML video factory. It loads a source folder, generates edge-tts narration and
WordBoundary caption timing, records a stable theme shell in the browser, and muxes the final MP4.

## Source Model

The user/AI video source is a folder anywhere on disk:

```text
source/
  scenes.json
  body.html
  media/ optional
  captions.json optional after manual subtitle edits
```

Do not generate per-video JavaScript. The theme runtime owns timing, captions, preview controls,
the generated chapter rail, and the Playwright render contract.

Studio-managed projects wrap that source contract in a project directory:

```text
.local/work/<8-char-project-id>/
  manifest.json
  scenes.json
  body.html
  media/ optional
  captions.json optional
  generated/ factory-owned audio and timeline cache
  output/ rendered videos
```

The project ID is immutable and internal. The editable display name and TTS settings live in
`manifest.json`; agents and UI should not expose or request a slug.

Do not put preview chrome into video content. Headers, playback buttons, scrubbers, timecodes, and
transport bars belong only to preview UI and must be hidden in render mode.

Tracked reusable factory source:

- `templates/starter/` starter source folder
- `themes/default/` stable HTML shell, runtime, and CSS
- `pipeline/*.py` build scripts
- `tools/` voice preview UI
- `docs/` skill instructions

Ignored local runtime state:

- `.local/current/source/` copied active source
- `.local/current/assets/` active generated TTS/audio cache
- `.local/work/<project-id>/generated/` persisted per-project generated cache
- `.local/work/<project-id>/output/` per-project rendered MP4 files
- `.local/output/` legacy and external-source rendered MP4 files
- `.local/assets/` generated helper assets such as voice previews
- `.local/playwright/` browser capture scratch files

Legacy generated folders such as `.factory/`, `work/`, `assets/`, and `output/` are still ignored
for older checkouts, but new factory output should go under `.local/`.

## Source Files

`scenes.json` controls narration, scene order, and the bottom chapter rail:

```json
[
  {
    "id": "intro",
    "category": "总览",
    "title": "视频从哪里开始",
    "summary": "先说明本视频的切入点和路线。",
    "narration": "中文旁白文本。"
  }
]
```

Required fields:

- `id`: lowercase letters, digits, and hyphens
- `category`: short Chinese label, 2 to 12 characters, used by the generated bottom chapter rail
- `title`: visual scene title
- `summary`: one-sentence visual summary
- `narration`: Chinese spoken narration for edge-tts

The first scene must use `id: "intro"` and introduce what the video starts from, what it will
explain, and the rough route. Do not start a source with a detail-only scene.

`body.html` controls the visual DOM. It must contain one section for each scene id:

```html
<section class="content-scene scene" data-scene="intro">
  <div class="scene-copy">
    <div class="eyebrow">INTRO</div>
    <h1>标题</h1>
    <p class="summary">画面摘要。</p>
  </div>
</section>
```

Useful theme classes:

- `content-scene scene`
- `scene-copy`
- `eyebrow`
- `summary`
- `scene-list`
- `visual-board`
- `visual-grid`
- `step-chip` with `data-step`
- `quote-panel`
- `diagram-flow` with `diagram-node` for pipelines or state transitions
- `comparison-grid` with `comparison-card` for before/after or tradeoffs
- `metric-grid` with `metric-card` and `metric-value` for numbers or rankings
- `formula-strip` with `formula-token` for equations, rules, or decompositions
- `concept-map` with `concept-node` for relationships between ideas
- `diagram-svg` for small inline SVG diagrams when HTML boxes are not enough

Local media should live under `media/` and be referenced relatively, for example
`<img src="media/diagram.png">`.

Prefer explanatory visual structures over text-only slides. Each scene should include a visual aid
that carries part of the explanation: a flow, comparison, map, metric, formula, or compact inline SVG.
Use `<canvas>` only if it is already rendered as an image or backed by allowed media; source folders
must not add JavaScript to draw canvas content.

Do not include `<script>`, inline event handlers, per-scene progress bars, playback controls,
scrubbers, top bars, footer transport UI, or the generated chapter rail in `body.html`. The theme
builds the bottom chapter rail from `scenes.json.category` and the generated `timeline.json`; it
should behave like one continuous progress rail, not one resetting bar per chapter. Keep important
body content clear of the bottom 25% of the frame so captions and chapters have room.

`captions.json` is optional and is created after TTS by the local caption editor. It overrides only
the screen subtitle text, not the narration audio. Do not ask web AI to generate it because web AI
does not know the real WordBoundary timings. If narration changes, rerun TTS before editing
captions again.

## Build Workflow

Start from the tracked starter:

```bash
python main.py tts --source templates/starter
python main.py check
python main.py render --output starter.mp4
```

Create a local editable source:

```bash
python main.py init --target C:\video-sources\my-video
```

Build a source folder:

```bash
python main.py tts --source <source-folder>
python main.py check
python main.py render --output my-video.mp4
```

For a manual subtitle pass:

```bash
python main.py tts --source <source-folder>
python main.py captions --source <source-folder>
python main.py render --source <source-folder> --output my-video.mp4
```

The caption editor writes `captions.json` to the active factory workspace and to the source folder.

For visual-only changes after TTS:

```bash
python main.py load --source <source-folder>
python main.py check
python main.py preview
python main.py render --output my-video.mp4
```

## Theme Runtime Contract

The render pipeline records:

```text
http://127.0.0.1:8765/themes/default/index.html?render=1
```

The theme runtime must expose:

```js
window.compositionReady = true;
window.getCompositionDuration = () => durationInSeconds;
window.renderAtTime = (seconds) => {};
window.startCompositionPlayback = () => {};
```

Do not move this contract into user-generated source.

## Pipeline Guidance

- Use `edge-tts`. Do not replace it with another TTS provider.
- All automated capture uses Python Playwright's installed Chromium. Never use Edge, Chrome, or a
  system-browser executable override.
- All FFmpeg operations use the binary supplied by the Python `imageio-ffmpeg` dependency, never
  `ffmpeg` or `ffprobe` from `PATH`.
- `python main.py install` installs Python dependencies, the managed FFmpeg binary, and Playwright
  Chromium. Use `--pip-index-url` and/or `--playwright-download-host` only for a one-time mirror;
  these options never persist configuration.
- Preserve generated cache under `.local/current/assets/scenes/` while rebuilding the same loaded source.
- Let real audio duration and WordBoundary metadata control the timeline.
- Use `python main.py offline --source <folder>` only when network access is unavailable and a silent estimated preview is acceptable.
- Do not burn subtitles with FFmpeg; captions are HTML DOM in the theme runtime.

## Render Sizes

```bash
python main.py render --size 480p
python main.py render --size 720p
python main.py render --size 1080p
python main.py render --size 2k
python main.py render --size 4k
python main.py render --width 1080 --height 1920 --output vertical.mp4
```

## Web AI Mode

For ChatGPT web, Claude web, Gemini, or another AI that cannot edit files or run Python, use:

```text
docs/web-ai-prompt.md
```

The web AI should output source file contents only: `scenes.json`, `body.html`, and optional
`media/`. It must not generate app/runtime JavaScript or preview controls.
