import {
  uid,
  emptyProject,
  defaultClipProps,
  TEXT_STYLES,
  files,
  elements,
  outputSize,
} from './state.js';

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintBase(ctx, w, h, c0, c1) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const orb = ctx.createRadialGradient(w * 0.72, h * 0.28, 20, w * 0.72, h * 0.28, w * 0.55);
  orb.addColorStop(0, 'rgba(255,122,69,0.45)');
  orb.addColorStop(1, 'rgba(255,122,69,0)');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,200,87,0.08)';
  for (let i = 0; i < 18; i += 1) {
    ctx.fillRect((i * w) / 18, 0, 1, h);
  }
}

function cardToMedia(canvas, name, duration) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  const id = uid('media');
  return {
    id,
    name,
    type: 'image',
    duration,
    width: canvas.width,
    height: canvas.height,
    thumbnail: dataUrl,
    dataUrl,
    src: dataUrl,
  };
}

async function hydrateImage(media) {
  const img = new Image();
  img.src = media.dataUrl;
  await img.decode().catch(() => {});
  elements.set(media.id, img);
  const blob = await (await fetch(media.dataUrl)).blob();
  files.set(media.id, blob);
}

function writeStr(view, offset, s) {
  for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
}

function makeToneWav(duration = 2.2, freq = 523.25, sampleRate = 22050) {
  const n = Math.floor(duration * sampleRate);
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.03) * Math.min(1, (duration - t) / 0.12);
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.28 * env;
    view.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function makeToneMedia(duration = 2.2) {
  const blob = makeToneWav(duration);
  const dataUrl = await blobToDataUrl(blob);
  const id = uid('media');
  const audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.src = dataUrl;
  await new Promise((resolve) => {
    audio.addEventListener('loadedmetadata', resolve, { once: true });
    audio.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 400);
  });
  files.set(id, blob);
  elements.set(id, audio);
  return {
    id,
    name: '演示音调 Tone',
    type: 'audio',
    duration: audio.duration && Number.isFinite(audio.duration) ? audio.duration : duration,
    thumbnail: null,
    dataUrl,
    src: dataUrl,
  };
}

export async function seedDemoAudioIfNeeded(project) {
  if (!project || !project.demo) return project;
  const a1 = (project.tracks || []).find((t) => t.id === 'a1');
  if (!a1) return project;
  if (a1.clips && a1.clips.length) return project;
  const hasAudioMedia = (project.media || []).some((m) => m.type === 'audio');
  if (hasAudioMedia) return project;
  const tone = await makeToneMedia(2.2);
  project.media = project.media || [];
  project.media.push(tone);
  a1.clips = a1.clips || [];
  a1.clips.push({
    id: uid('clip'),
    mediaId: tone.id,
    type: 'audio',
    start: 0.2,
    duration: Math.max(0.8, tone.duration || 2.2),
    label: tone.name,
    ...defaultClipProps({ volume: 0.7, fadeIn: 0.04, fadeOut: 0.12 }),
  });
  return project;
}

