---
title: "Generate HTML Video Source"
description: |
  Use this prompt with ChatGPT web, Claude web, Gemini, or another text-only AI.
  The AI should output source files only. It cannot generate MP3, WordBoundary data, timeline JSON, or MP4.

local_commands: |
  python main.py tts --source <download-folder>
  python main.py check
  python main.py render --output video.mp4
---

You are generating a source folder for an HTML edge-tts video factory.

Output only these files:

```text
scenes.json
body.html
media/ optional
```

Do not output `app.js`, `runtime.js`, JavaScript, a renderer folder, MP3, timeline JSON, or MP4.
The factory theme owns playback, captions, the continuous chapter rail, preview controls, and rendering.
Do not output `captions.json`; the local factory creates editable captions after real TTS timing exists.

Topic:
<PUT THE VIDEO TOPIC HERE>

Audience:
<PUT THE TARGET AUDIENCE HERE>

Tone:
<PUT THE TONE HERE>

Visual direction:
<PUT THE VISUAL DIRECTION HERE>

Important visual requirement:
Avoid text-only slides. Each scene should include at least one explanatory visual made from HTML
elements or a compact inline SVG: a pipeline, state diagram, comparison matrix, metric cards, concept
map, formula strip, or other structured graphic. Do not use `<canvas>` unless the canvas content is
already rendered as media, because this source must not include JavaScript.

## Output Contract

Return the files as separate fenced code blocks with clear filenames:

```text
// scenes.json
...
```

```html
<!-- body.html -->
...
```

If media assets are needed, describe the exact filenames and what each asset should contain.

## Rules for `scenes.json`

- Output valid JSON only.
- Use an array of scene objects.
- The first scene must have `"id": "intro"` and must introduce where the video starts, what it will explain, and the rough route of the video.
- Every scene must contain:
  - `id`: lowercase letters, digits, and hyphens only.
  - `category`: a short Chinese label, 2 to 12 characters, used by the factory's bottom chapter rail.
  - `title`: visual title for the scene.
  - `summary`: one sentence for the visual summary.
  - `narration`: natural Chinese spoken narration.
- Optional fields such as `visual_notes` are allowed, but do not rely on JavaScript.
- For an approximately three-minute video at edge-tts `+12%` rate, target 1,150 to 1,250 Chinese characters total.
- Keep each scene focused. Prefer 4 to 7 scenes for a short explainer.
- Match every scene's narration with a visual aid, so the screen explains structure rather than only repeating the spoken text.

Example scene:

```json
{
  "id": "intro",
  "category": "总览",
  "title": "从问题入口开始",
  "summary": "先说明本视频从哪里切入，以及后面会讲什么。",
  "narration": "这条视频先从问题入口讲起，然后拆解核心概念、常见误区和最后的操作建议。"
}
```

## Rules for `body.html`

- Output an HTML fragment, not a full HTML document.
- Do not include `<html>`, `<head>`, `<body>`, `<script>`, inline event handlers, or JavaScript.
- Do not include headers, footers, playback controls, scrubbers, timecodes, transport bars, or template chrome.
- Do not include a per-scene progress bar such as `progress-line`.
- Do not create the bottom chapter rail in `body.html`; the factory generates one continuous rail from `scenes.json.category` and the TTS timeline.
- Include one top-level section per scene:

```html
<section class="content-scene scene" data-scene="intro">
  ...
</section>
```

- Every `id` in `scenes.json` must have a matching `data-scene` section.
- The `intro` section must visually introduce the topic, starting point, and route. Do not jump straight into a detail scene.
- Keep important visual content clear of the bottom 25% of the frame because captions and the generated chapter rail live there.
- Use theme-friendly classes when helpful:
  - `scene-copy`
  - `eyebrow`
  - `summary`
  - `scene-list`
  - `visual-board`
  - `visual-grid`
  - `step-chip` with `data-step`
  - `quote-panel`
  - `diagram-flow` with `diagram-node`
  - `comparison-grid` with `comparison-card`
  - `metric-grid` with `metric-card` and `metric-value`
  - `formula-strip` with `formula-token`
  - `concept-map` with `concept-node`
  - `diagram-svg` for compact inline SVG diagrams
- Reference local assets as `media/name.ext`.

Example visual block:

```html
<div class="visual-board">
  <div class="diagram-flow">
    <div class="diagram-node" data-step><b>输入</b><span>问题和素材</span></div>
    <div class="diagram-node" data-step><b>处理</b><span>拆成结构</span></div>
    <div class="diagram-node" data-step><b>输出</b><span>画面和旁白</span></div>
  </div>
  <div class="formula-strip">
    <div class="formula-token"><b>概念</b><span>是什么</span></div>
    <div class="formula-token operator">+</div>
    <div class="formula-token"><b>关系</b><span>怎么连</span></div>
    <div class="formula-token operator">=</div>
    <div class="formula-token"><b>结论</b><span>怎么用</span></div>
  </div>
</div>
```
