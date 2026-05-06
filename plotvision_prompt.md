# PlotVision — Claude Code Build Prompt

## Project Overview

Build **PlotVision**, a next-generation web-based graph digitizer and data extraction tool that fully supersedes WebPlotDigitizer. This is a production-grade single-page web application built as a static HTML/CSS/JS app (no backend required for core features). The target users are researchers, engineers, and academics who need to extract numerical data from chart images — especially those frustrated with WebPlotDigitizer's clunky UI, laggy performance, and limited automation.

---

## Tech Stack

- **Frontend:** Vanilla TypeScript compiled via Vite (or React + Vite if component complexity warrants it)
- **Styling:** Tailwind CSS v4
- **Canvas/Image processing:** HTML5 Canvas API, OffscreenCanvas for heavy operations
- **PDF support:** PDF.js (Mozilla) via CDN
- **Charts/Preview:** Chart.js v4 for data preview pane
- **AI integration (optional phase 2):** OpenAI Vision API or Google Gemini Vision via user-provided API key (stored in-memory only, never persisted)
- **Export:** SheetJS (xlsx) for Excel, Papa Parse for CSV, custom JSON schema
- **Icons:** Lucide icons
- **Fonts:** Geist (body) + Geist Mono (data tables) via CDN

---

## Core Architecture

### Single Page Application Structure
```
plotvision/
├── index.html
├── src/
│   ├── main.ts                  # App entry point
│   ├── state/
│   │   ├── store.ts             # Central reactive state (no Redux needed, use simple signals/events)
│   │   └── types.ts             # All TypeScript types and interfaces
│   ├── modules/
│   │   ├── image-loader.ts      # Image/PDF loading, clipboard paste, drag-drop
│   │   ├── canvas-engine.ts     # Canvas rendering, zoom/pan, pixel operations
│   │   ├── calibration.ts       # Axis calibration logic (XY, log, polar, ternary, date axes)
│   │   ├── digitizer.ts         # Manual and automatic data point extraction
│   │   ├── auto-trace.ts        # Color-based auto-tracing algorithm
│   │   ├── datasets.ts          # Dataset management (multiple series)
│   │   ├── export.ts            # CSV, JSON, Excel, clipboard export
│   │   └── history.ts           # Undo/redo stack
│   ├── ui/
│   │   ├── toolbar.ts           # Left toolbar panel
│   │   ├── sidebar.ts           # Right panel (datasets, calibration)
│   │   ├── preview-panel.ts     # Live data preview chart
│   │   ├── settings-modal.ts    # App settings
│   │   └── keyboard.ts          # Keyboard shortcut handler
│   └── utils/
│       ├── color.ts             # Color conversion (RGB, HSV, LAB)
│       ├── math.ts              # Coordinate transforms, interpolation
│       └── file.ts              # File reading utilities
```

---

## Layout Design

Use a **three-panel layout** — dark-themed, dense, tool-first:

```
┌──────────────────────────────────────────────────────────────────┐
│  TOPBAR: Logo | File | Zoom controls | Undo/Redo | Export | Help │
├──────────────┬───────────────────────────────┬───────────────────┤
│              │                               │                   │
│  LEFT PANEL  │       CANVAS (main area)      │   RIGHT PANEL     │
│  (Tools)     │                               │   (Datasets &     │
│              │  - Infinite pan/zoom          │    Calibration)   │
│  - Pointer   │  - Crosshair cursor           │                   │
│  - Calibrate │  - Snap-to-pixel precision    │  - Dataset list   │
│  - Add Point │  - Point overlays             │  - Point table    │
│  - Auto Trace│  - Calibration point markers  │  - Preview chart  │
│  - Measure   │                               │  - Statistics     │
│  - Eraser    │                               │                   │
│  - Pan/Zoom  │                               │                   │
│              │                               │                   │
├──────────────┴───────────────────────────────┴───────────────────┤
│  STATUS BAR: Cursor coords | Points in dataset | Active tool     │
└──────────────────────────────────────────────────────────────────┘
```

**Design System:**
- Background: `#0d0d0d`, surface: `#161616`, border: `#2a2a2a`
- Primary accent: `#22d3ee` (cyan)
- Text: `#e5e5e5`, muted: `#71717a`, faint: `#3f3f46`
- Border radius: `4px` for inputs/buttons, `6px` for panels — keep it tight and dense
- Font: Geist 14px body, Geist Mono 13px for coordinate/data values

