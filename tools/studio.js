const $ = selector => document.querySelector(selector);

const els = {
  currentProjectName: $('#currentProjectName'),
  timelineStatus: $('#timelineStatus'),
  outputStatus: $('#outputStatus'),
  currentSourcePath: $('#currentSourcePath'),
  workspaceProjectTitle: $('#workspaceProjectTitle'),
  workspaceProjectId: $('#workspaceProjectId'),
  projectDetailTitle: $('#projectDetailTitle'),
  projectEditButton: $('#projectEditButton'),
  projectDetails: $('#projectDetails'),
  projectEditForm: $('#projectEditForm'),
  projectTitleInput: $('#projectTitleInput'),
  saveProjectMetaButton: $('#saveProjectMetaButton'),
  workspaceSceneCount: $('#workspaceSceneCount'),
  workspaceNarrationChars: $('#workspaceNarrationChars'),
  workspaceTimelineState: $('#workspaceTimelineState'),
  workspaceOutputCount: $('#workspaceOutputCount'),
  guideTitle: $('#guideTitle'),
  guideBody: $('#guideBody'),
  guideBadge: $('#guideBadge'),
  projectList: $('#projectList'),
  projectSelect: $('#projectSelect'),
  outputList: $('#outputList'),
  outputPlayer: $('#outputPlayer'),
  previewFrame: $('#previewFrame'),
  tourButton: $('#tourButton'),
  sidebarToggle: $('#sidebarToggle'),
  projectDrawerBackdrop: $('#projectDrawerBackdrop'),
  settingsButton: $('#settingsButton'),
  settingsDrawer: $('#settingsDrawer'),
  settingsBackdrop: $('#settingsBackdrop'),
  closeSettingsButton: $('#closeSettingsButton'),
  settingsVoice: $('#settingsVoice'),
  settingsRate: $('#settingsRate'),
  settingsPitch: $('#settingsPitch'),
  settingsGap: $('#settingsGap'),
  settingsReducedMotion: $('#settingsReducedMotion'),
  saveSettingsButton: $('#saveSettingsButton'),
  resetSettingsButton: $('#resetSettingsButton'),
  refreshButton: $('#refreshButton'),
  refreshOutputsButton: $('#refreshOutputsButton'),
  loadStarterButton: $('#loadStarterButton'),
  newProjectNameInput: $('#newProjectNameInput'),
  newProjectButton: $('#newProjectButton'),
  openProjectsShortcut: $('#openProjectsShortcut'),
  newWorkspaceProjectButton: $('#newWorkspaceProjectButton'),
  editCurrentProjectButton: $('#editCurrentProjectButton'),
  importCurrentProjectButton: $('#importCurrentProjectButton'),
  openCaptionsButton: $('#openCaptionsButton'),
  topicInput: $('#topicInput'),
  audienceInput: $('#audienceInput'),
  toneInput: $('#toneInput'),
  sceneCountInput: $('#sceneCountInput'),
  notesInput: $('#notesInput'),
  promptOutput: $('#promptOutput'),
  copyPromptButton: $('#copyPromptButton'),
  aiResponseInput: $('#aiResponseInput'),
  extractButton: $('#extractButton'),
  projectNameInput: $('#projectNameInput'),
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
};

let appState = null;
let projects = [];
let outputs = [];
let selectedOutputUrl = '';
let currentJobId = '';
let pollTimer = 0;
let toastTimer = 0;
let tourAutoStarted = false;
let promptRefreshFrame = 0;
let appliedProjectSettingsKey = '';

