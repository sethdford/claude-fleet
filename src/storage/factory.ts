/**
 * Storage Factory
 *
 * Creates storage instances based on configuration.
 * Supports: SQLite, DynamoDB, S3, Firestore, PostgreSQL
 */

import type {
  IStorage,
  StorageConfig,
  SQLiteConfig,
  DynamoDBConfig,
  S3Config,
  FirestoreConfig,
  PostgreSQLConfig,
} from './interfaces.js';

/**
 * Create a storage instance based on configuration
 */
export async function createStorage(config: StorageConfig): Promise<IStorage> {
  switch (config.backend) {
    case 'sqlite':
      return createSQLiteStorage(config);

    case 'dynamodb':
      return createDynamoDBStorage(config);

    case 's3':
      return createS3Storage(config);

    case 'firestore':
      return createFirestoreStorage(config);

    case 'postgresql':
      return createPostgreSQLStorage(config);

    default:
      throw new Error(`Unknown storage backend: ${(config as StorageConfig).backend}`);
  }
}

/**
 * Create SQLite storage (default, local development)
 */
async function createSQLiteStorage(config: SQLiteConfig): Promise<IStorage> {
  const { SQLiteStorageAdapter } = await import('./adapters/sqlite-adapter.js');
  const storage = new SQLiteStorageAdapter(config.path);
  await storage.initialize();
  return storage;
}

/**
 * Create DynamoDB storage (AWS serverless)
 */
async function createDynamoDBStorage(config: DynamoDBConfig): Promise<IStorage> {
  const { DynamoDBStorageAdapter } = await import('./adapters/dynamodb-adapter.js');
  const storage = new DynamoDBStorageAdapter(config);
  await storage.initialize();
  return storage;
}

/**
 * Create S3 storage (blob storage)
 */
async function createS3Storage(config: S3Config): Promise<IStorage> {
  const { S3StorageAdapter } = await import('./adapters/s3-adapter.js');
  const storage = new S3StorageAdapter(config);
  await storage.initialize();
  return storage;
}

/**
 * Create Firestore storage (Google Cloud)
 */
async function createFirestoreStorage(config: FirestoreConfig): Promise<IStorage> {
  const { FirestoreStorageAdapter } = await import('./adapters/firestore-adapter.js');
  const storage = new FirestoreStorageAdapter(config);
  await storage.initialize();
  return storage;
}

/**
 * Create PostgreSQL storage
 */
async function createPostgreSQLStorage(config: PostgreSQLConfig): Promise<IStorage> {
  const { PostgreSQLStorageAdapter } = await import('./adapters/postgresql-adapter.js');
  const storage = new PostgreSQLStorageAdapter(config);
  await storage.initialize();
  return storage;
}

/**
 * Get storage config from environment variables
 */
export function getStorageConfigFromEnv(): StorageConfig {
  const backend = process.env.STORAGE_BACKEND ?? 'sqlite';

  switch (backend) {
    case 'sqlite':
      return {
        backend: 'sqlite',
        path: process.env.DB_PATH ?? './fleet.db',
      };

    case 'dynamodb':
      return {
        backend: 'dynamodb',
        region: process.env.AWS_REGION ?? 'us-east-1',
        tablePrefix: process.env.DYNAMODB_TABLE_PREFIX ?? 'fleet_',
        endpoint: process.env.DYNAMODB_ENDPOINT,
      };

    case 's3':
      return {
        backend: 's3',
        bucket: process.env.S3_BUCKET ?? 'claude-fleet',
        region: process.env.AWS_REGION ?? 'us-east-1',
        prefix: process.env.S3_PREFIX ?? 'data/',
        endpoint: process.env.S3_ENDPOINT,
      };

    case 'firestore':
      return {
        backend: 'firestore',
        projectId: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIRESTORE_PROJECT_ID ?? '',
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      };

    case 'postgresql':
      return {
        backend: 'postgresql',
        connectionString: process.env.DATABASE_URL ?? process.env.POSTGRESQL_URL ?? '',
        schema: process.env.POSTGRESQL_SCHEMA ?? 'public',
        poolSize: parseInt(process.env.POSTGRESQL_POOL_SIZE ?? '10', 10),
      };

    default:
      console.warn(`Unknown STORAGE_BACKEND: ${backend}, falling back to sqlite`);
      return {
        backend: 'sqlite',
        path: process.env.DB_PATH ?? './fleet.db',
      };
  }
}
