import {
  getProject,
  setPlayhead,
  projectDuration,
  findMedia,
  outputSize,
  elements,
  visualClipsOnTrack,
  nextVisualClip,
  prevVisualClip,
  transitionDuration,
  transitionLead,
  clipSpeed,
} from './state.js';

const canvas = () => document.getElementById('preview-canvas');
const playBtn = () => document.getElementById('btn-play');
const tc = () => document.getElementById('timecode');
const dc = () => document.getElementById('duration-code');

let playing = false;
let origin = 0;
let raf = 0;
const audioEls = new Map();
const clipVideoEls = new Map();

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

export function fadeAlpha(clip, localT) {
  let a = clip.opacity ?? 1;
  const fi = clip.fadeIn || 0;
  const fo = clip.fadeOut || 0;
  if (fi > 0 && localT < fi) a *= localT / fi;
  if (fo > 0 && localT > clip.duration - fo) {
    a *= Math.max(0, (clip.duration - localT) / fo);
  }
  return Math.max(0, Math.min(1, a));
}

export function visualWindow(clip, track) {
  const lead = track ? transitionLead(clip, track) : 0;
  return { visStart: clip.start - lead, visEnd: clip.start + clip.duration };
}

export function transitionAlpha(clip, localT, t, track) {
  let a = fadeAlpha(clip, Math.max(0, localT));
  if (!track) return a;
  const next = nextVisualClip(clip, track);
  const prev = prevVisualClip(clip, track);
  const outD = transitionDuration(clip, next);
  if (outD > 0 && clip.transition) {
    const end = clip.start + clip.duration;
    const u = (t - (end - outD)) / outD;
    if (u >= 0 && u <= 1) a *= Math.max(0, 1 - u);
  }
  if (prev && prev.transition) {
    const d = transitionDuration(prev, clip);
    if (d > 0) {
      if (prev.transition.type === 'crossfade') {
        const prevEnd = prev.start + prev.duration;
        const u = (t - (prevEnd - d)) / d;
        if (u >= 0 && u <= 1) a *= Math.max(0, Math.min(1, u));
      } else if (prev.transition.type === 'black') {
        const u = (t - clip.start) / d;
        if (u >= 0 && u < 1) a *= Math.max(0, Math.min(1, u));
      }
    }
  }
  return Math.max(0, Math.min(1, a));
}

function visualElFor(clip) {
  if (!clip || clip.type === 'text') return null;
  const media = findMedia(clip.mediaId);
  if (!media) return null;
  const base = elements.get(media.id);
  if (!base) return null;
  if (clip.type === 'image' || (base.tagName && base.tagName === 'IMG')) return base;
  if (clip.type !== 'video') return base;
  let el = clipVideoEls.get(clip.id);
  if (el) return el;
  el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.src = base.src || media.src || '';
  clipVideoEls.set(clip.id, el);
  return el;
}

function pruneClipMedia(p) {
  const live = new Set();
  for (const track of p.tracks) {
    for (const clip of track.clips) live.add(clip.id);
  }
  for (const [id, el] of clipVideoEls) {
    if (!live.has(id)) {
      if (el && el.pause) el.pause();
      clipVideoEls.delete(id);
    }
  }
  for (const [id, el] of audioEls) {
    if (!live.has(id)) {
      if (el && el.pause) el.pause();
      audioEls.delete(id);
    }
  }
}

