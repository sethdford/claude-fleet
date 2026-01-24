/**
 * WebSocket Manager for Real-time Updates
 * Handles connection, authentication, and event dispatching
 */

import ApiClient from './api.js';

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.listeners = new Map();
    this.connected = false;
    this.authenticated = false;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);
    this.updateStatus('connecting');

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.updateStatus('connected');

      // Authenticate with token
      const token = ApiClient.getToken();
      if (token) {
        this.send({ type: 'auth', token });
      }

      this.emit('connected');
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
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

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(data) {
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
        this.emit('worker:output', {
          handle: data.handle,
          output: data.output,
        });
        break;

      case 'new_message':
        this.emit('message:new', data);
        break;

      case 'task_assigned':
        this.emit('task:assigned', data);
        break;

      case 'subscribed':
        this.emit('subscribed', { chatId: data.chatId });
        break;

      case 'pong':
        // Heartbeat response
        break;

      default:
        // Emit generic event for unknown types
        this.emit(data.type, data);
    }
  }

  /**
   * Send a message through WebSocket
   */
  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Subscribe to a chat
   */
  subscribe(chatId) {
    const user = ApiClient.getUser();
    this.send({
      type: 'subscribe',
      chatId,
      uid: user?.uid,
    });
  }

  /**
   * Unsubscribe from a chat
   */
  unsubscribe(chatId) {
    this.send({
      type: 'unsubscribe',
      chatId,
    });
  }

  /**
   * Send ping to keep connection alive
   */
  ping() {
    this.send({ type: 'ping' });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Attempt to reconnect after disconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (!this.connected && ApiClient.isAuthenticated()) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Update connection status UI
   */
  updateStatus(status) {
    const statusEl = document.getElementById('connection-status');
    const textEl = document.getElementById('connection-text');

    if (statusEl && textEl) {
      statusEl.className = `connection-status ${status}`;
      textEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Emit event to listeners
   */
  emit(event, data) {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`[WS] Error in ${event} handler:`, e);
      }
    });
  }
}

// Singleton instance
const wsManager = new WebSocketManager();
export default wsManager;
