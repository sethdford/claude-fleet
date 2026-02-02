/**
 * Worker Chat Panel
 * Renders chat list, messages, and compose form for worker detail view.
 */

import dayjs from 'dayjs';
import { escapeHtml } from '@/utils/escape-html';
import type { Chat, ChatMessage } from '@/types';

/**
 * Render the chat panel: sidebar with chat list + message area.
 */
export function renderChatPanel(
  chats: Chat[],
  messages: ChatMessage[],
  activeChatId: string | null,
): string {
  return `
    <div class="flex gap-md" style="min-height: 400px;">
      <!-- Chat list sidebar -->
      <div class="card" style="width: 240px; flex-shrink: 0;">
        <div class="card-header">
          <h3 class="card-title">Chats</h3>
          <button class="btn btn-sm btn-primary" id="create-chat-btn">+</button>
        </div>
        <div class="chat-list max-h-[350px] overflow-y-auto">
          ${chats.length === 0
            ? '<div class="p-md text-fg-muted text-sm">No chats yet</div>'
            : chats.map((c) => `
              <div class="chat-list-item p-sm border-b border-edge cursor-pointer ${c.id === activeChatId ? 'bg-surface-raised' : ''}" data-chat-id="${escapeHtml(c.id)}">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium">${escapeHtml(c.participants?.slice(0, 2).join(', ') || c.id.slice(0, 8))}</span>
                  ${(c.unreadCount || 0) > 0 ? `<span class="badge red">${c.unreadCount}</span>` : ''}
                </div>
                <div class="text-xs text-fg-muted">${c.lastMessageAt ? dayjs(c.lastMessageAt).fromNow() : ''}</div>
              </div>
            `).join('')}
        </div>
      </div>

      <!-- Message area -->
      <div class="card flex-1 flex flex-col">
        ${activeChatId
          ? `
            <div class="card-header">
              <h3 class="card-title">Messages</h3>
              <button class="btn btn-sm btn-secondary mark-chat-read-btn" data-chat-id="${escapeHtml(activeChatId)}">Mark Read</button>
            </div>
            <div class="chat-messages flex-1 overflow-y-auto p-md" style="max-height: 300px;">
              ${messages.length === 0
                ? '<div class="text-fg-muted text-sm">No messages</div>'
                : messages.map((m) => `
                  <div class="chat-message mb-sm">
                    <div class="flex items-center gap-sm mb-xs">
                      <span class="font-semibold text-sm">${escapeHtml(m.senderUid)}</span>
                      <span class="text-xs text-fg-muted">${m.createdAt ? dayjs(m.createdAt).fromNow() : ''}</span>
                    </div>
                    <div class="text-sm p-sm bg-surface-alt rounded-md">${escapeHtml(m.body)}</div>
                  </div>
                `).join('')}
            </div>
            <div class="p-sm border-t border-edge">
              <form id="chat-send-form" class="flex gap-sm">
                <input type="text" class="form-input flex-1" id="chat-message-input" placeholder="Type a message...">
                <button type="submit" class="btn btn-primary btn-sm">Send</button>
              </form>
            </div>
          `
          : `
            <div class="empty-state flex-1">
              <div class="empty-state-text">Select a chat or create a new one</div>
            </div>
          `}
      </div>
    </div>
  `;
}
