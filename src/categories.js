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
