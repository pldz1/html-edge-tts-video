const $ = selector => document.querySelector(selector);

const els = {
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
  directImportGrid: $('.direct-import-grid'),
  extractButton: $('#extractButton'),
  projectNameInput: $('#projectNameInput'),
  validateExtractedButton: $('#validateExtractedButton'),
  saveProjectButton: $('#saveProjectButton'),
  scenesOutput: $('#scenesOutput'),
  bodyOutput: $('#bodyOutput'),
  extractStatus: $('#extractStatus'),
  workflowGuideButton: $('#workflowGuideButton'),
  workflowGuideDialog: $('#workflowGuideDialog'),
};

let promptRefreshFrame = 0;
let importMode = 'smart';
let importProjectId = '';
let toastTimer = 0;

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function bindGuideDialog() {
  if (!els.workflowGuideButton || !els.workflowGuideDialog) return;
  els.workflowGuideButton.addEventListener('click', () => els.workflowGuideDialog.showModal());
  els.workflowGuideDialog.querySelector('[data-close-guide]')?.addEventListener('click', () => els.workflowGuideDialog.close());
  els.workflowGuideDialog.addEventListener('click', event => {
    if (event.target === els.workflowGuideDialog) els.workflowGuideDialog.close();
  });
}

function setStatus(message, tone = 'neutral') {
  let toast = document.querySelector('#workflowToast');
  if (!toast) {
    toast = document.createElement('p');
    toast.id = 'workflowToast';
    toast.className = 'studio-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
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
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function postJson(path, payload) {
  return api(path, { method: 'POST', body: JSON.stringify(payload) });
}

function projectFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('project') || '';
}

async function initImportProjectContext() {
  if (!els.projectNameInput) return;
  const urlProject = projectFromUrl();
  if (urlProject) {
    importProjectId = urlProject;
    setStatus(`正在打开项目：${importProjectId}`);
    try {
      const data = await api(`/api/projects/source?project=${encodeURIComponent(importProjectId)}`);
      const scenes = data?.files?.scenesJson || '';
      const body = data?.files?.bodyHtml || '';
      els.projectNameInput.value = data?.project?.name || '';
      if (els.directScenesInput) els.directScenesInput.value = scenes;
      if (els.directBodyInput) els.directBodyInput.value = body;
      if (els.scenesOutput) els.scenesOutput.value = scenes;
      if (els.bodyOutput) els.bodyOutput.value = body;
      setExtractStatus(scenes && body ? '已载入' : '待补全', scenes && body ? 'succeeded' : 'running');
      setStatus(`已载入项目：${data?.project?.name || importProjectId}，现在可以直接编辑并保存。`, 'success');
    } catch (error) {
      setStatus(error.message || `无法读取项目：${importProjectId}`, 'error');
    }
    return;
  }
  try {
    const state = await api('/api/studio/state');
    const activeId = state?.activeProject?.id || '';
    if (activeId) {
      importProjectId = activeId;
      els.projectNameInput.value = state?.activeProject?.name || '';
      setStatus(`当前会保存到已加载项目：${state?.activeProject?.name || activeId}`);
    }
  } catch {
    // Import can still work as a standalone create flow.
  }
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
  if (!els.promptOutput) return;
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
    setStatus('浏览器没有剪贴板权限，请手动复制。', 'error');
  }
}

