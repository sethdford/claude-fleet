/**
 * Task Template Engine
 *
 * Defines and executes pre-built task templates for autonomous operations.
 * Each template contains the prompts and configuration for a specific task type.
 */

import { EventEmitter } from 'events';

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  category: 'documentation' | 'testing' | 'security' | 'maintenance' | 'review' | 'conversion';
  role: string;
  estimatedMinutes: number;
  prompt: string;
  steps?: string[];
  requiredContext?: string[];
  outputFormat?: 'pr' | 'commit' | 'report' | 'slack';
  notifyOn?: ('start' | 'complete' | 'error')[];
}

export interface TaskExecutionContext {
  repository: string;
  branch?: string;
  prNumber?: number;
  issueNumber?: number;
  files?: string[];
  labels?: string[];
  sender?: string;
  customData?: Record<string, unknown>;
}

export interface TaskExecutionResult {
  success: boolean;
  templateId: string;
  duration: number;
  output?: string;
  prUrl?: string;
  commitSha?: string;
  errors?: string[];
}

/**
 * Built-in task templates for autonomous operations
 */
export const TASK_TEMPLATES: TaskTemplate[] = [
  // ═══════════════════════════════════════════════════════════════
  // DOCUMENTATION TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'update-documentation',
    name: 'Update Documentation',
    description: 'Analyze code changes and update relevant documentation',
    category: 'documentation',
    role: 'tech-writer',
    estimatedMinutes: 10,
    prompt: `You are a technical documentation specialist. Analyze the recent code changes and update the documentation accordingly.

Tasks:
1. Review the changed files and identify documentation impacts
2. Update README.md if the changes affect setup, usage, or features
3. Update or create JSDoc/TSDoc comments for new or modified functions
4. Update API documentation if endpoints changed
5. Create a changelog entry for significant changes

Guidelines:
- Keep documentation concise but complete
- Use code examples where helpful
- Maintain consistent formatting with existing docs
- Focus on "what" and "why", not implementation details`,
    steps: [
      'Analyze git diff for recent changes',
      'Identify documentation files that need updates',
      'Update README sections as needed',
      'Add/update code comments',
      'Create PR with documentation changes'
    ],
    outputFormat: 'pr',
    notifyOn: ['complete', 'error']
  },

  {
    id: 'generate-api-docs',
    name: 'Generate API Documentation',
    description: 'Auto-generate OpenAPI/Swagger documentation from code',
    category: 'documentation',
    role: 'tech-writer',
    estimatedMinutes: 15,
    prompt: `Generate comprehensive API documentation from the codebase.

Tasks:
1. Scan for API endpoints (Express routes, REST handlers)
2. Extract request/response types from TypeScript definitions
3. Document query parameters, headers, and body schemas
4. Add example requests and responses
5. Generate OpenAPI 3.0 specification

Output Format:
- Update docs/api.md with human-readable documentation
- Update/create openapi.yaml with machine-readable spec`,
    outputFormat: 'commit',
    notifyOn: ['complete']
  },

  // ═══════════════════════════════════════════════════════════════
  // TESTING TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'generate-tests',
    name: 'Generate Unit Tests',
    description: 'Create unit tests for uncovered code',
    category: 'testing',
    role: 'qa-engineer',
    estimatedMinutes: 20,
    prompt: `You are a test automation engineer. Generate comprehensive unit tests for code lacking coverage.

Tasks:
1. Identify files/functions without adequate test coverage
2. Write unit tests using the project's testing framework
3. Include edge cases, error handling, and boundary conditions
4. Mock external dependencies appropriately
5. Ensure tests are deterministic and isolated

Test Quality Guidelines:
- Each test should test one specific behavior
- Use descriptive test names (describe/it pattern)
- Include positive and negative test cases
- Test error conditions and edge cases
- Maintain AAA pattern (Arrange, Act, Assert)`,
    steps: [
      'Run coverage analysis',
      'Identify coverage gaps',
      'Generate test files',
      'Run tests to verify',
      'Create PR with new tests'
    ],
    outputFormat: 'pr',
    notifyOn: ['complete', 'error']
  },

  {
    id: 'generate-pr-tests',
    name: 'Generate Tests for PR',
    description: 'Create tests for code changes in a pull request',
    category: 'testing',
    role: 'qa-engineer',
    estimatedMinutes: 15,
    prompt: `Generate tests specifically for the code changes in this pull request.

Tasks:
1. Analyze the PR diff to understand what changed
2. Write tests that cover the new/modified functionality
3. Ensure edge cases are covered
4. Verify tests pass before committing

Focus on:
- New functions and methods
- Modified logic paths
- New error handling
- Integration points`,
    requiredContext: ['prNumber', 'files'],
    outputFormat: 'commit',
    notifyOn: ['complete']
  },

  // ═══════════════════════════════════════════════════════════════
  // SECURITY TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'security-scan',
    name: 'Security Vulnerability Scan',
    description: 'Scan code for security vulnerabilities',
    category: 'security',
    role: 'security-engineer',
    estimatedMinutes: 15,
    prompt: `Perform a comprehensive security audit of the codebase.

Check for:
1. OWASP Top 10 vulnerabilities
   - SQL Injection
   - XSS (Cross-Site Scripting)
   - CSRF vulnerabilities
   - Insecure deserialization
   - Security misconfigurations

2. Authentication & Authorization issues
   - Weak password policies
   - Missing auth checks
   - Privilege escalation risks

3. Data exposure risks
   - Sensitive data in logs
   - Hardcoded credentials
   - Exposed API keys

4. Dependency vulnerabilities
   - Known CVEs in dependencies
   - Outdated packages with security issues

Output:
- Security report with findings
- Severity classification (Critical/High/Medium/Low)
- Remediation recommendations`,
    outputFormat: 'report',
    notifyOn: ['start', 'complete', 'error']
  },

  {
    id: 'urgent-security-fix',
    name: 'Urgent Security Fix',
    description: 'Fix critical/high severity security vulnerabilities',
    category: 'security',
    role: 'security-engineer',
    estimatedMinutes: 30,
    prompt: `URGENT: Fix the identified security vulnerability immediately.

Priority: Address critical and high severity issues first.

Tasks:
1. Analyze the vulnerability details
2. Implement the fix following security best practices
3. Add regression tests for the vulnerability
4. Verify the fix doesn't break existing functionality
5. Document the fix in the commit message

Security Fix Guidelines:
- Never just hide the vulnerability, fix the root cause
- Add input validation where needed
- Use parameterized queries for SQL
- Implement proper output encoding for XSS
- Update dependencies to patched versions`,
    outputFormat: 'pr',
    notifyOn: ['start', 'complete', 'error']
  },

  // ═══════════════════════════════════════════════════════════════
  // MAINTENANCE TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'auto-fix-lint-errors',
    name: 'Auto-fix Lint Errors',
    description: 'Automatically fix linting and formatting issues',
    category: 'maintenance',
    role: 'fullstack-dev',
    estimatedMinutes: 5,
    prompt: `Fix all auto-fixable linting and formatting errors.

Tasks:
1. Run the project's linter with --fix flag
2. Run Prettier or similar formatter
3. Fix any remaining simple lint errors manually
4. Commit the changes with clear message

Do NOT:
- Change code logic
- Modify tests
- Add new dependencies
- Make stylistic changes beyond what the linter requires`,
    steps: [
      'Run npm run lint:fix',
      'Run npm run format',
      'Review remaining errors',
      'Fix simple issues',
      'Commit changes'
    ],
    outputFormat: 'commit',
    notifyOn: ['complete', 'error']
  },

  {
    id: 'update-dependencies',
    name: 'Update Dependencies',
    description: 'Update npm dependencies to latest compatible versions',
    category: 'maintenance',
    role: 'fullstack-dev',
    estimatedMinutes: 20,
    prompt: `Update project dependencies safely.

Tasks:
1. Check for outdated dependencies (npm outdated)
2. Update patch versions automatically
3. Update minor versions after reviewing changelogs
4. Create separate PRs for major version updates
5. Run tests after updates to ensure compatibility

Guidelines:
- Never update all dependencies at once
- Group related dependency updates
- Check for breaking changes in changelogs
- Ensure lockfile is updated
- Run full test suite after updates`,
    outputFormat: 'pr',
    notifyOn: ['complete', 'error']
  },

  {
    id: 'optimize-imports',
    name: 'Optimize Imports',
    description: 'Clean up and organize import statements',
    category: 'maintenance',
    role: 'fullstack-dev',
    estimatedMinutes: 5,
    prompt: `Optimize and organize import statements across the codebase.

Tasks:
1. Remove unused imports
2. Sort imports alphabetically
3. Group imports (external, internal, relative)
4. Use consistent import style
5. Remove duplicate imports

Format:
// External packages
import x from 'package';

// Internal modules
import { y } from '@/internal';

// Relative imports
import { z } from './local';`,
    outputFormat: 'commit',
    notifyOn: ['complete']
  },

  // ═══════════════════════════════════════════════════════════════
  // CODE REVIEW TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'code-review',
    name: 'Automated Code Review',
    description: 'Perform comprehensive code review on PR',
    category: 'review',
    role: 'architect',
    estimatedMinutes: 15,
    prompt: `Perform a thorough code review of this pull request.

Review Criteria:
1. Code Quality
   - Readability and maintainability
   - Proper naming conventions
   - DRY principle adherence
   - SOLID principles

2. Logic & Correctness
   - Edge cases handled
   - Error handling
   - Null/undefined safety
   - Race conditions

3. Performance
   - Algorithm efficiency
   - Memory usage
   - Unnecessary computations
   - N+1 query patterns

4. Security
   - Input validation
   - Authentication/authorization
   - Data exposure risks

5. Testing
   - Adequate test coverage
   - Test quality

Output:
- Provide specific, actionable feedback
- Reference line numbers
- Suggest improvements with examples
- Categorize by severity (Critical/Important/Suggestion)`,
    requiredContext: ['prNumber'],
    outputFormat: 'report',
    notifyOn: ['complete']
  },

  // ═══════════════════════════════════════════════════════════════
  // CONVERSION TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'js-to-typescript',
    name: 'Convert JavaScript to TypeScript',
    description: 'Convert JS files to TypeScript with proper types',
    category: 'conversion',
    role: 'fullstack-dev',
    estimatedMinutes: 30,
    prompt: `Convert JavaScript files to TypeScript with comprehensive type annotations.

Tasks:
1. Rename .js files to .ts
2. Add type annotations for:
   - Function parameters and return types
   - Variables where inference isn't sufficient
   - Object shapes using interfaces/types
3. Replace 'any' with proper types
4. Add missing type imports
5. Fix type errors

Guidelines:
- Use interfaces for object shapes
- Use type for unions and complex types
- Prefer explicit return types on public functions
- Use generics where appropriate
- Document complex types with JSDoc`,
    outputFormat: 'pr',
    notifyOn: ['complete', 'error']
  },

  {
    id: 'class-to-hooks',
    name: 'Convert Class Components to Hooks',
    description: 'Convert React class components to functional components with hooks',
    category: 'conversion',
    role: 'frontend-dev',
    estimatedMinutes: 20,
    prompt: `Convert React class components to modern functional components with hooks.

Conversion Guide:
1. Class state → useState hook
2. componentDidMount → useEffect with empty deps
3. componentDidUpdate → useEffect with deps
4. componentWillUnmount → useEffect cleanup
5. Class methods → regular functions or useCallback
6. this.props → destructured props
7. this.state → state variables

Guidelines:
- Preserve all existing functionality
- Add proper TypeScript types for props and state
- Use appropriate hooks (useState, useEffect, useCallback, useMemo)
- Consider extracting custom hooks for reusable logic`,
    outputFormat: 'pr',
    notifyOn: ['complete', 'error']
  }
];

