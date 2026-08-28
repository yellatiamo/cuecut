import {
  getProject,
  subscribe,
  mutate,
  undo,
  redo,
  replaceProject,
  loadSavedRaw,
  emptyProject,
  uid,
  defaultClipProps,
  TEXT_STYLES,
  persist,
} from './state.js';
import { buildDemoProject } from './demo.js';
import { importFiles, hydrateSavedMedia, renderLibrary } from './media.js';
import { renderFrame, togglePlay, seek, startPreviewLoop } from './preview.js';
import { renderTimeline, splitAtPlayhead, deleteSelected, bindTimelineWindow } from './timeline.js';
import { renderInspector } from './inspector.js';
import { startExport, saveProjectFile, checkFfmpeg, hideModal } from './export.js';

function renderAll() {
  const p = getProject();
  document.querySelectorAll('[data-aspect]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.aspect === p.aspect);
  });
  const zoom = document.getElementById('zoom');
  if (zoom && Number(zoom.value) !== p.zoom) zoom.value = p.zoom;
  renderLibrary();
  renderTimeline();
  renderInspector();
  renderFrame(p.playhead);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

async function boot() {
  const saved = loadSavedRaw();
  if (saved && saved.tracks) {
    const p = emptyProject();
    Object.assign(p, saved);
    if (!p.tracks || p.tracks.length < 4) p.tracks = emptyProject().tracks;
    await hydrateSavedMedia(p.media || []);
    replaceProject(p);
  } else {
    const demo = await buildDemoProject();
    replaceProject(demo);
  }

  subscribe(renderAll);
  renderAll();
  startPreviewLoop();
  bindTimelineWindow();
  window.addEventListener('resize', () => renderTimeline());

  const fileInput = document.getElementById('file-input');
  const openImport = () => fileInput.click();
  document.getElementById('btn-import').onclick = openImport;
  document.getElementById('btn-import-2').onclick = openImport;
  fileInput.addEventListener('change', async () => {
    await importFiles(fileInput.files);
    fileInput.value = '';
  });

  const lib = document.getElementById('library-panel');
  lib.addEventListener('dragover', (ev) => {
    ev.preventDefault();
  });
  lib.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer.files && ev.dataTransfer.files.length) {
      await importFiles(ev.dataTransfer.files);
    }
  });

  document.getElementById('btn-demo').onclick = async () => {
    const demo = await buildDemoProject();
    replaceProject(demo);
  };

  document.getElementById('btn-text').onclick = () => {
    const style = TEXT_STYLES[0];
    mutate((p) => {
      const ov = p.tracks.find((t) => t.id === 'ov');
      ov.clips.push({
        id: uid('clip'),
        mediaId: null,
        type: 'text',
        start: p.playhead,
        duration: 3,
        label: style.text,
        text: style.text,
        styleId: style.id,
        fontSize: style.fontSize,
        color: style.color,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        shadow: style.shadow,
        ...defaultClipProps({ x: style.x, y: style.y, volume: 0 }),
      });
      p.selectedClipId = ov.clips[ov.clips.length - 1].id;
    }, true);
  };

  document.querySelectorAll('[data-aspect]').forEach((btn) => {
    btn.onclick = () => {
      mutate((p) => {
        p.aspect = btn.dataset.aspect;
      }, true);
    };
  });

  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-redo').onclick = redo;
  document.getElementById('btn-split').onclick = splitAtPlayhead;
  document.getElementById('btn-delete').onclick = deleteSelected;
  document.getElementById('btn-play').onclick = togglePlay;
  document.getElementById('btn-to-start').onclick = () => seek(0);
  document.getElementById('btn-export').onclick = () => startExport();
  document.getElementById('btn-save').onclick = () => saveProjectFile();
  document.getElementById('modal-close').onclick = hideModal;

  const projectInput = document.getElementById('project-input');
  document.getElementById('btn-open').onclick = () => projectInput.click();
  projectInput.addEventListener('change', async () => {
    const f = projectInput.files && projectInput.files[0];
    projectInput.value = '';
    if (!f) return;
    const text = await f.text();
    const data = JSON.parse(text);
    const p = emptyProject();
    Object.assign(p, data);
    await hydrateSavedMedia(p.media || []);
    replaceProject(p);
  });

  window.addEventListener('keydown', (ev) => {
    if (isTypingTarget(ev.target)) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      togglePlay();
    } else if (ev.key === 's' || ev.key === 'S') {
      ev.preventDefault();
      splitAtPlayhead();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      deleteSelected();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      persist();
      saveProjectFile();
    }
  });

  const pill = document.getElementById('ffmpeg-pill');
  const info = await checkFfmpeg();
  if (info.found) {
    pill.textContent = 'ffmpeg 就绪';
    pill.classList.add('ok');
    pill.title = info.version || 'ffmpeg';
  } else {
    pill.textContent = '无 ffmpeg';
    pill.classList.add('bad');
    pill.title = '预览可用；导出需安装 ffmpeg';
  }
}

boot();
