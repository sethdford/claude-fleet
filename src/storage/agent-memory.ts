/**
 * Agent Memory
 *
 * Persistent memory layer for agents using SQLite FTS5 for full-text search.
 *
 * Memory types:
 *   - fact: Learned facts about the codebase or task
 *   - decision: Decisions made and their rationale
 *   - pattern: Recurring patterns observed
 *   - error: Errors encountered and how they were resolved
 *
 * Auto-decay: Memories accessed less frequently lose relevance score
 * over time, keeping search results focused on actively useful knowledge.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SQLiteStorage } from './sqlite.js';

// ============================================================================
// Types
// ============================================================================

/** Memory type classification */
export type MemoryType = 'fact' | 'decision' | 'pattern' | 'error';

/** A stored memory entry */
export interface MemoryEntry {
  id: string;
  agentId: string;
  key: string;
  value: string;
  tags: string[];
  memoryType: MemoryType;
  relevance: number;
  accessCount: number;
  createdAt: string;
  lastAccessed: string;
}

/** Options for storing a memory */
export interface StoreOptions {
  tags?: string[];
  memoryType?: MemoryType;
  relevance?: number;
}

/** Options for recalling memories */
export interface RecallOptions {
  limit?: number;
  memoryType?: MemoryType;
  minRelevance?: number;
}

// ============================================================================
// AgentMemory
// ============================================================================

export class AgentMemory {
  private storage: SQLiteStorage;

  /** Decay rate per day for unused memories (0-1, lower = slower decay) */
  private readonly decayRate: number;

  constructor(storage: SQLiteStorage, decayRate = 0.05) {
    this.storage = storage;
    this.decayRate = decayRate;
  }

  /**
   * Store a memory for an agent.
   * If a memory with the same key exists, it is updated.
   */
  store(agentId: string, key: string, value: string, options: StoreOptions = {}): MemoryEntry {
    const now = new Date().toISOString();
    const memoryType = options.memoryType ?? 'fact';
    const tags = options.tags ?? [];
    const relevance = options.relevance ?? 1.0;

    // Check for existing memory with same key
    const existing = this.storage.getAgentMemoryByKey(agentId, key);
    if (existing) {
      // Update existing memory — overwrite value, bump relevance
      this.storage.deleteAgentMemory(existing.id);
    }

    const id = uuidv4();
    this.storage.insertAgentMemory({
      id,
      agentId,
      key,
      value,
      tags: tags.length > 0 ? tags.join(',') : null,
      memoryType,
      relevance,
      accessCount: 0,
      createdAt: existing?.created_at ?? now,
      lastAccessed: now,
    });

    return {
      id,
      agentId,
      key,
      value,
      tags,
      memoryType,
      relevance,
      accessCount: 0,
      createdAt: existing?.created_at ?? now,
      lastAccessed: now,
    };
  }

  /**
   * Recall a specific memory by key.
   * Bumps the access count and relevance.
   */
  recall(agentId: string, key: string): MemoryEntry | null {
    const raw = this.storage.getAgentMemoryByKey(agentId, key);
    if (!raw) return null;

    // Bump access count
    this.storage.updateAgentMemoryAccess(raw.id);

    return this.rowToEntry(raw);
  }

  /**
   * Search memories using full-text search.
   * Falls back to LIKE queries if FTS5 is not available.
   */
  search(agentId: string, query: string, options: RecallOptions = {}): MemoryEntry[] {
    const limit = options.limit ?? 20;
    const results = this.storage.searchAgentMemory(agentId, query, limit);

    let entries = results.map((r) => this.rowToEntry(r));

    // Filter by memory type if specified
    if (options.memoryType) {
      entries = entries.filter((e) => e.memoryType === options.memoryType);
    }

    // Filter by minimum relevance
    if (options.minRelevance !== undefined) {
      entries = entries.filter((e) => e.relevance >= options.minRelevance!);
    }

    // Bump access counts for returned results
    for (const entry of entries) {
      this.storage.updateAgentMemoryAccess(entry.id);
    }

    return entries;
  }

  /**
   * Get all memories for an agent, ordered by relevance.
   */
  getAll(agentId: string, limit = 50): MemoryEntry[] {
    const results = this.storage.getAgentMemoriesByAgent(agentId, limit);
    return results.map((r) => this.rowToEntry(r));
  }

  /**
   * Delete a specific memory.
   */
  delete(memoryId: string): void {
    this.storage.deleteAgentMemory(memoryId);
  }

  /**
   * Apply decay to all memories for an agent.
   * Memories that haven't been accessed recently lose relevance.
   * Call this periodically (e.g., daily or on agent startup).
   */
  applyDecay(agentId: string): { decayed: number; pruned: number } {
    const memories = this.storage.getAgentMemoriesByAgent(agentId, 1000);
    const now = Date.now();
    let decayed = 0;
    let pruned = 0;

    for (const memory of memories) {
      const lastAccessed = new Date(memory.last_accessed).getTime();
      const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

      if (daysSinceAccess < 1) continue; // Don't decay recently accessed

      const newRelevance = memory.relevance * Math.pow(1 - this.decayRate, daysSinceAccess);

      if (newRelevance < 0.01) {
        // Prune extremely low relevance memories
        this.storage.deleteAgentMemory(memory.id);
        pruned++;
      } else if (newRelevance < memory.relevance - 0.001) {
        this.storage.updateAgentMemoryRelevance(memory.id, newRelevance);
        decayed++;
      }
    }

    return { decayed, pruned };
  }

  /**
   * Get memory statistics for an agent.
   */
  getStats(agentId: string): {
    totalMemories: number;
    byType: Record<MemoryType, number>;
    avgRelevance: number;
    totalAccessCount: number;
  } {
    const memories = this.storage.getAgentMemoriesByAgent(agentId, 10000);

    const byType: Record<MemoryType, number> = {
      fact: 0,
      decision: 0,
      pattern: 0,
      error: 0,
    };

    let totalRelevance = 0;
    let totalAccess = 0;

    for (const memory of memories) {
      const mType = memory.memory_type as MemoryType;
      if (mType in byType) {
        byType[mType]++;
      }
      totalRelevance += memory.relevance;
      totalAccess += memory.access_count;
    }

    return {
      totalMemories: memories.length,
      byType,
      avgRelevance: memories.length > 0 ? totalRelevance / memories.length : 0,
      totalAccessCount: totalAccess,
    };
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private rowToEntry(row: {
    id: string;
    agent_id: string;
    key: string;
    value: string;
    tags: string | null;
    memory_type: string;
    relevance: number;
    access_count: number;
    created_at: string;
    last_accessed: string;
  }): MemoryEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      key: row.key,
      value: row.value,
      tags: row.tags ? row.tags.split(',') : [],
      memoryType: row.memory_type as MemoryType,
      relevance: row.relevance,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
    };
  }
}
