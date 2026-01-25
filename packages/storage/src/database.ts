/**
 * Core Database Connection Manager
 *
 * Provides a singleton connection to SQLite with migration support.
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { runMigrations } from './migrations.js';

export interface DatabaseOptions {
  path?: string;
  inMemory?: boolean;
  verbose?: boolean;
}

let instance: Database.Database | null = null;
let customDbPath: string | null = null;

/**
 * Set a custom database path (for testing)
 */
export function setDatabasePath(path: string | null): void {
  // Close existing connection if any
  if (instance) {
    instance.close();
    instance = null;
  }
  customDbPath = path;
}

/**
 * Reset the database instance (for testing)
 */
export function resetDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
  customDbPath = null;
}

/**
 * Get or create the database connection
 */
export function getDatabase(options: DatabaseOptions = {}): Database.Database {
  if (instance) {
    return instance;
  }

  const dbPath = options.inMemory
    ? ':memory:'
    : options.path || customDbPath || getDefaultDbPath();

  // Ensure directory exists
  if (!options.inMemory && dbPath !== ':memory:') {
    const dir = resolve(dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  instance = new Database(dbPath, {
    verbose: options.verbose ? console.log : undefined,
  });

  // Enable WAL mode for better concurrent access
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(instance);

  return instance;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/**
 * Get the default database path
 */
function getDefaultDbPath(): string {
  const cctDir = resolve(homedir(), '.cct');
  return resolve(cctDir, 'data.db');
}

/**
 * Database class for direct usage
 */
export class DatabaseConnection {
  private db: Database.Database;

  constructor(options: DatabaseOptions = {}) {
    this.db = getDatabase(options);
  }

  get raw(): Database.Database {
    return this.db;
  }

  /**
   * Run a query that returns rows
   */
  query<T = unknown>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Run a query that returns a single row
   */
  queryOne<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  /**
   * Run an insert/update/delete query
   */
  execute(sql: string, params: unknown[] = []): Database.RunResult {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  /**
   * Run multiple statements in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Close the connection
   */
  close(): void {
    closeDatabase();
  }
}

export { DatabaseConnection as Database };
