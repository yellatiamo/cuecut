import {
  getProject,
  mutate,
  setSelected,
  setZoom,
  projectDuration,
  findClip,
  findMedia,
  uid,
  defaultClipProps,
  checkpoint,
  persist,
  emit,
} from './state.js';
import { seek, isPlaying } from './preview.js';

let drag = null;
let scrubbing = false;
const TLH_KEY = 'cuecut.layout.tlh';

function pps() {
  return getProject().zoom || 48;
}

function snapWindow() {
  return Math.max(6 / pps(), 0.1);
}

function edgeTimes(excludeId) {
  const p = getProject();
  const times = [p.playhead];
  for (const track of p.tracks) {
    for (const c of track.clips) {
      if (c.id === excludeId) continue;
      times.push(c.start, c.start + c.duration);
    }
  }
  return times;
}

function snapTime(t, excludeId) {
  const thresh = snapWindow();
  let best = t;
  let bestD = thresh;
  for (const s of edgeTimes(excludeId)) {
    const d = Math.abs(s - t);
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return Math.max(0, best);
}

function snapMove(start, duration, excludeId) {
  const rawEnd = start + duration;
  const s = snapTime(start, excludeId);
  const e = snapTime(rawEnd, excludeId);
  const ds = Math.abs(s - start);
  const de = Math.abs(e - rawEnd);
  if (ds <= de) return Math.max(0, s);
  return Math.max(0, e - duration);
}

function fmtClipDur(sec) {
  const t = Math.max(0, sec);
  if (t < 60) return t.toFixed(1) + 's';
  const m = Math.floor(t / 60);
  const r = t % 60;
  return m + ':' + r.toFixed(1).padStart(4, '0');
}

function timeFromEvent(ev, inner, scroll) {
  const rect = inner.getBoundingClientRect();
  return (ev.clientX - rect.left + (scroll ? scroll.scrollLeft : 0)) / pps();
}

export function splitAtPlayhead() {
  const p = getProject();
  const t = p.playhead;
  mutate((proj) => {
    for (const track of proj.tracks) {
      const hits = track.clips.filter((c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05);
      for (const clip of hits) {
        const leftDur = t - clip.start;
        const rightDur = clip.duration - leftDur;
        const right = {
          ...JSON.parse(JSON.stringify(clip)),
          id: uid('clip'),
          start: t,
          duration: rightDur,
          offset: (clip.offset || 0) + leftDur,
        };
        clip.duration = leftDur;
        track.clips.push(right);
      }
    }
  }, true);
}

export function deleteSelected() {
  const p = getProject();
  if (!p.selectedClipId) return;
  mutate((proj) => {
    for (const track of proj.tracks) {
      track.clips = track.clips.filter((c) => c.id !== proj.selectedClipId);
    }
    proj.selectedClipId = null;
  }, true);
}

function dropMediaOnTrack(mediaId, trackId, start) {
  const media = findMedia(mediaId);
  if (!media || media.needsRelink) return;
  const track = getProject().tracks.find((t) => t.id === trackId);
  if (!track) return;
  const type = media.type;
  if (track.type === 'audio' && type !== 'audio' && type !== 'video') return;
  if (track.type !== 'audio' && type === 'audio') return;
  const clipType = track.type === 'audio' ? 'audio' : type;
  const duration = Math.max(0.4, media.duration || 3);
  mutate((p) => {
    const tr = p.tracks.find((t) => t.id === trackId);
    tr.clips.push({
      id: uid('clip'),
      mediaId: media.id,
      type: clipType,
      start: Math.max(0, start),
      duration,
      label: media.name,
      ...defaultClipProps({ volume: clipType === 'audio' || type === 'video' ? 1 : 0 }),
    });
  }, true);
}

function beginDrag(ev, clip, mode) {
  ev.preventDefault();
  ev.stopPropagation();
  checkpoint();
  getProject().selectedClipId = clip.id;
  emit();
  drag = {
    mode,
    clipId: clip.id,
    startX: ev.clientX,
    origStart: clip.start,
    origDuration: clip.duration,
    origOffset: clip.offset || 0,
  };
}

export function renderTimeline() {
  const p = getProject();
  const host = document.getElementById('timeline');
  if (!host) return;
  const prevScroll = host.querySelector('.tl-scroll');
  const sl = prevScroll ? prevScroll.scrollLeft : 0;
  const st = prevScroll ? prevScroll.scrollTop : 0;
  const dur = projectDuration(p);
  const width = Math.max(host.clientWidth - 72, dur * pps());
  const selected = p.selectedClipId;

  host.innerHTML = '';
  const labels = document.createElement('div');
  labels.className = 'tl-labels';
  labels.innerHTML = `<div class="tl-label ruler"></div>` + p.tracks.map((t) =>
    `<div class="tl-label">${t.name}</div>`
  ).join('');

  const scroll = document.createElement('div');
  scroll.className = 'tl-scroll';
  const inner = document.createElement('div');
  inner.className = 'tl-inner';
  inner.style.width = `${width}px`;

  const ruler = document.createElement('div');
  ruler.className = 'tl-ruler';
  ruler.style.width = `${width}px`;
  const step = pps() >= 80 ? 0.5 : pps() >= 40 ? 1 : 2;
  for (let t = 0; t <= dur + 0.01; t += step) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = `${t * pps()}px`;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    tick.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    ruler.appendChild(tick);
  }
  const startScrub = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    scrubbing = true;
    seek(timeFromEvent(ev, inner, scroll), isPlaying(), true);
  };
  ruler.addEventListener('pointerdown', startScrub);

  inner.appendChild(ruler);

  for (const track of p.tracks) {
    const row = document.createElement('div');
    row.className = 'tl-track';
    row.style.width = `${width}px`;
    row.dataset.trackId = track.id;
    row.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer.getData('text/cuecut-media');
      if (!id) return;
      const rect = row.getBoundingClientRect();
      const start = (ev.clientX - rect.left + scroll.scrollLeft) / pps();
      dropMediaOnTrack(id, track.id, start);
    });

    for (const clip of track.clips) {
      const el = document.createElement('div');
      const hasTrans = clip.transition && clip.transition.type && clip.transition.type !== 'none';
      el.className = `clip ${clip.type}${selected === clip.id ? ' selected' : ''}${hasTrans ? ' has-trans' : ''}${clip.muted ? ' is-muted' : ''}`;
      el.style.left = `${clip.start * pps()}px`;
      el.style.width = `${Math.max(16, clip.duration * pps())}px`;
      el.dataset.clipId = clip.id;
      const name = document.createElement('span');
      name.className = 'clip-name';
      name.textContent = clip.text || clip.label || clip.type;
      const durEl = document.createElement('span');
      durEl.className = 'clip-dur';
      durEl.textContent = fmtClipDur(clip.duration);
      const left = document.createElement('span');
      left.className = 'edge left';
      const right = document.createElement('span');
      right.className = 'edge right';
      el.append(name, durEl, left, right);

      el.addEventListener('pointerdown', (ev) => {
        if (ev.target.classList.contains('edge')) return;
        beginDrag(ev, clip, 'move');
      });
      left.addEventListener('pointerdown', (ev) => beginDrag(ev, clip, 'trim-left'));
      right.addEventListener('pointerdown', (ev) => beginDrag(ev, clip, 'trim-right'));
      row.appendChild(el);
    }
    inner.appendChild(row);
  }

  const ph = document.createElement('div');
  ph.className = 'playhead';
  ph.style.left = `${p.playhead * pps()}px`;
  ph.title = '拖动播放头';
  ph.addEventListener('pointerdown', startScrub);
  inner.appendChild(ph);

  scroll.appendChild(inner);
  host.append(labels, scroll);
  scroll.scrollLeft = sl;
  scroll.scrollTop = st;

  inner.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.clip') || ev.target.closest('.tl-ruler') || ev.target.closest('.playhead')) return;
    scrubbing = true;
    seek(timeFromEvent(ev, inner, scroll), isPlaying(), true);
    setSelected(null);
  });
}