const TOUR_STORAGE_KEY = 'html-edge-tts-video:studio-tour-seen:v1';
const PROJECT_DRAWER_STORAGE_KEY = 'html-edge-tts-video:studio-project-drawer-open:v1';
const STUDIO_SETTINGS_KEY = 'html-edge-tts-video:studio-settings:v1';
const DEFAULT_STUDIO_SETTINGS = Object.freeze({
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+12%',
  pitch: '+0Hz',
  gap: '0.28',
  reducedMotion: false,
});
const INITIAL_FORM_VALUES = Object.freeze({
  topic: els.topicInput?.value || '',
  audience: els.audienceInput?.value || '',
  tone: els.toneInput?.value || '',
  sceneCount: els.sceneCountInput?.value || '',
  notes: els.notesInput?.value || '',
  projectName: els.projectNameInput?.value || '新建视频项目',
  renderOutput: els.renderOutputInput?.value || 'studio-render.mp4',
});

function routeKey() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path.endsWith('/prompt')) return 'prompt';
  if (path.endsWith('/import')) return 'import';
  if (path.endsWith('/new')) return 'new';
  return 'main';
}

function studioRoutePath(route = 'main') {
  const cleanRoute = route === 'main' ? '' : `/${route}`;
  return `/studio${cleanRoute}`;
}

function setStudioRoute(route = 'main', replace = false) {
  const nextPath = studioRoutePath(route);
  if (window.location.pathname === nextPath) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', nextPath);
}

function applyRouteFocus(route = routeKey()) {
  document.body.dataset.studioRoute = route;
  document.querySelectorAll('[data-studio-route]').forEach(link => {
    link.classList.toggle('active', link.dataset.studioRoute === route);
  });
  if (route === 'new') setProjectDrawerOpen(true);
}

function cleanFileName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'video';
}

function setProjectEditMode(editing) {
  els.projectDetails?.toggleAttribute('hidden', !editing);
  els.projectEditForm?.toggleAttribute('hidden', !editing);
  document.body.classList.toggle('project-meta-editing', editing);
  if (els.projectEditButton) {
    els.projectEditButton.setAttribute('aria-expanded', String(editing));
    els.projectEditButton.title = editing ? '收起项目信息' : '编辑项目信息';
    const label = els.projectEditButton.querySelector('span');
    if (label) label.textContent = editing ? '收起' : '编辑';
  }
  if (!editing) return;
  const active = appState?.activeProject;
  const activeProject = projects.find(project => project.active) || null;
  const title = active?.name || activeProject?.name || appState?.current?.title || '';
  if (els.projectTitleInput) els.projectTitleInput.value = title || '';
  els.projectTitleInput?.focus();
}

