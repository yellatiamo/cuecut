import { files } from './state.js';

const peaksCache = new Map();
const inflight = new Map();
const PEAKS = 320;
const SKIP_VIDEO_LONGER_THAN = 90;

let audioContext = null;

function getCtx() {
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  return audioContext;
}

export function getPeaks(mediaId) {
  return peaksCache.get(mediaId) || null;
}

export function forget(mediaId) {
  if (!mediaId) return;
  peaksCache.delete(mediaId);
  inflight.delete(mediaId);
}

function emptyPeaks() {
  return new Float32Array(0);
}

async function decodeToPeaks(src, mediaId) {
  const ac = getCtx();
  if (!ac || !src) return emptyPeaks();
  let buf;
  const blob = files.get(mediaId);
  if (blob) buf = await blob.arrayBuffer();
  else {
    const res = await fetch(src);
    if (!res.ok) return emptyPeaks();
    buf = await res.arrayBuffer();
  }
  if (ac.state === 'suspended') {
    try { await ac.resume(); } catch { /* ignore */ }
  }
  const audio = await ac.decodeAudioData(buf.slice(0));
  const ch = audio.getChannelData(0);
  const out = new Float32Array(PEAKS);
  const block = Math.max(1, Math.floor(ch.length / PEAKS));
  for (let i = 0; i < PEAKS; i += 1) {
    let m = 0;
    const start = i * block;
    const end = Math.min(ch.length, start + block);
    for (let j = start; j < end; j += 12) {
      const v = Math.abs(ch[j]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

export function requestPeaks(media, force = false) {
  if (!media || !media.id) return Promise.resolve(null);
  if (!force && peaksCache.has(media.id)) return Promise.resolve(peaksCache.get(media.id));
  if (inflight.has(media.id)) return inflight.get(media.id);
  const src = media.src || media.dataUrl;
  if (!src) return Promise.resolve(null);
  if (media.type === 'video' && Number(media.duration) > SKIP_VIDEO_LONGER_THAN) {
    peaksCache.set(media.id, emptyPeaks());
    return Promise.resolve(peaksCache.get(media.id));
  }
  if (media.type !== 'audio' && media.type !== 'video') return Promise.resolve(null);
  const job = decodeToPeaks(src, media.id)
    .then((peaks) => {
      if (inflight.get(media.id) === job) peaksCache.set(media.id, peaks);
      return peaks;
    })
    .catch(() => {
      if (inflight.get(media.id) === job) peaksCache.set(media.id, emptyPeaks());
      return peaksCache.get(media.id) || emptyPeaks();
    })
    .finally(() => {
      if (inflight.get(media.id) === job) inflight.delete(media.id);
    });
  inflight.set(media.id, job);
  return job;
}

export function paintWaveform(canvas, peaks, offset, timelineDur, mediaDur, speed) {
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!peaks || !peaks.length || w < 2 || h < 2) return;
  const srcFrom = Math.max(0, offset || 0);
  const srcSpan = Math.max(0.05, (timelineDur || 0.05) * (speed || 1));
  const md = mediaDur > 0 ? mediaDur : srcFrom + srcSpan;
  const p0 = Math.max(0, Math.floor((srcFrom / md) * peaks.length));
  const p1 = Math.min(peaks.length, Math.max(p0 + 1, Math.ceil(((srcFrom + srcSpan) / md) * peaks.length)));
  const span = Math.max(1, p1 - p0);
  const mid = h / 2;
  const barW = w / span;
  ctx.fillStyle = 'rgba(242, 239, 233, 0.38)';
  for (let i = 0; i < span; i += 1) {
    const pk = peaks[p0 + i] || 0;
    const bh = Math.max(1.2, pk * (h * 0.82));
    ctx.fillRect(Math.floor(i * barW), mid - bh / 2, Math.max(1, Math.ceil(barW - 0.4)), bh);
  }
}

export function attachClipWaveform(el, clip, media, pps) {
  if (!el || !clip || !media) return;
  if (clip.type !== 'audio' && clip.type !== 'video') return;
  const canvas = document.createElement('canvas');
  canvas.className = 'clip-wave';
  canvas.width = Math.max(8, Math.floor((clip.duration || 0.2) * (pps || 48)));
  canvas.height = 32;
  el.insertBefore(canvas, el.firstChild);
  const paint = (peaks) => {
    if (!canvas.isConnected || !peaks || !peaks.length) return;
    paintWaveform(canvas, peaks, clip.offset || 0, clip.duration, media.duration || 0, clip.speed || 1);
  };
  const cached = getPeaks(media.id);
  if (cached) {
    paint(cached);
    return;
  }
  requestPeaks(media).then(paint);
}
