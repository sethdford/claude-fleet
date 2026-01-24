/**
 * API Client for Claude Fleet Server
 * Handles authentication and all HTTP requests
 */

const BASE_URL = window.location.origin;

// Valid blackboard message types (from schema)
export const MESSAGE_TYPES = ['request', 'response', 'status', 'directive', 'checkpoint'];
export const MESSAGE_PRIORITIES = ['low', 'normal', 'high', 'critical'];

class ApiClient {
  static TOKEN_KEY = 'fleet_token';
  static USER_KEY = 'fleet_user';

  /**
   * Get stored JWT token
   */
  static getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  /**
   * Get stored user info
   */
  static getUser() {
    const user = localStorage.getItem(this.USER_KEY);
    try {
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  static isAuthenticated() {
    return !!this.getToken();
  }

  /**
   * Authenticate with the server
   */
  static async login(handle, teamName, agentType = 'team-lead') {
    const response = await fetch(`${BASE_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, teamName, agentType }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Authentication failed');
    }

    const data = await response.json();
    localStorage.setItem(this.TOKEN_KEY, data.token);
    localStorage.setItem(this.USER_KEY, JSON.stringify({
      uid: data.uid,
      handle: data.handle,
      teamName: data.teamName,
      agentType: data.agentType,
    }));

    return data;
  }

  /**
   * Logout and clear credentials
   */
  static logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }

  /**
   * Make an authenticated API request with error handling
   */
  static async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });
    } catch (err) {
      throw new Error(`Network error: ${err.message}`);
    }

    // Handle 401 - token expired
    if (response.status === 401) {
      this.logout();
      window.dispatchEvent(new CustomEvent('auth:logout'));
      throw new Error('Session expired');
    }

    // Handle non-OK responses
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  // ============================================================================
  // API Methods
  // ============================================================================

  /**
   * Get server health
   */
  static async getHealth() {
    return this.request('/health');
  }

  /**
   * Get server metrics (JSON format)
   */
  static async getMetrics() {
    return this.request('/metrics/json');
  }

  /**
   * Get all active workers
   */
  static async getWorkers() {
    return this.request('/orchestrate/workers');
  }

  /**
   * Get worker output
   */
  static async getWorkerOutput(handle, since = 0) {
    return this.request(`/orchestrate/output/${encodeURIComponent(handle)}?since=${since}`);
  }

  /**
   * Send message to worker
   */
  static async sendToWorker(handle, message) {
    return this.request(`/orchestrate/send/${encodeURIComponent(handle)}`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  /**
   * Dismiss a worker
   */
  static async dismissWorker(handle) {
    return this.request(`/orchestrate/dismiss/${encodeURIComponent(handle)}`, {
      method: 'POST',
    });
  }

  /**
   * Spawn a new worker
   * @param {string} handle - Worker handle (required)
   * @param {string} initialPrompt - Initial prompt for the worker (optional)
   * @param {Object} options - Additional options: teamName, workingDir, sessionId
   */
  static async spawnWorker(handle, initialPrompt, options = {}) {
    const body = { handle, ...options };
    if (initialPrompt) {
      body.initialPrompt = initialPrompt;
    }
    return this.request('/orchestrate/spawn', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Get all swarms
   * @param {boolean} includeAgents - Include agent list for each swarm
   */
  static async getSwarms(includeAgents = true) {
    const query = includeAgents ? '?includeAgents=true' : '';
    return this.request(`/swarms${query}`);
  }

  /**
   * Get swarm details
   */
  static async getSwarm(swarmId) {
    return this.request(`/swarms/${encodeURIComponent(swarmId)}`);
  }

  /**
   * Create a new swarm
   */
  static async createSwarm(name, description, maxAgents = 50) {
    return this.request('/swarms', {
      method: 'POST',
      body: JSON.stringify({ name, description, maxAgents }),
    });
  }

  /**
   * Kill a swarm
   */
  static async killSwarm(swarmId) {
    return this.request(`/swarms/${encodeURIComponent(swarmId)}/kill`, {
      method: 'POST',
    });
  }

  /**
   * Get blackboard messages
   * @param {string} swarmId - The swarm ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Max messages to return
   * @param {string} options.messageType - Filter by type (request|response|status|directive|checkpoint)
   * @param {string} options.priority - Filter by priority (low|normal|high|critical)
   * @param {boolean} options.unreadOnly - Only return unread messages
   * @param {string} options.readerHandle - Handle to check read status against
   */
  static async getBlackboard(swarmId, options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.messageType) params.set('messageType', options.messageType);
    if (options.priority) params.set('priority', options.priority);
    if (options.unreadOnly) params.set('unreadOnly', 'true');
    if (options.readerHandle) params.set('readerHandle', options.readerHandle);
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/blackboard/${encodeURIComponent(swarmId)}${query}`);
  }

  /**
   * Post to blackboard
   * @param {string} swarmId - The swarm ID
   * @param {Object} payload - Message payload (arbitrary JSON)
   * @param {string} messageType - Type: request|response|status|directive|checkpoint
   * @param {string} targetHandle - Optional target agent handle
   * @param {string} priority - Priority: low|normal|high|critical
   */
  static async postBlackboard(swarmId, payload, messageType = 'status', targetHandle = null, priority = 'normal') {
    const user = this.getUser();
    const body = {
      swarmId,
      senderHandle: user?.handle || 'dashboard',
      messageType,
      payload: typeof payload === 'string' ? { message: payload } : payload,
      priority,
    };
    if (targetHandle) {
      body.targetHandle = targetHandle;
    }
    return this.request('/blackboard', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Mark blackboard messages as read
   */
  static async markBlackboardRead(messageIds, readerHandle) {
    return this.request('/blackboard/mark-read', {
      method: 'POST',
      body: JSON.stringify({ messageIds, readerHandle }),
    });
  }

  /**
   * Get spawn queue status
   */
  static async getSpawnQueue() {
    return this.request('/spawn-queue/status');
  }

  /**
   * Get team tasks
   */
  static async getTasks(teamName) {
    return this.request(`/teams/${encodeURIComponent(teamName)}/tasks`);
  }

  /**
   * Get task by ID
   */
  static async getTask(taskId) {
    return this.request(`/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * Update task status
   */
  static async updateTask(taskId, status) {
    return this.request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  /**
   * Get dependency graph from TLDR
   * @param {string[]} rootFiles - Files to start traversal from (required)
   * @param {number} depth - Max depth to traverse (default: 3)
   */
  static async getDependencyGraph(rootFiles = [], depth = 3) {
    // If no rootFiles provided, try to get all summaries first
    if (!rootFiles || rootFiles.length === 0) {
      // Get stats to see if there's data
      const stats = await this.getTLDRStats();
      if (!stats.summaries || stats.summaries === 0) {
        return { nodes: [], edges: [], nodeCount: 0, edgeCount: 0 };
      }
      // Return empty - caller should provide rootFiles
      return { nodes: [], edges: [], nodeCount: 0, edgeCount: 0, error: 'No rootFiles provided' };
    }

    return this.request('/tldr/dependency/graph', {
      method: 'POST',
      body: JSON.stringify({ rootFiles, depth }),
    });
  }

  /**
   * Get TLDR stats
   */
  static async getTLDRStats() {
    return this.request('/tldr/stats');
  }

  /**
   * Get file summary
   */
  static async getFileSummary(filePath) {
    return this.request('/tldr/summary/get', {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    });
  }

  /**
   * Get multiple file summaries
   */
  static async getFileSummaries(filePaths) {
    return this.request('/tldr/summary/batch', {
      method: 'POST',
      body: JSON.stringify({ filePaths }),
    });
  }

  /**
   * Get all dependencies of a file
   */
  static async getDependencies(filePath) {
    return this.request('/tldr/dependency/dependencies', {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    });
  }

  /**
   * Get all files that depend on a file
   */
  static async getDependents(filePath) {
    return this.request('/tldr/dependency/dependents', {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    });
  }
}

export default ApiClient;
