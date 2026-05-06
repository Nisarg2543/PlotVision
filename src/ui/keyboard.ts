import { getState } from '../state/store';
import { setActiveTool, fitToWindow, zoomBy, enableSpacePan } from '../modules/canvas-engine';
import { undo, redo } from '../modules/history';
import { deleteSelectedPoints, nudgePoint, selectAllPointsInDataset, getSelectedPointId } from '../modules/digitizer';
import { cycleActiveDataset } from '../modules/datasets';
import { exportCSV } from '../modules/export';
import { startCalibration } from '../modules/calibration';
import { saveProject, openProjectPicker } from '../modules/project';

let spaceDown = false;
let toolBeforeSpace = getState().activeTool;

export function initKeyboard(): void {
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.contentEditable === 'true'
  );
}

function handleKeyDown(e: KeyboardEvent): void {
  if (isTyping(e)) return;

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  // Space — temporary pan
  if (e.code === 'Space' && !spaceDown) {
    e.preventDefault();
    spaceDown = true;
    toolBeforeSpace = getState().activeTool;
    setActiveTool('pan');
    enableSpacePan(true);
    return;
  }

  if (ctrl) {
    switch (e.key.toLowerCase()) {
      case 'z':
        e.preventDefault();
        if (shift) redo(); else undo();
        return;
      case 'y':
        e.preventDefault();
        redo();
        return;
      case 's':
        e.preventDefault();
        saveProject();
        return;
      case 'o':
        e.preventDefault();
        openProjectPicker();
        return;
      case 'e':
        e.preventDefault();
        exportCSV();
        return;
      case 'a':
        e.preventDefault();
        selectAllPointsInDataset();
        return;
    }
    return;
  }

  switch (e.key) {
    case 'v': case 'V': setActiveTool('pointer'); break;
    case 'c': case 'C': startCalibration(); break;
    case 'a': case 'A': setActiveTool('add-point'); break;
    case 't': case 'T': setActiveTool('auto-trace'); break;
    case 'm': case 'M': setActiveTool('measure'); break;
    case 'e': case 'E': setActiveTool('eraser'); break;
    case '0': fitToWindow(); break;
    case '+': case '=': zoomBy(1.3); break;
    case '-': zoomBy(1 / 1.3); break;
    case 'Delete': case 'Backspace':
      e.preventDefault();
      deleteSelectedPoints();
      break;
    case 'Tab':
      e.preventDefault();
      cycleActiveDataset();
      break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      e.preventDefault();
      const id = getSelectedPointId();
      if (id) nudgePoint(e.key, shift ? 10 : 1);
      break;
    }
    case '?':
      document.getElementById('shortcuts-modal')?.classList.remove('hidden');
      break;
    case 'Escape':
      document.getElementById('shortcuts-modal')?.classList.add('hidden');
      document.getElementById('delete-popover')?.classList.add('hidden');
      break;
  }
}

function handleKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space' && spaceDown) {
    spaceDown = false;
    setActiveTool(toolBeforeSpace);
    enableSpacePan(false);
  }
}

