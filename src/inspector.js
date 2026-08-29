import { getProject, findClip, mutate, patch, emit, TEXT_STYLES, TRANSITIONS, nextVisualClip, checkpoint, persist } from './state.js';
import { renderFrame } from './preview.js';

let boundId = null;
let boundType = null;

function field(html) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = html;
  return wrap;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(v) {
  return Math.round((v ?? 1) * 100) + '%';
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function bindLive(form, name, clipId, apply) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) return;
  let armed = false;
  const arm = () => {
    if (!armed) {
      checkpoint();
      armed = true;
    }
  };
  el.addEventListener('input', () => {
    arm();
    patch((p) => {
      const hit = findClip(clipId, p);
      if (!hit) return;
      apply(hit.clip, el);
    });
    const live = form.querySelector(`[data-live="${name}"]`);
    if (live && (name === 'volume' || name === 'opacity')) {
      live.textContent = pct(Number(el.value));
    }
    renderFrame();
  });
  el.addEventListener('change', () => {
    if (!armed) arm();
    persist();
    emit();
    armed = false;
  });
}

function buildForm(form, clip, track) {
  form.innerHTML = '';
  const typeLabel = { video: '视频', audio: '音频', image: '图片', text: '文字' }[clip.type] || clip.type;
  form.appendChild(field(
    `<label>片段 Clip</label><div data-clip-label>${typeLabel} · ${escapeHtml(clip.label || clip.text || clip.id)}</div>`
  ));

  if (clip.type === 'text') {
    form.appendChild(field(`<label>文案 Text</label><textarea name="text">${escapeHtml(clip.text || '')}</textarea>`));
    const styles = document.createElement('div');
    styles.className = 'style-picks';
    TEXT_STYLES.forEach((st) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'style-pick' + (clip.styleId === st.id ? ' is-on' : '');
      b.dataset.styleId = st.id;
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
      <div class="row"><span>0</span><span data-live="volume">${pct(clip.volume ?? 1)}</span></div>
      <input name="volume" type="range" min="0" max="1" step="0.01" value="${clip.volume ?? 1}">`));
  }

  if (clip.type === 'video') {
    form.appendChild(field(`<label class="check"><input name="muted" type="checkbox" ${clip.muted ? 'checked' : ''}> 静音原声 Mute original</label>`));
  }

  if (clip.type !== 'audio') {
    form.appendChild(field(`<label>透明度 Opacity</label>
      <div class="row"><span>0</span><span data-live="opacity">${pct(clip.opacity ?? 1)}</span></div>
      <input name="opacity" type="range" min="0" max="1" step="0.01" value="${clip.opacity ?? 1}">`));
    form.appendChild(field(`<label>位置 X</label><input name="x" type="range" min="0" max="1" step="0.01" value="${clip.x ?? 0.5}">`));
    form.appendChild(field(`<label>位置 Y</label><input name="y" type="range" min="0" max="1" step="0.01" value="${clip.y ?? 0.5}">`));
    form.appendChild(field(`<label>缩放 Scale</label><input name="scale" type="range" min="0.1" max="3" step="0.01" value="${clip.scale ?? 1}">`));
  }

  if (clip.type === 'video' || clip.type === 'image') {
    const next = nextVisualClip(clip, track);
    const cur = (clip.transition && clip.transition.type) || 'none';
    const dur = (clip.transition && clip.transition.duration) || 0.5;
    const opts = TRANSITIONS.map((t) =>
      `<option value="${t.id}" ${cur === t.id ? 'selected' : ''}>${t.name} ${t.en}</option>`
    ).join('');
    form.appendChild(field(`<label>转场到下一片段 Transition${next ? '' : '（本轨无后续片段）'}</label>
      <select name="transition">${opts}</select>
      <input name="transDur" type="number" min="0.1" max="2.5" step="0.05" value="${dur}">`));
  }

  form.appendChild(field(`<label>淡入 Fade in (s)</label><input name="fadeIn" type="number" min="0" max="8" step="0.05" value="${clip.fadeIn ?? 0}">`));
  form.appendChild(field(`<label>淡出 Fade out (s)</label><input name="fadeOut" type="number" min="0" max="8" step="0.05" value="${clip.fadeOut ?? 0}">`));

  bindLive(form, 'text', clip.id, (c, el) => {
    c.text = el.value;
    c.label = el.value;
  });
  bindLive(form, 'color', clip.id, (c, el) => { c.color = el.value; });
  bindLive(form, 'fontSize', clip.id, (c, el) => { c.fontSize = clamp(Number(el.value), 12, 220); });
  bindLive(form, 'volume', clip.id, (c, el) => { c.volume = clamp(Number(el.value), 0, 1); });
  bindLive(form, 'opacity', clip.id, (c, el) => { c.opacity = clamp(Number(el.value), 0, 1); });
  bindLive(form, 'x', clip.id, (c, el) => { c.x = clamp(Number(el.value), 0, 1); });
  bindLive(form, 'y', clip.id, (c, el) => { c.y = clamp(Number(el.value), 0, 1); });
  bindLive(form, 'scale', clip.id, (c, el) => { c.scale = clamp(Number(el.value), 0.1, 3); });
  bindLive(form, 'fadeIn', clip.id, (c, el) => { c.fadeIn = clamp(Number(el.value) || 0, 0, 8); });
  bindLive(form, 'fadeOut', clip.id, (c, el) => { c.fadeOut = clamp(Number(el.value) || 0, 0, 8); });

  const muted = form.querySelector('[name="muted"]');
  if (muted) {
    muted.addEventListener('change', () => {
      mutate((proj) => {
        const h = findClip(clip.id, proj);
        if (h) h.clip.muted = muted.checked;
      }, true);
    });
  }
  const trans = form.querySelector('[name="transition"]');
  const transDur = form.querySelector('[name="transDur"]');
  const saveTrans = () => {
    mutate((proj) => {
      const h = findClip(clip.id, proj);
      if (!h) return;
      h.clip.transition = {
        type: trans.value || 'none',
        duration: Math.max(0.1, Number(transDur && transDur.value) || 0.5),
      };
    }, true);
  };
  if (trans) trans.addEventListener('change', saveTrans);
  if (transDur) transDur.addEventListener('change', saveTrans);
}

function syncForm(form, clip) {
  const active = document.activeElement;
  const setVal = (name, value, isCheck = false) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (!el || el === active) return;
    if (isCheck) {
      el.checked = !!value;
      return;
    }
    if (el.type === 'range' || el.type === 'number') {
      if (Number(el.value) !== Number(value)) el.value = value;
    } else if (el.value !== String(value ?? '')) {
      el.value = value ?? '';
    }
  };
  const label = form.querySelector('[data-clip-label]');
  if (label) {
    const typeLabel = { video: '视频', audio: '音频', image: '图片', text: '文字' }[clip.type] || clip.type;
    label.textContent = `${typeLabel} · ${clip.label || clip.text || clip.id}`;
  }
  setVal('text', clip.text || '');
  setVal('color', clip.color || '#f2efe9');
  setVal('fontSize', clip.fontSize || 36);
  setVal('volume', clip.volume ?? 1);
  setVal('opacity', clip.opacity ?? 1);
  setVal('x', clip.x ?? 0.5);
  setVal('y', clip.y ?? 0.5);
  setVal('scale', clip.scale ?? 1);
  setVal('fadeIn', clip.fadeIn ?? 0);
  setVal('fadeOut', clip.fadeOut ?? 0);
  setVal('muted', clip.muted, true);
  const volLive = form.querySelector('[data-live="volume"]');
  if (volLive) volLive.textContent = pct(clip.volume ?? 1);
  const opLive = form.querySelector('[data-live="opacity"]');
  if (opLive) opLive.textContent = pct(clip.opacity ?? 1);
  form.querySelectorAll('.style-pick').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.styleId === clip.styleId);
  });
  const trans = form.querySelector('[name="transition"]');
  if (trans && trans !== active) {
    const cur = (clip.transition && clip.transition.type) || 'none';
    if (trans.value !== cur) trans.value = cur;
  }
  const transDur = form.querySelector('[name="transDur"]');
  if (transDur && transDur !== active) {
    const dur = (clip.transition && clip.transition.duration) || 0.5;
    if (Number(transDur.value) !== Number(dur)) transDur.value = dur;
  }
}

export function renderInspector() {
  const p = getProject();
  const empty = document.getElementById('inspector-empty');
  const form = document.getElementById('inspector-form');
  const hit = p.selectedClipId ? findClip(p.selectedClipId) : null;
  if (!hit) {
    boundId = null;
    boundType = null;
    empty.classList.remove('hidden');
    form.classList.add('hidden');
    form.innerHTML = '';
    return;
  }
  const { clip, track } = hit;
  empty.classList.add('hidden');
  form.classList.remove('hidden');
  if (boundId !== clip.id || boundType !== clip.type) {
    boundId = clip.id;
    boundType = clip.type;
    buildForm(form, clip, track);
  } else {
    syncForm(form, clip);
  }
}
