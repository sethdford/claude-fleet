/**
 * Hex Hive Visualization Types
 */

import type { WorkerInfo } from './api';

export interface HiveNode {
  handle: string;
  hex: { q: number; r: number };
  state: WorkerInfo['state'];
  health: WorkerInfo['health'];
  swarmId?: string;
  swarmName?: string;
  swarmColor: string;
  currentTaskId?: string;
  currentTool?: string;
  lastActivity?: number;
  workingDir?: string;
  spawnedAt?: number;
}

export interface HiveConfig {
  hexRadius: number;
  spacing: number;
  animationDuration: number;
}

export interface WorkerActivity {
  handle: string;
  tool: string;
  timestamp: number;
}
