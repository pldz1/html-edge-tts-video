# Agent Workflow

This package turns two authored files into a narrated presentation-style MP4. Keep the authored
source separate from the stable shell and generated assets. Each video must have its own project
folder under `.local/work`; `.local/work/starter/` is a read-only tracked template and must never be
edited as a project.

## Source contract

```text
.local/work/<project-slug>/
  scenes.json
  body.html
  media/ optional
  captions.json optional after manual subtitle edits
```

Choose a unique kebab-case `<project-slug>` before writing any source. Create the project with:

```bash
python main.py init --target .local/work/<project-slug>
```

Then edit only the copied files in that new project folder. Never target `.local/work/starter/` and
never place a video's `scenes.json` or `body.html` directly in `.local/work/`.

`scenes.json` must be a non-empty array. Start with `id: "intro"`. Require:

- `id`: unique lowercase letters, numbers, and hyphens.
- `category`: a short chapter label, within 12 CJK characters or about 24 Latin characters.
- `narration`: natural spoken content.

Visible titles, summaries, labels, charts, and diagrams belong in `body.html`, not duplicated scene
metadata. Write `body.html` as a complete document from `<!doctype html>` through `</html>`. Use one
`<section class="content-scene" data-scene="id">` per scene, do not hard-code an
initial active class, and include all project CSS in `<style>`.
Keep important content in the top 80%; the shell reserves the lower area for captions and chapters.
Scope source layout and backgrounds to `#stage` or scene elements; never style `html`, `body`, shell
controls, captions, or chapter elements from `body.html`.

Use a bright editorial blackboard/newspaper palette: pale blue, mint, seafoam, warm white, and dark
teal ink, with one restrained warm or medium-blue accent. Avoid dark full-frame backgrounds, neon,
and glassmorphism. Let the stable shell supply the subtle grid and 16:9 frame border; keep source
backgrounds transparent or lightly tinted. Prefer one idea per slide, strong hierarchy, whitespace,
controlled typography, and an explanatory visual. Keep ordinary titles at or below
64px, multi-column titles at or below 56px, and reserve up to 88px for short intro headlines. Build
repeated columns with container Grid tracks such as `minmax(0, 1fr)`, not fixed `vw` card widths.
Avoid dashboards, control panels, card walls, nested boxes, horizontal overflow, and transport UI.

## Optional scripted visuals

Prefer HTML, CSS, and SVG. When Canvas or WebGL materially improves the explanation, include at
most one inline `<script type="module">` and export:

```js
export async function mount(context) {}
export function renderAtTime(seconds, context) {}
export function destroy() {}
```

Derive every frame from `seconds`, `sceneTime`, and `sceneProgress`. Do not start an independent
`requestAnimationFrame` loop. Pin exact dependency versions. The module receives the root, scenes,
timeline, duration, media base, render mode, active scene, scene index, and scene progress.

## Language

Follow an explicit user choice, then a saved Studio choice, then infer the dominant language from
the request or imported narration. Support `zh-CN` and `en-US`. Do not silently translate imported
source. Let the resolved language choose the default edge-tts voice.

## Build

```bash
python main.py check --source .local/work/<project-slug>
python main.py tts --source .local/work/<project-slug>
python main.py studio --source .local/work/<project-slug>
python main.py render --source .local/work/<project-slug> --output video.mp4
```

Use `python main.py offline --source <source-folder>` for a silent estimated timeline. Use
`python main.py prompt --topic "<topic>" --target agent` to compose the single canonical source
prompt from `docs/source-prompt.md`.

The shell URL `http://127.0.0.1:8765/pipeline/shell/index.html` is an internal Studio/rendering
surface. Studio owns interactive playback; `?render=1` enables deterministic rendering.

The shell owns the scene transition. It defaults to 0.4 seconds and derives opacity from absolute
composition time. Change it with `--transition`, or use `0` to disable it. Do not add a second
transition system to source files.

## Toolchain

- Install dependencies only with `python main.py install`.
- Use Python Playwright's Chromium Headless Shell installed with `--only-shell chromium`.
- Keep the managed browser, recordings, profiles, screenshots, traces, and temporary Playwright
  files under `.local/playwright/`; never use Playwright's user-level cache or a system browser.
- Use only the FFmpeg binary bundled by `imageio-ffmpeg`.
- Let actual audio and WordBoundary metadata determine the final timeline.
- Render captions as shell DOM.
- Treat `.local/`, `assets/`, and `output/` as generated state, except for the tracked two-file
  starter at `.local/work/starter/`.
- Never modify the tracked starter while creating a video. Create and work in a separate
  `.local/work/<project-slug>/` directory.
- Pipeline commands read the project directly and store timeline/audio under its `generated/`
  directory. Do not create or depend on `.local/current/`.
