/**
 * Focus trap utility — keeps keyboard focus cycling within a modal dialog.
 * Also handles Escape key to close.
 *
 * Usage:
 *   const release = trapFocus(dialogEl, () => closeModal());
 *   // later: release(); // clean up when modal closes
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function trapFocus(el: HTMLElement, onEscape?: () => void): () => void {
  const getFocusable = (): HTMLElement[] =>
    Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      n => !n.closest('[hidden]') && getComputedStyle(n).display !== 'none'
    );

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = getFocusable();
    if (focusable.length === 0) { e.preventDefault(); return; }

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  el.addEventListener('keydown', handleKey);

  // Focus first focusable element on open
  const focusable = getFocusable();
  if (focusable.length > 0) focusable[0].focus();

  return () => el.removeEventListener('keydown', handleKey);
}
