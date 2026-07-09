const topicInput = document.querySelector('#topicInput');
const audienceInput = document.querySelector('#audienceInput');
const toneInput = document.querySelector('#toneInput');
const sceneCountInput = document.querySelector('#sceneCountInput');
const notesInput = document.querySelector('#notesInput');
const promptOutput = document.querySelector('#promptOutput');
const copyPromptButton = document.querySelector('#copyPromptButton');
const aiResponseInput = document.querySelector('#aiResponseInput');
const extractButton = document.querySelector('#extractButton');
const scenesOutput = document.querySelector('#scenesOutput');
const bodyOutput = document.querySelector('#bodyOutput');
const statusText = document.querySelector('#statusText');

function buildPrompt() {
  const topic = topicInput.value.trim();
  const audience = audienceInput.value.trim();
  const tone = toneInput.value.trim();
  const sceneCount = sceneCountInput.value.trim();
  const notes = notesInput.value.trim();

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

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function refreshPrompt() {
  promptOutput.value = buildPrompt();
}

async function copyPrompt() {
  refreshPrompt();
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    setStatus('Prompt copied.');
  } catch {
    promptOutput.focus();
    promptOutput.select();
    setStatus('Select and copy the prompt manually.', true);
  }
}

function extractFence(text, name, language) {
  const patterns = [
    new RegExp(`\`\`\`${language}\\s+${name}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
    new RegExp(`${name}\\s*:?\\s*\\n\`\`\`(?:${language})?\\s*\\n([\\s\\S]*?)\\n\`\`\``, 'i'),
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
  const text = aiResponseInput.value;
  const scenes = extractScenes(text);
  const body = extractBody(text);
  scenesOutput.value = scenes;
  bodyOutput.value = body;

  if (!scenes || !body) {
    setStatus('Could not find both scenes.json and body.html.', true);
    return;
  }

  try {
    JSON.parse(scenes);
  } catch {
    setStatus('Extracted scenes.json is not valid JSON.', true);
    return;
  }

  setStatus('Extracted scenes.json and body.html.');
}

[topicInput, audienceInput, toneInput, sceneCountInput, notesInput].forEach(input => {
  input.addEventListener('input', refreshPrompt);
});

copyPromptButton.addEventListener('click', copyPrompt);
extractButton.addEventListener('click', extractResponse);

document.querySelectorAll('[data-provider]').forEach(button => {
  button.addEventListener('click', async () => {
    await copyPrompt();
    window.open(button.dataset.provider, '_blank', 'noopener,noreferrer');
  });
});

refreshPrompt();
