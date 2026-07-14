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
  themeSelect: $('#themeSelect'),
  outputList: $('#outputList'),
  previewFrame: $('#previewFrame'),
  tourButton: $('#tourButton'),
  sidebarToggle: $('#sidebarToggle'),
  projectDrawerBackdrop: $('#projectDrawerBackdrop'),
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
  languageInput: $('#languageInput'),
  contentThemeInput: $('#contentThemeInput'),
  engineInput: $('#engineInput'),
  promptTargetInput: $('#promptTargetInput'),
  promptResolution: $('#promptResolution'),
  notesInput: $('#notesInput'),
  promptOutput: $('#promptOutput'),
  copyPromptButton: $('#copyPromptButton'),
  aiResponseInput: $('#aiResponseInput'),
  directScenesInput: $('#directScenesInput'),
  directBodyInput: $('#directBodyInput'),
  directCssInput: $('#directCssInput'),
  directVisualInput: $('#directVisualInput'),
  directImportGrid: $('#directImportGrid'),
  extractButton: $('#extractButton'),
  projectNameInput: $('#projectNameInput'),
  validateExtractedButton: $('#validateExtractedButton'),
  saveProjectButton: $('#saveProjectButton'),
  scenesOutput: $('#scenesOutput'),
  bodyOutput: $('#bodyOutput'),
  cssOutput: $('#cssOutput'),
  visualOutput: $('#visualOutput'),
  checkButton: $('#checkButton'),
  offlineButton: $('#offlineButton'),
  ttsButton: $('#ttsButton'),
  renderButton: $('#renderButton'),
  renderSizeInput: $('#renderSizeInput'),
  renderOutputInput: $('#renderOutputInput'),
  renderTransitionInput: $('#renderTransitionInput'),
  jobStatus: $('#jobStatus'),
  jobLog: $('#jobLog'),
  jobOverlay: $('#jobOverlay'),
  jobOverlayTitle: $('#jobOverlayTitle'),
  jobOverlayMessage: $('#jobOverlayMessage'),
};

let appState = null;
let projects = [];
let outputs = [];
let currentJobId = '';
let pollTimer = 0;
let toastTimer = 0;
let tourAutoStarted = false;
let promptRefreshFrame = 0;
let promptRequestId = 0;
let importMode = 'smart';
let importProjectId = '';

const TOUR_STORAGE_KEY = 'html-edge-tts-video:studio-tour-seen:v1';
const PROJECT_DRAWER_STORAGE_KEY = 'html-edge-tts-video:studio-project-drawer-open:v1';
const INITIAL_FORM_VALUES = Object.freeze({
  topic: els.topicInput?.value || '',
  audience: els.audienceInput?.value || '',
  tone: els.toneInput?.value || '',
  sceneCount: els.sceneCountInput?.value || '',
  language: els.languageInput?.value || 'auto',
  contentTheme: els.contentThemeInput?.value || 'editorial',
  engine: els.engineInput?.value || 'auto',
  promptTarget: els.promptTargetInput?.value || 'web-ai',
  notes: els.notesInput?.value || '',
  projectName: els.projectNameInput?.value || '新视频项目',
  renderOutput: els.renderOutputInput?.value || 'studio-render.mp4',
});

function routeKey() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path.endsWith('/prompt') || path.endsWith('/create')) return 'prompt';
  if (path.endsWith('/import')) return 'import';
  if (path.endsWith('/new')) return 'new';
  return 'main';
}

function studioRoutePath(route = 'main') {
  const routeName = route === 'prompt' ? 'create' : route;
  const cleanRoute = routeName === 'main' ? '' : `/${routeName}`;
  return `/studio${cleanRoute}`;
}

function setStudioRoute(route = 'main', replace = false) {
  const nextPath = studioRoutePath(route);
  if (window.location.pathname === nextPath) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', nextPath);
}

function projectFromUrl() {
  return new URLSearchParams(window.location.search).get('project') || '';
}

