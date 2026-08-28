import { getProject, findClip, mutate, TEXT_STYLES } from './state.js';

function field(html) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = html;
  return wrap;
}

function bindNum(form, name, clipId, key, extra) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) return;
  el.addEventListener('input', () => {
    mutate((p) => {
      const hit = findClip(clipId, p);
      if (!hit) return;
      let v = Number(el.value);
      if (extra && extra.max != null) v = Math.min(extra.max, v);
      if (extra && extra.min != null) v = Math.max(extra.min, v);
      hit.clip[key] = v;
    }, true);
  });
}

export function renderInspector() {
  const p = getProject();
  const empty = document.getElementById('inspector-empty');
  const form = document.getElementById('inspector-form');
  const hit = p.selectedClipId ? findClip(p.selectedClipId) : null;
  if (!hit) {
    empty.classList.remove('hidden');
    form.classList.add('hidden');
    form.innerHTML = '';
    return;
  }
  const { clip } = hit;
  empty.classList.add('hidden');
  form.classList.remove('hidden');
  form.innerHTML = '';

  const typeLabel = { video: '视频', audio: '音频', image: '图片', text: '文字' }[clip.type] || clip.type;
  form.appendChild(field(`<label>片段 Clip</label><div>${typeLabel} · ${clip.label || clip.text || clip.id}</div>`));

  if (clip.type === 'text') {
    form.appendChild(field(`<label>文案 Text</label><textarea name="text">${clip.text || ''}</textarea>`));
    const styles = document.createElement('div');
    styles.className = 'style-picks';
    TEXT_STYLES.forEach((st) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'style-pick' + (clip.styleId === st.id ? ' is-on' : '');
      b.innerHTML = `<b>${st.name} ${st.en}</b><span>${st.desc}</span>`;
      b.addEventListener('click', () => {
        mutate((proj) => {
          const h = findClip(clip.id, proj);
          if (!h) return;
          h.clip.styleId = st.id;
          h.clip.fontSize = st.fontSize;
          h.clip.color = st.color;
          h.clip.x = st.x;
          h.clip.y = st.y;
          h.clip.fontWeight = st.fontWeight;
          h.clip.letterSpacing = st.letterSpacing;
          h.clip.shadow = st.shadow;
          if (!h.clip.text) h.clip.text = st.text;
        }, true);
      });
      styles.appendChild(b);
    });
    const box = field('<label>样式 Styles</label>');
    box.appendChild(styles);
    form.appendChild(box);
    form.appendChild(field(`<label>字号 Font size</label><input name="fontSize" type="number" min="12" max="200" value="${clip.fontSize || 36}">`));
    form.appendChild(field(`<label>颜色 Color</label><input name="color" type="color" value="${clip.color || '#f2efe9'}">`));
  }

  if (clip.type === 'audio' || clip.type === 'video') {
    form.appendChild(field(`<label>音量 Volume</label>
      <div class="row"><span>0</span><span>${Math.round((clip.volume ?? 1) * 100)}%</span></div>
      <input name="volume" type="range" min="0" max="1" step="0.01" value="${clip.volume ?? 1}">`));
  }

  if (clip.type !== 'audio') {
    form.appendChild(field(`<label>透明度 Opacity</label>
      <div class="row"><span>0</span><span>${Math.round((clip.opacity ?? 1) * 100)}%</span></div>
      <input name="opacity" type="range" min="0" max="1" step="0.01" value="${clip.opacity ?? 1}">`));
    form.appendChild(field(`<label>位置 X</label><input name="x" type="range" min="0" max="1" step="0.01" value="${clip.x ?? 0.5}">`));
    form.appendChild(field(`<label>位置 Y</label><input name="y" type="range" min="0" max="1" step="0.01" value="${clip.y ?? 0.5}">`));
    form.appendChild(field(`<label>缩放 Scale</label><input name="scale" type="range" min="0.1" max="3" step="0.01" value="${clip.scale ?? 1}">`));
  }

  form.appendChild(field(`<label>淡入 Fade in (s)</label><input name="fadeIn" type="number" min="0" max="8" step="0.05" value="${clip.fadeIn ?? 0}">`));
  form.appendChild(field(`<label>淡出 Fade out (s)</label><input name="fadeOut" type="number" min="0" max="8" step="0.05" value="${clip.fadeOut ?? 0}">`));

  const textArea = form.querySelector('[name="text"]');
  if (textArea) {
    textArea.addEventListener('input', () => {
      mutate((proj) => {
        const h = findClip(clip.id, proj);
        if (!h) return;
        h.clip.text = textArea.value;
        h.clip.label = textArea.value;
      }, true);
    });
  }
  const color = form.querySelector('[name="color"]');
  if (color) {
    color.addEventListener('input', () => {
      mutate((proj) => {
        const h = findClip(clip.id, proj);
        if (h) h.clip.color = color.value;
      }, true);
    });
  }
  bindNum(form, 'fontSize', clip.id, 'fontSize', { min: 12, max: 220 });
  bindNum(form, 'volume', clip.id, 'volume', { min: 0, max: 1 });
  bindNum(form, 'opacity', clip.id, 'opacity', { min: 0, max: 1 });
  bindNum(form, 'x', clip.id, 'x', { min: 0, max: 1 });
  bindNum(form, 'y', clip.id, 'y', { min: 0, max: 1 });
  bindNum(form, 'scale', clip.id, 'scale', { min: 0.1, max: 3 });
  bindNum(form, 'fadeIn', clip.id, 'fadeIn', { min: 0, max: 8 });
  bindNum(form, 'fadeOut', clip.id, 'fadeOut', { min: 0, max: 8 });
}
