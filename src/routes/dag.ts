/**
 * DAG Route Handlers (Task Dependency Solver)
 *
 * Exposes topological sort, cycle detection, critical path analysis,
 * and ready-node computation via the Rust NAPI module or JS fallback.
 */

import { createRequire } from 'node:module';
import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

// --- Shared Types ---

interface DagNode {
  id: string;
  priority?: number;
  estimatedDuration?: number;
  dependsOn?: string[];
}

interface TopologicalResult {
  order: string[];
  levels: string[][];
  isValid: boolean;
  nodeCount: number;
}

interface CycleResult {
  hasCycles: boolean;
  cycleNodes: string[];
  cycles: string[][];
}

interface CriticalPathResult {
  path: string[];
  totalDuration: number;
  slack: Array<{ id: string; slack: number; earliestStart: number; latestStart: number }>;
}

interface DagEngine {
  topologicalSort(nodes: DagNode[]): TopologicalResult;
  detectCycles(nodes: DagNode[]): CycleResult;
  criticalPath(nodes: DagNode[]): CriticalPathResult;
  getReadyNodes(nodes: DagNode[], completed: string[]): string[];
}

// --- JS Fallback ---

class JSDagEngine implements DagEngine {
  topologicalSort(nodes: DagNode[]): TopologicalResult {
    const adj = new Map<string, string[]>();
    const inDeg = new Map<string, number>();

    for (const n of nodes) {
      adj.set(n.id, []);
      inDeg.set(n.id, 0);
    }
    for (const n of nodes) {
      for (const dep of n.dependsOn ?? []) {
        adj.get(dep)?.push(n.id);
        inDeg.set(n.id, (inDeg.get(n.id) ?? 0) + 1);
      }
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const queue: string[] = [];
    for (const [id, deg] of inDeg) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    const levels: string[][] = [];

    while (queue.length > 0) {
      queue.sort((a, b) => (nodeMap.get(b)?.priority ?? 0) - (nodeMap.get(a)?.priority ?? 0));
      const level = [...queue];
      queue.length = 0;

      for (const id of level) {
        order.push(id);
        for (const neighbor of adj.get(id) ?? []) {
          const deg = (inDeg.get(neighbor) ?? 1) - 1;
          inDeg.set(neighbor, deg);
          if (deg === 0) queue.push(neighbor);
        }
      }
      levels.push(level);
    }

    return { order, levels, isValid: order.length === nodes.length, nodeCount: nodes.length };
  }

  detectCycles(nodes: DagNode[]): CycleResult {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const n of nodes) {
      for (const dep of n.dependsOn ?? []) {
        adj.get(dep)?.push(n.id);
      }
    }

    const white = new Set(nodes.map(n => n.id));
    const gray = new Set<string>();
    const cycleNodes = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]): void => {
      white.delete(node);
      gray.add(node);
      path.push(node);

      for (const neighbor of adj.get(node) ?? []) {
        if (gray.has(neighbor)) {
          const start = path.indexOf(neighbor);
          const cycle = path.slice(start);
          for (const n of cycle) cycleNodes.add(n);
          cycles.push(cycle);
        } else if (white.has(neighbor)) {
          dfs(neighbor, path);
        }
      }

      path.pop();
      gray.delete(node);
    };

    for (const n of nodes) {
      if (white.has(n.id)) dfs(n.id, []);
    }

    return { hasCycles: cycles.length > 0, cycleNodes: [...cycleNodes], cycles };
  }

  criticalPath(nodes: DagNode[]): CriticalPathResult {
    const topo = this.topologicalSort(nodes);
    if (!topo.isValid) {
      return { path: [], totalDuration: 0, slack: [] };
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const n of nodes) {
      for (const dep of n.dependsOn ?? []) {
        adj.get(dep)?.push(n.id);
      }
    }

    const es = new Map<string, number>();
    const ef = new Map<string, number>();

    for (const id of topo.order) {
      const dur = nodeMap.get(id)?.estimatedDuration ?? 1;
      const start = es.get(id) ?? 0;
      ef.set(id, start + dur);
      for (const neighbor of adj.get(id) ?? []) {
        const neighborEs = es.get(neighbor) ?? 0;
        if (start + dur > neighborEs) es.set(neighbor, start + dur);
      }
    }

    const totalDuration = Math.max(...[...ef.values()], 0);

    const lf = new Map<string, number>();
    const ls = new Map<string, number>();

    for (const id of [...topo.order].reverse()) {
      const dur = nodeMap.get(id)?.estimatedDuration ?? 1;
      if (!lf.has(id)) lf.set(id, totalDuration);
      for (const neighbor of adj.get(id) ?? []) {
        const neighborLs = ls.get(neighbor) ?? totalDuration;
        const currentLf = lf.get(id) ?? totalDuration;
        if (neighborLs < currentLf) lf.set(id, neighborLs);
      }
      ls.set(id, (lf.get(id) ?? totalDuration) - dur);
    }

    const slack = topo.order.map(id => {
      const esVal = es.get(id) ?? 0;
      const lsVal = ls.get(id) ?? 0;
      return { id, slack: lsVal - esVal, earliestStart: esVal, latestStart: lsVal };
    });

    const path = slack.filter(s => Math.abs(s.slack) < 0.001).map(s => s.id);
    return { path, totalDuration, slack };
  }

  getReadyNodes(nodes: DagNode[], completed: string[]): string[] {
    const completedSet = new Set(completed);
    const ready = nodes.filter(n => {
      if (completedSet.has(n.id)) return false;
      return (n.dependsOn ?? []).every(d => completedSet.has(d));
    });
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return ready.map(n => n.id);
  }
}