function applyDrag(ev) {
  const found = findClip(drag.clipId);
  if (!found) return;
  const dx = (ev.clientX - drag.startX) / pps();
  const clip = found.clip;
  const media = clip.mediaId ? findMedia(clip.mediaId) : null;
  const srcDur = media ? media.duration : 10000;
  if (drag.mode === 'move') {
    const raw = Math.max(0, drag.origStart + dx);
    clip.start = snapMove(raw, clip.duration, clip.id);
  } else if (drag.mode === 'trim-right') {
    let dur = Math.max(0.2, drag.origDuration + dx);
    if (media && clip.type !== 'text') {
      dur = Math.min(dur, Math.max(0.2, srcDur - (clip.offset || 0)));
    }
    const end = snapTime(drag.origStart + dur, clip.id);
    clip.duration = Math.max(0.2, end - clip.start);
    if (media && clip.type !== 'text') {
      clip.duration = Math.min(clip.duration, Math.max(0.2, srcDur - (clip.offset || 0)));
    }
  } else if (drag.mode === 'trim-left') {
    const maxLeft = drag.origDuration - 0.2;
    let delta = Math.max(-drag.origOffset, Math.min(maxLeft, dx));
    let newStart = snapTime(drag.origStart + delta, clip.id);
    delta = newStart - drag.origStart;
    delta = Math.max(-drag.origOffset, Math.min(maxLeft, delta));
    clip.start = drag.origStart + delta;
    clip.duration = drag.origDuration - delta;
    clip.offset = drag.origOffset + delta;
  }
  const el = document.querySelector('[data-clip-id="' + clip.id + '"]');
  if (el) {
    el.style.left = clip.start * pps() + 'px';
    el.style.width = Math.max(16, clip.duration * pps()) + 'px';
    const durEl = el.querySelector('.clip-dur');
    if (durEl) durEl.textContent = fmtClipDur(clip.duration);
  }
}

