/**
 * Tests for Compound Machine Route Handlers
 *
 * Validates the compound snapshot endpoint that aggregates
 * fleet state into a unified view for the dashboard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { createMockReq, createMockRes } from '../../tests/helpers/mock-express.js';
import { createMockDeps } from '../../tests/helpers/mock-deps.js';
import type { RouteDependencies } from './types.js';

// --- Mock the storage modules that are instantiated inside the handler ---

const mockPheromoneGetStats = vi.fn();
const mockBeliefGetStats = vi.fn();
const mockCreditGetLeaderboard = vi.fn();

vi.mock('../storage/pheromone.js', () => {
  return {
    PheromoneStorage: class MockPheromoneStorage {
      getStats = mockPheromoneGetStats;
    },
  };
});

vi.mock('../storage/beliefs.js', () => {
  return {
    BeliefStorage: class MockBeliefStorage {
      getStats = mockBeliefGetStats;
    },
  };
});

vi.mock('../storage/credits.js', () => {
  return {
    CreditStorage: class MockCreditStorage {
      getLeaderboard = mockCreditGetLeaderboard;
    },
  };
});

// Mock the native Rust accumulator loader so it falls back to JS
vi.mock('node:module', () => ({
  createRequire: function createRequire() {
    // Return a require function that always throws so the JS fallback is used
    return () => { throw new Error('native not available'); };
  },
}));

import { createCompoundSnapshotHandler } from './compound.js';

describe('createCompoundSnapshotHandler', () => {
  let deps: RouteDependencies;
  let mockPrepareAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    deps = createMockDeps();

    // Set up legacyStorage.getDatabase() to return a mock DB
    mockPrepareAll = vi.fn().mockReturnValue([]);
    const mockPrepare = vi.fn().mockReturnValue({ all: mockPrepareAll });
    (deps.legacyStorage as unknown as { getDatabase: ReturnType<typeof vi.fn> })
      .getDatabase.mockReturnValue({ prepare: mockPrepare });

    // Default mock returns for intelligence storage
    mockPheromoneGetStats.mockReturnValue({
      activeTrails: 5,
      decayedTrails: 2,
      totalIntensity: 3.5,
      byType: {},
      byResource: {},
    });

    mockBeliefGetStats.mockReturnValue({
      totalBeliefs: 10,
      totalMetaBeliefs: 3,
      uniqueAgents: 2,
      uniqueSubjects: 4,
      byType: {},
      avgConfidence: 0.75,
    });

    mockCreditGetLeaderboard.mockReturnValue([
      { agentHandle: 'agent-1', balance: 100, reputationScore: 0.9, totalEarned: 200, taskCount: 5, successCount: 4, successRate: 0.8 },
      { agentHandle: 'agent-2', balance: 50, reputationScore: 0.7, totalEarned: 80, taskCount: 3, successCount: 2, successRate: 0.67 },
    ]);
  });

  it('should return snapshot with workers and swarms', async () => {
    const workers = [
      { id: 'w1', handle: 'worker-1', teamName: 'alpha', state: 'working', health: 'healthy', spawnedAt: 1000, currentTaskId: 'task-1', swarmId: 'swarm-1', depthLevel: 1, spawnMode: 'process', recentOutput: [], lastHeartbeat: Date.now(), restartCount: 0, process: {} },
      { id: 'w2', handle: 'worker-2', teamName: 'alpha', state: 'ready', health: 'healthy', spawnedAt: 2000, currentTaskId: null, swarmId: 'swarm-1', depthLevel: 1, spawnMode: 'process', recentOutput: [], lastHeartbeat: Date.now(), restartCount: 0, process: {} },
    ];
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue(workers);

    deps.swarms.set('swarm-1', {
      id: 'swarm-1',
      name: 'Test Swarm',
      description: 'A test swarm',
      maxAgents: 5,
      createdAt: Date.now(),
    });

    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 2, healthy: 2, degraded: 0, unhealthy: 0,
    });

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    // asyncHandler wraps an async function; wait for it to flush
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    // Workers should be mapped correctly
    expect(snapshot.workers).toHaveLength(2);
    expect(snapshot.workers[0].id).toBe('w1');
    expect(snapshot.workers[0].handle).toBe('worker-1');
    expect(snapshot.workers[0].state).toBe('working');

    // Swarms should include worker data
    expect(snapshot.swarms).toHaveLength(1);
    expect(snapshot.swarms[0].id).toBe('swarm-1');
    expect(snapshot.swarms[0].name).toBe('Test Swarm');
    expect(snapshot.swarms[0].agentCount).toBe(2);
    expect(snapshot.swarms[0].agents).toHaveLength(2);
  });

  it('should include task summary by status', async () => {
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 0, healthy: 0, degraded: 0, unhealthy: 0,
    });

    // Mock tasks returned from the database
    mockPrepareAll.mockReturnValue([
      { id: 't1', status: 'completed' },
      { id: 't2', status: 'completed' },
      { id: 't3', status: 'open' },
      { id: 't4', status: 'in_progress' },
    ]);

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    expect(snapshot.tasks.total).toBe(4);
    expect(snapshot.tasks.completed).toBe(2);
    expect(snapshot.tasks.byStatus.completed).toBe(2);
    expect(snapshot.tasks.byStatus.open).toBe(1);
    expect(snapshot.tasks.byStatus.in_progress).toBe(1);
  });

  it('should include time-series data', async () => {
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 0, healthy: 0, degraded: 0, unhealthy: 0,
    });

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    // timeSeries should be an array (the accumulator collects points over time)
    expect(Array.isArray(snapshot.timeSeries)).toBe(true);

    // rates should be present
    expect(snapshot.rates).toBeDefined();
    expect(typeof snapshot.rates.compoundRate).toBe('number');
    expect(typeof snapshot.rates.knowledgeVelocity).toBe('number');
    expect(typeof snapshot.rates.creditsVelocity).toBe('number');
  });

  it('should include fleet stats (totalWorkers, activeWorkers, workingWorkers)', async () => {
    const workers = [
      { id: 'w1', handle: 'worker-1', teamName: 'alpha', state: 'working', health: 'healthy', spawnedAt: 1000, currentTaskId: 'task-1', swarmId: undefined, depthLevel: undefined, spawnMode: 'process', recentOutput: [], lastHeartbeat: Date.now(), restartCount: 0, process: {} },
      { id: 'w2', handle: 'worker-2', teamName: 'alpha', state: 'ready', health: 'healthy', spawnedAt: 2000, currentTaskId: null, swarmId: undefined, depthLevel: undefined, spawnMode: 'process', recentOutput: [], lastHeartbeat: Date.now(), restartCount: 0, process: {} },
      { id: 'w3', handle: 'worker-3', teamName: 'alpha', state: 'stopped', health: 'unhealthy', spawnedAt: 3000, currentTaskId: null, swarmId: undefined, depthLevel: undefined, spawnMode: 'process', recentOutput: [], lastHeartbeat: Date.now(), restartCount: 0, process: {} },
    ];
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue(workers);
    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 3, healthy: 2, degraded: 0, unhealthy: 1,
    });

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    expect(snapshot.fleet.totalWorkers).toBe(3);
    // activeWorkers = workers not stopped => 2
    expect(snapshot.fleet.activeWorkers).toBe(2);
    // workingWorkers = workers with state 'working' => 1
    expect(snapshot.fleet.workingWorkers).toBe(1);
    expect(snapshot.fleet.healthStats).toEqual({
      total: 3, healthy: 2, degraded: 0, unhealthy: 1,
    });
  });

  it('should include intelligence stats when swarms exist', async () => {
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 0, healthy: 0, degraded: 0, unhealthy: 0,
    });

    deps.swarms.set('swarm-alpha', {
      id: 'swarm-alpha',
      name: 'Alpha Swarm',
      maxAgents: 10,
      createdAt: Date.now(),
    });

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    expect(snapshot.intelligence).toBeDefined();
    expect(snapshot.intelligence['swarm-alpha']).toBeDefined();

    const intel = snapshot.intelligence['swarm-alpha'];

    // Belief stats from mock
    expect(intel.beliefStats).toBeDefined();
    expect(intel.beliefStats.totalBeliefs).toBe(10);
    expect(intel.beliefStats.uniqueAgents).toBe(2);
    expect(intel.beliefStats.uniqueSubjects).toBe(4);
    expect(intel.beliefStats.avgConfidence).toBe(0.75);

    // Pheromone stats from mock
    expect(intel.pheromoneStats).toBeDefined();
    expect(intel.pheromoneStats.totalTrails).toBe(7); // 5 active + 2 decayed
    expect(intel.pheromoneStats.activeTrails).toBe(5);

    // Leaderboard from mock
    expect(intel.leaderboard).toHaveLength(2);
    expect(intel.leaderboard[0].agentHandle).toBe('agent-1');
    expect(intel.leaderboard[0].credits).toBe(100);

    // Credit stats
    expect(intel.creditStats).toBeDefined();
    expect(intel.creditStats.totalCredits).toBe(150); // 100 + 50
    expect(intel.creditStats.agentCount).toBe(2);
  });

  it('should handle swarms with no intelligence data gracefully', async () => {
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 0, healthy: 0, degraded: 0, unhealthy: 0,
    });

    deps.swarms.set('swarm-new', {
      id: 'swarm-new',
      name: 'New Swarm',
      maxAgents: 5,
      createdAt: Date.now(),
    });

    // Simulate storage throwing when intelligence stores are not initialized
    mockBeliefGetStats.mockImplementation(() => { throw new Error('table not found'); });
    mockPheromoneGetStats.mockImplementation(() => { throw new Error('table not found'); });
    mockCreditGetLeaderboard.mockImplementation(() => { throw new Error('table not found'); });

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    // Intelligence entry should exist but be empty (caught error)
    expect(snapshot.intelligence['swarm-new']).toEqual({});
  });

  it('should include uptime and timestamp in the response', async () => {
    (deps.workerManager.getWorkers as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (deps.workerManager.getHealthStats as ReturnType<typeof vi.fn>).mockReturnValue({
      total: 0, healthy: 0, degraded: 0, unhealthy: 0,
    });

    const handler = createCompoundSnapshotHandler(deps);
    const req = createMockReq();
    const mockRes = createMockRes();

    handler(req as unknown as Request, mockRes as unknown as Response);
    await vi.waitFor(() => {
      expect(mockRes.json).toHaveBeenCalled();
    });

    const snapshot = mockRes.json.mock.calls[0][0];

    expect(typeof snapshot.timestamp).toBe('number');
    expect(typeof snapshot.uptime).toBe('number');
    expect(snapshot.uptime).toBeGreaterThanOrEqual(0);
  });
});
