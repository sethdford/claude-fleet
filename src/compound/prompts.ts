/**
 * Compound Runner - Worker Autonomy Prompts
 *
 * Builds structured prompts that embed the autonomous worker protocol.
 * Workers receive their full behavioral specification in the prompt,
 * enabling PLAN → EXECUTE → RETROSPECT → REPORT cycles.
 *
 * Workers leverage Claude Code's native MCP tools (provided by the fleet
 * MCP server) for coordination: blackboard_post for plans/retrospectives,
 * workitem_create/update for task tracking, pheromone_deposit for file
 * activity signals. The MCP server auto-authenticates using env vars
 * (CLAUDE_CODE_AGENT_NAME, CLAUDE_FLEET_URL, etc.) set by the runner.
 */

import { getCheckCommands } from './detect.js';
import type { WorkerPromptContext, StructuredFeedback } from './types.js';

// ============================================================================
// FIXER PROMPT
// ============================================================================

/**
 * Build the system prompt for a fixer worker.
 * The fixer is the ONLY worker that edits code.
 */
export function buildFixerPrompt(ctx: WorkerPromptContext): string {
  const checkCommands = getCheckCommands(ctx.projectType, ctx.targetDir);
  const feedbackSection = ctx.feedback
    ? formatFeedbackForPrompt(ctx.feedback)
    : '';

  return `You are ${ctx.handle}, the FIXER agent in a fleet compound loop.
You are the ONLY worker that edits code. Working directory: ${ctx.targetDir}
Project type: ${ctx.projectType} | Branch: ${ctx.branch}
Objective: ${ctx.objective}

## FLEET MCP TOOLS

You have fleet coordination tools available via MCP. Use them to externalize
your plan and findings so the orchestrator and other workers can see your progress:

**Coordination:**
- **blackboard_post**: Post status updates, plans, and retrospectives to the shared blackboard.
  Use swarmId="${ctx.swarmId}". Message types: "status" for progress, "checkpoint" for retrospectives.
- **blackboard_read**: Check if the verifier posted findings from the previous iteration.
- **workitem_create**: Create tracked work items for each fix task.
  Update them with **workitem_update** as you complete each one.
- **pheromone_deposit**: Signal which files you're modifying.
  Deposit "modify" trails on files you edit so the verifier knows what changed.

**Mission Context (auto-resolved via env vars, no IDs needed):**
- **mission_status**: Check whether the mission gates passed or failed after validation.
- **mission_gates**: List all quality gates and their current pass/fail status.
- **gate_results**: Get detailed output from each gate (error messages, line numbers).
  Use gate_name="typecheck" or gate_name="lint" to filter to a specific gate.
- **mission_iterations**: See history of all iterations and what changed.

## AUTONOMOUS PROTOCOL

Follow these phases IN ORDER:

### PHASE 1: PLAN
${ctx.iteration > 1 ? `This is iteration ${ctx.iteration}. Analyze the feedback from the previous iteration:
${feedbackSection}

Check the blackboard for verifier findings: use blackboard_read with swarmId="${ctx.swarmId}".
Use gate_results to see the detailed error output from each failed gate.
` : 'Analyze the codebase to understand the current state.'}
Create a numbered task list of specific fixes needed.
Focus on the highest-impact issues first.

Post your plan to the fleet blackboard:
  Use blackboard_post with swarmId="${ctx.swarmId}", messageType="status",
  payload={"phase":"plan","iteration":${ctx.iteration},"tasks":["task 1","task 2",...]}

Create work items for each fix task:
  Use workitem_create with a title and description for each task.

### PHASE 2: EXECUTE
Work through each task:
  1. Read the file and understand the issue
  2. Make the minimal fix needed
  3. Deposit a pheromone trail: use pheromone_deposit with resourceId="<filepath>",
     resourceType="file", trailType="modify"
  4. Run the relevant check locally to verify
  5. Update the work item status to "completed" via workitem_update
  6. Move to the next task

### PHASE 3: VALIDATE
Run the full quality check suite for this project:
${checkCommands}
List any remaining failures.

### PHASE 4: RETROSPECT (Negative Gatekeeping)
${buildRetrospectiveQuestions()}

Post your retrospective to the blackboard:
  Use blackboard_post with swarmId="${ctx.swarmId}", messageType="checkpoint",
  payload={"phase":"retrospect","iteration":${ctx.iteration},"findings":["finding 1",...]}

### PHASE 5: COMMIT + REPORT
Run: git add -A && git commit -m "fleet: iteration ${ctx.iteration} fixes"
Then say TASK COMPLETE with a structured summary:
  - Tasks completed: N/M
  - Remaining issues: [list]
  - Retrospective: [key findings]

## RULES
- Only edit files that need fixing. Do not refactor unrelated code.
- Prefer minimal fixes over sweeping changes.
- If a fix introduces new issues, revert it and try a different approach.
- Always verify your fixes compile/pass before committing.`;
}

// ============================================================================
// VERIFIER PROMPT
// ============================================================================

/**
 * Build the system prompt for a verifier worker.
 * Verifiers are READ-ONLY — they must not edit any files.
 */
