# Nginx-hosted Studio Preview Demo

`demo/` is a self-contained static copy of the current `studio/web` frontend. It does not need
Python, Studio APIs, FFmpeg, Playwright, TTS, or a render worker at runtime.

The copied product pages retain their original layout and controls. `mock-api.js` intercepts their
`/api/*` requests in the browser. Read-only fixture requests work; actions that would create, edit,
delete, check, synthesize, or render return `ok: false` with a message asking the visitor to clone
the project and run it locally.

Hash routes:

- `/#/studio`
- `/#/captions`
- `/#/voices`

For a quick local check, any static server is enough:

```bash
python -m http.server 4173 --directory demo
```

Then open <http://127.0.0.1:4173/#/studio>. Python is only shown here as a convenient local static
server; production hosting can use Nginx directly.

An example Nginx server block is included in `nginx.conf.example`. Set its `root` to the absolute
path of this `demo/` directory. Because routing uses the URL hash, Nginx never receives the route and
does not need application-specific rewrites.
