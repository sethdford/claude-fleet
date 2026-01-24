/**
 * TLDR Routes
 *
 * Token-efficient code analysis endpoints for file summaries,
 * dependency graphs, and codebase overviews.
 */

import type { Request, Response } from 'express';
import type { RouteDependencies, ErrorResponse } from './types.js';
import { validateBody } from '../validation/schemas.js';
import { z } from 'zod';

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const storeFileSummarySchema = z.object({
  filePath: z.string().min(1).max(1000),
  contentHash: z.string().min(1).max(64),
  summary: z.string().min(1).max(10000),
  exports: z.array(z.string().max(200)).max(100).optional(),
  imports: z.array(z.string().max(500)).max(100).optional(),
  dependencies: z.array(z.string().max(500)).max(100).optional(),
  lineCount: z.number().int().min(0).optional(),
  language: z.string().max(50).optional(),
});

const storeCodebaseOverviewSchema = z.object({
  rootPath: z.string().min(1).max(1000),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  structure: z.record(z.string(), z.unknown()).optional(),
  keyFiles: z.array(z.string().max(500)).max(50).optional(),
  patterns: z.array(z.string().max(100)).max(20).optional(),
  techStack: z.array(z.string().max(100)).max(50).optional(),
});

const storeDependencySchema = z.object({
  fromFile: z.string().min(1).max(1000),
  toFile: z.string().min(1).max(1000),
  importType: z.enum(['static', 'dynamic', 'type-only']).optional(),
});

const getDependencyGraphSchema = z.object({
  rootFiles: z.array(z.string().max(1000)).min(1).max(20),
  depth: z.number().int().min(1).max(10).optional(),
});

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Get file summary
 * Route: POST /tldr/summary/get
 */
export function createGetFileSummaryHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { filePath } = req.body as { filePath?: string };

    if (!filePath) {
      res.status(400).json({ error: 'filePath required in request body' } as ErrorResponse);
      return;
    }

    const summary = deps.tldrStorage?.getFileSummary(filePath);

    if (!summary) {
      res.status(404).json({ error: 'File summary not found', filePath } as ErrorResponse);
      return;
    }

    res.json(summary);
  };
}

/**
 * Check if summary is current
 * Route: POST /tldr/summary/check
 */
export function createCheckSummaryHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { filePath, contentHash } = req.body as { filePath?: string; contentHash?: string };

    if (!filePath || !contentHash) {
      res.status(400).json({ error: 'filePath and contentHash required in request body' } as ErrorResponse);
      return;
    }

    const isCurrent = deps.tldrStorage?.isSummaryCurrent(filePath, contentHash) ?? false;

    res.json({ filePath, contentHash, isCurrent });
  };
}

/**
 * Store file summary
 */
export function createStoreFileSummaryHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(storeFileSummarySchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { filePath, contentHash, summary, exports, imports, dependencies, lineCount, language } = validation.data;

    const result = deps.tldrStorage?.storeFileSummary(filePath, contentHash, summary, {
      exports,
      imports,
      dependencies,
      lineCount,
      language,
    });

    if (!result) {
      res.status(500).json({ error: 'TLDR storage not available' } as ErrorResponse);
      return;
    }

    console.log(`[TLDR] Stored summary for ${filePath} (${lineCount ?? '?'} lines)`);
    res.json(result);
  };
}

/**
 * Get multiple file summaries
 */
export function createGetMultipleSummariesHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { filePaths } = req.body as { filePaths?: string[] };

    if (!filePaths || !Array.isArray(filePaths)) {
      res.status(400).json({ error: 'filePaths array required' } as ErrorResponse);
      return;
    }

    const summaries = deps.tldrStorage?.getFileSummaries(filePaths) ?? [];
    const found = summaries.map(s => s.filePath);
    const missing = filePaths.filter(p => !found.includes(p));

    res.json({
      found: summaries.length,
      missing: missing.length,
      summaries,
      missingPaths: missing,
    });
  };
}

/**
 * Get codebase overview
 * Route: POST /tldr/codebase/get
 */
export function createGetCodebaseOverviewHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { rootPath } = req.body as { rootPath?: string };

    if (!rootPath) {
      res.status(400).json({ error: 'rootPath required in request body' } as ErrorResponse);
      return;
    }

    const overview = deps.tldrStorage?.getCodebaseOverview(rootPath);

    if (!overview) {
      res.status(404).json({ error: 'Codebase overview not found', rootPath } as ErrorResponse);
      return;
    }

    res.json(overview);
  };
}

/**
 * Store codebase overview
 */
export function createStoreCodebaseOverviewHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(storeCodebaseOverviewSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { rootPath, name, description, structure, keyFiles, patterns, techStack } = validation.data;

    const result = deps.tldrStorage?.storeCodebaseOverview(rootPath, name, {
      description,
      structure,
      keyFiles,
      patterns,
      techStack,
    });

    if (!result) {
      res.status(500).json({ error: 'TLDR storage not available' } as ErrorResponse);
      return;
    }

    console.log(`[TLDR] Stored codebase overview: ${name} (${rootPath})`);
    res.json(result);
  };
}

/**
 * Store dependency edge
 */
export function createStoreDependencyHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(storeDependencySchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { fromFile, toFile, importType } = validation.data;

    deps.tldrStorage?.storeDependency(fromFile, toFile, importType ?? 'static');

    res.json({ success: true, fromFile, toFile, importType: importType ?? 'static' });
  };
}

/**
 * Get dependency graph
 */
export function createGetDependencyGraphHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const validation = validateBody(getDependencyGraphSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { rootFiles, depth } = validation.data;

    const graph = deps.tldrStorage?.getDependencyGraph(rootFiles, depth ?? 3);

    if (!graph) {
      res.status(500).json({ error: 'TLDR storage not available' } as ErrorResponse);
      return;
    }

    res.json({
      rootFiles,
      depth: depth ?? 3,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      ...graph,
    });
  };
}

/**
 * Get dependents of a file
 * Route: POST /tldr/dependency/dependents
 */
export function createGetDependentsHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { filePath } = req.body as { filePath?: string };

    if (!filePath) {
      res.status(400).json({ error: 'filePath required in request body' } as ErrorResponse);
      return;
    }

    const dependents = deps.tldrStorage?.getDependents(filePath) ?? [];

    res.json({
      filePath,
      dependentCount: dependents.length,
      dependents,
    });
  };
}

/**
 * Get dependencies of a file
 * Route: POST /tldr/dependency/dependencies
 */
export function createGetDependenciesHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { filePath } = req.body as { filePath?: string };

    if (!filePath) {
      res.status(400).json({ error: 'filePath required in request body' } as ErrorResponse);
      return;
    }

    const dependencies = deps.tldrStorage?.getDependencies(filePath) ?? [];

    res.json({
      filePath,
      dependencyCount: dependencies.length,
      dependencies,
    });
  };
}

/**
 * Invalidate file cache
 * Route: POST /tldr/invalidate
 */
export function createInvalidateFileHandler(deps: RouteDependencies) {
  return (req: Request, res: Response): void => {
    const { filePath } = req.body as { filePath?: string };

    if (!filePath) {
      res.status(400).json({ error: 'filePath required in request body' } as ErrorResponse);
      return;
    }

    deps.tldrStorage?.invalidateFile(filePath);

    console.log(`[TLDR] Invalidated cache for ${filePath}`);
    res.json({ success: true, filePath });
  };
}

/**
 * Get TLDR cache statistics
 */
export function createGetTLDRStatsHandler(deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    const stats = deps.tldrStorage?.getStats() ?? {
      fileSummaries: 0,
      codebaseOverviews: 0,
      dependencyEdges: 0,
    };

    res.json(stats);
  };
}

/**
 * Clear all TLDR cache
 */
export function createClearTLDRCacheHandler(deps: RouteDependencies) {
  return (_req: Request, res: Response): void => {
    deps.tldrStorage?.clearAll();
    console.log('[TLDR] Cache cleared');
    res.json({ success: true, message: 'TLDR cache cleared' });
  };
}
