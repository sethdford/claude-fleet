/**
 * Tests for TaskTemplateEngine
 *
 * Co-located test that enhances the existing tests/scheduler.test.ts with
 * additional coverage for:
 * - TASK_TEMPLATES export structure
 * - executeTemplate() happy and error paths
 * - buildPrompt() with all context fields
 * - Event emissions (templateStarted, templateCompleted, templateFailed)
 * - Template overwriting via registerTemplate
 * - Category filtering edge cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TaskTemplateEngine', () => {
  let TaskTemplateEngine: typeof import('./templates.js').TaskTemplateEngine;
  let TASK_TEMPLATES: typeof import('./templates.js').TASK_TEMPLATES;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./templates.js');
    TaskTemplateEngine = mod.TaskTemplateEngine;
    TASK_TEMPLATES = mod.TASK_TEMPLATES;
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getInstance()', () => {
    it('should return the same instance', () => {
      const a = TaskTemplateEngine.getInstance();
      const b = TaskTemplateEngine.getInstance();
      expect(a).toBe(b);
    });
  });

  // ==========================================================================
  // TASK_TEMPLATES export
  // ==========================================================================

  describe('TASK_TEMPLATES', () => {
    it('should be an array with more than 10 templates', () => {
      expect(Array.isArray(TASK_TEMPLATES)).toBe(true);
      expect(TASK_TEMPLATES.length).toBeGreaterThan(10);
    });

    it('should have valid structure for every template', () => {
      for (const template of TASK_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.category).toBeTruthy();
        expect(template.role).toBeTruthy();
        expect(typeof template.estimatedMinutes).toBe('number');
        expect(template.prompt).toBeTruthy();
      }
    });

    it('should have unique IDs across all templates', () => {
      const ids = TASK_TEMPLATES.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include templates for all categories', () => {
      const categories = new Set(TASK_TEMPLATES.map(t => t.category));
      expect(categories.has('documentation')).toBe(true);
      expect(categories.has('testing')).toBe(true);
      expect(categories.has('security')).toBe(true);
      expect(categories.has('maintenance')).toBe(true);
      expect(categories.has('review')).toBe(true);
      expect(categories.has('conversion')).toBe(true);
    });

    it('should have valid outputFormat values', () => {
      const validFormats = new Set(['pr', 'commit', 'report', 'slack']);
      for (const template of TASK_TEMPLATES) {
        if (template.outputFormat) {
          expect(validFormats.has(template.outputFormat)).toBe(true);
        }
      }
    });

    it('should have valid notifyOn values', () => {
      const validEvents = new Set(['start', 'complete', 'error']);
      for (const template of TASK_TEMPLATES) {
        if (template.notifyOn) {
          for (const event of template.notifyOn) {
            expect(validEvents.has(event)).toBe(true);
          }
        }
      }
    });
  });

  // ==========================================================================
  // getTemplate()
  // ==========================================================================

  describe('getTemplate()', () => {
    it('should return a built-in template by ID', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('update-documentation');

      expect(template).toBeDefined();
      expect(template!.name).toBe('Update Documentation');
      expect(template!.category).toBe('documentation');
      expect(template!.role).toBe('tech-writer');
    });

    it('should return undefined for non-existent ID', () => {
      const engine = TaskTemplateEngine.getInstance();
      expect(engine.getTemplate('does-not-exist')).toBeUndefined();
    });

    it('should return security-scan template', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('security-scan');
      expect(template).toBeDefined();
      expect(template!.category).toBe('security');
      expect(template!.notifyOn).toContain('start');
      expect(template!.notifyOn).toContain('complete');
      expect(template!.notifyOn).toContain('error');
    });

    it('should return generate-tests template with steps', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('generate-tests');
      expect(template).toBeDefined();
      expect(template!.steps).toBeDefined();
      expect(template!.steps!.length).toBeGreaterThan(0);
    });

    it('should return generate-pr-tests with required context', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('generate-pr-tests');
      expect(template).toBeDefined();
      expect(template!.requiredContext).toContain('prNumber');
      expect(template!.requiredContext).toContain('files');
    });
  });

  // ==========================================================================
  // getAllTemplates()
  // ==========================================================================

  describe('getAllTemplates()', () => {
    it('should return all built-in templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getAllTemplates();
      expect(templates.length).toBe(TASK_TEMPLATES.length);
    });

    it('should include custom templates after registration', () => {
      const engine = TaskTemplateEngine.getInstance();
      const initialCount = engine.getAllTemplates().length;

      engine.registerTemplate({
        id: 'custom-new',
        name: 'Custom New',
        description: 'A new template',
        category: 'maintenance',
        role: 'worker',
        estimatedMinutes: 5,
        prompt: 'Do custom work',
      });

      expect(engine.getAllTemplates().length).toBe(initialCount + 1);
    });
  });

  // ==========================================================================
  // getTemplatesByCategory()
  // ==========================================================================

  describe('getTemplatesByCategory()', () => {
    it('should return only documentation templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getTemplatesByCategory('documentation');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(t => t.category === 'documentation')).toBe(true);
    });

    it('should return only testing templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getTemplatesByCategory('testing');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(t => t.category === 'testing')).toBe(true);
    });

    it('should return only security templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getTemplatesByCategory('security');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(t => t.category === 'security')).toBe(true);
    });

    it('should return only maintenance templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getTemplatesByCategory('maintenance');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(t => t.category === 'maintenance')).toBe(true);
    });

    it('should return only review templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getTemplatesByCategory('review');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(t => t.category === 'review')).toBe(true);
    });

    it('should return only conversion templates', () => {
      const engine = TaskTemplateEngine.getInstance();
      const templates = engine.getTemplatesByCategory('conversion');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every(t => t.category === 'conversion')).toBe(true);
    });

    it('should return empty array for non-existent category', () => {
      const engine = TaskTemplateEngine.getInstance();
      // Cast to trick TypeScript - testing edge case
      const templates = engine.getTemplatesByCategory('nonexistent' as 'testing');
      expect(templates).toEqual([]);
    });
  });

  // ==========================================================================
  // registerTemplate()
  // ==========================================================================

  describe('registerTemplate()', () => {
    it('should register a custom template', () => {
      const engine = TaskTemplateEngine.getInstance();
      engine.registerTemplate({
        id: 'custom-lint-check',
        name: 'Custom Lint Check',
        description: 'Run custom linting',
        category: 'maintenance',
        role: 'fullstack-dev',
        estimatedMinutes: 3,
        prompt: 'Run custom lint rules',
      });

      const template = engine.getTemplate('custom-lint-check');
      expect(template).toBeDefined();
      expect(template!.name).toBe('Custom Lint Check');
    });

    it('should overwrite an existing template with the same ID', () => {
      const engine = TaskTemplateEngine.getInstance();
      const countBefore = engine.getAllTemplates().length;

      engine.registerTemplate({
        id: 'update-documentation',
        name: 'Updated Documentation Template',
        description: 'Overwritten',
        category: 'documentation',
        role: 'tech-writer',
        estimatedMinutes: 20,
        prompt: 'Updated prompt for docs',
      });

      const template = engine.getTemplate('update-documentation');
      expect(template!.name).toBe('Updated Documentation Template');
      expect(template!.prompt).toBe('Updated prompt for docs');
      // Count should not change (overwrite, not add)
      expect(engine.getAllTemplates().length).toBe(countBefore);
    });
  });

  // ==========================================================================
  // buildPrompt()
  // ==========================================================================

  describe('buildPrompt()', () => {
    it('should include repository in prompt context', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'myorg/myrepo',
      });

      expect(prompt).toContain('Repository: myorg/myrepo');
      expect(prompt).toContain('--- CONTEXT ---');
    });

    it('should include branch when provided', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'org/repo',
        branch: 'feature/new-api',
      });

      expect(prompt).toContain('Branch: feature/new-api');
    });

    it('should include PR number when provided', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('code-review', {
        repository: 'org/repo',
        prNumber: 42,
      });

      expect(prompt).toContain('Pull Request: #42');
    });

    it('should include issue number when provided', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'org/repo',
        issueNumber: 100,
      });

      expect(prompt).toContain('Issue: #100');
    });

    it('should include file list when provided', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('generate-pr-tests', {
        repository: 'org/repo',
        prNumber: 5,
        files: ['src/index.ts', 'src/utils.ts', 'README.md'],
      });

      expect(prompt).toContain('Files Changed:');
      expect(prompt).toContain('src/index.ts');
      expect(prompt).toContain('src/utils.ts');
      expect(prompt).toContain('README.md');
    });

    it('should include labels when provided', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('code-review', {
        repository: 'org/repo',
        labels: ['bug', 'priority:high', 'needs-review'],
      });

      expect(prompt).toContain('Labels: bug, priority:high, needs-review');
    });

    it('should not include optional fields when not provided', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'org/repo',
      });

      expect(prompt).not.toContain('Branch:');
      expect(prompt).not.toContain('Pull Request:');
      expect(prompt).not.toContain('Issue:');
      expect(prompt).not.toContain('Files Changed:');
      expect(prompt).not.toContain('Labels:');
    });

    it('should not include empty files array', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'org/repo',
        files: [],
      });

      expect(prompt).not.toContain('Files Changed:');
    });

    it('should not include empty labels array', () => {
      const engine = TaskTemplateEngine.getInstance();
      const prompt = engine.buildPrompt('update-documentation', {
        repository: 'org/repo',
        labels: [],
      });

      expect(prompt).not.toContain('Labels:');
    });

    it('should throw for non-existent template', () => {
      const engine = TaskTemplateEngine.getInstance();
      expect(() => {
        engine.buildPrompt('nonexistent-template', { repository: 'test' });
      }).toThrow('Template not found: nonexistent-template');
    });

    it('should include the template prompt text', () => {
      const engine = TaskTemplateEngine.getInstance();
      const template = engine.getTemplate('auto-fix-lint-errors');
      const prompt = engine.buildPrompt('auto-fix-lint-errors', {
        repository: 'org/repo',
      });

      expect(prompt).toContain(template!.prompt);
    });
  });

  // ==========================================================================
  // executeTemplate()
  // ==========================================================================

  describe('executeTemplate()', () => {
    it('should return success for a valid template', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const result = await engine.executeTemplate('update-documentation', {
        repository: 'org/repo',
      });

      expect(result.success).toBe(true);
      expect(result.templateId).toBe('update-documentation');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.output).toBe('Template executed successfully');
    });

    it('should return failure for non-existent template', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const result = await engine.executeTemplate('nonexistent', {
        repository: 'org/repo',
      });

      expect(result.success).toBe(false);
      expect(result.templateId).toBe('nonexistent');
      expect(result.duration).toBe(0);
      expect(result.errors).toContain('Template not found: nonexistent');
    });

    it('should emit templateStarted event', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const startedSpy = vi.fn();
      engine.on('templateStarted', startedSpy);

      await engine.executeTemplate('generate-tests', {
        repository: 'org/repo',
      });

      expect(startedSpy).toHaveBeenCalledOnce();
      expect(startedSpy.mock.calls[0][0].template.id).toBe('generate-tests');
      expect(startedSpy.mock.calls[0][0].context.repository).toBe('org/repo');
    });

    it('should emit templateCompleted event on success', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const completedSpy = vi.fn();
      engine.on('templateCompleted', completedSpy);

      await engine.executeTemplate('security-scan', {
        repository: 'org/repo',
      });

      expect(completedSpy).toHaveBeenCalledOnce();
      expect(completedSpy.mock.calls[0][0].template.id).toBe('security-scan');
      expect(completedSpy.mock.calls[0][0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should emit executeTemplate event with prompt', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const executeSpy = vi.fn();
      engine.on('executeTemplate', executeSpy);

      await engine.executeTemplate('auto-fix-lint-errors', {
        repository: 'org/repo',
        branch: 'main',
      });

      expect(executeSpy).toHaveBeenCalledOnce();
      expect(executeSpy.mock.calls[0][0].prompt).toContain('Repository: org/repo');
      expect(executeSpy.mock.calls[0][0].prompt).toContain('Branch: main');
    });

    it('should not emit templateStarted for non-existent template', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const startedSpy = vi.fn();
      engine.on('templateStarted', startedSpy);

      await engine.executeTemplate('nonexistent', {
        repository: 'org/repo',
      });

      expect(startedSpy).not.toHaveBeenCalled();
    });

    it('should include duration in result', async () => {
      const engine = TaskTemplateEngine.getInstance();
      const result = await engine.executeTemplate('update-documentation', {
        repository: 'org/repo',
      });

      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
