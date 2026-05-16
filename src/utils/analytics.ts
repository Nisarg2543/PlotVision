/**
 * Thin wrapper around Plausible Analytics.
 * Plausible is GDPR-compliant, cookie-free, and 1KB.
 * Script is loaded in index.html; this module just wraps the global.
 * All calls are no-ops if Plausible isn't loaded (dev, blocked, etc.).
 */

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: Record<string, string | number> }) => void;
  }
}

export function track(event: string, props?: Record<string, string | number>): void {
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    // analytics errors are never fatal
  }
}
