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
    '空格  播放 / 暂停',
    'S  在播放头分割',
    'Delete  删除选中片段',
    'Ctrl+Z / Ctrl+Shift+Z  撤销重做',
    '把左侧素材拖进时间轴即可开剪',
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
  await hydrateImage(m1);
  await hydrateImage(m2);
  project.media.push(m1, m2);

  const v1 = project.tracks.find((t) => t.id === 'v1');
  v1.clips.push({
    id: uid('clip'),
    mediaId: m1.id,
    type: 'image',
    start: 0,
    duration: 3,
    label: m1.name,
    ...defaultClipProps({ fadeIn: 0.25, fadeOut: 0.35 }),
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
