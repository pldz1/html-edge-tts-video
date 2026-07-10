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
  projectSlugInput: $('#projectSlugInput'),
  validateExtractedButton: $('#validateExtractedButton'),
  saveProjectButton: $('#saveProjectButton'),
  scenesOutput: $('#scenesOutput'),
  bodyOutput: $('#bodyOutput'),
  statusText: $('#statusText'),
  extractStatus: $('#extractStatus'),
};

let promptRefreshFrame = 0;
let importMode = 'response';

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function setStatus(message, tone = 'neutral') {
  if (!els.statusText) return;
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
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function postJson(path, payload) {
  return api(path, { method: 'POST', body: JSON.stringify(payload) });
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

function setExtractStatus(message, tone = 'neutral') {
  if (!els.extractStatus) return;
  els.extractStatus.textContent = message;
  els.extractStatus.className = `job-status ${tone}`;
}

function extractResponse() {
  const directScenes = els.directScenesInput?.value.trim() || '';
  const directBody = els.directBodyInput?.value.trim() || '';
  const useDirect = importMode === 'direct' || directScenes || directBody;
  const text = els.aiResponseInput.value;
  const scenes = useDirect ? directScenes : extractScenes(text);
  const body = useDirect ? directBody : extractBody(text);
  els.scenesOutput.value = scenes;
  els.bodyOutput.value = body;

  if (!scenes || !body) {
    setExtractStatus('提取失败', 'failed');
    setStatus('没有同时找到 scenes.json 和 body.html。', 'error');
    return false;
  }

  try {
    JSON.parse(scenes);
  } catch {
    setExtractStatus('JSON 无效', 'failed');
    setStatus('提取出的 scenes.json 不是合法 JSON。', 'error');
    return false;
  }

  setExtractStatus('已提取', 'succeeded');
  setStatus('已提取 scenes.json 和 body.html。', 'success');
  return true;
}

function setImportMode(mode) {
  importMode = mode === 'direct' ? 'direct' : 'response';
  document.querySelectorAll('[data-import-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.importMode === importMode);
  });
  if (els.directImportGrid) els.directImportGrid.hidden = importMode !== 'direct';
  if (els.aiResponseInput) els.aiResponseInput.hidden = importMode === 'direct';
  setStatus(importMode === 'direct' ? '当前使用分别粘贴模式。' : '当前使用 AI response 提取模式。');
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
  const slug = els.projectSlugInput.value.trim();
  if (!slug) {
    setStatus('请填写项目 slug。', 'error');
    return;
  }
  els.saveProjectButton.disabled = true;
  try {
    setStatus('正在保存项目...');
    const created = await postJson('/api/projects', {
      slug,
      scenesJson: els.scenesOutput.value,
      bodyHtml: els.bodyOutput.value,
    });
    await postJson('/api/projects/load', { project: created.project.slug });
    setStatus(`已保存并加载：${created.project.slug}`, 'success');
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
  els.extractButton.addEventListener('click', extractResponse);
  els.validateExtractedButton.addEventListener('click', validateExtracted);
  els.saveProjectButton.addEventListener('click', saveProject);
}

bindPromptPage();
bindImportPage();
renderIcons();
