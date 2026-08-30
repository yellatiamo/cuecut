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
  const dur = Math.max(0, Number(duration) || 0;
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
