# PlotVision

Browser-based graph digitizer. Users load a chart image, calibrate axes, and extract numerical data via clicking, auto-tracing, or automated detectors. Exports CSV/Excel/JSON/Plotly/SVG/PNG overlay/LaTeX/tar. Deployed at plotvision.vercel.app.

## Stack

- **Vite 8 + TypeScript** — vanilla TS SPA, no React/Vue
- **Tailwind CSS v4** — `@tailwindcss/vite` plugin, `@theme` tokens in `src/style.css`, no `tailwind.config.js`
- **chart.js** — preview panel only, **lazy-loaded** (async chunk, not in initial bundle)
- **xlsx** — lazy `await import('xlsx')` on Excel export only
- **PDF.js** — CDN UMD build, `window.pdfjsLib` global
- **@sentry/browser** — error monitoring, lazy-loaded, only active when `VITE_SENTRY_DSN` env var is set

## Commands

```bash
npm run dev           # Vite dev server (localhost:5173)
npm run build         # tsc && vite build → dist/
npm run preview       # preview dist/ build
npm test              # Vitest unit tests (165 tests)
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

Build must pass `tsc` with zero errors before considering a change complete.
Tests must pass (`npm test`) before committing.

## Layout

The app uses a **bottom dock** layout (replaced WPD-style sidebar in Phase 1):

```
TopBar:      logo | open/undo/redo/zoom | [Compare] [Export] | dark/tour/help
Canvas:      full width, full height (checkerboard bg when empty)
Bottom Dock: [▼] [1·Load ✓] [2·Set Scale] [3·Get Data] [4·Measure]  tool strip
StatusBar:   x · y · pts · tool · zoom · filename
```

Step content fills the dock. No right sidebar, no left tool rail — tools appear contextually per step.

## Architecture

### State (`src/state/`)

`store.ts` — reactive store using `structuredClone`. Pattern:
```ts
setState(draft => { draft.someField = newValue; });  // mutates clone, fires listeners
subscribe(fn);   // fn called on every setState
getState();      // read current state
```

**Critical invariant:** `ImageBitmap` cannot be `structuredClone`d. It lives in a module-level variable inside `canvas-engine.ts`, NOT in `AppState`. State holds only image metadata (width, height, filename).

History snapshots (`src/modules/history.ts`) capture: `datasets`, `calibration`, `imageFilters`, `roi`, `exportOptions`. Call `pushHistory('description')` BEFORE the mutating `setState`.

### Modules (`src/modules/`)

| File | Responsibility |
|---|---|
| `canvas-engine.ts` | Rendering loop (RAF), zoom/pan, HiDPI, hit-testing, event routing, overlay drawing. Exports `render()`, `setImageBitmap()`, `getImageBitmap()`, `setCanvasCallbacks()`, `fitToWindow()`, `destroyCanvas()`. Also draws error bars and curve fit overlays. |
| `calibration.ts` | Axis calibration wizard state machine. Handles all `CalibrationStep` values. Builds `CoordinateTransform`. `stepBackCalibration()` reverts one wizard step. |
| `digitizer.ts` | Click-to-add points, drag, nudge, delete. `pixelToData()` dispatches to the right transform per `axisType`. Exposes `getPendingBarLabel()` / `confirmBarLabel()` for bar-chart label prompts |
| `axis-types.ts` | Non-linear transforms: log, polar, log-polar, ternary, circular, date-x |
| `auto-trace.ts` | Color-mask curve tracing (column-median, x-step with cubic spline, custom-x). `buildColorMask()` is shared by bar/scatter detectors — accepts optional `roi` param |
| `bar-detector.ts` | Bar chart detection + `detectAllBarLayers()` for stacked bars |
| `scatter-detector.ts` | Blob/centroid detection for scatter plots (8-connected flood fill) |
| `pie-detector.ts` | Click-based angle digitizer. Bridges to canvas via `window.__pieMod` |
| `template-match.ts` | NCC template matching. Bridges via `window.__templateMod` |
| `strip-chart.ts` | Multi-panel strip chart. Strips defined by click; `traceAllStrips()` runs auto-trace per strip. Uses `window.__stripDefining` to intercept canvas clicks |
| `scale-bar.ts` | Physical distance calibration. Bridges via `window.__scaleBarMod` |
| `perspective.ts` | 4-corner homography warp (DLT + Gaussian elimination). Bridges via `window.__perspectiveMod` |
| `roi.ts` | Region of Interest bounding box. Stored in `AppState.canvas.roi`; clamps `buildColorMask` |
| `auto-detect.ts` | Chart type heuristics from image pixels (bar/pie/scatter/line) |
| `image-filters.ts` | Pixel-level filters: threshold, sharpen, denoise, autoContrast, gridRemoval |
| `image-loader.ts` | Drag-drop, paste, file picker, PDF.js rendering. `destroyImageLoader()` removes listeners |
| `datasets.ts` | Dataset CRUD, color palette, sort, duplicate, outlier detection, normalization, curve fit storage |
| `history.ts` | Undo/redo (max 100). Snapshots on `pushHistory()` |
| `export.ts` | CSV (with X_err/Y_err columns), Excel, JSON, Clipboard, LaTeX, Plotly HTML, SVG, PNG overlay, comparison CSV, .tar bundle |
| `measure.ts` | Distance/angle/area tool; reports in real-world units when scale bar is set |
| `project.ts` | Save/load .pvz (JSON+base64 image), load .tar (parseTar), autosave to localStorage every 30s |
| `batch.ts` | Queue of images for sequential digitization. `onBatchProgress` pub/sub, `cancelBatch()`, calibration reuse option. |
| `curve-fitting.ts` | Linear, exponential, power, polynomial fitting. `runFit(xs, ys, type, degree?)` → `CurveFit`. `evaluateFit`, `fitEquationString`, `fitPoints`. |

### UI (`src/ui/`)

| File | Responsibility |
|---|---|
| `toolbar.ts` | Top bar: open, save, undo/redo, zoom, Compare button (reference session), export modal, shortcuts modal, dark mode toggle, feedback button |
| `dock.ts` | Bottom dock: step nav tabs, tool strip, batch progress UI, collapse toggle |
| `step-scale.ts` | Step 2 "Set the Scale": chart-type card grid, calibration wizard with Back button, scale bar, perspective |
| `step-data.ts` | Step 3 "Get Data": dataset list, method cards, trace settings, points table, expanded stats, outlier UI, curve fitting UI, normalization, image filters, export options, point editor dialog |
| `step-measure.ts` | Step 4 "Measure": mode buttons, result, history log |
| `preview-panel.ts` | Chart.js live scatter/line preview of dataset points (**lazy-loaded chunk**) |
| `keyboard.ts` | Full shortcut map: V/C/A/T/M/E/B/P/R tools, Ctrl+Z/S/O/E, nudge, zoom |
| `loading-overlay.ts` | `showLoading(msg)` / `hideLoading()` — CSS spinner over canvas for heavy ops |
| `onboarding.ts` | First-run guided tour (targets dock elements, not old sidebar) |
| `icons.ts` | Lucide-style SVG string exports for all icons (no npm lucide package) |
| `ui-helpers.ts` | Shared DOM builders: `makeSec`, `makeBtn`, `makeRow`, `makeSelect`, `makeFilterSlider`, `makeLabelWithTip`, etc. |

### Utilities (`src/utils/`)

| File | Key exports |
|---|---|
| `math.ts` | `canvasToImage`, `imageToCanvas`, `linearPixelToData`, `linearDataToPixel`, `isTransformValid`, `distance`, `clamp`, `niceGridInterval`, `uid` |
| `color.ts` | `rgbToLab`, `deltaE`, `hexToRgb`, `rgbToHex` |
| `sanitize.ts` | `esc(str)` — HTML-escape user strings before `innerHTML` |
| `toast.ts` | `showToast(msg, type, ms)` |
| `file.ts` | `downloadText`, `downloadBlob`, `readFileAsArrayBuffer` |
| `modal.ts` | `trapFocus(el, onEscape)` — Tab/Shift+Tab cycle within modal, Escape callback |
| `analytics.ts` | `track(event, props)` — lightweight usage analytics |

### Tests (`src/**/*.test.ts`, `src/test-fixtures/`)

- **Framework:** Vitest (`vitest.config.ts`, node environment)
- **165 tests** across 6 files — math utils, curve fitting, axis transforms, color, sanitize, datasets
- **Fixture:** `src/test-fixtures/transform.ts` exports `linearTransform` and `logTransform` (CoordinateTransform helpers)
- Test files excluded from `tsconfig.json` (vitest handles TS for them separately)
- Mocking pattern for DOM-dependent modules: `vi.mock('../utils/toast', () => ({ showToast: vi.fn() }))`

## Key Patterns

### Canvas overlay bridges
Modules that draw on canvas but can't import `canvas-engine` (would be circular) register a window global:
```ts
(window as unknown as Record<string, unknown>).__pieMod = { getPieOverlay };
```
`canvas-engine.ts` reads these in `renderFrame()`. Bridges: `__pieMod`, `__autoTraceMod`, `__scaleBarMod`, `__perspectiveMod`, `__templateMod`.

### setCanvasCallbacks
Feature modules register click/drag handlers in `main.ts` via `setCanvasCallbacks({ onCalibClick, onDigitizerClick, onPieClick, onStripClick, ... })`. Canvas-engine routes based on `activeTool` (and `window.__stripDefining` for strip boundary clicks).

### XSS safety
All user-controlled strings (dataset names, filenames, labels, point values) must use `esc()` from `src/utils/sanitize.ts` when embedded in `innerHTML`. Use `textContent` for plain text nodes.

### Lazy loading pattern
Use dynamic `import()` for heavy optional chunks. The preview panel (chart.js) is lazy-loaded in `main.ts` and `step-data.ts`:
```ts
// main.ts
import('./ui/preview-panel').then(({ initPreviewPanel }) => initPreviewPanel(document.body));