export class TaskTemplateEngine extends EventEmitter {
  private static instance: TaskTemplateEngine;
  private templates: Map<string, TaskTemplate> = new Map();

  private constructor() {
    super();
    // Load built-in templates
    for (const template of TASK_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  static getInstance(): TaskTemplateEngine {
    if (!TaskTemplateEngine.instance) {
      TaskTemplateEngine.instance = new TaskTemplateEngine();
    }
    return TaskTemplateEngine.instance;
  }

  /**
   * Get a template by ID
   */
  getTemplate(id: string): TaskTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): TaskTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: TaskTemplate['category']): TaskTemplate[] {
    return this.getAllTemplates().filter(t => t.category === category);
  }

  /**
   * Register a custom template
   */
  registerTemplate(template: TaskTemplate): void {
    this.templates.set(template.id, template);
    console.log(`[Templates] Registered template: ${template.name}`);
  }

  /**
   * Build the full prompt for execution
   */
  buildPrompt(templateId: string, context: TaskExecutionContext): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let prompt = template.prompt;

    // Add context to prompt
    prompt += '\n\n--- CONTEXT ---\n';
    prompt += `Repository: ${context.repository}\n`;

    if (context.branch) {
      prompt += `Branch: ${context.branch}\n`;
    }
    if (context.prNumber) {
      prompt += `Pull Request: #${context.prNumber}\n`;
    }
    if (context.issueNumber) {
      prompt += `Issue: #${context.issueNumber}\n`;
    }
    if (context.files && context.files.length > 0) {
      prompt += `Files Changed:\n${context.files.map(f => `  - ${f}`).join('\n')}\n`;
    }
    if (context.labels && context.labels.length > 0) {
      prompt += `Labels: ${context.labels.join(', ')}\n`;
    }

    return prompt;
  }

  /**
   * Execute a template (would integrate with worker system)
   */
  async executeTemplate(
    templateId: string,
    context: TaskExecutionContext
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const template = this.templates.get(templateId);

    if (!template) {
      return {
        success: false,
        templateId,
        duration: 0,
        errors: [`Template not found: ${templateId}`]
      };
    }

    this.emit('templateStarted', { template, context });
    console.log(`[Templates] Executing: ${template.name} for ${context.repository}`);

    try {
      const prompt = this.buildPrompt(templateId, context);

      // In real implementation, this would:
      // 1. Spawn a worker with the appropriate role
      // 2. Send the prompt to the worker
      // 3. Collect the results
      // 4. Create PR/commit/report based on outputFormat

      // For now, emit an event for external handling
      this.emit('executeTemplate', { template, context, prompt });

      const duration = Date.now() - startTime;

      this.emit('templateCompleted', { template, context, duration });

      return {
        success: true,
        templateId,
        duration,
        output: 'Template executed successfully'
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit('templateFailed', { template, context, error: errorMessage });

      return {
        success: false,
        templateId,
        duration,
        errors: [errorMessage]
      };
    }
  }
}

export default TaskTemplateEngine;
