/**
 * Styled Confirmation Dialog
 * Replaces native confirm() with a themed modal dialog
 */

import { escapeHtml } from '@/utils/escape-html';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
}

export function confirm({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '2000';

    const btnClass = variant === 'danger' ? 'btn-danger' : 'btn-primary';

    overlay.innerHTML = `
      <div class="modal max-w-[400px]">
        <div class="modal-header">
          <h2 class="modal-title">${escapeHtml(title)}</h2>
        </div>
        <div class="modal-body">
          <p class="text-fg leading-relaxed m-0">${escapeHtml(message)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${btnClass}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    function close(result: boolean): void {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 250);
      resolve(result);
    }

    overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', () => close(false));
    overlay.querySelector('[data-action="confirm"]')!.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    function handleKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        close(false);
        document.removeEventListener('keydown', handleKeydown);
      }
    }
    document.addEventListener('keydown', handleKeydown);

    document.body.appendChild(overlay);
    (overlay.querySelector('[data-action="confirm"]') as HTMLElement).focus();
  });
}
