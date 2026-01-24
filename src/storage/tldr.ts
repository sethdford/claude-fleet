/**
 * TLDR Storage
 *
 * Provides token-efficient code analysis through cached summaries.
 * Stores file summaries, dependency maps, and codebase overviews.
 */

import type { SQLiteStorage } from './sqlite.js';
import crypto from 'node:crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface FileSummary {
  id: number;
  filePath: string;
  contentHash: string;
  summary: string;
  exports: string[];      // Exported functions/classes/constants
  imports: string[];      // Import paths
  dependencies: string[]; // Files this file depends on
  lineCount: number;
  language: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodebaseOverview {
  id: number;
  rootPath: string;
  name: string;
  description: string;
  structure: Record<string, unknown>;  // Directory tree
  keyFiles: string[];     // Important files (entry points, configs)
  patterns: string[];     // Detected patterns (MVC, microservices, etc.)
  techStack: string[];    // Languages, frameworks, tools
  createdAt: number;
  updatedAt: number;
}

export interface DependencyEdge {
  fromFile: string;
  toFile: string;
  importType: 'static' | 'dynamic' | 'type-only';
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

interface FileSummaryRow {
  id: number;
  file_path: string;
  content_hash: string;
  summary: string;
  exports: string;
  imports: string;
  dependencies: string;
  line_count: number;
  language: string;
  created_at: number;
  updated_at: number;
}

interface CodebaseOverviewRow {
  id: number;
  root_path: string;
  name: string;
  description: string;
  structure: string;
  key_files: string;
  patterns: string;
  tech_stack: string;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// TLDR STORAGE CLASS
// ============================================================================

export class TLDRStorage {
  private storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
    this.initTables();
  }

  private initTables(): void {
    const db = this.storage.getDatabase();

    db.exec(`
      -- File summaries cache
      CREATE TABLE IF NOT EXISTS tldr_file_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        summary TEXT NOT NULL,
        exports TEXT DEFAULT '[]',
        imports TEXT DEFAULT '[]',
        dependencies TEXT DEFAULT '[]',
        line_count INTEGER DEFAULT 0,
        language TEXT DEFAULT 'unknown',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(file_path)
      );

      CREATE INDEX IF NOT EXISTS idx_tldr_file_path ON tldr_file_summaries(file_path);
      CREATE INDEX IF NOT EXISTS idx_tldr_content_hash ON tldr_file_summaries(content_hash);

      -- Codebase overviews
      CREATE TABLE IF NOT EXISTS tldr_codebase_overviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_path TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        structure TEXT DEFAULT '{}',
        key_files TEXT DEFAULT '[]',
        patterns TEXT DEFAULT '[]',
        tech_stack TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(root_path)
      );

      CREATE INDEX IF NOT EXISTS idx_tldr_root_path ON tldr_codebase_overviews(root_path);

      -- Dependency graph edges
      CREATE TABLE IF NOT EXISTS tldr_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_file TEXT NOT NULL,
        to_file TEXT NOT NULL,
        import_type TEXT DEFAULT 'static',
        UNIQUE(from_file, to_file)
      );

      CREATE INDEX IF NOT EXISTS idx_tldr_dep_from ON tldr_dependencies(from_file);
      CREATE INDEX IF NOT EXISTS idx_tldr_dep_to ON tldr_dependencies(to_file);
    `);
  }

  /**
   * Hash file content for cache invalidation
   */
  hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Get or create file summary
   */
  getFileSummary(filePath: string): FileSummary | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM tldr_file_summaries WHERE file_path = ?');
    const row = stmt.get(filePath) as FileSummaryRow | undefined;
    return row ? this.rowToFileSummary(row) : null;
  }

  /**
   * Check if file summary is current (matches content hash)
   */
  isSummaryCurrent(filePath: string, contentHash: string): boolean {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT content_hash FROM tldr_file_summaries WHERE file_path = ?');
    const row = stmt.get(filePath) as { content_hash: string } | undefined;
    return row?.content_hash === contentHash;
  }

  /**
   * Store file summary
   */
  storeFileSummary(
    filePath: string,
    contentHash: string,
    summary: string,
    metadata: {
      exports?: string[];
      imports?: string[];
      dependencies?: string[];
      lineCount?: number;
      language?: string;
    } = {}
  ): FileSummary {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO tldr_file_summaries
        (file_path, content_hash, summary, exports, imports, dependencies, line_count, language, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        summary = excluded.summary,
        exports = excluded.exports,
        imports = excluded.imports,
        dependencies = excluded.dependencies,
        line_count = excluded.line_count,
        language = excluded.language,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      filePath,
      contentHash,
      summary,
      JSON.stringify(metadata.exports ?? []),
      JSON.stringify(metadata.imports ?? []),
      JSON.stringify(metadata.dependencies ?? []),
      metadata.lineCount ?? 0,
      metadata.language ?? 'unknown',
      now,
      now
    );

    return this.getFileSummary(filePath)!;
  }

