/**
 * @cct/storage - SQLite Persistence Layer
 *
 * Provides unified database access for all CCT packages.
 */

export { Database, getDatabase, closeDatabase, setDatabasePath, resetDatabase } from './database.js';
export type { DatabaseOptions } from './database.js';

export * from './stores/index.js';
export { runMigrations, getSchemaVersion } from './migrations.js';
