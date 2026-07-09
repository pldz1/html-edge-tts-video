# Function Logic Design

This document describes the concrete function-level design of the HTML edge-tts video factory.
It is written for local agents and maintainers who need to change behavior without rediscovering
the pipeline from scratch.

## Core Data Flow

The factory has four durable concepts:

- Source folder: user or AI authored input containing `scenes.json`, `body.html`, optional `media/`,
  and optional `captions.json`.
- Current workspace: `.local/current/`, the normalized active source plus generated assets.
- Theme runtime: `themes/default/`, the stable HTML/CSS/JS shell that renders the source.
- Output area: `.local/output/`, final MP4 files and diagnostics.

Normal flow:

```text
source folder
  -> pipeline.factory.load_source()
  -> .local/current/source/
  -> pipeline.build_tts.main_async()
  -> .local/current/assets/narration.mp3 + timeline.json
  -> themes/default/runtime.js
  -> pipeline.render_video.main()
  -> .local/output/*.mp4
```

`main.py` is the single CLI entrypoint.

## Data Contracts

`scenes.json` is an ordered array. Each scene must contain:

- `id`: lowercase letters, digits, and hyphens. The first scene must be `intro`.
- `category`: short label used by the generated bottom chapter rail.
- `title`: visual title.
- `summary`: visual summary.
- `narration`: Chinese narration text used by edge-tts.

`body.html` is an HTML fragment. It must contain a section matching every scene id:

```html
<section class="content-scene scene" data-scene="intro">...</section>
```

It must not contain runtime JavaScript, playback controls, chapter rail markup, progress bars,
timecodes, or full document tags.

`timeline.json` is generated from real or offline-estimated narration timing:

- `duration`: total seconds.
- `voice`, `rate`, `pitch`: present for real edge-tts builds.
- `estimated`: present for offline preview builds.
- `scenes`: source scenes enriched with `start` and `duration`.
- `cues`: subtitle cues with `start`, `end`, `text`, and `scene_id`.

`captions.json` is optional manual subtitle state. The current format contains:

- `kind`: `html-edge-tts-captions`.
- `version`: caption schema version.
- `source`: usually `manual`.
- `timeline_signature`: the generated cue timing/text snapshot that manual edits are based on.
- `cues`: editable cue timing and screen text.

Manual captions are accepted only when they still match the current generated timeline identity.
This prevents stale subtitle edits from being silently applied after narration changes.

## CLI Orchestration: main.py

`run(command)` executes a subprocess from the repository root with `check=True`. All CLI handlers
use this helper so child scripts inherit a stable working directory.

`copy_source_template(args)` creates an editable source folder from `templates/starter/`. It refuses
to overwrite a non-empty target unless `--force` is present.

`load(args)` delegates to `pipeline.factory.load_source()` and makes a source folder active under
`.local/current/source/`.

`validate_source(source, theme)` builds the validation command for `pipeline/validate_sources.py`.
Handlers call this before TTS and render paths so bad source files fail early.

`install(_)` installs Python dependencies from `requirements.txt` and the Playwright bundled
Chromium browser.

`tts(args)` validates the source, then calls `pipeline/build_tts.py` with voice, rate, pitch, gap,
theme, source, and optional `--force`.

`offline(args)` validates the source, then calls `pipeline/build_offline_preview.py` to create a
silent estimated timeline and narration file for layout work without network TTS.

`preview(args)`, `captions(args)`, and `studio(args)` optionally load a source, then run
`pipeline/serve.py`. They share one local HTTP server because preview pages, caption editing, voice
preview, and Studio are all static files plus small local APIs.

`render(args)` validates the source, then calls `pipeline/render_video.py` with size, custom width
and height, capture mode, FPS, CRF, preset, frame format, JPEG quality, theme, source, and output.

`voices(args)` calls `pipeline/voice_preview.py list`, optionally returning raw JSON.

`voice_preview(args)` calls `pipeline/voice_preview.py preview` and forwards selected voices plus
sample TTS controls.

`check(args)` is the repository validation gate. It validates source and theme, syntax-checks the
runtime/tool JavaScript files with Node, and byte-compiles `main.py` and every `pipeline/*.py` file.

`add_source_args(parser)` centralizes common `--source` and `--theme` options.

`build_parser()` declares the subcommands and maps each parser to its handler with
`set_defaults(func=...)`.

`main()` parses CLI arguments and dispatches to the selected handler.

## Factory Workspace: pipeline/factory.py

