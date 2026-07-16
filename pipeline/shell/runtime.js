const RUNTIME_PARAMS = new URLSearchParams(window.location.search);
const PROJECT_BASE = RUNTIME_PARAMS.get('projectBase') || '/.local/work/starter';
const SOURCE_BASE = PROJECT_BASE.replace(/\/$/, '');
const ASSET_BASE = `${SOURCE_BASE}/generated`;
const NARRATION_SRC = `${ASSET_BASE}/narration.mp3`;
const DEFAULT_SCENE_TRANSITION_SECONDS = 0.4;
const MAX_SCENE_TRANSITION_SECONDS = 2;

function resolveTransitionSeconds(search) {
  const raw = new URLSearchParams(search).get('transition');
  if (raw === null || raw.trim() === '') return DEFAULT_SCENE_TRANSITION_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SCENE_TRANSITION_SECONDS;
  return Math.max(0, Math.min(MAX_SCENE_TRANSITION_SECONDS, parsed));
}

const SCENE_TRANSITION_SECONDS = resolveTransitionSeconds(window.location.search);

const state = {
  scenes: [],
  timeline: null,
  duration: 0,
  current: 0,
  playing: false,
  raf: null,
  startedAt: 0,
  startOffset: 0,
  hasNarrationAudio: false,
  renderMode: RUNTIME_PARAMS.has('render'),
  embedMode: RUNTIME_PARAMS.has('embed'),
  projectMeta: {},
  visualModule: null,
};

const stage = document.querySelector('#stage');
const caption = document.querySelector('#caption');
const captionSafe = document.querySelector('.caption-safe');
const audio = document.querySelector('#narration');
const playButton = document.querySelector('#playButton');
const scrubber = document.querySelector('#scrubber');
const timecode = document.querySelector('#timecode');
const durationLabel = document.querySelector('#durationLabel');
const chapterRail = document.querySelector('#chapterRail');
const sceneTransition = document.querySelector('#sceneTransition');

document.documentElement.classList.toggle('render-mode', state.renderMode);
document.documentElement.classList.toggle('preview-mode', !state.renderMode);
document.documentElement.classList.toggle('embed-mode', state.embedMode);

const pad = (value, width = 2) => String(value).padStart(width, '0');

function formatTime(seconds, withMs = false) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${pad(minutes)}:${pad(wholeSeconds)}${withMs ? `.${pad(millis, 3)}` : ''}`;
}

function fitCaptionText() {
  caption.style.removeProperty('font-size');
  if (!caption.textContent || !captionSafe) return;

  const allowedHeight = Math.max(44, captionSafe.clientHeight * 1.35);
  const minimumSize = Math.max(10, window.innerHeight * 0.014);
  let size = Number.parseFloat(getComputedStyle(caption).fontSize) || 17;
  while (caption.scrollHeight > allowedHeight && size > minimumSize) {
    size = Math.max(minimumSize, size - 1);
    caption.style.fontSize = `${size}px`;
  }
}

function renderCaption(cue) {
  const text = cue?.text || '';
  if (caption.textContent !== text) {
    caption.textContent = text;
    fitCaptionText();
  }
  caption.classList.toggle('show', Boolean(text));
}

function captionTextUnits(text) {
  return [...String(text || '').trim()].reduce((total, char) => {
    if (/\s/u.test(char)) return total + 0.3;
    if (/^[\x00-\x7f]$/u.test(char)) return total + 0.55;
    return total + 1;
  }, 0);
}

function splitNarration(text) {
  const source = String(text || '');
  const tokens = source.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|\s+|./gu) || [source];
  const chunks = [];
  let current = '';

  tokens.forEach(token => {
    if (current && captionTextUnits(current + token) > 26) {
      chunks.push(current.trim());
      current = '';
    }
    current += token;
    const hardBreak = /[\u3002\uff01\uff1f\uff1b.!?;][\u201d\u2019"'\uff09\u3011\u300b]*\s*$/u.test(current);
    const softBreak = /[\uff0c\u3001\uff1a,:][\u201d\u2019"'\uff09\u3011\u300b]*\s*$/u.test(current)
      && captionTextUnits(current) >= 8;
    if (hardBreak || softBreak) {
      chunks.push(current.trim());
      current = '';
    }
  });
  if (current.trim()) chunks.push(current.trim());

  if (chunks.length > 1) {
    const tail = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    const previousEndsSentence = /[\u3002\uff01\uff1f\uff1b.!?;][\u201d\u2019"'\uff09\u3011\u300b]*$/u.test(previous);
    if (!previousEndsSentence && captionTextUnits(tail) <= 7 && captionTextUnits(previous + tail) <= 36) {
      chunks.splice(-2, 2, `${previous}${tail}`);
    }
  }
  return chunks.length ? chunks : [source];
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

function sourceUrl(value) {
  if (!value || /^(?:[a-z]+:|\/\/|#|\/)/i.test(value)) return value;
  return `${SOURCE_BASE}/${value.replace(/^\.\//, '')}`;
}

function clearEmbeddedAssets() {
  document.querySelectorAll('[data-source-embedded]').forEach(element => element.remove());
}

function rebaseEmbeddedCss(source) {
  return String(source || '').replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, quote, value) => {
    const trimmed = value.trim();
    if (isExternalUrl(trimmed) || trimmed.startsWith('data:')) return match;
    return `url("${sourceUrl(trimmed)}")`;
  });
}

