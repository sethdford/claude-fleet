/**
 * Tests for Task Router
 *
 * Covers: task classification, keyword signals, dependency signals,
 * complexity-to-strategy/model mapping, confidence calculation,
 * and the recordOutcome/getStats methods (with null storage).
 */

import { describe, it, expect } from 'vitest';
import { TaskRouter } from './task-router.js';

describe('TaskRouter', () => {
  // ======================================================================
  // CONSTRUCTOR
  // ======================================================================

  describe('constructor', () => {
    it('should create with null storage (no persistence)', () => {
      const router = new TaskRouter();
      expect(router).toBeDefined();
    });

    it('should accept custom weights', () => {
      const router = new TaskRouter(null, {
        keywordWeight: 0.8,
      });
      expect(router).toBeDefined();
    });
  });

  // ======================================================================
  // CLASSIFICATION — Simple Tasks
  // ======================================================================

  describe('classify — simple tasks', () => {
    const router = new TaskRouter();

    it('should classify short simple-keyword tasks as simple', () => {
      const decision = router.classify({
        subject: 'Fix typo in readme',
      });
      expect(decision.complexity).toBe('simple');
      expect(decision.strategy).toBe('direct');
      expect(decision.model).toBe('haiku');
    });

    it('should classify lint/format tasks as simple', () => {
      const decision = router.classify({
        subject: 'Run lint on project',
        description: 'format and lint all files',
      });
      expect(decision.complexity).toBe('simple');
    });

    it('should classify config tasks as simple', () => {
      const decision = router.classify({
        subject: 'Update config file',
        description: 'Bump version in env config',
      });
      expect(decision.complexity).toBe('simple');
    });
  });

  // ======================================================================
  // CLASSIFICATION — Complex Tasks
  // ======================================================================

  describe('classify — complex tasks', () => {
    const router = new TaskRouter();

    it('should classify architecture tasks with many deps as complex', () => {
      const decision = router.classify({
        subject: 'Architect the database schema migration',
        description: 'Redesign and refactor the authentication system for distributed scalability. '.repeat(5),
        blockedBy: ['task-a', 'task-b', 'task-c'],
      });
      // keyword=complex(0.4), deps=complex(0.3), desc=complex(0.2) → complex wins
      expect(decision.complexity).toBe('complex');
      expect(decision.strategy).toBe('swarm');
      expect(decision.model).toBe('opus');
    });

    it('should classify complex-keyword tasks with deps as complex', () => {
      const decision = router.classify({
        subject: 'Security and performance optimization',
        description: 'Optimize performance of the concurrent authentication system. '.repeat(5),
        blockedBy: ['task-1', 'task-2', 'task-3'],
      });
      expect(decision.complexity).toBe('complex');
    });
  });

  // ======================================================================
  // CLASSIFICATION — Medium Tasks
  // ======================================================================

  describe('classify — medium tasks', () => {
    const router = new TaskRouter();

    it('should classify ambiguous tasks with deps as medium', () => {
      const decision = router.classify({
        subject: 'Implement user profile page',
        description: 'Add a new page for user profiles with avatar upload. ' + 'x'.repeat(300),
        blockedBy: ['auth-task'],
      });
      // keyword=medium(0.4, no complex/simple matches), desc=medium(0.2, 300+ chars), deps=medium(0.3, 1 dep)
      expect(decision.complexity).toBe('medium');
      expect(decision.strategy).toBe('supervised');
      expect(decision.model).toBe('sonnet');
    });

    it('should classify tasks with 1-2 dependencies as medium', () => {
      const decision = router.classify({
        subject: 'Add search feature',
        blockedBy: ['task-1', 'task-2'],
      });
      expect(['medium', 'complex']).toContain(decision.complexity);
    });
  });

  // ======================================================================
  // SIGNALS
  // ======================================================================

  describe('classify — signals', () => {
    const router = new TaskRouter();

    it('should include description_length signal', () => {
      const decision = router.classify({
        subject: 'Test task',
        description: 'x'.repeat(300),
      });
      const lengthSignal = decision.signals.find(s => s.name === 'description_length');
      expect(lengthSignal).toBeDefined();
      expect(lengthSignal!.value).toBe(300);
    });

    it('should include keyword_analysis signal', () => {
      const decision = router.classify({
        subject: 'Refactor the module',
      });
      const keywordSignal = decision.signals.find(s => s.name === 'keyword_analysis');
      expect(keywordSignal).toBeDefined();
    });

    it('should include dependency_count signal', () => {
      const decision = router.classify({
        subject: 'Task with deps',
        blockedBy: ['a', 'b', 'c'],
      });
      const depSignal = decision.signals.find(s => s.name === 'dependency_count');
      expect(depSignal).toBeDefined();
      expect(depSignal!.value).toBe(3);
      expect(depSignal!.contribution).toBe('complex');
    });

    it('should set dependency contribution to simple when no deps', () => {
      const decision = router.classify({ subject: 'No deps' });
      const depSignal = decision.signals.find(s => s.name === 'dependency_count');
      expect(depSignal!.value).toBe(0);
      expect(depSignal!.contribution).toBe('simple');
    });
  });

  // ======================================================================
  // CONFIDENCE
  // ======================================================================

  describe('classify — confidence', () => {
    const router = new TaskRouter();

    it('should return higher confidence when signals agree', () => {
      const simple = router.classify({
        subject: 'Fix typo',
        description: 'fix a typo in the readme docs',
      });
      expect(simple.confidence).toBeGreaterThan(0.3);
    });

    it('should return confidence between 0 and 1', () => {
      const decision = router.classify({
        subject: 'Some mixed task with refactor and format',
      });
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ======================================================================
  // DESCRIPTION LENGTH THRESHOLDS
  // ======================================================================

  describe('classify — description length', () => {
    const router = new TaskRouter();

    it('should contribute simple for short description', () => {
      const decision = router.classify({
        subject: 'task',
        description: 'short',
      });
      const signal = decision.signals.find(s => s.name === 'description_length');
      expect(signal!.contribution).toBe('simple');
    });

    it('should contribute medium for medium description', () => {
      const decision = router.classify({
        subject: 'task',
        description: 'x'.repeat(500),
      });
      const signal = decision.signals.find(s => s.name === 'description_length');
      expect(signal!.contribution).toBe('medium');
    });

    it('should contribute complex for long description', () => {
      const decision = router.classify({
        subject: 'task',
        description: 'x'.repeat(1000),
      });
      const signal = decision.signals.find(s => s.name === 'description_length');
      expect(signal!.contribution).toBe('complex');
    });
  });

  // ======================================================================
  // recordOutcome / getStats (null storage)
  // ======================================================================

  describe('recordOutcome', () => {
    it('should be a no-op with null storage', () => {
      const router = new TaskRouter();
      const decision = router.classify({ subject: 'test' });
      // Should not throw
      router.recordOutcome(decision, {
        taskId: 'task-1',
        success: true,
        durationMs: 5000,
        restarts: 0,
        errorCount: 0,
      });
    });
  });

  describe('getStats', () => {
    it('should return empty stats with null storage', () => {
      const router = new TaskRouter();
      const stats = router.getStats();
      expect(stats.totalDecisions).toBe(0);
      expect(stats.byComplexity.simple.count).toBe(0);
      expect(stats.byComplexity.medium.count).toBe(0);
      expect(stats.byComplexity.complex.count).toBe(0);
    });
  });
});