Path constants define the repository root, `.local/` workspace, active source/assets, starter
source, theme root, and default theme. Other modules import these constants instead of rebuilding
paths.

`rel(path)` returns a path relative to the repository root when possible. It is used for readable
messages.

`slug(value)` normalizes user-facing strings into safe filenames.

`clean_dir(path)` removes and recreates a directory. It is used when loading a new active source.

`find_first(source, candidates)` returns the first existing candidate path under a source folder.
It supports both flat sources and older `content/` layouts.

`resolve_source_root(source)` expands a user-provided source path. It supports absolute paths,
repo-relative paths, migrated `.local/work/...` paths, and legacy `work/...` references.

`resolve_source(source)` validates the source folder and returns canonical paths for `root`,
`scenes`, `body`, optional `media`, and optional `captions`.

`ensure_theme(theme)` checks that `themes/<theme>/index.html`, `runtime.js`, and `theme.css` exist.

`load_source(source, theme)` copies the source files into `.local/current/source/`, copies media and
optional captions, ensures the theme exists, and writes `.local/current/project.json` with source,
theme, and load timestamp.

`ensure_current()` fails if `.local/current/source/scenes.json` or `body.html` is missing.

`active_theme()` reads the active theme from `project.json`; it falls back to `default`.

`active_source_root()` reads the original source path from `project.json` and includes a migration
fallback from old `work/` paths to `.local/work/`.

`load_scenes()` calls `ensure_current()` and parses the active `scenes.json`.

`theme_url(theme)` validates the theme and returns the local preview URL.

`output_path(value)` maps relative output names into `.local/output/`, keeps absolute paths intact,
and maps legacy `output/foo.mp4` to `.local/output/foo.mp4`.

## Source Validation: pipeline/validate_sources.py

`fail(message)` raises a consistent `SystemExit` validation error.

`validate_scenes(scenes_file)` parses `scenes.json`, enforces non-empty array shape, validates ids,
prevents duplicates, requires narration and category, limits category length, and requires the first
scene id to be `intro`.

`validate_body(body_file, scenes)` reads `body.html`, rejects forbidden markers such as `<script>`,
transport UI, chapter rail markup, and full document tags, then verifies every scene id has a
matching `data-scene` section.

`validate_captions(captions_file)` performs lightweight structural checks on optional
`captions.json`. Deeper timeline matching happens in `pipeline/captions.py`.

`validate_theme(theme)` checks theme existence and verifies that `runtime.js` contains the required
render contract names.

`main()` optionally loads a provided source, validates scenes, body, captions, and theme, then
prints scene and narration counts.

## TTS Build: pipeline/build_tts.py

`ffprobe_duration(path)` uses FFprobe to read an audio file duration in seconds.

`text_hash(text, voice, rate, pitch, boundary)` creates a short cache key for a scene narration and
TTS settings.

`validate_scenes(scenes)` performs the minimal TTS-specific scene check for `id` and `narration`.
The stricter source policy lives in `validate_sources.py`.

`group_words(words, scene_id, scene_start)` converts edge-tts WordBoundary events into readable
subtitle cues. It breaks on Chinese punctuation, long text groups, or roughly three seconds of
speech.

`synth_scene(scene, voice, rate, pitch, force)` is the real edge-tts worker. It writes
`.local/current/assets/scenes/<scene-id>.mp3`, stores WordBoundary metadata, and uses the hash stamp
to reuse cached scene audio when narration and voice settings have not changed.

`write_gap_audio(path, duration)` uses FFmpeg `anullsrc` to create short silence files between
scenes.

`main_async(args)` optionally loads a source, synthesizes each scene, measures scene durations,
creates timeline scenes and cues, writes a concat list, muxes one `narration.mp3`, and writes
`timeline.json`.

`main()` parses CLI arguments and runs `main_async()` with `asyncio.run()`.

## Offline Preview: pipeline/build_offline_preview.py

`main()` optionally loads a source, estimates scene duration from narration length, splits narration
into approximate cues, writes an estimated `timeline.json`, and creates silent `narration.mp3`. This
path is for layout preview only; final video should use real TTS timing.

## Caption Model: pipeline/captions.py

`cue_id(index)` creates stable ids such as `cue-0001`.

`read_json(path)` and `write_json(path, value)` centralize UTF-8 JSON IO.

`timeline_path()` and `captions_path()` locate active timeline and caption files.

`load_timeline()` loads `.local/current/assets/timeline.json`, verifies it has cues, and checks that
it matches the current scenes.

