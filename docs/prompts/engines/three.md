## Rendering engine: Three.js / WebGL

Create `visual.js` as an ES module. `body.html` should contain the Canvas host and accessible fallback
text; keep module code out of `body.html`. A pinned Three.js CDN import is allowed, for example an
exact `three@0.x.y` URL.

Export:

```js
export async function mount(context) {}
export function renderAtTime(seconds, context) {}
export function destroy() {}
```

Drive all motion from the absolute `seconds`, `sceneTime`, and `sceneProgress` values. Do not run an
independent requestAnimationFrame loop. Resolve `mount()` only after the first frame is ready.