async function initImportProjectContext() {
  if (!els.projectNameInput) return;
  const projectId = projectFromUrl();
  if (!projectId) return;
  importProjectId = projectId;
  try {
    const data = await api(`/api/projects/source?project=${encodeURIComponent(projectId)}`);
    const scenes = data?.files?.scenesJson || '';
    const body = data?.files?.bodyHtml || '';
    const css = data?.files?.bodyCss || '';
    const visual = data?.files?.visualJs || '';
    els.projectNameInput.value = data?.project?.name || '';
    els.scenesOutput.value = scenes;
    els.bodyOutput.value = body;
    els.cssOutput.value = css;
    els.visualOutput.value = visual;
    if (els.directScenesInput) els.directScenesInput.value = scenes;
    if (els.directBodyInput) els.directBodyInput.value = body;
    if (els.directCssInput) els.directCssInput.value = css;
    if (els.directVisualInput) els.directVisualInput.value = visual;
    if (els.languageInput) els.languageInput.value = data?.project?.language || 'auto';
    if (els.contentThemeInput) els.contentThemeInput.value = data?.project?.contentTheme || 'editorial';
    renderEngineOptions(data?.project?.contentTheme || 'editorial');
    if (els.engineInput) els.engineInput.value = data?.project?.engine || 'auto';
    setStatus(`正在编辑项目：${data?.project?.name || projectId}`, 'success');
  } catch (error) {
    setStatus(error.message || '无法加载项目源文件。', 'error');
  }
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

function outputNameForSize(value, size) {
  const baseName = String(value || '')
    .trim()
    .replace(/\.mp4$/i, '')
    .replace(/-(?:720p|1080p|2k|4k)$/i, '');
  return `${cleanFileName(baseName)}-${size}.mp4`;
}

function setProjectEditMode(editing) {
  els.projectDetails?.toggleAttribute('hidden', !editing);
  els.projectEditForm?.toggleAttribute('hidden', !editing);
  document.body.classList.toggle('project-meta-editing', editing);
  if (els.projectEditButton) {
    els.projectEditButton.setAttribute('aria-expanded', String(editing));
    els.projectEditButton.title = editing ? '收起项目详情' : '编辑项目详情';
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
    setStatus('请先选择项目。', 'error');
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
  els.languageInput.value = INITIAL_FORM_VALUES.language;
  els.contentThemeInput.value = INITIAL_FORM_VALUES.contentTheme;
  els.engineInput.value = INITIAL_FORM_VALUES.engine;
  els.promptTargetInput.value = INITIAL_FORM_VALUES.promptTarget;
  els.notesInput.value = INITIAL_FORM_VALUES.notes;
  refreshPrompt();
}

function resetImportComposer(name = INITIAL_FORM_VALUES.projectName) {
  if (!els.aiResponseInput || !els.scenesOutput || !els.bodyOutput || !els.projectNameInput) return;
  els.aiResponseInput.value = '';
  els.scenesOutput.value = '';
  els.bodyOutput.value = '';
  els.cssOutput.value = '';
  els.visualOutput.value = '';
  if (els.directScenesInput) els.directScenesInput.value = '';
  if (els.directBodyInput) els.directBodyInput.value = '';
  if (els.directCssInput) els.directCssInput.value = '';
  if (els.directVisualInput) els.directVisualInput.value = '';
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
  els.renderOutputInput.value = outputNameForSize(
    name || INITIAL_FORM_VALUES.renderOutput,
    els.renderSizeInput.value,
  );
}

function resetWorkspaceUi({ name = '', resetPrompt = false, resetImport = true } = {}) {
  if (resetPrompt) resetPromptComposer();
  if (resetImport) resetImportComposer(name);
  resetBuildState(name);
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
    throw new Error(data.error || `请求失败：${response.status}`);
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

function promptPayload() {
  return {
    topic: els.topicInput.value.trim(),
    audience: els.audienceInput.value.trim(),
    tone: els.toneInput.value.trim(),
    sceneCount: els.sceneCountInput.value.trim(),
    notes: els.notesInput.value.trim(),
    language: els.languageInput.value,
    contentTheme: els.contentThemeInput.value,
    engine: els.engineInput.value,
    target: els.promptTargetInput.value,
  };

}

async function refreshPrompt() {
  const requestId = ++promptRequestId;
  try {
    const result = await postJson('/api/prompt', promptPayload());
    if (requestId !== promptRequestId) return;
    els.promptOutput.value = result.prompt;
    if (els.promptResolution) {
      els.promptResolution.textContent = `已解析：${result.language} · ${result.contentTheme} · ${result.engine} · ${result.target}`;
    }
  } catch (error) {
    if (requestId !== promptRequestId) return;
    els.promptOutput.value = `提示词生成失败：${error.message}`;
    if (els.promptResolution) els.promptResolution.textContent = error.message;
  }
}

function schedulePromptRefresh() {
  if (promptRefreshFrame) return;
  promptRefreshFrame = window.requestAnimationFrame(() => {
    promptRefreshFrame = 0;
    refreshPrompt();
  });
}

async function copyPrompt() {
  await refreshPrompt();
  try {
    await navigator.clipboard.writeText(els.promptOutput.value);
    setStatus('提示词已复制。', 'success');
  } catch {
    els.promptOutput.focus();
    els.promptOutput.select();
    setStatus('浏览器未授予剪贴板权限，请手动复制。', 'error');
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

function extractCss(text) {
  return extractFence(text, 'body.css', 'css');
}

function extractVisual(text) {
  return extractFence(text, 'visual.js', 'js') || extractFence(text, 'visual.js', 'javascript');
}

function extractResponse() {
  const text = els.aiResponseInput.value;
  const scenes = els.directScenesInput?.value.trim() || extractScenes(text);
  const body = els.directBodyInput?.value.trim() || extractBody(text);
  const css = els.directCssInput?.value.trim() || extractCss(text);
  const visual = els.directVisualInput?.value.trim() || extractVisual(text);
  els.scenesOutput.value = scenes;
  els.bodyOutput.value = body;
  els.cssOutput.value = css;
  els.visualOutput.value = visual;

  if (!scenes || !body) {
    setStatus('未同时找到 scenes.json 和 body.html。', 'error');
    return false;
  }

  try {
    JSON.parse(scenes);
  } catch {
    setStatus('提取的 scenes.json 不是有效的 JSON。', 'error');
    return false;
  }

  setStatus(`源文件已提取${css ? '（含 body.css）' : ''}${visual ? '（含 visual.js）' : ''}。`, 'success');
  return true;
}

function setImportMode(mode) {
  importMode = mode === 'direct' ? 'direct' : 'smart';
  document.querySelectorAll('[data-import-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.importMode === importMode);
  });
  if (els.directImportGrid) els.directImportGrid.hidden = importMode !== 'direct';
  if (els.aiResponseInput) els.aiResponseInput.hidden = importMode === 'direct';
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
      ? '需要重新构建'
      : '未生成';
  els.currentProjectName.textContent = currentTitle;
  els.timelineStatus.textContent = timelineLabel;
  els.outputStatus.textContent = `共 ${outputs.length} 个`;
  els.currentSourcePath.textContent = active?.relativePath || '没有当前源文件';
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
  els.guideTitle.textContent = appState?.guide?.title || '正在读取状态';
  els.guideBody.textContent = appState?.guide?.body || '工作室正在连接本地工厂。';
  els.guideBadge.textContent = appState?.guide?.stage === 'ready' ? '就绪' : (appState?.guide?.stage || '就绪');
  els.loadStarterButton.disabled = !appState?.hasStarter;
  els.loadStarterButton.querySelector('span').textContent = appState?.hasStarter ? '示例' : '示例不可用';
  els.editCurrentProjectButton.href = activeId ? `/studio/import?project=${encodeURIComponent(activeId)}` : '/studio/import';
  els.importCurrentProjectButton.href = activeId ? `/studio/import?project=${encodeURIComponent(activeId)}` : '/studio/import';
  els.editCurrentProjectButton.classList.toggle('is-disabled', !activeId);
  els.importCurrentProjectButton.classList.toggle('is-disabled', !activeId);
  els.openCaptionsButton?.classList.toggle('is-disabled', !activeId);
  renderThemeControls();
}

function renderThemeControls() {
  const themes = appState?.themes || [];
  const activeTheme = appState?.theme || 'editorial';
  const previewUrl = appState?.urls?.preview || '/themes/default/index.html';
  document.querySelectorAll('[data-theme-preview]').forEach(link => {
    link.href = previewUrl;
  });
  if (els.previewFrame && (els.previewFrame.src === 'about:blank' || !els.previewFrame.src)) {
    els.previewFrame.src = `${previewUrl}?embed=1`;
  }
  [els.themeSelect, els.contentThemeInput].filter(Boolean).forEach(select => {
    const selected = select === els.themeSelect ? activeTheme : (select.value || INITIAL_FORM_VALUES.contentTheme);
    select.replaceChildren();
    themes.forEach(theme => {
      const option = document.createElement('option');
      option.value = theme.id;
      const locale = els.languageInput?.value === 'auto'
        ? (appState?.activeProject?.resolvedLanguage || 'zh-CN')
        : els.languageInput.value;
      option.textContent = theme.labels?.[locale] || theme.label;
      option.title = theme.descriptions?.[locale] || theme.description || '';
      option.selected = theme.id === selected;
      select.append(option);
    });
  });
  if (els.themeSelect) els.themeSelect.disabled = !appState?.activeProject || themes.length < 2;
  renderEngineOptions(els.contentThemeInput?.value || activeTheme);
}

function renderEngineOptions(themeId) {
  if (!els.engineInput) return;
  const theme = (appState?.themes || []).find(item => item.id === themeId);
  const previous = els.engineInput.value || 'auto';
  const engines = theme?.engines || ['dom'];
  els.engineInput.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = 'auto';
  automatic.textContent = `自动选择（${theme?.defaultEngine || engines[0]}）`;
  els.engineInput.append(automatic);
  engines.forEach(engine => {
    const option = document.createElement('option');
    option.value = engine;
    option.textContent = engine === 'three' ? 'Three.js / WebGL' : 'HTML / CSS / SVG';
    els.engineInput.append(option);
  });
  els.engineInput.value = engines.includes(previous) ? previous : 'auto';
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
  meta.textContent = `${project.sceneCount} 个场景 · ${project.narrationChars} 个字符 · ${formatDate(project.updatedAt)}`;
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
    empty.textContent = '暂无 .local/work 项目。';
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
  const link = document.createElement('a');
  link.className = 'output-card';
  link.href = output.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.title = `Open ${output.name}`;

  const title = document.createElement('span');
  title.className = 'output-title';
  title.textContent = output.name;

  const meta = document.createElement('span');
  meta.className = 'output-meta';
  meta.textContent = `${formatBytes(output.size)} · ${formatDate(output.modifiedAt)}`;

  link.append(title, meta);
  return link;
}

function renderOutputs() {
  els.outputList.replaceChildren();
  const isEmpty = !outputs.length;
  els.outputList.closest('.outputs-panel').classList.toggle('is-empty', isEmpty);
  if (isEmpty) {
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '暂无已导出的视频。';
    els.outputList.append(empty);
    return;
  }

  outputs.forEach(output => {
    els.outputList.append(outputCard(output));
  });
}

function reloadPreview() {
  const base = appState?.urls?.preview || '/themes/default/index.html';
  const transition = els.renderTransitionInput?.value || '0.4';
  els.previewFrame.src = `${base}?embed=1&transition=${encodeURIComponent(transition)}&studio=${Date.now()}`;
}

async function saveTheme(theme) {
  const project = appState?.activeProject?.id;
  if (!project || !theme || theme === appState?.theme) return;
  els.themeSelect.disabled = true;
  try {
    const profile = (appState?.themes || []).find(item => item.id === theme);
    const data = await postJson('/api/projects/theme', {
      project,
      contentTheme: theme,
      engine: profile?.defaultEngine || 'dom',
    });
    appState = data.state;
    reloadPreview();
    await refreshAll();
    setStatus(`主题已切换为 ${theme}。`, 'success');
  } catch (error) {
    renderThemeControls();
    setStatus(error.message, 'error');
  } finally {
    els.themeSelect.disabled = false;
  }
}

function tourSteps() {
  return [
    {
      element: '.status-strip',
      popover: {
        title: '先查看当前状态',
        description: '查看已加载的项目、时间轴是否已生成，以及是否已有导出视频。',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '.project-drawer',
      popover: {
        title: '在这里切换当前项目',
        description: '项目列表可激活项目，选择任一项目卡片即可设为当前项目。',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.current-project-panel',
      popover: {
        title: '查看当前项目工作区',
        description: '这里汇集当前项目名称、状态、下一步及编辑入口。',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.quick-actions-panel',
      popover: {
        title: '常用操作在这里',
        description: '可在这里编辑、导入替换内容、打开字幕或创建项目。',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.build-panel',
      popover: {
        title: '仅构建当前项目',
        description: '选择当前项目后，可在这里执行检查、TTS 和导出。',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '.preview-panel',
      popover: {
        title: '右侧仅显示当前项目',
        description: '预览和导出文件都属于当前项目，因此始终保持对应。',
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
        <button type="button" data-tour-prev>Back</button>
        <button type="button" data-tour-next>Next</button>
        <button type="button" data-tour-close>Done</button>
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
    setStatus('正在加载项目…');
    const data = await postJson('/api/projects/load', { project });
    appState = data.state;
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
  const confirmed = window.confirm(`要删除项目 ${project} 吗？这将移除 .local/work 中的源文件。`);
  if (!confirmed) return;
  try {
    setStatus(`正在删除项目：${project}…`);
    await postJson('/api/projects/delete', { project });
    await refreshAll();
    reloadPreview();
    setStatus(`项目已删除：${project}`, 'success');
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
  els.renderOutputInput.value = outputNameForSize(
    loaded.name || 'video',
    els.renderSizeInput.value,
  );
  await startJob('render');
}

async function validateExtracted() {
  if (!ensureExtracted()) return;
  try {
    const result = await postJson('/api/source/validate', {
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
      bodyCss: els.cssOutput.value,
      visualJs: els.visualOutput.value,
    });
    setStatus(`验证通过：${result.sceneCount} 个场景，${result.narrationChars} 个旁白字符。`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function saveProject() {
  if (!ensureExtracted()) return;
  const name = els.projectNameInput.value.trim();
  if (!name) {
    setStatus('请输入项目名称。', 'error');
    return;
  }
  try {
    setStatus('正在保存项目…');
    const created = await postJson('/api/projects', {
      project: importProjectId || undefined,
      name,
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
      bodyCss: els.cssOutput.value,
      visualJs: els.visualOutput.value,
      language: els.languageInput.value,
      contentTheme: els.contentThemeInput.value,
      engine: els.engineInput.value === 'auto'
        ? ((appState?.themes || []).find(item => item.id === els.contentThemeInput.value)?.defaultEngine || 'dom')
        : els.engineInput.value,
      overwrite: Boolean(importProjectId),
    });
    await postJson('/api/projects/load', { project: created.project.id });
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
    setStatus('请输入新项目名称。', 'error');
    els.newProjectNameInput.focus();
    return;
  }
  els.newProjectButton.disabled = true;
  try {
    const data = await postJson('/api/projects/blank', {
      name,
      language: els.languageInput?.value || 'auto',
      contentTheme: els.contentThemeInput?.value || 'editorial',
      engine: els.engineInput?.value || 'auto',
    });
    appState = data.state;
    resetWorkspaceUi({ name: data.project?.name || name, resetPrompt: true, resetImport: true });
    setProjectDrawerOpen(false);
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus(`已创建并加载项目：${data.project.name}`, 'success');
    window.location.href = `/studio/import?project=${encodeURIComponent(data.project.id)}`;
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    els.newProjectButton.disabled = false;
  }
}

function setJobBusy(isBusy, task = '') {
  [els.checkButton, els.offlineButton, els.ttsButton, els.renderButton].forEach(button => {
    button.disabled = isBusy;
  });
  const showOverlay = isBusy && ['tts', 'render'].includes(task);
  if (els.jobOverlay) {
    els.jobOverlay.hidden = !showOverlay;
    els.jobOverlay.setAttribute('aria-hidden', String(!showOverlay));
  }
  if (showOverlay) {
    const taskLabel = task === 'tts' ? '旁白生成' : 'MP4 导出';
    els.jobOverlayTitle.textContent = `${taskLabel}进行中`;
    els.jobOverlayMessage.textContent = '当前项目正在处理，请勿执行其他操作。';
  }
}

function renderJob(job) {
  currentJobId = job.id;
  const labels = {
    queued: '排队中',
    running: '运行中',
    succeeded: '已完成',
    failed: '失败',
  };
  els.jobStatus.textContent = `${job.task}: ${labels[job.status] || job.status}`;
  els.jobStatus.className = `job-status ${job.status}`;
  els.jobLog.textContent = job.log?.length ? job.log.join('\n') : '任务已启动，正在等待日志。';
  els.jobLog.scrollTop = els.jobLog.scrollHeight;
  setJobBusy(job.status === 'queued' || job.status === 'running', job.task);
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
  if (task === 'render') {
    payload.size = els.renderSizeInput.value;
    payload.output = els.renderOutputInput.value;
    payload.capture = 'auto';
    payload.transition = Number(els.renderTransitionInput?.value || 0.4);
  }
  setJobBusy(true, task);
  try {
    window.clearTimeout(pollTimer);
    const data = await postJson('/api/jobs', payload);
    renderJob(data.job);
    pollTimer = window.setTimeout(pollJob, 500);
    setStatus(`${task} 已启动。`);
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
  [els.languageInput, els.engineInput, els.promptTargetInput].filter(Boolean).forEach(input => {
    input.addEventListener('change', schedulePromptRefresh);
  });
  els.languageInput?.addEventListener('change', renderThemeControls);
  els.contentThemeInput?.addEventListener('change', () => {
    renderEngineOptions(els.contentThemeInput.value);
    schedulePromptRefresh();
  });
  els.copyPromptButton?.addEventListener('click', copyPrompt);
  els.tourButton.addEventListener('click', startTour);
  document.querySelectorAll('[data-studio-route]').forEach(link => {
    link.addEventListener('click', event => {
      if (new URL(link.href, window.location.origin).search) return;
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
  document.querySelectorAll('[data-import-mode]').forEach(button => {
    button.addEventListener('click', () => setImportMode(button.dataset.importMode));
  });
  [els.directScenesInput, els.directBodyInput, els.directCssInput, els.directVisualInput].filter(Boolean).forEach(input => {
    input.addEventListener('input', () => {
      if (importMode === 'direct') extractResponse();
    });
  });
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
      setStatus('请先选择项目。', 'error');
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
  els.renderSizeInput.addEventListener('change', () => {
    els.renderOutputInput.value = outputNameForSize(
      els.renderOutputInput.value,
      els.renderSizeInput.value,
    );
  });
  els.renderTransitionInput?.addEventListener('change', reloadPreview);

  els.projectList.addEventListener('click', event => {
    const card = event.target.closest('[data-project]');
    if (card) loadProject(card.dataset.project);
  });
  els.projectSelect?.addEventListener('change', event => {
    const projectId = event.target.value;
    if (projectId) loadProject(projectId);
  });
  els.themeSelect?.addEventListener('change', event => saveTheme(event.target.value));

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
    }
  });
}

bindEvents();
setProjectEditMode(false);
setProjectDrawerOpen(false);
applyRouteFocus();
if (els.promptOutput) refreshPrompt();
initImportProjectContext();
refreshAll();
renderIcons();
