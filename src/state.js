const SAVE_KEY = 'cuecut.project.v1';
const MAX_UNDO = 50;

export const files = new Map();
export const elements = new Map();

const listeners = new Set();

export const CATEGORIES = [
  { id: 'media', zh: '媒体', en: 'Media', icon: '▦' },
  { id: 'audio', zh: '音频', en: 'Audio', icon: '♪' },
  { id: 'text', zh: '文字', en: 'Text', icon: 'T' },
  { id: 'captions', zh: '字幕', en: 'Captions', icon: 'CC' },
  { id: 'transitions', zh: '转场', en: 'Transitions', icon: '⇄' },
  { id: 'export', zh: '导出', en: 'Export', icon: '↓' },
];

export const TRANSITIONS = [
  { id: 'none', name: '无', en: 'None' },
  { id: 'crossfade', name: '交叉溶解', en: 'Crossfade' },
  { id: 'black', name: '闪黑', en: 'Dip to black' },
];

export const QUALITY_CRF = { draft: 28, standard: 23, high: 18 };

export const ASPECTS = [
  { id: '16:9', zh: '横屏', en: 'Landscape', w1080: 1920, h1080: 1080, w720: 1280, h720: 720 },
  { id: '9:16', zh: '竖屏', en: 'Portrait', w1080: 1080, h1080: 1920, w720: 720, h720: 1280 },
  { id: '1:1', zh: '方形', en: 'Square', w1080: 1080, h1080: 1080, w720: 720, h720: 720 },
  { id: '4:3', zh: '经典', en: 'Classic', w1080: 1440, h1080: 1080, w720: 960, h720: 720 },
  { id: '4:5', zh: '社交', en: 'Social', w1080: 1080, h1080: 1350, w720: 720, h720: 900 },
  { id: '21:9', zh: '宽幕', en: 'Ultrawide', w1080: 2560, h1080: 1080, w720: 1680, h720: 720 },
];

export function aspectPreset(id) {
  return ASPECTS.find((a) => a.id === id) || ASPECTS[0];
}

export function defaultExportSettings() {
  return {
    resolution: '1080p',
    fps: 30,
    quality: 'standard',
    includeCaptions: true,
    filename: 'cuecut.mp4',
  };
}

export function tracksTemplate() {
  return [
    { id: 'v1', type: 'video', name: 'V1', clips: [] },
    { id: 'v2', type: 'video', name: 'V2', clips: [] },
    { id: 'ov', type: 'overlay', name: '文字', clips: [] },
    { id: 'a1', type: 'audio', name: 'A1', clips: [] },
    { id: 'a2', type: 'audio', name: 'A2', clips: [] },
  ];
}

export function emptyProject() {
  return {
    version: 1,
    name: '未命名项目',
    aspect: '16:9',
    fps: 30,
    playhead: 0,
    zoom: 48,
    selectedClipId: null,
    selectedClipIds: [],
    media: [],
    tracks: tracksTemplate(),
    exportSettings: defaultExportSettings(),
    createdAt: Date.now(),
    demo: false,
  };
}

let project = emptyProject();
let undoStack = [];
let redoStack = [];
let persistTimer = 0;

export function getProject() {
  return project;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(project);
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

export function outputSize(p = project) {
  const a = aspectPreset(p && p.aspect);
  return { w: a.w1080, h: a.h1080 };
}

export function exportOutputSize(p = project) {
  const a = aspectPreset(p && p.aspect);
  const res = (p && p.exportSettings && p.exportSettings.resolution) || '1080p';
  if (res === '720p') return { w: a.w720, h: a.h720 };
  return { w: a.w1080, h: a.h1080 };
}

export function qualityToCrf(quality) {
  return QUALITY_CRF[quality] || QUALITY_CRF.standard;
}

export function projectDuration(p = project) {
  let max = 8;
  for (const t of p.tracks) {
    for (const c of t.clips) max = Math.max(max, c.start + c.duration);
  }
  return Math.max(8, max + 0.25);
}

export function findClip(id, p = project) {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

export function findMedia(id, p = project) {
  return p.media.find((m) => m.id === id) || null;
}

export function ensureProjectShape(p) {
  if (!p.tracks || !p.tracks.length) p.tracks = tracksTemplate();
  const tmpl = tracksTemplate();
  for (const t of tmpl) {
    if (!p.tracks.find((x) => x.id === t.id)) p.tracks.push({ id: t.id, type: t.type, name: t.name, clips: [] });
  }
  const order = ['v1', 'v2', 'ov', 'a1', 'a2'];
  p.tracks.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  p.exportSettings = { ...defaultExportSettings(), ...(p.exportSettings || {}) };
  if (!ASPECTS.some((a) => a.id === p.aspect)) p.aspect = '16:9';
  if (!p.fps) p.fps = p.exportSettings.fps || 30;
  for (const t of p.tracks) {
    if (!t.clips) t.clips = [];
    for (const c of t.clips) normalizeClip(c);
  }
  if (!Array.isArray(p.selectedClipIds)) {
    p.selectedClipIds = p.selectedClipId ? [p.selectedClipId] : [];
  }
  return p;
}

export function normalizeClip(c) {
  if (!c) return c;
  if (!(Number(c.speed) > 0)) c.speed = 1;
  if (c.brightness == null || Number.isNaN(Number(c.brightness))) c.brightness = 0;
  if (c.contrast == null || Number.isNaN(Number(c.contrast))) c.contrast = 1;
  if (c.saturation == null || Number.isNaN(Number(c.saturation))) c.saturation = 1;
  return c;
}

export function listTextClips(p = project) {
  const out = [];
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      if (clip.type === 'text') out.push({ clip, track });
    }
  }
  out.sort((a, b) => a.clip.start - b.clip.start);
  return out;
}

