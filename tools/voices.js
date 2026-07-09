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
      <article class="voice-card">
        <div>
          <h2>No voice samples yet</h2>
          <p>Run python main.py voice-preview, then refresh this page.</p>
        </div>
      </article>
    `;
  }
}

init();