  /**
   * Get multiple file summaries
   */
  getFileSummaries(filePaths: string[]): FileSummary[] {
    if (filePaths.length === 0) return [];

    const db = this.storage.getDatabase();
    const placeholders = filePaths.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM tldr_file_summaries WHERE file_path IN (${placeholders})`);
    const rows = stmt.all(...filePaths) as FileSummaryRow[];
    return rows.map(row => this.rowToFileSummary(row));
  }

  /**
   * Get codebase overview
   */
  getCodebaseOverview(rootPath: string): CodebaseOverview | null {
    const db = this.storage.getDatabase();
    const stmt = db.prepare('SELECT * FROM tldr_codebase_overviews WHERE root_path = ?');
    const row = stmt.get(rootPath) as CodebaseOverviewRow | undefined;
    return row ? this.rowToCodebaseOverview(row) : null;
  }

  /**
   * Store codebase overview
   */
  storeCodebaseOverview(
    rootPath: string,
    name: string,
    overview: {
      description?: string;
      structure?: Record<string, unknown>;
      keyFiles?: string[];
      patterns?: string[];
      techStack?: string[];
    } = {}
  ): CodebaseOverview {
    const db = this.storage.getDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO tldr_codebase_overviews
        (root_path, name, description, structure, key_files, patterns, tech_stack, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_path) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        structure = excluded.structure,
        key_files = excluded.key_files,
        patterns = excluded.patterns,
        tech_stack = excluded.tech_stack,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      rootPath,
      name,
      overview.description ?? '',
      JSON.stringify(overview.structure ?? {}),
      JSON.stringify(overview.keyFiles ?? []),
      JSON.stringify(overview.patterns ?? []),
      JSON.stringify(overview.techStack ?? []),
      now,
      now
    );

    return this.getCodebaseOverview(rootPath)!;
  }

  /**
   * Store dependency edge
   */
  storeDependency(fromFile: string, toFile: string, importType: 'static' | 'dynamic' | 'type-only' = 'static'): void {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tldr_dependencies (from_file, to_file, import_type)
      VALUES (?, ?, ?)
      ON CONFLICT(from_file, to_file) DO UPDATE SET import_type = excluded.import_type
    `);
    stmt.run(fromFile, toFile, importType);
  }

  /**
   * Get files that depend on a given file
   */
  getDependents(filePath: string): DependencyEdge[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT from_file, to_file, import_type FROM tldr_dependencies WHERE to_file = ?
    `);
    const rows = stmt.all(filePath) as Array<{ from_file: string; to_file: string; import_type: string }>;
    return rows.map(row => ({
      fromFile: row.from_file,
      toFile: row.to_file,
      importType: row.import_type as 'static' | 'dynamic' | 'type-only',
    }));
  }

  /**
   * Get files that a given file depends on
   */
  getDependencies(filePath: string): DependencyEdge[] {
    const db = this.storage.getDatabase();
    const stmt = db.prepare(`
      SELECT from_file, to_file, import_type FROM tldr_dependencies WHERE from_file = ?
    `);
    const rows = stmt.all(filePath) as Array<{ from_file: string; to_file: string; import_type: string }>;
    return rows.map(row => ({
      fromFile: row.from_file,
      toFile: row.to_file,
      importType: row.import_type as 'static' | 'dynamic' | 'type-only',
    }));
  }

  /**
   * Get dependency graph for a set of files
   */
  getDependencyGraph(rootFiles: string[], depth: number = 3): {
    nodes: string[];
    edges: DependencyEdge[];
  } {
    const nodes = new Set<string>(rootFiles);
    const edges: DependencyEdge[] = [];
    const visited = new Set<string>();
    const queue = [...rootFiles];
    let currentDepth = 0;

    while (queue.length > 0 && currentDepth < depth) {
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const file = queue.shift()!;
        if (visited.has(file)) continue;
        visited.add(file);

        const deps = this.getDependencies(file);
        for (const dep of deps) {
          nodes.add(dep.toFile);
          edges.push(dep);
          if (!visited.has(dep.toFile)) {
            queue.push(dep.toFile);
          }
        }
      }
      currentDepth++;
    }

    return { nodes: Array.from(nodes), edges };
  }

  /**
   * Clear all cached data for a file
   */
  invalidateFile(filePath: string): void {
    const db = this.storage.getDatabase();
    db.prepare('DELETE FROM tldr_file_summaries WHERE file_path = ?').run(filePath);
    db.prepare('DELETE FROM tldr_dependencies WHERE from_file = ? OR to_file = ?').run(filePath, filePath);
  }

  /**
   * Clear all cached data
   */
  clearAll(): void {
    const db = this.storage.getDatabase();
    db.exec(`
      DELETE FROM tldr_file_summaries;
      DELETE FROM tldr_codebase_overviews;
      DELETE FROM tldr_dependencies;
    `);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    fileSummaries: number;
    codebaseOverviews: number;
    dependencyEdges: number;
  } {
    const db = this.storage.getDatabase();
    const fileSummaries = (db.prepare('SELECT COUNT(*) as count FROM tldr_file_summaries').get() as { count: number }).count;
    const codebaseOverviews = (db.prepare('SELECT COUNT(*) as count FROM tldr_codebase_overviews').get() as { count: number }).count;
    const dependencyEdges = (db.prepare('SELECT COUNT(*) as count FROM tldr_dependencies').get() as { count: number }).count;
    return { fileSummaries, codebaseOverviews, dependencyEdges };
  }

  private rowToFileSummary(row: FileSummaryRow): FileSummary {
    return {
      id: row.id,
      filePath: row.file_path,
      contentHash: row.content_hash,
      summary: row.summary,
      exports: JSON.parse(row.exports),
      imports: JSON.parse(row.imports),
      dependencies: JSON.parse(row.dependencies),
      lineCount: row.line_count,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToCodebaseOverview(row: CodebaseOverviewRow): CodebaseOverview {
    return {
      id: row.id,
      rootPath: row.root_path,
      name: row.name,
      description: row.description,
      structure: JSON.parse(row.structure),
      keyFiles: JSON.parse(row.key_files),
      patterns: JSON.parse(row.patterns),
      techStack: JSON.parse(row.tech_stack),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
