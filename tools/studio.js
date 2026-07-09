const $ = selector => document.querySelector(selector);

const els = {
  currentProjectName: $('#currentProjectName'),
  timelineStatus: $('#timelineStatus'),
  outputStatus: $('#outputStatus'),
  currentSourcePath: $('#currentSourcePath'),
  guideTitle: $('#guideTitle'),
  guideBody: $('#guideBody'),
  guideBadge: $('#guideBadge'),
  projectList: $('#projectList'),
  outputList: $('#outputList'),
  outputPlayer: $('#outputPlayer'),
  previewFrame: $('#previewFrame'),
  tourButton: $('#tourButton'),
  refreshButton: $('#refreshButton'),
  refreshOutputsButton: $('#refreshOutputsButton'),
  loadStarterButton: $('#loadStarterButton'),
  topicInput: $('#topicInput'),
  audienceInput: $('#audienceInput'),
  toneInput: $('#toneInput'),
  sceneCountInput: $('#sceneCountInput'),
  notesInput: $('#notesInput'),
  promptOutput: $('#promptOutput'),
  copyPromptButton: $('#copyPromptButton'),
  aiResponseInput: $('#aiResponseInput'),
  extractButton: $('#extractButton'),
  projectSlugInput: $('#projectSlugInput'),
  validateExtractedButton: $('#validateExtractedButton'),
  saveProjectButton: $('#saveProjectButton'),
  scenesOutput: $('#scenesOutput'),
  bodyOutput: $('#bodyOutput'),
  checkButton: $('#checkButton'),
  offlineButton: $('#offlineButton'),
  ttsButton: $('#ttsButton'),
  renderButton: $('#renderButton'),
  renderSizeInput: $('#renderSizeInput'),
  renderOutputInput: $('#renderOutputInput'),
  jobStatus: $('#jobStatus'),
  jobLog: $('#jobLog'),
  statusText: $('#statusText'),
  viewTabs: [...document.querySelectorAll('[data-view-tab]')],
  viewPanels: [...document.querySelectorAll('[data-view-panel]')],
};

let appState = null;
let projects = [];
let outputs = [];
let selectedOutputUrl = '';
let currentJobId = '';
let pollTimer = 0;
let tourAutoStarted = false;
let activeView = 'compose';

const TOUR_STORAGE_KEY = 'html-edge-tts-video:studio-tour-seen:v1';

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setActiveView(view) {
  activeView = view;
  els.viewTabs.forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.viewTab === view);
  });
  els.viewPanels.forEach(panel => {
    panel.classList.toggle('is-active', panel.dataset.viewPanel === view);
  });
  renderIcons();
}

