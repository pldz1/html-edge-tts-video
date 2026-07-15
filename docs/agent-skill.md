# Agent Workflow

This repository loads HTML video source files, generates edge-tts narration and WordBoundary
captions, previews them through a stable browser shell, and renders a local MP4.

## Architecture

Keep these layers separate:

- Studio UI: choose language, Content Theme, renderer, and Prompt target; import and build projects.
- Content Theme: guide AI composition and provide baseline content CSS under `docs/content-themes/`.
- Per-video source: own scene metadata and a self-contained HTML composition, plus optional media.
- Stable shell: own captions, footer, timeline, preview controls, and render functions under
  `themes/default/`.

A Content Theme never skins Studio. Studio only selects it and sends its prompt rules to the agent or
web AI.

## Source Model

```text
source/
  scenes.json
  body.html (styles and optional deterministic JavaScript included)
  media/ optional
  captions.json optional after manual subtitle edits
```

Studio-managed projects additionally contain `manifest.json`, `generated/`, and `output/`.

### scenes.json

Use a non-empty array. Start with `id: "intro"`. Every scene requires:

- `id`: lowercase letters, numbers, and hyphens.
- `category`: a short chapter label in the content language.
- `title`: the visual scene title.
- `summary`: one visual sentence.
- `narration`: natural spoken content.

Preserve technical product names while using the resolved project language for surrounding text.

### Language resolution

Resolve language in this order:

1. Explicit user request.
2. Studio selection.
3. Dominant language of the question/topic for new prompts.
4. Dominant narration language for imported source.
5. Simplified Chinese fallback when no Chinese or English signal exists.

The first version supports only Simplified Chinese (`zh-CN`) and US English (`en-US`). Studio also
offers `auto`, which resolves between those two languages from the question, topic, or narration.

Store `language` and `resolvedLanguage` in the project manifest. Do not silently translate imported
source. Use the resolved language to choose the default edge-tts voice; a saved voice remains an
explicit project override.

### body.html

Use one self-contained `body.html` with a `[data-scene="id"]` section per scene. A fragment or a full
HTML document is accepted. Put project-specific composition, typography, responsive rules, and
visual styling in `<style>`. Keep playback controls, captions, footer, and chapter rail out of it.

Build one dominant composition per scene. Use whitespace, scale, typography, connections, SVG,
media, and spatial grouping. Avoid generic dashboards and deeply nested bordered cards. Validation
warns when card-like component counts exceed the scene complexity budget.

Keep important content in the top 80%. The shell owns the 80%–90% caption band and the bottom 10%
footer allocation; its visible chapter rail uses only a compact portion of that allocation.

### Scripted visuals in body.html

For Canvas, Three.js, WebGL, or other active visuals, add one `<script type="module">` to
`body.html` and export:

```js
export async function mount(context) {}
export function renderAtTime(seconds, context) {}
export function destroy() {}
```

`mount()` receives the root, source scenes, timeline, duration, media base, and render mode. Resolve
only after the first visual frame is ready.

`renderAtTime()` receives absolute composition time and:

```text
scene
sceneIndex
sceneTime
sceneProgress
duration
mediaBase
renderMode
```

Calculate all animated state from those values. Do not start an independent requestAnimationFrame
loop. Pin exact versions in external CDN imports, for example `three@0.180.0` rather than a floating
latest URL.

## Content Themes and Prompt Composer

Each directory under `docs/content-themes/` contains:

```text
theme.json
prompt.md
body.css
```

`theme.json` declares localized labels, allowed engines, and the default engine. `prompt.md` defines
composition grammar and anti-patterns. Its `body.css` supplies a baseline that loads before the
self-contained source document's `<style>`.

Generate prompts from the shared composer:

```bash
python main.py prompt --topic "解释事件循环" --language auto --content-theme tech-schematic --target agent
python main.py prompt --topic "太阳系结构" --language zh-CN --content-theme cinematic-3d --target web-ai
```

Studio `/studio/create` calls the same composer through `/api/prompt`. Do not add a second prompt
implementation to Studio JavaScript or documentation.

Included first-version themes:

- `editorial`: typography, whitespace, and one focal diagram.
- `tech-schematic`: topology, connectors, paths, and annotated SVG.
- `data-story`: one claim driven by a number, chart, scale, or comparison.
- `cinematic-3d`: one spatial Three.js hero visual with restrained DOM text.

## Build Workflow

```bash
python main.py load --source <source-folder>
python main.py check
python main.py tts
python main.py preview
python main.py render --output video.mp4
```

`python main.py tts` infers a default voice from narration when `--voice` is omitted.

For Web AI prompt creation, see `docs/web-ai-prompt.md`.

## Shell and render contract

The stable shell is served from:

```text
http://127.0.0.1:8765/themes/default/index.html
```

Studio listens on `127.0.0.1:8765` by default. Its listener can be configured independently:

```bash
python main.py studio --host 0.0.0.0 --port 9000
```

Browser-facing Studio links are origin-relative so previews and editors continue to use the public
subdomain when Studio is accessed through a reverse proxy. Keep the listener on loopback when the
proxy runs on the same host, and protect internet-facing deployments with TLS and authentication.

Modes:

- Normal URL: standalone preview with controls.
- `?embed=1`: Studio iframe without preview chrome.
- `?render=1`: renderer mode without preview chrome; deterministic shell transitions remain enabled.

The stable shell owns a deterministic dip-to-black between scenes. It calculates transition opacity
from the absolute composition time so preview, seeking, browser recording, and frame rendering match.
Do not add a second scene transition system to per-video source.

The default transition lasts `0.4` seconds and only reaches full black at the cut midpoint; it does
not hold on black. Override it in preview with `?transition=0.3`, or during export with
`python main.py render --transition 0.3`. Use `0` to disable it. Values are clamped to `0`–`2` seconds.

The shell exposes:

```js
window.compositionReady = true;
window.getCompositionDuration = () => durationInSeconds;
window.renderAtTime = seconds => {};
window.startCompositionPlayback = () => {};
```

Keep this contract out of per-video source.

## Toolchain constraints

- Use Python Playwright's managed Chromium Headless Shell for all automated preview and rendering.
- Install only that browser runtime through `python main.py install`, which runs Playwright with
  `--only-shell chromium`; do not install or use headed Chromium, system Chrome, or system Edge.
- Use the FFmpeg binary from `imageio-ffmpeg`, never a system binary from PATH.
- Install dependencies only through `python main.py install`.
- Let actual audio and WordBoundary metadata determine the timeline.
- Render captions as shell DOM, not FFmpeg-burned subtitles.
- Treat `.local/`, `assets/`, and `output/` as generated state, not source.