function extractFence(text, name, language) {
  const patterns = [
    new RegExp(`\`\`\`${language}\\s+${name}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`\`\`\`${language}\\s+index\\.html\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`${name}\\s*:?\\s*\\n\`\`\`(?:${language})?\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function looksLikeScenesJson(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) && parsed.some(scene => scene && typeof scene === 'object' && scene.id && scene.narration);
  } catch {
    return false;
  }
}

function looksLikeBodyHtml(text) {
  return /<section\b[\s\S]*data-scene=/i.test(text) || /<body\b[\s\S]*<section\b/i.test(text);
}

function extractScenes(text) {
  const fenced = extractFence(text, 'scenes.json', 'json');
  if (fenced) return fenced;
  if (looksLikeScenesJson(text.trim())) return text.trim();
  const match = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  return match ? match[0].trim() : '';
}

function extractBody(text) {
  const fenced = extractFence(text, 'body.html', 'html');
  if (fenced) return fenced;
  if (looksLikeBodyHtml(text.trim())) return text.trim();
  const firstSection = text.indexOf('<section');
  const lastSection = text.lastIndexOf('</section>');
  if (firstSection === -1 || lastSection === -1) return '';
  return text.slice(firstSection, lastSection + '</section>'.length).trim();
}

function readSmartSources() {
  const smartText = els.aiResponseInput?.value || '';
  const directScenes = els.directScenesInput?.value.trim() || '';
  const directBody = els.directBodyInput?.value.trim() || '';
  return {
    scenes: directScenes || extractScenes(smartText) || els.scenesOutput.value.trim(),
    body: directBody || extractBody(smartText) || els.bodyOutput.value.trim(),
  };
}

function setExtractStatus(message, tone = 'neutral') {
  if (!els.extractStatus) return;
  els.extractStatus.textContent = message;
  els.extractStatus.className = `job-status ${tone}`;
}

function extractResponse() {
  const { scenes, body } = readSmartSources();
  els.scenesOutput.value = scenes;
  els.bodyOutput.value = body;

  if (!scenes || !body) {
    setExtractStatus('缺少文件', 'failed');
    setStatus('还缺 scenes.json 或 body.html/index.html。可以继续粘贴，或切到分别粘贴。', 'error');
    return false;
  }

  try {
    JSON.parse(scenes);
  } catch {
    setExtractStatus('JSON 无效', 'failed');
    setStatus('提取出的 scenes.json 不是合法 JSON。', 'error');
    return false;
  }

  setExtractStatus('已识别', 'succeeded');
  setStatus('已识别 scenes.json 和 body.html。', 'success');
  return true;
}

function setImportMode(mode) {
  importMode = mode === 'direct' ? 'direct' : 'smart';
  document.querySelectorAll('[data-import-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.importMode === importMode);
  });
  if (els.directImportGrid) els.directImportGrid.hidden = importMode !== 'direct';
  if (els.aiResponseInput) els.aiResponseInput.hidden = importMode === 'direct';
  setStatus(importMode === 'direct' ? '当前使用分别粘贴模式。' : '当前使用智能粘贴模式。');
}

function ensureExtracted() {
  if (els.scenesOutput.value.trim() && els.bodyOutput.value.trim()) return true;
  return extractResponse();
}

async function validateExtracted() {
  if (!ensureExtracted()) return;
  try {
    const result = await postJson('/api/source/validate', {
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
    });
    setExtractStatus('校验通过', 'succeeded');
    setStatus(`校验通过：${result.sceneCount} scenes，${result.narrationChars} 字旁白。`, 'success');
  } catch (error) {
    setExtractStatus('校验失败', 'failed');
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
  els.saveProjectButton.disabled = true;
  try {
    setStatus('正在保存项目...');
    const overwrite = Boolean(importProjectId);
    const created = await postJson('/api/projects', {
      project: importProjectId || undefined,
      name,
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
      overwrite,
    });
    await postJson('/api/projects/load', { project: created.project.id });
    setStatus(`已保存并加载：${created.project.name}`, 'success');
    window.setTimeout(() => {
      window.location.href = '/studio';
    }, 450);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    els.saveProjectButton.disabled = false;
  }
}

function bindPromptPage() {
  if (!els.promptOutput) return;
  [els.topicInput, els.audienceInput, els.toneInput, els.sceneCountInput, els.notesInput].forEach(input => {
    input.addEventListener('input', schedulePromptRefresh);
  });
  els.copyPromptButton.addEventListener('click', copyPrompt);
  document.querySelectorAll('[data-provider]').forEach(button => {
    button.addEventListener('click', async () => {
      await copyPrompt();
      window.open(button.dataset.provider, '_blank', 'noopener,noreferrer');
    });
  });
  refreshPrompt();
}

function bindImportPage() {
  if (!els.aiResponseInput) return;
  document.querySelectorAll('[data-import-mode]').forEach(button => {
    button.addEventListener('click', () => setImportMode(button.dataset.importMode));
  });
  [els.directScenesInput, els.directBodyInput].filter(Boolean).forEach(input => {
    input.addEventListener('input', () => {
      if (importMode === 'direct') extractResponse();
    });
  });
  els.aiResponseInput.addEventListener('input', () => {
    if (importMode === 'smart') window.clearTimeout(els.aiResponseInput.extractTimer);
    if (importMode === 'smart') {
      els.aiResponseInput.extractTimer = window.setTimeout(() => {
        const { scenes, body } = readSmartSources();
        if (scenes) els.scenesOutput.value = scenes;
        if (body) els.bodyOutput.value = body;
        if (scenes || body) setExtractStatus(scenes && body ? '已识别' : '继续粘贴', scenes && body ? 'succeeded' : 'running');
      }, 180);
    }
  });
  els.extractButton.addEventListener('click', extractResponse);
  els.validateExtractedButton.addEventListener('click', validateExtracted);
  els.saveProjectButton.addEventListener('click', saveProject);
}

bindPromptPage();
bindImportPage();
bindGuideDialog();
initImportProjectContext();
renderIcons();