async function saveProjectMetaEdit() {
  const active = appState?.activeProject;
  if (!active?.id) {
    setStatus('请先选择一个项目。', 'error');
    return;
  }
  const name = (els.projectTitleInput?.value || '').trim();
  if (!name) {
    setStatus('项目名称不能为空。', 'error');
    return;
  }
  try {
    await postJson('/api/projects/update', { project: active.id, name });
    setProjectEditMode(false);
    await refreshAll();
    setStatus('项目名称已更新。', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function resetPromptComposer() {
  if (!els.topicInput || !els.promptOutput) return;
  els.topicInput.value = INITIAL_FORM_VALUES.topic;
  els.audienceInput.value = INITIAL_FORM_VALUES.audience;
  els.toneInput.value = INITIAL_FORM_VALUES.tone;
  els.sceneCountInput.value = INITIAL_FORM_VALUES.sceneCount;
  els.notesInput.value = INITIAL_FORM_VALUES.notes;
  refreshPrompt();
}

function resetImportComposer(name = INITIAL_FORM_VALUES.projectName) {
  if (!els.aiResponseInput || !els.scenesOutput || !els.bodyOutput || !els.projectNameInput) return;
  els.aiResponseInput.value = '';
  els.scenesOutput.value = '';
  els.bodyOutput.value = '';
  els.projectNameInput.value = name || INITIAL_FORM_VALUES.projectName;
}

function resetBuildState(name = '') {
  window.clearTimeout(pollTimer);
  pollTimer = 0;
  currentJobId = '';
  setJobBusy(false);
  els.jobStatus.textContent = '空闲';
  els.jobStatus.className = 'job-status';
  els.jobLog.textContent = '等待任务。';
  els.renderSizeInput.value = '720p';
  els.renderOutputInput.value = `${cleanFileName(name || INITIAL_FORM_VALUES.renderOutput.replace(/\.mp4$/i, ''))}.mp4`;
}

function resetPreviewState() {
  selectedOutputUrl = '';
  els.outputPlayer.removeAttribute('src');
  els.outputPlayer.load();
}

function resetWorkspaceUi({ name = '', resetPrompt = false, resetImport = true } = {}) {
  if (resetPrompt) resetPromptComposer();
  if (resetImport) resetImportComposer(name);
  resetBuildState(name);
  resetPreviewState();
}

function setProjectDrawerOpen(open) {
  const isMobile = window.matchMedia('(max-width: 760px)').matches;
  if (!isMobile) {
    document.body.classList.remove('projects-open');
    els.sidebarToggle.setAttribute('aria-expanded', 'true');
    const desktopLabel = els.sidebarToggle.querySelector('span');
    if (desktopLabel) desktopLabel.textContent = '项目';
    return;
  }
  document.body.classList.toggle('projects-open', open);
  els.sidebarToggle.setAttribute('aria-expanded', String(open));
  const label = els.sidebarToggle.querySelector('span');
  if (label) label.textContent = open ? '关闭项目' : '项目';
  localStorage.setItem(PROJECT_DRAWER_STORAGE_KEY, open ? '1' : '0');
}

function settingsFromStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDIO_SETTINGS_KEY) || 'null');
    return { ...DEFAULT_STUDIO_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_STUDIO_SETTINGS };
  }
}

function applyStudioSettings(settings) {
  els.settingsVoice.value = settings.voice || DEFAULT_STUDIO_SETTINGS.voice;
  els.settingsRate.value = settings.rate || DEFAULT_STUDIO_SETTINGS.rate;
  els.settingsPitch.value = settings.pitch || DEFAULT_STUDIO_SETTINGS.pitch;
  els.settingsGap.value = settings.gap || DEFAULT_STUDIO_SETTINGS.gap;
  els.settingsReducedMotion.checked = Boolean(settings.reducedMotion);
  document.body.classList.toggle('reduce-motion', Boolean(settings.reducedMotion));
}

function applyProjectTtsSettings(ttsSettings) {
  applyStudioSettings({
    ...getStudioSettings(),
    ...(ttsSettings || DEFAULT_STUDIO_SETTINGS),
    reducedMotion: getStudioSettings().reducedMotion,
  });
}

function getStudioSettings() {
  return {
    voice: els.settingsVoice.value,
    rate: els.settingsRate.value.trim(),
    pitch: els.settingsPitch.value.trim(),
    gap: els.settingsGap.value,
    reducedMotion: els.settingsReducedMotion.checked,
  };
}

function setSettingsOpen(open) {
  document.body.classList.toggle('settings-open', open);
  els.settingsDrawer.setAttribute('aria-hidden', String(!open));
}

