import {
  getProject,
  serialize,
  files,
  projectDuration,
  exportOutputSize,
  defaultExportSettings,
  qualityToCrf,
} from './state.js';

export const INSTALL_HELP = '未检测到 ffmpeg，预览仍可使用。Ubuntu/Debian: sudo apt install -y ffmpeg fonts-noto-cjk';

export async function checkFfmpeg() {
  try {
    const res = await fetch('/api/ffmpeg');
    if (!res.ok) return { found: false };
    return await res.json();
  } catch {
    return { found: false };
  }
}

export function showModal(opts) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-title').textContent = opts.title || '';
  document.getElementById('modal-body').innerHTML = opts.body || '';
  document.getElementById('progress-wrap').classList.toggle('hidden', !opts.progress);
  document.getElementById('modal-log').classList.toggle('hidden', !opts.log);
  if (typeof opts.log === 'string') document.getElementById('modal-log').textContent = opts.log;
  document.getElementById('modal-close').style.display = opts.closable === false ? 'none' : '';
  modal.classList.remove('hidden');
}

export function hideModal() {
  document.getElementById('modal').classList.add('hidden');
}

export function setProgress(ratio) {
  document.getElementById('progress-wrap').classList.remove('hidden');
  document.getElementById('progress-bar').style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
}

function extFor(media) {
  if (media.type === 'audio') return '.m4a';
  if (media.type === 'image') return '.jpg';
  return '.mp4';
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export async function saveProjectFile() {
  const data = JSON.stringify(serialize(), null, 2);
  downloadBlob(new Blob([data], { type: 'application/json' }), (getProject().name || 'cuecut') + '.json');
}

export async function startExport() {
  const info = await checkFfmpeg();
  if (!info.found) {
    showModal({ title: '需要 ffmpeg / ffmpeg required', body: INSTALL_HELP.replace(/\n/g, '<br>'), log: INSTALL_HELP });
    return;
  }
  const p = getProject();
  const es = { ...defaultExportSettings(), ...(p.exportSettings || {}) };
  const payload = serialize(p);
  payload.duration = projectDuration(p);
  const size = exportOutputSize(p);
  payload.width = size.w;
  payload.height = size.h;
  payload.fps = Number(es.fps) || p.fps || 30;
  payload.quality = es.quality || 'standard';
  payload.crf = qualityToCrf(es.quality);
  payload.includeCaptions = es.includeCaptions !== false;
  payload.filename = es.filename || (p.name || 'cuecut') + '.mp4';
  const form = new FormData();
  form.append('project', JSON.stringify(payload));
  const desktop = window.cuecutDesktop;
  let outPath = null;
  if (desktop && desktop.saveDialog) {
    outPath = await desktop.saveDialog({
      title: '导出视频',
      defaultPath: payload.filename,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (!outPath) return;
    form.append('outPath', outPath);
  }
  for (const m of p.media) {
    if (m.dataUrl) { form.append('data_' + m.id, m.dataUrl); continue; }
    const blob = files.get(m.id);
    if (blob) form.append('file_' + m.id, blob, m.name || m.id + extFor(m));
    else if (m.filePath) form.append('path_' + m.id, m.filePath);
  }
  const qLabel = es.quality === 'draft' ? '草稿' : es.quality === 'high' ? '高质量' : '标准';
  showModal({
    title: '正在导出 Exporting',
    body: '正在把时间轴渲染为 ' + size.w + 'x' + size.h + ' @ ' + payload.fps + 'fps · ' + qLabel + ' CRF ' + payload.crf,
    progress: true,
    closable: false,
  });
  setProgress(0.02);
  try {
    const res = await fetch('/api/export/start', { method: 'POST', body: form });
    const started = await res.json();
    if (!res.ok || started.error) throw new Error(started.error || 'export failed');
    await pollJob(started.jobId, outPath, payload.filename);
  } catch (err) {
    showModal({ title: '导出失败', body: String(err.message || err), closable: true });
  }
}

async function pollJob(jobId, outPath, filename) {
  while (true) {
    await new Promise((r) => setTimeout(r, 280));
    const s = await fetch('/api/export/status?jobId=' + encodeURIComponent(jobId)).then((r) => r.json());
    if (s.ratio != null) setProgress(s.ratio);
    if (s.log) {
      document.getElementById('modal-log').classList.remove('hidden');
      document.getElementById('modal-log').textContent = s.log;
    }
    if (s.error) throw new Error(s.error);
    if (s.done) {
      setProgress(1);
      if (outPath) {
        showModal({ title: '导出完成', body: '已写入 <code>' + outPath + '</code>', progress: true });
        const desktop = window.cuecutDesktop;
        if (desktop && desktop.showItem) desktop.showItem(outPath);
        return;
      }
      const file = await fetch('/api/export/file?jobId=' + encodeURIComponent(jobId));
      if (!file.ok) throw new Error('download failed');
      downloadBlob(await file.blob(), filename || (getProject().name || 'cuecut') + '.mp4');
      showModal({ title: '导出完成', body: '已开始下载 MP4。', progress: true });
      return;
    }
  }
}
