/**
 * Non-blocking confirm dialog that replaces window.confirm().
 * Returns a Promise that resolves to true (confirmed) or false (cancelled).
 */
export function showConfirm(message: string, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed;inset:0;',
      'background:rgba(0,0,0,0.25);backdrop-filter:blur(3px);',
      'z-index:500;display:flex;align-items:center;justify-content:center;',
      'animation:pv-fade-in 0.12s ease;',
    ].join('');

    const dialog = document.createElement('div');
    dialog.style.cssText = [
      'background:#fff;border:1px solid #e4e4e7;border-radius:10px;',
      'padding:20px 22px;width:320px;',
      'box-shadow:0 16px 40px rgba(0,0,0,0.12);',
      "font-family:'Geist',system-ui,sans-serif;",
      'animation:pv-modal-up 0.18s cubic-bezier(0.16,1,0.3,1);',
    ].join('');

    const confirmColor = danger ? '#dc2626' : '#2563eb';
    const confirmBg    = danger ? 'color-mix(in srgb,#dc2626 10%,#fff)' : '#2563eb';

    dialog.innerHTML = `
      <p style="font-size:13px;color:#09090b;line-height:1.6;margin-bottom:18px;">${message}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="pv-confirm-cancel" style="padding:6px 14px;font-size:12px;font-family:inherit;background:#fff;color:#52525b;border:1px solid #e4e4e7;border-radius:6px;cursor:pointer;">Cancel</button>
        <button id="pv-confirm-ok" style="padding:6px 14px;font-size:12px;font-weight:600;font-family:inherit;background:${confirmColor === '#2563eb' ? confirmBg : `color-mix(in srgb,${confirmColor} 10%,#fff)`};color:${confirmColor};border:1px solid color-mix(in srgb,${confirmColor} 22%,transparent);border-radius:6px;cursor:pointer;">${confirmLabel}</button>
      </div>
    `;

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const close = (result: boolean) => {
      backdrop.remove();
      resolve(result);
    };

    dialog.querySelector('#pv-confirm-cancel')!.addEventListener('click', () => close(false));
    dialog.querySelector('#pv-confirm-ok')!.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(false); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', handler); }
    });
  });
}
