/**
 * Full-canvas loading overlay with spinner and optional message.
 * Shown during heavy synchronous operations (image load, perspective warp, etc.)
 */

let overlayEl: HTMLElement | null = null;

export function showLoading(msg = 'Processing…'): void {
  if (overlayEl) { hideLoading(); }

  const container = document.getElementById('canvas-container');
  if (!container) return;

  overlayEl = document.createElement('div');
  overlayEl.style.cssText = [
    'position:absolute;inset:0;z-index:100;',
    'background:rgba(255,255,255,0.75);',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
    'backdrop-filter:blur(2px);',
  ].join('');
  overlayEl.setAttribute('aria-live', 'polite');
  overlayEl.setAttribute('aria-label', msg);

  const spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:32px;height:32px;border-radius:50%;',
    'border:3px solid var(--color-border);',
    'border-top-color:var(--color-accent);',
    'animation:pv-spin 0.7s linear infinite;',
  ].join('');

  const label = document.createElement('span');
  label.style.cssText = 'font-size:13px;color:var(--color-text-2);font-family:var(--font-sans);';
  label.textContent = msg;

  overlayEl.appendChild(spinner);
  overlayEl.appendChild(label);
  container.appendChild(overlayEl);
}

export function hideLoading(): void {
  overlayEl?.remove();
  overlayEl = null;
}

// Inject @keyframes once
if (!document.getElementById('pv-spin-style')) {
  const style = document.createElement('style');
  style.id = 'pv-spin-style';
  style.textContent = '@keyframes pv-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}