`timeline_matches_source(timeline)` compares `(scene.id, scene.narration)` pairs from the current
source against the timeline scenes.

`normalize_cue(raw, index, fallback)` coerces cue fields into the canonical shape and fills missing
values from the generated timeline cue when possible.

`timeline_signature(timeline)` snapshots generated cues. It is stored inside `captions.json` so
manual subtitle timing can be distinguished from stale narration output.

`default_doc(timeline)` creates an editable caption document directly from generated timeline cues.

`coerce_doc(value, timeline, stamp_signature)` accepts either a raw cue array or an object with
`cues`, checks cue count, normalizes each cue, and optionally stamps the current timeline signature.

`cue_timing_is_valid(cue, duration)` checks finite numeric timing, non-negative start, end after
start, and end within total duration tolerance.

`cue_identity_matches(current, generated)` verifies cue id and scene id identity.

`signature_matches_current(doc, timeline)` validates that the stored `timeline_signature` still
matches generated cue identity, text, start, and end within strict tolerance.

`legacy_captions_match_timeline(doc, timeline)` supports older caption documents without
`timeline_signature` by requiring cue timing to stay very close to generated timing.

`captions_match_timeline(doc, timeline)` is the main acceptance gate. It verifies cue count,
signature or legacy matching, cue identity, and timing bounds.

`load_effective_doc(timeline)` returns `(doc, saved)`. If `captions.json` is missing, invalid, or
stale, it returns a generated default document and `False`.

`save_doc(value, timeline)` normalizes and validates incoming editor state, writes
`.local/current/source/captions.json`, mirrors it back to the original source folder when known, and
returns saved paths.

## Local Server and APIs: pipeline/serve.py

`FactoryHandler.log_message()` silences request logging.

`FactoryHandler.send_json(status, payload)` writes JSON responses with UTF-8 content type.

`FactoryHandler.send_error_json(status, message)` wraps API errors as `{ "error": "..." }`.

`FactoryHandler.do_GET()` handles `/api/captions` by loading the current timeline and effective
caption document. All other paths are served as static files from the repository root.

`FactoryHandler.do_POST()` handles `/api/captions`, limits request body size, parses JSON, saves
the caption document, and converts validation failures into HTTP errors.

`main()` changes the server root to the repository, prints useful local URLs, and serves on
`127.0.0.1:8765`.

## Rendering: pipeline/render_video.py

`QuietHandler.log_message()` silences the temporary render server.

`serve()` starts a static HTTP server from the repository root for Playwright.

`parse_args()` declares render options: source, theme, size, custom dimensions, output, capture
mode, FPS, CRF, preset, frame format, and JPEG quality.

`ensure_render_assets_match_source()` requires `timeline.json` and `narration.mp3`, parses the
timeline, and compares `(scene.id, scene.narration)` pairs against the current source.

`launch_browser(playwright)` prefers an explicit `CHROME_EXECUTABLE` when valid, otherwise uses
Playwright bundled Chromium, then falls back to installed Chrome or Edge paths.

`resolved_capture_mode(value, width, height)` keeps explicit `video` or `frames`; `auto` chooses
frame capture for 1080p and above, and Playwright video recording for lower sizes.

`ffmpeg_common_output_args(args, output)` centralizes MP4 encoding settings: H.264 video, AAC audio,
CRF, preset, `yuv420p`, faststart, and shortest stream handling.

`load_render_page(browser, theme, width, height)` creates a browser context, opens the render URL,
waits for `compositionReady`, and reads duration from the theme runtime.

`capture_frames(browser, theme, width, height, narration, output, args)` deterministically seeks the
theme via `window.renderAtTime(seconds)`, screenshots each frame, streams images into FFmpeg through
stdin, and muxes the narration audio.

`capture_video(browser, theme, width, height, narration, output, args)` records a Playwright video
while calling `window.startCompositionPlayback()`, trims preroll, and muxes narration audio.

`main()` optionally loads a source, resolves theme and dimensions, validates generated assets, starts
the render server, launches Chromium, chooses capture mode, renders, closes the browser, and prints
the output path.

## Voice Preview: pipeline/voice_preview.py

`slug(value)` creates safe audio filenames for voice names.

`chinese_voices()` loads edge-tts voices and filters to `zh-*` voices.

`voice_label(voice)` formats voice metadata for terminal listing.

`list_voices(args)` prints Chinese voices, either human-readable or JSON.

