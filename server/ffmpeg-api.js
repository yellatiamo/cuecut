'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { randomBytes } = require('crypto');

const jobs = new Map();

function whichTool(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function findFont() {
  const list = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
  ];
  return list.find((p) => fs.existsSync(p)) || '';
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseForm(buf, ctype) {
  const fields = {};
  const files = {};
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || '');
  if (!bm) return { fields, files };
  const boundary = Buffer.from('--' + (bm[1] || bm[2]).trim());
  let i = buf.indexOf(boundary);
  while (i !== -1) {
    const next = buf.indexOf(boundary, i + boundary.length);
    if (next === -1) break;
    let part = buf.slice(i + boundary.length, next);
    if (part[0] === 13 && part[1] === 10) part = part.slice(2);
    if (part.length >= 2 && part[part.length - 2] === 13) part = part.slice(0, -2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) { i = next; continue; }
    const header = part.slice(0, sep).toString('utf8');
    const body = part.slice(sep + 4);
    const nameM = /name="([^"]+)"/.exec(header);
    const fileM = /filename="([^"]*)"/.exec(header);
    if (nameM) {
      const name = nameM[1];
      if (fileM && fileM[1]) files[name] = { filename: fileM[1], data: body };
      else fields[name] = body.toString('utf8');
    }
    i = next;
  }
  return { fields, files };
}

function escapeDrawtext(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/\n/g, ' ');
}

function writeDataUrl(dataUrl, dest) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('invalid data url');
  fs.writeFileSync(dest, Buffer.from(m[2], 'base64'));
}

function hasAudioStream(ffprobe, file) {
  return new Promise((resolve) => {
    if (!ffprobe) return resolve(false);
    execFile(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], (err, stdout) => {
      resolve(!err && String(stdout || '').trim().length > 0);
    });
  });
}

function visualOnTrack(track) {
  return (track.clips || []).filter((c) => c.type === 'video' || c.type === 'image').slice().sort((a, b) => a.start - b.start);
}

function nextVisual(clip, track) {
  const list = visualOnTrack(track);
  const i = list.findIndex((c) => c.id === clip.id);
  return i >= 0 ? list[i + 1] || null : null;
}

function prevVisual(clip, track) {
  const list = visualOnTrack(track);
  const i = list.findIndex((c) => c.id === clip.id);
  return i > 0 ? list[i - 1] : null;
}

function transDur(clip, next) {
  if (!clip || !clip.transition || !clip.transition.type || clip.transition.type === 'none' || !next) return 0;
  const d = Number(clip.transition.duration) || 0.5;
  return Math.min(d, clip.duration * 0.45, next.duration * 0.45);
}

function incomingLead(clip, track) {
  const prev = prevVisual(clip, track);
  if (!prev || !prev.transition || prev.transition.type !== 'crossfade') return 0;
  return transDur(prev, clip);
}

function collectClips(project) {
  const visual = [];
  const texts = [];
  const audios = [];
  const tracks = project.tracks || [];
  const order = ['v1', 'v2', 'ov', 'a1', 'a2'];
  const ordered = [];
  for (const id of order) {
    const t = tracks.find((x) => x.id === id);
    if (t) ordered.push(t);
  }
  for (const t of tracks) {
    if (!ordered.includes(t)) ordered.push(t);
  }
  const includeCaptions = project.includeCaptions !== false;
  for (const track of ordered) {
    for (const clip of track.clips || []) {
      if (clip.type === 'text') {
        if (includeCaptions) texts.push({ clip, track });
      } else if (track.type === 'audio' || clip.type === 'audio') {
        audios.push({ clip, track });
      } else {
        visual.push({ clip, track });
      }
    }
  }
  return { visual, texts, audios };
}

