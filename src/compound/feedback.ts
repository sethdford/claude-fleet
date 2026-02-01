/**
 * Compound Runner - Structured Feedback Extraction
 *
 * Parses gate result output into structured error feedback
 * that workers can act on. Project-aware parsers extract
 * file:line references from compiler/linter output.
 */

import type { GateResult, ProjectType, StructuredFeedback, GateFeedback, GateConfig } from './types.js';

const MAX_ERRORS_PER_GATE = 20;
const RAW_TAIL_LINES = 15;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Extract structured feedback from gate results.
 * Maps gate IDs to names using the gate configs, then parses
 * error output based on project type and gate name.
 */
export function extractStructuredFeedback(
  results: GateResult[],
  gates: GateConfig[],
  projectType: ProjectType,
): StructuredFeedback {
  // Build gate name lookup: gateId -> gateName
  const gateNameMap = new Map<string, string>();
  for (const gate of gates) {
    // GateConfig doesn't have an id, but GateResult.gateId maps to MissionGate.id
    // We match by sortOrder position since gates are ordered
    gateNameMap.set(gate.name, gate.name);
  }

  const feedback: StructuredFeedback = {
    totalErrors: 0,
    gates: [],
  };

  for (const result of results) {
    if (result.status !== 'failed') continue;

    const rawOutput = result.output ?? '';
    const gateName = findGateName(result.gateId, gates) ?? result.gateId.slice(0, 8);

    const gateFeedback = parseGateOutput(gateName, rawOutput, projectType);
    feedback.gates.push(gateFeedback);
    feedback.totalErrors += gateFeedback.errors.length || 1;
  }

  return feedback;
}

// ============================================================================
// GATE NAME RESOLUTION
// ============================================================================

/**
 * Find the human-readable gate name from gate configs.
 * Falls back to truncated gate ID if not found.
 */
function findGateName(_gateId: string, _gates: GateConfig[]): string | null {
  // Gate configs don't carry IDs — they're generated fresh.
  // The MissionGate objects stored on the server have IDs.
  // We receive GateResult objects with gateId referencing MissionGate.id.
  // In practice, the runner uses extractFeedbackFromNamedResults() instead.
  return null;
}

/**
 * Alternative: extract feedback using gate name + result pairs directly.
 * This is the preferred path when we have gate names from the API response.
 */
export function extractFeedbackFromNamedResults(
  namedResults: Array<{ name: string; status: string; output: string }>,
  projectType: ProjectType,
): StructuredFeedback {
  const feedback: StructuredFeedback = {
    totalErrors: 0,
    gates: [],
  };

  for (const result of namedResults) {
    if (result.status !== 'failed') continue;

    const gateFeedback = parseGateOutput(result.name, result.output, projectType);
    feedback.gates.push(gateFeedback);
    feedback.totalErrors += gateFeedback.errors.length || 1;
  }

  return feedback;
}

// ============================================================================
// OUTPUT PARSERS
// ============================================================================

function parseGateOutput(
  gateName: string,
  rawOutput: string,
  projectType: ProjectType,
): GateFeedback {
  const lines = rawOutput.split('\n');
  let errors: string[] = [];

  switch (projectType) {
    case 'node':
      errors = parseNodeErrors(gateName, lines);
      break;
    case 'rust':
      errors = parseRustErrors(lines);
      break;
    case 'go':
      errors = parseGoErrors(lines);
      break;
    case 'python':
      errors = parsePythonErrors(lines);
      break;
    case 'make':
      errors = parseMakeErrors(lines);
      break;
  }

  // Cap errors
  errors = errors.slice(0, MAX_ERRORS_PER_GATE);

  // Build raw tail fallback
  const rawTail = errors.length === 0
    ? lines.slice(-RAW_TAIL_LINES).filter(isNonEmptyLine)
    : [];

  return {
    name: gateName,
    errors,
    rawTail,
  };
}

// ── Node Parsers ──────────────────────────────────────────────────────────

