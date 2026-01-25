#!/usr/bin/env npx tsx
/**
 * Wave Orchestrator Demo
 *
 * Demonstrates the WaveOrchestrator spawning workers in phases.
 * Run with: npx tsx scripts/demo-wave-orchestrator.ts
 */

import { WaveOrchestrator, createParallelWave } from '../packages/tmux/src/index.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const PURPLE = '\x1b[35m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

function log(msg: string) {
  console.log(`${CYAN}[Demo]${NC} ${msg}`);
}

function success(msg: string) {
  console.log(`${GREEN}  ✓${NC} ${msg}`);
}

function phase(name: string) {
  console.log(`\n${PURPLE}━━━ Phase: ${BOLD}${name}${NC}${PURPLE} ━━━${NC}\n`);
}

async function main() {
  console.log(`
${CYAN}╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   ${BOLD}Wave Orchestrator Demo${NC}${CYAN}                                           ║
║   Phased Worker Spawning with Dependencies                           ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝${NC}
`);

  // Create orchestrator (using local mode for visibility)
  const orchestrator = new WaveOrchestrator({
    fleetName: 'demo-fleet',
    remote: false,  // Use visible tmux panes
    pollInterval: 500,
    defaultTimeout: 30000,
  });

  // Phase 1: Quality checks (parallel)
  orchestrator.addWave(createParallelWave('quality', [
    {
      handle: 'linter',
      command: 'echo "Running ESLint..." && sleep 2 && echo "✓ Linting complete"',
      successPattern: /complete/,
    },
    {
      handle: 'typechecker',
      command: 'echo "Running TypeScript..." && sleep 2 && echo "✓ Types verified"',
      successPattern: /verified/,
    },
  ]));

  // Phase 2: Tests (depends on quality)
  orchestrator.addWave({
    name: 'tests',
    workers: [{
      handle: 'tester',
      command: 'echo "Running tests..." && sleep 3 && echo "✓ All tests passed"',
      successPattern: /passed/,
    }],
    afterWaves: ['quality'],
  });

  // Phase 3: Build & Deploy (depends on tests)
  orchestrator.addWave({
    name: 'deploy',
    workers: [
      {
        handle: 'builder',
        command: 'echo "Building..." && sleep 2 && echo "✓ Build complete"',
        successPattern: /complete/,
      },
      {
        handle: 'docs',
        command: 'echo "Generating docs..." && sleep 1 && echo "✓ Docs ready"',
        successPattern: /ready/,
      },
    ],
    afterWaves: ['tests'],
  });

  // Event listeners
  orchestrator.on('start', () => {
    log('Starting wave orchestration...');
  });

  orchestrator.on('wave:start', ({ wave, workers }) => {
    phase(wave);
    log(`Spawning ${workers.length} workers: ${workers.join(', ')}`);
  });

  orchestrator.on('worker:spawned', ({ worker, paneId }) => {
    console.log(`${YELLOW}  ◆${NC} ${worker} spawned in pane ${paneId}`);
  });

  orchestrator.on('worker:success', ({ worker }) => {
    success(`${worker} completed`);
  });

  orchestrator.on('worker:failed', ({ worker, error }) => {
    console.log(`${RED}  ✗${NC} ${worker} failed: ${error}`);
  });

  orchestrator.on('wave:complete', ({ wave, results }) => {
    const passed = results.filter(r => r.success).length;
    log(`Wave ${wave}: ${passed}/${results.length} workers succeeded`);
  });

  orchestrator.on('complete', ({ results, status }: { results: Array<{ success: boolean; duration: number }>; status: string }) => {
    const succeeded = results.filter((r) => r.success).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`
${GREEN}╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   ${BOLD}Orchestration Complete${NC}${GREEN}                                           ║
║                                                                      ║
║   Status: ${status === 'completed' ? '✓ SUCCESS' : '✗ FAILED'}                                                   ║
║   Workers: ${succeeded}/${results.length} succeeded                                               ║
║   Duration: ${totalDuration}ms total                                            ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝${NC}
`);
  });

  // Execute
  try {
    await orchestrator.execute();
  } catch (error) {
    console.error(`${RED}Error:${NC}`, error);
    process.exit(1);
  }
}

main().catch(console.error);