---

## Feature Specification — Build All of These

### 1. Image & Document Loading
- Drag-and-drop onto canvas
- Clipboard paste (Ctrl+V) — works from PDF viewers, web browsers
- File picker supporting: PNG, JPG, BMP, GIF, WebP, TIFF, SVG, PDF
- Multi-page PDF support with page navigation (prev/next, jump-to-page)
- URL import: paste a URL to load an image directly (fetch via proxy or direct)
- **Batch mode**: load multiple images and queue them for processing sequentially
- Recent files list (in-memory, last 5)

### 2. Axis Calibration System
Support all these axis types with a wizard-style guided setup:

| Axis Type | Description | Calibration Method |
|---|---|---|
| XY Linear | Standard cartesian | Click 2 points on X, 2 on Y |
| XY Log | Semi-log or log-log | Same as linear with log transform |
| Polar | R-theta plots | Center point + 2 radius + angle reference |
| Ternary | Triangular diagrams | 3 corner points |
| Date/Time X | Time-series charts | Click 2 date points, enter dates |
| Map/Image | Pixel measurements | No axis, direct pixel output |

**Calibration UX improvements over WebPlotDigitizer:**
- Clear step-by-step wizard with visual indicators on canvas showing which point to click next
- Point dragging — calibration points can be dragged after placement, not re-done from scratch
- Calibration validation: after completing calibration, show a grid overlay to verify the mapping looks correct
- Save calibration presets and reuse across similar images
- Show calibration error estimate after completion

### 3. Data Extraction Modes

#### Manual Mode
- Click anywhere on canvas to add a point to the active dataset
- Points displayed as colored circles with dataset color
- Hover tooltip shows the calibrated coordinates (not pixel coords)
- Point dragging — drag existing points to adjust
- Right-click to delete
- Point labeling — optionally label each point

#### Auto-Trace Mode (Color-Based)
- Color picker: click on the line/curve you want to trace
- Tolerance slider (0–100) for color sensitivity
- Algorithm: flood-fill connected components + thin to centerline skeleton
- Smoothing control (none / light / heavy)
- Sampling interval: every N pixels along curve
- Foreground/background separation using LAB color distance
- Handles multiple overlapping lines by color (each gets its own dataset)
- Preview: show detected pixels highlighted before committing

#### Box Selection Mode
- Draw a rectangular region
- Detect all points of a given color within region
- Use for scatter plots and point clouds

#### Strip Chart Mode
- For multi-panel strip charts (time series with multiple signals)
- Define row strips, auto-detect signal in each strip

### 4. Dataset Management
- Unlimited datasets per image (each with a unique color and name)
- Toggle visibility of each dataset (eye icon)
- Drag to reorder datasets
- Merge two datasets
- Duplicate a dataset
- Sort points by X or by Y within a dataset
- Delete individual points, or batch delete by selection
- Point table: spreadsheet-style editable table for each dataset
  - Click any cell to edit the value directly
  - Sortable columns
  - Highlight/select rows, bulk delete

### 5. Live Data Preview Panel
- Real-time chart (Chart.js) rendering the extracted data as it is digitized
- Supports line, scatter, bar rendering modes
- Shows overlay of digitized points on top of a re-rendered preview
- Pan/zoom the preview independently
- Statistics panel: min, max, mean, std dev, N points — for each dataset

### 6. Measurement Tools
- Distance measurement: click two points, get pixel distance and calibrated distance
- Angle measurement: click three points, get angle
- Area measurement: click N points to define polygon, get area in calibrated units
- Perimeter measurement

### 7. Export System
Export all or selected datasets in these formats:

| Format | Details |
|---|---|
| CSV | Comma-separated, configurable delimiter, header row, precision control |
| TSV | Tab-separated |
| Excel (.xlsx) | Multiple datasets as separate sheets |
| JSON | Structured format with metadata (calibration, image name, date) |
| Copy to Clipboard | Tab-separated for direct paste into Excel/Sheets |
| SVG Overlay | Export the original image with point overlays as SVG |
| LaTeX table | Auto-generate a LaTeX tabular environment |

Export options: decimal precision (1–10 decimal places), include/exclude headers, sort order (original / by X / by Y).

