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
