const state = {
  captions: null,
  generated: null,
  scenes: [],
  selected: 0,
  query: '',
  dirty: false,
  duration: 0,
};

const statusText = document.querySelector('#statusText');
const cueCount = document.querySelector('#cueCount');
const durationText = document.querySelector('#durationText');
const cueSearch = document.querySelector('#cueSearch');
const cueList = document.querySelector('#cueList');
const cueIndex = document.querySelector('#cueIndex');
const cueTime = document.querySelector('#cueTime');
const cueScene = document.querySelector('#cueScene');
const cueStart = document.querySelector('#cueStart');
const cueEnd = document.querySelector('#cueEnd');
const cueText = document.querySelector('#cueText');
const saveButton = document.querySelector('#saveButton');
const restoreButton = document.querySelector('#restoreButton');
const shiftEarlierButton = document.querySelector('#shiftEarlierButton');
const shiftLaterButton = document.querySelector('#shiftLaterButton');
const narrationAudio = document.querySelector('#narrationAudio');

const pad = (value, width = 2) => String(value).padStart(width, '0');

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${pad(minutes)}:${pad(wholeSeconds)}.${pad(millis, 3)}`;
}

function formatNumber(seconds) {
  return (Math.round((Number(seconds) || 0) * 1000) / 1000).toFixed(3);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function highlight(text) {
  const safe = escapeHtml(text);
  const query = state.query.trim();
  if (!query) return safe;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(escaped, 'gi'), match => `<mark>${match}</mark>`);
}

function sceneTitle(sceneId) {
  const scene = state.scenes.find(item => item.id === sceneId);
  return scene ? `${scene.category || scene.title || scene.id}` : sceneId;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function currentCue() {
  return state.captions?.cues?.[state.selected];
}

function markDirty(message = 'unsaved changes') {
  state.dirty = true;
  setStatus(message);
}

function updateCueTimingDisplay(cue) {
  cueTime.textContent = cue ? `${formatTime(cue.start)} -> ${formatTime(cue.end)}` : '--';
}

function timingIsValid(cue) {
  return Number.isFinite(cue?.start)
    && Number.isFinite(cue?.end)
    && cue.start >= 0
    && cue.end > cue.start
    && cue.end <= state.duration + 0.05;
}

function renderList() {
  const cues = state.captions?.cues || [];
  const query = state.query.trim().toLowerCase();
  const filtered = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => !query || cue.text.toLowerCase().includes(query) || sceneTitle(cue.scene_id).toLowerCase().includes(query));

  cueList.innerHTML = filtered.map(({ cue, index }) => `
    <button class="cue-item ${index === state.selected ? 'active' : ''}" type="button" data-index="${index}">
      <span class="cue-time">${formatTime(cue.start)}<br>${formatTime(cue.end)}</span>
      <span class="cue-copy">${highlight(cue.text || '(empty)')}</span>
    </button>
  `).join('');

  cueList.querySelectorAll('.cue-item').forEach(button => {
    button.addEventListener('click', () => {
      state.selected = Number(button.dataset.index);
      render();
      const cue = currentCue();
      if (cue && narrationAudio) {
        narrationAudio.currentTime = Math.max(0, cue.start - 0.08);
      }
    });
  });
}

function renderDetail() {
  const cue = currentCue();
  if (!cue) {
    cueIndex.textContent = '--';
    cueTime.textContent = '--';
    cueScene.textContent = '--';
    cueStart.value = '';
    cueEnd.value = '';
    cueStart.disabled = true;
    cueEnd.disabled = true;
    cueText.value = '';
    cueText.disabled = true;
    return;
  }

  cueStart.disabled = false;
  cueEnd.disabled = false;
  cueText.disabled = false;
  cueIndex.textContent = cue.id || `cue-${state.selected + 1}`;
  updateCueTimingDisplay(cue);
  cueScene.textContent = sceneTitle(cue.scene_id);
  if (cueStart.value !== formatNumber(cue.start)) cueStart.value = formatNumber(cue.start);
  if (cueEnd.value !== formatNumber(cue.end)) cueEnd.value = formatNumber(cue.end);
  if (cueText.value !== cue.text) cueText.value = cue.text;
}

function render() {
  const cues = state.captions?.cues || [];
  cueCount.textContent = String(cues.length);
  renderList();
  renderDetail();
}

async function loadCaptions() {
  setStatus('loading captions...');
  const response = await fetch('/api/captions', { cache: 'no-store' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }

  const payload = await response.json();
  state.captions = payload.captions;
  state.generated = payload.generated;
  state.scenes = payload.scenes || [];
  state.duration = Number(payload.duration || 0);
  state.selected = 0;
  state.dirty = false;

  durationText.textContent = formatTime(state.duration);
  setStatus(payload.saved ? 'loaded captions.json' : 'using generated timeline cues');
  render();
}

async function saveCaptions() {
  if (!state.captions) return;
  setStatus('saving...');
  const response = await fetch('/api/captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.captions),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }

  const payload = await response.json();
  state.captions = payload.doc;
  state.dirty = false;
  setStatus(`saved ${payload.saved.length} file(s)`);
  render();
}

cueSearch.addEventListener('input', () => {
  state.query = cueSearch.value;
  renderList();
});

cueText.addEventListener('input', () => {
  const cue = currentCue();
  if (!cue) return;
  cue.text = cueText.value;
  renderList();
  markDirty();
});

function updateTimingFromInputs() {
  const cue = currentCue();
  if (!cue) return;
  cue.start = Number.parseFloat(cueStart.value);
  cue.end = Number.parseFloat(cueEnd.value);
  updateCueTimingDisplay(cue);
  renderList();

  if (!timingIsValid(cue)) {
    markDirty('invalid timing: start must be before end and inside duration');
    statusText.classList.add('error');
    return;
  }
  markDirty();
}

cueStart.addEventListener('input', updateTimingFromInputs);
cueEnd.addEventListener('input', updateTimingFromInputs);

function shiftCurrentCue(delta) {
  const cue = currentCue();
  if (!cue || !timingIsValid(cue)) return;
  const span = cue.end - cue.start;
  const maxStart = Math.max(0, state.duration - span);
  cue.start = Number(formatNumber(clamp(cue.start + delta, 0, maxStart)));
  cue.end = Number(formatNumber(cue.start + span));
  render();
  if (narrationAudio) narrationAudio.currentTime = Math.max(0, cue.start - 0.08);
  markDirty();
}

shiftEarlierButton.addEventListener('click', () => shiftCurrentCue(-0.1));
shiftLaterButton.addEventListener('click', () => shiftCurrentCue(0.1));

function restoreGeneratedCue() {
  const cue = currentCue();
  const generated = state.generated?.cues?.[state.selected];
  if (!cue || !generated) return;
  cue.text = generated.text;
  cue.start = generated.start;
  cue.end = generated.end;
  render();
  if (narrationAudio) narrationAudio.currentTime = Math.max(0, cue.start - 0.08);
  markDirty('restored generated cue, not saved yet');
}

restoreButton.addEventListener('click', () => {
  restoreGeneratedCue();
});

saveButton.addEventListener('click', () => {
  saveCaptions().catch(error => setStatus(error.message, true));
});

window.addEventListener('beforeunload', event => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

loadCaptions().catch(error => {
  setStatus(error.message, true);
  cueList.innerHTML = '<p class="error">Run python main.py tts --source &lt;folder&gt;, then refresh.</p>';
});
