/**
 * Fleet Coordination Tests
 *
 * Tests for:
 * - BlackboardStorage: Inter-agent messaging
 * - SpawnQueueStorage: Managed agent spawning with DAG dependencies
 * - CheckpointStorage: Session continuity
 * - SpawnController: Agent limits and spawn control
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../src/storage/sqlite.js';
import { BlackboardStorage } from '../src/storage/blackboard.js';
import { SpawnQueueStorage } from '../src/storage/spawn-queue.js';
import { CheckpointStorage } from '../src/storage/checkpoint.js';
import { SpawnController, SOFT_AGENT_LIMIT, HARD_AGENT_LIMIT, MAX_DEPTH_LEVEL } from '../src/workers/spawn-controller.js';
import { AGENT_ROLES, getSystemPromptForRole, isSpawnAllowed, getMaxDepthForRole } from '../src/workers/agent-roles.js';
import type { FleetAgentRole } from '../src/workers/agent-roles.js';

// ============================================================================
// TEST SETUP
// ============================================================================

let storage: SQLiteStorage;
let blackboard: BlackboardStorage;
let spawnQueue: SpawnQueueStorage;
let checkpoint: CheckpointStorage;

beforeEach(() => {
  // Use in-memory database for tests
  storage = new SQLiteStorage(':memory:');
  blackboard = new BlackboardStorage(storage);
  spawnQueue = new SpawnQueueStorage(storage);
  checkpoint = new CheckpointStorage(storage);
});

afterEach(() => {
  storage.close();
});

// ============================================================================
// BLACKBOARD STORAGE TESTS
// ============================================================================

describe('BlackboardStorage', () => {
  describe('postMessage', () => {
    it('should post a message to the blackboard', () => {
      const msg = blackboard.postMessage('swarm-1', 'agent-a', 'request', { task: 'analyze' });

      expect(msg.id).toBeDefined();
      expect(msg.swarmId).toBe('swarm-1');
      expect(msg.senderHandle).toBe('agent-a');
      expect(msg.messageType).toBe('request');
      expect(msg.payload).toEqual({ task: 'analyze' });
      expect(msg.priority).toBe('normal');
      expect(msg.readBy).toEqual([]);
    });

    it('should support targeted messages', () => {
      const msg = blackboard.postMessage('swarm-1', 'agent-a', 'directive', { command: 'stop' }, {
        targetHandle: 'agent-b',
        priority: 'critical',
      });

      expect(msg.targetHandle).toBe('agent-b');
      expect(msg.priority).toBe('critical');
    });

    it('should support all message types', () => {
      const types: Array<'request' | 'response' | 'status' | 'directive' | 'checkpoint'> = [
        'request', 'response', 'status', 'directive', 'checkpoint',
      ];

      for (const type of types) {
        const msg = blackboard.postMessage('swarm-1', 'agent-a', type, {});
        expect(msg.messageType).toBe(type);
      }
    });
  });

  describe('readMessages', () => {
    it('should read messages by swarm', () => {
      blackboard.postMessage('swarm-1', 'agent-a', 'request', { task: 'a' });
      blackboard.postMessage('swarm-2', 'agent-b', 'request', { task: 'b' });
      blackboard.postMessage('swarm-1', 'agent-c', 'response', { result: 'c' });

      const messages = blackboard.readMessages('swarm-1');
      expect(messages).toHaveLength(2);
      expect(messages.every(m => m.swarmId === 'swarm-1')).toBe(true);
    });

    it('should filter by message type', () => {
      blackboard.postMessage('swarm-1', 'agent-a', 'request', { task: 'a' });
      blackboard.postMessage('swarm-1', 'agent-b', 'response', { result: 'b' });

      const messages = blackboard.readMessages('swarm-1', { messageType: 'request' });
      expect(messages).toHaveLength(1);
      expect(messages[0].messageType).toBe('request');
    });

    it('should filter by priority', () => {
      blackboard.postMessage('swarm-1', 'agent-a', 'request', {}, { priority: 'low' });
      blackboard.postMessage('swarm-1', 'agent-b', 'request', {}, { priority: 'critical' });

      const messages = blackboard.readMessages('swarm-1', { priority: 'critical' });
      expect(messages).toHaveLength(1);
      expect(messages[0].priority).toBe('critical');
    });

    it('should filter unread only', () => {
      const msg1 = blackboard.postMessage('swarm-1', 'agent-a', 'request', {});
      blackboard.postMessage('swarm-1', 'agent-b', 'request', {});

      blackboard.markRead([msg1.id], 'reader');

      const unread = blackboard.readMessages('swarm-1', {
        unreadOnly: true,
        readerHandle: 'reader',
      });
      expect(unread).toHaveLength(1);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        blackboard.postMessage('swarm-1', 'agent-a', 'request', { index: i });
      }

      const messages = blackboard.readMessages('swarm-1', { limit: 5 });
      expect(messages).toHaveLength(5);
    });
  });

  describe('markRead', () => {
    it('should mark messages as read', () => {
      const msg = blackboard.postMessage('swarm-1', 'agent-a', 'request', {});
      expect(msg.readBy).toEqual([]);

      const count = blackboard.markRead([msg.id], 'reader');
      expect(count).toBe(1);

      const messages = blackboard.readMessages('swarm-1');
      expect(messages[0].readBy).toContain('reader');
    });

    it('should not duplicate readers', () => {
      const msg = blackboard.postMessage('swarm-1', 'agent-a', 'request', {});

      blackboard.markRead([msg.id], 'reader');
      blackboard.markRead([msg.id], 'reader');

      const messages = blackboard.readMessages('swarm-1');
      expect(messages[0].readBy.filter(r => r === 'reader')).toHaveLength(1);
    });
  });

  describe('archiveMessages', () => {
    it('should archive messages', () => {
      const msg = blackboard.postMessage('swarm-1', 'agent-a', 'request', {});

      const count = blackboard.archiveMessages([msg.id]);
      expect(count).toBe(1);

      const messages = blackboard.readMessages('swarm-1');
      expect(messages).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      blackboard.postMessage('swarm-1', 'agent-a', 'request', {}, { priority: 'low' });
      blackboard.postMessage('swarm-1', 'agent-b', 'request', {}, { priority: 'high' });
      blackboard.postMessage('swarm-1', 'agent-c', 'response', {}, { priority: 'critical' });

      const stats = blackboard.getStats('swarm-1');
      expect(stats.total).toBe(3);
      expect(stats.byType.request).toBe(2);
      expect(stats.byType.response).toBe(1);
      expect(stats.byPriority.low).toBe(1);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.critical).toBe(1);
    });
  });
});

// ============================================================================
// SPAWN QUEUE STORAGE TESTS
// ============================================================================

describe('SpawnQueueStorage', () => {
  describe('enqueue', () => {
    it('should enqueue a spawn request', () => {
      const item = spawnQueue.enqueue('lead', 'worker', 1, 'Implement feature X');

      expect(item.id).toBeDefined();
      expect(item.requesterHandle).toBe('lead');
      expect(item.targetAgentType).toBe('worker');
      expect(item.depthLevel).toBe(1);
      expect(item.status).toBe('pending');
      expect(item.payload.task).toBe('Implement feature X');
    });

    it('should support priority levels', () => {
      const item = spawnQueue.enqueue('lead', 'worker', 1, 'Urgent task', { priority: 'critical' });
      expect(item.priority).toBe('critical');
    });

    it('should track dependencies', () => {
      const item1 = spawnQueue.enqueue('lead', 'worker', 1, 'Task 1');
      const item2 = spawnQueue.enqueue('lead', 'worker', 1, 'Task 2', { dependsOn: [item1.id] });

      expect(item2.dependsOn).toContain(item1.id);
      expect(item2.blockedByCount).toBe(1);
    });
  });

  describe('getReady', () => {
    it('should return items with no blockers', () => {
      spawnQueue.enqueue('lead', 'worker', 1, 'Task 1');
      spawnQueue.enqueue('lead', 'worker', 1, 'Task 2');

      const ready = spawnQueue.getReady(10);
      expect(ready).toHaveLength(2);
    });

    it('should not return blocked items', () => {
      const item1 = spawnQueue.enqueue('lead', 'worker', 1, 'Task 1');
      spawnQueue.enqueue('lead', 'worker', 1, 'Task 2', { dependsOn: [item1.id] });

      const ready = spawnQueue.getReady(10);
      expect(ready).toHaveLength(1);
      expect(ready[0].payload.task).toBe('Task 1');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        spawnQueue.enqueue('lead', 'worker', 1, `Task ${i}`);
      }

      const ready = spawnQueue.getReady(3);
      expect(ready).toHaveLength(3);
    });

    it('should prioritize by priority level', () => {
      spawnQueue.enqueue('lead', 'worker', 1, 'Low priority', { priority: 'low' });
      spawnQueue.enqueue('lead', 'worker', 1, 'Critical priority', { priority: 'critical' });
      spawnQueue.enqueue('lead', 'worker', 1, 'Normal priority');

      const ready = spawnQueue.getReady(3);
      expect(ready[0].payload.task).toBe('Critical priority');
    });
  });

  describe('approve/reject', () => {
    it('should approve pending items', () => {
      const item = spawnQueue.enqueue('lead', 'worker', 1, 'Task');

      const success = spawnQueue.approve(item.id);
      expect(success).toBe(true);

      const updated = spawnQueue.get(item.id);
      expect(updated?.status).toBe('approved');
    });

    it('should reject pending items', () => {
      const item = spawnQueue.enqueue('lead', 'worker', 1, 'Task');

      const success = spawnQueue.reject(item.id);
      expect(success).toBe(true);

      const updated = spawnQueue.get(item.id);
      expect(updated?.status).toBe('rejected');
    });
  });

  describe('markSpawned', () => {
    it('should mark item as spawned and decrement dependents', () => {
      const item1 = spawnQueue.enqueue('lead', 'worker', 1, 'Task 1');
      const item2 = spawnQueue.enqueue('lead', 'worker', 1, 'Task 2', { dependsOn: [item1.id] });

      // Initially item2 is blocked
      expect(spawnQueue.get(item2.id)?.blockedByCount).toBe(1);

      // Mark item1 as spawned
      spawnQueue.markSpawned(item1.id, 'worker-123');

      // Now item2 should be unblocked
      expect(spawnQueue.get(item2.id)?.blockedByCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      spawnQueue.enqueue('lead', 'worker', 1, 'Task 1');
      const item2 = spawnQueue.enqueue('lead', 'scout', 1, 'Task 2');
      spawnQueue.approve(item2.id);

      const stats = spawnQueue.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus.approved).toBe(1);
      expect(stats.ready).toBe(1);
      expect(stats.blocked).toBe(0);
    });
  });
});

// ============================================================================
// CHECKPOINT STORAGE TESTS
// ============================================================================

describe('CheckpointStorage', () => {
  describe('createCheckpoint', () => {
    it('should create a checkpoint', () => {
      const cp = checkpoint.createCheckpoint('agent-a', 'agent-b', {
        goal: 'Implement authentication',
        now: 'Add JWT middleware',
        test: 'npm test',
      });

      expect(cp.id).toBeDefined();
      expect(cp.fromHandle).toBe('agent-a');
      expect(cp.toHandle).toBe('agent-b');
      expect(cp.checkpoint.goal).toBe('Implement authentication');
      expect(cp.checkpoint.now).toBe('Add JWT middleware');
      expect(cp.checkpoint.test).toBe('npm test');
      expect(cp.status).toBe('pending');
    });

    it('should include optional fields', () => {
      const cp = checkpoint.createCheckpoint('agent-a', 'agent-b', {
        goal: 'Test goal',
        now: 'Test now',
        doneThisSession: [{ task: 'Added login', files: ['auth.ts'] }],
        blockers: ['Missing API key'],
        questions: ['What auth provider?'],
        next: ['Add logout', 'Add refresh tokens'],
      });

      expect(cp.checkpoint.doneThisSession).toHaveLength(1);
      expect(cp.checkpoint.blockers).toContain('Missing API key');
      expect(cp.checkpoint.questions).toHaveLength(1);
      expect(cp.checkpoint.next).toHaveLength(2);
    });
  });

  describe('loadCheckpoint', () => {
    it('should load checkpoint by ID', () => {
      const created = checkpoint.createCheckpoint('agent-a', 'agent-b', {
        goal: 'Test',
        now: 'Testing',
      });

      const loaded = checkpoint.loadCheckpoint(created.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.checkpoint.goal).toBe('Test');
    });

    it('should return null for non-existent ID', () => {
      const loaded = checkpoint.loadCheckpoint(99999);
      expect(loaded).toBeNull();
    });
  });

  describe('loadLatestCheckpoint', () => {
    it('should load the most recent checkpoint for a handle', () => {
      checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: 'First', now: 'now' });
      checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: 'Second', now: 'now' });

      const latest = checkpoint.loadLatestCheckpoint('agent-b');
      expect(latest?.checkpoint.goal).toBe('Second');
    });
  });

  describe('accept/reject', () => {
    it('should accept pending checkpoints', () => {
      const cp = checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: 'Test', now: 'now' });

      const success = checkpoint.acceptCheckpoint(cp.id);
      expect(success).toBe(true);

      const loaded = checkpoint.loadCheckpoint(cp.id);
      expect(loaded?.status).toBe('accepted');
      expect(loaded?.acceptedAt).not.toBeNull();
    });

    it('should reject pending checkpoints', () => {
      const cp = checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: 'Test', now: 'now' });

      const success = checkpoint.rejectCheckpoint(cp.id);
      expect(success).toBe(true);

      const loaded = checkpoint.loadCheckpoint(cp.id);
      expect(loaded?.status).toBe('rejected');
    });
  });

  describe('listCheckpoints', () => {
    it('should list checkpoints for a handle', () => {
      checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: '1', now: 'now' });
      checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: '2', now: 'now' });
      checkpoint.createCheckpoint('agent-c', 'agent-b', { goal: '3', now: 'now' });

      const list = checkpoint.listCheckpoints('agent-b');
      expect(list).toHaveLength(3);
    });

    it('should filter by status', () => {
      const cp1 = checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: '1', now: 'now' });
      checkpoint.createCheckpoint('agent-a', 'agent-b', { goal: '2', now: 'now' });
      checkpoint.acceptCheckpoint(cp1.id);

      const pending = checkpoint.listCheckpoints('agent-b', { status: 'pending' });
      expect(pending).toHaveLength(1);

      const accepted = checkpoint.listCheckpoints('agent-b', { status: 'accepted' });
      expect(accepted).toHaveLength(1);
    });
  });

  describe('YAML conversion', () => {
    it('should convert checkpoint to YAML', () => {
      const cp = {
        goal: 'Test goal',
        now: 'Test current state',
        test: 'npm test',
        doneThisSession: [{ task: 'Added feature', files: ['feature.ts'] }],
        blockers: ['Need API key'],
        questions: [],
        worked: ['TDD approach'],
        failed: [],
        next: ['Add tests'],
        files: { created: ['new.ts'], modified: ['existing.ts'] },
      };

      const yaml = checkpoint.toYaml(cp);
      expect(yaml).toContain('goal: Test goal');
      expect(yaml).toContain('now: Test current state');
      expect(yaml).toContain('test: npm test');
      expect(yaml).toContain('blockers:');
      expect(yaml).toContain('next:');
    });

    it('should parse YAML back to checkpoint', () => {
      const yaml = `---
goal: Test goal
now: Test current state
test: npm test
blockers: [Need API key]
next:
  - Add tests
  - Write docs
files:
  created: [new.ts]
  modified: [existing.ts]`;

      const parsed = checkpoint.fromYaml(yaml);
      expect(parsed).not.toBeNull();
      expect(parsed?.goal).toBe('Test goal');
      expect(parsed?.now).toBe('Test current state');
      expect(parsed?.blockers).toContain('Need API key');
      expect(parsed?.next).toHaveLength(2);
    });
  });
});

// ============================================================================
// AGENT ROLES TESTS
// ============================================================================

describe('Agent Roles', () => {
  describe('AGENT_ROLES', () => {
    it('should define all expected roles', () => {
      const expectedRoles: FleetAgentRole[] = ['lead', 'worker', 'scout', 'kraken', 'oracle', 'critic', 'architect'];
      for (const role of expectedRoles) {
        expect(AGENT_ROLES[role]).toBeDefined();
        expect(AGENT_ROLES[role].name).toBe(role);
      }
    });

    it('should have valid max depths', () => {
      for (const role of Object.values(AGENT_ROLES)) {
        expect(role.maxDepth).toBeGreaterThanOrEqual(1);
        expect(role.maxDepth).toBeLessThanOrEqual(3);
      }
    });

    it('should only allow lead to spawn', () => {
      expect(AGENT_ROLES.lead.canSpawn).toBe(true);
      for (const [name, role] of Object.entries(AGENT_ROLES)) {
        if (name !== 'lead') {
          expect(role.canSpawn).toBe(false);
        }
      }
    });
  });

  describe('getSystemPromptForRole', () => {
    it('should return non-empty prompts for all roles', () => {
      const roles: FleetAgentRole[] = ['lead', 'worker', 'scout', 'kraken', 'oracle', 'critic', 'architect'];
      for (const role of roles) {
        const prompt = getSystemPromptForRole(role);
        expect(prompt).toBeTruthy();
        expect(prompt.length).toBeGreaterThan(50);
      }
    });
  });

  describe('isSpawnAllowed', () => {
    it('should allow lead to spawn workers at depth 0', () => {
      const result = isSpawnAllowed('lead', 0, 'worker');
      expect(result.allowed).toBe(true);
    });

    it('should not allow workers to spawn', () => {
      const result = isSpawnAllowed('worker', 1, 'scout');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot spawn');
    });

    it('should enforce max depth', () => {
      const result = isSpawnAllowed('lead', 3, 'scout');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });
  });

  describe('getMaxDepthForRole', () => {
    it('should return correct max depths', () => {
      expect(getMaxDepthForRole('lead')).toBe(1);
      expect(getMaxDepthForRole('worker')).toBe(2);
      expect(getMaxDepthForRole('scout')).toBe(3);
    });
  });
});

// ============================================================================
// SPAWN CONTROLLER TESTS
// ============================================================================

describe('SpawnController', () => {
  describe('constants', () => {
    it('should have expected limits', () => {
      expect(SOFT_AGENT_LIMIT).toBe(50);
      expect(HARD_AGENT_LIMIT).toBe(100);
      expect(MAX_DEPTH_LEVEL).toBe(3);
    });
  });

  describe('canSpawn', () => {
    it('should allow spawning when under limits', () => {
      const controller = new SpawnController({ softLimit: 10, hardLimit: 20 });
      const result = controller.canSpawn('lead', 0, 'worker');
      expect(result.allowed).toBe(true);
    });

    it('should warn at soft limit', () => {
      const controller = new SpawnController({ softLimit: 0, hardLimit: 20 });
      const result = controller.canSpawn('lead', 0, 'worker');
      expect(result.allowed).toBe(true);
      expect(result.warning).toContain('Soft agent limit');
    });

    it('should reject at hard limit', () => {
      const controller = new SpawnController({ softLimit: 0, hardLimit: 0 });
      const result = controller.canSpawn('lead', 0, 'worker');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hard agent limit');
    });

    it('should reject at max depth', () => {
      const controller = new SpawnController({ maxDepth: 2 });
      const result = controller.canSpawn('lead', 2, 'worker');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });
  });

  describe('registerSpawn/unregisterSpawn', () => {
    it('should track agent count', () => {
      const controller = new SpawnController();

      expect(controller.getCurrentCount()).toBe(0);

      controller.registerSpawn(1234, 'worker-1', 'w1');
      expect(controller.getCurrentCount()).toBe(1);

      controller.registerSpawn(1235, 'worker-2', 'w2');
      expect(controller.getCurrentCount()).toBe(2);

      controller.unregisterSpawn(1234, 'worker-1');
      expect(controller.getCurrentCount()).toBe(1);
    });
  });

  describe('getLimits', () => {
    it('should return correct limit info', () => {
      const controller = new SpawnController({ softLimit: 10, hardLimit: 20 });
      controller.registerSpawn(1234, 'worker-1', 'w1');

      const limits = controller.getLimits();
      expect(limits.current).toBe(1);
      expect(limits.soft).toBe(10);
      expect(limits.hard).toBe(20);
      expect(limits.remaining).toBe(19);
    });
  });
});
