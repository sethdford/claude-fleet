/**
 * Message Bus (RingBus Accelerator)
 *
 * Native Rust acceleration for inter-agent message passing:
 * - Topic-based pub/sub with VecDeque ring buffers
 * - Priority-ordered message reads
 * - Read tracking per subscriber
 * - O(1) eviction at capacity
 *
 * Falls back to pure JS when Rust addon is unavailable.
 */

import { createRequire } from 'node:module';

// ============================================================================
// Types
// ============================================================================

export interface BusMessage {
  id: string;
  topic: string;
  sender: string;
  priority: number;
  payload: string;
  timestamp: number;
  readBy: string;
}

export interface BusStats {
  totalMessages: number;
  topicCount: number;
  subscriberCount: number;
  messagesPerTopic: Array<{ topic: string; count: number }>;
}

export interface MessageBus {
  publish(topic: string, sender: string, priority: number, payload: string): string;
  subscribe(handle: string, topic: string): void;
  unsubscribe(handle: string, topic: string): void;
  read(handle: string, limit?: number, unreadOnly?: boolean): BusMessage[];
  readTopic(topic: string, limit?: number): BusMessage[];
  stats(): BusStats;
  drainOld(maxAgeMs: number): number;
}

// ============================================================================
// Native implementation
// ============================================================================

function createNativeBus(native: Record<string, unknown>): MessageBus {
  const bus = new (native as { RingBus: new () => Record<string, (...args: unknown[]) => unknown> }).RingBus();

  return {
    publish(topic, sender, priority, payload) {
      return bus.publish(topic, sender, priority, payload) as string;
    },
    subscribe(handle, topic) {
      bus.subscribe(handle, topic);
    },
    unsubscribe(handle, topic) {
      bus.unsubscribe(handle, topic);
    },
    read(handle, limit, unreadOnly) {
      const msgs = bus.read(handle, limit ?? 50, unreadOnly ?? true) as Array<{
        id: string;
        topic: string;
        sender: string;
        priority: number;
        payload: string;
        timestamp: number;
        readBy: string;
      }>;
      return msgs.map((m) => ({
        id: m.id,
        topic: m.topic,
        sender: m.sender,
        priority: m.priority,
        payload: m.payload,
        timestamp: m.timestamp,
        readBy: m.readBy,
      }));
    },
    readTopic(topic, limit) {
      const msgs = bus.readTopic(topic, limit ?? 50) as Array<{
        id: string;
        topic: string;
        sender: string;
        priority: number;
        payload: string;
        timestamp: number;
        readBy: string;
      }>;
      return msgs.map((m) => ({
        id: m.id,
        topic: m.topic,
        sender: m.sender,
        priority: m.priority,
        payload: m.payload,
        timestamp: m.timestamp,
        readBy: m.readBy,
      }));
    },
    stats() {
      return bus.stats() as BusStats;
    },
    drainOld(maxAgeMs) {
      return bus.drainOld(maxAgeMs) as number;
    },
  };
}

// ============================================================================
// JS Fallback
// ============================================================================

const MAX_MESSAGES_PER_TOPIC = 10_000;

interface JSBusMessage {
  id: string;
  topic: string;
  sender: string;
  priority: number;
  payload: string;
  timestamp: number;
  readBy: Set<string>;
}

class JSMessageBus implements MessageBus {
  private channels = new Map<string, JSBusMessage[]>();
  private subscribers = new Map<string, Set<string>>();
  private nextId = 1;

  publish(topic: string, sender: string, priority: number, payload: string): string {
    const id = `msg_${this.nextId++}`;
    const msg: JSBusMessage = {
      id,
      topic,
      sender,
      priority: Math.min(priority, 3),
      payload,
      timestamp: Date.now(),
      readBy: new Set(),
    };

    let channel = this.channels.get(topic);
    if (!channel) {
      channel = [];
      this.channels.set(topic, channel);
    }

    if (channel.length >= MAX_MESSAGES_PER_TOPIC) {
      channel.shift();
    }

    channel.push(msg);
    return id;
  }

  subscribe(handle: string, topic: string): void {
    let topics = this.subscribers.get(handle);
    if (!topics) {
      topics = new Set();
      this.subscribers.set(handle, topics);
    }
    topics.add(topic);
  }

  unsubscribe(handle: string, topic: string): void {
    const topics = this.subscribers.get(handle);
    if (topics) {
      topics.delete(topic);
    }
  }

  read(handle: string, limit = 50, unreadOnly = true): BusMessage[] {
    const topics = this.subscribers.get(handle);
    if (!topics) return [];

    const messages: JSBusMessage[] = [];

    for (const topic of topics) {
      const channel = this.channels.get(topic);
      if (!channel) continue;

      for (let i = channel.length - 1; i >= 0; i--) {
        if (messages.length >= limit) break;
        const msg = channel[i];
        if (unreadOnly && msg.readBy.has(handle)) continue;
        messages.push(msg);
      }
    }

    // Sort by priority desc, timestamp asc
    messages.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
    messages.length = Math.min(messages.length, limit);

    // Mark as read
    for (const msg of messages) {
      msg.readBy.add(handle);
    }

    return messages.map((m) => ({
      id: m.id,
      topic: m.topic,
      sender: m.sender,
      priority: m.priority,
      payload: m.payload,
      timestamp: m.timestamp,
      readBy: Array.from(m.readBy).join(','),
    }));
  }

  readTopic(topic: string, limit = 50): BusMessage[] {
    const channel = this.channels.get(topic);
    if (!channel) return [];

    const result = channel.slice(-limit).reverse();
    return result.map((m) => ({
      id: m.id,
      topic: m.topic,
      sender: m.sender,
      priority: m.priority,
      payload: m.payload,
      timestamp: m.timestamp,
      readBy: Array.from(m.readBy).join(','),
    }));
  }

  stats(): BusStats {
    let totalMessages = 0;
    const messagesPerTopic: Array<{ topic: string; count: number }> = [];

    for (const [topic, channel] of this.channels) {
      totalMessages += channel.length;
      messagesPerTopic.push({ topic, count: channel.length });
    }

    messagesPerTopic.sort((a, b) => b.count - a.count);

    return {
      totalMessages,
      topicCount: this.channels.size,
      subscriberCount: this.subscribers.size,
      messagesPerTopic,
    };
  }

  drainOld(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [, channel] of this.channels) {
      const before = channel.length;
      const kept = channel.filter((m) => m.timestamp >= cutoff);
      removed += before - kept.length;
      channel.length = 0;
      channel.push(...kept);
    }

    return removed;
  }
}

// ============================================================================
// Factory
// ============================================================================

let cachedBus: MessageBus | null = null;

export function createMessageBus(): MessageBus {
  if (cachedBus) return cachedBus;

  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/ringbus') as Record<string, unknown>;
    cachedBus = createNativeBus(native);
    console.log('[ringbus] Using native Rust message bus');
  } catch {
    cachedBus = new JSMessageBus();
    console.log('[ringbus] Rust bus not available, using JS fallback');
  }

  return cachedBus;
}
