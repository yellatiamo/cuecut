import { elements, clipSpeed } from './state.js';

const cache = new Map();
const inflight = new Map();

const SAMPLE_INTERVAL = 0.4;
const MAX_FRAMES = 100;
const FRAME_H = 36;
const SEEK_TIMEOUT = 500;
const META_TIMEOUT = 4000;

export function getFilmstrip(mediaId) {
  return cache.get(mediaId) || null;
}

export function forget(mediaId) {
  if (!mediaId) return;
  cache.delete(mediaId);
  inflight.delete(mediaId);
}

function mediaSrc(media) {
  if (!media) return null;
  return media.src || media.dataUrl || null;
}

function frameSize(media) {
  const w = Number(media && media.width) || 0;
  const h = Number(media && media.height) || 0;
  const aspect = w > 0 && h > 0 ? w / h : 16 / 9;
  const fw = Math.max(20, Math.round(FRAME_H * aspect));
  return { fw, fh: FRAME_H };
}

function sampleTimes(duration) {
  const dur = Math.max(0, Number(duration) || 0);
  if (dur <= 0) return [0];
  let n = Math.max(1, Math.round(dur / SAMPLE_INTERVAL));
  n = Math.min(MAX_FRAMES, n);
  if (n === 1) return [Math.min(dur * 0.5, Math.max(0, dur - 0.04))];
  const times = [];
  for (let i = 0; i < n; i += 1) {
    const t = ((i + 0.5) / n) * dur;
    times.push(Math.min(Math.max(0, t), Math.max(0, dur - 0.04)));
  }
  return times;
}

function drawCover(ctx, source, dx, dy, dw, dh) {
  if (!ctx || !source || dw < 1 || dh < 1) return false;
  const sw = source.videoWidth || source.naturalWidth || source.width || 0;
  const sh = source.videoHeight || source.naturalHeight || source.height || 0;
  if (!sw || !sh) return false;
  const srcAspect = sw / sh;
  const dstAspect = dw / dh;
  let sx = 0;
  let sy = 0;
  let cw = sw;
  let ch = sh;
  if (srcAspect > dstAspect) {
    cw = sh * dstAspect;
    sx = (sw - cw) / 2;
  } else {
    ch = sw / dstAspect;
    sy = (sh - ch) / 2;
  }
  try {
    ctx.drawImage(source, sx, sy, cw, ch, dx, dy, dw, dh);
    return true;
  } catch {
    return false;
  }
}

function loadImageSrc(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('no image src'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function waitMeta(video) {
  return new Promise((resolve) => {
    if (video.readyState >= 1 && isFinite(video.duration)) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('error', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done);
    video.addEventListener('error', done);
    setTimeout(done, META_TIMEOUT);
  });
}

function seekWithTimeout(video, time, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onErr);
      resolve();
    };
    const onSeeked = () => finish();
    const onErr = () => finish();
    const dur = isFinite(video.duration) ? video.duration : 0;
    const t = dur > 0
      ? Math.min(Math.max(0, time), Math.max(0, dur - 0.04))
      : Math.max(0, time);
    if (video.readyState >= 2 && Math.abs((video.currentTime || 0) - t) < 0.025) {
      finish();
      return;
    }
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onErr);
    try {
      video.currentTime = t;
    } catch {
      finish();
      return;
    }
    setTimeout(finish, timeoutMs);
  });
}

function makeSampler(src) {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.style.cssText = 'position:fixed;left:-8px;top:-8px;width:1px;height:1px;opacity:0;pointer-events:none;';
  video.src = src;
  document.body.appendChild(video);
  return video;
}

function disposeSampler(video) {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch { /* ignore */ }
  try { video.remove(); } catch { /* ignore */ }
}

async function sampleVideo(media) {
  const src = mediaSrc(media);
  if (!src) return null;
  const { fw, fh } = frameSize(media);
  const times = sampleTimes(media.duration);
  const video = makeSampler(src);
  try {
    await waitMeta(video);
    const sprite = document.createElement('canvas');
    sprite.width = Math.max(1, fw * times.length);
    sprite.height = fh;
    const ctx = sprite.getContext('2d');
    ctx.fillStyle = '#111118';
    ctx.fillRect(0, 0, sprite.width, sprite.height);
    for (let i = 0; i < times.length; i += 1) {
      await seekWithTimeout(video, times[i], SEEK_TIMEOUT);
      drawCover(ctx, video, i * fw, 0, fw, fh);
    }
    return { canvas: sprite, times, fw, fh };
  } finally {
    disposeSampler(video);
  }
}

