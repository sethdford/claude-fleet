/**
 * WebSocket Manager for Real-time Updates
 * Handles connection, authentication, and event dispatching
 */

import { getToken, getUser, isAuthenticated } from '@/api';

type WsEventCallback = (data: unknown) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, Set<WsEventCallback>>();
  private connectionId = 0;
  connected = false;
  authenticated = false;

  /** Connect to the WebSocket server. */
  connect(): void {
    // Prevent duplicate connections in any non-closed state
    if (this.ws) {
      const state = this.ws.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
      // Clean up closed/closing sockets — remove handlers to prevent stale onclose from firing
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.connectionId++;
    const connId = this.connectionId;
    this.ws = new WebSocket(wsUrl);
    this.updateStatus('connecting');

    this.ws.onopen = () => {
      console.log(`[WS] Connected (conn #${connId})`);
      this.connected = true;
      this.reconnectAttempts = 0;
      this.updateStatus('connected');

      const token = getToken();
      if (token) this.send({ type: 'auth', token });

      this.emit('connected');
    };

    // Capture reference to detect stale close events from superseded sockets
    const currentWs = this.ws;
    this.ws.onclose = () => {
      if (this.ws !== currentWs) return; // Ignore close from a replaced socket
      console.log(`[WS] Disconnected (conn #${connId})`);
      this.connected = false;
      this.authenticated = false;
      this.updateStatus('disconnected');
      this.emit('disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
      this.emit('error', error);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        this.handleMessage(data);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };
  }

  /** Handle incoming messages and map them to typed events. */
  private handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'authenticated':
        this.authenticated = true;
        console.log('[WS] Authenticated');
        this.emit('authenticated', data);
        break;

      case 'error':
        console.error('[WS] Server error:', data.message);
        this.emit('error', { message: data.message });
        break;

      case 'worker_spawned':
        this.emit('worker:spawned', data.worker);
        break;

      case 'worker_dismissed':
        this.emit('worker:dismissed', { handle: data.handle });
        break;

      case 'worker_output':
        this.emit('worker:output', { handle: data.handle, output: data.output });
        break;

      case 'new_message':
        this.emit('message:new', data);
        break;

      case 'task_assigned':
        this.emit('task:assigned', data);
        break;

      case 'task_updated':
        this.emit('task:updated', data);
        break;

      case 'blackboard_message':
        this.emit('blackboard:message', data);
        break;

      case 'swarm_created':
        this.emit('swarm:created', data.swarm);
        break;

      case 'swarm_killed':
        this.emit('swarm:killed', data);
        break;

      case 'subscribed':
        this.emit('subscribed', { chatId: data.chatId });
        break;

      case 'pong':
        break;

      default:
        this.emit(data.type as string, data);
    }
  }

  /** Send a JSON payload through the socket. */
  send(data: Record<string, unknown>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /** Subscribe to a chat room. */
  subscribe(chatId: string): void {
    const user = getUser();
    this.send({ type: 'subscribe', chatId, uid: user?.uid });
  }

  /** Unsubscribe from a chat room. */
  unsubscribe(chatId: string): void {
    this.send({ type: 'unsubscribe', chatId });
  }

  /** Send ping to keep connection alive. */
  ping(): void {
    this.send({ type: 'ping' });
  }

  /** Disconnect from the WebSocket server. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional disconnect
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  /** Attempt to reconnect with exponential backoff. */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    // Cancel any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected && isAuthenticated()) {
        this.connect();
      }
    }, delay);
  }

  /** Update connection status DOM elements. */
  private updateStatus(status: string): void {
    const statusEl = document.getElementById('connection-status');
    const textEl = document.getElementById('connection-text');

    if (statusEl && textEl) {
      statusEl.className = `connection-status ${status}`;
      textEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  /** Add an event listener. Returns an unsubscribe function. */
  on(event: string, callback: WsEventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  /** Remove an event listener. */
  off(event: string, callback: WsEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  /** Emit an event to all listeners. */
  private emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`[WS] Error in ${event} handler:`, e);
      }
    });
  }
}

const wsManager = new WebSocketManager();
export default wsManager;