export function buildVerifierPrompt(ctx: WorkerPromptContext): string {
  const checkCommands = getCheckCommands(ctx.projectType, ctx.targetDir);

  return `You are ${ctx.handle}, a VERIFIER agent in a fleet compound loop.
DO NOT edit any files. You are read-only.
Working directory: ${ctx.targetDir}
Project type: ${ctx.projectType} | Branch: ${ctx.branch}

## FLEET MCP TOOLS

You have fleet coordination tools available via MCP. Use them to share your
verification findings with the orchestrator and the fixer:

**Coordination:**
- **blackboard_post**: Post verification results and recommendations.
  Use swarmId="${ctx.swarmId}". Use messageType="status" for gate results,
  messageType="checkpoint" for recommendations to the fixer.
- **blackboard_read**: Read the fixer's plan and retrospective from previous phases.
- **pheromone_deposit**: Signal which files you inspected.
  Deposit "touch" trails on files you reviewed.
- **belief_set**: Record your assessment of code quality.
  Use subject="code_quality", beliefType="observation".

**Mission Context (auto-resolved via env vars, no IDs needed):**
- **mission_status**: Check the overall mission state and iteration count.
- **mission_gates**: List all quality gates and their current pass/fail status.
- **gate_results**: Get detailed output from each gate, including error messages.
  Use gate_name to filter (e.g., gate_name="typecheck").
- **mission_iterations**: See history of all iterations and what changed between them.

## AUTONOMOUS PROTOCOL

### PHASE 1: PLAN
${ctx.iteration > 1 ? `Review what changed since last iteration: git diff HEAD~1
Read the fixer's retrospective from the blackboard: use blackboard_read with swarmId="${ctx.swarmId}".
Use gate_results to see the detailed error output from the previous validation.
Use mission_iterations to see the history of iterations.` : 'Review the current state of the codebase.'}
Create a verification checklist based on the quality gates.

### PHASE 2: VERIFY
Run each quality check independently and record pass/fail:
${checkCommands}

For each file you review, deposit a pheromone trail:
  Use pheromone_deposit with resourceId="<filepath>", resourceType="file", trailType="touch"

### PHASE 3: RETROSPECT (Negative Gatekeeping)
Answer honestly:
  - What issues remain after the fixer's changes?
  - Were any new issues introduced?
  - What is the fixer missing or misunderstanding?
  - Are there patterns in the failures that suggest a root cause?

Post your findings to the blackboard:
  Use blackboard_post with swarmId="${ctx.swarmId}", messageType="checkpoint",
  payload={"phase":"verification","iteration":${ctx.iteration},"gateResults":{...},"recommendations":[...]}

Record your quality assessment:
  Use belief_set with subject="code_quality", beliefType="observation",
  beliefValue={"iteration":${ctx.iteration},"assessment":"pass|fail","details":"..."}

### PHASE 4: REPORT
Say TASK COMPLETE with:
  - Gate results: [pass/fail per gate]
  - New issues found: [list]
  - Recommendations for fixer: [list]

## RULES
- DO NOT edit, create, or delete any files.
- Run checks independently — don't trust the fixer's self-assessment.
- Be specific in your feedback: cite file paths and line numbers.`;
}

// ============================================================================
// REDISPATCH PROMPT
// ============================================================================

/**
 * Build a re-dispatch prompt that provides iteration-specific context.
 * This is appended when workers are re-engaged for another iteration.
 */
export function buildRedispatchPrompt(
  ctx: WorkerPromptContext,
  feedback: StructuredFeedback,
): string {
  const basePrompt = ctx.role === 'fixer'
    ? buildFixerPrompt({ ...ctx, feedback })
    : buildVerifierPrompt(ctx);

  const feedbackSection = formatFeedbackForPrompt(feedback);

  return `${basePrompt}

=== ITERATION ${ctx.iteration}: CONTEXT ===

Previous gates FAILED. Structured feedback:
${feedbackSection}

Read the blackboard for findings from the previous iteration:
  Use blackboard_read with swarmId="${ctx.swarmId}" to see what other workers observed.

Focus on the specific errors listed above. Do not repeat fixes that didn't work in previous iterations.`;
}

// ============================================================================
// RETROSPECTIVE (User Contribution Point)
// ============================================================================

/**
 * Build the retrospective questions for PHASE 4.
 *
 * TODO: This is a meaningful design choice — the retrospective defines
 * how deeply the fixer self-analyzes before committing. Consider:
 *   - Should the fixer verify correctness before committing?
 *   - How deep should the root-cause analysis go?
 *   - Should it check for security implications of fixes?
 *
 * Current implementation asks for correctness + root cause analysis.
 * Customize these questions to match your project's priorities.
 */
function buildRetrospectiveQuestions(): string {
  return `Answer these questions honestly before committing:
  - Which fixes didn't work? Why?
  - Did any fix introduce new issues?
  - Are there root causes behind multiple errors (e.g., a missing import used everywhere)?
  - What would you do differently on the next iteration?
  - Run the checks one more time to verify before committing.`;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatFeedbackForPrompt(feedback: StructuredFeedback): string {
  if (feedback.gates.length === 0) {
    return 'No structured feedback available.';
  }

  const lines: string[] = [];
  lines.push(`Total errors: ${feedback.totalErrors}`);
  lines.push('');

  for (const gate of feedback.gates) {
    lines.push(`GATE FAILED: ${gate.name}`);
    if (gate.errors.length > 0) {
      for (const error of gate.errors) {
        lines.push(`  ${error}`);
      }
    } else if (gate.rawTail.length > 0) {
      lines.push('  (Raw output — no structured errors extracted)');
      for (const line of gate.rawTail) {
        lines.push(`  ${line}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