async function importInlineModule(source) {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function executeEmbeddedScripts(scripts) {
  if (!scripts.length) return null;
  if (scripts.length > 1) throw new Error('body.html may include at most one deterministic module script');
  const script = scripts[0];
  if ((script.getAttribute('type') || '').trim().toLowerCase() !== 'module' || script.hasAttribute('src')) {
    throw new Error('body.html scripts must be one inline type="module" visual module');
  }
  const module = await importInlineModule(script.textContent || '');
  if (typeof module.mount !== 'function' || typeof module.renderAtTime !== 'function') {
    throw new Error('body.html visual code must export mount() and renderAtTime()');
  }
  return module;
}

async function loadBodyDocument(source) {
  clearEmbeddedAssets();
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const styles = [...parsed.querySelectorAll('style, link[rel~="stylesheet"]')];
  const scripts = [...parsed.querySelectorAll('script')];
  styles.forEach(original => {
    const element = document.importNode(original, true);
    element.dataset.sourceEmbedded = '';
    if (element.tagName === 'LINK') element.href = sourceUrl(element.getAttribute('href'));
    else element.textContent = rebaseEmbeddedCss(element.textContent);
    document.head.append(element);
    original.remove();
  });
  scripts.forEach(script => script.remove());
  stage.innerHTML = parsed.body.innerHTML;
  rebaseMediaUrls(stage);
  return scripts;
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
  const scenes = state.timeline?.scenes || [];
  if (!scenes.length) return 0;
  let index = 0;
  for (let candidate = 1; candidate < scenes.length; candidate += 1) {
    const previous = scenes[candidate - 1];
    const previousEnd = Number(previous.start || 0) + Number(previous.duration || 0);
    const nextStart = Number(scenes[candidate].start || previousEnd);
    const cut = (previousEnd + nextStart) / 2;
    if (seconds < cut) break;
    index = candidate;
  }
  return index;
}

function transitionOpacityAt(seconds) {
  const scenes = state.timeline?.scenes || [];
  if (scenes.length < 2 || SCENE_TRANSITION_SECONDS <= 0) return 0;

  for (let index = 0; index < scenes.length - 1; index += 1) {
    const current = scenes[index];
    const next = scenes[index + 1];
    const currentEnd = Number(current.start || 0) + Number(current.duration || 0);
    const nextStart = Number(next.start || currentEnd);
    const midpoint = (currentEnd + nextStart) / 2;
    const halfDuration = SCENE_TRANSITION_SECONDS / 2;
    const transitionStart = midpoint - halfDuration;
    const transitionEnd = midpoint + halfDuration;

    if (seconds >= transitionStart && seconds < midpoint) {
      return Math.max(0, Math.min(1, (seconds - transitionStart) / halfDuration));
    }
    if (seconds >= midpoint && seconds < transitionEnd) {
      return Math.max(0, Math.min(1, 1 - (seconds - midpoint) / halfDuration));
    }
  }
  return 0;
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
  return scenes.every((scene, index) => (
    timelineScenes[index]?.id === scene.id
    && String(timelineScenes[index]?.narration || '') === String(scene.narration || '')
  ));
}

function timelineAudioKey(timeline) {
  const raw = [
    timeline?.duration,
    timeline?.voice,
    timeline?.rate,
    timeline?.pitch,
    ...(timeline?.scenes || []).map(scene => `${scene.id}:${scene.narration}`),
  ].join('|');
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function setNarrationAudio(enabled, timeline = null) {
  state.hasNarrationAudio = Boolean(enabled && audio);
  if (!audio) return;
  if (state.hasNarrationAudio) {
    audio.src = `${NARRATION_SRC}?v=${timelineAudioKey(timeline)}`;
    audio.load();
    return;
  }
  if (!audio.paused) audio.pause();
  audio.removeAttribute('src');
  audio.load();
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
  document.body.dataset.activeScene = scene?.id || '';

  const sections = [...stage.querySelectorAll('[data-scene]')];
  if (!sections.length) return;

  let active = sections.find(section => section.dataset.scene === scene.id);
  if (!active) active = sections[0];

  sections.forEach(section => {
    const isActive = section === active;
    section.hidden = !isActive;
    section.classList.toggle('is-active', isActive);
    section.classList.toggle('active', isActive);
  });

  const steps = [...active.querySelectorAll('[data-step]')];
  const activeStep = steps.length ? Math.min(steps.length - 1, Math.floor(progress * steps.length)) : -1;
  steps.forEach((step, index) => step.classList.toggle('active', index <= activeStep));
}

function renderAtTime(seconds) {
  state.current = Math.max(0, Math.min(state.duration, Number(seconds) || 0));
  const index = sceneIndexAt(state.current);
  const timelineScene = state.timeline.scenes[index] || state.timeline.scenes[0] || {};
  const sourceScene = state.scenes.find(item => item.id === timelineScene.id) || state.scenes[index] || {};
  const scene = { ...sourceScene, ...timelineScene };
  const progress = progressAt(scene, state.current);
  const cue = activeCueAt(state.current);

  activateScene(scene, progress);
  renderCaption(cue);
  updateChapterRail(index);
  if (sceneTransition) sceneTransition.style.opacity = transitionOpacityAt(state.current).toFixed(4);

  if (state.visualModule?.renderAtTime) {
    state.visualModule.renderAtTime(state.current, {
      root: stage,
      scenes: state.scenes,
      scene,
      sceneIndex: index,
      sceneTime: Math.max(0, state.current - (Number(scene.start) || 0)),
      sceneProgress: progress,
      duration: state.duration,
      mediaBase: `${SOURCE_BASE}/media`,
      renderMode: state.renderMode,
    });
  }

  if (timecode) timecode.textContent = formatTime(state.current, true);
  if (scrubber) scrubber.value = state.current;
}

window.addEventListener('resize', fitCaptionText);

function playbackState() {
  return {
    playing: state.playing,
    current: state.current,
    duration: state.duration,
  };
}

function publishPlaybackState() {
  window.dispatchEvent(new CustomEvent('shell-playback-state', { detail: playbackState() }));
}

function pause() {
  state.playing = false;
  if (playButton) playButton.textContent = 'Play';
  if (audio && !audio.paused) audio.pause();
  cancelAnimationFrame(state.raf);
  publishPlaybackState();
}

function tick(now) {
  if (!state.playing) return;

  if (!state.renderMode && state.hasNarrationAudio && audio && !audio.paused && Number.isFinite(audio.currentTime)) {
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
  if (state.current >= state.duration) {
    state.current = 0;
    renderAtTime(0);
  }
  state.playing = true;
  if (playButton) playButton.textContent = 'Pause';
  state.startedAt = performance.now();
  state.startOffset = state.current;

  if (!state.renderMode && state.hasNarrationAudio && audio) {
    try {
      audio.currentTime = state.current;
      await audio.play();
    } catch {
      // Browser autoplay rules may block audio; the deterministic clock still works.
    }
  }

  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(tick);
  publishPlaybackState();
}

function togglePlayback() {
  if (state.playing) {
    pause();
    return Promise.resolve(playbackState());
  }
  return startPlayback().then(playbackState);
}

if (playButton) {
  playButton.addEventListener('click', togglePlayback);
}

if (scrubber) {
  scrubber.addEventListener('input', () => {
    const wasPlaying = state.playing;
    pause();
    state.current = Number(scrubber.value);
    if (state.hasNarrationAudio && audio && Number.isFinite(audio.duration)) audio.currentTime = state.current;
    renderAtTime(state.current);
    if (wasPlaying) startPlayback();
  });
}

async function init() {
  state.scenes = await fetchJson(`${SOURCE_BASE}/scenes.json`);
  state.projectMeta = await fetchOptionalJson(`${SOURCE_BASE}/manifest.json`) || {};
  const embeddedScripts = await loadBodyDocument(await fetchText(`${SOURCE_BASE}/body.html`));

  try {
    const timeline = await fetchJson(`${ASSET_BASE}/timeline.json`);
    if (timelineMatchesSource(timeline, state.scenes)) {
      state.timeline = await applyCaptionOverrides(timeline);
      setNarrationAudio(true, timeline);
    } else {
      state.timeline = estimatedTimeline(state.scenes);
      setNarrationAudio(false);
    }
  } catch {
    state.timeline = estimatedTimeline(state.scenes);
    setNarrationAudio(false);
  }

  state.duration = Number(state.timeline.duration) || 0;
  if (scrubber) scrubber.max = state.duration;
  if (durationLabel) durationLabel.textContent = formatTime(state.duration);
  setupChapterRail();

  state.visualModule = await executeEmbeddedScripts(embeddedScripts);
  if (state.visualModule) {
    if (typeof state.visualModule.mount !== 'function' || typeof state.visualModule.renderAtTime !== 'function') {
      throw new Error('body.html visual code must export mount() and renderAtTime()');
    }
    await state.visualModule.mount({
      root: stage,
      scenes: state.scenes,
      timeline: state.timeline,
      duration: state.duration,
      mediaBase: `${SOURCE_BASE}/media`,
      renderMode: state.renderMode,
    });
  }

  renderAtTime(0);
  publishPlaybackState();

  window.compositionReady = true;
  window.demoReady = true;
}

window.getCompositionDuration = () => state.duration;
window.getDemoDuration = window.getCompositionDuration;
window.renderAtTime = renderAtTime;
window.getPlaybackState = playbackState;
window.togglePlayback = togglePlayback;
window.compositionError = null;
window.startCompositionPlayback = () => {
  state.current = 0;
  renderAtTime(0);
  return startPlayback();
};
window.startDeterministicPlayback = window.startCompositionPlayback;
window.addEventListener('beforeunload', () => state.visualModule?.destroy?.());

init().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  window.compositionError = message;
  stage.innerHTML = `<pre class="load-error"></pre>`;
  stage.querySelector('.load-error').textContent = message;
  throw error;
});
