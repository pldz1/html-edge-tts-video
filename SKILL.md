---
name: html-edge-tts-video
description: Build locally rendered narrated HTML videos in the user's requested or inferred content language. Use when Codex should create or import scenes.json, body.html, project-specific body.css, optional deterministic visual.js for Three.js/Canvas/WebGL, generate edge-tts narration and captions, preview through the stable shell, and render an MP4.
---

# HTML edge-tts Video Skill Package

Read the full workflow before changing source or running builds:

```text
docs/agent-skill.md
```

Use this source contract:

```text
source/
  scenes.json
  body.html
  body.css recommended
  visual.js optional for Canvas, Three.js, or WebGL
  media/ optional
  captions.json optional after subtitle edits
```

Choose the content language in this order:

1. Follow an explicit user language request.
2. Follow a Studio language selection.
3. Infer the dominant language from the user's question or imported narration.
4. Preserve an imported source language unless the user asks to translate it.

The first version supports only Simplified Chinese (`zh-CN`) and US English (`en-US`). Studio's
`auto` mode resolves between those two languages, and an explicit selection wins.

Keep technical names such as React or Three.js unchanged while making the surrounding content use
the selected language. Let the resolved language choose the default edge-tts voice.

Choose a Content Theme from `docs/content-themes/`. A Content Theme controls the AI prompt, composition
grammar, project `body.css`, and permitted renderer. It does not skin the Studio UI. The stable shell
under `themes/default/` owns captions, the compact chapter rail, playback, and rendering.

Generate the same canonical prompt for an agent or web AI:

```bash
python main.py prompt --topic "<topic>" --language auto --content-theme editorial --target agent
python main.py prompt --topic "<topic>" --language auto --content-theme cinematic-3d --target web-ai
```

Core build:

```bash
python main.py tts --source <source-folder>
python main.py check
python main.py preview
python main.py render --output video.mp4
```

Content rules:

- Start `scenes.json` with `id: "intro"` and give every scene a short `category`.
- Build one dominant visual composition per scene; avoid nested card grids and dashboard UI.
- Keep source visuals in the top 80% of the frame. The shell reserves 80%–90% for captions and
  90%–100% for the footer, while the visible rail stays compact.
- Keep scripts out of `body.html`. Put active visuals in `visual.js` and export deterministic
  `mount()` and `renderAtTime()` functions.
- Pin external CDN dependency versions. Do not run an independent requestAnimationFrame loop.
- Do not generate `app.js`, playback controls, captions, footers, timecodes, or chapter rails.
- Do not generate scene transitions; the stable shell owns deterministic dip-to-black transitions.

The source is copied into `.local/current/source/`; generated narration and timing live under
`.local/current/assets/`. Do not treat `.local/`, `assets/`, or `output/` as tracked source.
