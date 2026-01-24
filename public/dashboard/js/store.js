/**
 * Simple State Management Store
 * Provides reactive state updates with subscriber pattern
 */

class Store {
  constructor(initialState = {}) {
    this.state = initialState;
    this.subscribers = new Map();
    this.history = [];
  }

  /**
   * Get current state or a specific key
   */
  get(key) {
    if (key) {
      return key.split('.').reduce((obj, k) => obj?.[k], this.state);
    }
    return this.state;
  }

  /**
   * Set state value(s)
   */
  set(keyOrState, value) {
    const prevState = { ...this.state };

    if (typeof keyOrState === 'string') {
      this.setNestedValue(keyOrState, value);
    } else {
      this.state = { ...this.state, ...keyOrState };
    }

    // Track history for debugging
    this.history.push({
      timestamp: Date.now(),
      prev: prevState,
      next: this.state,
    });
    if (this.history.length > 50) {
      this.history.shift();
    }

    this.notify(keyOrState);
  }

  /**
   * Set a nested value using dot notation
   */
  setNestedValue(key, value) {
    const keys = key.split('.');
    const lastKey = keys.pop();
    let obj = this.state;

    for (const k of keys) {
      if (!(k in obj)) obj[k] = {};
      obj = obj[k];
    }

    obj[lastKey] = value;
  }

  /**
   * Update a value with a function
   */
  update(key, updater) {
    const current = this.get(key);
    this.set(key, updater(current));
  }

  /**
   * Subscribe to state changes
   */
  subscribe(keyOrCallback, callback) {
    if (typeof keyOrCallback === 'function') {
      // Subscribe to all changes
      const key = '*';
      if (!this.subscribers.has(key)) {
        this.subscribers.set(key, new Set());
      }
      this.subscribers.get(key).add(keyOrCallback);
      return () => this.subscribers.get(key)?.delete(keyOrCallback);
    }

    // Subscribe to specific key
    if (!this.subscribers.has(keyOrCallback)) {
      this.subscribers.set(keyOrCallback, new Set());
    }
    this.subscribers.get(keyOrCallback).add(callback);
    return () => this.subscribers.get(keyOrCallback)?.delete(callback);
  }

  /**
   * Notify subscribers of state change
   */
  notify(changedKey) {
    // Notify specific key subscribers
    if (typeof changedKey === 'string') {
      this.subscribers.get(changedKey)?.forEach(cb => cb(this.get(changedKey)));

      // Notify parent key subscribers
      const parts = changedKey.split('.');
      while (parts.length > 1) {
        parts.pop();
        const parentKey = parts.join('.');
        this.subscribers.get(parentKey)?.forEach(cb => cb(this.get(parentKey)));
      }
    }

    // Notify global subscribers
    this.subscribers.get('*')?.forEach(cb => cb(this.state));
  }

  /**
   * Clear all state
   */
  clear() {
    this.state = {};
    this.notify('*');
  }
}

// Create singleton store with initial state
const store = new Store({
  // Metrics
  metrics: null,
  metricsHistory: [],

  // Workers
  workers: [],
  workerOutput: {},

  // Swarms
  swarms: [],
  currentSwarm: null,
  blackboard: [],

  // Tasks
  tasks: [],

  // Dependency graph
  dependencyGraph: null,

  // Activity feed
  activities: [],

  // UI state
  loading: false,
  error: null,
  currentView: 'overview',
});

// Helper to add activity
store.addActivity = function(activity) {
  const activities = this.get('activities') || [];
  activities.unshift({
    id: Date.now(),
    timestamp: Date.now(),
    ...activity,
  });
  // Keep last 100 activities
  this.set('activities', activities.slice(0, 100));
};

// Helper to update worker
store.updateWorker = function(handle, updates) {
  const workers = this.get('workers') || [];
  const index = workers.findIndex(w => w.handle === handle);
  if (index >= 0) {
    workers[index] = { ...workers[index], ...updates };
    this.set('workers', [...workers]);
  }
};

// Helper to remove worker
store.removeWorker = function(handle) {
  const workers = this.get('workers') || [];
  this.set('workers', workers.filter(w => w.handle !== handle));
};

// Helper to append worker output
store.appendWorkerOutput = function(handle, output) {
  const workerOutput = this.get('workerOutput') || {};
  if (!workerOutput[handle]) {
    workerOutput[handle] = [];
  }
  workerOutput[handle].push({
    timestamp: Date.now(),
    content: output,
  });
  // Keep last 1000 output entries per worker
  if (workerOutput[handle].length > 1000) {
    workerOutput[handle] = workerOutput[handle].slice(-1000);
  }
  this.set('workerOutput', { ...workerOutput });
};

// Helper to track metrics history
store.addMetricsHistory = function(metrics) {
  const history = this.get('metricsHistory') || [];
  history.push({
    timestamp: Date.now(),
    ...metrics,
  });
  // Keep last 60 data points (5 min at 5s interval)
  if (history.length > 60) {
    history.shift();
  }
  this.set('metricsHistory', history);
};

export default store;