function drawTextClip(ctx, clip, w, h) {
  const size = clip.fontSize * (w / 1920);
  ctx.save();
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

function colorCssFilter(clip) {
  const b = clip.brightness == null ? 0 : Number(clip.brightness);
  const c = clip.contrast == null ? 1 : Number(clip.contrast);
  const s = clip.saturation == null ? 1 : Number(clip.saturation);
  if (Math.abs(b) < 0.001 && Math.abs(c - 1) < 0.001 && Math.abs(s - 1) < 0.001) return '';
  return `brightness(${1 + b}) contrast(${c}) saturate(${s})`;
}

function drawVisual(ctx, clip, t, w, h, track) {
  const { visStart, visEnd } = visualWindow(clip, track);
  if (t < visStart || t >= visEnd) return;
  const localT = t - clip.start;
  ctx.save();
  ctx.globalAlpha = transitionAlpha(clip, localT, t, track);
  if (clip.type === 'text') {
    drawTextClip(ctx, clip, w, h);
    ctx.restore();
    return;
  }
  const el = visualElFor(clip);
  if (!el) {
    ctx.restore();
    return;
  }
  const filt = colorCssFilter(clip);
  if (filt) ctx.filter = filt;
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

function audioElFor(clip) {
  let el = audioEls.get(clip.id);
  if (el) return el;
  const media = findMedia(clip.mediaId);
  if (!media || !media.src) return null;
  el = document.createElement('audio');
  el.preload = 'auto';
  el.src = media.src;
  audioEls.set(clip.id, el);
  return el;
}

function syncVisualClock(p, t, shouldPlay) {
  for (const track of p.tracks) {
    if (track.type === 'audio') continue;
    for (const clip of track.clips) {
      if (clip.type !== 'video') continue;
      const el = visualElFor(clip);
      if (!el || typeof el.play !== 'function') continue;
      const { visStart, visEnd } = visualWindow(clip, track);
      const active = t >= visStart && t < visEnd;
      el.muted = true;
      if (active) {
        const speed = clipSpeed(clip);
        const srcTime = (clip.offset || 0) + Math.max(0, t - clip.start) * speed;
        try { el.playbackRate = speed; } catch { /* ignore */ }
        if (Math.abs((el.currentTime || 0) - srcTime) > 0.08 * Math.max(1, speed)) {
          try { el.currentTime = Math.max(0, srcTime); } catch { /* ignore */ }
        }
        if (shouldPlay) {
          const pr = el.play();
          if (pr && pr.catch) pr.catch(() => {});
        } else if (!el.paused) {
          el.pause();
        }
      } else if (!el.paused) {
        el.pause();
      }
    }
  }
}

function syncAudio(p, t, shouldPlay) {
  const want = new Set();
  const sources = [];
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      if (t < clip.start || t >= clip.start + clip.duration) continue;
      if (clip.type === 'audio') sources.push(clip);
      else if (clip.type === 'video' && !clip.muted && (clip.volume ?? 1) > 0) sources.push(clip);
    }
  }
  for (const clip of sources) {
    const el = audioElFor(clip);
    if (!el) continue;
    want.add(clip.id);
    const speed = clipSpeed(clip);
    const srcTime = (clip.offset || 0) + (t - clip.start) * speed;
    const vol = (clip.volume ?? 1) * fadeAlpha(clip, t - clip.start);
    el.muted = false;
    el.volume = Math.max(0, Math.min(1, vol));
    try { el.playbackRate = speed; } catch { /* ignore */ }
    if (Math.abs((el.currentTime || 0) - srcTime) > 0.08 * Math.max(1, speed)) {
      try { el.currentTime = Math.max(0, srcTime); } catch { /* ignore */ }
    }
    if (shouldPlay) {
      const pr = el.play();
      if (pr && pr.catch) pr.catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }
  }
  for (const [id, el] of audioEls) {
    if (!want.has(id) && el && !el.paused) el.pause();
  }
}

function syncMedia(p, t, shouldPlay) {
  syncVisualClock(p, t, shouldPlay);
  syncAudio(p, t, shouldPlay);
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
    for (const clip of track.clips) drawVisual(ctx, clip, t, w, h, track);
  }
  const empty = document.getElementById('preview-empty');
  const has = p.tracks.some((tr) => tr.clips.length);
  if (empty) empty.classList.toggle('hidden', has);
  if (tc()) tc().textContent = formatTc(t, p.fps);
  if (dc()) dc().textContent = formatTc(projectDuration(p), p.fps);
}

function loop() {
  raf = requestAnimationFrame(loop);
  try {
    const p = getProject();
    pruneClipMedia(p);
    if (playing) {
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
  } catch (err) {
    console.warn('cuecut preview', err);
  }
}

function setPlayUi(on) {
  const btn = playBtn();
  if (!btn) return;
  btn.textContent = on ? '❚❚' : '▶';
  btn.classList.toggle('is-playing', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function play() {
  const p = getProject();
  if (p.playhead >= projectDuration(p) - 0.05) p.playhead = 0;
  playing = true;
  origin = performance.now() - p.playhead * 1000;
  syncMedia(p, p.playhead, true);
  setPlayUi(true);
}

export function pause() {
  playing = false;
  const p = getProject();
  syncMedia(p, p.playhead, false);
  setPlayUi(false);
}

export function togglePlay() {
  if (playing) pause();
  else play();
}

export function seek(t, keepPlay = false, quiet = false) {
  const p = getProject();
  const next = Math.max(0, Math.min(projectDuration(p), t));
  if (keepPlay && playing) origin = performance.now() - next * 1000;
  else if (!keepPlay) pause();
  if (quiet) p.playhead = next;
  else setPlayhead(next);
  syncMedia(p, next, keepPlay && playing);
  renderFrame(next);
  if (quiet) {
    const ph = document.querySelector('#timeline .playhead');
    if (ph) ph.style.left = (next * (p.zoom || 48)) + 'px';
  }
}

export function startPreviewLoop() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
  const c = canvas();
  if (c && !c.dataset.playToggle) {
    c.dataset.playToggle = '1';
    c.addEventListener('click', () => togglePlay());
  }
}

export { visualClipsOnTrack };
