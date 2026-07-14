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
  notesInput: $('#notesInput'),
  promptOutput: $('#promptOutput'),
  copyPromptButton: $('#copyPromptButton'),
  aiResponseInput: $('#aiResponseInput'),
  directScenesInput: $('#directScenesInput'),
  directBodyInput: $('#directBodyInput'),
  directImportGrid: $('#directImportGrid'),
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
let importMode = 'smart';
let importProjectId = '';

const TOUR_STORAGE_KEY = 'html-edge-tts-video:studio-tour-seen:v1';
const PROJECT_DRAWER_STORAGE_KEY = 'html-edge-tts-video:studio-project-drawer-open:v1';
const INITIAL_FORM_VALUES = Object.freeze({
  topic: els.topicInput?.value || '',
  audience: els.audienceInput?.value || '',
  tone: els.toneInput?.value || '',
  sceneCount: els.sceneCountInput?.value || '',
  notes: els.notesInput?.value || '',
  projectName: els.projectNameInput?.value || 'New video project',
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
    els.projectNameInput.value = data?.project?.name || '';
    els.scenesOutput.value = scenes;
    els.bodyOutput.value = body;
    if (els.directScenesInput) els.directScenesInput.value = scenes;
    if (els.directBodyInput) els.directBodyInput.value = body;
    setStatus(`Editing project: ${data?.project?.name || projectId}`, 'success');
  } catch (error) {
    setStatus(error.message || 'Unable to load the project source.', 'error');
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
    els.projectEditButton.title = editing ? 'Collapse project details' : 'Edit project details';
    const label = els.projectEditButton.querySelector('span');
    if (label) label.textContent = editing ? 'Collapse' : 'Edit';
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
    setStatus('Select a project first.', 'error');
    return;
  }
  const name = (els.projectTitleInput?.value || '').trim();
  if (!name) {
    setStatus('Project name cannot be empty.', 'error');
    return;
  }
  try {
    await postJson('/api/projects/update', { project: active.id, name });
    setProjectEditMode(false);
    await refreshAll();
    setStatus('Project name updated.', 'success');
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
  els.jobStatus.textContent = 'Idle';
  els.jobStatus.className = 'job-status';
  els.jobLog.textContent = 'Waiting for a task.';
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
    if (desktopLabel) desktopLabel.textContent = 'Projects';
    return;
  }
  document.body.classList.toggle('projects-open', open);
  els.sidebarToggle.setAttribute('aria-expanded', String(open));
  const label = els.sidebarToggle.querySelector('span');
  if (label) label.textContent = open ? 'Close projects' : 'Projects';
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
  if (!value) return 'Unknown time';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'Unknown size';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 'Generated';
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
  - \`category\`: a short English label, used by the factory's bottom chapter rail.
  - \`title\`: visual title for the scene.
  - \`summary\`: one sentence for the visual summary.
  - \`narration\`: natural English spoken narration.
- Optional fields such as \`visual_notes\` are allowed, but do not rely on JavaScript.
- For an approximately three-minute video at edge-tts \`+12%\` rate, target roughly 450 to 550 English words total.
- Keep each scene focused. Prefer 4 to 7 scenes for a short explainer.
- Match every scene's narration with a visual aid, so the screen explains structure rather than only repeating the spoken text.

Example scene:

\`\`\`json
{
  "id": "intro",
  "category": "Overview",
  "title": "Start with the question",
  "summary": "Explain the starting point and the route through the video.",
  "narration": "This video starts with the central question, then breaks down the key idea, common misconceptions, and practical next steps."
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
    <div class="diagram-node" data-step><b>Input</b><span>Question and material</span></div>
    <div class="diagram-node" data-step><b>Process</b><span>Shape the structure</span></div>
    <div class="diagram-node" data-step><b>Output</b><span>Visuals and narration</span></div>
  </div>
  <div class="formula-strip">
    <div class="formula-token"><b>Concept</b><span>What it is</span></div>
    <div class="formula-token operator">+</div>
    <div class="formula-token"><b>Relationship</b><span>How it connects</span></div>
    <div class="formula-token operator">=</div>
    <div class="formula-token"><b>Conclusion</b><span>How to use it</span></div>
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
    setStatus('Prompt copied.', 'success');
  } catch {
    els.promptOutput.focus();
    els.promptOutput.select();
    setStatus('The browser did not grant clipboard permission. Copy it manually.', 'error');
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
  const scenes = els.directScenesInput?.value.trim() || extractScenes(text);
  const body = els.directBodyInput?.value.trim() || extractBody(text);
  els.scenesOutput.value = scenes;
  els.bodyOutput.value = body;

  if (!scenes || !body) {
    setStatus('scenes.json and body.html were not both found.', 'error');
    return false;
  }

  try {
    JSON.parse(scenes);
  } catch {
    setStatus('The extracted scenes.json is not valid JSON.', 'error');
    return false;
  }

  setStatus('scenes.json and body.html extracted.', 'success');
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
  const currentTitle = active?.name || activeProject?.name || current.title || 'No project selected';
  const timelineLabel = timeline.matchesSource
    ? formatDuration(timeline.duration)
    : timeline.exists
      ? 'Rebuild needed'
      : 'Not generated';
  els.currentProjectName.textContent = currentTitle;
  els.timelineStatus.textContent = timelineLabel;
  els.outputStatus.textContent = `${outputs.length} total`;
  els.currentSourcePath.textContent = active?.relativePath || 'No current source files';
  els.workspaceProjectTitle.textContent = currentTitle;
  els.workspaceProjectTitle.title = currentTitle;
  els.workspaceProjectId.textContent = activeId || 'Not loaded';
  els.projectDetailTitle.textContent = currentTitle;
  els.workspaceSceneCount.textContent = `${sceneCount}`;
  els.workspaceNarrationChars.textContent = `${narrationChars}`;
  els.workspaceTimelineState.textContent = timelineLabel;
  els.workspaceTimelineState.classList.toggle('warning', !timeline.matchesSource);
  els.workspaceTimelineState.classList.toggle('success', Boolean(timeline.matchesSource));
  els.workspaceOutputCount.textContent = `${outputs.length}`;
  els.guideTitle.textContent = appState?.guide?.title || 'Reading status';
  els.guideBody.textContent = appState?.guide?.body || 'Studio is connecting to the local factory.';
  els.guideBadge.textContent = (appState?.guide?.stage || 'ready').toUpperCase();
  els.loadStarterButton.disabled = !appState?.hasStarter;
  els.loadStarterButton.querySelector('span').textContent = appState?.hasStarter ? 'Example' : 'Example unavailable';
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
  meta.textContent = `${project.sceneCount} scenes · ${project.narrationChars} characters · ${formatDate(project.updatedAt)}`;
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
    empty.textContent = 'There are no .local/work projects yet.';
    els.projectList.append(empty);
    if (els.projectSelect) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No projects available';
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
    empty.textContent = 'There are no exported videos yet.';
    els.outputList.append(empty);
    return;
  }

  outputs.forEach(output => {
    els.outputList.append(outputCard(output));
  });
}

function reloadPreview() {
  const base = '/themes/default/index.html';
  els.previewFrame.src = `${base}?studio=${Date.now()}`;
}

function tourSteps() {
  return [
    {
      element: '.status-strip',
      popover: {
        title: 'Start with the current status',
        description: 'See which project is loaded, whether its timeline is generated, and whether it has output videos.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '.project-drawer',
      popover: {
        title: 'Switch the current project here',
        description: 'The project list activates projects. Select any project card to make it current.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.current-project-panel',
      popover: {
        title: 'Review the current project workspace',
        description: 'This area brings together the current project title, status, next step, and editing entry points.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.quick-actions-panel',
      popover: {
        title: 'Common actions are here',
        description: 'Edit, import a replacement, open captions, or create a project from one place.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.build-panel',
      popover: {
        title: 'Build only the current project',
        description: 'After selecting the current project, run Check, TTS, and Render here.',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '.preview-panel',
      popover: {
        title: 'The right side shows the current project only',
        description: 'The preview and outputs both belong to the current project, so they always correspond.',
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
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
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
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
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
    setStatus('Loading project...');
    const data = await postJson('/api/projects/load', { project });
    resetWorkspaceUi({ name: data.project?.name || '', resetPrompt: false, resetImport: true });
    if (closeDrawer) setProjectDrawerOpen(false);
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus('Project loaded.', 'success');
    return data.project;
  } catch (error) {
    setStatus(error.message, 'error');
    return null;
  }
}

async function deleteProject(project) {
  const confirmed = window.confirm(`Delete project ${project}? This removes its source files from .local/work.`);
  if (!confirmed) return;
  try {
    setStatus(`Deleting project: ${project}...`);
    await postJson('/api/projects/delete', { project });
    await refreshAll();
    reloadPreview();
    setStatus(`Project deleted: ${project}`, 'success');
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
    });
    setStatus(`Validation passed: ${result.sceneCount} scenes, ${result.narrationChars} narration characters.`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function saveProject() {
  if (!ensureExtracted()) return;
  const name = els.projectNameInput.value.trim();
  if (!name) {
    setStatus('Enter a project name.', 'error');
    return;
  }
  try {
    setStatus('Saving project...');
    const created = await postJson('/api/projects', {
      project: importProjectId || undefined,
      name,
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
      overwrite: Boolean(importProjectId),
    });
    await postJson('/api/projects/load', { project: created.project.id });
    resetWorkspaceUi({ name: created.project.name, resetPrompt: false, resetImport: true });
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus(`Saved and loaded: ${created.project.name}`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function createBlankProject() {
  const name = els.newProjectNameInput.value.trim();
  if (!name) {
    setStatus('Enter a new project name', 'error');
    els.newProjectNameInput.focus();
    return;
  }
  els.newProjectButton.disabled = true;
  try {
    const data = await postJson('/api/projects/blank', { name });
    appState = data.state;
    resetWorkspaceUi({ name: data.project?.name || name, resetPrompt: true, resetImport: true });
    setProjectDrawerOpen(false);
    setStudioRoute('main');
    reloadPreview();
    await refreshAll();
    setStatus(`Created and loaded project: ${data.project.name}`, 'success');
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
    const taskLabel = task === 'tts' ? 'Narration generation' : 'MP4 export';
    els.jobOverlayTitle.textContent = `${taskLabel} in progress`;
    els.jobOverlayMessage.textContent = 'The current project is processing. Do not perform other actions.';
  }
}

function renderJob(job) {
  currentJobId = job.id;
  const labels = {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Complete',
    failed: 'Failed',
  };
  els.jobStatus.textContent = `${job.task}: ${labels[job.status] || job.status}`;
  els.jobStatus.className = `job-status ${job.status}`;
  els.jobLog.textContent = job.log?.length ? job.log.join('\n') : 'Task started; waiting for logs.';
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
      setStatus(`${data.job.task} completed.`, 'success');
    } else {
      setStatus(`${data.job.task} failed. Check the log.`, 'error');
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
  }
  setJobBusy(true, task);
  try {
    window.clearTimeout(pollTimer);
    const data = await postJson('/api/jobs', payload);
    renderJob(data.job);
    pollTimer = window.setTimeout(pollJob, 500);
    setStatus(`${task} started.`);
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
  [els.directScenesInput, els.directBodyInput].filter(Boolean).forEach(input => {
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
      setStatus('Select a project first.', 'error');
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

  els.projectList.addEventListener('click', event => {
    const card = event.target.closest('[data-project]');
    if (card) loadProject(card.dataset.project);
  });
  els.projectSelect?.addEventListener('change', event => {
    const projectId = event.target.value;
    if (projectId) loadProject(projectId);
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