function onMove(ev) {
  if (scrubbing) {
    const inner = document.querySelector('.tl-inner');
    const scroll = document.querySelector('.tl-scroll');
    if (!inner) return;
    seek(timeFromEvent(ev, inner, scroll), isPlaying(), true);
    return;
  }
  if (!drag) return;
  applyDrag(ev);
}

function onUp() {
  if (scrubbing) {
    scrubbing = false;
    emit();
    return;
  }
  if (!drag) return;
  drag = null;
  persist();
  emit();
}

function bindTimelineResize() {
  const app = document.getElementById('app');
  const handle = document.getElementById('tl-resize');
  if (!app || !handle || handle.dataset.bound) return;
  handle.dataset.bound = '1';
  try {
    const saved = localStorage.getItem(TLH_KEY);
    if (saved) app.style.setProperty('--tl-h', saved);
  } catch { /* ignore */ }

  let resizing = false;
  handle.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    resizing = true;
    handle.setPointerCapture(ev.pointerId);
  });
  handle.addEventListener('pointermove', (ev) => {
    if (!resizing) return;
    const rect = app.getBoundingClientRect();
    const h = Math.round(Math.max(180, Math.min(rect.height - 200, rect.bottom - ev.clientY)));
    app.style.setProperty('--tl-h', h + 'px');
  });
  handle.addEventListener('pointerup', () => {
    if (!resizing) return;
    resizing = false;
    try {
      localStorage.setItem(TLH_KEY, getComputedStyle(app).getPropertyValue('--tl-h').trim() || app.style.getPropertyValue('--tl-h').trim());
    } catch { /* ignore */ }
    renderTimeline();
  });
}

export function bindTimelineWindow() {
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  const zoom = document.getElementById('zoom');
  zoom.addEventListener('input', () => setZoom(Number(zoom.value)));
  bindTimelineResize();
}

export { dropMediaOnTrack };
