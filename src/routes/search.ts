/**
 * Search Route Handlers
 *
 * Exposes full-text search via Tantivy (native) or SQLite FTS5 (fallback).
 * The Rust NAPI module is optional — when unavailable, a pure-JS fallback
 * queries the SQLite database using FTS5 for basic text matching.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

// --- Shared Types ---

interface SearchResult {
  sessionId: string;
  score: number;
  snippet: string;
  timestamp: number;
  model?: string;
}

interface SessionMetadata {
  sessionId: string;
  content: string;
  timestamp: number;
  model?: string;
  projectPath?: string;
}

interface IndexStats {
  documentCount: number;
  backend: 'tantivy' | 'sqlite-fts5';
}

interface SearchEngine {
  search(query: string, limit?: number): SearchResult[];
  indexSession(metadata: SessionMetadata): void;
  deleteSession(sessionId: string): void;
  stats(): IndexStats;
  commit(): void;
}

// --- JS Fallback (SQLite FTS5) ---

class JSSearchEngine implements SearchEngine {
  private storage: RouteDependencies['legacyStorage'];

  constructor(storage: RouteDependencies['legacyStorage']) {
    this.storage = storage;
    this.ensureTable();
  }

  private ensureTable(): void {
    const db = this.storage.getDatabase();
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_sessions USING fts5(
        session_id,
        content,
        model,
        project_path,
        tokenize='porter unicode61'
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_metadata (
        session_id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      )
    `);
  }

  search(query: string, limit = 20): SearchResult[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT
        s.session_id,
        rank as score,
        snippet(search_sessions, 1, '<b>', '</b>', '...', 32) as snippet,
        COALESCE(m.timestamp, 0) as timestamp,
        s.model
      FROM search_sessions s
      LEFT JOIN search_metadata m ON s.session_id = m.session_id
      WHERE search_sessions MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(query, limit) as Array<{
      session_id: string;
      score: number;
      snippet: string;
      timestamp: number;
      model: string | null;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      score: Math.abs(row.score),
      snippet: row.snippet,
      timestamp: row.timestamp,
      model: row.model ?? undefined,
    }));
  }

  indexSession(metadata: SessionMetadata): void {
    const db = this.storage.getDatabase();

    // Delete existing entry if re-indexing
    db.prepare('DELETE FROM search_sessions WHERE session_id = ?').run(metadata.sessionId);
    db.prepare('DELETE FROM search_metadata WHERE session_id = ?').run(metadata.sessionId);

    db.prepare(`
      INSERT INTO search_sessions (session_id, content, model, project_path)
      VALUES (?, ?, ?, ?)
    `).run(
      metadata.sessionId,
      metadata.content,
      metadata.model ?? '',
      metadata.projectPath ?? ''
    );

    db.prepare(`
      INSERT INTO search_metadata (session_id, timestamp, indexed_at)
      VALUES (?, ?, ?)
    `).run(metadata.sessionId, metadata.timestamp, Date.now());
  }

  deleteSession(sessionId: string): void {
    const db = this.storage.getDatabase();
    db.prepare('DELETE FROM search_sessions WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM search_metadata WHERE session_id = ?').run(sessionId);
  }

  stats(): IndexStats {
    const db = this.storage.getDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM search_metadata').get() as { count: number };
    return {
      documentCount: row.count,
      backend: 'sqlite-fts5',
    };
  }

  commit(): void {
    // No-op for SQLite — writes are auto-committed
  }
}

// --- Engine Initialization ---

function createSearchEngine(deps: RouteDependencies): SearchEngine {
  try {
    const esmRequire = createRequire(import.meta.url);
    const native = esmRequire('@claude-fleet/search');
    const indexPath = path.join(path.dirname(deps.config.dbPath), 'search-index');
    const inst = new native.SearchIndex(indexPath);
    console.log('[search] Using native Tantivy search engine');

    return {
      search(query: string, limit?: number): SearchResult[] {
        const results = inst.search(query, limit ?? 20);
        return results.map((r: { session_id: string; score: number; snippet: string; timestamp: number; model?: string }) => ({
          sessionId: r.session_id,
          score: r.score,
          snippet: r.snippet,
          timestamp: r.timestamp,
          model: r.model,
        }));
      },
      indexSession(metadata: SessionMetadata): void {
        inst.indexSession({
          session_id: metadata.sessionId,
          content: metadata.content,
          timestamp: metadata.timestamp,
          model: metadata.model ?? null,
          project_path: metadata.projectPath ?? null,
        });
      },
      deleteSession(sessionId: string): void {
        inst.deleteSession(sessionId);
      },
      stats(): IndexStats {
        const s = inst.stats();
        return { documentCount: s.document_count, backend: 'tantivy' };
      },
      commit(): void {
        inst.commit();
      },
    };
  } catch {
    console.log('[search] Tantivy not available, using SQLite FTS5 fallback');
    return new JSSearchEngine(deps.legacyStorage);
  }
}

// --- Route Handlers ---

/**
 * POST /search
 *
 * Search sessions by query string.
 * Body: { query: string, limit?: number }
 */
export function createSearchHandler(deps: RouteDependencies) {
  const engine = createSearchEngine(deps);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { query, limit } = req.body as { query?: string; limit?: number };

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Missing required field: query' });
      return;
    }

    const results = engine.search(query, limit);
    res.json({ results, count: results.length });
  });
}

/**
 * POST /search/index
 *
 * Index a session for searching.
 * Body: { sessionId, content, timestamp, model?, projectPath? }
 */
export function createSearchIndexHandler(deps: RouteDependencies) {
  const engine = createSearchEngine(deps);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { sessionId, content, timestamp, model, projectPath } = req.body as {
      sessionId?: string;
      content?: string;
      timestamp?: number;
      model?: string;
      projectPath?: string;
    };

    if (!sessionId || !content || timestamp === undefined) {
      res.status(400).json({ error: 'Missing required fields: sessionId, content, timestamp' });
      return;
    }

    engine.indexSession({ sessionId, content, timestamp, model, projectPath });
    engine.commit();
    res.json({ indexed: true, sessionId });
  });
}

/**
 * DELETE /search/:sessionId
 *
 * Remove a session from the search index.
 */
export function createSearchDeleteHandler(deps: RouteDependencies) {
  const engine = createSearchEngine(deps);

  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    engine.deleteSession(sessionId);
    engine.commit();
    res.json({ deleted: true, sessionId });
  });
}

/**
 * GET /search/stats
 *
 * Get search index statistics.
 */
export function createSearchStatsHandler(deps: RouteDependencies) {
  const engine = createSearchEngine(deps);

  return asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const stats = engine.stats();
    res.json(stats);
  });
}
