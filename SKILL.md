---
name: html-edge-tts-video
description: Create locally rendered narrated presentation-style videos from scenes.json and a self-contained body.html. Use when Codex should design HTML slides, generate edge-tts narration and captions, preview deterministic scene transitions, or render an MP4 in Simplified Chinese or US English.
---

# HTML edge-tts Video

Read `docs/agent-skill.md` before changing source or running builds.

Create every video in its own project folder under `.local/work`:

```text
.local/work/<project-slug>/
  scenes.json
  body.html
  media/ optional
  captions.json optional after subtitle edits
```

Before authoring, choose a unique kebab-case `<project-slug>` and an immutable aspect ratio. Create
the folder with `python main.py init --target .local/work/<project-slug> --aspect-ratio 16:9` for the
default landscape canvas or use `--aspect-ratio 9:16` for portrait, then replace the copied source
files.
Never edit `.local/work/starter/`; it is a read-only tracked template, not a working project. Do not
write video source directly into `.local/work/` without a project subfolder.

Write `body.html` as a complete document from `<!doctype html>` through `</html>`. Let the subject
determine the visual composition within a bright editorial blackboard/newspaper palette: pale
blue, mint, seafoam, warm white, and dark teal ink. Avoid dark full-frame themes and neon. Let the
stable shell draw the subtle grid and selected-canvas frame border. Build one clear idea and one dominant
visual composition per scene. Keep all project CSS and optional deterministic visual code inside
`body.html`; do not create `app.js`, playback UI, captions, footers, timecodes, chapter rails, or
scene transitions.

Keep ordinary scene titles at or below 64px, multi-column titles at or below 56px, and use up to
88px only for a short intro headline. Size repeated columns from their scene container with Grid
`minmax(0, 1fr)` tracks; do not give every card a `vw` width.

Start `scenes.json` with `id: "intro"`. Give every scene a unique lowercase `id`, a short
`category`, and natural `narration`. Match every id with a `[data-scene="id"]` section in
`body.html`. In portrait projects, categories must use 2-3 CJK characters or one short English word
of at most 8 letters; the shell keeps the chapter rail to one horizontal row.

Generate the canonical source prompt when helpful:

```bash
python main.py prompt --topic "<topic>" --language auto --target agent
python main.py prompt --topic "<topic>" --language auto --target web-ai --aspect-ratio 9:16
```

Build and verify:

```bash
python main.py check --source .local/work/<project-slug>
python main.py tts --source .local/work/<project-slug>
python main.py studio --source .local/work/<project-slug>
python main.py render --source .local/work/<project-slug> --output video.mp4
```

Infer `zh-CN` or `en-US` when the user does not specify a language. Preserve imported source
language unless the user requests translation. The stable shell owns narration timing, captions,
the compact chapter rail, playback, and deterministic dip-to-background transitions.

Treat `.local/`, `assets/`, and `output/` as generated state, except for the tracked two-file starter
at `.local/work/starter/`. Project creation adds an untracked `manifest.json`, and Studio writes
generated media beside each project; it does not create a global current workspace. The starter must remain unchanged; all
authored videos belong in their own `.local/work/<project-slug>/` folder.
