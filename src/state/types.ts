export type Tool = 'pointer' | 'calibrate' | 'add-point' | 'auto-trace' | 'measure' | 'eraser' | 'pan' | 'pie';

export type AxisType = 'xy-linear' | 'xy-log' | 'polar' | 'ternary' | 'date-x' | 'map';

export type CalibrationStep =
  | 'idle'
  | 'place-x1' | 'await-x1-value'
  | 'place-x2' | 'await-x2-value'
  | 'place-y1' | 'await-y1-value'
  | 'place-y2' | 'await-y2-value'
  | 'complete';

export type CalibPointRole = 'x1' | 'x2' | 'y1' | 'y2';

export interface CalibrationPoint {
  id: string;
  role: CalibPointRole;
  pixelX: number;
  pixelY: number;
  dataX: number | null;
  dataY: number | null;
}

export interface CoordinateTransform {
  axisType: AxisType;
  x1px: number; x1py: number; x1Data: number;
  x2px: number; x2py: number; x2Data: number;
  y1px: number; y1py: number; y1Data: number;
  y2px: number; y2py: number; y2Data: number;
}

export interface DataPoint {
  id: string;
  pixelX: number;
  pixelY: number;
  dataX: number;
  dataY: number;
  label?: string;
}

export interface Dataset {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  points: DataPoint[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  snapshot: {
    datasets: Dataset[];
    calibration: CalibrationState;
  };
}

export interface ImageFilters {
  brightness: number;
  contrast: number;
  grayscale: boolean;
  invert: boolean;
  // Pixel-level filters (applied to processed image copy used by detectors)
  sharpen: boolean;
  threshold: number | null;  // null = off, 0–255 when enabled
  autoContrast: boolean;
  denoise: boolean;
}

export type ExtractionMode = 'curve' | 'bar' | 'scatter' | 'pie';

export interface CalibrationState {
  axisType: AxisType;
  step: CalibrationStep;
  points: CalibrationPoint[];
  isComplete: boolean;
  transform: CoordinateTransform | null;
  showGrid: boolean;
}

export interface AppState {
  image: {
    width: number;
    height: number;
    filename: string;
    currentPage: number;
    totalPages: number;
  };
  canvas: {
    zoom: number;
    panX: number;
    panY: number;
    imageFilters: ImageFilters;
  };
  calibration: CalibrationState;
  datasets: Dataset[];
  activeDatasetId: string | null;
  activeTool: Tool;
  history: HistoryEntry[];
  historyIndex: number;
  ui: {
    previewMode: 'scatter' | 'line' | 'bar';
  };
}
