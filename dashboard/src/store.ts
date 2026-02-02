/**
 * Simple State Management Store
 * Provides reactive state updates with subscriber pattern
 */

import type {
  StoreState,
  Activity,
  WorkerOutputEntry,
  MetricsHistoryEntry,
} from '@/types';
import type { ServerMetrics } from '@/types';
import { RingBuffer } from '@/utils/ring-buffer';

type Subscriber<T = unknown> = (value: T) => void;

interface HistoryEntry {
  timestamp: number;
  prev: StoreState;
  next: StoreState;
}

class Store {
  state: StoreState;
  private subscribers = new Map<string, Set<Subscriber>>();
  private history = new RingBuffer<HistoryEntry>(50);

  constructor(initialState: StoreState) {
    this.state = initialState;
  }

  /** Get the full state or a specific top-level key. */
  get<K extends keyof StoreState>(key: K): StoreState[K];
  get(key: string): unknown;
  get(): StoreState;
  get(key?: string): unknown {
    if (key) {
      return key.split('.').reduce<unknown>(
        (obj, k) => (obj as Record<string, unknown>)?.[k],
        this.state,
      );
    }
    return this.state;
  }

  /** Set a single key or merge a partial state object. */
  set<K extends keyof StoreState>(key: K, value: StoreState[K]): void;
  set(key: string, value: unknown): void;
  set(partial: Partial<StoreState>): void;
  set(keyOrState: string | Partial<StoreState>, value?: unknown): void {
    const prevState = { ...this.state };

    if (typeof keyOrState === 'string') {
      this.setNestedValue(keyOrState, value);
    } else {
      this.state = { ...this.state, ...keyOrState };
    }

    this.history.push({ timestamp: Date.now(), prev: prevState, next: this.state });

    this.notify(keyOrState);
  }

  /** Update a value using a transform function. */
  update<K extends keyof StoreState>(key: K, updater: (current: StoreState[K]) => StoreState[K]): void {
    const current = this.get(key);
    this.set(key, updater(current));
  }

  /**
   * Subscribe to state changes.
   * Pass a key + callback for specific key changes, or just a callback for all changes.
   * Returns an unsubscribe function.
   */
  subscribe(callback: Subscriber<StoreState>): () => void;
  subscribe<K extends keyof StoreState>(key: K, callback: Subscriber<StoreState[K]>): () => void;
  subscribe(key: string, callback: Subscriber): () => void;
  subscribe(
    keyOrCallback: string | Subscriber<StoreState>,
    callback?: Subscriber,
  ): () => void {
    if (typeof keyOrCallback === 'function') {
      const k = '*';
      if (!this.subscribers.has(k)) this.subscribers.set(k, new Set());
      this.subscribers.get(k)!.add(keyOrCallback as Subscriber);
      return () => { this.subscribers.get(k)?.delete(keyOrCallback as Subscriber); };
    }

    if (!this.subscribers.has(keyOrCallback)) {
      this.subscribers.set(keyOrCallback, new Set());
    }
    this.subscribers.get(keyOrCallback)!.add(callback!);
    return () => { this.subscribers.get(keyOrCallback)?.delete(callback!); };
  }

  /** Clear all state. */
  clear(): void {
    this.state = { ...INITIAL_STATE };
    this.notify('*');
  }

  // ---------------------------------------------------------------------------
  // Helpers that were monkey-patched in the original JS
  // ---------------------------------------------------------------------------

  addActivity(activity: Omit<Activity, 'id' | 'timestamp'> & Partial<Pick<Activity, 'id' | 'timestamp'>>): void {
    const activities = this.get('activities') ?? [];
    activities.unshift({
      id: Date.now(),
      timestamp: Date.now(),
      ...activity,
    });
    this.set('activities', activities.slice(0, 100));
  }

  removeWorker(handle: string): void {
    const workers = this.get('workers') ?? [];
    this.set('workers', workers.filter(w => w.handle !== handle));
    const workerOutput = this.get('workerOutput') ?? {};
    if (workerOutput[handle]) {
      delete workerOutput[handle];
      this.set('workerOutput', { ...workerOutput });
    }
  }

  appendWorkerOutput(handle: string, output: unknown): void {
    const workerOutput = this.get('workerOutput') ?? {};
    if (!workerOutput[handle]) {
      workerOutput[handle] = [];
    }
    workerOutput[handle].push({ timestamp: Date.now(), content: output } satisfies WorkerOutputEntry);
    if (workerOutput[handle].length > 1000) {
      workerOutput[handle] = workerOutput[handle].slice(-1000);
    }
    this.set('workerOutput', { ...workerOutput });
  }

  addMetricsHistory(metrics: ServerMetrics): void {
    const history = this.get('metricsHistory') ?? [];
    history.push({ timestamp: Date.now(), ...metrics } satisfies MetricsHistoryEntry);
    this.set('metricsHistory', history.length > 60 ? history.slice(-60) : history);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private setNestedValue(key: string, value: unknown): void {
    const keys = key.split('.');
    const lastKey = keys.pop()!;
    let obj: Record<string, unknown> = this.state as unknown as Record<string, unknown>;

    for (const k of keys) {
      if (!(k in obj)) (obj as Record<string, unknown>)[k] = {};
      obj = obj[k] as Record<string, unknown>;
    }

    obj[lastKey] = value;
  }

  private notify(changedKey: string | Partial<StoreState>): void {
    if (typeof changedKey === 'string') {
      this.subscribers.get(changedKey)?.forEach(cb => cb(this.get(changedKey as keyof StoreState)));

      const parts = changedKey.split('.');
      while (parts.length > 1) {
        parts.pop();
        const parentKey = parts.join('.');
        this.subscribers.get(parentKey)?.forEach(cb => cb(this.get(parentKey as keyof StoreState)));
      }
    }

    this.subscribers.get('*')?.forEach(cb => cb(this.state));
  }
}

const INITIAL_STATE: StoreState = {
  metrics: null,
  metricsHistory: [],
  workers: [],
  workerOutput: {},
  swarms: [],
  blackboard: {},
  tasks: [],
  dependencyGraph: null,
  graphRootFiles: [],
  activities: [],
};

const store = new Store(INITIAL_STATE);
export default store;