function setStatus(message, tone = 'neutral') {
  els.statusText.textContent = message;
  els.statusText.classList.toggle('error', tone === 'error');
  els.statusText.classList.toggle('success', tone === 'success');
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
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function postJson(path, payload) {
  return api(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function formatDate(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '未知大小';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '已生成';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function buildPrompt() {
  const topic = els.topicInput.value.trim();
  const audience = els.audienceInput.value.trim();
  const tone = els.toneInput.value.trim();
  const sceneCount = els.sceneCountInput.value.trim();
  const notes = els.notesInput.value.trim();

  return `你是一个 HTML edge-tts video source generator。

请为本地视频工厂生成一个中文旁白视频源。主题：${topic}

受众：${audience}
风格：${tone}
场景数量：${sceneCount}
额外要求：${notes}

必须遵守：
- 只输出 scenes.json 和 body.html。
- 不要生成 app.js、runtime.js、脚本标签、播放控件、进度条、章节栏、时间码或字幕文件。
- 第一幕必须是 id 为 "intro" 的总览场景。
- 每个 scene 必须包含 id、category、title、summary、narration。
- category 使用 2 到 12 个中文字符。
- body.html 必须为每个 scene id 提供一个 <section class="content-scene scene" data-scene="...">。
- 优先使用 visual-board、diagram-flow、comparison-grid、metric-grid、formula-strip、concept-map、scene-list 等结构化视觉。
- 重要内容避开画面底部 25%，给字幕和章节栏留空间。

请按下面格式返回，不要添加解释：

\`\`\`json scenes.json
[
  {
    "id": "intro",
    "category": "总览",
    "title": "标题",
    "summary": "摘要",
    "narration": "中文旁白。"
  }
]
\`\`\`

\`\`\`html body.html
<section class="content-scene scene" data-scene="intro">
  <div class="scene-copy">
    <div class="eyebrow">INTRO</div>
    <h1>标题</h1>
    <p class="summary">摘要。</p>
  </div>
  <div class="visual-board"></div>
</section>
\`\`\``;
}

function refreshPrompt() {
  els.promptOutput.value = buildPrompt();
}

async function copyPrompt() {
  refreshPrompt();
  try {
    await navigator.clipboard.writeText(els.promptOutput.value);
    setStatus('Prompt 已复制。', 'success');
  } catch {
    els.promptOutput.focus();
    els.promptOutput.select();
    setStatus('浏览器没有授予剪贴板权限，请手动复制。', 'error');
  }
}

function extractFence(text, name, language) {
  const patterns = [
    new RegExp(`\`\`\`${language}\\s+${name}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`${name}\\s*:?\\s*\\n\`\`\`(?:${language})?\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function extractScenes(text) {
  const fenced = extractFence(text, 'scenes.json', 'json');
  if (fenced) return fenced;
  const match = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  return match ? match[0].trim() : '';
}

function extractBody(text) {
  const fenced = extractFence(text, 'body.html', 'html');
  if (fenced) return fenced;
  const firstSection = text.indexOf('<section');
  const lastSection = text.lastIndexOf('</section>');
  if (firstSection === -1 || lastSection === -1) return '';
  return text.slice(firstSection, lastSection + '</section>'.length).trim();
}

function extractResponse() {
  const text = els.aiResponseInput.value;
  const scenes = extractScenes(text);
  const body = extractBody(text);
  els.scenesOutput.value = scenes;
  els.bodyOutput.value = body;

  if (!scenes || !body) {
    setStatus('没有同时找到 scenes.json 和 body.html。', 'error');
    return false;
  }

  try {
    JSON.parse(scenes);
  } catch {
    setStatus('提取出的 scenes.json 不是合法 JSON。', 'error');
    return false;
  }

  setStatus('已提取 scenes.json 和 body.html。', 'success');
  return true;
}

function ensureExtracted() {
  if (els.scenesOutput.value.trim() && els.bodyOutput.value.trim()) return true;
  return extractResponse();
}

function renderHeader() {
  const active = appState?.activeProject;
  const timeline = appState?.timeline || {};
  els.currentProjectName.textContent = active?.slug || '未加载';
  els.timelineStatus.textContent = timeline.matchesSource
    ? formatDuration(timeline.duration)
    : timeline.exists
      ? '需重建'
      : '待生成';
  els.outputStatus.textContent = `${outputs.length} 个`;
  els.currentSourcePath.textContent = active?.relativePath || '暂无当前源文件';
  els.guideTitle.textContent = appState?.guide?.title || '读取状态中';
  els.guideBody.textContent = appState?.guide?.body || 'Studio 正在连接本地工厂。';
  els.guideBadge.textContent = (appState?.guide?.stage || 'ready').toUpperCase();
  els.loadStarterButton.disabled = !appState?.hasStarter;
  els.loadStarterButton.querySelector('span').textContent = appState?.hasStarter ? '加载 starter' : 'starter 不可用';
}

function projectCard(project) {
  const button = document.createElement('button');
  button.className = `project-card${project.active ? ' active' : ''}`;
  button.type = 'button';
  button.dataset.project = project.slug;

  const title = document.createElement('span');
  title.className = 'project-title';
  title.textContent = project.title || project.slug;

  const meta = document.createElement('span');
  meta.className = 'project-meta';
  meta.textContent = `${project.sceneCount} scenes · ${project.narrationChars} 字 · ${formatDate(project.updatedAt)}`;
  button.title = project.relativePath;
  button.append(title, meta);
  return button;
}

function renderProjects() {
  els.projectList.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '还没有 .local/work 项目。';
    els.projectList.append(empty);
    return;
  }
  projects.forEach(project => {
    els.projectList.append(projectCard(project));
  });
}

function outputCard(output) {
  const button = document.createElement('button');
  button.className = `output-card${output.url === selectedOutputUrl ? ' active' : ''}`;
  button.type = 'button';
  button.dataset.output = output.url;

  const title = document.createElement('span');
  title.className = 'output-title';
  title.textContent = output.name;

  const meta = document.createElement('span');
  meta.className = 'output-meta';
  meta.textContent = `${formatBytes(output.size)} · ${formatDate(output.modifiedAt)}`;

  button.append(title, meta);
  return button;
}

function renderOutputs() {
  els.outputList.replaceChildren();
  if (!outputs.length) {
    selectedOutputUrl = '';
    els.outputPlayer.removeAttribute('src');
    els.outputPlayer.load();
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '还没有渲染结果。';
    els.outputList.append(empty);
    return;
  }

  if (!outputs.some(output => output.url === selectedOutputUrl)) {
    selectedOutputUrl = outputs[0].url;
    els.outputPlayer.src = selectedOutputUrl;
  }

  outputs.forEach(output => {
    els.outputList.append(outputCard(output));
  });
}

function reloadPreview() {
  const base = '../themes/default/index.html';
  els.previewFrame.src = `${base}?studio=${Date.now()}`;
}

function tourSteps() {
  return [
    {
      element: '.status-strip',
      popover: {
        title: '先看当前状态',
        description: '这里会告诉你当前加载了哪个项目、时间线是否已生成，以及是否已有输出视频。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '.sidebar',
      popover: {
        title: '选择本地项目',
        description: '左侧列出 .local/work 里的视频源。点项目即可加载到当前工厂工作区。',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.guide-panel',
      popover: {
        title: '跟着下一步走',
        description: '这个提示会根据当前状态变化：没有源文件、需要 TTS、可以预览、可以渲染，都会给出下一步。',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.prompt-panel',
      view: 'compose',
      popover: {
        title: '生成 Web AI 提示词',
        description: '填写主题、受众和风格，复制提示词到 ChatGPT、Claude 或 Gemini，让它只生成 scenes.json 和 body.html。',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.import-panel',
      view: 'compose',
      popover: {
        title: '粘贴并保存 AI 输出',
        description: '把 AI 返回内容粘贴到这里，提取、校验，然后保存成本地项目并自动加载。',
        side: 'left',
        align: 'start',
      },
    },
    {
      element: '.build-panel',
      view: 'build',
      popover: {
        title: '构建时间线和视频',
        description: 'Check 做源文件校验，TTS 生成旁白和字幕时间线，Render 输出 MP4。',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '.preview-panel',
      view: 'review',
      popover: {
        title: '预览当前画面',
        description: '这里嵌入当前主题预览。修改 body.html 或重新生成时间线后，它会刷新。',
        side: 'top',
        align: 'start',
      },
    },
    {
      element: '.outputs-panel',
      view: 'review',
      popover: {
        title: '查看渲染结果',
        description: '这里会列出 .local/output 里的视频文件，可以直接播放最近的成片。',
        side: 'top',
        align: 'end',
      },
    },
  ];
}

function availableTourSteps() {
  return tourSteps().filter(step => document.querySelector(step.element));
}

function rememberTourSeen() {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, '1');
  } catch {
    // Local storage may be disabled in some embedded browsers.
  }
}

function hasSeenTour() {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function driverFactory() {
  return window.driver?.js?.driver;
}

function startDriverTour(steps) {
  const driver = driverFactory();
  if (!driver) return false;
  const driverObj = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    smoothScroll: true,
    stagePadding: 8,
    stageRadius: 8,
    overlayOpacity: 0.42,
    popoverClass: 'studio-tour-popover',
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成',
    steps,
    onHighlightStarted: (_element, step) => {
      if (step?.view) setActiveView(step.view);
    },
  });
  driverObj.drive();
  return true;
}

function startFallbackTour(steps) {
  let index = 0;
  const overlay = document.createElement('div');
  overlay.className = 'tour-fallback-overlay';
  overlay.innerHTML = `
    <section class="tour-fallback-card" role="dialog" aria-live="polite">
      <p class="tour-fallback-count"></p>
      <h2></h2>
      <p class="tour-fallback-body"></p>
      <div class="tour-fallback-actions">
        <button type="button" data-tour-prev>上一步</button>
        <button type="button" data-tour-next>下一步</button>
        <button type="button" data-tour-close>完成</button>
      </div>
    </section>
  `;
  document.body.append(overlay);

  const card = overlay.querySelector('.tour-fallback-card');
  const count = overlay.querySelector('.tour-fallback-count');
  const title = overlay.querySelector('h2');
  const body = overlay.querySelector('.tour-fallback-body');
  const prev = overlay.querySelector('[data-tour-prev]');
  const next = overlay.querySelector('[data-tour-next]');
  const close = overlay.querySelector('[data-tour-close]');

  function clearHighlight() {
    document.querySelectorAll('.tour-fallback-highlight').forEach(element => {
      element.classList.remove('tour-fallback-highlight');
    });
  }

  function cleanup() {
    clearHighlight();
    overlay.remove();
  }

  function renderStep() {
    clearHighlight();
    const step = steps[index];
    if (step.view) setActiveView(step.view);
    const target = document.querySelector(step.element);
    if (target) {
      target.classList.add('tour-fallback-highlight');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    count.textContent = `${index + 1} / ${steps.length}`;
    title.textContent = step.popover.title;
    body.textContent = step.popover.description;
    prev.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? '完成' : '下一步';
    card.classList.toggle('is-last', index === steps.length - 1);
  }

  prev.addEventListener('click', () => {
    index = Math.max(0, index - 1);
    renderStep();
  });
  next.addEventListener('click', () => {
    if (index === steps.length - 1) cleanup();
    else {
      index += 1;
      renderStep();
    }
  });
  close.addEventListener('click', cleanup);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) cleanup();
  });
  renderStep();
}

function startTour() {
  const steps = availableTourSteps();
  if (!steps.length) return;
  rememberTourSeen();
  if (!startDriverTour(steps)) {
    startFallbackTour(steps);
  }
}

function maybeStartTour() {
  if (tourAutoStarted) return;
  tourAutoStarted = true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('tour') === '1' || !hasSeenTour()) {
    window.setTimeout(startTour, 650);
  }
}

async function refreshAll() {
  try {
    const [stateData, projectData, outputData] = await Promise.all([
      api('/api/studio/state'),
      api('/api/projects'),
      api('/api/outputs'),
    ]);
    appState = stateData;
    projects = projectData.projects || [];
    outputs = outputData.outputs || [];
    appState.outputs = outputs;
    renderHeader();
    renderProjects();
    renderOutputs();
    renderIcons();
    maybeStartTour();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function loadProject(project) {
  try {
    setStatus('正在加载项目...');
    await postJson('/api/projects/load', { project });
    reloadPreview();
    await refreshAll();
    setStatus('项目已加载。', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function validateExtracted() {
  if (!ensureExtracted()) return;
  try {
    const result = await postJson('/api/source/validate', {
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
    });
    setStatus(`校验通过：${result.sceneCount} scenes，${result.narrationChars} 字旁白。`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function saveProject() {
  if (!ensureExtracted()) return;
  const slug = els.projectSlugInput.value.trim();
  if (!slug) {
    setStatus('请填写项目 slug。', 'error');
    return;
  }
  try {
    setStatus('正在保存项目...');
    const created = await postJson('/api/projects', {
      slug,
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
    });
    await postJson('/api/projects/load', { project: created.project.slug });
    reloadPreview();
    await refreshAll();
    setStatus(`已保存并加载：${created.project.slug}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function setJobBusy(isBusy) {
  [els.checkButton, els.offlineButton, els.ttsButton, els.renderButton].forEach(button => {
    button.disabled = isBusy;
  });
}

function renderJob(job) {
  currentJobId = job.id;
  const labels = {
    queued: '排队中',
    running: '运行中',
    succeeded: '完成',
    failed: '失败',
  };
  els.jobStatus.textContent = `${job.task}: ${labels[job.status] || job.status}`;
  els.jobStatus.className = `job-status ${job.status}`;
  els.jobLog.textContent = job.log?.length ? job.log.join('\n') : '任务已启动，等待日志。';
  els.jobLog.scrollTop = els.jobLog.scrollHeight;
  setJobBusy(job.status === 'queued' || job.status === 'running');
}

async function pollJob() {
  if (!currentJobId) return;
  try {
    const data = await api(`/api/jobs?id=${encodeURIComponent(currentJobId)}`);
    renderJob(data.job);
    if (data.job.status === 'queued' || data.job.status === 'running') {
      pollTimer = window.setTimeout(pollJob, 1200);
      return;
    }
    window.clearTimeout(pollTimer);
    setJobBusy(false);
    await refreshAll();
    if (data.job.status === 'succeeded') {
      if (['tts', 'offline'].includes(data.job.task)) reloadPreview();
      if (data.job.task === 'render') setActiveView('review');
      setStatus(`${data.job.task} 已完成。`, 'success');
    } else {
      setStatus(`${data.job.task} 失败，请查看日志。`, 'error');
    }
  } catch (error) {
    setJobBusy(false);
    setStatus(error.message, 'error');
  }
}

async function startJob(task) {
  const payload = { task };
  setActiveView('build');
  if (task === 'render') {
    payload.size = els.renderSizeInput.value;
    payload.output = els.renderOutputInput.value;
    payload.capture = 'auto';
  }
  try {
    window.clearTimeout(pollTimer);
    const data = await postJson('/api/jobs', payload);
    renderJob(data.job);
    pollTimer = window.setTimeout(pollJob, 500);
    setStatus(`${task} 已开始。`);
  } catch (error) {
    setJobBusy(false);
    setStatus(error.message, 'error');
  }
}

function bindEvents() {
  [els.topicInput, els.audienceInput, els.toneInput, els.sceneCountInput, els.notesInput].forEach(input => {
    input.addEventListener('input', refreshPrompt);
  });
  els.copyPromptButton.addEventListener('click', copyPrompt);
  els.tourButton.addEventListener('click', startTour);
  els.extractButton.addEventListener('click', extractResponse);
  els.validateExtractedButton.addEventListener('click', validateExtracted);
  els.saveProjectButton.addEventListener('click', saveProject);
  els.refreshButton.addEventListener('click', refreshAll);
  els.refreshOutputsButton.addEventListener('click', refreshAll);
  els.viewTabs.forEach(tab => {
    tab.addEventListener('click', () => setActiveView(tab.dataset.viewTab));
  });
  els.loadStarterButton.addEventListener('click', () => loadProject('templates/starter'));
  els.checkButton.addEventListener('click', () => startJob('check'));
  els.offlineButton.addEventListener('click', () => startJob('offline'));
  els.ttsButton.addEventListener('click', () => startJob('tts'));
  els.renderButton.addEventListener('click', () => startJob('render'));

  els.projectList.addEventListener('click', event => {
    const card = event.target.closest('[data-project]');
    if (card) loadProject(card.dataset.project);
  });

  els.outputList.addEventListener('click', event => {
    const card = event.target.closest('[data-output]');
    if (!card) return;
    selectedOutputUrl = card.dataset.output;
    els.outputPlayer.src = selectedOutputUrl;
    renderOutputs();
  });

  document.querySelectorAll('[data-provider]').forEach(button => {
    button.addEventListener('click', async () => {
      await copyPrompt();
      window.open(button.dataset.provider, '_blank', 'noopener,noreferrer');
    });
  });
}

bindEvents();
refreshPrompt();
refreshAll();
renderIcons();
