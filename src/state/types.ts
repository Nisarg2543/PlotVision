export type Tool = 'pointer' | 'calibrate' | 'add-point' | 'auto-trace' | 'measure' | 'eraser' | 'pan' | 'pie' | 'scale-bar' | 'perspective' | 'roi' | 'template';

export type AxisType = 'xy-linear' | 'xy-log' | 'polar' | 'log-polar' | 'ternary' | 'date-x' | 'map' | 'bar-chart' | 'circular';

export type CalibrationStep =
  | 'idle'
  | 'place-x1' | 'await-x1-value'
  | 'place-x2' | 'await-x2-value'
  | 'place-y1' | 'await-y1-value'
  | 'place-y2' | 'await-y2-value'
  | 'complete'
  // Polar / Log-Polar wizard
  | 'polar-place-center' | 'polar-place-ref' | 'polar-await-r'
  // Ternary wizard
  | 'ternary-place-a' | 'ternary-place-b' | 'ternary-place-c'
  // Bar Chart wizard (2-point Y calibration)
  | 'bar-place-y1' | 'bar-await-y1-value' | 'bar-place-y2' | 'bar-await-y2-value'
  // Circular Chart Recorder wizard (8 steps)
  | 'circ-place-center'
  | 'circ-place-r1' | 'circ-await-r1'   // inner radius click + value
  | 'circ-place-r2' | 'circ-await-r2'   // outer radius click + value
  | 'circ-place-t1' | 'circ-await-t1'   // time ref 1 click + value
  | 'circ-place-t2' | 'circ-await-t2';  // time ref 2 click + value + clockwise

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
  // Overflow storage for axis types that need more than 4 points (e.g. circular)
  extra?: Record<string, number>;
}

export interface DataPoint {
  id: string;
  pixelX: number;
  pixelY: number;
  dataX: number;
  dataY: number;
  label?: string;
  outlier?: boolean;
  xError?: number;
  yError?: number;
}

export type FitType = 'linear' | 'exponential' | 'power' | 'polynomial';

export interface CurveFit {
  type: FitType;
  degree?: number;
  params: number[];
  r2: number;
  visible: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  points: DataPoint[];
  curveFit?: CurveFit;
}

export interface ReferenceSession {
  label: string;
  datasets: Dataset[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  snapshot: {
    datasets: Dataset[];
    calibration: CalibrationState;
    imageFilters: ImageFilters;
    roi: Roi | null;
    exportOptions: ExportOptions;
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
  gridRemoval: boolean;
}

export interface Roi {
  x1: number; y1: number;
  x2: number; y2: number;
}

export type ExportPrecision = 'auto' | 'fixed' | 'sigfigs' | 'scientific';
export type ExportSort = 'none' | 'x-asc' | 'x-desc' | 'y-asc' | 'y-desc' | 'nearest-neighbor';

export interface ExportOptions {
  precision: ExportPrecision;
  digits: number;
  sort: ExportSort;
  dateFmt: string;  // e.g. 'yyyy-mm-dd HH:ii:ss'
}

export type ExtractionMode = 'curve' | 'bar' | 'scatter' | 'pie' | 'template' | 'strip-chart' | 'ai';

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
  reference?: ReferenceSession;
  canvas: {
    zoom: number;
    panX: number;
    panY: number;
    imageFilters: ImageFilters;
    roi: Roi | null;
    eraserRadius: number;
    loupeEnabled: boolean;
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
  exportOptions: ExportOptions;
  ai: {
    apiKey: string;
    provider: 'openai' | 'gemini';
  };
}
