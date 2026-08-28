const SAVE_KEY = 'cuecut.project.v1';
const MAX_UNDO = 50;

export const files = new Map();
export const elements = new Map();

const listeners = new Set();

export function tracksTemplate() {
  return [
    { id: 'v1', type: 'video', name: 'V1', clips: [] },
    { id: 'v2', type: 'video', name: 'V2', clips: [] },
    { id: 'ov', type: 'overlay', name: '文字', clips: [] },
    { id: 'a1', type: 'audio', name: 'A1', clips: [] },
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
    media: [],
    tracks: tracksTemplate(),
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
  return p.aspect === '9:16' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
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

function snapshot() {
  return JSON.stringify({
    name: project.name,
    aspect: project.aspect,
    selectedClipId: project.selectedClipId,
    tracks: project.tracks,
    mediaMeta: project.media.map((m) => m.id),
  });
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
  project.selectedClipId = id;
  emit();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  const raw = JSON.parse(undoStack.pop());
  project.name = raw.name;
  project.aspect = raw.aspect;
  project.selectedClipId = raw.selectedClipId;
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
  project.selectedClipId = raw.selectedClipId;
  project.tracks = raw.tracks;
  persist();
  emit();
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
    media: p.media.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      duration: m.duration,
      width: m.width || 0,
      height: m.height || 0,
      thumbnail: m.thumbnail || null,
      dataUrl: m.dataUrl || null,
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
  project = next;
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
    ...extra,
  };
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
];

export function checkpoint() { pushUndo(); }
