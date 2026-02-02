/**
 * Mail View
 * Inter-agent mail inbox with compose, handoffs, and read functionality
 * Wired to: POST /mail, GET /mail/:handle, GET /mail/:handle/unread,
 *           POST /mail/:id/read, GET /handoffs, POST /handoffs
 */

import dayjs from 'dayjs';
import store from '@/store';
import toast from '@/components/toast';
import { escapeHtml } from '@/utils/escape-html';
import {
  getUser,
  getMail,
  getMailUnread,
  sendMail,
  markMailRead,
} from '@/api';
import { getHandoffs, createHandoff } from '@/api-operations';
import type { MailMessage, WorkerInfo, Handoff } from '@/types';

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
 * Render a handoff item
 */
function renderHandoffItem(h: Handoff): string {
  return `
    <div class="mail-item" data-handoff-id="${escapeHtml(h.id)}">
      <div class="mail-item-header">
        <div class="flex items-center gap-sm">
          <span class="badge ${h.status === 'completed' ? 'green' : h.status === 'pending' ? 'yellow' : 'blue'}">${escapeHtml(h.status)}</span>
          <span class="mail-from">${escapeHtml(h.fromHandle)}</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" class="text-fg-muted">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          <span class="mail-to">${escapeHtml(h.toHandle)}</span>
        </div>
        <span class="mail-time">${h.createdAt ? dayjs(h.createdAt).fromNow() : ''}</span>
      </div>
      ${h.reason ? `<div class="mail-subject">${escapeHtml(h.reason.slice(0, 120))}</div>` : ''}
      ${h.context ? `<div class="mail-body">${escapeHtml(JSON.stringify(h.context).slice(0, 200))}</div>` : ''}
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
          <button class="mail-tab" data-tab="handoffs">Handoffs</button>
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
      const listEl = document.getElementById('mail-list');
      if (!listEl) return;

      if (currentTab === 'handoffs') {
        const handoffs = await getHandoffs(handle).catch(() => []);
        const list: Handoff[] = Array.isArray(handoffs) ? handoffs : [];
        if (list.length === 0) {
          listEl.innerHTML = `
            <div class="empty-state p-xl">
              <div class="empty-state-text">No handoffs</div>
            </div>
          `;
        } else {
          listEl.innerHTML = list.map(renderHandoffItem).join('');
        }
        return;
      }

      let messages: MailMessage[];
      if (currentTab === 'unread') {
        messages = await getMailUnread(handle);
      } else {
        messages = (await getMail(handle)) as MailMessage[];
      }
      const list: MailMessage[] = Array.isArray(messages) ? messages : [];
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

  // Tab switching + mark read + handoff create
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    const tab = target.closest('.mail-tab') as HTMLElement | null;
    if (tab) {
      currentTab = tab.dataset.tab || 'all';
      container.querySelectorAll('.mail-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      await loadMail();
      return;
    }

    // Mark read
    const markReadBtn = target.closest('.mail-mark-read') as HTMLElement | null;
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
      return;
    }

    // Create handoff
    if (target.closest('#create-handoff')) {
      const fromHandle = prompt('From handle:');
      if (!fromHandle) return;
      const toHandle = prompt('To handle:');
      if (!toHandle) return;
      const reason = prompt('Reason:') || undefined;
      try {
        await createHandoff({ fromHandle, toHandle, reason });
        toast.success('Handoff created');
        if (currentTab === 'handoffs') await loadMail();
      } catch (err) {
        toast.error('Failed to create handoff: ' + (err as Error).message);
      }
    }
  });

  // Compose form
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

  // Update compose dropdown when workers change
  const unsubWorkers = store.subscribe('workers', (updatedWorkers: WorkerInfo[]) => {
    const compose = document.getElementById('mail-compose');
    if (compose) compose.innerHTML = renderCompose(updatedWorkers);
  });

  return () => {
    unsubWorkers();
  };
}
