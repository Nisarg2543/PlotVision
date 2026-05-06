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
import { setupAutosave } from './modules/project';
import { initOnboarding } from './ui/onboarding';
import { startMeasure } from './modules/measure';

function main(): void {
  const canvasContainer = document.getElementById('canvas-container')!;
  const topbar = document.getElementById('topbar')!;
  const leftPanel = document.getElementById('left-panel')!;
  const rightPanel = document.getElementById('right-panel')!;

  // Initialize canvas engine first (other modules depend on it)
  initCanvas(canvasContainer);

  // Wire up canvas callbacks from other modules
  setCanvasCallbacks({
    onCalibClick: handleCalibClick,
    onDigitizerClick: handleDigitizerClick,
    onCalibDrag: handleCalibDrag,
    onDeletePoint: (datasetId, pointId) => deletePoint(datasetId, pointId),
    onPointDragEnd: (_datasetId, _pointId, _x, _y) => {
      // History push happens after drag for perf; digitizer handles it
      pushHistoryOnDragEnd();
    },
  });

  // Initialize image loading (drag-drop, paste, file picker)
  initImageLoader(canvasContainer);

  // Initialize UI panels
  initToolbar(topbar);
  initLeftPanel(leftPanel);
  initSidebar(rightPanel);
  initPreviewPanel(rightPanel);

  // Initialize keyboard shortcuts
  initKeyboard();

  // Create default dataset so app is immediately usable
  addDataset('Dataset 1');

  // Auto-save protection (warns on tab close if unsaved data)
  setupAutosave();

  // Initialize onboarding tour for first-time users
  initOnboarding();

  // Activate measure module so it can receive canvas clicks
  startMeasure();
}

main();
