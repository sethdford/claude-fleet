/**
 * Mail View
 * Inter-agent mail inbox with compose and read functionality
 * Wired to: POST /mail, GET /mail/:handle, GET /mail/:handle/unread, POST /mail/:id/read
 */

import dayjs from 'dayjs';
import store from '@/store';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import {
  getUser,
  getMail,
  sendMail,
  markMailRead,
  getToken,
} from '@/api';
import type { MailMessage, WorkerInfo } from '@/types';

/**
 * Fetch unread mail for a handle.
 * This endpoint is not in the standard api.ts exports, so we use a local helper.
 */
async function getMailUnread(handle: string): Promise<MailMessage[]> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`/mail/${encodeURIComponent(handle)}/unread`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${response.status}`);
  }
  const text = await response.text();
  if (!text) return [];
  return JSON.parse(text) as MailMessage[];
}

/**
 * Render a single mail message
 */
function renderMailItem(msg: MailMessage): string {
  const isUnread = !msg.readAt;
  return `
    <div class="mail-item ${isUnread ? 'mail-unread' : ''}" data-mail-id="${msg.id}">
      <div class="mail-item-header">
        <div class="flex items-center gap-sm">
          ${isUnread ? '<span class="status-dot healthy size-2"></span>' : ''}
          <span class="mail-from">${escapeHtml(msg.from)}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-fg-muted">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          <span class="mail-to">${escapeHtml(msg.to)}</span>
        </div>
        <span class="mail-time">${msg.createdAt ? dayjs(msg.createdAt).fromNow() : ''}</span>
      </div>
      ${msg.subject ? `<div class="mail-subject">${escapeHtml(msg.subject)}</div>` : ''}
      <div class="mail-body">${escapeHtml(msg.body?.slice(0, 200))}${(msg.body?.length || 0) > 200 ? '...' : ''}</div>
      ${isUnread ? `<button class="btn btn-secondary btn-sm mail-mark-read" data-mail-id="${msg.id}">Mark Read</button>` : ''}
    </div>
  `;
}

/**
 * Render compose form
 */
function renderCompose(workers: WorkerInfo[]): string {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Compose</h3>
      </div>
      <form id="mail-compose-form">
        <div class="form-group">
          <label class="form-label">To</label>
          <select class="form-input" id="mail-to" required>
            <option value="">Select recipient...</option>
            ${workers.map(w => `<option value="${escapeHtml(w.handle)}">${escapeHtml(w.handle)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <input type="text" class="form-input" id="mail-subject" placeholder="Optional subject">
        </div>
        <div class="form-group">
          <label class="form-label">Message</label>
          <textarea class="form-input" id="mail-body" rows="4" placeholder="Type your message..." required></textarea>
        </div>
        <button type="submit" class="btn btn-primary">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          Send
        </button>
      </form>
    </div>
  `;
}

/**
 * Render the mail view
 */
export async function renderMail(container: HTMLElement): Promise<() => void> {
  const user = getUser();
  const handle = user?.handle || 'dashboard-viewer';
  const workers: WorkerInfo[] = store.get('workers') || [];

  container.innerHTML = `
    <div class="mail-layout">
      <div>
        <div class="mail-tabs">
          <button class="mail-tab active" data-tab="all">All</button>
          <button class="mail-tab" data-tab="unread">Unread</button>
        </div>
        <div class="card p-0">
          <div id="mail-list">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
      <div id="mail-compose">
        ${renderCompose(workers)}
      </div>
    </div>
  `;

  let currentTab = 'all';

  // Fetch mail
  async function loadMail(): Promise<void> {
    try {
      let messages: MailMessage[];
      if (currentTab === 'unread') {
        messages = await getMailUnread(handle);
      } else {
        messages = (await getMail(handle)) as MailMessage[];
      }
      const list: MailMessage[] = Array.isArray(messages) ? messages : [];
      const listEl = document.getElementById('mail-list');
      if (!listEl) return;
      if (list.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state p-xl">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-8">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <div class="empty-state-text">No messages${currentTab === 'unread' ? ' (unread)' : ''}</div>
          </div>
        `;
      } else {
        listEl.innerHTML = list.map(renderMailItem).join('');
      }
    } catch (e) {
      toast.error('Failed to load mail: ' + (e as Error).message);
    }
  }

  await loadMail();

  // Tab switching
  container.addEventListener('click', async (e: MouseEvent) => {
    const tab = (e.target as HTMLElement).closest('.mail-tab') as HTMLElement | null;
    if (tab) {
      currentTab = tab.dataset.tab || 'all';
      container.querySelectorAll('.mail-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      await loadMail();
    }

    // Mark read
    const markReadBtn = (e.target as HTMLElement).closest('.mail-mark-read') as HTMLElement | null;
    if (markReadBtn) {
      const mailId = markReadBtn.dataset.mailId;
      if (!mailId) return;
      try {
        await markMailRead(mailId);
        toast.success('Marked as read');
        await loadMail();
      } catch (err) {
        toast.error('Failed to mark as read: ' + (err as Error).message);
      }
    }
  });

  // Compose form — use event delegation on the compose container so the
  // handler survives innerHTML replacement when the workers store updates.
  const composeContainer = document.getElementById('mail-compose');
  composeContainer?.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    const toEl = document.getElementById('mail-to') as HTMLSelectElement | null;
    const subjectEl = document.getElementById('mail-subject') as HTMLInputElement | null;
    const bodyEl = document.getElementById('mail-body') as HTMLTextAreaElement | null;

    const to = toEl?.value || '';
    const subject = subjectEl?.value.trim() || '';
    const body = bodyEl?.value.trim() || '';

    if (!to || !body) {
      toast.warning('Recipient and message are required');
      return;
    }

    try {
      await sendMail(to, subject, body);
      toast.success(`Mail sent to ${to}`);
      const form = document.getElementById('mail-compose-form') as HTMLFormElement | null;
      form?.reset();
      await loadMail();
    } catch (err) {
      toast.error('Failed to send mail: ' + (err as Error).message);
    }
  });

  // Update compose dropdown when workers change — the submit handler is on
  // the parent #mail-compose div, so it survives this innerHTML replacement.
  const unsubWorkers = store.subscribe('workers', (updatedWorkers: WorkerInfo[]) => {
    const compose = document.getElementById('mail-compose');
    if (compose) compose.innerHTML = renderCompose(updatedWorkers);
  });

  return () => {
    unsubWorkers();
  };
}
