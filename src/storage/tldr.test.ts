/**
 * Tests for TLDRStorage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestStorage } from '../../tests/helpers/storage-test-helper.js';
import { TLDRStorage } from './tldr.js';
import type { TestStorageContext } from '../../tests/helpers/storage-test-helper.js';

describe('TLDRStorage', () => {
  let ctx: TestStorageContext;
  let tldr: TLDRStorage;

  beforeEach(() => {
    ctx = createTestStorage();
    tldr = new TLDRStorage(ctx.storage);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ==========================================================================
  // hashContent()
  // ==========================================================================

  describe('hashContent()', () => {
    it('should return deterministic hash', () => {
      const h1 = tldr.hashContent('hello world');
      const h2 = tldr.hashContent('hello world');

      expect(h1).toBe(h2);
      expect(h1).toHaveLength(16);
    });

    it('should return different hashes for different content', () => {
      const h1 = tldr.hashContent('hello');
      const h2 = tldr.hashContent('world');

      expect(h1).not.toBe(h2);
    });
  });

  // ==========================================================================
  // isSummaryCurrent()
  // ==========================================================================

  describe('isSummaryCurrent()', () => {
    it('should return true when hash matches', () => {
      const hash = tldr.hashContent('content A');
      tldr.storeFileSummary('src/a.ts', hash, 'Summary of A');

      expect(tldr.isSummaryCurrent('src/a.ts', hash)).toBe(true);
    });

    it('should return false when hash differs', () => {
      const oldHash = tldr.hashContent('old content');
      tldr.storeFileSummary('src/a.ts', oldHash, 'Summary');

      const newHash = tldr.hashContent('new content');
      expect(tldr.isSummaryCurrent('src/a.ts', newHash)).toBe(false);
    });

    it('should return false for unknown file', () => {
      expect(tldr.isSummaryCurrent('unknown.ts', 'abc')).toBe(false);
    });
  });

  // ==========================================================================
  // storeFileSummary() / getFileSummary()
  // ==========================================================================

  describe('file summaries', () => {
    it('should store and retrieve a file summary', () => {
      const hash = tldr.hashContent('const x = 1;');
      const stored = tldr.storeFileSummary('src/index.ts', hash, 'Entry point', {
        exports: ['main'],
        imports: ['./config'],
        lineCount: 50,
        language: 'typescript',
      });

      expect(stored.filePath).toBe('src/index.ts');
      expect(stored.summary).toBe('Entry point');
      expect(stored.exports).toEqual(['main']);
      expect(stored.imports).toEqual(['./config']);
      expect(stored.lineCount).toBe(50);
      expect(stored.language).toBe('typescript');
    });

    it('should upsert on conflict', () => {
      const hash1 = tldr.hashContent('v1');
      tldr.storeFileSummary('src/a.ts', hash1, 'Version 1');

      const hash2 = tldr.hashContent('v2');
      tldr.storeFileSummary('src/a.ts', hash2, 'Version 2');

      const retrieved = tldr.getFileSummary('src/a.ts');
      expect(retrieved!.summary).toBe('Version 2');
      expect(retrieved!.contentHash).toBe(hash2);
    });

    it('should return null for unknown file', () => {
      expect(tldr.getFileSummary('unknown.ts')).toBeNull();
    });
  });

  // ==========================================================================
  // getFileSummaries()
  // ==========================================================================

  describe('getFileSummaries()', () => {
    it('should return multiple summaries', () => {
      tldr.storeFileSummary('a.ts', 'h1', 'Summary A');
      tldr.storeFileSummary('b.ts', 'h2', 'Summary B');
      tldr.storeFileSummary('c.ts', 'h3', 'Summary C');

      const results = tldr.getFileSummaries(['a.ts', 'c.ts']);
      expect(results).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
      const results = tldr.getFileSummaries([]);
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Codebase overview
  // ==========================================================================

  describe('codebase overview', () => {
    it('should store and retrieve overview', () => {
      const overview = tldr.storeCodebaseOverview('/project', 'MyApp', {
        description: 'A web app',
        keyFiles: ['src/index.ts', 'package.json'],
        patterns: ['MVC'],
        techStack: ['TypeScript', 'Express'],
        structure: { src: { 'index.ts': {} } },
      });

      expect(overview.name).toBe('MyApp');
      expect(overview.description).toBe('A web app');
      expect(overview.keyFiles).toEqual(['src/index.ts', 'package.json']);

      const retrieved = tldr.getCodebaseOverview('/project');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('MyApp');
    });

    it('should upsert on conflict', () => {
      tldr.storeCodebaseOverview('/project', 'V1', { description: 'Old' });
      tldr.storeCodebaseOverview('/project', 'V2', { description: 'New' });

      const retrieved = tldr.getCodebaseOverview('/project');
      expect(retrieved!.name).toBe('V2');
      expect(retrieved!.description).toBe('New');
    });

    it('should return null for unknown path', () => {
      expect(tldr.getCodebaseOverview('/nowhere')).toBeNull();
    });
  });

  // ==========================================================================
  // Dependencies
  // ==========================================================================

  describe('dependency graph', () => {
    it('should store and retrieve dependency edges', () => {
      tldr.storeDependency('a.ts', 'b.ts', 'static');
      tldr.storeDependency('a.ts', 'c.ts', 'dynamic');

      const deps = tldr.getDependencies('a.ts');
      expect(deps).toHaveLength(2);
      expect(deps[0].fromFile).toBe('a.ts');
    });

    it('should get dependents (reverse edges)', () => {
      tldr.storeDependency('a.ts', 'shared.ts');
      tldr.storeDependency('b.ts', 'shared.ts');

      const dependents = tldr.getDependents('shared.ts');
      expect(dependents).toHaveLength(2);
    });

    it('should upsert on conflict', () => {
      tldr.storeDependency('a.ts', 'b.ts', 'static');
      tldr.storeDependency('a.ts', 'b.ts', 'dynamic');

      const deps = tldr.getDependencies('a.ts');
      expect(deps).toHaveLength(1);
      expect(deps[0].importType).toBe('dynamic');
    });
  });

  // ==========================================================================
  // getDependencyGraph()
  // ==========================================================================

  describe('getDependencyGraph()', () => {
    it('should traverse dependency graph up to depth', () => {
      tldr.storeDependency('a.ts', 'b.ts');
      tldr.storeDependency('b.ts', 'c.ts');
      tldr.storeDependency('c.ts', 'd.ts');

      const graph = tldr.getDependencyGraph(['a.ts'], 2);
      expect(graph.nodes).toContain('a.ts');
      expect(graph.nodes).toContain('b.ts');
      expect(graph.nodes).toContain('c.ts');
      expect(graph.edges).toHaveLength(2); // a->b, b->c
    });

    it('should handle no dependencies', () => {
      const graph = tldr.getDependencyGraph(['standalone.ts']);
      expect(graph.nodes).toEqual(['standalone.ts']);
      expect(graph.edges).toEqual([]);
    });
  });

  // ==========================================================================
  // invalidateFile()
  // ==========================================================================

  describe('invalidateFile()', () => {
    it('should remove summary and dependency edges', () => {
      tldr.storeFileSummary('target.ts', 'h1', 'Summary');
      tldr.storeDependency('target.ts', 'dep.ts');
      tldr.storeDependency('other.ts', 'target.ts');

      tldr.invalidateFile('target.ts');

      expect(tldr.getFileSummary('target.ts')).toBeNull();
      expect(tldr.getDependencies('target.ts')).toEqual([]);
      expect(tldr.getDependents('target.ts')).toEqual([]);
    });
  });

  // ==========================================================================
  // clearAll()
  // ==========================================================================

  describe('clearAll()', () => {
    it('should wipe all data', () => {
      tldr.storeFileSummary('a.ts', 'h1', 'S');
      tldr.storeCodebaseOverview('/proj', 'X');
      tldr.storeDependency('a.ts', 'b.ts');

      tldr.clearAll();

      const stats = tldr.getStats();
      expect(stats.fileSummaries).toBe(0);
      expect(stats.codebaseOverviews).toBe(0);
      expect(stats.dependencyEdges).toBe(0);
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats()', () => {
    it('should return correct counts', () => {
      tldr.storeFileSummary('a.ts', 'h1', 'S1');
      tldr.storeFileSummary('b.ts', 'h2', 'S2');
      tldr.storeCodebaseOverview('/proj', 'P');
      tldr.storeDependency('a.ts', 'b.ts');

      const stats = tldr.getStats();
      expect(stats.fileSummaries).toBe(2);
      expect(stats.codebaseOverviews).toBe(1);
      expect(stats.dependencyEdges).toBe(1);
    });

    it('should return zeros when empty', () => {
      const stats = tldr.getStats();
      expect(stats.fileSummaries).toBe(0);
      expect(stats.codebaseOverviews).toBe(0);
      expect(stats.dependencyEdges).toBe(0);
    });
  });
});