### 8. Undo/Redo System
- Full history stack for all operations (add point, delete point, move point, calibrate, auto-trace)
- Ctrl+Z / Ctrl+Shift+Z
- History panel showing last N actions with timestamps
- Jump to any point in history

### 9. Project Save/Load
- Save entire session (image + calibration + all datasets + settings) as a `.pvz` file (JSON bundle)
- Load a `.pvz` file to resume exactly where you left off
- Auto-save to in-memory state so browser refresh doesn't lose work (show a warning if there's unsaved work)
- Export/import just the calibration settings (`.pvc` file) to reuse on similar images

### 10. Advanced Canvas Features
- Infinite zoom with smooth interpolation (not the pixelated zoom WebPlotDigitizer has)
- Pan with middle-mouse or space+drag
- Fit-to-window button
- Zoom to selection (draw rectangle, zoom to fit it)
- Image filters panel:
  - Brightness / Contrast sliders (real-time)
  - Invert colors toggle (helps with dark-background charts)
  - Grayscale toggle
  - Edge enhance (sharpens lines for easier tracing)
  - These are non-destructive — applied as canvas filter, original image unchanged
- Grid overlay with configurable spacing (helps verify calibration)
- Crosshair cursor that snaps to the nearest detected data pixel when in proximity

### 11. Keyboard Shortcuts (Comprehensive)
| Key | Action |
|---|---|
| `V` | Pointer/select tool |
| `C` | Calibrate tool |
| `A` | Add point (manual) |
| `T` | Auto-trace tool |
| `M` | Measure tool |
| `E` | Eraser |
| `Space` + drag | Pan canvas |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Ctrl+S` | Save project |
| `Ctrl+E` | Export data |
| `Ctrl+V` | Paste image |
| `+` / `-` | Zoom in/out |
| `0` | Fit to window |
| `Del` | Delete selected point(s) |
| `Tab` | Cycle active dataset |
| `←↑→↓` | Nudge selected point by 1px |
| `Shift+←↑→↓` | Nudge selected point by 10px |
| `Ctrl+A` | Select all points in active dataset |
| `?` | Open keyboard shortcuts modal |

### 12. AI-Assist Mode (Phase 2 — Optional, User API Key)
- User inputs their own OpenAI or Gemini API key (stored in-memory, never sent anywhere else)
- "Smart Auto-Detect" button: sends image to vision model, gets back:
  - Chart type detection (line, bar, scatter, pie, etc.)
  - Axis label and unit extraction
  - Suggested calibration points
  - Auto-populated axis calibration
- "Extract All Data" AI mode: model returns estimated data points for all visible series
- Results are editable — AI output is a starting point, not final
- Show confidence score per detected point
- Works even for complex charts (multiple Y axes, dual axes, broken axes)

### 13. Accessibility & UX Polish
- Full keyboard navigation (no mouse required)
- High-contrast mode toggle
- All interactive elements have `aria-label`
- Toast notifications for actions (point added, export complete, etc.) — bottom-right, auto-dismiss
- Onboarding tour for first-time users (overlay tooltips on key UI areas)
- "What's new" changelog panel
- Error states: if calibration is invalid, show red highlight with explanation

---

## State Management Design

Use a simple reactive store pattern (no Redux/Zustand needed):

```typescript
interface AppState {
  image: {
    data: ImageData | null;
    width: number;
    height: number;
    filename: string;
    currentPage: number; // for PDFs
    totalPages: number;
  };
  canvas: {
    zoom: number;
    panX: number;
    panY: number;
    imageFilters: ImageFilters;
  };
  calibration: {
    axisType: AxisType;
    points: CalibrationPoint[];
    isComplete: boolean;
    transform: CoordinateTransform | null;
  };
  datasets: Dataset[];
  activeDatasetId: string | null;
  activeTool: Tool;
  history: HistoryEntry[];
  historyIndex: number;
  autoTrace: AutoTraceSettings;
  ui: {
    leftPanelOpen: boolean;
    rightPanelOpen: boolean;
    previewMode: 'scatter' | 'line' | 'bar';
  };
}
```

---

## Coordinate Transform Math (Implement Carefully)

For XY Linear:
```
xData = x1Data + (pixelX - x1px) * (x2Data - x1Data) / (x2px - x1px)
yData = y1Data + (pixelY - y1py) * (y2Data - y1Data) / (y2py - y1py)
```

For XY Log (semi-log):
```
xData = 10^(log10(x1Data) + (pixelX - x1px) * (log10(x2Data) - log10(x1Data)) / (x2px - x1px))
```

For Polar:
```
dx = pixelX - centerX
dy = -(pixelY - centerY)  // flip Y because canvas Y is inverted
r = sqrt(dx^2 + dy^2) * rScale
theta = atan2(dy, dx) in degrees, adjusted for reference angle
```

Handle all edge cases: division by zero, degenerate calibration, out-of-bounds extrapolation (warn user, but still return value).

---

## Auto-Trace Algorithm (Implement This)

```
Input: image bitmap, target color (RGB), tolerance, sampling interval
Output: list of (x, y) points in data coordinates

