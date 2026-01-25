/**
 * Bead Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BeadStore } from './bead.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setDatabasePath, resetDatabase } from '../database.js';

describe('BeadStore', () => {
  let store: BeadStore;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-bead-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
    store = new BeadStore();
  });

  afterEach(() => {
    resetDatabase();
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateBeadId()', () => {
    it('generates ID with default prefix', () => {
      const id = store.generateBeadId();
      expect(id).toMatch(/^cc-[a-z0-9]{5}$/);
    });

    it('generates ID with custom prefix', () => {
      const id = store.generateBeadId('task');
      expect(id).toMatch(/^task-[a-z0-9]{5}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(store.generateBeadId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('create()', () => {
    it('creates a new bead', () => {
      const bead = store.create({
        title: 'Test Bead',
      });

      expect(bead.id).toMatch(/^cc-[a-z0-9]{5}$/);
      expect(bead.title).toBe('Test Bead');
      expect(bead.status).toBe('pending');
      expect(bead.createdAt).toBeDefined();
    });

    it('creates bead with optional fields', () => {
      const bead = store.create({
        title: 'Full Bead',
        description: 'A detailed description',
        metadata: { priority: 'high' },
      });

      expect(bead.description).toBe('A detailed description');
      expect(bead.metadata).toEqual({ priority: 'high' });
    });

    it('creates bead with convoy reference', () => {
      const convoy = store.createConvoy({ name: 'Test Convoy' });
      const bead = store.create({
        title: 'Convoy Bead',
        convoyId: convoy.id,
      });

      expect(bead.convoyId).toBe(convoy.id);
    });

    it('logs creation event', () => {
      const bead = store.create({ title: 'Event Test' });
      const events = store.getEvents(bead.id);

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('created');
    });
  });

  describe('get()', () => {
    it('retrieves a bead by ID', () => {
      const created = store.create({ title: 'Get Test' });
      const retrieved = store.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Get Test');
    });

    it('returns undefined for non-existent bead', () => {
      const bead = store.get('nonexistent');
      expect(bead).toBeUndefined();
    });
  });

  describe('list()', () => {
    beforeEach(() => {
      store.create({ title: 'Bead 1' });
      store.create({ title: 'Bead 2' });
      const bead3 = store.create({ title: 'Bead 3' });
      store.updateStatus(bead3.id, 'completed');
    });

    it('lists all beads', () => {
      const beads = store.list();
      expect(beads.length).toBe(3);
    });

    it('filters by status', () => {
      const pending = store.list({ status: 'pending' });
      expect(pending.length).toBe(2);

      const completed = store.list({ status: 'completed' });
      expect(completed.length).toBe(1);
    });

    it('filters by multiple statuses', () => {
      const beads = store.list({ status: ['pending', 'completed'] });
      expect(beads.length).toBe(3);
    });

    it('respects limit', () => {
      const beads = store.list({ limit: 2 });
      expect(beads.length).toBe(2);
    });
  });

  describe('assign()', () => {
    it('assigns bead to worker', () => {
      const bead = store.create({ title: 'Assign Test' });
      const success = store.assign(bead.id, 'worker-1');

      expect(success).toBe(true);

      const updated = store.get(bead.id);
      expect(updated?.assignedTo).toBe('worker-1');
      expect(updated?.status).toBe('in_progress');
    });

    it('logs assignment event', () => {
      const bead = store.create({ title: 'Event Assign Test' });
      store.assign(bead.id, 'worker-1');

      const events = store.getEvents(bead.id);
      const assignEvent = events.find(e => e.eventType === 'assigned');

      expect(assignEvent).toBeDefined();
      expect(assignEvent?.actor).toBe('worker-1');
    });

    it('returns false for already assigned bead', () => {
      const bead = store.create({ title: 'Double Assign Test' });
      store.assign(bead.id, 'worker-1');
      const success = store.assign(bead.id, 'worker-2');

      expect(success).toBe(false);
    });
  });

  describe('updateStatus()', () => {
    it('updates bead status', () => {
      const bead = store.create({ title: 'Status Test' });
      store.updateStatus(bead.id, 'in_progress');

      const updated = store.get(bead.id);
      expect(updated?.status).toBe('in_progress');
    });

    it('sets completedAt when completed', () => {
      const bead = store.create({ title: 'Complete Test' });
      store.updateStatus(bead.id, 'completed');

      const updated = store.get(bead.id);
      expect(updated?.completedAt).toBeDefined();
    });

    it('logs status change event', () => {
      const bead = store.create({ title: 'Status Event Test' });
      store.updateStatus(bead.id, 'completed', 'worker-1');

      const events = store.getEvents(bead.id);
      const statusEvent = events.find(e => e.eventType === 'status_changed');

      expect(statusEvent).toBeDefined();
      expect(statusEvent?.actor).toBe('worker-1');
      expect(statusEvent?.details?.status).toBe('completed');
    });
  });

  describe('Convoy operations', () => {
    describe('createConvoy()', () => {
      it('creates a new convoy', () => {
        const convoy = store.createConvoy({ name: 'Test Convoy' });

        expect(convoy.id).toBeDefined();
        expect(convoy.name).toBe('Test Convoy');
        expect(convoy.status).toBe('open');
      });

      it('creates convoy with description', () => {
        const convoy = store.createConvoy({
          name: 'Described Convoy',
          description: 'A test convoy',
        });

        expect(convoy.description).toBe('A test convoy');
      });
    });

    describe('getConvoy()', () => {
      it('retrieves convoy by ID', () => {
        const created = store.createConvoy({ name: 'Get Test' });
        const retrieved = store.getConvoy(created.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.name).toBe('Get Test');
      });

      it('returns undefined for non-existent convoy', () => {
        const convoy = store.getConvoy('nonexistent');
        expect(convoy).toBeUndefined();
      });
    });

    describe('listConvoys()', () => {
      beforeEach(() => {
        const convoy1 = store.createConvoy({ name: 'Convoy 1' });
        store.createConvoy({ name: 'Convoy 2' });
        store.closeConvoy(convoy1.id);
      });

      it('lists all convoys', () => {
        const convoys = store.listConvoys();
        expect(convoys.length).toBe(2);
      });

      it('filters by status', () => {
        const open = store.listConvoys({ status: 'open' });
        expect(open.length).toBe(1);

        const closed = store.listConvoys({ status: 'closed' });
        expect(closed.length).toBe(1);
      });
    });

    describe('closeConvoy()', () => {
      it('closes a convoy', () => {
        const convoy = store.createConvoy({ name: 'Close Test' });
        store.closeConvoy(convoy.id);

        const updated = store.getConvoy(convoy.id);
        expect(updated?.status).toBe('closed');
        expect(updated?.closedAt).toBeDefined();
      });
    });

    describe('dispatchConvoy()', () => {
      it('assigns all pending beads in convoy to worker', () => {
        const convoy = store.createConvoy({ name: 'Dispatch Test' });
        store.create({ title: 'Bead 1', convoyId: convoy.id });
        store.create({ title: 'Bead 2', convoyId: convoy.id });
        store.create({ title: 'Bead 3', convoyId: convoy.id });

        const count = store.dispatchConvoy(convoy.id, 'worker-1');

        expect(count).toBe(3);

        const beads = store.list({ convoyId: convoy.id });
        for (const bead of beads) {
          expect(bead.assignedTo).toBe('worker-1');
          expect(bead.status).toBe('in_progress');
        }
      });
    });
  });
});
