const $ = selector => document.querySelector(selector);

const els = {
  textInput: $('#textInput'),
  charCount: $('#charCount'),
  clearTextButton: $('#clearTextButton'),
  insertExampleButton: $('#insertExampleButton'),
  voiceSelect: $('#voiceSelect'),
  rateInput: $('#rateInput'),
  rateValue: $('#rateValue'),
  pitchInput: $('#pitchInput'),
  pitchValue: $('#pitchValue'),
  formatSelect: $('#formatSelect'),
  generateButton: $('#generateButton'),
  previewEmpty: $('#previewEmpty'),
  previewReady: $('#previewReady'),
  currentVoiceName: $('#currentVoiceName'),
  currentVoiceMeta: $('#currentVoiceMeta'),
  largePlayButton: $('#largePlayButton'),
  audioPlayer: $('#audioPlayer'),
  copyCommandButton: $('#copyCommandButton'),
  jobStatus: $('#jobStatus'),
  jobLog: $('#jobLog'),
  clearLogButton: $('#clearLogButton'),
  historyList: $('#historyList'),
  refreshHistoryButton: $('#refreshHistoryButton'),
  engineDot: $('#engineDot'),
  engineStatus: $('#engineStatus'),
  topStatus: $('#topStatus'),
  notification: $('#notification'),
  voiceGuideButton: $('#voiceGuideButton'), voiceGuideDialog: $('#voiceGuideDialog'),
};

const EXAMPLE_TEXT = `Welcome to the edge-tts voice preview tool.

Choose a voice, adjust the rate and pitch, then generate a local preview.

Audio is generated locally to keep your content private.

Click “Generate preview” to begin.`;

let appState = { voices: [], history: [], manifest: {} };
let currentJobId = '';
let pollTimer = 0;
let seenJobLog = 0;
let logLines = [];
let notificationTimer = 0;

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function bindGuideDialog() {
  if (!els.voiceGuideButton || !els.voiceGuideDialog) return;
  els.voiceGuideButton.addEventListener('click', startVoiceTour);
  els.voiceGuideDialog.querySelector('[data-close-guide]')?.addEventListener('click', () => els.voiceGuideDialog.close());
  els.voiceGuideDialog.addEventListener('click', event => {
    if (event.target === els.voiceGuideDialog) els.voiceGuideDialog.close();
  });
}

function startVoiceTour() {
  const driverFactory = window.driver?.js?.driver;
  if (!driverFactory) {
    els.voiceGuideDialog.showModal();
    return;
  }
  const steps = [
    { element: '.text-panel', popover: { title: '1. Enter preview text', description: 'Paste narration here. Two or three sentences are enough to compare voices.', side: 'right', align: 'start' } },
    { element: '.settings-panel', popover: { title: '2. Choose voice and settings', description: 'Choose a voice, then fine-tune rate and pitch for the next preview.', side: 'right', align: 'start' } },
    { element: '#generateButton', popover: { title: '3. Generate preview', description: 'Generate audio locally; the player loads automatically when it is ready.', side: 'right', align: 'center' } },
    { element: '.history-panel', popover: { title: '4. Compare results', description: 'Recent previews are kept here so you can quickly compare voices and settings.', side: 'left', align: 'start' } },
  ];
  driverFactory({
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.42,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    steps,
  }).drive();
}

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function appendLog(message, tone = '') {
  logLines.push(`[${nowLabel()}]${tone ? ` ${tone}` : ''} ${message}`);
  logLines = logLines.slice(-200);
  els.jobLog.textContent = logLines.join('\n');
  els.jobLog.scrollTop = els.jobLog.scrollHeight;
}

function setJobStatus(label, status = '') {
  els.jobStatus.textContent = label;
  els.jobStatus.className = `job-status ${status}`.trim();
  if (els.topStatus) els.topStatus.textContent = label;
}

function notify(message, tone = '') {
  window.clearTimeout(notificationTimer);
  els.notification.textContent = message;
  els.notification.className = `notification show ${tone}`.trim();
  notificationTimer = window.setTimeout(() => {
    els.notification.className = 'notification';
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`The API returned invalid data (${response.status})`);
  }
  if (!response.ok) throw new Error(data.error || `API request failed (${response.status})`);
  return data;
}