// --- Engine Initialization ---

function createDagEngine(): DagEngine {
  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/dag');
    const solver = new native.DagSolver();
    console.log('[dag] Using native Rust DAG solver');

    return {
      topologicalSort(nodes: DagNode[]): TopologicalResult {
        const r = solver.topologicalSort(JSON.stringify(nodes));
        return { order: r.order, levels: r.levels, isValid: r.is_valid, nodeCount: r.node_count };
      },
      detectCycles(nodes: DagNode[]): CycleResult {
        const r = solver.detectCycles(JSON.stringify(nodes));
        return { hasCycles: r.has_cycles, cycleNodes: r.cycle_nodes, cycles: r.cycles };
      },
      criticalPath(nodes: DagNode[]): CriticalPathResult {
        const r = solver.criticalPath(JSON.stringify(nodes));
        return {
          path: r.path,
          totalDuration: r.total_duration,
          slack: r.slack.map((s: { id: string; slack: number; earliest_start: number; latest_start: number }) => ({
            id: s.id, slack: s.slack, earliestStart: s.earliest_start, latestStart: s.latest_start,
          })),
        };
      },
      getReadyNodes(nodes: DagNode[], completed: string[]): string[] {
        return solver.getReadyNodes(JSON.stringify(nodes), JSON.stringify(completed));
      },
    };
  } catch {
    console.log('[dag] Rust DAG solver not available, using JS fallback');
    return new JSDagEngine();
  }
}

const dagEngine = createDagEngine();

// --- Route Handlers ---

export function createDagSortHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { nodes } = req.body as { nodes?: DagNode[] };
    if (!nodes || !Array.isArray(nodes)) {
      res.status(400).json({ error: 'Missing required field: nodes (array)' });
      return;
    }
    res.json(dagEngine.topologicalSort(nodes));
  });
}

export function createDagCyclesHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { nodes } = req.body as { nodes?: DagNode[] };
    if (!nodes || !Array.isArray(nodes)) {
      res.status(400).json({ error: 'Missing required field: nodes (array)' });
      return;
    }
    res.json(dagEngine.detectCycles(nodes));
  });
}

export function createDagCriticalPathHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { nodes } = req.body as { nodes?: DagNode[] };
    if (!nodes || !Array.isArray(nodes)) {
      res.status(400).json({ error: 'Missing required field: nodes (array)' });
      return;
    }
    res.json(dagEngine.criticalPath(nodes));
  });
}

export function createDagReadyHandler(_deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { nodes, completed } = req.body as { nodes?: DagNode[]; completed?: string[] };
    if (!nodes || !Array.isArray(nodes)) {
      res.status(400).json({ error: 'Missing required field: nodes (array)' });
      return;
    }
    const ready = dagEngine.getReadyNodes(nodes, completed ?? []);
    res.json({ ready });
  });
}
