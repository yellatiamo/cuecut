import {
  uid,
  mutate,
  files,
  elements,
  findMedia,
  getProject,
} from './state.js';
import { requestPeaks } from './waveform.js';
import { requestFilmstrip } from './filmstrip.js';
import { canStoreBlob, putMediaBlob, getMediaBlob } from './media-store.js';

function kindFromFile(file) {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('audio') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(n)) return 'audio';
  if (t.startsWith('image') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'image';
  return 'video';
}

function isBlobUrl(v) {
  return typeof v === 'string' && v.startsWith('blob:');
}

function isDataUrl(v) {
  return typeof v === 'string' && v.startsWith('data:');
}

function loadVideoMeta(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    el.playsInline = true;
    el.src = url;
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error('无法读取视频'));
  });
}

function loadAudioMeta(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.src = url;
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error('无法读取音频'));
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取图片'));
    img.src = url;
  });
}

async function makeThumbFromVideo(el) {
  try {
    const t = Math.min(0.2, (el.duration || 1) / 4);
    el.currentTime = t;
    await new Promise((res) => {
      el.onseeked = () => res();
      setTimeout(res, 400);
    });
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    c.getContext('2d').drawImage(el, 0, 0, 160, 90);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

function makeThumbFromImage(img) {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 90;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 160, 90);
  const s = Math.min(160 / img.width, 90 / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (160 - w) / 2, (90 - h) / 2, w, h);
  return c.toDataURL('image/jpeg', 0.7);
}

async function bindElement(media, src) {
  media.src = src;
  try {
    if (media.type === 'video') {
      const el = await loadVideoMeta(src);
      media.duration = el.duration || media.duration || 0;
      media.width = el.videoWidth || media.width || 0;
      media.height = el.videoHeight || media.height || 0;
      if (!media.thumbnail) media.thumbnail = await makeThumbFromVideo(el);
      el.pause();
      elements.set(media.id, el);
    } else if (media.type === 'audio') {
      const el = await loadAudioMeta(src);
      media.duration = el.duration || media.duration || 0;
      elements.set(media.id, el);
    } else {
      const img = await loadImage(src);
      media.width = img.naturalWidth || media.width || 0;
      media.height = img.naturalHeight || media.height || 0;
      media.duration = media.duration || 3;
      if (!media.thumbnail) media.thumbnail = makeThumbFromImage(img);
      elements.set(media.id, img);
    }
    media.needsRelink = false;
    if (media.type === 'video' || media.type === 'image') {
      requestFilmstrip(media).catch(() => {});
    }
    return true;
  } catch (err) {
    console.warn(err);
    media.needsRelink = true;
    return false;
  }
}

async function attachBlob(media, blob) {
  files.set(media.id, blob);
  const src = URL.createObjectURL(blob);
  return bindElement(media, src);
}

export async function importFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return [];
  const added = [];
  for (const file of incoming) {
    const type = kindFromFile(file);
    const src = URL.createObjectURL(file);
    const id = uid('media');
    const media = {
      id,
      name: file.name,
      type,
      duration: type === 'image' ? 3 : 0,
      width: 0,
      height: 0,
      thumbnail: null,
      dataUrl: null,
      filePath: file.path || null,
      src,
      needsRelink: false,
    };
    files.set(id, file);
    try {
      if (type === 'video') {
        const el = await loadVideoMeta(src);
        media.duration = el.duration || 0;
        media.width = el.videoWidth;
        media.height = el.videoHeight;
        media.thumbnail = await makeThumbFromVideo(el);
        el.pause();
        elements.set(id, el);
      } else if (type === 'audio') {
        const el = await loadAudioMeta(src);
        media.duration = el.duration || 0;
        elements.set(id, el);
      } else {
        const img = await loadImage(src);
        media.width = img.naturalWidth;
        media.height = img.naturalHeight;
        media.duration = 3;
        media.thumbnail = makeThumbFromImage(img);
        elements.set(id, img);
      }
    } catch (err) {
      console.warn(err);
    }
    if (canStoreBlob(file)) {
      await putMediaBlob(id, file);
    }
    added.push(media);
    if (media.type === 'audio' || media.type === 'video') {
      requestPeaks(media).catch(() => {});
    }
    if (media.type === 'video' || media.type === 'image') {
      requestFilmstrip(media).catch(() => {});
    }
  }
  mutate((p) => {
    p.media.push(...added);
  }, true);
  return added;
}

