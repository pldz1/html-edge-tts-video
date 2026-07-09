const SOURCE_BASE = '/.local/current/source';
const ASSET_BASE = '/.local/current/assets';

const state = {
  scenes: [],
  timeline: null,
  duration: 0,
  current: 0,
  playing: false,
  raf: null,
  startedAt: 0,
  startOffset: 0,
  renderMode: new URLSearchParams(location.search).has('render'),
};

const stage = document.querySelector('#stage');
const caption = document.querySelector('#caption');
const audio = document.querySelector('#narration');
const playButton = document.querySelector('#playButton');
const scrubber = document.querySelector('#scrubber');
const timecode = document.querySelector('#timecode');
const durationLabel = document.querySelector('#durationLabel');
const chapterRail = document.querySelector('#chapterRail');

document.documentElement.classList.toggle('render-mode', state.renderMode);
document.documentElement.classList.toggle('preview-mode', !state.renderMode);

const pad = (value, width = 2) => String(value).padStart(width, '0');

function formatTime(seconds, withMs = false) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${pad(minutes)}:${pad(wholeSeconds)}${withMs ? `.${pad(millis, 3)}` : ''}`;
}

function splitNarration(text) {
  const matches = String(text || '').match(/.{1,22}?[\u3002\uff01\uff1f\uff1b\uff0c\u3001\uff1a]|.{1,22}$/g);
  return matches && matches.length ? matches.map(part => part.trim()).filter(Boolean) : [String(text || '')];
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

async function fetchOptionalJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function estimatedTimeline(scenes) {
  let cursor = 0;
  const timelineScenes = [];
  const cues = [];

  scenes.forEach((scene, index) => {
    const duration = Math.max(8, Math.min(26, String(scene.narration || '').length / 5.5));
    const chunks = splitNarration(scene.narration);
    const cueDuration = duration / Math.max(1, chunks.length);

    chunks.forEach((text, cueIndex) => {
      cues.push({
        start: Number((cursor + cueIndex * cueDuration).toFixed(3)),
        end: Number((cursor + (cueIndex + 1) * cueDuration - 0.08).toFixed(3)),
        text,
        scene_id: scene.id,
      });
    });

    timelineScenes.push({
      ...scene,
      start: Number(cursor.toFixed(3)),
      duration: Number(duration.toFixed(3)),
    });

    cursor += duration + (index === scenes.length - 1 ? 0 : 0.28);
  });

  return {
    duration: Number(cursor.toFixed(3)),
    estimated: true,
    scenes: timelineScenes,
    cues,
  };
}

function isExternalUrl(value) {
  return /^(?:[a-z]+:|\/\/|#|\/)/i.test(value || '');
}

function rebaseMediaUrls(root) {
  const attributes = [
    ['src', 'img,video,audio,source,track,iframe'],
    ['href', 'a,link'],
    ['poster', 'video'],
  ];

  for (const [attribute, selector] of attributes) {
    root.querySelectorAll(selector).forEach(element => {
      const value = element.getAttribute(attribute);
      if (!value || isExternalUrl(value)) return;
      element.setAttribute(attribute, `${SOURCE_BASE}/${value}`);
    });
  }
}

function sceneIndexAt(seconds) {
  if (!state.timeline?.scenes?.length) return 0;
  const index = state.timeline.scenes.findIndex(scene => (
    seconds >= scene.start && seconds < scene.start + scene.duration
  ));
  return index === -1 ? state.timeline.scenes.length - 1 : index;
}

function progressAt(scene, seconds) {
  if (!scene?.duration) return 0;
  return Math.max(0, Math.min(1, (seconds - scene.start) / scene.duration));
}

function activeCueAt(seconds) {
  return state.timeline?.cues?.find(cue => seconds >= cue.start && seconds < cue.end);
}

function timelineMatchesSource(timeline, scenes) {
  const timelineScenes = timeline?.scenes || [];
  if (timelineScenes.length !== scenes.length) return false;
  return scenes.every((scene, index) => timelineScenes[index]?.id === scene.id);
}

function normalizeCaptionCue(cue, index) {
  return {
    id: String(cue?.id || `cue-${String(index + 1).padStart(4, '0')}`),
    scene_id: String(cue?.scene_id || ''),
    start: Number(cue?.start || 0),
    end: Number(cue?.end || 0),
    text: String(cue?.text || ''),
  };
}

function cueIdentityMatches(current, generated) {
  return current.id === generated.id && current.scene_id === generated.scene_id;
}

function cueTimingIsValid(cue, duration) {
  return Number.isFinite(cue.start)
    && Number.isFinite(cue.end)
    && cue.start >= 0
    && cue.end > cue.start
    && cue.end <= duration + 0.05;
}

function signatureMatchesTimeline(signature, timeline) {
  const timelineCues = timeline?.cues || [];
  if (!Array.isArray(signature) || signature.length !== timelineCues.length) return false;

  return signature.every((cue, index) => {
    const saved = normalizeCaptionCue(cue, index);
    const generated = normalizeCaptionCue(timelineCues[index], index);
    return cueIdentityMatches(saved, generated)
      && saved.text === generated.text
      && Math.abs(saved.start - generated.start) <= 0.002
      && Math.abs(saved.end - generated.end) <= 0.002;
  });
}

function captionsMatchTimeline(captions, timeline) {
  const cues = Array.isArray(captions) ? captions : captions?.cues;
  const timelineCues = timeline?.cues || [];
  if (!Array.isArray(cues) || cues.length !== timelineCues.length) return false;

  const hasSignature = !Array.isArray(captions) && Array.isArray(captions?.timeline_signature);
  if (hasSignature && !signatureMatchesTimeline(captions.timeline_signature, timeline)) return false;

  return cues.every((cue, index) => {
    const current = normalizeCaptionCue(cue, index);
    const generated = normalizeCaptionCue(timelineCues[index], index);
    if (!cueIdentityMatches(current, generated)) return false;
    if (!cueTimingIsValid(current, Number(timeline?.duration) || 0)) return false;

    if (!hasSignature) {
      return Math.abs(current.start - generated.start) <= 0.05
        && Math.abs(current.end - generated.end) <= 0.05;
    }
    return true;
  });
}

async function applyCaptionOverrides(timeline) {
  const captions = await fetchOptionalJson(`${SOURCE_BASE}/captions.json`);
  if (!captions || !captionsMatchTimeline(captions, timeline)) return timeline;

  const cues = (Array.isArray(captions) ? captions : captions.cues)
    .map((cue, index) => normalizeCaptionCue(cue, index));
  return { ...timeline, cues };
}

function chapterLabel(scene, index) {
  const value = scene?.category || scene?.chapter || scene?.title || scene?.id || `Scene ${index + 1}`;
  return String(value).trim();
}

function setupChapterRail() {
  if (!chapterRail) return;
  chapterRail.replaceChildren();

  const fill = document.createElement('i');
  fill.className = 'chapter-rail-fill';
  chapterRail.append(fill);

  const scenes = state.timeline?.scenes?.length ? state.timeline.scenes : state.scenes;
  chapterRail.style.gridTemplateColumns = scenes
    .map(scene => `${Math.max(0.7, Number(scene.duration) || 1)}fr`)
    .join(' ');

  scenes.forEach((scene, index) => {
    const item = document.createElement('div');
    item.className = 'chapter-tile';
    item.dataset.sceneId = scene.id || `scene-${index + 1}`;

    const number = document.createElement('span');
    number.className = 'chapter-index';
    number.textContent = pad(index + 1);

    const label = document.createElement('span');
    label.className = 'chapter-label';
    label.textContent = chapterLabel(scene, index);

    item.append(number, label);
    chapterRail.append(item);
  });
}

function updateChapterRail(activeIndex) {
  if (!chapterRail) return;
  const overallProgress = state.duration ? state.current / state.duration : 0;
  const clampedOverall = Math.max(0, Math.min(1, overallProgress));
  chapterRail.style.setProperty('--rail-progress', clampedOverall.toFixed(4));

  [...chapterRail.querySelectorAll('.chapter-tile')].forEach((item, index) => {
    item.classList.toggle('is-active', index === activeIndex);
    item.classList.toggle('is-done', index < activeIndex);
  });
}

function activateScene(scene, progress) {
  document.documentElement.style.setProperty('--progress', progress.toFixed(4));
  document.body.dataset.scene = scene?.id || '';

  const sections = [...stage.querySelectorAll('[data-scene]')];
  if (!sections.length) return;

  let active = sections.find(section => section.dataset.scene === scene.id);
  if (!active) active = sections[0];

  sections.forEach(section => section.classList.toggle('is-active', section === active));

  const steps = [...active.querySelectorAll('[data-step]')];
  const activeStep = steps.length ? Math.min(steps.length - 1, Math.floor(progress * steps.length)) : -1;
  steps.forEach((step, index) => step.classList.toggle('active', index <= activeStep));
}

function renderAtTime(seconds) {
  state.current = Math.max(0, Math.min(state.duration, Number(seconds) || 0));
  const index = sceneIndexAt(state.current);
  const scene = state.timeline.scenes[index] || state.timeline.scenes[0] || {};
  const progress = progressAt(scene, state.current);
  const cue = activeCueAt(state.current);

  activateScene(scene, progress);
  caption.textContent = cue?.text || '';
  caption.classList.toggle('show', Boolean(cue));
  updateChapterRail(index);

  if (timecode) timecode.textContent = formatTime(state.current, true);
  if (scrubber) scrubber.value = state.current;
}

function pause() {
  state.playing = false;
  if (playButton) playButton.textContent = 'Play';
  if (!audio.paused) audio.pause();
  cancelAnimationFrame(state.raf);
}

function tick(now) {
  if (!state.playing) return;

  if (!state.renderMode && audio.src && !audio.paused && Number.isFinite(audio.currentTime)) {
    state.current = audio.currentTime;
  } else {
    state.current = state.startOffset + (now - state.startedAt) / 1000;
  }

  if (state.current >= state.duration) {
    state.current = state.duration;
    renderAtTime(state.current);
    pause();
    return;
  }

  renderAtTime(state.current);
  state.raf = requestAnimationFrame(tick);
}

async function startPlayback() {
  state.playing = true;
  if (playButton) playButton.textContent = 'Pause';
  state.startedAt = performance.now();
  state.startOffset = state.current;

  if (!state.renderMode) {
    try {
      audio.currentTime = state.current;
      await audio.play();
    } catch {
      // Browser autoplay rules may block audio; the deterministic clock still works.
    }
  }

  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(tick);
}

if (playButton) {
  playButton.addEventListener('click', () => {
    if (state.playing) pause();
    else startPlayback();
  });
}

if (scrubber) {
  scrubber.addEventListener('input', () => {
    const wasPlaying = state.playing;
    pause();
    state.current = Number(scrubber.value);
    if (Number.isFinite(audio.duration)) audio.currentTime = state.current;
    renderAtTime(state.current);
    if (wasPlaying) startPlayback();
  });
}

async function init() {
  state.scenes = await fetchJson(`${SOURCE_BASE}/scenes.json`);
  stage.innerHTML = await fetchText(`${SOURCE_BASE}/body.html`);
  rebaseMediaUrls(stage);

  try {
    const timeline = await fetchJson(`${ASSET_BASE}/timeline.json`);
    state.timeline = timelineMatchesSource(timeline, state.scenes)
      ? await applyCaptionOverrides(timeline)
      : estimatedTimeline(state.scenes);
  } catch {
    state.timeline = estimatedTimeline(state.scenes);
  }

  state.duration = Number(state.timeline.duration) || 0;
  if (scrubber) scrubber.max = state.duration;
  if (durationLabel) durationLabel.textContent = formatTime(state.duration);
  setupChapterRail();

  renderAtTime(0);

  window.compositionReady = true;
  window.demoReady = true;
}

window.getCompositionDuration = () => state.duration;
window.getDemoDuration = window.getCompositionDuration;
window.renderAtTime = renderAtTime;
window.startCompositionPlayback = () => {
  state.current = 0;
  renderAtTime(0);
  return startPlayback();
};
window.startDeterministicPlayback = window.startCompositionPlayback;

init().catch(error => {
  stage.innerHTML = `<pre class="load-error">${error.message}</pre>`;
  throw error;
});