export async function buildDemoProject() {
  const project = emptyProject();
  project.name = 'Cuecut 演示';
  project.demo = true;
  const { w, h } = outputSize(project);
  const cw = project.aspect === '9:16' ? 720 : 1280;
  const ch = project.aspect === '9:16' ? 1280 : 720;

  const c1 = document.createElement('canvas');
  c1.width = cw;
  c1.height = ch;
  const x1 = c1.getContext('2d');
  paintBase(x1, cw, ch, '#1a1410', '#0e0c0b');
  x1.fillStyle = '#ff7a45';
  x1.font = `800 ${Math.round(cw * 0.09)}px "Noto Sans SC", sans-serif`;
  x1.textAlign = 'center';
  x1.fillText('Cuecut', cw / 2, ch * 0.46);
  x1.fillStyle = '#f3efe8';
  x1.font = `500 ${Math.round(cw * 0.032)}px "Noto Sans SC", sans-serif`;
  x1.fillText('时间线剪辑，从这一帧开始', cw / 2, ch * 0.56);
  x1.fillStyle = '#9a948a';
  x1.font = `400 ${Math.round(cw * 0.022)}px "Noto Sans SC", sans-serif`;
  x1.fillText('Linux-first editor prototype', cw / 2, ch * 0.63);

  const c2 = document.createElement('canvas');
  c2.width = cw;
  c2.height = ch;
  const x2 = c2.getContext('2d');
  paintBase(x2, cw, ch, '#14161c', '#0c0d10');
  x2.fillStyle = '#ffc857';
  x2.font = `700 ${Math.round(cw * 0.045)}px "Noto Sans SC", sans-serif`;
  x2.textAlign = 'center';
  x2.fillText('快捷键 Shortcuts', cw / 2, ch * 0.28);
  const lines = [
    '空格 / K  播放暂停',
    'S  在播放头分割',
    'J / L 或方向键  挪播放头',
    'Delete  删除选中片段',
    'Ctrl+Z / Ctrl+Shift+Z  撤销重做',
  ];
  x2.fillStyle = '#f3efe8';
  x2.font = `500 ${Math.round(cw * 0.028)}px "Noto Sans SC", sans-serif`;
  lines.forEach((line, i) => {
    x2.fillText(line, cw / 2, ch * 0.4 + i * (ch * 0.07));
  });
  roundedRect(x2, cw * 0.2, ch * 0.82, cw * 0.6, ch * 0.08, 12);
  x2.fillStyle = 'rgba(255,122,69,0.2)';
  x2.fill();
  x2.fillStyle = '#ff7a45';
  x2.font = `600 ${Math.round(cw * 0.024)}px "Noto Sans SC", sans-serif`;
  x2.fillText('无需自己的素材，也可直接导出这段演示', cw / 2, ch * 0.87);

  const m1 = cardToMedia(c1, '演示片头 Title card', 3);
  const m2 = cardToMedia(c2, '操作说明 Instructions', 5);
  const tone = await makeToneMedia(2.2);
  await hydrateImage(m1);
  await hydrateImage(m2);
  project.media.push(m1, m2, tone);

  const v1 = project.tracks.find((t) => t.id === 'v1');
  v1.clips.push({
    id: uid('clip'),
    mediaId: m1.id,
    type: 'image',
    start: 0,
    duration: 3,
    label: m1.name,
    ...defaultClipProps({ fadeIn: 0.25, fadeOut: 0.35, transition: { type: 'crossfade', duration: 0.5 } }),
  });
  v1.clips.push({
    id: uid('clip'),
    mediaId: m2.id,
    type: 'image',
    start: 3,
    duration: 5,
    label: m2.name,
    ...defaultClipProps({ fadeIn: 0.3, fadeOut: 0.4 }),
  });

  const a1 = project.tracks.find((t) => t.id === 'a1');
  a1.clips.push({
    id: uid('clip'),
    mediaId: tone.id,
    type: 'audio',
    start: 0.2,
    duration: Math.max(0.8, tone.duration || 2.2),
    label: tone.name,
    ...defaultClipProps({ volume: 0.7, fadeIn: 0.04, fadeOut: 0.12 }),
  });

  const style = TEXT_STYLES[2];
  const ov = project.tracks.find((t) => t.id === 'ov');
  ov.clips.push({
    id: uid('clip'),
    mediaId: null,
    type: 'text',
    start: 0.4,
    duration: 2.4,
    label: style.text,
    text: style.text,
    styleId: style.id,
    fontSize: style.fontSize,
    color: style.color,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    shadow: style.shadow,
    ...defaultClipProps({ x: style.x, y: style.y, fadeIn: 0.2, fadeOut: 0.2, volume: 0 }),
  });

  void w;
  void h;
  return project;
}