export function visualClipsOnTrack(track) {
  return (track.clips || [])
    .filter((c) => c.type === 'video' || c.type === 'image')
    .slice()
    .sort((a, b) => a.start - b.start);
}

export function nextVisualClip(clip, track) {
  const list = visualClipsOnTrack(track);
  const i = list.findIndex((c) => c.id === clip.id);
  return i >= 0 ? list[i + 1] || null : null;
}

export function prevVisualClip(clip, track) {
  const list = visualClipsOnTrack(track);
  const i = list.findIndex((c) => c.id === clip.id);
  return i > 0 ? list[i - 1] : null;
}

export function transitionLead(clip, track) {
  const prev = prevVisualClip(clip, track);
  if (!prev || !prev.transition || prev.transition.type !== 'crossfade') return 0;
  const d = prev.transition.duration || 0.5;
  return Math.min(d, prev.duration * 0.45, clip.duration * 0.45);
}

export function transitionDuration(clip, next) {
  if (!clip || !clip.transition || !clip.transition.type || clip.transition.type === 'none' || !next) return 0;
  return Math.min(clip.transition.duration || 0.5, clip.duration * 0.45, next.duration * 0.45);
}

function snapshot() {
  return JSON.stringify({
    name: project.name,
    aspect: project.aspect,
    selectedClipId: project.selectedClipId,
    selectedClipIds: project.selectedClipIds || [],
    tracks: project.tracks,
    mediaMeta: project.media.map((m) => m.id),
  });
}

function restoreSelection(raw) {
  if (Array.isArray(raw.selectedClipIds)) {
    project.selectedClipIds = raw.selectedClipIds.filter(Boolean);
  } else {
    project.selectedClipIds = raw.selectedClipId ? [raw.selectedClipId] : [];
  }
  project.selectedClipId = raw.selectedClipId || (project.selectedClipIds.length
    ? project.selectedClipIds[project.selectedClipIds.length - 1]
    : null);
  if (project.selectedClipId && !project.selectedClipIds.includes(project.selectedClipId)) {
    project.selectedClipIds.push(project.selectedClipId);
  }
}

export function selectedIdList(p = project) {
  if (Array.isArray(p.selectedClipIds) && p.selectedClipIds.length) return p.selectedClipIds.slice();
  if (p.selectedClipId) return [p.selectedClipId];
  return [];
}

export function assignSelection(p, ids) {
  const list = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push(id);
  }
  p.selectedClipIds = list;
  p.selectedClipId = list.length ? list[list.length - 1] : null;
}

export function selectedClips(p = project) {
  const out = [];
  for (const id of selectedIdList(p)) {
    const hit = findClip(id, p);
    if (hit) out.push(hit);
  }
  return out;
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

export function mutate(fn, undoable = true) {
  if (undoable) pushUndo();
  fn(project);
  persist();
  emit();
}

export function patch(fn, undoable = false) {
  if (undoable) pushUndo();
  fn(project);
  persist();
}

export function setPlayhead(t) {
  project.playhead = Math.max(0, t);
  emit();
}

export function setZoom(z) {
  project.zoom = z;
  persist();
  emit();
}

export function setSelected(id) {
  assignSelection(project, id ? [id] : []);
  emit();
}

export function setSelectedIds(ids) {
  assignSelection(project, ids);
  emit();
}

export function toggleSelected(id) {
  if (!id) return;
  const cur = selectedIdList(project);
  const i = cur.indexOf(id);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(id);
  assignSelection(project, cur);
  emit();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  const raw = JSON.parse(undoStack.pop());
  project.name = raw.name;
  project.aspect = raw.aspect;
  restoreSelection(raw);
  project.tracks = raw.tracks;
  persist();
  emit();
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  const raw = JSON.parse(redoStack.pop());
  project.name = raw.name;
  project.aspect = raw.aspect;
  restoreSelection(raw);
  project.tracks = raw.tracks;
  persist();
  emit();
}

function jsonSafeUrl(v) {
  if (typeof v !== 'string' || !v) return null;
  if (v.startsWith('blob:')) return null;
  return v;
}

export function serialize(p = project) {
  return {
    version: 1,
    name: p.name,
    aspect: p.aspect,
    fps: p.fps,
    zoom: p.zoom,
    demo: p.demo,
    createdAt: p.createdAt,
    exportSettings: { ...defaultExportSettings(), ...(p.exportSettings || {}) },
    media: p.media.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      duration: m.duration,
      width: m.width || 0,
      height: m.height || 0,
      thumbnail: jsonSafeUrl(m.thumbnail),
      dataUrl: (typeof m.dataUrl === 'string' && m.dataUrl.startsWith('data:')) ? m.dataUrl : null,
      filePath: m.filePath || null,
    })),
    tracks: p.tracks,
  };
}

