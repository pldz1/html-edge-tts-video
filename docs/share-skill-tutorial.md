# Sharing This Skill

This repository is a reusable factory for creating Chinese narrated HTML videos. You share the
factory, starter source, and theme runtime; each video source can live outside the repository.

Tracked factory source:

```text
SKILL.md
agents/
DESIGN.md
README.md
AGENTS.md
requirements.txt
main.py
templates/starter/
themes/default/
pipeline/
tools/
docs/
```

Skill packaging note:

- This repository is a complete video factory project with a skill entrypoint, not a minimal
  installed-skill folder.
- `SKILL.md` is the required agent entrypoint. `agents/openai.yaml` adds Codex UI metadata.
- For a thin distributable skill package, copy or symlink this repository into a skill directory
  named `html-edge-tts-video`, or publish a package wrapper that keeps `SKILL.md` at its root and
  exposes the factory scripts/resources beside it.

Per-video source folder:

```text
scenes.json
body.html
media/ optional
captions.json optional after manual subtitle edits
```

`scenes.json` starts with `id: "intro"` and every scene includes a short `category` for the generated
bottom chapter rail. The rail is rendered as one continuous timeline from generated TTS timing, not
as one resetting progress bar per scene. `body.html` contains visual content only; do not include app
JavaScript, playback controls, timecodes, headers, transport bars, or per-scene progress bars.
Prefer explanatory HTML/CSS/SVG visuals over text-only slides: flows, comparisons, metrics, concept
maps, formula strips, or compact inline diagrams inside `visual-board`.
`captions.json` is created by the local caption editor after TTS and changes only screen subtitle
text, not narration audio.

Generated or local build state:

```text
.local/
```

Legacy generated folders are ignored for older checkouts:

```text
.factory/
work/
assets/
output/
```

Normal use:

```bash
python main.py tts --source <source-folder>
python main.py captions --source <source-folder>  # optional subtitle edit pass
python main.py check
python main.py render --output video.mp4
```

For text-only web AI, use:

```text
docs/web-ai-prompt.md
```

The web AI should produce only `scenes.json`, `body.html`, and optional `media/`.
