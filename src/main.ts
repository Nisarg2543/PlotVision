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
import { setupAutosave } from './modules/project';
import { initOnboarding } from './ui/onboarding';

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
}

main();
