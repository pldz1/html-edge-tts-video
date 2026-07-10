const $ = selector => document.querySelector(selector);

const state = {
  captions: null,
  generated: null,
  scenes: [],
  selected: 0,
  query: '',
  sceneQuery: '',
  filterScene: false,
  dirty: false,
  saved: false,
  duration: 0,
  previewReady: false,
  previewRetries: 0,
  raf: 0,
};

const els = {
  statusText: $('#statusText'), engineStatus: $('#engineStatus'), engineDot: $('#engineDot'),
  captionProjectSelect: $('#captionProjectSelect'),
  sceneSearch: $('#sceneSearch'), sceneList: $('#sceneList'), sceneScrollLeft: $('#sceneScrollLeft'), sceneScrollRight: $('#sceneScrollRight'),
  currentTimeText: $('#currentTimeText'), durationText: $('#durationText'), timelineTrack: $('#timelineTrack'), timelineProgress: $('#timelineProgress'), timelineCues: $('#timelineCues'), timelinePlayhead: $('#timelinePlayhead'), timelinePlayButton: $('#timelinePlayButton'),
  previousSceneButton: $('#previousSceneButton'), nextSceneButton: $('#nextSceneButton'),
  previewFrame: $('#previewFrame'), sceneBadge: $('#sceneBadge'), liveCaption: $('#liveCaption'), previewPlayButton: $('#previewPlayButton'), previousCueButton: $('#previousCueButton'), nextCueButton: $('#nextCueButton'), locateCueButton: $('#locateCueButton'), narrationAudio: $('#narrationAudio'),
  cueCount: $('#cueCount'), totalDuration: $('#totalDuration'), footerCueCount: $('#footerCueCount'), cueSearch: $('#cueSearch'), filterSceneButton: $('#filterSceneButton'), cueList: $('#cueList'), exportButton: $('#exportButton'),
  cueStart: $('#cueStart'), cueEnd: $('#cueEnd'), cueDuration: $('#cueDuration'), cueText: $('#cueText'), textCount: $('#textCount'),
  startEarlierButton: $('#startEarlierButton'), startLaterButton: $('#startLaterButton'), endEarlierButton: $('#endEarlierButton'), endLaterButton: $('#endLaterButton'),
  autoWrapToggle: $('#autoWrapToggle'), punctuationToggle: $('#punctuationToggle'), twoLineToggle: $('#twoLineToggle'), restoreButton: $('#restoreButton'), saveButton: $('#saveButton'), jumpListButton: $('#jumpListButton'),
  modifiedText: $('#modifiedText'), saveState: $('#saveState'), notification: $('#notification'),
};

let notificationTimer = 0;
const pad = (value, width = 2) => String(value).padStart(width, '0');

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function formatTime(seconds, withMs = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${pad(minutes)}:${pad(whole)}${withMs ? `.${pad(millis, 3)}` : ''}`;
}

function formatNumber(seconds) {
  return (Math.round((Number(seconds) || 0) * 1000) / 1000).toFixed(3);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function notify(message, tone = '') {
  window.clearTimeout(notificationTimer);
  els.notification.textContent = message;
  els.notification.className = `notification show ${tone}`.trim();
  notificationTimer = window.setTimeout(() => { els.notification.className = 'notification'; }, 3000);
}

function setStatus(message, error = false) {
  els.statusText.textContent = message;
  els.engineStatus.textContent = error ? '连接失败' : '运行正常';
  els.engineDot.classList.toggle('error', error);
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function loadProjectList() {
  const data = await apiJson('/api/projects');
  const projects = data.projects || [];
  els.captionProjectSelect.innerHTML = projects.length
    ? projects.map(project => `<option value="${escapeHtml(project.slug)}" ${project.active ? 'selected' : ''}>${escapeHtml(project.title || project.slug)}</option>`).join('')
    : '<option value="">暂无项目</option>';
  els.captionProjectSelect.disabled = !projects.length;
}

async function switchCaptionProject(slugValue) {
  const slug = String(slugValue || '').trim();
  if (!slug) return;
  if (state.dirty && !window.confirm('当前字幕有未保存修改，切换项目会丢失这些修改。继续吗？')) {
    await loadProjectList();
    return;
  }
  setStatus('正在切换项目');
  await apiJson('/api/projects/load', { method: 'POST', body: JSON.stringify({ project: slug }) });
  state.dirty = false;
  state.previewReady = false;
  els.narrationAudio.pause();
  await loadCaptions();
}

function currentCue() {
  return state.captions?.cues?.[state.selected];
}

function currentScene() {
  const cue = currentCue();
  return state.scenes.find(scene => scene.id === cue?.scene_id) || state.scenes[0];
}

function sceneLabel(scene, index = 0) {
  return scene?.category || scene?.title || scene?.id || `Scene ${index + 1}`;
}

function sceneNumber(scene) {
  const index = state.scenes.findIndex(item => item.id === scene?.id);
  return index >= 0 ? index + 1 : 1;
}

function cueIndexAt(seconds) {
  const cues = state.captions?.cues || [];
  const exact = cues.findIndex(cue => seconds >= cue.start && seconds < cue.end);
  if (exact >= 0) return exact;
  let previous = 0;
  cues.forEach((cue, index) => { if (cue.start <= seconds) previous = index; });
  return previous;
}

function timingIsValid(cue) {
  return Number.isFinite(cue?.start) && Number.isFinite(cue?.end) && cue.start >= 0 && cue.end > cue.start && cue.end <= state.duration + .05;
}

function markDirty(message = '字幕内容已修改') {
  state.dirty = true;
  els.saveState.textContent = '未保存';
  els.saveState.classList.add('dirty');
  els.modifiedText.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`;
}

