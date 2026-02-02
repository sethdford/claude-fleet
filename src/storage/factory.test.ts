/**
 * Tests for Storage Factory
 *
 * Tests createStorage() and getStorageConfigFromEnv().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStorage, getStorageConfigFromEnv } from './factory.js';

// Suppress console.log from adapter initialize()
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// createStorage
// ============================================================================

describe('createStorage', () => {
  it('should create DynamoDB storage', async () => {
    const storage = await createStorage({
      backend: 'dynamodb',
      region: 'us-east-1',
    });
    expect(storage).toBeDefined();
    expect(storage.team).toBeDefined();
    expect(storage.worker).toBeDefined();
  });

  it('should create S3 storage', async () => {
    const storage = await createStorage({
      backend: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
    });
    expect(storage).toBeDefined();
    expect(storage.team).toBeDefined();
  });

  it('should create Firestore storage', async () => {
    const storage = await createStorage({
      backend: 'firestore',
      projectId: 'test-project',
    });
    expect(storage).toBeDefined();
    expect(storage.team).toBeDefined();
  });

  it('should create PostgreSQL storage', async () => {
    const storage = await createStorage({
      backend: 'postgresql',
      connectionString: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(storage).toBeDefined();
    expect(storage.team).toBeDefined();
  });

  it('should throw for unknown backend', async () => {
    await expect(
      createStorage({ backend: 'redis' } as never),
    ).rejects.toThrow('Unknown storage backend');
  });
});

// ============================================================================
// getStorageConfigFromEnv
// ============================================================================

describe('getStorageConfigFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should default to sqlite', () => {
    delete process.env.STORAGE_BACKEND;
    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('sqlite');
  });

  it('should use DB_PATH for sqlite', () => {
    process.env.STORAGE_BACKEND = 'sqlite';
    process.env.DB_PATH = '/custom/path.db';
    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('sqlite');
    expect((config as { path: string }).path).toBe('/custom/path.db');
  });

  it('should default sqlite path to ./fleet.db', () => {
    delete process.env.STORAGE_BACKEND;
    delete process.env.DB_PATH;
    const config = getStorageConfigFromEnv();
    expect((config as { path: string }).path).toBe('./fleet.db');
  });

  it('should parse dynamodb config from env', () => {
    process.env.STORAGE_BACKEND = 'dynamodb';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.DYNAMODB_TABLE_PREFIX = 'myapp_';
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';

    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('dynamodb');
    const dynamo = config as { region: string; tablePrefix: string; endpoint: string };
    expect(dynamo.region).toBe('eu-west-1');
    expect(dynamo.tablePrefix).toBe('myapp_');
    expect(dynamo.endpoint).toBe('http://localhost:8000');
  });

  it('should parse s3 config from env', () => {
    process.env.STORAGE_BACKEND = 's3';
    process.env.S3_BUCKET = 'my-bucket';
    process.env.AWS_REGION = 'ap-southeast-1';
    process.env.S3_PREFIX = 'fleet/';

    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('s3');
    const s3 = config as { bucket: string; region: string; prefix: string };
    expect(s3.bucket).toBe('my-bucket');
    expect(s3.region).toBe('ap-southeast-1');
    expect(s3.prefix).toBe('fleet/');
  });

  it('should parse firestore config from env', () => {
    process.env.STORAGE_BACKEND = 'firestore';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-project';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';

    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('firestore');
    const fs = config as { projectId: string; credentials: string };
    expect(fs.projectId).toBe('my-project');
    expect(fs.credentials).toBe('/path/to/creds.json');
  });

  it('should use FIRESTORE_PROJECT_ID as fallback', () => {
    process.env.STORAGE_BACKEND = 'firestore';
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.FIRESTORE_PROJECT_ID = 'alt-project';

    const config = getStorageConfigFromEnv();
    const fs = config as { projectId: string };
    expect(fs.projectId).toBe('alt-project');
  });

  it('should parse postgresql config from env', () => {
    process.env.STORAGE_BACKEND = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/mydb';
    process.env.POSTGRESQL_SCHEMA = 'fleet';
    process.env.POSTGRESQL_POOL_SIZE = '20';

    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('postgresql');
    const pg = config as { connectionString: string; schema: string; poolSize: number };
    expect(pg.connectionString).toBe('postgresql://user:pass@localhost:5432/mydb');
    expect(pg.schema).toBe('fleet');
    expect(pg.poolSize).toBe(20);
  });

  it('should use POSTGRESQL_URL as fallback', () => {
    process.env.STORAGE_BACKEND = 'postgresql';
    delete process.env.DATABASE_URL;
    process.env.POSTGRESQL_URL = 'postgresql://alt@localhost:5432/db';

    const config = getStorageConfigFromEnv();
    const pg = config as { connectionString: string };
    expect(pg.connectionString).toBe('postgresql://alt@localhost:5432/db');
  });

  it('should fall back to sqlite for unknown backend', () => {
    process.env.STORAGE_BACKEND = 'redis';
    const config = getStorageConfigFromEnv();
    expect(config.backend).toBe('sqlite');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown STORAGE_BACKEND'),
    );
  });

  it('should use defaults for dynamodb when env vars missing', () => {
    process.env.STORAGE_BACKEND = 'dynamodb';
    delete process.env.AWS_REGION;
    delete process.env.DYNAMODB_TABLE_PREFIX;

    const config = getStorageConfigFromEnv();
    const dynamo = config as { region: string; tablePrefix: string };
    expect(dynamo.region).toBe('us-east-1');
    expect(dynamo.tablePrefix).toBe('fleet_');
  });

  it('should use defaults for s3 when env vars missing', () => {
    process.env.STORAGE_BACKEND = 's3';
    delete process.env.S3_BUCKET;
    delete process.env.AWS_REGION;
    delete process.env.S3_PREFIX;

    const config = getStorageConfigFromEnv();
    const s3 = config as { bucket: string; region: string; prefix: string };
    expect(s3.bucket).toBe('claude-fleet');
    expect(s3.region).toBe('us-east-1');
    expect(s3.prefix).toBe('data/');
  });
});
