import type {
  WorkerInfo,
  SwarmInfo,
  TeamTask,
  ServerMetrics,
  GraphData,
  BlackboardMessage,
} from './api';

export type ActivityType =
  | 'spawn'
  | 'dismiss'
  | 'output'
  | 'message'
  | 'tool'
  | 'result'
  | 'system'
  | 'error'
  | 'gate_pass'
  | 'gate_fail'
  | 'iteration';

export interface Activity {
  id: number;
  timestamp: number;
  type: ActivityType;
  title: string;
  preview?: string | null;
  handle?: string;
}

export interface WorkerOutputEntry {
  timestamp: number;
  content: unknown;
}

export interface MetricsHistoryEntry extends Partial<ServerMetrics> {
  timestamp: number;
}

export interface StoreState {
  metrics: ServerMetrics | null;
  metricsHistory: MetricsHistoryEntry[];
  workers: WorkerInfo[];
  workerOutput: Record<string, WorkerOutputEntry[]>;
  swarms: SwarmInfo[];
  blackboard: Record<string, BlackboardMessage[]>;
  tasks: TeamTask[];
  dependencyGraph: GraphData | null;
  graphRootFiles: string[];
  activities: Activity[];
}

/** View render function signature */
export type ViewRenderer = (
  container: HTMLElement,
  ...args: string[]
) => Promise<(() => void) | void>;
