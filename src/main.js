import {
  getProject,
  subscribe,
  mutate,
  undo,
  redo,
  replaceProject,
  loadSavedRaw,
  emptyProject,
  persist,
  ensureProjectShape,
} from './state.js';
import { buildDemoProject } from './demo.js';
import { importFiles, hydrateSavedMedia, renderLibrary } from './media.js';
import { renderFrame, togglePlay, seek, startPreviewLoop, isPlaying } from './preview.js';
import { renderTimeline, splitAtPlayhead, deleteSelected, bindTimelineWindow } from './timeline.js';
import { renderInspector } from './inspector.js';
import { saveProjectFile, checkFfmpeg, hideModal } from './export.js';
import { renderCategories, setCategory, bindCategoryInputs } from './categories.js';
import { addTextClip } from './captions.js';

function renderAll() {
  const p = getProject();
  document.querySelectorAll('[data-aspect]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.aspect === p.aspect);
  });
  const zoom = document.getElementById('zoom');
  if (zoom && Number(zoom.value) !== p.zoom) zoom.value = p.zoom;
  renderCategories();
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
    ensureProjectShape(p);
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
  bindCategoryInputs();
  window.addEventListener('resize', () => renderTimeline());

  const fileInput = document.getElementById('file-input');
  const openImport = () => fileInput.click();
  document.getElementById('btn-import').onclick = openImport;
  document.getElementById('btn-import-2').onclick = openImport;
  fileInput.addEventListener('change', async () => {
    await importFiles(fileInput.files);
    fileInput.value = '';
    setCategory('media');
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
    setCategory('text');
    addTextClip('lamp');
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
  document.getElementById('btn-export').onclick = () => setCategory('export');
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
    ensureProjectShape(p);
    await hydrateSavedMedia(p.media || []);
    replaceProject(p);
  });

  window.addEventListener('keydown', (ev) => {
    if (isTypingTarget(ev.target)) return;
    if (ev.code === 'Space' || ev.key === 'k' || ev.key === 'K') {
      ev.preventDefault();
      togglePlay();
    } else if (ev.key === 'j' || ev.key === 'J') {
      ev.preventDefault();
      seek(getProject().playhead - 1, isPlaying());
    } else if (ev.key === 'l' || ev.key === 'L') {
      ev.preventDefault();
      seek(getProject().playhead + 1, isPlaying());
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : 1 / (getProject().fps || 30);
      seek(getProject().playhead - step, isPlaying());
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : 1 / (getProject().fps || 30);
      seek(getProject().playhead + step, isPlaying());
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
