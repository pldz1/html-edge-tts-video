---
title: "Generate HTML Video Source"
description: "Generate the canonical Web AI prompt from the same composer used by Studio and coding agents."
---

# Web AI Prompt

Do not maintain a separate hand-written Web AI prompt in this document. Generate it from the shared
Prompt Composer so language, Content Theme, engine, source files, and layout rules stay identical to
Studio and agent workflows.

From Studio, open:

```text
http://127.0.0.1:8765/studio/create
```

Choose:

- Content language: automatic Chinese/English inference, explicit Chinese, or explicit English.
- Video visual style: a registered Content Theme from `docs/content-themes/`.
- Renderer: HTML/CSS/SVG or Three.js/WebGL when the theme permits it.
- Prompt target: Web AI.

Then copy the generated prompt.

From the command line:

```bash
python main.py prompt \
  --topic "<topic or question>" \
  --language auto \
  --content-theme editorial \
  --engine auto \
  --target web-ai
```

The Web AI returns exactly two fenced blocks for:

```text
scenes.json
body.html
```

Optional media can be referenced or supplied separately; it is not another pasted source field.

Import those files in Studio. Never ask a Web AI to create `app.js`, captions, audio, playback UI,
the shell, or the chapter rail.