function highlight(text) {
  const safe = escapeHtml(text);
  const query = state.query.trim();
  if (!query) return safe;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(escaped, 'gi'), match => `<mark>${match}</mark>`);
}

function renderScenes() {
  const active = currentScene();
  const query = state.sceneQuery.trim().toLowerCase();
  els.sceneList.innerHTML = state.scenes.map((scene, index) => ({ scene, index }))
    .filter(({ scene, index }) => !query || `${sceneLabel(scene, index)} ${scene.title || ''}`.toLowerCase().includes(query))
    .map(({ scene, index }) => `
      <button class="scene-card ${scene.id === active?.id ? 'active' : ''}" type="button" data-scene-id="${escapeHtml(scene.id)}">
        <span class="scene-card-visual"></span>
        <span class="scene-card-copy"><strong>Scene ${pad(index + 1)}</strong><span>${formatTime(scene.start || 0, false)}</span></span>
      </button>`).join('');
  const activeCard = els.sceneList.querySelector('.scene-card.active');
  if (activeCard) activeCard.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderTimelineDots() {
  const cues = state.captions?.cues || [];
  els.timelineCues.innerHTML = cues.map((cue, index) => `<i class="timeline-cue-dot ${index === state.selected ? 'active' : ''}" style="left:${state.duration ? cue.start / state.duration * 100 : 0}%"></i>`).join('');
}

function renderList() {
  const cues = state.captions?.cues || [];
  const query = state.query.trim().toLowerCase();
  const sceneId = currentScene()?.id;
  const filtered = cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => {
    if (state.filterScene && cue.scene_id !== sceneId) return false;
    return !query || cue.text.toLowerCase().includes(query) || cue.scene_id.toLowerCase().includes(query);
  });
  els.cueList.innerHTML = filtered.map(({ cue, index }) => `
    <button class="cue-item ${index === state.selected ? 'active' : ''}" type="button" data-index="${index}">
      <span class="cue-index">${pad(index + 1, 3)}</span><span class="cue-time">${formatTime(cue.start, false)}</span><span class="cue-time">${formatTime(cue.end, false)}</span><span class="cue-copy">${highlight(cue.text || '(空字幕)')}</span><span class="cue-status">✓</span>
    </button>`).join('');
}

function renderDetail() {
  const cue = currentCue();
  const disabled = !cue;
  [els.cueStart, els.cueEnd, els.cueText, els.restoreButton, els.saveButton].forEach(element => { element.disabled = disabled; });
  if (!cue) {
    els.cueStart.value = ''; els.cueEnd.value = ''; els.cueDuration.value = ''; els.cueText.value = ''; els.textCount.textContent = '0 / 200';
    return;
  }
  els.cueStart.value = formatNumber(cue.start);
  els.cueEnd.value = formatNumber(cue.end);
  els.cueDuration.value = formatTime(cue.end - cue.start);
  if (els.cueText.value !== cue.text) els.cueText.value = cue.text;
  els.textCount.textContent = `${cue.text.length} / 200`;
  els.liveCaption.textContent = cue.text || '（空字幕）';
  els.sceneBadge.textContent = `Scene ${pad(sceneNumber(currentScene()))}`;
}

