import {
  CATEGORIES,
  TRANSITIONS,
  TEXT_STYLES,
  getProject,
  mutate,
  patch,
  findClip,
  uid,
  defaultClipProps,
  emit,
  setSelected,
  assignSelection,
  defaultExportSettings,
  listTextClips,
  visualClipsOnTrack,
  transitionDuration,
  aspectPreset,
  exportOutputSize,
} from './state.js';
import { importFiles, renderLibrary, mediaDurationLabel } from './media.js';
import { renderFrame, formatTc } from './preview.js';
import { startExport } from './export.js';
import { addTextClip, addCaptionAtPlayhead, importSrtText, downloadSrt } from './captions.js';

let activeCategory = 'media';
let recorder = null;
let recChunks = [];
let recStream = null;
let recError = '';

export function getCategory() {
  return activeCategory;
}

export function setCategory(id) {
  if (!CATEGORIES.some((c) => c.id === id)) return;
  activeCategory = id;
  renderCategories();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shouldSkipRebuild() {
  const el = document.activeElement;
  if (!el) return false;
  if (!el.closest || !el.closest('#cat-panes')) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number' || el.type === '')) return true;
  return false;
}

export function renderCategories() {
  renderRail();
  document.querySelectorAll('.cat-pane').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.pane !== activeCategory);
  });
  if (activeCategory === 'media') {
    renderLibrary();
    return;
  }
  if (shouldSkipRebuild()) return;
  if (activeCategory === 'audio') renderAudioPane();
  else if (activeCategory === 'text') renderTextPane();
  else if (activeCategory === 'captions') renderCaptionsPane();
  else if (activeCategory === 'transitions') renderTransitionsPane();
  else if (activeCategory === 'export') renderExportPane();
}

function renderRail() {
  const rail = document.getElementById('cat-rail');
  if (!rail) return;
  if (!rail.dataset.bound) {
    rail.dataset.bound = '1';
    rail.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-cat]');
      if (btn) setCategory(btn.dataset.cat);
    });
  }
  rail.innerHTML = CATEGORIES.map((c) =>
    `<button type="button" class="cat-btn${activeCategory === c.id ? ' is-on' : ''}" data-cat="${c.id}" title="${c.zh} ${c.en}">
      <span class="cat-ico" aria-hidden="true">${c.icon}</span>
      <span class="cat-zh">${c.zh}</span>
      <span class="cat-en">${c.en}</span>
    </button>`
  ).join('');
}

export function extractAudioFromSelected(muteOriginal) {
  const p = getProject();
  const hit = p.selectedClipId ? findClip(p.selectedClipId) : null;
  if (!hit) return false;
  const clip = hit.clip;
  if (clip.type !== 'video' || !clip.mediaId) return false;
  mutate((proj) => {
    const h = findClip(clip.id, proj);
    if (!h) return;
    if (muteOriginal && h.clip.type === 'video') h.clip.muted = true;
    const a1 = proj.tracks.find((t) => t.id === 'a1');
    a1.clips.push({
      id: uid('clip'),
      mediaId: h.clip.mediaId,
      type: 'audio',
      start: h.clip.start,
      duration: h.clip.duration,
      offset: h.clip.offset || 0,
      label: (h.clip.label || '音频') + ' · 提取',
      ...defaultClipProps({
        volume: h.clip.volume ?? 1,
        fadeIn: h.clip.fadeIn || 0,
        fadeOut: h.clip.fadeOut || 0,
        muted: false,
        speed: h.clip.speed || 1,
      }),
    });
    assignSelection(proj, [a1.clips[a1.clips.length - 1].id]);
  }, true);
  return true;
}

export function setClipMuted(clipId, muted) {
  mutate((p) => {
    const h = findClip(clipId, p);
    if (h && h.clip.type === 'video') h.clip.muted = !!muted;
  }, true);
}

function placeAudioOnTrack(media, trackId, start) {
  mutate((p) => {
    const tr = p.tracks.find((t) => t.id === trackId) || p.tracks.find((t) => t.id === 'a1');
    tr.clips.push({
      id: uid('clip'),
      mediaId: media.id,
      type: 'audio',
      start: Math.max(0, start == null ? p.playhead : start),
      duration: Math.max(0.4, media.duration || 3),
      label: media.name,
      ...defaultClipProps({ volume: 1, fadeIn: 0, fadeOut: 0 }),
    });
    assignSelection(p, [tr.clips[tr.clips.length - 1].id]);
  }, true);
}

