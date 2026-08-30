import {
  getProject,
  mutate,
  setSelected,
  setSelectedIds,
  toggleSelected,
  assignSelection,
  selectedIdList,
  setZoom,
  projectDuration,
  findClip,
  findMedia,
  uid,
  defaultClipProps,
  checkpoint,
  persist,
  emit,
  clipSpeed,
  rippleRemoveClip,
  closeTrackGaps,
  duplicateClipAfter,
} from './state.js';
import { seek, isPlaying } from './preview.js';
import { attachClipWaveform } from './waveform.js';
import { attachClipFilmstrip, resizeClipFilmstrip } from './filmstrip.js';
import { importFiles } from './media.js';

let drag = null;
let scrubbing = false;
let marquee = null;
const TLH_KEY = 'cuecut.layout.tlh';
const MARQUEE_CLICK_PX = 4;

function pps() {
  return getProject().zoom || 48;
}

function snapWindow() {
  return Math.max(6 / pps(), 0.1);
}

function excludeSet(excludeId) {
  if (!excludeId) return new Set();
  if (excludeId instanceof Set) return excludeId;
  if (Array.isArray(excludeId)) return new Set(excludeId);
  return new Set([excludeId]);
}

function edgeTimes(excludeId) {
  const p = getProject();
  const skip = excludeSet(excludeId);
  const times = [p.playhead];
  for (const track of p.tracks) {
    for (const c of track.clips) {
      if (skip.has(c.id)) continue;
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

function pointInInner(ev, inner) {
  const rect = inner.getBoundingClientRect();
  return {
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top,
  };
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function playheadHits(clip, t) {
  return t > clip.start + 0.05 && t < clip.start + clip.duration - 0.05;
}

export function splitAtPlayhead() {
  const p = getProject();
  const t = p.playhead;
  const selected = selectedIdList(p);
  const only = selected.length ? new Set(selected) : null;
  const hits = [];
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      if (only && !only.has(clip.id)) continue;
      if (playheadHits(clip, t)) hits.push(clip.id);
    }
  }
  if (!hits.length) return;
  mutate((proj) => {
    const rightIds = [];
    for (const id of hits) {
      const found = findClip(id, proj);
      if (!found) continue;
      const clip = found.clip;
      if (!playheadHits(clip, t)) continue;
      const leftDur = t - clip.start;
      const rightDur = clip.duration - leftDur;
      const speed = clipSpeed(clip);
      const right = {
        ...JSON.parse(JSON.stringify(clip)),
        id: uid('clip'),
        start: t,
        duration: rightDur,
        offset: (clip.offset || 0) + leftDur * speed,
      };
      clip.duration = leftDur;
      found.track.clips.push(right);
      rightIds.push(right.id);
    }
    if (rightIds.length) assignSelection(proj, rightIds);
  }, true);
}

export function deleteSelected() {
  const ids = selectedIdList();
  if (!ids.length) return;
  const set = new Set(ids);
  mutate((proj) => {
    for (const track of proj.tracks) {
      track.clips = track.clips.filter((c) => !set.has(c.id));
    }
    assignSelection(proj, []);
  }, true);
}

export function deleteSelectedRipple() {
  const ids = selectedIdList();
  if (!ids.length) return;
  const set = new Set(ids);
  mutate((proj) => {
    for (const track of proj.tracks) {
      const hits = track.clips.filter((c) => set.has(c.id)).sort((a, b) => b.start - a.start);
      for (const c of hits) rippleRemoveClip(track, c.id);
    }
    assignSelection(proj, []);
  }, true);
}

export function closeGapsOnSelectedTrack() {
  const p = getProject();
  const hit = p.selectedClipId ? findClip(p.selectedClipId, p) : null;
  mutate((proj) => {
    if (hit) {
      const tr = proj.tracks.find((t) => t.id === hit.track.id);
      if (tr) closeTrackGaps(tr);
      return;
    }
    for (const track of proj.tracks) closeTrackGaps(track);
  }, true);
}

export function duplicateSelected() {
  const ids = selectedIdList();
  if (!ids.length) return;
  mutate((proj) => {
    const newIds = [];
    for (const id of ids) {
      const hit = findClip(id, proj);
      if (!hit) continue;
      const copy = duplicateClipAfter(hit.track, hit.clip);
      newIds.push(copy.id);
    }
    assignSelection(proj, newIds);
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
  const p = getProject();
  let ids;
  if (mode === 'move') {
    ids = selectedIdList(p);
    if (!ids.includes(clip.id)) {
      assignSelection(p, [clip.id]);
      ids = [clip.id];
    }
  } else {
    ids = [clip.id];
  }
  emit();
  const origStarts = {};
  for (const id of ids) {
    const hit = findClip(id);
    if (hit) origStarts[id] = hit.clip.start;
  }
  const startVals = Object.values(origStarts);
  drag = {
    mode,
    clipId: clip.id,
    startX: ev.clientX,
    origStart: clip.start,
    origDuration: clip.duration,
    origOffset: clip.offset || 0,
    ids,
    origStarts,
    minOrigStart: startVals.length ? Math.min(...startVals) : clip.start,
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
  const selectedIds = new Set(selectedIdList(p));

  host.innerHTML = '';
  const labels = document.createElement('div');
  labels.className = 'tl-labels';
  labels.innerHTML = `<div class="tl-label ruler"></div>` + p.tracks.map((t) =>
    `<div class="tl-label" data-track-type="${t.type}">${t.name}</div>`
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
    row.dataset.trackType = track.type;
    row.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    row.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      const rect = row.getBoundingClientRect();
      const start = (ev.clientX - rect.left + scroll.scrollLeft) / pps();
      const id = ev.dataTransfer.getData('text/cuecut-media');
      if (id) {
        dropMediaOnTrack(id, track.id, start);
        return;
      }
      const list = ev.dataTransfer.files;
      if (list && list.length) {
        const added = await importFiles(list);
        let t = start;
        for (const m of added || []) {
          dropMediaOnTrack(m.id, track.id, t);
          t += Math.max(0.4, m.duration || 3);
        }
      }
    });

    for (const clip of track.clips) {
      const el = document.createElement('div');
      const hasTrans = clip.transition && clip.transition.type && clip.transition.type !== 'none';
      el.className = `clip ${clip.type}${selectedIds.has(clip.id) ? ' selected' : ''}${hasTrans ? ' has-trans' : ''}${clip.muted ? ' is-muted' : ''}`;
      el.style.left = `${clip.start * pps()}px`;
      el.style.width = `${Math.max(16, clip.duration * pps())}px`;
      el.dataset.clipId = clip.id;
      const name = document.createElement('span');
      name.className = 'clip-name';
      name.textContent = clip.text || clip.label || clip.type;
      const durEl = document.createElement('span');
      durEl.className = 'clip-dur';
      const sp = clipSpeed(clip);
      durEl.textContent = fmtClipDur(clip.duration) + (sp !== 1 ? ' · ' + sp + '×' : '');
      const left = document.createElement('span');
      left.className = 'edge left';
      const right = document.createElement('span');
      right.className = 'edge right';
      el.append(name, durEl, left, right);
      if (clip.mediaId && (clip.type === 'video' || clip.type === 'image')) {
        const media = findMedia(clip.mediaId);
        if (media) attachClipFilmstrip(el, clip, media, pps());
      } else if (clip.mediaId && clip.type === 'audio') {
        const media = findMedia(clip.mediaId);
        if (media && (media.src || media.dataUrl)) attachClipWaveform(el, clip, media, pps());
      }

      el.addEventListener('pointerdown', (ev) => {
        if (ev.target.classList.contains('edge')) return;
        if (ev.ctrlKey || ev.shiftKey) {
          ev.preventDefault();
          ev.stopPropagation();
          toggleSelected(clip.id);
          return;
        }
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
    ev.preventDefault();
    const pt = pointInInner(ev, inner);
    marquee = {
      startX: pt.x,
      startY: pt.y,
      clientX: ev.clientX,
      clientY: ev.clientY,
      inner,
      scroll,
      el: null,
      moved: false,
    };
  });
}

function updateMarqueeEl(m, ev) {
  const pt = pointInInner(ev, m.inner);
  const x1 = Math.min(m.startX, pt.x);
  const y1 = Math.min(m.startY, pt.y);
  const x2 = Math.max(m.startX, pt.x);
  const y2 = Math.max(m.startY, pt.y);
  if (!m.el) {
    m.el = document.createElement('div');
    m.el.className = 'tl-marquee';
    m.inner.appendChild(m.el);
  }
  m.el.style.left = x1 + 'px';
  m.el.style.top = y1 + 'px';
  m.el.style.width = (x2 - x1) + 'px';
  m.el.style.height = (y2 - y1) + 'px';
}

function finishMarquee(ev) {
  const m = marquee;
  marquee = null;
  if (!m) return;
  const dx = ev ? ev.clientX - m.clientX : 0;
  const dy = ev ? ev.clientY - m.clientY : 0;
  const dist = Math.hypot(dx, dy);
  if (m.el) m.el.remove();
  if (!m.moved || dist < MARQUEE_CLICK_PX) {
    seek(timeFromEvent(ev || { clientX: m.clientX }, m.inner, m.scroll), isPlaying(), true);
    setSelected(null);
    return;
  }
  const box = {
    left: Math.min(m.clientX, ev.clientX),
    right: Math.max(m.clientX, ev.clientX),
    top: Math.min(m.clientY, ev.clientY),
    bottom: Math.max(m.clientY, ev.clientY),
  };
  const ids = [];
  m.inner.querySelectorAll('.clip').forEach((el) => {
    if (rectsOverlap(box, el.getBoundingClientRect())) ids.push(el.dataset.clipId);
  });
  setSelectedIds(ids);
}

function applyDrag(ev) {
  const found = findClip(drag.clipId);
  if (!found) return;
  const dx = (ev.clientX - drag.startX) / pps();
  const clip = found.clip;
  const media = clip.mediaId ? findMedia(clip.mediaId) : null;
  const srcDur = media ? media.duration : 10000;
  const speed = clipSpeed(clip);
  const maxTl = (media && clip.type !== 'text')
    ? Math.max(0.2, (srcDur - (clip.offset || 0)) / speed)
    : 10000;
  if (drag.mode === 'move') {
    const movingIds = drag.ids && drag.ids.length ? drag.ids : [clip.id];
    let dt = dx;
    if (drag.minOrigStart + dt < 0) dt = -drag.minOrigStart;
    const snapped = snapMove(drag.origStart + dt, clip.duration, movingIds);
    dt = snapped - drag.origStart;
    if (drag.minOrigStart + dt < 0) dt = -drag.minOrigStart;
    for (const id of movingIds) {
      const hit = findClip(id);
      if (!hit) continue;
      const orig = drag.origStarts[id];
      if (orig == null) continue;
      hit.clip.start = orig + dt;
      const el = document.querySelector('[data-clip-id="' + id + '"]');
      if (el) el.style.left = hit.clip.start * pps() + 'px';
    }
    return;
  } else if (drag.mode === 'trim-right') {
    let dur = Math.max(0.2, drag.origDuration + dx);
    if (media && clip.type !== 'text') dur = Math.min(dur, maxTl);
    const end = snapTime(drag.origStart + dur, clip.id);
    clip.duration = Math.max(0.2, end - clip.start);
    if (media && clip.type !== 'text') {
      clip.duration = Math.min(clip.duration, Math.max(0.2, (srcDur - (clip.offset || 0)) / speed));
    }
  } else if (drag.mode === 'trim-left') {
    const maxLeft = drag.origDuration - 0.2;
    const minDelta = clip.type === 'text' ? -10000 : -(drag.origOffset / speed);
    let delta = Math.max(minDelta, Math.min(maxLeft, dx));
    let newStart = snapTime(drag.origStart + delta, clip.id);
    delta = newStart - drag.origStart;
    delta = Math.max(minDelta, Math.min(maxLeft, delta));
    clip.start = drag.origStart + delta;
    clip.duration = drag.origDuration - delta;
    clip.offset = drag.origOffset + delta * speed;
  }
  const el = document.querySelector('[data-clip-id="' + clip.id + '"]');
  if (el) {
    el.style.left = clip.start * pps() + 'px';
    el.style.width = Math.max(16, clip.duration * pps()) + 'px';
    const durEl = el.querySelector('.clip-dur');
    if (durEl) durEl.textContent = fmtClipDur(clip.duration) + (speed !== 1 ? ' · ' + speed + '×' : '');
    if (el.querySelector('.clip-strip')) {
      resizeClipFilmstrip(el, clip, media, pps());
    }
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
  if (marquee) {
    const dx = ev.clientX - marquee.clientX;
    const dy = ev.clientY - marquee.clientY;
    if (!marquee.moved && Math.hypot(dx, dy) < MARQUEE_CLICK_PX) return;
    marquee.moved = true;
    updateMarqueeEl(marquee, ev);
    return;
  }
  if (!drag) return;
  applyDrag(ev);
}

function onUp(ev) {
  if (scrubbing) {
    scrubbing = false;
    emit();
    return;
  }
  if (marquee) {
    finishMarquee(ev);
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
