---
name: html-edge-tts-video
description: Build Chinese narrated videos from a small source folder containing scenes.json, body.html, optional media, and optional editable captions.json. Use when Codex should load a source folder into the HTML video skill package, generate edge-tts narration and WordBoundary captions, optionally edit caption text through the local caption editor, render through a stable theme runtime, and output an MP4 locally.
---

# HTML edge-tts Video Skill Package

Use this skill to build a narrated Chinese MP4 from a source folder:

```text
source/
  scenes.json
  body.html
  media/ optional
  captions.json optional after manual subtitle edits
```

The source folder is the AI/user output. The skill package owns the runtime:

```text
themes/default/index.html
themes/default/runtime.js
themes/default/theme.css
```

Read the full workflow before changing files or running builds:

```text
docs/agent-skill.md
```

Core build:

```bash
python main.py tts --source <source-folder>
python main.py captions --source <source-folder>  # optional manual subtitle pass
python main.py check
python main.py render --output video.mp4
```

The source is copied into `.local/current/source/`; generated audio and timing use
`.local/current/assets/` as the active cache. Studio-managed projects persist that cache under
`<project>/generated/` and write final videos under `<project>/output/`. External source folders use
the legacy `.local/output/` destination.

Do not ask web AI to generate `app.js`. It should generate only `scenes.json`, `body.html`, and
optional `media/`.

Do not ask web AI to generate `captions.json`; the skill package creates it from the real TTS timeline when
the user saves manual edits in the caption editor.

Content rules:

- The first scene must be `id: "intro"` and introduce the video's starting point and route.
- Every scene needs a short `category`; the theme uses it for the bottom chapter rail.
- Prefer explanatory HTML/CSS/SVG visuals in `body.html`, not text-only slides. Use diagrams,
  comparison blocks, metric cards, concept maps, or formula strips inside `visual-board`.
- `body.html` must not include scripts, playback controls, headers, footers, scrubbers, timecodes,
  per-scene progress bars, or the chapter rail. The theme owns those.