async function startVoiceover() {
  recError = '';
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    recError = '未获得麦克风权限 / mic permission denied';
    recStream = null;
    renderAudioPane();
    return;
  }
  recChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
  recorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) recChunks.push(e.data);
  };
  recorder.start(200);
  renderAudioPane();
}

async function stopVoiceover() {
  if (!recorder) return;
  const rec = recorder;
  await new Promise((resolve) => {
    rec.onstop = resolve;
    try { rec.stop(); } catch { resolve(); }
  });
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
  recStream = null;
  recorder = null;
  const blob = new Blob(recChunks, { type: rec.mimeType || 'audio/webm' });
  recChunks = [];
  if (!blob.size) {
    recError = '录音为空';
    renderAudioPane();
    return;
  }
  const file = new File([blob], 'voiceover-' + Date.now() + '.webm', { type: blob.type || 'audio/webm' });
  await importFiles([file]);
  const p = getProject();
  const media = [...p.media].reverse().find((m) => m.type === 'audio');
  if (media) placeAudioOnTrack(media, 'a1', p.playhead);
  renderAudioPane();
}

function renderAudioPane() {
  const pane = document.getElementById('pane-audio');
  if (!pane) return;
  const p = getProject();
  const audios = p.media.filter((m) => m.type === 'audio');
  const hit = p.selectedClipId ? findClip(p.selectedClipId) : null;
  const selVideo = hit && hit.clip.type === 'video' ? hit.clip : null;
  const selAudio = hit && (hit.clip.type === 'audio' || hit.clip.type === 'video') ? hit.clip : null;
  const aClips = [];
  for (const t of p.tracks) {
    if (t.type !== 'audio') continue;
    for (const c of t.clips) aClips.push({ clip: c, track: t });
  }
  aClips.sort((a, b) => a.clip.start - b.clip.start);

  pane.innerHTML = `
    <div class="panel-head"><h2>音频 <small>Audio</small></h2>
      <button type="button" id="btn-import-audio" class="btn btn-ghost" title="导入音频">+</button>
    </div>
    <p class="hint">导入音频，拖到 A1 / A2；可提取视频原声，或在播放头录制旁白。</p>
    <div class="pane-actions">
      <button type="button" class="btn btn-accent" id="btn-import-audio-2">导入音频 Import</button>
      ${recorder
        ? `<button type="button" class="btn" id="btn-vo-stop">停止录音 Stop</button>`
        : `<button type="button" class="btn" id="btn-vo-start">麦克风旁白 Mic</button>`}
    </div>
    ${recError ? `<p class="hint warn">${escapeHtml(recError)}</p>` : ''}
    ${recorder ? `<p class="hint">正在录音… 结束后会放到 A1 播放头位置。</p>` : ''}

    <h3 class="pane-sub">选中片段 Selected</h3>
    ${selVideo ? `
      <div class="tool-card">
        <div class="name">${escapeHtml(selVideo.label || '视频')}</div>
        <label class="check"><input type="checkbox" id="chk-mute-orig" ${selVideo.muted ? 'checked' : ''}> 静音原声 Mute original</label>
        <label class="check"><input type="checkbox" id="chk-extract-mute" checked> 提取时同时静音视频</label>
        <button type="button" class="btn btn-accent" id="btn-extract-audio">提取音频到 A1 Extract</button>
      </div>` : `<p class="hint">在时间轴点选一段视频，可提取或静音原声。</p>`}

    ${selAudio ? `
      <div class="tool-card">
        <div class="name">音量 / 淡入淡出 · ${escapeHtml(selAudio.label || selAudio.text || selAudio.type)}</div>
        <label>音量 Volume <span id="aud-vol-pct">${Math.round((selAudio.volume ?? 1) * 100)}</span>%
          <input id="aud-vol" type="range" min="0" max="1" step="0.01" value="${selAudio.volume ?? 1}">
        </label>
        <div class="row-2">
          <label>淡入 Fade in
            <input id="aud-fi" type="number" min="0" max="8" step="0.05" value="${selAudio.fadeIn ?? 0}">
          </label>
          <label>淡出 Fade out
            <input id="aud-fo" type="number" min="0" max="8" step="0.05" value="${selAudio.fadeOut ?? 0}">
          </label>
        </div>
      </div>` : ''}

    <h3 class="pane-sub">已导入音频 Library</h3>
    <div class="library-list" id="audio-lib-list"></div>
    ${audios.length ? '' : '<p class="hint">还没有独立音频。导入文件，或用演示项目里的短音调。</p>'}

    <h3 class="pane-sub">时间轴音频 Clips · A1 / A2</h3>
    <div class="cap-list">
      ${aClips.length ? aClips.map(({ clip, track }) => `
        <button type="button" class="cap-row ${p.selectedClipId === clip.id ? 'is-on' : ''}" data-sel="${clip.id}">
          <b>${escapeHtml(track.name)} · ${escapeHtml(clip.label || '音频')}</b>
          <span>${formatTc(clip.start, p.fps)} – ${formatTc(clip.start + clip.duration, p.fps)} · ${Math.round((clip.volume ?? 1) * 100)}%</span>
        </button>`).join('') : '<p class="hint">A1 / A2 上还没有片段。</p>'}
    </div>
  `;

  const list = pane.querySelector('#audio-lib-list');
  for (const m of audios) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.draggable = !m.needsRelink;
    card.dataset.mediaId = m.id;
    card.innerHTML = `<div class="media-thumb audio-thumb">音频</div>
      <div class="media-meta"><div class="name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
      <div class="sub">音频 · ${mediaDurationLabel(m.duration)}</div></div>`;
    card.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/cuecut-media', m.id);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    card.addEventListener('dblclick', () => placeAudioOnTrack(m, 'a1', getProject().playhead));
    list.appendChild(card);
  }

  pane.querySelector('#btn-import-audio').onclick = () => document.getElementById('audio-input').click();
  pane.querySelector('#btn-import-audio-2').onclick = () => document.getElementById('audio-input').click();
  const voStart = pane.querySelector('#btn-vo-start');
  const voStop = pane.querySelector('#btn-vo-stop');
  if (voStart) voStart.onclick = () => startVoiceover();
  if (voStop) voStop.onclick = () => stopVoiceover();
  const extract = pane.querySelector('#btn-extract-audio');
  if (extract) {
    extract.onclick = () => {
      const mute = pane.querySelector('#chk-extract-mute');
      extractAudioFromSelected(mute ? mute.checked : true);
    };
  }
  const muteOrig = pane.querySelector('#chk-mute-orig');
  if (muteOrig) {
    muteOrig.onchange = () => setClipMuted(selVideo.id, muteOrig.checked);
  }
  const vol = pane.querySelector('#aud-vol');
  if (vol && selAudio) {
    vol.oninput = () => {
      patch((proj) => {
        const h = findClip(selAudio.id, proj);
        if (h) h.clip.volume = Number(vol.value);
      });
      const pctEl = pane.querySelector('#aud-vol-pct');
      if (pctEl) pctEl.textContent = String(Math.round(Number(vol.value) * 100));
      renderFrame();
    };
    vol.onchange = () => emit();
  }
  const fi = pane.querySelector('#aud-fi');
  const fo = pane.querySelector('#aud-fo');
  if (fi && selAudio) {
    fi.onchange = () => mutate((proj) => {
      const h = findClip(selAudio.id, proj);
      if (h) h.clip.fadeIn = Math.max(0, Number(fi.value) || 0);
    }, true);
  }
  if (fo && selAudio) {
    fo.onchange = () => mutate((proj) => {
      const h = findClip(selAudio.id, proj);
      if (h) h.clip.fadeOut = Math.max(0, Number(fo.value) || 0);
    }, true);
  }
  pane.querySelectorAll('[data-sel]').forEach((btn) => {
    btn.onclick = () => setSelected(btn.dataset.sel);
  });
}