function renderSummary() {
  const count = state.captions?.cues?.length || 0;
  els.cueCount.textContent = `${count} cues`;
  els.footerCueCount.textContent = String(count);
  els.durationText.textContent = formatTime(state.duration);
  els.totalDuration.textContent = formatTime(state.duration, false);
}

function renderSelection() {
  renderScenes();
  renderTimelineDots();
  renderList();
  renderDetail();
  renderSummary();
}

function seekPreview(seconds) {
  const time = clamp(Number(seconds) || 0, 0, state.duration || 0);
  try {
    if (state.previewReady && typeof els.previewFrame.contentWindow.renderAtTime === 'function') {
      els.previewFrame.contentWindow.renderAtTime(time);
    }
  } catch { /* The preview remains usable even if the iframe is reloading. */ }
  const percent = state.duration ? time / state.duration * 100 : 0;
  els.timelineProgress.style.width = `${percent}%`;
  els.timelinePlayhead.style.left = `${percent}%`;
  els.currentTimeText.textContent = formatTime(time);
}

function preparePreviewFrame() {
  try {
    if (!els.previewFrame.contentWindow?.compositionReady) {
      state.previewReady = false;
      if (state.previewRetries < 50) {
        state.previewRetries += 1;
        window.setTimeout(preparePreviewFrame, 100);
      }
      return;
    }
    const doc = els.previewFrame.contentDocument;
    const caption = doc?.querySelector('#caption');
    const captionSafe = doc?.querySelector('.caption-safe');
    const chapterRail = doc?.querySelector('#chapterRail');
    if (caption) caption.style.setProperty('display', 'none', 'important');
    if (captionSafe) captionSafe.style.setProperty('display', 'none', 'important');
    if (chapterRail) chapterRail.style.setProperty('display', 'none', 'important');
  } catch { /* Same-origin local preview is expected; keep the frame if unavailable. */ }
  state.previewRetries = 0;
  state.previewReady = true;
  seekPreview(els.narrationAudio.currentTime || 0);
}

function selectCue(index, { seek = true, focus = false } = {}) {
  const cues = state.captions?.cues || [];
  state.selected = clamp(Number(index) || 0, 0, Math.max(0, cues.length - 1));
  renderSelection();
  const cue = currentCue();
  if (cue && seek) {
    els.narrationAudio.currentTime = Math.max(0, cue.start + .01);
    seekPreview(cue.start + .01);
  }
  if (focus) els.cueList.querySelector('.cue-item.active')?.scrollIntoView({ block: 'nearest' });
}

function syncPlaybackFrame() {
  const time = els.narrationAudio.currentTime || 0;
  seekPreview(time);
  const index = cueIndexAt(time);
  if (index !== state.selected) {
    state.selected = index;
    renderSelection();
  }
  if (!els.narrationAudio.paused) state.raf = requestAnimationFrame(syncPlaybackFrame);
}

function setPlayIcons(playing) {
  const icon = playing ? 'pause' : 'play';
  els.timelinePlayButton.innerHTML = `<i data-lucide="${icon}"></i>`;
  els.previewPlayButton.innerHTML = `<i data-lucide="${icon}"></i><span>${playing ? '暂停' : '播放'}</span>`;
  renderIcons();
}

function togglePlayback() {
  if (!state.captions) return;
  if (els.narrationAudio.paused) els.narrationAudio.play().catch(error => notify(error.message, 'error'));
  else els.narrationAudio.pause();
}

function sceneCueIndex(offset) {
  const scene = currentScene();
  const sceneIndex = Math.max(0, state.scenes.findIndex(item => item.id === scene?.id));
  const target = state.scenes[clamp(sceneIndex + offset, 0, Math.max(0, state.scenes.length - 1))];
  return Math.max(0, state.captions.cues.findIndex(cue => cue.scene_id === target?.id));
}

