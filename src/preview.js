import {
  getProject,
  setPlayhead,
  projectDuration,
  findMedia,
  outputSize,
  elements,
} from './state.js';

const canvas = () => document.getElementById('preview-canvas');
const playBtn = () => document.getElementById('btn-play');
const tc = () => document.getElementById('timecode');
const dc = () => document.getElementById('duration-code');

let playing = false;
let origin = 0;
let raf = 0;
const audioNodes = new Map();

export function isPlaying() {
  return playing;
}

export function formatTc(sec, fps = 30) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return [h, m, r, f].map((n) => String(n).padStart(2, '0')).join(':');
}

function fadeAlpha(clip, localT) {
  let a = clip.opacity ?? 1;
  if (clip.fadeIn > 0 && localT < clip.fadeIn) a *= localT / clip.fadeIn;
  if (clip.fadeOut > 0 && localT > clip.duration - clip.fadeOut) {
    a *= Math.max(0, (clip.duration - localT) / clip.fadeOut);
  }
  return Math.max(0, Math.min(1, a));
}

function drawTextClip(ctx, clip, w, h) {
  const size = clip.fontSize * (w / 1920);
  ctx.save();
  ctx.globalAlpha *= 1;
  ctx.font = `${clip.fontWeight || 700} ${size}px "Noto Sans SC","IBM Plex Sans",sans-serif`;
  ctx.fillStyle = clip.color || '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (clip.letterSpacing) ctx.letterSpacing = `${clip.letterSpacing * (w / 1920)}px`;
  if (clip.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
  }
  ctx.fillText(clip.text || '', clip.x * w, clip.y * h);
  ctx.restore();
}

function drawVisual(ctx, clip, t, w, h) {
  const localT = t - clip.start;
  if (localT < 0 || localT >= clip.duration) return;
  ctx.save();
  ctx.globalAlpha = fadeAlpha(clip, localT);
  if (clip.type === 'text') {
    drawTextClip(ctx, clip, w, h);
    ctx.restore();
    return;
  }
  const media = findMedia(clip.mediaId);
  const el = media ? elements.get(media.id) : null;
  if (!el) {
    ctx.restore();
    return;
  }
  const iw = el.videoWidth || el.naturalWidth || w;
  const ih = el.videoHeight || el.naturalHeight || h;
  const scale = Math.min(w / iw, h / ih) * (clip.scale || 1);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (clip.x ?? 0.5) * w - dw / 2;
  const dy = (clip.y ?? 0.5) * h - dh / 2;
  try {
    ctx.drawImage(el, dx, dy, dw, dh);
  } catch {
    /* frame not ready */
  }
  ctx.restore();
}

function activeClips(p, t, types) {
  const out = [];
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      if (types && !types.includes(clip.type)) continue;
      if (t >= clip.start && t < clip.start + clip.duration) out.push({ clip, track });
    }
  }
  return out;
}

function syncMedia(p, t, shouldPlay) {
  const active = activeClips(p, t);
  const want = new Set();
  for (const { clip } of active) {
    if (clip.type !== 'video' && clip.type !== 'audio') continue;
    const el = elements.get(clip.mediaId);
    if (!el || typeof el.play !== 'function') continue;
    want.add(clip.id);
    const srcTime = (clip.offset || 0) + (t - clip.start);
    const vol = (clip.volume ?? 1) * fadeAlpha(clip, t - clip.start);
    el.muted = false;
    el.volume = Math.max(0, Math.min(1, vol));
    if (Math.abs((el.currentTime || 0) - srcTime) > 0.35) {
      try { el.currentTime = Math.max(0, srcTime); } catch { /* ignore */ }
    }
    if (shouldPlay) {
      const pr = el.play();
      if (pr && pr.catch) pr.catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }
    audioNodes.set(clip.id, el);
  }
  for (const [id, el] of audioNodes) {
    if (!want.has(id) && el && !el.paused) el.pause();
  }
}

export function renderFrame(t = getProject().playhead) {
  const p = getProject();
  const c = canvas();
  if (!c) return;
  const { w: ow, h: oh } = outputSize(p);
  const maxW = p.aspect === '9:16' ? 540 : 960;
  const maxH = p.aspect === '9:16' ? 960 : 540;
  const scale = Math.min(maxW / ow, maxH / oh);
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const order = ['v1', 'v2', 'ov'];
  for (const id of order) {
    const track = p.tracks.find((tr) => tr.id === id);
    if (!track) continue;
    for (const clip of track.clips) drawVisual(ctx, clip, t, w, h);
  }
  const empty = document.getElementById('preview-empty');
  const has = p.tracks.some((tr) => tr.clips.length);
  empty.classList.toggle('hidden', has);
  tc().textContent = formatTc(t, p.fps);
  dc().textContent = formatTc(projectDuration(p), p.fps);
}

function loop() {
  if (playing) {
    const p = getProject();
    const t = (performance.now() - origin) / 1000;
    const dur = projectDuration(p);
    if (t >= dur) {
      setPlayhead(dur);
      pause();
      renderFrame(dur);
      return;
    }
    p.playhead = t;
    syncMedia(p, t, true);
    renderFrame(t);
    const ph = document.querySelector('#timeline .playhead');
    if (ph) ph.style.left = (t * (p.zoom || 48)) + 'px';
  } else {
    renderFrame();
  }
  raf = requestAnimationFrame(loop);
}

export function play() {
  const p = getProject();
  if (p.playhead >= projectDuration(p) - 0.05) p.playhead = 0;
  playing = true;
  origin = performance.now() - p.playhead * 1000;
  syncMedia(p, p.playhead, true);
  playBtn().textContent = '⏸';
}

export function pause() {
  playing = false;
  const p = getProject();
  syncMedia(p, p.playhead, false);
  playBtn().textContent = '▶';
}

export function togglePlay() {
  if (playing) pause();
  else play();
}

export function seek(t, keepPlay = false) {
  const p = getProject();
  const next = Math.max(0, Math.min(projectDuration(p), t));
  setPlayhead(next);
  if (keepPlay && playing) origin = performance.now() - next * 1000;
  else if (!keepPlay) pause();
  syncMedia(p, next, keepPlay && playing);
  renderFrame(next);
}

export function startPreviewLoop() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}