function renderTextPane() {
  const pane = document.getElementById('pane-text');
  if (!pane) return;
  pane.innerHTML = `
    <div class="panel-head"><h2>文字 <small>Text</small></h2></div>
    <p class="hint">选择样式，在播放头插入约 3 秒的标题。灯牌 / 手记 / 字幕条为原创样式。</p>
    <div class="style-picks" id="text-styles"></div>
  `;
  const box = pane.querySelector('#text-styles');
  TEXT_STYLES.forEach((st) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'style-pick';
    b.innerHTML = `<b>${escapeHtml(st.name)} ${escapeHtml(st.en)}</b><span>${escapeHtml(st.desc)}</span>`;
    b.onclick = () => addTextClip(st.id, st.text, undefined, 3);
    box.appendChild(b);
  });
}

function renderCaptionsPane() {
  const pane = document.getElementById('pane-captions');
  if (!pane) return;
  const p = getProject();
  const items = listTextClips(p);
  pane.innerHTML = `
    <div class="panel-head"><h2>字幕 <small>Captions</small></h2></div>
    <p class="hint">在播放头添加字幕，或导入 / 导出 SRT。导出时可选择烧录进画面。</p>
    <div class="pane-actions">
      <button type="button" class="btn btn-accent" id="btn-add-cap">添加字幕 Add</button>
      <button type="button" class="btn" id="btn-import-srt">导入 SRT</button>
      <button type="button" class="btn" id="btn-export-srt">导出 SRT</button>
    </div>
    <div class="cap-list" id="cap-list">
      ${items.length ? '' : '<p class="hint">还没有字幕。添加一条，或导入 SRT。</p>'}
    </div>
  `;
  const list = pane.querySelector('#cap-list');
  items.forEach(({ clip }) => {
    const row = document.createElement('div');
    row.className = 'cap-edit' + (p.selectedClipId === clip.id ? ' is-on' : '');
    row.innerHTML = `
      <div class="cap-tc">${formatTc(clip.start, p.fps)} → ${formatTc(clip.start + clip.duration, p.fps)}</div>
      <textarea data-cap="${clip.id}">${escapeHtml(clip.text || '')}</textarea>
    `;
    row.querySelector('textarea').addEventListener('focus', () => setSelected(clip.id));
    row.querySelector('textarea').addEventListener('input', (ev) => {
      const val = ev.target.value;
      patch((proj) => {
        const h = findClip(clip.id, proj);
        if (!h) return;
        h.clip.text = val;
        h.clip.label = val;
      });
      renderFrame();
    });
    row.querySelector('textarea').addEventListener('change', () => emit());
    list.appendChild(row);
  });
  pane.querySelector('#btn-add-cap').onclick = () => addCaptionAtPlayhead('字幕');
  pane.querySelector('#btn-import-srt').onclick = () => document.getElementById('srt-input').click();
  pane.querySelector('#btn-export-srt').onclick = () => downloadSrt();
}