async function prepareMedia(project, fields, files, dir) {
  const paths = {};
  for (const m of project.media || []) {
    const data = fields['data_' + m.id];
    const uploaded = files['file_' + m.id];
    const given = fields['path_' + m.id];
    let dest = path.join(dir, m.id);
    if (data) {
      const mime = (data.match(/^data:([^;]+)/) || [])[1] || '';
      let ext = '.bin';
      if (mime.indexOf('png') >= 0) ext = '.png';
      else if (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) ext = '.jpg';
      else if (mime.indexOf('webp') >= 0) ext = '.webp';
      else if (m.type === 'image') ext = '.jpg';
      dest += ext;
      writeDataUrl(data, dest);
      paths[m.id] = dest;
    } else if (uploaded) {
      const ext = path.extname(uploaded.filename || '') || (m.type === 'image' ? '.jpg' : '.mp4');
      dest += ext;
      fs.writeFileSync(dest, uploaded.data);
      paths[m.id] = dest;
    } else if (given && fs.existsSync(given)) {
      paths[m.id] = given;
    }
  }
  return paths;
}

async function buildCommand(project, mediaPaths, outFile) {
  const ffmpeg = whichTool('ffmpeg');
  const ffprobe = whichTool('ffprobe');
  const font = findFont();
  const W = Number(project.width) || (project.aspect === '9:16' ? 1080 : 1920);
  const H = Number(project.height) || (project.aspect === '9:16' ? 1920 : 1080);
  const fps = Number(project.fps) || 30;
  const duration = Math.max(1, Number(project.duration) || 8);
  const quality = project.quality || 'standard';
  const crf = project.crf != null ? Number(project.crf) : (quality === 'draft' ? 28 : quality === 'high' ? 18 : 23);
  const preset = quality === 'draft' ? 'veryfast' : 'medium';
  const { visual, texts, audios } = collectClips(project);
  const args = ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats'];
  args.push('-f', 'lavfi', '-i', 'color=c=0x121214:s=' + W + 'x' + H + ':d=' + duration + ':r=' + fps);
  const vMeta = [];
  for (const item of visual) {
    const clip = item.clip;
    const src = mediaPaths[clip.mediaId];
    if (!src) continue;
    const media = (project.media || []).find((m) => m.id === clip.mediaId) || {};
    const lead = incomingLead(clip, item.track);
    const take = Number(clip.duration) + lead;
    if (media.type === 'image' || clip.type === 'image') {
      args.push('-loop', '1', '-framerate', String(fps), '-t', String(take), '-i', src);
    } else {
      args.push('-ss', String(clip.offset || 0), '-t', String(take), '-i', src);
    }
    vMeta.push({ clip, track: item.track, idx: vMeta.length + 1, src, media, lead });
  }
  const aMeta = [];
  for (const item of audios) {
    const clip = item.clip;
    const src = mediaPaths[clip.mediaId];
    if (!src) continue;
    args.push('-ss', String(clip.offset || 0), '-t', String(clip.duration), '-i', src);
    aMeta.push({ clip, idx: vMeta.length + aMeta.length + 1, src });
  }
  for (const vm of vMeta) {
    if (vm.media.type === 'video') {
      vm.hasAudio = await hasAudioStream(ffprobe, vm.src);
    }
  }
  const filters = [];
  let last = '0:v';
  let tmp = 0;
  for (const vm of vMeta) {
    const clip = vm.clip;
    const lab = 'c' + vm.idx;
    const scaleW = Math.max(2, Math.round(W * (clip.scale || 1)));
    const scaleH = Math.max(2, Math.round(H * (clip.scale || 1)));
    const parts = ['[' + vm.idx + ':v]setpts=PTS-STARTPTS', 'scale=' + scaleW + ':' + scaleH + ':force_original_aspect_ratio=decrease:flags=bicubic', 'format=rgba'];
    const opacity = clip.opacity == null ? 1 : clip.opacity;
    if (opacity < 0.999) parts.push('colorchannelmixer=aa=' + opacity);
    const nextClip = nextVisual(clip, vm.track);
    const outD = transDur(clip, nextClip);
    const lead = vm.lead || 0;
    let fi = Number(clip.fadeIn) || 0;
    let fo = Number(clip.fadeOut) || 0;
    if (lead > 0) fi = Math.max(fi, lead);
    if (outD > 0) fo = Math.max(fo, outD);
    const prevClip = prevVisual(clip, vm.track);
    if (prevClip && prevClip.transition && prevClip.transition.type === 'black') {
      const dIn = transDur(prevClip, clip);
      if (dIn > 0) fi = Math.max(fi, dIn);
    }
    const take = Number(clip.duration) + lead;
    if (fi > 0) parts.push('fade=t=in:st=0:d=' + fi + ':alpha=1');
    if (fo > 0) parts.push('fade=t=out:st=' + Math.max(0, take - fo) + ':d=' + fo + ':alpha=1');
    filters.push(parts.join(',') + '[' + lab + ']');
    const next = 't' + (tmp++);
    const x = '(main_w*' + (clip.x == null ? 0.5 : clip.x) + ')-(w/2)';
    const y = '(main_h*' + (clip.y == null ? 0.5 : clip.y) + ')-(h/2)';
    const visStart = clip.start - lead;
    const visEnd = clip.start + clip.duration;
    const en = "between(t," + visStart + "," + visEnd + ")";
    filters.push('[' + last + '][' + lab + ']overlay=x=' + x + ':y=' + y + ':enable=' + "'" + en + "'" + '[' + next + ']');
    last = next;
  }
  for (const item of texts) {
    const clip = item.clip || item;
    const next = 't' + (tmp++);
    const fontsize = Math.max(12, Math.round((clip.fontSize || 36) * (W / 1920)));
    const color = (clip.color || '#ffffff').replace('#', '');
    const x = '(w*' + (clip.x == null ? 0.5 : clip.x) + ')-(text_w/2)';
    const y = '(h*' + (clip.y == null ? 0.5 : clip.y) + ')-(text_h/2)';
    const en = "between(t," + clip.start + "," + (clip.start + clip.duration) + ")";
    let dt = 'drawtext=text=' + "'" + escapeDrawtext(clip.text || '') + "'" + ':fontsize=' + fontsize + ':fontcolor=' + color + ':x=' + x + ':y=' + y + ':enable=' + "'" + en + "'";
    if (font) dt += ':fontfile=' + font.replace(/:/g, '\\:');
    if (clip.shadow) dt += ':shadowx=2:shadowy=2:shadowcolor=black@0.6';
    filters.push('[' + last + ']' + dt + '[' + next + ']');
    last = next;
  }
  const aLabs = [];
  for (const am of aMeta) {
    const clip = am.clip;
    const lab = 'a' + am.idx;
    const ms = Math.max(0, Math.round((clip.start || 0) * 1000));
    const vol = clip.volume == null ? 1 : clip.volume;
    let chain = '[' + am.idx + ':a]asetpts=PTS-STARTPTS,volume=' + vol;
    if (clip.fadeIn > 0) chain += ',afade=t=in:st=0:d=' + clip.fadeIn;
    if (clip.fadeOut > 0) chain += ',afade=t=out:st=' + Math.max(0, clip.duration - clip.fadeOut) + ':d=' + clip.fadeOut;
    chain += ',adelay=' + ms + ':all=1[' + lab + ']';
    filters.push(chain);
    aLabs.push('[' + lab + ']');
  }
  for (const vm of vMeta) {
    if (!vm.hasAudio) continue;
    const clip = vm.clip;
    if (clip.muted || (clip.volume != null && clip.volume <= 0.001)) continue;
    const lab = 'va' + vm.idx;
    const ms = Math.max(0, Math.round((clip.start || 0) * 1000));
    const vol = clip.volume == null ? 1 : clip.volume;
    let chain = '[' + vm.idx + ':a]asetpts=PTS-STARTPTS,volume=' + vol;
    if (clip.fadeIn > 0) chain += ',afade=t=in:st=0:d=' + clip.fadeIn;
    if (clip.fadeOut > 0) chain += ',afade=t=out:st=' + Math.max(0, clip.duration - clip.fadeOut) + ':d=' + clip.fadeOut;
    chain += ',adelay=' + ms + ':all=1[' + lab + ']';
    filters.push(chain);
    aLabs.push('[' + lab + ']');
  }
  let aout = null;
  if (aLabs.length === 1) aout = aLabs[0].slice(1, -1);
  else if (aLabs.length > 1) {
    filters.push(aLabs.join('') + 'amix=inputs=' + aLabs.length + ':duration=longest:dropout_transition=0[aout]');
    aout = 'aout';
  }
  if (filters.length) args.push('-filter_complex', filters.join(';'));
  if (last === '0:v') args.push('-map', '0:v');
  else args.push('-map', '[' + last + ']');
  if (aout) args.push('-map', '[' + aout + ']');
  args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', String(duration), '-movflags', '+faststart');
  if (aout) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push(outFile);
  return { ffmpeg, args, duration };
}