`build_preview(args)` validates selected voice names, synthesizes sample MP3 files, writes
`.local/assets/voice-preview/manifest.json`, and points the user to the voice preview page.

`build_parser()` declares `list` and `preview` subcommands.

`main()` parses args and runs the selected async handler.

## Theme Runtime: themes/default/runtime.js

The theme runtime is the browser-side deterministic player and render target. It must keep this
external contract:

```js
window.compositionReady = true;
window.getCompositionDuration = () => durationInSeconds;
window.renderAtTime = seconds => {};
window.startCompositionPlayback = () => {};
```

`formatTime(seconds, withMs)` formats preview and scrubber time labels.

`splitNarration(text)` breaks text into estimated subtitle chunks when no real timeline exists.

`fetchJson(path)`, `fetchText(path)`, and `fetchOptionalJson(path)` load active source and asset
files without cache.

`estimatedTimeline(scenes)` creates browser-side fallback timing when `timeline.json` is missing or
stale.

`isExternalUrl(value)` and `rebaseMediaUrls(root)` rewrite relative media URLs in `body.html` so
they resolve under `/.local/current/source/`.

`sceneIndexAt(seconds)`, `progressAt(scene, seconds)`, and `activeCueAt(seconds)` derive the current
scene, per-scene progress, and active subtitle cue from timeline state.

`timelineMatchesSource(timeline, scenes)` prevents stale timeline scenes from driving new body
content.

`normalizeCaptionCue(cue, index)`, `cueIdentityMatches()`, `cueTimingIsValid()`,
`signatureMatchesTimeline()`, and `captionsMatchTimeline()` mirror Python caption validation in the
browser so stale or malformed manual captions are ignored at render time.

`applyCaptionOverrides(timeline)` loads optional `captions.json` and replaces generated cues only
when validation passes.

`chapterLabel(scene, index)`, `setupChapterRail()`, and `updateChapterRail(activeIndex)` build and
update the bottom chapter rail from timeline scenes and `category` labels.

`activateScene(scene, progress)` toggles the active body section and step states for elements with
`data-step`.

`renderAtTime(seconds)` is the deterministic render function. It clamps time, updates scene state,
caption text, chapter rail, preview timecode, and scrubber value.

`pause()`, `tick(now)`, and `startPlayback()` implement preview playback. Preview mode follows real
audio time when audio is available; render mode uses a deterministic clock.

`init()` loads scenes and body HTML, rebases media, loads or estimates timeline, applies captions,
sets duration, builds chapters, renders the first frame, and exposes readiness flags.

## Browser Tools

`tools/captions.js` is a local caption editor:

- Formatting helpers keep timing display stable.
- `loadCaptions()` reads `/api/captions` and initializes editor state.
- `saveCaptions()` posts edited cues back to `/api/captions`.
- `renderList()` and `renderDetail()` keep cue list and selected cue editor in sync.
- `updateTimingFromInputs()` validates manual start and end edits.
- `shiftCurrentCue(delta)` nudges a cue earlier or later while keeping duration.
- `restoreGeneratedCue()` resets the selected cue to generated timeline text and timing.

`tools/studio.js` is a prompt helper for web AI:

- `buildPrompt()` merges user inputs with the repository source rules.
- `copyPrompt()` writes the generated prompt to the clipboard.
- `extractFence()`, `extractScenes()`, and `extractBody()` pull `scenes.json` and `body.html` from a
  pasted AI response.
- `extractResponse()` validates extracted scene JSON and displays both source files for local use.

`tools/voices.js` renders voice previews:

- `init()` loads `.local/assets/voice-preview/manifest.json`.
- If no manifest exists, it shows the command needed to generate samples.

## Extension Points

Add a new theme by creating `themes/<name>/index.html`, `runtime.js`, and `theme.css`. Keep the same
browser render contract so `pipeline/render_video.py` continues to work.

Add source validation in `pipeline/validate_sources.py` when it is about author input shape. Add
render safety validation in `pipeline/render_video.py` when it is about generated assets matching
the loaded source.

Add caption schema rules in `pipeline/captions.py` first, then mirror only the render-critical
checks in `themes/default/runtime.js`.

Add new local web tools under `tools/` and serve them through `pipeline/serve.py` only if they need a
JSON API. Static-only tools can be served by the existing file server.

Keep generated or local state under `.local/`. Do not introduce new root-level `work/`, `output/`,
`assets/`, or `.factory/` paths for new behavior.
