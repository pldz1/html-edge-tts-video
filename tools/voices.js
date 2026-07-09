const list = document.querySelector('#voiceList');
const previewText = document.querySelector('#previewText');
const previewRate = document.querySelector('#previewRate');
const previewPitch = document.querySelector('#previewPitch');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function init() {
  try {
    const response = await fetch('/.local/assets/voice-preview/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('manifest missing');
    const manifest = await response.json();
    previewText.textContent = manifest.text;
    previewRate.textContent = manifest.rate;
    previewPitch.textContent = manifest.pitch;
    list.innerHTML = manifest.samples.map(sample => `
      <article class="voice-card">
        <div>
          <h2>${escapeHtml(sample.voice)}</h2>
          <p>${escapeHtml([sample.locale, sample.gender].filter(Boolean).join(' / '))}</p>
        </div>
        <audio controls preload="metadata" src="${escapeHtml(sample.audio)}"></audio>
      </article>
    `).join('');
  } catch {
    list.innerHTML = `
      <article class="voice-card voice-empty">
        <div>
          <h2>还没有生成声音试听</h2>
          <p>这个页面用于比较 edge-tts 中文声线。先在终端运行 python main.py voice-preview，生成本地试听音频后刷新页面。</p>
        </div>
      </article>
    `;
  }
}

init();