export function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
    } catch (err) {
      console.warn('autosave failed', err);
    }
  }, 400);
}

export function replaceProject(next) {
  project = ensureProjectShape(next);
  undoStack = [];
  redoStack = [];
  persist();
  emit();
}

export function loadSavedRaw() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function defaultClipProps(extra = {}) {
  return {
    volume: 1,
    opacity: 1,
    x: 0.5,
    y: 0.5,
    scale: 1,
    fadeIn: 0.3,
    fadeOut: 0.3,
    offset: 0,
    muted: false,
    transition: { type: 'none', duration: 0.5 },
    speed: 1,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    ...extra,
  };
}

export const SPEED_PRESETS = [0.5, 1, 1.5, 2];

export function clipSpeed(clip) {
  const s = Number(clip && clip.speed);
  return s > 0 ? s : 1;
}

export function sourceUsed(clip) {
  return Math.max(0.05, Number(clip.duration || 0) * clipSpeed(clip));
}

export function applyClipSpeed(clip, nextSpeed, media) {
  const old = clipSpeed(clip);
  const n = Number(nextSpeed);
  const next = SPEED_PRESETS.includes(n) ? n : 1;
  if (old === next) {
    clip.speed = next;
    return clip;
  }
  let used = Math.max(0.2, Number(clip.duration || 0) * old);
  if (media && Number(media.duration) > 0) {
    const maxSrc = Math.max(0.2, media.duration - (clip.offset || 0));
    used = Math.min(used, maxSrc);
  }
  clip.speed = next;
  clip.duration = Math.max(0.2, used / next);
  return clip;
}

export function rippleRemoveClip(track, clipId) {
  const clip = (track.clips || []).find((c) => c.id === clipId);
  if (!clip) return false;
  const hole = clip.duration;
  const from = clip.start;
  track.clips = track.clips.filter((c) => c.id !== clipId);
  for (const c of track.clips) {
    if (c.start >= from - 0.0001) c.start = Math.max(0, c.start - hole);
  }
  return true;
}

export function closeTrackGaps(track) {
  if (!track || !track.clips) return;
  const clips = track.clips.slice().sort((a, b) => a.start - b.start);
  let t = 0;
  for (const c of clips) {
    if (c.start > t) c.start = t;
    t = c.start + c.duration;
  }
}

export function duplicateClipAfter(track, clip) {
  const copy = JSON.parse(JSON.stringify(clip));
  copy.id = uid('clip');
  copy.start = clip.start + clip.duration;
  track.clips.push(copy);
  return copy;
}

export const TEXT_STYLES = [
  {
    id: 'lamp',
    name: '灯牌',
    en: 'Lamp',
    desc: '居中大字，珊瑚填色',
    text: 'CUECUT',
    fontSize: 92,
    color: '#ff7a45',
    x: 0.5,
    y: 0.42,
    fontWeight: 800,
    letterSpacing: 8,
    shadow: false,
  },
  {
    id: 'note',
    name: '手记',
    en: 'Note',
    desc: '偏左随笔，暖米色',
    text: '从这一帧开始',
    fontSize: 48,
    color: '#f3e6c8',
    x: 0.32,
    y: 0.28,
    fontWeight: 500,
    letterSpacing: 1,
    shadow: true,
  },
  {
    id: 'bar',
    name: '字幕条',
    en: 'Bar',
    desc: '下部说明字幕',
    text: 'Linux 上的时间线剪辑',
    fontSize: 36,
    color: '#f2efe9',
    x: 0.5,
    y: 0.82,
    fontWeight: 600,
    letterSpacing: 1,
    shadow: true,
  },
  {
    id: 'caption',
    name: '字幕',
    en: 'Caption',
    desc: '底部白字，干净可读',
    text: '字幕',
    fontSize: 40,
    color: '#ffffff',
    x: 0.5,
    y: 0.88,
    fontWeight: 600,
    letterSpacing: 0,
    shadow: true,
  },
];

export function styleById(id) {
  return TEXT_STYLES.find((s) => s.id === id) || TEXT_STYLES[3];
}

export function checkpoint() { pushUndo(); }
