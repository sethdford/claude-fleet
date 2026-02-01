/**
 * Toast Notification System
 * Replaces alert() with styled, auto-dismissing notifications
 */

import { escapeHtml } from '@/utils/escape-html';

const TOAST_DURATION = 4000;
const TOAST_ANIMATION = 300;
const MAX_TOASTS = 5;

type ToastType = 'success' | 'error' | 'warning' | 'info';

const ICONS: Record<ToastType, string> = {
  success: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

interface ToastElement extends HTMLDivElement {
  _timeout?: ReturnType<typeof setTimeout>;
  _dismissing?: boolean;
}

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }
  return container;
}

function show(message: string, type: ToastType = 'info', duration = TOAST_DURATION): ToastElement {
  const parent = ensureContainer();

  while (parent.children.length >= MAX_TOASTS) {
    dismiss(parent.firstElementChild as ToastElement);
  }

  const toastEl = document.createElement('div') as ToastElement;
  toastEl.className = `toast toast-${type}`;
  toastEl.innerHTML = `
    <span class="toast-icon">${ICONS[type] ?? ICONS.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss">&times;</button>
  `;

  toastEl.querySelector('.toast-close')!.addEventListener('click', () => dismiss(toastEl));
  parent.appendChild(toastEl);

  requestAnimationFrame(() => {
    toastEl.classList.add('toast-visible');
  });

  if (duration > 0) {
    toastEl._timeout = setTimeout(() => dismiss(toastEl), duration);
  }

  return toastEl;
}

function dismiss(toastEl: ToastElement | null): void {
  if (!toastEl || toastEl._dismissing) return;
  toastEl._dismissing = true;
  clearTimeout(toastEl._timeout);
  toastEl.classList.remove('toast-visible');
  toastEl.classList.add('toast-exit');
  setTimeout(() => toastEl.remove(), TOAST_ANIMATION);
}

const toast = {
  show,
  success: (msg: string, duration?: number): ToastElement => show(msg, 'success', duration),
  error: (msg: string, duration?: number): ToastElement => show(msg, 'error', duration ?? 6000),
  warning: (msg: string, duration?: number): ToastElement => show(msg, 'warning', duration),
  info: (msg: string, duration?: number): ToastElement => show(msg, 'info', duration),
};

export default toast;
