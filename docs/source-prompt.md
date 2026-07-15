Create a narrated HTML video in a polished presentation-slide style.

Topic: {{TOPIC}}
Audience: {{AUDIENCE}}
Tone: {{TONE}}
Preferred scene count: {{SCENE_COUNT}}
Language: {{LANGUAGE_INSTRUCTION}}
Additional requirements: {{NOTES}}

## Output contract

Create only `scenes.json` and `body.html`. An optional `media/` folder may hold local assets.
`body.html` must be one complete HTML document: it must begin with `<!doctype html>`, contain
`<html>`, `<head>`, and `<body>`, and end with `</body></html>`. Never return an HTML fragment,
truncate the document, or use ellipses/placeholders for omitted markup or CSS.
Keep the implementation compact enough to return in full: reuse CSS classes and shared components.
If output space is limited, reduce decorative detail rather than omitting scenes, styles, or closing
tags.

When operating as a code agent in this repository, create a unique kebab-case project directory at
`.local/work/<project-slug>/` before writing these files. Write the new video's source only inside
that directory. Never edit `.local/work/starter/`; it is the tracked template, not a working
project.

- Make `scenes.json` a non-empty array. Start with `id: "intro"`.
- Give every scene a unique lowercase `id`, a short `category`, and natural `narration`.
- Put every visible title, label, diagram, chart, and explanatory element in `body.html`.
- Add one `<section class="content-scene" data-scene="id">` for every scene. Do not hard-code an
  initial `active` or `is-active` class; the stable shell controls scene visibility.
- Keep all project CSS inside a `<style>` element in `body.html`.
- Scope backgrounds and document-level layout to `#stage` or scene elements. Do not style `html`,
  `body`, shell controls, captions, or chapter elements because source styles are embedded into the
  stable shell document.

Use this complete `body.html` structure as the integration pattern. Expand it with one full section
for every scene instead of omitting repeated sections:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Presentation video</title>
  <style>
    #stage { background: transparent; color: #173b3d; }
    .content-scene {
      position: absolute;
      inset: 0;
      padding: 7vh 7vw 22vh;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <section class="content-scene" data-scene="intro">
    <h1>Opening title</h1>
  </section>

  <section class="content-scene" data-scene="next-scene">
    <h2>Next idea</h2>
  </section>
</body>
</html>
```

The `data-scene` values must exactly match the ids and order in `scenes.json`. Never put `active`,
`is-active`, captions, a progress bar, or playback controls in this markup. Reserve roughly the
bottom 20% of every scene by using about `22vh` bottom padding.

## Visual direction

Use a bright editorial blackboard/newspaper style rather than a dark technology theme. Build from
pale blue, mint, seafoam, and warm off-white surfaces with dark teal or blue-green ink. Use one
restrained coral, yellow, or medium-blue accent when emphasis is needed. Avoid dark navy or black
full-frame backgrounds, neon glows, glassmorphism, and high-contrast cyberpunk styling.

Design the result like a strong presentation deck: one idea per slide, clear hierarchy, generous
whitespace, controlled typography, and one dominant visual composition. Use diagrams, charts,
comparisons, timelines, editorial illustrations, compact SVG, or local media when they explain the
subject. Vary layouts across scenes. Avoid dashboards, settings panels, card walls, deeply nested
boxes, and decorative UI chrome.

The stable shell already draws the subtle grid and the 16:9 frame border over the finished video.
Keep source scene backgrounds transparent or use a very light translucent blue/green paper wash.
Do not recreate the outer border, full-frame grid, captions, or chapter rail in `body.html`.

Design against a 16:9 stage and make the same CSS fit smaller Studio previews. Treat typography as
presentation text, not poster lettering:

- Keep a normal scene title at or below `clamp(36px, 4vw, 64px)`. A title sharing the frame with two
  or more columns should stay at or below `clamp(32px, 3.5vw, 56px)`.
- Reserve `clamp(44px, 5.2vw, 88px)` only for a short intro headline. Do not use a 90-120px heading
  on ordinary content scenes.
- Keep body copy at or below `clamp(18px, 1.6vw, 28px)` and repeated card/diagram labels at or below
  `clamp(18px, 1.8vw, 30px)`. Use no more than two title lines and keep Chinese title lines concise.
- Reduce font size or copy length when text wraps unexpectedly; never let text push another visual
  outside the scene.

Size repeated columns from their container rather than from the browser viewport. For two- or
three-column layouts, use Grid with `minmax(0, 1fr)` and give children `min-width: 0`; do not assign
each card a `vw` width. Keep gaps inside the grid's available width. For example:

```css
.scene-title { font-size: clamp(36px, 4vw, 64px); line-height: 1.08; }
.three-column {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(16px, 2vw, 32px);
}
.three-column > * { min-width: 0; }
```

Keep important content in the top 80% of the frame. The stable video shell owns captions, the compact
chapter rail, playback, timing, rendering, and deterministic scene transitions. Do not recreate
those elements in `body.html`.

Prefer HTML, CSS, and SVG. If JavaScript is unnecessary, include no `<script>` at all. A normal
`<script>` is invalid. If an active Canvas or WebGL visual is genuinely useful, include exactly one
inline `<script type="module">` in `body.html`; do not use a `src` attribute. Pin imported dependency
versions, derive every frame from the provided absolute time, and do not start an independent
`requestAnimationFrame` loop.

When a module is needed, insert this interface immediately before the document's closing `</body>`:

```html
<script type="module">
let host;

export async function mount({ root }) {
  host = root.querySelector('[data-scene="intro"]');
}

export function renderAtTime(seconds, { sceneProgress }) {
  if (!host) return;
  host.style.setProperty('--scene-progress', String(sceneProgress));
}

export function destroy() {
  host = null;
}
</script>
```

Before returning the two files, verify: `body.html` runs from `<!doctype html>` through `</html>`
without omitted sections or styles; every id has one matching section; no scene starts active; CSS
does not target `html` or `body`; important content stays above the reserved bottom area; headings
respect the size limits; every multi-column layout fits inside its scene without horizontal
overflow or clipped children; and an optional script is one inline module exporting both `mount()`
and `renderAtTime()`.
