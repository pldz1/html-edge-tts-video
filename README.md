# HTML edge-tts Video

<img
  src="./studio/web/shared/app.svg"
  alt="app logo"
  style="width: 100%; height: 200px; object-fit: contain;"
/>

---

Create narrated presentation-style videos from two authored files:

```text
.local/work/my-video/
  manifest.json generated when the project is created
  scenes.json
  body.html
  media/ optional
  captions.json optional
  generated/ timeline and narration cache
  output/ rendered videos
```

`scenes.json` owns scene order, chapter labels, and narration. `body.html` owns every visible title,
layout, color, diagram, chart, and optional deterministic visual module. The stable shell owns TTS
timing, captions, playback, chapter progress, scene transitions, and MP4 rendering.
Each manifest fixes `aspectRatio` to `16:9` (default landscape) or `9:16` (portrait) when the
project is created. Create a new project to change orientation.

![preview](https://pldz1.com/api/v1/website/image/live-demo/html-2-tts-video-preview.gif@raw)

## Install

```bash
python main.py install
```

This installs Python dependencies, `imageio-ffmpeg`, and only Playwright's Chromium Headless Shell.
The Headless Shell and every Playwright recording, profile, screenshot, trace, and temporary file
stay under `.local/playwright/`. The pipeline never uses a system browser, Playwright's user-level
browser cache, or system FFmpeg.

## Try the starter source

The tracked starter is a read-only example. Copy it into a project folder before making changes:

```bash
python main.py init --target .local/work/my-video
python main.py check --source .local/work/my-video
```

For a portrait project, choose the orientation at creation time:

```bash
python main.py init --target .local/work/my-portrait-video --aspect-ratio 9:16
```

Use `offline` only when you want a silent estimated timeline for layout preview:

```bash
python main.py offline --source .local/work/my-video
```

For a narrated final MP4, generate TTS first and keep the source explicit when rendering:

```bash
python main.py tts --source .local/work/my-video
python main.py render --source .local/work/my-video --size 720p --output my-video.mp4
```

The rendered file is `.local/work/my-video/output/my-video.mp4`. `--output` accepts a filename, not
a path; renders always stay inside the selected project's `output/` directory.

## Source format

```json
[
  {
    "id": "intro",
    "category": "总览",
    "narration": "先介绍视频将说明什么。"
  }
]
```

The first id must be `intro`. Landscape categories must stay within 12 CJK characters or about 24 Latin
characters. Portrait categories use 2-3 CJK characters or one English word of at most 8 letters so
the shell's one-line chapter rail remains readable.
Add a matching section and all project CSS to `body.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Presentation video</title>
    <style>
      .slide {
        position: absolute;
        inset: 0;
        padding: 8vh 7vw 22vh;
      }
    </style>
  </head>
  <body>
    <section class="content-scene slide" data-scene="intro">
      <h1>标题</h1>
    </section>
  </body>
</html>
```

Do not hard-code `active` or `is-active` on a scene. The shell selects exactly one scene from the
timeline and owns scene visibility. Scope source CSS to `#stage` and scene elements; global `html`
or `body` rules can interfere with the shell and are not supported.

Do not add playback controls, captions, footers, timecodes, chapter rails, or scene transitions.
Prefer HTML/CSS/SVG. An advanced visual may use one inline module exporting deterministic `mount()`
and `renderAtTime()` functions; see `docs/agent-skill.md`.

## Generate an AI prompt

```bash
python main.py prompt --topic "介绍一个新产品" --language zh-CN
python main.py prompt --topic "Explain event loops" --language en-US
```

The single template is `docs/source-prompt.md`. It keeps the visual language consistently bright,
editorial, and blue-green while allowing the AI to choose a fitting composition for each subject.
Studio and the prompt CLI generate one Web AI delivery form for copying into a browser-based AI.
Code agents follow `SKILL.md` and `docs/agent-skill.md` directly instead of generating a prompt.

## Normal loop

```bash
python main.py tts --source .local/work/<project-slug>
python main.py check --source .local/work/<project-slug>
python main.py studio --source .local/work/<project-slug>
python main.py render --source .local/work/<project-slug> --output video.mp4
```

Use `python main.py captions --source .local/work/<project-slug>` to edit on-screen subtitle text
after TTS. Generated state lives under `.local/`; Studio-managed projects keep generated audio and
output beside their two source files.
The only tracked exception is `.local/work/starter/body.html` and `scenes.json`; every other file
under `.local/` is runtime state. Never author a video in `starter`; each video belongs in its own
`.local/work/<project-slug>/` folder.

Transitions default to a deterministic 0.4-second dip to the shell background. Set
`--transition 0.3`, or use `--transition 0` to disable them.

## Architecture

```text
scenes.json + body.html
  -> direct project source
  -> edge-tts or offline timeline
  -> <project>/generated/
  -> pipeline/shell/runtime.js
  -> Playwright Chromium Headless Shell
  -> imageio-ffmpeg
  -> <project>/output/*.mp4
```

The authored source owns content and presentation styling. The stable shell owns captions, chapter
progress, playback, timing, and transitions. Generated audio and timelines are caches rather than
source. Studio adds project metadata and editing UI without changing the two-file contract.

### Source loading and validation

`pipeline/factory.py` resolves `scenes.json`, `body.html`, optional `media/`, optional
`captions.json`, project-local `generated/`, and project-local `output/`. It does not copy source into
a global current workspace. The shell receives an explicit project base URL for Studio previews and
Playwright renders.

`pipeline/validate_sources.py` checks scene ids, the `intro` first scene, short categories,
narration, matching `[data-scene]` sections, embedded CSS, and the absence of transport UI. Source
may contain at most one inline module script. It must export `mount()` and `renderAtTime()`, avoid an
independent animation loop, and pin Three.js versions.

Sidecar `body.css`, `visual.js`, nested `content/`, and `index.html` paths are not supported.

### Prompt, timeline, and rendering

`pipeline/prompt_composer.py` fills `docs/source-prompt.md` with the requested content parameters.
Agents write the two files directly; web AI returns two fenced code blocks. The prompt keeps a
consistent bright blue-green editorial palette while allowing scene composition to follow the topic.

`pipeline/build_tts.py` synthesizes scenes, captures WordBoundary metadata, inserts scene gaps, and
concatenates narration using managed FFmpeg. `pipeline/build_offline_preview.py` produces the same
timeline shape with estimated durations and silent audio.

`pipeline/shell/runtime.js` loads source, activates scenes by absolute time, applies captions,
updates chapter progress, and calculates transitions. It exposes:

```js
window.compositionReady;
window.getCompositionDuration();
window.renderAtTime(seconds);
window.getPlaybackState();
window.togglePlayback();
window.startCompositionPlayback();
```

`pipeline/render_video.py` captures with Python Playwright's managed Chromium Headless Shell and
muxes with the FFmpeg binary returned by `imageio-ffmpeg`. It never uses a system browser or FFmpeg
from `PATH`.

### Studio

Studio creates, imports, deletes, validates, plays, narrates, and renders projects. “New project”
first offers AI creation or result import; neither path creates a folder until “Save and activate” is
used in the import dialog. Saving validates both source files, creates one eight-character Studio
project directory, writes its manifest, and activates it in one operation. Prompt creation and
source import open as dialogs without leaving the workspace.

A project manifest stores identity, display name, the single Studio `active` selection, immutable
`aspectRatio`, language, and TTS settings. Studio asks for 16:9 or 9:16 before prompt generation or
import, defaults to 16:9, and disables that choice when an existing project is edited. Resolution
presets automatically swap width and height for portrait renders. The starter manifest is generated
locally with `active: true` and `aspectRatio: "16:9"` on first use and is
not tracked by Git. Selecting a project only updates manifest state. Agent-created kebab-case
project folders keep their directory names when Studio discovers them. Presentation style and
rendering engine remain properties of `body.html`. The built-in `starter` project is read-only and
cannot be deleted through Studio.

Voice previews are independent of project selection and live under `.local/voice-preview/`.

## Checks and diagnostics

```bash
python main.py check
python main.py check --source .local/work/<project-slug>
python main.py doctor
python main.py smoke
```

`check` is a fast static gate: it validates the starter (or the explicit source), the stable shell
contract, JavaScript syntax, and Python compilation. `doctor` launches the managed Chromium
Headless Shell and verifies the bundled FFmpeg plus project-local browser cache. `smoke` starts a
temporary Studio server and loads the active composition in the managed headless browser.