export async function hydrateSavedMedia(mediaList) {
  for (const m of mediaList) {
    if (isBlobUrl(m.src) || isBlobUrl(m.dataUrl)) {
      if (isBlobUrl(m.src)) m.src = null;
      if (isBlobUrl(m.dataUrl)) m.dataUrl = null;
    }
    const stored = await getMediaBlob(m.id);
    if (stored) {
      const ok = await attachBlob(m, stored);
      if (ok && (m.type === 'audio' || m.type === 'video')) {
        requestPeaks(m).catch(() => {});
      }
      continue;
    }
    if (isDataUrl(m.dataUrl)) {
      m.src = m.dataUrl;
      try {
        const blob = await (await fetch(m.dataUrl)).blob();
        files.set(m.id, blob);
        if (m.type === 'image') {
          const img = await loadImage(m.dataUrl);
          elements.set(m.id, img);
        } else if (m.type === 'audio') {
          const el = await loadAudioMeta(m.dataUrl);
          elements.set(m.id, el);
        } else if (m.type === 'video') {
          const el = await loadVideoMeta(m.dataUrl);
          elements.set(m.id, el);
        }
        m.needsRelink = false;
        if (m.type === 'video' || m.type === 'image') {
          requestFilmstrip(m).catch(() => {});
        }
      } catch {
        m.needsRelink = true;
      }
    } else if (m.filePath) {
      m.src = 'file://' + m.filePath;
      try {
        if (m.type === 'video') {
          const el = await loadVideoMeta(m.src);
          elements.set(m.id, el);
        } else if (m.type === 'audio') {
          const el = await loadAudioMeta(m.src);
          elements.set(m.id, el);
        } else {
          const img = await loadImage(m.src);
          elements.set(m.id, img);
        }
        m.needsRelink = false;
        if (m.type === 'video' || m.type === 'image') {
          requestFilmstrip(m).catch(() => {});
        }
      } catch {
        m.needsRelink = true;
        m.src = null;
      }
    } else {
      m.needsRelink = true;
      m.src = null;
    }
    if (!m.needsRelink && (m.type === 'audio' || m.type === 'video') && (m.src || m.dataUrl)) {
      requestPeaks(m).catch(() => {});
    }
  }
}

export function mediaDurationLabel(sec) {
  if (!sec && sec !== 0) return '--';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function renderLibrary() {
  const p = getProject();
  const list = document.getElementById('library-list');
  const empty = document.getElementById('library-empty');
  list.innerHTML = '';
  if (!p.media.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const m of p.media) {
    const card = document.createElement('div');
    card.className = 'media-card' + (m.needsRelink ? ' needs-relink' : '');
    card.draggable = !m.needsRelink;
    card.dataset.mediaId = m.id;
    const thumb = document.createElement(m.thumbnail ? 'img' : 'div');
    thumb.className = 'media-thumb';
    if (m.thumbnail) thumb.src = m.thumbnail;
    else {
      thumb.style.display = 'grid';
      thumb.style.placeItems = 'center';
      thumb.style.fontSize = '11px';
      thumb.style.color = '#9a948a';
      thumb.textContent = m.type === 'audio' ? '音频' : m.type;
    }
    const meta = document.createElement('div');
    meta.className = 'media-meta';
    const typeLabel = m.type === 'video' ? '视频' : m.type === 'audio' ? '音频' : '图片';
    meta.innerHTML = `<div class="name" title="${m.name}">${m.name}</div>
      <div class="sub">${typeLabel} · ${mediaDurationLabel(m.duration)}${m.needsRelink ? ' · 需重新导入' : ''}</div>`;
    card.append(thumb, meta);
    card.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/cuecut-media', m.id);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    list.appendChild(card);
  }
}

export function getMediaEl(id) {
  return elements.get(id) || null;
}

export { findMedia };