// step-data.ts
const triggerPreview = () => import('./preview-panel').then(m => m.updatePreview());
```
Do NOT add static imports that would pull these back into the main bundle.

### CoordinateTransform encoding for complex axes
The 12-field `CoordinateTransform` is repurposed for non-linear axes:
- **Polar/Log-polar**: center=x1px/py, ref=x2px/py, r=x1Data, angleOffset=y1Data, CW=y2Data
- **Ternary**: vertex A=x1px/py, B=x2px/py, C=y1px/py; scale=x1Data
- **Circular**: inner radius=x1px/py/Data, outer=x2px/py/Data, time refs=y1/y2, center in `extra.centerPx/centerPy`
- **Bar-chart**: Y calibration only in y1/y2; X is categorical (pixel-space, label via `pendingBarLabel`)

### Axis-type dispatch in `digitizer.ts → pixelToData()`
1. `'circular'` → `circularPixelToData` → `{time, value}`
2. `'polar'` / `'log-polar'` → `polarPixelToData(logR)` → `{r, θ°}`
3. `'bar-chart'` → Y-only linear; sets `pendingBarLabel`
4. `'ternary'` → `ternaryPixelToData` → `{A%, B%}` (C% = 100−A−B)
5. `isLogAxisType` → `logPixelToData`
6. Default → `linearPixelToData`

### Export formatting
`AppState.exportOptions` controls precision, sort (including nearest-neighbor), and date format. `exportCSV()` picks column headers based on `axisType`:
- polar → `Dataset,r,theta_deg`
- ternary → `Dataset,A_pct,B_pct,C_pct`
- date-x → `Dataset,Date,Y`
- bar-chart → `Dataset,Category,Value`
- circular → `Dataset,Time,Value`
- XY with error bars → appends `X_err,Y_err` columns when present

## Type Quick Reference (`src/state/types.ts`)

- `Tool` — 12 values: `pointer | calibrate | add-point | auto-trace | measure | eraser | pan | pie | scale-bar | perspective | roi | template`
- `AxisType` — 9 values: `xy-linear | xy-log-x | xy-log-y | xy-log-xy | polar | log-polar | ternary | bar-chart | date-x | map | circular`
- `CalibrationStep` — 19+ values covering all wizard flows (XY, polar, ternary, bar-chart, circular)
- `ExtractionMode` — `curve | bar | scatter | pie | template | strip-chart`
- `CoordinateTransform` — `axisType` + 12 numeric fields (x1px,x1py,x1Data,x2px,x2py,x2Data,y1px,y1py,y1Data,y2px,y2py,y2Data) + `extra?: Record<string,number>`
- `FitType` — `linear | exponential | power | polynomial`
- `CurveFit` — `{ type, degree?, params, r2, visible }`
- `DataPoint` — `{ id, pixelX, pixelY, dataX, dataY, label?, outlier?, xError?, yError? }`
- `Dataset` — `{ id, name, color, visible, points, curveFit? }`
- `AppState` — `image | canvas (zoom/pan/imageFilters/roi) | calibration | datasets | activeTool | history | ui | exportOptions | reference?`

## AxisType Reference

| Value | Wizard | `pixelToData` output |
|---|---|---|
| `xy-linear` | 4-point (x1,x2,y1,y2) | X, Y |
| `xy-log-x/y/xy` | Same, values must be > 0 | X, Y (log-scaled) |
| `polar` | 3-step: center → ref → r value | r, θ° |
| `log-polar` | Same as polar | r (log), θ° |
| `ternary` | 3 vertex clicks | A%, B% |
| `bar-chart` | 2-step Y calibration | pixel X, Y; label prompt |
| `date-x` | 4-point; datetime-local input | timestamp ms, Y |
| `map` | No calibration | pixel X, Y |
| `circular` | 9-step wizard | time, value |

## Deployment

- **Vercel** — auto-deploys on push to `main` (plotvision.vercel.app)
- **CI** — GitHub Actions (`.github/workflows/ci.yml`) runs `npm test` + `npm run build` on every push/PR
- `vercel.json` — security headers (X-Frame-Options DENY, nosniff, Referrer-Policy), asset caching (1 year immutable for `/assets/*`), index.html no-cache
- **PWA** — `public/manifest.json` + `public/sw.js` (Cache-First service worker)
- **SEO** — `public/robots.txt`, `public/sitemap.xml`, JSON-LD SoftwareApplication schema in `index.html`
- **Sentry** — set `VITE_SENTRY_DSN` env var in Vercel to activate error monitoring (zero bundle impact when unset)

## Bundle Sizes (current)

| Chunk | Size | Gzip | Notes |
|---|---|---|---|
| `index.js` | 190 kB | 58 kB | Main app bundle |
| `preview-panel.js` | 163 kB | 57 kB | chart.js — lazy, loads after render |
| `xlsx.js` | 425 kB | 141 kB | Excel export — lazy on demand |
| `history.js` | 3.4 kB | 1.3 kB | Undo/redo — separate chunk |
| `detector-worker.js` | 2.2 kB | — | Web worker |
