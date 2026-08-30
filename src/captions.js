import {
  uid,
  mutate,
  TEXT_STYLES,
  defaultClipProps,
  getProject,
  listTextClips,
  styleById,
  assignSelection,
} from './state.js';

export function captionStyle() {
  return styleById('caption');
}

export function addTextClip(styleId, text, start, duration) {
  const style = styleById(styleId || 'caption');
  mutate((p) => {
    const ov = p.tracks.find((t) => t.id === 'ov');
    const clip = {
      id: uid('clip'),
      mediaId: null,
      type: 'text',
      start: start == null ? p.playhead : start,
      duration: duration == null ? 3 : duration,
      label: text || style.text,
      text: text || style.text,
      styleId: style.id,
      fontSize: style.fontSize,
      color: style.color,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      shadow: style.shadow,
      ...defaultClipProps({ x: style.x, y: style.y, volume: 0, fadeIn: 0.12, fadeOut: 0.12 }),
    };
    ov.clips.push(clip);
    assignSelection(p, [clip.id]);
  }, true);
}

export function addCaptionAtPlayhead(text) {
  addTextClip('caption', text || '字幕', undefined, 3);
}

function parseTs(s) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(String(s || '').trim());
  if (!m) return 0;
  const ms = Number(String(m[4]).padEnd(3, '0').slice(0, 3));
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

export function parseSrt(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines.length) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;
    if (!lines[i]) continue;
    const times = lines[i].split(/-->/);
    if (times.length < 2) continue;
    const start = parseTs(times[0]);
    const end = parseTs(times[1]);
    const body = lines.slice(i + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start, duration: Math.max(0.2, end - start), text: body });
  }
  return cues;
}

export function importSrtText(text) {
  const cues = parseSrt(text);
  if (!cues.length) return 0;
  const style = captionStyle();
  mutate((p) => {
    const ov = p.tracks.find((t) => t.id === 'ov');
    let lastId = null;
    for (const cue of cues) {
      const clip = {
        id: uid('clip'),
        mediaId: null,
        type: 'text',
        start: cue.start,
        duration: cue.duration,
        label: cue.text,
        text: cue.text,
        styleId: style.id,
        fontSize: style.fontSize,
        color: style.color,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        shadow: style.shadow,
        ...defaultClipProps({ x: style.x, y: style.y, volume: 0, fadeIn: 0, fadeOut: 0 }),
      };
      ov.clips.push(clip);
      lastId = clip.id;
    }
    if (lastId) assignSelection(p, [lastId]);
  }, true);
  return cues.length;
}

function srtTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return [h, m, r].map((n) => String(n).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0');
}

export function buildSrt(p = getProject()) {
  const clips = listTextClips(p).map((x) => x.clip);
  const lines = [];
  clips.forEach((c, i) => {
    lines.push(String(i + 1));
    lines.push(srtTime(c.start) + ' --> ' + srtTime(c.start + c.duration));
    lines.push(String(c.text || '').replace(/\n+/g, '\n'));
    lines.push('');
  });
  return lines.join('\n');
}

export function downloadSrt() {
  const data = buildSrt();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain;charset=utf-8' }));
  a.download = (getProject().name || 'cuecut') + '.srt';
  a.click();
}

export { TEXT_STYLES };
