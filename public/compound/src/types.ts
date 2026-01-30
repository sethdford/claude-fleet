// Compounding Machine - Shared Type Definitions

import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

// --- Fleet Data Types ---

export interface WorkerData {
  id?: string;
  handle: string;
  state: string;
  health: string;
  swarmId?: string;
  depthLevel?: number;
  teamName?: string;
  agentType?: string;
}

export interface SwarmData {
  id: string;
  name: string;
  description?: string;
  maxAgents?: number;
  agents: WorkerData[];
}

export interface TaskData {
  id: string;
  subject: string;
  status: string;
  ownerHandle?: string;
  teamName?: string;
}

export interface IntelligenceStats {
  pheromoneStats?: { totalTrails?: number; activeTrails?: number };
  beliefStats?: { totalBeliefs?: number; uniqueSubjects?: number };
  creditStats?: { totalCredits?: number; agentCount?: number };
  leaderboard?: Array<{ agentHandle: string; credits: number }>;
  recentMessages?: Array<{
    senderHandle: string;
    targetHandle?: string;
    messageType: string;
    content?: string;
    timestamp?: string;
  }>;
}

// --- Compound Snapshot (from /compound/snapshot endpoint) ---

export interface CompoundSnapshot {
  timestamp: number;
  uptime: number;
  workers: WorkerData[];
  swarms: SwarmData[];
  tasks: {
    total: number;
    completed: number;
    byStatus: Record<string, number>;
  };
  intelligence: Record<string, IntelligenceStats>;
  timeSeries: TimeSeriesPoint[];
  rates: {
    compoundRate: number;
    knowledgeVelocity: number;
    creditsVelocity: number;
  };
  fleet?: {
    totalWorkers: number;
    activeWorkers: number;
    workingWorkers: number;
    healthStats: Record<string, unknown>;
  };
}

export interface TimeSeriesPoint {
  timestamp: number;
  tasksCompleted: number;
  knowledgeEntries: number;
  creditsEarned: number;
  activeWorkers: number;
  healthyWorkers: number;
  totalSwarms: number;
  blackboardMessages: number;
  pheromoneTrails: number;
}

// --- Graph Visualization Types ---

export type NodeType = 'worker' | 'swarm' | 'task';
export type NodeStatus = 'healthy' | 'working' | 'degraded' | 'unhealthy' | 'stopped' | 'pending';
export type EdgeType = 'membership' | 'assignment' | 'knowledge' | 'spawn';

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: NodeType;
  status: NodeStatus;
  radius: number;
  color: string;
  credits?: number;
  swarmId?: string;
  depthLevel?: number;
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  id: string;
  type: EdgeType;
  sourceId: string;
  targetId: string;
}

// --- Activity Feed Types ---

export type ActivityType = 'spawn' | 'dismiss' | 'output' | 'knowledge' | 'task' | 'swarm' | 'error';

export interface ActivityItem {
  id: string;
  timestamp: number;
  type: ActivityType;
  title: string;
  detail?: string;
  nodeId?: string;
}

// --- Lineage Tree Types ---

export interface LineageNode {
  id: string;
  name: string;
  type: string;
  state?: string;
  health?: string;
  children: LineageNode[];
}

// --- WebSocket Event Types ---

export interface WSEvent {
  type: string;
  [key: string]: unknown;
}

export interface WSWorkerEvent extends WSEvent {
  handle: string;
  state?: string;
  health?: string;
  swarmId?: string;
}

export interface WSBlackboardEvent extends WSEvent {
  swarmId: string;
  message: {
    senderHandle: string;
    targetHandle?: string;
    messageType: string;
    content?: string;
  };
}

export interface WSTaskEvent extends WSEvent {
  taskId: string;
  status?: string;
  ownerHandle?: string;
  task?: TaskData;
}
