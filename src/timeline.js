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

function pps() {
  return getProject().zoom || 48;
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
  ruler.addEventListener('pointerdown', (ev) => {
    const x = ev.offsetX;
    seek(x / pps(), isPlaying());
  });

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
      el.className = `clip ${clip.type}${selected === clip.id ? ' selected' : ''}`;
      el.style.left = `${clip.start * pps()}px`;
      el.style.width = `${Math.max(8, clip.duration * pps())}px`;
      el.textContent = clip.text || clip.label || clip.type;
      el.dataset.clipId = clip.id;
      const left = document.createElement('span');
      left.className = 'edge left';
      const right = document.createElement('span');
      right.className = 'edge right';
      el.append(left, right);

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
  inner.appendChild(ph);

  scroll.appendChild(inner);
  host.append(labels, scroll);

  inner.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.clip') || ev.target.closest('.tl-ruler')) return;
    const rect = inner.getBoundingClientRect();
    const t = (ev.clientX - rect.left) / pps();
    seek(t, isPlaying());
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
    clip.start = Math.max(0, drag.origStart + dx);
  } else if (drag.mode === 'trim-right') {
    clip.duration = Math.max(0.2, drag.origDuration + dx);
    if (media && clip.type !== 'text') {
      clip.duration = Math.min(clip.duration, Math.max(0.2, srcDur - (clip.offset || 0)));
    }
  } else if (drag.mode === 'trim-left') {
    const maxLeft = drag.origDuration - 0.2;
    const delta = Math.max(-drag.origOffset, Math.min(maxLeft, dx));
    clip.start = drag.origStart + delta;
    clip.duration = drag.origDuration - delta;
    clip.offset = drag.origOffset + delta;
  }
  const el = document.querySelector('[data-clip-id="' + clip.id + '"]');
  if (el) {
    el.style.left = clip.start * pps() + 'px';
    el.style.width = Math.max(8, clip.duration * pps()) + 'px';
  }
}

function onMove(ev) {
  if (!drag) return;
  applyDrag(ev);
}

function onUp() {
  if (!drag) return;
  drag = null;
  persist();
  emit();
}

export function bindTimelineWindow() {
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  const zoom = document.getElementById('zoom');
  zoom.addEventListener('input', () => setZoom(Number(zoom.value)));
}

export { dropMediaOnTrack };
