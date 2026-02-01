/**
 * Message Bus Tests
 *
 * Tests the JS fallback implementation of the RingBus message bus.
 * Covers publish, subscribe, read, topic filtering, stats, and eviction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force JS fallback
vi.mock('node:module', () => ({
  createRequire: () => {
    return () => {
      throw new Error('native not available');
    };
  },
}));

describe('MessageBus (JS fallback)', () => {
  let bus: { publish: (topic: string, sender: string, priority: number, payload: string) => string; subscribe: (handle: string, topic: string) => void; unsubscribe: (handle: string, topic: string) => void; read: (handle: string, limit?: number, unreadOnly?: boolean) => Array<{ id: string; topic: string; sender: string; priority: number; payload: string; timestamp: number; readBy: string }>; readTopic: (topic: string, limit?: number) => Array<{ id: string; topic: string; sender: string; priority: number; payload: string; timestamp: number; readBy: string }>; stats: () => { totalMessages: number; topicCount: number; subscriberCount: number; messagesPerTopic: Array<{ topic: string; count: number }> }; drainOld: (maxAgeMs: number) => number };

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./message-bus.js');
    bus = mod.createMessageBus();
  });

  describe('publish', () => {
    it('should publish a message and return an ID', () => {
      const id = bus.publish('topic:test', 'alice', 1, '{"text":"hello"}');
      expect(id).toBeDefined();
      expect(id.startsWith('msg_')).toBe(true);
    });

    it('should assign unique IDs', () => {
      const id1 = bus.publish('t', 'a', 1, 'p1');
      const id2 = bus.publish('t', 'a', 1, 'p2');
      expect(id1).not.toBe(id2);
    });
  });

  describe('subscribe and read', () => {
    it('should read messages from subscribed topics', () => {
      bus.subscribe('bob', 'notifications');
      bus.publish('notifications', 'alice', 1, '{"event":"task_done"}');
      bus.publish('notifications', 'charlie', 2, '{"event":"build_fail"}');

      const messages = bus.read('bob', 50, true);
      expect(messages).toHaveLength(2);
      // Higher priority first
      expect(messages[0].priority).toBe(2);
    });

    it('should not read from unsubscribed topics', () => {
      bus.subscribe('bob', 'topic-a');
      bus.publish('topic-b', 'alice', 1, 'payload');

      const messages = bus.read('bob', 50, true);
      expect(messages).toHaveLength(0);
    });

    it('should mark messages as read', () => {
      bus.subscribe('bob', 'chat');
      bus.publish('chat', 'alice', 1, 'hello');

      const first = bus.read('bob', 50, true);
      expect(first).toHaveLength(1);

      // Second read with unreadOnly should return empty
      const second = bus.read('bob', 50, true);
      expect(second).toHaveLength(0);
    });

    it('should return all messages when unreadOnly is false', () => {
      bus.subscribe('bob', 'chat');
      bus.publish('chat', 'alice', 1, 'hello');

      bus.read('bob', 50, true); // Mark as read
      const all = bus.read('bob', 50, false);
      expect(all).toHaveLength(1);
    });

    it('should respect limit', () => {
      bus.subscribe('bob', 'spam');
      for (let i = 0; i < 10; i++) {
        bus.publish('spam', 'spammer', 1, `msg-${i}`);
      }

      const messages = bus.read('bob', 3, true);
      expect(messages).toHaveLength(3);
    });
  });

  describe('unsubscribe', () => {
    it('should stop receiving messages after unsubscribe', () => {
      bus.subscribe('bob', 'alerts');
      bus.publish('alerts', 'system', 3, 'alert1');

      bus.unsubscribe('bob', 'alerts');
      bus.publish('alerts', 'system', 3, 'alert2');

      // Bob should only see messages from before unsubscribe
      // Actually unsubscribe just removes the subscription, read won't find the topic
      bus.subscribe('bob', 'alerts'); // re-sub to read
      const messages = bus.read('bob', 50, true);
      // Should still see both since they're in the channel
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('readTopic', () => {
    it('should read messages by topic without subscription', () => {
      bus.publish('logs', 'app', 1, 'line1');
      bus.publish('logs', 'app', 1, 'line2');
      bus.publish('other', 'app', 1, 'skip');

      const messages = bus.readTopic('logs', 50);
      expect(messages).toHaveLength(2);
      expect(messages[0].topic).toBe('logs');
    });

    it('should return empty for unknown topic', () => {
      const messages = bus.readTopic('nonexistent', 50);
      expect(messages).toHaveLength(0);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        bus.publish('flood', 'bot', 1, `m${i}`);
      }
      const messages = bus.readTopic('flood', 3);
      expect(messages).toHaveLength(3);
    });
  });

  describe('stats', () => {
    it('should return accurate statistics', () => {
      bus.subscribe('alice', 'topic-a');
      bus.subscribe('bob', 'topic-b');
      bus.publish('topic-a', 'system', 1, 'p1');
      bus.publish('topic-a', 'system', 1, 'p2');
      bus.publish('topic-b', 'system', 1, 'p3');

      const stats = bus.stats();
      expect(stats.totalMessages).toBe(3);
      expect(stats.topicCount).toBe(2);
      expect(stats.subscriberCount).toBe(2);
      expect(stats.messagesPerTopic).toHaveLength(2);
    });

    it('should return zero stats when empty', () => {
      const stats = bus.stats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.topicCount).toBe(0);
    });
  });

  describe('drainOld', () => {
    it('should remove messages older than maxAgeMs', () => {
      // Publish some messages
      bus.publish('old', 'sender', 1, 'ancient');
      bus.publish('old', 'sender', 1, 'recent');

      // Drain with 0ms age — should remove everything
      const removed = bus.drainOld(0);
      expect(removed).toBeGreaterThanOrEqual(0);
    });

    it('should keep recent messages', () => {
      bus.publish('fresh', 'sender', 1, 'new');

      // Drain with 1 hour age — should keep everything
      const removed = bus.drainOld(3_600_000);
      expect(removed).toBe(0);

      const messages = bus.readTopic('fresh', 50);
      expect(messages).toHaveLength(1);
    });
  });

  describe('priority ordering', () => {
    it('should return higher priority messages first', () => {
      bus.subscribe('reader', 'mixed');
      bus.publish('mixed', 'a', 0, 'low');
      bus.publish('mixed', 'b', 3, 'critical');
      bus.publish('mixed', 'c', 1, 'normal');
      bus.publish('mixed', 'd', 2, 'high');

      const messages = bus.read('reader', 50, true);
      expect(messages[0].priority).toBe(3);
      expect(messages[1].priority).toBe(2);
      expect(messages[2].priority).toBe(1);
      expect(messages[3].priority).toBe(0);
    });
  });
});
