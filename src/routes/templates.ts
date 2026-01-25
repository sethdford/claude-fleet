/**
 * Template Route Handlers
 *
 * Swarm template management endpoints for creating, listing, updating,
 * and running pre-configured swarm configurations.
 */

import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  validateBody,
  createSwarmTemplateSchema,
  updateSwarmTemplateSchema,
  listTemplatesQuerySchema,
  runTemplateSchema,
} from '../validation/schemas.js';
import type { ErrorResponse, SwarmTemplate } from '../types.js';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

// ============================================================================
// TEMPLATE HANDLERS
// ============================================================================

/**
 * POST /templates - Create a new template
 */
export function createCreateTemplateHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createSwarmTemplateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { name, description, phases } = validation.data;

    // Check for duplicate name
    const existing = deps.legacyStorage.getTemplateByName(name);
    if (existing) {
      res.status(409).json({ error: `Template with name '${name}' already exists` } as ErrorResponse);
      return;
    }

    const now = Date.now();
    const template: SwarmTemplate = {
      id: uuidv4(),
      name,
      description: description ?? null,
      isBuiltin: false,
      phases: {
        discovery: phases.discovery ?? [],
        development: phases.development ?? [],
        quality: phases.quality ?? [],
        delivery: phases.delivery ?? [],
      },
      createdAt: now,
      updatedAt: now,
    };

    deps.legacyStorage.insertTemplate(template);
    console.log(`[TEMPLATE] Created ${template.id}: ${name}`);
    res.status(201).json(template);
  });
}

/**
 * GET /templates - List all templates
 */
export function createListTemplatesHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = listTemplatesQuerySchema.safeParse(req.query);
    if (!validation.success) {
      res.status(400).json({
        error: validation.error.issues.map((e) => e.message).join(', ')
      } as ErrorResponse);
      return;
    }

    const { builtin, limit } = validation.data;

    const options: { builtin?: boolean; limit?: number } = {};
    if (builtin === 'true') options.builtin = true;
    if (builtin === 'false') options.builtin = false;
    if (limit) options.limit = limit;

    const templates = deps.legacyStorage.getAllTemplates(options);
    res.json(templates);
  });
}

/**
 * GET /templates/:id - Get a single template
 */
export function createGetTemplateHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const template = deps.legacyStorage.getTemplate(id);

    if (!template) {
      res.status(404).json({ error: 'Template not found' } as ErrorResponse);
      return;
    }

    res.json(template);
  });
}

/**
 * PATCH /templates/:id - Update a template
 */
export function createUpdateTemplateHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const validation = validateBody(updateSwarmTemplateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    // Check if template exists
    const existing = deps.legacyStorage.getTemplate(id);
    if (!existing) {
      res.status(404).json({ error: 'Template not found' } as ErrorResponse);
      return;
    }

    // Check if it's a builtin template
    if (existing.isBuiltin) {
      res.status(403).json({ error: 'Cannot modify built-in templates' } as ErrorResponse);
      return;
    }

    // Check for duplicate name if renaming
    if (validation.data.name && validation.data.name !== existing.name) {
      const nameConflict = deps.legacyStorage.getTemplateByName(validation.data.name);
      if (nameConflict) {
        res.status(409).json({ error: `Template with name '${validation.data.name}' already exists` } as ErrorResponse);
        return;
      }
    }

    const updated = deps.legacyStorage.updateTemplate(id, {
      name: validation.data.name,
      description: validation.data.description,
      phases: validation.data.phases,
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to update template' } as ErrorResponse);
      return;
    }

    console.log(`[TEMPLATE] Updated ${id}: ${updated.name}`);
    res.json(updated);
  });
}

/**
 * DELETE /templates/:id - Delete a template
 */
export function createDeleteTemplateHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const template = deps.legacyStorage.getTemplate(id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' } as ErrorResponse);
      return;
    }

    if (template.isBuiltin) {
      res.status(403).json({ error: 'Cannot delete built-in templates' } as ErrorResponse);
      return;
    }

    const deleted = deps.legacyStorage.deleteTemplate(id);
    if (!deleted) {
      res.status(500).json({ error: 'Failed to delete template' } as ErrorResponse);
      return;
    }

    console.log(`[TEMPLATE] Deleted ${id}: ${template.name}`);
    res.status(204).send();
  });
}

/**
 * POST /templates/:id/run - Run a template to spawn a swarm
 */
export function createRunTemplateHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const validation = validateBody(runTemplateSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const template = deps.legacyStorage.getTemplate(id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' } as ErrorResponse);
      return;
    }

    // Generate swarm name if not provided
    const swarmName = validation.data.swarmName ?? `${template.name}-${Date.now()}`;

    // Create the swarm
    const swarmId = uuidv4();
    const totalRoles = Object.values(template.phases).flat();

    deps.storage.insertSwarm({
      id: swarmId,
      name: swarmName,
      description: `Swarm from template: ${template.name}`,
      maxAgents: totalRoles.length,
    });

    // Queue workers for each role in phase order
    const queuedItems: Array<{ role: string; phase: string; queueId: string }> = [];
    const phaseOrder: Array<keyof SwarmTemplate['phases']> = ['discovery', 'development', 'quality', 'delivery'];

    for (const phase of phaseOrder) {
      const roles = template.phases[phase];
      for (const role of roles) {
        const queueItem = await deps.storage.spawnQueue.enqueue({
          requesterHandle: 'template-runner',
          targetAgentType: role,
          depthLevel: 0,
          priority: 'normal',
          dependsOn: [],
          swarmId,
          payload: {
            task: `Execute ${role} role for swarm ${swarmName} (phase: ${phase})`,
            context: {
              templateId: template.id,
              templateName: template.name,
              phase,
            },
          },
        });

        queuedItems.push({
          role,
          phase,
          queueId: queueItem.id,
        });
      }
    }

    console.log(`[TEMPLATE] Running ${template.name} -> swarm ${swarmId} with ${queuedItems.length} workers`);

    // Auto-delete temporary templates (those starting with _temp-)
    // These are created by the dashboard for one-time runs
    if (template.name.startsWith('_temp-') && !template.isBuiltin) {
      deps.legacyStorage.deleteTemplate(template.id);
      console.log(`[TEMPLATE] Auto-deleted temp template ${template.id}`);
    }

    res.status(201).json({
      swarmId,
      swarmName,
      templateId: template.id,
      templateName: template.name,
      queuedWorkers: queuedItems,
      totalWorkers: queuedItems.length,
    });
  });
}