function parseNodeErrors(gateName: string, lines: string[]): string[] {
  switch (gateName) {
    case 'typecheck':
      return parseTypeScriptErrors(lines);
    case 'lint':
      return parseEslintErrors(lines);
    case 'tests':
      return parseTestErrors(lines);
    default:
      return [];
  }
}

/** Parse TypeScript compiler errors: file.ts(line,col): error TS1234: message */
function parseTypeScriptErrors(lines: string[]): string[] {
  const errors: string[] = [];
  const pattern = /(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)/;

  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      errors.push(`${match[1]}:${match[2]} — ${match[3]}: ${match[4]}`);
    }
  }

  return errors;
}

/** Parse ESLint errors in compact or stylish format */
function parseEslintErrors(lines: string[]): string[] {
  const errors: string[] = [];

  // Compact format: /path/file.ts: line:col - rule message
  const compactPattern = /(.+?):\s*line\s+(\d+).*?-\s*(.+)/;
  // Stylish format: /path/file.ts:line:col: message  rule
  const stylishPattern = /(.+?):(\d+):\d+:\s*(.+)/;

  for (const line of lines) {
    const compactMatch = compactPattern.exec(line);
    if (compactMatch) {
      errors.push(`${compactMatch[1]}:${compactMatch[2]} — ${compactMatch[3]}`);
      continue;
    }

    const stylishMatch = stylishPattern.exec(line);
    if (stylishMatch) {
      errors.push(`${stylishMatch[1]}:${stylishMatch[2]} — ${stylishMatch[3]}`);
    }
  }

  return errors;
}

/** Parse test runner output for FAIL lines and assertion errors */
function parseTestErrors(lines: string[]): string[] {
  const errors: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes('FAIL') ||
      trimmed.includes('AssertionError') ||
      trimmed.includes('AssertionError') ||
      (trimmed.startsWith('Error:') && !trimmed.includes('ENOENT'))
    ) {
      errors.push(trimmed);
    }
  }

  return errors;
}

// ── Rust Parsers ──────────────────────────────────────────────────────────

function parseRustErrors(lines: string[]): string[] {
  const errors: string[] = [];
  const errorPattern = /error\[(E\d+)]:\s*(.+)/;
  const locationPattern = /\s*-->\s*(.+?):(\d+):\d+/;

  for (let i = 0; i < lines.length; i++) {
    const errorMatch = errorPattern.exec(lines[i]);
    if (errorMatch) {
      let errorStr = `${errorMatch[1]}: ${errorMatch[2]}`;
      // Look ahead for location
      if (i + 1 < lines.length) {
        const locMatch = locationPattern.exec(lines[i + 1]);
        if (locMatch) {
          errorStr += ` at ${locMatch[1]}:${locMatch[2]}`;
        }
      }
      errors.push(errorStr);
    }
  }

  return errors;
}

// ── Go Parsers ────────────────────────────────────────────────────────────

function parseGoErrors(lines: string[]): string[] {
  const errors: string[] = [];
  const pattern = /(.+?\.go):(\d+):\d+:\s*(.+)/;

  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      errors.push(`${match[1]}:${match[2]} — ${match[3]}`);
    }
  }

  return errors;
}

// ── Python Parsers ────────────────────────────────────────────────────────

function parsePythonErrors(lines: string[]): string[] {
  const errors: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes('FAILED') ||
      trimmed.includes('ERROR') ||
      trimmed.includes('AssertionError')
    ) {
      errors.push(trimmed);
    }
  }

  return errors;
}

// ── Make Parsers ──────────────────────────────────────────────────────────

function parseMakeErrors(lines: string[]): string[] {
  const errors: string[] = [];
  const pattern = /(.+?):(\d+):\s*error:\s*(.+)/;

  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      errors.push(`${match[1]}:${match[2]} — ${match[3]}`);
    }
  }

  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isNonEmptyLine(line: string): boolean {
  return line.trim().length > 0;
}