function runJob(job, cmd) {
  const child = execFile(cmd.ffmpeg, cmd.args);
  job.child = child;
  let log = '';
  const onChunk = (buf) => {
    const text = buf.toString();
    log += text;
    if (log.length > 8000) log = log.slice(-8000);
    job.log = log;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('out_time_ms=')) {
        const ms = Number(line.slice(12));
        if (!Number.isNaN(ms) && cmd.duration) job.ratio = Math.min(0.99, ms / (cmd.duration * 1000000));
      }
      if (line.startsWith('progress=end')) job.ratio = 1;
    }
  };
  if (child.stdout) child.stdout.on('data', onChunk);
  if (child.stderr) child.stderr.on('data', onChunk);
  child.on('error', (err) => {
    job.error = String(err.message || err);
    job.done = true;
  });
  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(job.outFile)) {
      job.done = true;
      job.ratio = 1;
    } else if (!job.error) {
      job.error = 'ffmpeg exited ' + code + (log ? '\n' + log.slice(-1500) : '');
      job.done = true;
    }
  });
}

async function handleStart(req, res) {
  try {
    const buf = await readBody(req);
    const parsed = parseForm(buf, req.headers['content-type'] || '');
    const project = JSON.parse(parsed.fields.project || '{}');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuecut-'));
    const mediaPaths = await prepareMedia(project, parsed.fields, parsed.files, dir);
    const outFile = parsed.fields.outPath && parsed.fields.outPath.endsWith('.mp4')
      ? parsed.fields.outPath
      : path.join(dir, 'cuecut.mp4');
    const cmd = await buildCommand(project, mediaPaths, outFile);
    if (!cmd.ffmpeg) {
      json(res, 400, { error: 'ffmpeg not found on PATH' });
      return;
    }
    const jobId = randomBytes(8).toString('hex');
    const job = { id: jobId, ratio: 0.01, done: false, error: null, outFile, log: '', dir };
    jobs.set(jobId, job);
    runJob(job, cmd);
    json(res, 200, { jobId, duration: cmd.duration });
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
}

function attachExportApi(middlewares) {
  middlewares.use((req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/api/ffmpeg') {
      const bin = whichTool('ffmpeg');
      if (!bin) return json(res, 200, { found: false });
      execFile(bin, ['-version'], { timeout: 4000 }, (err, stdout) => {
        const line = String(stdout || '').split('\n')[0] || '';
        json(res, 200, { found: !err, path: bin, version: line });
      });
      return;
    }
    if (url === '/api/export/start' && req.method === 'POST') {
      handleStart(req, res);
      return;
    }
    if (url === '/api/export/status') {
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('jobId');
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: 'job not found' });
      return json(res, 200, { ratio: job.ratio, done: job.done, error: job.error, log: job.log, outFile: job.outFile });
    }
    if (url === '/api/export/file') {
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('jobId');
      const job = jobs.get(id);
      if (!job || !job.done || job.error || !fs.existsSync(job.outFile)) {
        return json(res, 404, { error: 'file not ready' });
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="cuecut.mp4"');
      fs.createReadStream(job.outFile).pipe(res);
      return;
    }
    next();
  });
}

module.exports = { attachExportApi, whichTool };