function signed(value, suffix) {
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${number}${suffix}`;
}

function updateInputs() {
  els.charCount.textContent = `${els.textInput.value.length} / 3000`;
  els.rateValue.textContent = signed(els.rateInput.value, '%');
  els.pitchValue.textContent = signed(els.pitchInput.value, 'Hz');
}

function voiceInfo(id) {
  return appState.voices.find(voice => voice.id === id) || { id, label: id, locale: '', gender: '' };
}

function renderVoices() {
  const selected = els.voiceSelect.value || appState.manifest?.samples?.[0]?.voice || 'en-US-JennyNeural';
  els.voiceSelect.innerHTML = appState.voices.map(voice => {
    const gender = voice.gender === 'Female' ? 'Female' : voice.gender === 'Male' ? 'Male' : '';
    return `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.id)} (${escapeHtml(voice.label)}${gender ? ` · ${gender}` : ''})</option>`;
  }).join('');
  if ([...els.voiceSelect.options].some(option => option.value === selected)) {
    els.voiceSelect.value = selected;
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function formatDate(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function renderHistory() {
  if (!appState.history.length) {
    els.historyList.innerHTML = `
      <div class="history-empty">
        <div><i data-lucide="archive"></i><h3>No previews yet</h3><p>Generated preview audio will appear here.</p></div>
      </div>`;
    renderIcons();
    return;
  }
  els.historyList.innerHTML = appState.history.map((sample, index) => {
    const info = voiceInfo(sample.voice);
    return `
      <article class="history-item">
        <div>
          <strong>${escapeHtml(info.label || sample.voice)}</strong>
          <span>${escapeHtml(formatDate(sample.createdAt))} · ${escapeHtml(sample.rate || '+0%')} · ${escapeHtml(sample.pitch || '+0Hz')}</span>
        </div>
        <button type="button" data-history-index="${index}" title="Play"><i data-lucide="play"></i></button>
      </article>`;
  }).join('');
  renderIcons();
}

function setCurrentSample(sample, autoplay = false) {
  if (!sample?.audio) return;
  const info = voiceInfo(sample.voice);
  els.audioPlayer.src = `${sample.audio}${sample.audio.includes('?') ? '&' : '?'}v=${Date.now()}`;
  els.largePlayButton.disabled = false;
  els.previewEmpty.hidden = true;
  els.previewReady.hidden = false;
  els.currentVoiceName.textContent = `${info.label || sample.voice} preview generated`;
  els.currentVoiceMeta.textContent = `${sample.voice} · ${sample.rate || '+0%'} · ${sample.pitch || '+0Hz'}`;
  if (autoplay) els.audioPlayer.play().catch(() => {});
}

async function loadState({ quiet = false, selectLatest = false } = {}) {
  if (!quiet) appendLog('GET /api/voice-preview');
  try {
    const data = await api('/api/voice-preview');
    appState = data;
    appState.voices = Array.isArray(data.voices) ? data.voices : [];
    appState.history = Array.isArray(data.history) ? data.history : [];
    appState.manifest = data.manifest || {};
    renderVoices();
    renderHistory();
    if (selectLatest) setCurrentSample(appState.manifest.samples?.[0] || appState.history[0], true);
    else if (!els.audioPlayer.src) setCurrentSample(appState.manifest.samples?.[0] || appState.history[0]);
    els.engineStatus.textContent = 'Running normally';
    els.engineDot.classList.remove('error');
    if (!quiet) appendLog(`API complete: ${appState.voices.length} voices, ${appState.history.length} records`, 'OK');
  } catch (error) {
    els.engineStatus.textContent = 'Connection failed';
    els.engineDot.classList.add('error');
    appendLog(error.message, 'ERROR');
    notify(error.message, 'error');
  }
}

function setBusy(busy) {
  els.generateButton.disabled = busy;
  els.voiceSelect.disabled = busy;
  els.rateInput.disabled = busy;
  els.pitchInput.disabled = busy;
  els.generateButton.querySelector('span').textContent = busy ? 'Generating…' : 'Generate preview';
}

function renderJob(job) {
  currentJobId = job.id;
  const labels = { queued: 'Queued', running: 'Generating', succeeded: 'Generated', failed: 'Failed' };
  setJobStatus(labels[job.status] || job.status, job.status);
  const lines = Array.isArray(job.log) ? job.log : [];
  lines.slice(seenJobLog).forEach(line => appendLog(line));
  seenJobLog = lines.length;
  setBusy(job.status === 'queued' || job.status === 'running');
}

async function pollJob() {
  if (!currentJobId) return;
  try {
    const data = await api(`/api/jobs?id=${encodeURIComponent(currentJobId)}`);
    renderJob(data.job);
    if (['queued', 'running'].includes(data.job.status)) {
      pollTimer = window.setTimeout(pollJob, 700);
      return;
    }
    setBusy(false);
    if (data.job.status === 'succeeded') {
      appendLog('Preview generation API completed', 'OK');
      notify('Preview generated and loaded in the player', 'success');
      await loadState({ quiet: true, selectLatest: true });
    } else {
      appendLog('Preview generation failed; check the task output above', 'ERROR');
      notify('Preview generation failed; check the API log', 'error');
    }
  } catch (error) {
    setBusy(false);
    setJobStatus('Connection failed', 'failed');
    appendLog(error.message, 'ERROR');
    notify(error.message, 'error');
  }
}

async function generatePreview() {
  const text = els.textInput.value.trim();
  if (!text) {
    notify('Enter text to convert first', 'error');
    els.textInput.focus();
    return;
  }
  window.clearTimeout(pollTimer);
  currentJobId = '';
  seenJobLog = 0;
  setBusy(true);
  setJobStatus('Submitting', 'running');
  const payload = {
    task: 'voice-preview',
    text,
    voice: els.voiceSelect.value,
    rate: signed(els.rateInput.value, '%'),
    pitch: signed(els.pitchInput.value, 'Hz'),
    format: els.formatSelect.value,
  };
  appendLog(`POST /api/jobs voice-preview · ${payload.voice} · ${payload.rate} · ${payload.pitch}`);
  try {
    const data = await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
    renderJob(data.job);
    appendLog(`Task created: ${data.job.id}`, 'OK');
    pollTimer = window.setTimeout(pollJob, 400);
  } catch (error) {
    setBusy(false);
    setJobStatus('Submission failed', 'failed');
    appendLog(error.message, 'ERROR');
    notify(error.message, 'error');
  }
}

function bindEvents() {
  els.textInput.addEventListener('input', updateInputs);
  els.rateInput.addEventListener('input', updateInputs);
  els.pitchInput.addEventListener('input', updateInputs);
  els.clearTextButton.addEventListener('click', () => {
    els.textInput.value = '';
    updateInputs();
    els.textInput.focus();
  });
  els.insertExampleButton.addEventListener('click', () => {
    els.textInput.value = EXAMPLE_TEXT;
    updateInputs();
  });
  els.generateButton.addEventListener('click', generatePreview);
  els.refreshHistoryButton.addEventListener('click', () => loadState());
  els.clearLogButton.addEventListener('click', () => {
    logLines = [];
    els.jobLog.textContent = 'Waiting for an API call.';
  });
  els.copyCommandButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText('python main.py voice-preview');
    notify('Command copied', 'success');
  });
  els.largePlayButton.addEventListener('click', () => {
    if (els.audioPlayer.paused) els.audioPlayer.play().catch(() => {});
    else els.audioPlayer.pause();
  });
  els.historyList.addEventListener('click', event => {
    const button = event.target.closest('[data-history-index]');
    if (!button) return;
    setCurrentSample(appState.history[Number(button.dataset.historyIndex)], true);
  });
  els.audioPlayer.addEventListener('play', () => {
    els.largePlayButton.innerHTML = '<i data-lucide="pause"></i>';
    renderIcons();
  });
  els.audioPlayer.addEventListener('pause', () => {
    els.largePlayButton.innerHTML = '<i data-lucide="play"></i>';
    renderIcons();
  });
}

bindEvents();
bindGuideDialog();
updateInputs();
renderIcons();
setJobStatus('Ready');
loadState();
