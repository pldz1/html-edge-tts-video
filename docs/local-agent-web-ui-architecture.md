# Local Agent and Web UI Architecture

This project should behave like a local video factory with two front doors:

- Agent workflow: Codex or another local agent edits source folders and runs `main.py`.
- Web workflow: a browser UI helps a human compose prompts, paste AI output, preview, edit captions, and render.

The browser UI is not the video engine. The Python factory remains the engine.

## Browser Runtime Policy

Use two different browser roles:

- User browser: opens the Studio, preview, caption editor, and external AI chat pages.
- Render browser: uses Playwright bundled Chromium by default for deterministic capture.

The render browser should not depend on a user's installed Chrome or Edge. System browsers are only a fallback, and `CHROME_EXECUTABLE` is an explicit override for debugging or special environments. This keeps render behavior consistent across machines after `python main.py install`.

## Recommended Shape

```text
Browser UI
  prompt builder
  source paste/import
  preview links
  caption editor
  render queue/status
        |
        | localhost HTTP API
        v
Python factory server
  source folder writer
  edge-tts audio build
  caption API
  Playwright frame capture
  FFmpeg mux/export
        |
        v
.local/work/<video-source>/
.local/output/<video>.mp4
```

## Why Not Pure Browser

The browser can do a good UI, but it should not own the heavy production steps:

- `edge-tts` runs as Python/network tooling.
- Playwright controls its bundled Chromium for deterministic render capture.
- FFmpeg muxes frames and audio into MP4.
- Local file writes need explicit filesystem access and predictable paths.
- Long renders need process control, progress, and error logs.

So the product should feel like a browser app, but technically be a local Python server.

## Packaging Options

### Development Mode

Use commands directly:

```bash
python main.py tts --source .local/work/my-video
python main.py captions --source .local/work/my-video
python main.py render --source .local/work/my-video --size 2k --output my-video.mp4
```

Best for local agents and contributors.

### Local Web App Mode

Run one server:

```bash
python main.py studio
```

Then open:

```text
http://127.0.0.1:8765/tools/studio.html
```

The studio should provide:

- Project/source folder selector.
- Prompt composer with reusable prompt templates.
- Buttons that open ChatGPT, Claude, Gemini, or another AI chat in a new tab.
- Paste boxes for `scenes.json` and `body.html`.
- Source validation before writing files.
- TTS/build buttons with progress output.
- Preview, caption editor, and render buttons.
- Output list with open/copy path actions.

### Packaged Desktop Tool

Later, package the Python server as an exe and open the browser automatically:

```text
html-edge-tts-video.exe
  starts localhost server
  opens default browser
  stores projects under .local/work/
  stores videos under .local/output/
```

This is easier and more reliable than rewriting the engine as a desktop frontend. The UI can remain ordinary HTML/CSS/JS.

## Prompt Builder Flow

The Web UI should not ask a web AI to generate runtime JavaScript. It should generate a prompt that asks for source files only:

```text
Return only:
1. scenes.json
2. body.html
3. optional media plan

Do not generate app.js, playback controls, chapter rails, progress bars, or subtitles.
```

Suggested flow:

1. User describes the video topic, tone, audience, length, and scene count.
2. Studio merges user input with the repository constraints from `SKILL.md` and `docs/agent-skill.md`.
3. User clicks an AI provider button.
4. Studio copies the prompt and opens the selected AI chat page.
5. User pastes the AI response back into Studio.
6. Studio extracts or validates `scenes.json` and `body.html`.
7. Python writes `.local/work/<slug>/scenes.json` and `.local/work/<slug>/body.html`.
8. User clicks TTS, captions, preview, and render.

## Where Each Technology Lives

| Area | Owner | Reason |
| --- | --- | --- |
| Prompt composition | Browser UI | Fast editing, templates, provider buttons |
| Source validation | Python API | Same rules as agent workflow |
| Source folder writes | Python API | Controlled local filesystem access |
| TTS/audio | Python pipeline | Uses `edge-tts` and FFmpeg |
| Caption timing/editor | Browser UI + Python API | UI edits, Python persists to source/current |
| Video capture | Python pipeline | Playwright controls bundled Chromium render frames |
| MP4 encoding | Python pipeline | FFmpeg quality settings and mux |
| Output browsing | Browser UI + Python API | Lists files from `.local/output/` |

## Resolution Policy

High resolution must mean more than a larger canvas.

- 480p/720p can use fast Playwright video recording.
- 1080p/2K/4K should use deterministic frame capture by default.
- High resolution frame capture should default to high-quality JPEG frames for practical speed.
- PNG frame capture should remain available for maximum intermediate-frame fidelity.
- Theme CSS must scale layout density for large viewports.
- FFmpeg should encode UI-heavy video with a low CRF, currently defaulting to `--crf 14`.
- Default high-resolution FPS is `15`, which fits slide/explainer videos; animation-heavy projects can render with a higher `--fps`.
- A fast/legacy path remains available with `--capture video`.

## Implementation Slices

1. Keep `main.py` stable for agents.
2. Add `main.py studio` as a friendlier alias for the local server.
3. Add `tools/studio.html`, `tools/studio.css`, and `tools/studio.js`.
4. Add API endpoints:
   - `GET /api/projects`
   - `POST /api/source`
   - `POST /api/tts`
   - `POST /api/render`
   - `GET /api/outputs`
5. Add a lightweight job system for long TTS/render commands.
6. Package as an exe only after the localhost workflow is stable.
