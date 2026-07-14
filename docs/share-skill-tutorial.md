# Sharing This Skill

This repository is a reusable factory for creating narrated HTML videos in an explicit or inferred
content language. You share the factory, Content Themes, and stable shell; each video source can live
outside the repository.

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
themes/
docs/content-themes/
docs/prompts/
pipeline/
studio/
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
body.css recommended
visual.js optional for Canvas, Three.js, or WebGL
media/ optional
captions.json optional after manual subtitle edits
```

`scenes.json` starts with `id: "intro"` and every scene includes a short `category` for the generated
bottom chapter rail. The rail is rendered as one continuous timeline from generated TTS timing, not
as one resetting progress bar per scene. `body.html` contains visual DOM, `body.css` owns project
design, and optional deterministic `visual.js` owns active visuals. Do not include app playback,
timecodes, headers, transport bars, or per-scene progress bars.
Keep source visuals in the top 80% of the frame; the shell reserves 80%–90% for captions and the
bottom 10% for the footer while keeping the actual rail compact.
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

Choose a Content Theme and language from `/studio/create` or generate the same prompt with
`python main.py prompt`. The stable shell remains under `themes/default/`.

For text-only web AI, use:

```text
docs/web-ai-prompt.md
```

The web AI should produce `scenes.json`, `body.html`, `body.css`, optional `visual.js`, and optional
`media/` according to the generated prompt.