function applyTransition(clipId, type, duration) {
  mutate((p) => {
    const h = findClip(clipId, p);
    if (!h) return;
    if (type === 'none') h.clip.transition = { type: 'none', duration: 0.5 };
    else h.clip.transition = { type, duration: duration || 0.5 };
  }, true);
}

function renderTransitionsPane() {
  const pane = document.getElementById('pane-transitions');
  if (!pane) return;
  const p = getProject();
  const pairs = [];
  for (const track of p.tracks) {
    if (track.type === 'audio' || track.type === 'overlay') continue;
    const list = visualClipsOnTrack(track);
    for (let i = 0; i < list.length - 1; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      pairs.push({ track, a, b, d: transitionDuration(a, b) || (a.transition && a.transition.duration) || 0.5 });
    }
  }
  pane.innerHTML = `
    <div class="panel-head"><h2>转场 <small>Transitions</small></h2></div>
    <p class="hint">在同一视频轨相邻片段之间加入交叉溶解或闪黑。预览用透明度；导出时相邻片段走 ffmpeg xfade / fadeblack。</p>
    ${pairs.length ? pairs.map(({ track, a, b }) => {
      const cur = (a.transition && a.transition.type) || 'none';
      return `<div class="tool-card" data-pair="${a.id}">
        <div class="name">${escapeHtml(track.name)} · ${escapeHtml(a.label || a.type)} → ${escapeHtml(b.label || b.type)}</div>
        <div class="seg trans-seg">
          ${TRANSITIONS.map((t) =>
            `<button type="button" class="seg-btn${cur === t.id ? ' is-on' : ''}" data-tid="${a.id}" data-tt="${t.id}">${t.name}</button>`
          ).join('')}
        </div>
        <label>时长 Duration (s)
          <input type="number" min="0.1" max="2.5" step="0.05" value="${(a.transition && a.transition.duration) || 0.5}" data-tdur="${a.id}">
        </label>
      </div>`;
    }).join('') : '<p class="hint">同一轨道上需要至少两段相邻视频 / 图片才会出现转场。</p>'}
  `;
  pane.querySelectorAll('[data-tt]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tid;
      const input = pane.querySelector(`[data-tdur="${id}"]`);
      applyTransition(id, btn.dataset.tt, input ? Number(input.value) : 0.5);
    };
  });
  pane.querySelectorAll('[data-tdur]').forEach((input) => {
    input.onchange = () => {
      const h = findClip(input.dataset.tdur);
      const type = (h && h.clip.transition && h.clip.transition.type) || 'none';
      applyTransition(input.dataset.tdur, type, Number(input.value) || 0.5);
    };
  });
}