function updateTimingFromInputs() {
  const cue = currentCue();
  if (!cue) return;
  cue.start = Number.parseFloat(els.cueStart.value);
  cue.end = Number.parseFloat(els.cueEnd.value);
  if (!timingIsValid(cue)) {
    els.saveState.textContent = '时间无效';
    els.saveState.classList.add('dirty');
    return;
  }
  markDirty('更新了字幕时间');
  renderSelection();
  seekPreview(cue.start);
}

function adjustBoundary(which, delta) {
  const cue = currentCue();
  if (!cue) return;
  if (which === 'start') cue.start = Number(formatNumber(clamp(cue.start + delta, 0, cue.end - .02)));
  else cue.end = Number(formatNumber(clamp(cue.end + delta, cue.start + .02, state.duration)));
  markDirty('微调了字幕时间');
  renderSelection();
  els.narrationAudio.currentTime = cue.start;
  seekPreview(cue.start);
}

function shiftCue(delta) {
  const cue = currentCue();
  if (!cue || !timingIsValid(cue)) return;
  const span = cue.end - cue.start;
  cue.start = Number(formatNumber(clamp(cue.start + delta, 0, state.duration - span)));
  cue.end = Number(formatNumber(cue.start + span));
  markDirty('平移了字幕时间');
  renderSelection();
  els.narrationAudio.currentTime = cue.start;
  seekPreview(cue.start);
}

async function loadCaptions() {
  setStatus('正在加载');
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
  state.saved = Boolean(payload.saved);
  if (payload.audioUrl) els.narrationAudio.src = payload.audioUrl;
  if (payload.previewUrl) {
    const previewUrl = new URL(payload.previewUrl, window.location.origin);
    previewUrl.searchParams.set('render', '1');
    previewUrl.searchParams.set('caption-editor', '1');
    if (els.previewFrame.src !== previewUrl.href) {
      state.previewReady = false;
      els.previewFrame.src = previewUrl.href;
    }
  }
  els.saveState.textContent = '已保存';
  els.saveState.classList.remove('dirty');
  setStatus(payload.saved ? '已载入字幕文件' : '使用自动生成字幕');
  renderSelection();
  seekPreview(0);
  if (els.previewFrame.contentDocument?.readyState === 'complete') preparePreviewFrame();
}

