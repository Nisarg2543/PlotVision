import { getState, setState } from '../state/store';
import { trapFocus } from '../utils/modal';
import { esc } from '../utils/sanitize';
import { Icons } from './icons';

export function openSettingsModal(): void {
  // Remove existing if any
  document.getElementById('settings-modal')?.remove();

  const state = getState();

  const backdrop = document.createElement('div');
  backdrop.id = 'settings-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.style.display = 'flex';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = '400px';

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${Icons.settings} Settings</span>
      <button class="modal-close" id="settings-close" aria-label="Close settings">×</button>
    </div>
    <div style="padding: 16px 20px;">
      <h3 style="font-size:13px; font-weight:600; color:var(--color-text); margin-bottom:12px;">AI Assist Mode (Optional)</h3>
      <p style="font-size:12px; color:var(--color-muted); margin-bottom:16px; line-height:1.5;">
        Configure your OpenAI or Google Gemini API key to use the Smart Auto-Detect and Extract All Data features. Your key is stored locally in-memory and never persisted.
      </p>

      <div style="margin-bottom: 12px;">
        <label style="display:block; font-size:11px; font-weight:600; color:var(--color-text-2); margin-bottom:4px;">AI Provider</label>
        <select id="ai-provider" class="pv-input" style="width:100%; cursor:pointer;">
          <option value="openai" ${state.ai.provider === 'openai' ? 'selected' : ''}>OpenAI (gpt-4o)</option>
          <option value="gemini" ${state.ai.provider === 'gemini' ? 'selected' : ''}>Google Gemini (gemini-1.5-pro)</option>
        </select>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display:block; font-size:11px; font-weight:600; color:var(--color-text-2); margin-bottom:4px;">API Key</label>
        <input type="password" id="ai-apikey" class="pv-input" style="width:100%;" placeholder="sk-..." value="${esc(state.ai.apiKey)}" />
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button id="settings-cancel" class="btn btn-ghost btn-sm" style="width:auto;">Cancel</button>
        <button id="settings-save" class="btn btn-primary btn-sm" style="width:auto;">Save Settings</button>
      </div>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const closeSettings = () => {
    backdrop.remove();
    releaseFocus();
  };

  const saveSettings = () => {
    const provider = (document.getElementById('ai-provider') as HTMLSelectElement).value as 'openai' | 'gemini';
    const apiKey = (document.getElementById('ai-apikey') as HTMLInputElement).value.trim();
    setState(draft => {
      draft.ai.provider = provider;
      draft.ai.apiKey = apiKey;
    });
    import('../utils/toast').then(m => m.showToast('Settings saved', 'success'));
    closeSettings();
  };

  document.getElementById('settings-close')!.onclick = closeSettings;
  document.getElementById('settings-cancel')!.onclick = closeSettings;
  document.getElementById('settings-save')!.onclick = saveSettings;

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeSettings();
  });

  const releaseFocus = trapFocus(modal, closeSettings);
}