Steps:
1. Convert image to LAB color space
2. For each pixel: compute delta-E distance from target color
3. Threshold: mark pixels where delta-E < tolerance as "foreground"
4. Connected component labeling — find largest component
5. For each column (x), find the median y-coordinate of foreground pixels in that column
6. Smooth the resulting curve (Savitzky-Golay filter or rolling mean)
7. Downsample to sampling interval
8. Convert pixel coordinates to data coordinates via calibration transform
9. Return dataset points
```

---

## Build Order (Implement in This Sequence)

1. **Project scaffold** — Vite + TypeScript + Tailwind, three-panel layout shell, design system tokens
2. **Image loading** — drag-drop, paste, file picker, PDF.js integration
3. **Canvas engine** — zoom, pan, pixel-accurate rendering, crosshair cursor
4. **XY Linear calibration** — wizard UI, point placement, transform calculation, grid overlay validation
5. **Manual data extraction** — click to add, drag to move, right-click delete, point table
6. **CSV export** — basic export working end-to-end
7. **Dataset management** — multiple datasets, colors, visibility toggle
8. **Live preview panel** — Chart.js rendering of extracted points
9. **Undo/redo** — history stack
10. **Auto-trace** — color picker, algorithm implementation, preview
11. **Additional axis types** — log, polar, ternary, date
12. **Advanced exports** — Excel, JSON, LaTeX, clipboard
13. **Image filters** — brightness/contrast, invert, edge enhance
14. **Measurement tools** — distance, angle, area
15. **Project save/load** — .pvz file format
16. **Keyboard shortcuts** — full map implementation
17. **Onboarding tour** — first-time user flow
18. **AI Assist mode** — API key input, vision model integration
19. **Polish pass** — animations, toast notifications, empty states, error handling

---

## Key UX Improvements Over WebPlotDigitizer (Prioritize These)

1. **No full page reloads or broken state** — WebPlotDigitizer v4 loses your work if you accidentally navigate. PlotVision auto-saves state.
2. **Smooth canvas zoom** — WPD's zoom is pixelated and jarring. Use CSS `transform: scale()` on a canvas that's always rendered at native resolution.
3. **Drag-adjustable calibration points** — In WPD, you must redo calibration from scratch if you misclick. In PlotVision, calibration points are draggable.
4. **No modal interruptions** — WPD constantly opens blocking dialogs. PlotVision uses inline panels and non-blocking toasts.
5. **Multi-dataset workflow** — WPD makes switching between datasets cumbersome. PlotVision has a persistent sidebar with all datasets always visible.
6. **Batch processing** — WPD has no batch mode. PlotVision queues multiple images.
7. **Real-time preview** — WPD has no live chart preview as you digitize. PlotVision shows your extracted data as a live chart.

---

## Quality Standards

- No page reloads — everything is client-side state
- All operations must be undoable
- Never block the UI thread during image processing — use Web Workers for heavy ops (auto-trace, color analysis)
- Responsive down to 1024px wide (tablet) — full feature set; below that, show a "best viewed on desktop" banner
- Dark theme only (this is a technical tool, not a marketing site)
- Every button has a tooltip on hover
- Every destructive action (delete dataset, clear all points) requires confirmation
- Loading states for all async operations (PDF rendering, AI calls)
- Exported files must be immediately usable in Excel, Python (pandas), R, MATLAB

---

## File to Create

Start by creating `plotvision/index.html` as the single app entry point with all styles inlined via Tailwind CDN play mode (for rapid prototyping). Once the architecture is solid, migrate to a proper Vite build. Begin with Step 1 of the Build Order above and work through each step sequentially.