async function sampleImage(media) {
  const { fw, fh } = frameSize(media);
  const sprite = document.createElement('canvas');
  sprite.width = fw;
  sprite.height = fh;
  const ctx = sprite.getContext('2d');
  ctx.fillStyle = '#111118';
  ctx.fillRect(0, 0, fw, fh);
  let source = elements.get(media.id) || null;
  if (!source && media.thumbnail) {
    try { source = await loadImageSrc(media.thumbnail); } catch { source = null; }
  }
  if (!source) {
    const src = mediaSrc(media);
    if (src) {
      try { source = await loadImageSrc(src); } catch { source = null; }
    }
  }
  if (source) drawCover(ctx, source, 0, 0, fw, fh);
  return { canvas: sprite, times: [0], fw, fh };
}

async function buildSprite(media) {
  if (!media || media.needsRelink) return null;
  if (media.type === 'image') return sampleImage(media);
  if (media.type === 'video') {
    if (!mediaSrc(media)) return null;
    return sampleVideo(media);
  }
  return null;
}

export function requestFilmstrip(media) {
  if (!media || !media.id) return Promise.resolve(null);
  if (media.needsRelink) return Promise.resolve(null);
  if (media.type !== 'video' && media.type !== 'image') return Promise.resolve(null);
  if (cache.has(media.id)) return Promise.resolve(cache.get(media.id));
  if (inflight.has(media.id)) return inflight.get(media.id);
  if (media.type === 'video' && !mediaSrc(media)) return Promise.resolve(null);
  const job = buildSprite(media)
    .then((sprite) => {
      if (sprite && inflight.get(media.id) === job) cache.set(media.id, sprite);
      return sprite || null;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(media.id) === job) inflight.delete(media.id);
    });
  inflight.set(media.id, job);
  return job;
}

function nearestFrame(sprite, time) {
  const times = sprite && sprite.times;
  if (!times || !times.length) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const d = Math.abs(times[i] - time);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function paintFilmstrip(canvas, sprite, clip) {
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!sprite || !sprite.canvas || w < 2 || h < 2) return;
  const fw = sprite.fw || 64;
  const fh = sprite.fh || FRAME_H;
  const cellW = Math.max(4, h * (fw / fh));
  const cells = Math.max(1, Math.ceil(w / cellW));
  const offset = Number(clip && clip.offset) || 0;
  const duration = Math.max(0.05, Number(clip && clip.duration) || 0.05);
  const speed = clipSpeed(clip);
  for (let i = 0; i < cells; i += 1) {
    const sourceTime = offset + ((i + 0.5) / cells) * duration * speed;
    const fi = nearestFrame(sprite, sourceTime);
    const x0 = Math.round(i * cellW);
    const x1 = Math.round((i + 1) * cellW);
    const dw = Math.max(1, x1 - x0);
    try {
      ctx.drawImage(sprite.canvas, fi * fw, 0, fw, fh, x0, 0, dw, h);
    } catch { /* ignore */ }
  }
}

function stripHeight(el) {
  const h = el && el.clientHeight;
  return Math.max(32, Math.round(h) || 54);
}

export function attachClipFilmstrip(el, clip, media, pps) {
  if (!el || !clip || !media) return;
  if (clip.type !== 'video' && clip.type !== 'image') return;
  if (media.needsRelink) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'clip-strip';
  canvas.width = Math.max(8, Math.floor((clip.duration || 0.2) * (pps || 48)));
  canvas.height = stripHeight(el);
  el.insertBefore(canvas, el.firstChild);
  const paint = (sprite, requireConnected) => {
    if (!sprite) return;
    if (requireConnected && !canvas.isConnected) return;
    if (canvas.isConnected && el.clientHeight) {
      const nextH = stripHeight(el);
      if (canvas.height !== nextH) canvas.height = nextH;
    }
    paintFilmstrip(canvas, sprite, clip);
  };
  const cached = getFilmstrip(media.id);
  if (cached) {
    paint(cached, false);
    return;
  }
  requestFilmstrip(media).then((sprite) => paint(sprite, true));
}

export function resizeClipFilmstrip(el, clip, media, pps) {
  if (!el || !clip) return;
  const canvas = el.querySelector('.clip-strip');
  if (!canvas) return;
  canvas.width = Math.max(8, Math.floor((clip.duration || 0.2) * (pps || 48)));
  canvas.height = stripHeight(el);
  const sprite = media ? getFilmstrip(media.id) : null;
  if (sprite) paintFilmstrip(canvas, sprite, clip);
}
