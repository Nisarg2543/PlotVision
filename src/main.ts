import './style.css';
import { initCanvas, setCanvasCallbacks } from './modules/canvas-engine';
import { initImageLoader } from './modules/image-loader';
import { initToolbar } from './ui/toolbar';
import { initLeftPanel } from './ui/left-panel';
import { initSidebar } from './ui/sidebar';
import { initPreviewPanel } from './ui/preview-panel';
import { initKeyboard } from './ui/keyboard';
import { addDataset } from './modules/datasets';
import { handleCalibClick, handleCalibDrag } from './modules/calibration';
import { handleDigitizerClick, deletePoint, pushHistoryOnDragEnd } from './modules/digitizer';
import { handlePieClick } from './modules/pie-detector';
import { handleScaleBarClick } from './modules/scale-bar';
import { handlePerspectiveClick } from './modules/perspective';
import { handleTemplateDragStart, handleTemplateDragMove, handleTemplateDragEnd } from './modules/template-match';
import { handleStripClick } from './modules/strip-chart';
import { destroyImageLoader } from './modules/image-loader';
import { destroyAutosave } from './modules/project';
import { destroyCanvas } from './modules/canvas-engine';
import { setupAutosave, getAutosaveData, clearAutosave, loadProject } from './modules/project';
import { initOnboarding } from './ui/onboarding';
import { showToast } from './utils/toast';

// Apply persisted theme before first render
if (localStorage.getItem('plotvision-theme') === 'dark') {
  document.body.classList.add('dark');
}

function main(): void {
  const canvasContainer = document.getElementById('canvas-container');
  const topbar          = document.getElementById('topbar');
  const leftPanel       = document.getElementById('left-panel');
  const rightPanel      = document.getElementById('right-panel');

  if (!canvasContainer || !topbar || !leftPanel || !rightPanel) {
    console.error('PlotVision: required DOM elements missing — check index.html');
    return;
  }

  // Canvas engine first — other modules depend on it
  initCanvas(canvasContainer);

  // Wire canvas callbacks from feature modules
  setCanvasCallbacks({
    onCalibClick:   handleCalibClick,
    onDigitizerClick: handleDigitizerClick,
    onCalibDrag:    handleCalibDrag,
    onDeletePoint:  (datasetId, pointId) => deletePoint(datasetId, pointId),
    onPointDragEnd: () => pushHistoryOnDragEnd(),
    onPieClick:          handlePieClick,
    onScaleBarClick:      handleScaleBarClick,
    onPerspectiveClick:   handlePerspectiveClick,
    onTemplateDragStart:  handleTemplateDragStart,
    onTemplateDragMove:   handleTemplateDragMove,
    onTemplateDragEnd:    handleTemplateDragEnd,
    onStripClick:         handleStripClick,
  });

  // Image loading (drag-drop, paste, file picker, PDF)
  initImageLoader(canvasContainer);

  // UI panels
  initToolbar(topbar);
  initLeftPanel(leftPanel);
  initSidebar(rightPanel);
  initPreviewPanel(rightPanel); // subscribes to state; renders into #preview-chart in Data tab

  // Keyboard shortcuts
  initKeyboard();

  // Default dataset so app is usable immediately
  addDataset('Dataset 1');

  // Warn on tab close if unsaved data exists
  setupAutosave();

  // First-time onboarding tour
  initOnboarding();

  // Autosave recovery banner
  const autosaveData = getAutosaveData();
  if (autosaveData) {
    try {
      const parsed = JSON.parse(autosaveData);
      const age = Date.now() - (parsed.savedAt ?? 0);
      if (age < 24 * 60 * 60 * 1000) { // within 24h
        const banner = document.getElementById('recovery-banner');
        if (banner) {
          banner.style.display = 'flex';
          document.getElementById('recovery-restore')?.addEventListener('click', () => {
            banner.style.display = 'none';
            const blob = new Blob([autosaveData], { type: 'application/json' });
            const file = new File([blob], 'autosave.pvz', { type: 'application/json' });
            void loadProject(file);
            clearAutosave();
          });
          document.getElementById('recovery-dismiss')?.addEventListener('click', () => {
            banner.style.display = 'none';
            clearAutosave();
          });
        }
      }
    } catch { /* malformed autosave, ignore */ }
  }

  // Global unhandled error handler
  window.addEventListener('unhandledrejection', () => {
    showToast('Something went wrong — if the issue persists, reload the page', 'error', 6000);
  });

  // Register service worker for PWA / offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // SW registration failure is non-fatal
    });
  }

  // Cleanup on page unload (prevents memory leaks)
  window.addEventListener('beforeunload', () => {
    destroyImageLoader();
    destroyAutosave();
    destroyCanvas();
  }, { once: true });
}

main();
