You are creating source files for a narrated HTML video composition.

The video shell already owns captions, the compact chapter rail, playback, timing, preview controls,
and rendering. Do not recreate any of those in source files.

Topic:
{{TOPIC}}

Audience:
{{AUDIENCE}}

Tone:
{{TONE}}

Preferred scene count:
{{SCENE_COUNT}}

Content language:
{{LANGUAGE_INSTRUCTION}}

Additional requirements:
{{NOTES}}

## Source contract

Create these files:

- `scenes.json`: ordered narration and scene metadata.
- `body.html`: self-contained markup and project styling, with one `[data-scene]` section per scene.
  Put CSS in `<style>` and optional deterministic JavaScript in `<script type="module">`.
- `media/`: optional local assets.

Do not create separate CSS or JavaScript files, `app.js`, captions, audio, timeline files, playback controls, headers, footers,
scrubbers, timecodes, transport controls, or a chapter rail.

## Content rules

- Start with scene id `intro` and explain the video's starting point and route.
- Give every scene a short `category`, a visual `title`, a one-sentence `summary`, and natural
  `narration` in the selected content language.
- Keep important visual content in the top 80% of the frame. The shell reserves 80%-90% for
  captions and 90%-100% for its footer; the visible rail itself is compact.
- Build one dominant composition per scene. Prefer hierarchy, whitespace, paths, connectors,
  typography, diagrams, media, and spatial grouping over grids of bordered rectangles.
- Never nest card grids, formula boxes, and chips inside one another. Use at most one bordered
  primary container per scene unless the selected theme explicitly requires a comparison.
- Keep the result deterministic at any requested timestamp and usable at 16:9 and portrait sizes.