async function saveCaptions() {
  if (!state.captions) return;
  const invalid = state.captions.cues.find(cue => !timingIsValid(cue));
  if (invalid) { notify('存在无效字幕时间，无法保存', 'error'); return; }
  setStatus('正在保存');
  const response = await fetch('/api/captions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.captions),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }
  const payload = await response.json();
  state.captions = payload.doc;
  state.dirty = false;
  els.saveState.textContent = '已保存';
  els.saveState.classList.remove('dirty');
  els.modifiedText.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 保存了 captions.json`;
  setStatus('保存完成');
  notify(`字幕已保存到 ${payload.saved.length} 个位置`, 'success');
}

function restoreGeneratedCue() {
  const generated = state.generated?.cues?.[state.selected];
  if (!generated) return;
  state.captions.cues[state.selected] = { ...generated };
  markDirty('恢复了自动生成字幕');
  renderSelection();
}

function exportSrt() {
  const cues = state.captions?.cues || [];
  const srtTime = seconds => {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    const millis = Math.round((safe % 1) * 1000);
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
  };
  const content = cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'captions.srt'; anchor.click();
  URL.revokeObjectURL(url);
  notify('SRT 字幕已导出', 'success');
}

function bindEvents() {
  els.captionProjectSelect.addEventListener('change', () => {
    switchCaptionProject(els.captionProjectSelect.value).catch(error => {
      setStatus(error.message, true);
      notify(error.message, 'error');
    });
  });
  els.sceneSearch.addEventListener('input', () => { state.sceneQuery = els.sceneSearch.value; renderScenes(); });
  els.cueSearch.addEventListener('input', () => { state.query = els.cueSearch.value; renderList(); });
  els.sceneList.addEventListener('click', event => {
    const card = event.target.closest('[data-scene-id]');
    if (!card) return;
    const index = state.captions.cues.findIndex(cue => cue.scene_id === card.dataset.sceneId);
    if (index >= 0) selectCue(index, { focus: true });
  });
  els.cueList.addEventListener('click', event => {
    const item = event.target.closest('[data-index]');
    if (item) selectCue(Number(item.dataset.index), { focus: true });
  });
  els.sceneScrollLeft.addEventListener('click', () => els.sceneList.scrollBy({ left: -220, behavior: 'smooth' }));
  els.sceneScrollRight.addEventListener('click', () => els.sceneList.scrollBy({ left: 220, behavior: 'smooth' }));
  els.timelineTrack.addEventListener('click', event => {
    const rect = els.timelineTrack.getBoundingClientRect();
    const time = clamp((event.clientX - rect.left) / rect.width, 0, 1) * state.duration;
    els.narrationAudio.currentTime = time; state.selected = cueIndexAt(time); renderSelection(); seekPreview(time);
  });
  els.timelinePlayButton.addEventListener('click', togglePlayback);
  els.previewPlayButton.addEventListener('click', togglePlayback);
  els.previousCueButton.addEventListener('click', () => selectCue(state.selected - 1, { focus: true }));
  els.nextCueButton.addEventListener('click', () => selectCue(state.selected + 1, { focus: true }));
  els.locateCueButton.addEventListener('click', () => selectCue(state.selected, { focus: true }));
  els.previousSceneButton.addEventListener('click', () => selectCue(sceneCueIndex(-1), { focus: true }));
  els.nextSceneButton.addEventListener('click', () => selectCue(sceneCueIndex(1), { focus: true }));
  els.filterSceneButton.addEventListener('click', () => { state.filterScene = !state.filterScene; els.filterSceneButton.classList.toggle('active', state.filterScene); renderList(); });
  els.cueStart.addEventListener('change', updateTimingFromInputs);
  els.cueEnd.addEventListener('change', updateTimingFromInputs);
  els.startEarlierButton.addEventListener('click', () => adjustBoundary('start', -.1));
  els.startLaterButton.addEventListener('click', () => adjustBoundary('start', .1));
  els.endEarlierButton.addEventListener('click', () => adjustBoundary('end', -.1));
  els.endLaterButton.addEventListener('click', () => adjustBoundary('end', .1));
  els.cueText.addEventListener('input', () => {
    const cue = currentCue(); if (!cue) return;
    cue.text = els.cueText.value; els.textCount.textContent = `${cue.text.length} / 200`; els.liveCaption.textContent = cue.text || '（空字幕）'; markDirty('更新了字幕内容'); renderList();
  });
  els.twoLineToggle.addEventListener('change', () => els.liveCaption.classList.toggle('two-lines', els.twoLineToggle.checked));
  els.autoWrapToggle.addEventListener('change', () => els.liveCaption.style.whiteSpace = els.autoWrapToggle.checked ? 'normal' : 'nowrap');
  els.restoreButton.addEventListener('click', restoreGeneratedCue);
  els.saveButton.addEventListener('click', () => saveCaptions().catch(error => { setStatus(error.message, true); notify(error.message, 'error'); }));
  els.exportButton.addEventListener('click', exportSrt);
  els.jumpListButton.addEventListener('click', () => els.cueList.querySelector('.cue-item.active')?.scrollIntoView({ block: 'center' }));
  els.previewFrame.addEventListener('load', () => { state.previewRetries = 0; preparePreviewFrame(); });
  els.narrationAudio.addEventListener('play', () => { setPlayIcons(true); cancelAnimationFrame(state.raf); syncPlaybackFrame(); });
  els.narrationAudio.addEventListener('pause', () => { setPlayIcons(false); cancelAnimationFrame(state.raf); seekPreview(els.narrationAudio.currentTime || 0); });
  els.narrationAudio.addEventListener('ended', () => setPlayIcons(false));
  document.addEventListener('keydown', event => {
    const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveCaptions().catch(error => notify(error.message, 'error')); return; }
    if (editing) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    else if (event.key === 'ArrowLeft') selectCue(state.selected - 1, { focus: true });
    else if (event.key === 'ArrowRight') selectCue(state.selected + 1, { focus: true });
    else if (event.key.toLowerCase() === 'j') shiftCue(-.1);
    else if (event.key.toLowerCase() === 'k') shiftCue(.1);
  });
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
}

bindEvents();
renderIcons();
loadProjectList()
  .then(loadCaptions)
  .catch(error => {
    setStatus(error.message, true);
    els.cueList.innerHTML = '<p class="error">请先选择项目并运行 TTS 生成 timeline.json，然后刷新此页面。</p>';
    notify(error.message, 'error');
  });
