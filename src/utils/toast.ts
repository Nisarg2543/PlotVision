export type ToastType = 'info' | 'success' | 'warning' | 'error';

const ACCENT: Record<ToastType, string> = {
  info:    '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  error:   '#dc2626',
};

export function showToast(message: string, type: ToastType = 'info', durationMs = 3000): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.style.cssText = [
    'display:flex;align-items:center;gap:10px;',
    'background:#fff;border:1px solid #e4e4e7;border-radius:8px;',
    'padding:10px 14px;font-size:12px;color:#09090b;',
    "font-family:'Geist',system-ui,sans-serif;",
    'max-width:300px;word-break:break-word;pointer-events:auto;',
    'box-shadow:0 4px 16px rgba(0,0,0,0.1),0 1px 4px rgba(0,0,0,0.06);',
    'animation:pv-toast-in 0.2s cubic-bezier(0.16,1,0.3,1);',
    'transition:opacity 0.3s;',
  ].join('');

  const bar = document.createElement('div');
  bar.style.cssText = `width:3px;min-height:16px;align-self:stretch;border-radius:2px;background:${ACCENT[type]};flex-shrink:0;`;

  const text = document.createElement('span');
  text.textContent = message;

  toast.appendChild(bar);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, durationMs);
}

(function injectStyles() {
  if (document.getElementById('pv-toast-kf')) return;
  const s = document.createElement('style');
  s.id = 'pv-toast-kf';
  s.textContent = '@keyframes pv-toast-in{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}';
  document.head.appendChild(s);
})();