async function saveStudioSettings() {
  const settings = getStudioSettings();
  if (!/^[+-](?:\d|[1-9]\d)%$/.test(settings.rate)) {
    setStatus('语速格式应类似 +12%', 'error');
    return;
  }
  if (!/^[+-](?:\d|[1-9]\d)Hz$/.test(settings.pitch)) {
    setStatus('音调格式应类似 +0Hz', 'error');
    return;
  }
  const gap = Number(settings.gap);
  if (!Number.isFinite(gap) || gap < 0 || gap > 3) {
    setStatus('场景间隔需要在 0 到 3 秒之间', 'error');
    return;
  }
  settings.gap = String(gap);
  localStorage.setItem(STUDIO_SETTINGS_KEY, JSON.stringify(settings));
  try {
    if (appState?.activeProject?.id) {
      await postJson('/api/projects/settings', {
        project: appState.activeProject.id,
        tts: {
          voice: settings.voice,
          rate: settings.rate,
          pitch: settings.pitch,
          gap: settings.gap,
        },
      });
      appliedProjectSettingsKey = '';
      await refreshAll();
    }
    applyStudioSettings(settings);
    setSettingsOpen(false);
    setStatus(`已保存当前项目 TTS 参数：${settings.voice}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setStatus(message, tone = 'neutral') {
  let toast = document.querySelector('#studioToast');
  if (!toast) {
    toast = document.createElement('p');
    toast.id = 'studioToast';
    toast.className = 'studio-toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', tone === 'error');
  toast.classList.toggle('success', tone === 'success');
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
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
  const preferredSceneCount = sceneCount ? `\nPreferred scene count:\n${sceneCount}` : '';
  const additionalNotes = notes ? `\nAdditional requirement:\n${notes}` : '';

  return `You are generating a source folder for an HTML edge-tts video factory.

Output only these files:

\`\`\`text
scenes.json
body.html
media/ optional
\`\`\`

Do not output \`app.js\`, \`runtime.js\`, JavaScript, a renderer folder, MP3, timeline JSON, or MP4.
The factory theme owns playback, captions, the continuous chapter rail, preview controls, and rendering.
Do not output \`captions.json\`; the local factory creates editable captions after real TTS timing exists.

Topic:
${topic || '<PUT THE VIDEO TOPIC HERE>'}

Audience:
${audience || '<PUT THE TARGET AUDIENCE HERE>'}

Tone:
${tone || '<PUT THE TONE HERE>'}${preferredSceneCount}${additionalNotes}

Visual direction:
<PUT THE VISUAL DIRECTION HERE>

Important visual requirement:
Avoid text-only slides. Each scene should include at least one explanatory visual made from HTML
elements or a compact inline SVG: a pipeline, state diagram, comparison matrix, metric cards, concept
map, formula strip, or other structured graphic. Do not use <canvas> unless the canvas content is
already rendered as media, because this source must not include JavaScript.

## Output Contract

Return the files as separate fenced code blocks with clear filenames:

\`\`\`text
// scenes.json
...
\`\`\`

\`\`\`html
<!-- body.html -->
...
\`\`\`

If media assets are needed, describe the exact filenames and what each asset should contain.

## Rules for \`scenes.json\`

- Output valid JSON only.
- Use an array of scene objects.
- The first scene must have "id": "intro" and must introduce where the video starts, what it will explain, and the rough route of the video.
- Every scene must contain:
  - \`id\`: lowercase letters, digits, and hyphens only.
  - \`category\`: a short Chinese label, 2 to 12 characters, used by the factory's bottom chapter rail.
  - \`title\`: visual title for the scene.
  - \`summary\`: one sentence for the visual summary.
  - \`narration\`: natural Chinese spoken narration.
- Optional fields such as \`visual_notes\` are allowed, but do not rely on JavaScript.
- For an approximately three-minute video at edge-tts \`+12%\` rate, target 1,150 to 1,250 Chinese characters total.
- Keep each scene focused. Prefer 4 to 7 scenes for a short explainer.
- Match every scene's narration with a visual aid, so the screen explains structure rather than only repeating the spoken text.

Example scene:

\`\`\`json
{
  "id": "intro",
  "category": "总览",
  "title": "从问题入口开始",
  "summary": "先说明本视频从哪里切入，以及后面会讲什么。",
  "narration": "这条视频先从问题入口讲起，然后拆解核心概念、常见误区和最后的操作建议。"
}
\`\`\`

## Rules for \`body.html\`

- Output an HTML fragment, not a full HTML document.
- Do not include \`<html>\`, \`<head>\`, \`<body>\`, \`<script>\`, inline event handlers, or JavaScript.
- Do not include headers, footers, playback controls, scrubbers, timecodes, transport bars, or template chrome.
- Do not include a per-scene progress bar such as \`progress-line\`.
- Do not create the bottom chapter rail in \`body.html\`; the factory generates one continuous rail from \`scenes.json.category\` and the TTS timeline.
- Include one top-level section per scene:

\`\`\`html
<section class="content-scene scene" data-scene="intro">
  ...
</section>
\`\`\`

- Every \`id\` in \`scenes.json\` must have a matching \`data-scene\` section.
- The \`intro\` section must visually introduce the topic, starting point, and route. Do not jump straight into a detail scene.
- Keep important visual content clear of the bottom 25% of the frame because captions and the generated chapter rail live there.
- Use theme-friendly classes when helpful:
  - \`scene-copy\`
  - \`eyebrow\`
  - \`summary\`
  - \`scene-list\`
  - \`visual-board\`
  - \`visual-grid\`
  - \`step-chip\` with \`data-step\`
  - \`quote-panel\`
  - \`diagram-flow\` with \`diagram-node\`
  - \`comparison-grid\` with \`comparison-card\`
  - \`metric-grid\` with \`metric-card\` and \`metric-value\`
  - \`formula-strip\` with \`formula-token\`
  - \`concept-map\` with \`concept-node\`
  - \`diagram-svg\` for compact inline SVG diagrams
- Reference local assets as \`media/name.ext\`.

Example visual block:

\`\`\`html
<div class="visual-board">
  <div class="diagram-flow">
    <div class="diagram-node" data-step><b>输入</b><span>问题和素材</span></div>
    <div class="diagram-node" data-step><b>处理</b><span>拆成结构</span></div>
    <div class="diagram-node" data-step><b>输出</b><span>画面和旁白</span></div>
  </div>
  <div class="formula-strip">
    <div class="formula-token"><b>概念</b><span>是什么</span></div>
    <div class="formula-token operator">+</div>
    <div class="formula-token"><b>关系</b><span>怎么连</span></div>
    <div class="formula-token operator">=</div>
    <div class="formula-token"><b>结论</b><span>怎么用</span></div>
  </div>
</div>
\`\`\``;
}

function refreshPrompt() {
  els.promptOutput.value = buildPrompt();
}

function schedulePromptRefresh() {
  if (promptRefreshFrame) return;
  promptRefreshFrame = window.requestAnimationFrame(() => {
    promptRefreshFrame = 0;
    refreshPrompt();
  });
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
  const activeProject = projects.find(project => project.active) || null;
  const current = appState?.current || {};
  const sceneCount = current.sceneCount ?? activeProject?.sceneCount ?? 0;
  const narrationChars = current.narrationChars ?? activeProject?.narrationChars ?? 0;
  const activeId = active?.id || activeProject?.id || '';
  const currentTitle = active?.name || activeProject?.name || current.title || '未选择项目';
  const timelineLabel = timeline.matchesSource
    ? formatDuration(timeline.duration)
    : timeline.exists
      ? '需重建'
      : '待生成';
  els.currentProjectName.textContent = currentTitle;
  els.timelineStatus.textContent = timelineLabel;
  els.outputStatus.textContent = `${outputs.length} 个`;
  els.currentSourcePath.textContent = active?.relativePath || '暂无当前源文件';
  els.workspaceProjectTitle.textContent = currentTitle;
  els.workspaceProjectTitle.title = currentTitle;
  els.workspaceProjectId.textContent = activeId || '未加载';
  els.projectDetailTitle.textContent = currentTitle;
  els.workspaceSceneCount.textContent = `${sceneCount}`;
  els.workspaceNarrationChars.textContent = `${narrationChars}`;
  els.workspaceTimelineState.textContent = timelineLabel;
  els.workspaceTimelineState.classList.toggle('warning', !timeline.matchesSource);
  els.workspaceTimelineState.classList.toggle('success', Boolean(timeline.matchesSource));
  els.workspaceOutputCount.textContent = `${outputs.length}`;
  els.guideTitle.textContent = appState?.guide?.title || '读取状态中';
  els.guideBody.textContent = appState?.guide?.body || 'Studio 正在连接本地工厂。';
  els.guideBadge.textContent = (appState?.guide?.stage || 'ready').toUpperCase();
  els.loadStarterButton.disabled = !appState?.hasStarter;
  els.loadStarterButton.querySelector('span').textContent = appState?.hasStarter ? '示例' : '示例不可用';
  els.editCurrentProjectButton.href = activeId ? `/studio/import?project=${encodeURIComponent(activeId)}` : '/studio/import';
  els.importCurrentProjectButton.href = activeId ? `/studio/import?project=${encodeURIComponent(activeId)}` : '/studio/import';
  els.editCurrentProjectButton.classList.toggle('is-disabled', !activeId);
  els.importCurrentProjectButton.classList.toggle('is-disabled', !activeId);
  els.openCaptionsButton?.classList.toggle('is-disabled', !activeId);
}

function projectCard(project) {
  const button = document.createElement('button');
  button.className = `project-card${project.active ? ' active' : ''}`;
  button.type = 'button';
  button.dataset.project = project.id;

  const title = document.createElement('span');
  title.className = 'project-title';
  title.textContent = project.name || project.id;

  const meta = document.createElement('span');
  meta.className = 'project-meta';
  meta.textContent = `${project.sceneCount} scenes · ${project.narrationChars} 字 · ${formatDate(project.updatedAt)}`;
  button.title = project.relativePath;
  button.append(title, meta);
  return button;
}

function renderProjects() {
  els.projectList.replaceChildren();
  els.projectSelect?.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '还没有 .local/work 项目。';
    els.projectList.append(empty);
    if (els.projectSelect) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无项目';
      els.projectSelect.append(option);
      els.projectSelect.disabled = true;
    }
    return;
  }
  projects.forEach(project => {
    els.projectList.append(projectCard(project));
    if (els.projectSelect) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name || project.id;
      option.selected = Boolean(project.active);
      els.projectSelect.append(option);
    }
  });
  if (els.projectSelect) els.projectSelect.disabled = false;
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
  const isEmpty = !outputs.length;
  els.outputPlayer.closest('.outputs-panel').classList.toggle('is-empty', isEmpty);
  if (isEmpty) {
    selectedOutputUrl = '';
    els.outputPlayer.removeAttribute('src');
    els.outputPlayer.load();
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '还没有可预览的成片。';
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
      element: '.project-drawer',
      popover: {
        title: '这里切换当前项目',
        description: '左侧项目列表负责激活项目。点任意项目卡片，就会把它切换成当前项目。',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.current-project-panel',
      popover: {
        title: '先看当前项目工作台',
        description: '这里集中显示当前项目的标题、状态、下一步和编辑入口，不再和项目列表重复。',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.quick-actions-panel',
      popover: {
        title: '常用操作在这里',
        description: '编辑项目、导入替换、切字幕和新建项目都放在同一块，避免来回找入口。',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.build-panel',
      popover: {
        title: '构建只针对当前项目',
        description: '当前项目切好以后，在这里做 Check、TTS 和 Render，语义会更清楚。',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '.preview-panel',
      popover: {
        title: '右侧只看当前项目',
        description: '上面是当前项目预览，下面是当前项目自己的输出结果，预览和成片终于对应起来。',
        side: 'top',
        align: 'start',
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
      setProjectDrawerOpen(step?.element === '.project-drawer');
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
    setProjectDrawerOpen(false);
    overlay.remove();
  }

  function renderStep() {
    clearHighlight();
    const step = steps[index];
    setProjectDrawerOpen(step.element === '.project-drawer');
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
  if (params.get('tour') === '1') {
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
    const settingsKey = appState?.activeProject?.id || '';
    if (settingsKey !== appliedProjectSettingsKey) {
      applyProjectTtsSettings(appState?.settings?.tts || appState?.activeProject?.settings?.tts);
      appliedProjectSettingsKey = settingsKey;
    }
    renderHeader();
    renderProjects();
    renderOutputs();
    renderIcons();
    maybeStartTour();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function loadProject(project, { view = 'compose', closeDrawer = true } = {}) {
  try {
    setStatus('正在加载项目...');
    const data = await postJson('/api/projects/load', { project });
    applyProjectTtsSettings(data.project?.settings?.tts);
    appliedProjectSettingsKey = data.project?.id || '';
    resetWorkspaceUi({ name: data.project?.name || '', resetPrompt: false, resetImport: true });
    if (closeDrawer) setProjectDrawerOpen(false);
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus('项目已加载。', 'success');
    return data.project;
  } catch (error) {
    setStatus(error.message, 'error');
    return null;
  }
}

async function deleteProject(project) {
  const confirmed = window.confirm(`确定删除项目 ${project} 吗？这个操作会删除 .local/work 中的源文件。`);
  if (!confirmed) return;
  try {
    setStatus(`正在删除项目：${project}...`);
    await postJson('/api/projects/delete', { project });
    await refreshAll();
    reloadPreview();
    setStatus(`已删除项目：${project}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function previewProject(project) {
  const loaded = await loadProject(project);
  if (loaded) {
    reloadPreview();
    els.previewFrame.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function manageProject(project) {
  const loaded = await loadProject(project);
  if (loaded) window.location.href = `/studio/import?project=${encodeURIComponent(project)}`;
}

async function openProjectCaptions(project) {
  const loaded = await loadProject(project);
  if (loaded) window.location.href = '/captions';
}

async function exportProject(project) {
  const loaded = await loadProject(project);
  if (!loaded) return;
  els.renderOutputInput.value = `${cleanFileName(loaded.name || 'video')}.mp4`;
  await startJob('render');
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
  const name = els.projectNameInput.value.trim();
  if (!name) {
    setStatus('请填写项目名称。', 'error');
    return;
  }
  try {
    setStatus('正在保存项目...');
    const created = await postJson('/api/projects', {
      name,
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
      tts: getStudioSettings(),
    });
    await postJson('/api/projects/load', { project: created.project.id });
    applyProjectTtsSettings(created.project?.settings?.tts);
    appliedProjectSettingsKey = created.project?.id || '';
    resetWorkspaceUi({ name: created.project.name, resetPrompt: false, resetImport: true });
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus(`已保存并加载：${created.project.name}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function createBlankProject() {
  const name = els.newProjectNameInput.value.trim();
  if (!name) {
    setStatus('请输入新项目名称', 'error');
    els.newProjectNameInput.focus();
    return;
  }
  els.newProjectButton.disabled = true;
  try {
    const data = await postJson('/api/projects/blank', { name });
    appState = data.state;
    applyProjectTtsSettings(data.project?.settings?.tts || DEFAULT_STUDIO_SETTINGS);
    appliedProjectSettingsKey = data.project?.id || '';
    resetWorkspaceUi({ name: data.project?.name || name, resetPrompt: true, resetImport: true });
    setProjectDrawerOpen(false);
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus(`已新建并加载项目：${data.project.name}`, 'success');
    window.location.href = `/studio/import?project=${encodeURIComponent(data.project.id)}`;
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    els.newProjectButton.disabled = false;
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
  if (task === 'tts') {
    const settings = getStudioSettings();
    payload.voice = settings.voice;
    payload.rate = settings.rate;
    payload.pitch = settings.pitch;
    payload.gap = settings.gap;
  }
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
    return data.job;
  } catch (error) {
    setJobBusy(false);
    setStatus(error.message, 'error');
    return null;
  }
}

function bindEvents() {
  [els.topicInput, els.audienceInput, els.toneInput, els.sceneCountInput, els.notesInput].filter(Boolean).forEach(input => {
    input.addEventListener('input', schedulePromptRefresh);
  });
  els.copyPromptButton?.addEventListener('click', copyPrompt);
  els.tourButton.addEventListener('click', startTour);
  document.querySelectorAll('[data-studio-route]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const route = link.dataset.studioRoute || 'main';
      setStudioRoute(route);
      applyRouteFocus(route);
    });
  });
  els.sidebarToggle.addEventListener('click', () => {
    setProjectDrawerOpen(!document.body.classList.contains('projects-open'));
  });
  els.projectDrawerBackdrop.addEventListener('click', () => setProjectDrawerOpen(false));
  els.settingsButton.addEventListener('click', () => setSettingsOpen(true));
  els.closeSettingsButton.addEventListener('click', () => setSettingsOpen(false));
  els.settingsBackdrop.addEventListener('click', () => setSettingsOpen(false));
  els.saveSettingsButton.addEventListener('click', saveStudioSettings);
  els.resetSettingsButton.addEventListener('click', () => applyStudioSettings(DEFAULT_STUDIO_SETTINGS));
  els.extractButton?.addEventListener('click', () => {
    setStudioRoute('import');
    applyRouteFocus('import');
    extractResponse();
  });
  els.validateExtractedButton?.addEventListener('click', () => {
    setStudioRoute('import');
    applyRouteFocus('import');
    validateExtracted();
  });
  els.saveProjectButton?.addEventListener('click', saveProject);
  els.projectEditButton?.addEventListener('click', () => {
    const isEditing = document.body.classList.contains('project-meta-editing');
    setProjectEditMode(!isEditing);
  });
  els.saveProjectMetaButton?.addEventListener('click', saveProjectMetaEdit);
  els.openProjectsShortcut?.addEventListener('click', () => {
    els.projectSelect?.focus();
  });
  els.newWorkspaceProjectButton?.addEventListener('click', () => {
    els.newProjectNameInput?.focus();
  });
  els.openCaptionsButton?.addEventListener('click', async () => {
    const projectId = appState?.activeProject?.id;
    if (!projectId) {
      setStatus('请先选择一个项目。', 'error');
      return;
    }
    await openProjectCaptions(projectId);
  });
  els.refreshButton.addEventListener('click', refreshAll);
  els.refreshOutputsButton.addEventListener('click', refreshAll);
  els.loadStarterButton.addEventListener('click', () => loadProject('templates/starter'));
  els.newProjectButton.addEventListener('click', createBlankProject);
  els.newProjectNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') createBlankProject();
  });
  els.checkButton.addEventListener('click', () => startJob('check'));
  els.offlineButton.addEventListener('click', () => startJob('offline'));
  els.ttsButton.addEventListener('click', () => startJob('tts'));
  els.renderButton.addEventListener('click', () => startJob('render'));

  els.projectList.addEventListener('click', event => {
    const card = event.target.closest('[data-project]');
    if (card) loadProject(card.dataset.project);
  });
  els.projectSelect?.addEventListener('change', event => {
    const projectId = event.target.value;
    if (projectId) loadProject(projectId);
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
      setStudioRoute('prompt');
      applyRouteFocus('prompt');
      await copyPrompt();
      window.open(button.dataset.provider, '_blank', 'noopener,noreferrer');
    });
  });
  window.addEventListener('popstate', () => applyRouteFocus());
  document.addEventListener('click', event => {
    if (!document.body.classList.contains('project-meta-editing')) return;
    if (els.projectEditButton?.contains(event.target)) return;
    if (els.projectDetails?.contains(event.target)) return;
    setProjectEditMode(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setProjectEditMode(false);
      setProjectDrawerOpen(false);
      setSettingsOpen(false);
    }
  });
}

bindEvents();
setProjectEditMode(false);
setProjectDrawerOpen(false);
applyStudioSettings(settingsFromStorage());
applyRouteFocus();
if (els.promptOutput) refreshPrompt();
refreshAll();
renderIcons();