function renderExportPane() {
  const pane = document.getElementById('pane-export');
  if (!pane) return;
  const p = getProject();
  const es = { ...defaultExportSettings(), ...(p.exportSettings || {}) };
  const aspect = aspectPreset(p.aspect);
  const size = exportOutputSize(p);
  pane.innerHTML = `
    <div class="panel-head"><h2>导出 <small>Export</small></h2></div>
    <p class="hint">选择分辨率、帧率与质量后开始导出。字幕可烧录进 MP4。</p>
    <p class="hint">画布 ${aspect.id} ${aspect.zh} · 导出 ${size.w}×${size.h}</p>
    <form id="export-form" class="inspector-form" style="padding:8px 12px 18px">
      <div class="field">
        <label>分辨率 Resolution</label>
        <div class="seg" id="exp-res">
          <button type="button" class="seg-btn${es.resolution === '720p' ? ' is-on' : ''}" data-res="720p">720p</button>
          <button type="button" class="seg-btn${es.resolution === '1080p' ? ' is-on' : ''}" data-res="1080p">1080p</button>
        </div>
      </div>
      <div class="field">
        <label>帧率 FPS</label>
        <div class="seg" id="exp-fps">
          ${[24, 30, 60].map((n) =>
            `<button type="button" class="seg-btn${Number(es.fps) === n ? ' is-on' : ''}" data-fps="${n}">${n}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label>质量 Quality</label>
        <div class="seg" id="exp-q">
          <button type="button" class="seg-btn${es.quality === 'draft' ? ' is-on' : ''}" data-q="draft">草稿</button>
          <button type="button" class="seg-btn${es.quality === 'standard' ? ' is-on' : ''}" data-q="standard">标准</button>
          <button type="button" class="seg-btn${es.quality === 'high' ? ' is-on' : ''}" data-q="high">高质量</button>
        </div>
      </div>
      <div class="field">
        <label class="check"><input type="checkbox" id="exp-caps" ${es.includeCaptions ? 'checked' : ''}> 烧录字幕 Include captions</label>
      </div>
      <div class="field">
        <label>文件名 Filename</label>
        <input id="exp-name" type="text" value="${escapeHtml(es.filename || 'cuecut.mp4')}">
      </div>
      <button type="button" class="btn btn-accent" id="btn-export-go">开始导出 Start export</button>
    </form>
  `;

  function saveSettings(partial) {
    mutate((proj) => {
      proj.exportSettings = { ...defaultExportSettings(), ...(proj.exportSettings || {}), ...partial };
      if (partial.fps) proj.fps = Number(partial.fps);
    }, false);
  }

  pane.querySelectorAll('[data-res]').forEach((b) => {
    b.onclick = () => saveSettings({ resolution: b.dataset.res });
  });
  pane.querySelectorAll('[data-fps]').forEach((b) => {
    b.onclick = () => saveSettings({ fps: Number(b.dataset.fps) });
  });
  pane.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => saveSettings({ quality: b.dataset.q });
  });
  pane.querySelector('#exp-caps').onchange = (ev) => saveSettings({ includeCaptions: ev.target.checked });
  pane.querySelector('#exp-name').onchange = (ev) => {
    let name = ev.target.value.trim() || 'cuecut.mp4';
    if (!/\.mp4$/i.test(name)) name += '.mp4';
    saveSettings({ filename: name });
  };
  pane.querySelector('#btn-export-go').onclick = () => startExport();
}

export function bindCategoryInputs() {
  const audioInput = document.getElementById('audio-input');
  audioInput.addEventListener('change', async () => {
    await importFiles(audioInput.files);
    audioInput.value = '';
    setCategory('audio');
  });
  const srtInput = document.getElementById('srt-input');
  srtInput.addEventListener('change', async () => {
    const f = srtInput.files && srtInput.files[0];
    srtInput.value = '';
    if (!f) return;
    const text = await f.text();
    importSrtText(text);
    setCategory('captions');
  });
}
