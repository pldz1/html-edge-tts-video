# Agent Instructions

This repository is a HTML video skill package.

Use `SKILL.md` as the entrypoint and `docs/agent-skill.md` as the full workflow and constraints.

This is a factory. Per-video source folders contain `scenes.json`, `body.html`, optional
`media/`, and optional editor-created `captions.json`. The factory loads a source folder into `.local/current/` and renders through
`themes/default/`. Do not ask users or web AI to generate `app.js`.

Source folders must start with an `intro` scene, include a short `category` per scene, and keep
playback controls, progress bars, headers, footers, timecodes, and transport UI out of `body.html`.

Before finishing code changes, run:

```bash
python main.py check
```

Do not treat generated files under `.local/`, `assets/`, or `output/` as source.
