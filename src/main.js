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
  ASPECTS,
} from './state.js';
import { buildDemoProject, seedDemoAudioIfNeeded } from './demo.js';
import { importFiles, hydrateSavedMedia, renderLibrary } from './media.js';
import { renderFrame, togglePlay, seek, startPreviewLoop, isPlaying } from './preview.js';
import { renderTimeline, splitAtPlayhead, deleteSelected, deleteSelectedRipple, closeGapsOnSelectedTrack, duplicateSelected, bindTimelineWindow } from './timeline.js';
import { renderInspector } from './inspector.js';
import { saveProjectFile, checkFfmpeg, hideModal } from './export.js';
import { renderCategories, setCategory, bindCategoryInputs } from './categories.js';
import { addTextClip } from './captions.js';

function fillAspectSelect() {
  const sel = document.getElementById('aspect-select');
  if (!sel || sel.dataset.ready) return;
  sel.innerHTML = ASPECTS.map((a) => `<option value="${a.id}">${a.id} ${a.zh}</option>`).join('');
  sel.dataset.ready = '1';
  sel.addEventListener('change', () => {
    const value = sel.value;
    mutate((p) => { p.aspect = value; }, true);
  });
}

function renderAll() {
  const p = getProject();
  const sel = document.getElementById('aspect-select');
  if (sel && sel.value !== p.aspect) sel.value = p.aspect;
  const mini = document.getElementById('aspect-mini');
  if (mini) mini.style.aspectRatio = String(p.aspect || '16:9').replace(':', ' / ');
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
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isOsFileDrag(ev) {
  const types = ev.dataTransfer && ev.dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

function bindOsFileDrop() {
  const col = document.querySelector('.library-col') || document.getElementById('library-panel');
  const overlay = document.getElementById('library-drop-overlay');
  if (!col) return;
  let depth = 0;

  function show(on) {
    col.classList.toggle('is-file-drop', on);
    if (overlay) {
      overlay.classList.toggle('hidden', !on);
      overlay.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
  }

  col.addEventListener('dragenter', (ev) => {
    if (!isOsFileDrag(ev)) return;
    ev.preventDefault();
    depth += 1;
    show(true);
  });
  col.addEventListener('dragover', (ev) => {
    if (!isOsFileDrag(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    show(true);
  });
  col.addEventListener('dragleave', (ev) => {
    if (!isOsFileDrag(ev)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  });
  col.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    depth = 0;
    show(false);
    const list = ev.dataTransfer && ev.dataTransfer.files;
    if (list && list.length) {
      await importFiles(list);
      setCategory('media');
    }
  });
}

async function boot() {
  const saved = loadSavedRaw();
  if (saved && saved.tracks) {
    const p = emptyProject();
    Object.assign(p, saved);
    ensureProjectShape(p);
    await hydrateSavedMedia(p.media || []);
    await seedDemoAudioIfNeeded(p);
    replaceProject(p);
  } else {
    const demo = await buildDemoProject();
    replaceProject(demo);
  }

  fillAspectSelect();
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

  bindOsFileDrop();

  document.getElementById('btn-demo').onclick = async () => {
    const demo = await buildDemoProject();
    replaceProject(demo);
  };

  document.getElementById('btn-text').onclick = () => {
    setCategory('text');
    addTextClip('lamp');
  };

  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-redo').onclick = redo;
  document.getElementById('btn-split').onclick = splitAtPlayhead;
  document.getElementById('btn-delete').onclick = deleteSelected;
  const rippleBtn = document.getElementById('btn-ripple-del');
  if (rippleBtn) rippleBtn.onclick = deleteSelectedRipple;
  const gapsBtn = document.getElementById('btn-close-gaps');
  if (gapsBtn) gapsBtn.onclick = closeGapsOnSelectedTrack;
  const dupBtn = document.getElementById('btn-dup');
  if (dupBtn) dupBtn.onclick = duplicateSelected;
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
      if (ev.shiftKey) deleteSelectedRipple();
      else deleteSelected();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      duplicateSelected();
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
