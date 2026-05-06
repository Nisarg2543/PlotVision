export type ToastType = 'info' | 'success' | 'warning' | 'error';

export function showToast(message: string, type: ToastType = 'info', durationMs = 3000): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const borderColors: Record<ToastType, string> = {
    info: '#22d3ee',
    success: '#34d399',
    warning: '#f59e0b',
    error: '#f87171',
  };

  toast.style.cssText = `
    background: #161616;
    border: 1px solid #2a2a2a;
    border-left: 3px solid ${borderColors[type]};
    color: #e5e5e5;
    font-size: 13px;
    font-family: 'Geist', system-ui, sans-serif;
    padding: 8px 12px;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    opacity: 1;
    transition: opacity 0.3s;
    pointer-events: auto;
    max-width: 320px;
    word-break: break-word;
  `;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}
