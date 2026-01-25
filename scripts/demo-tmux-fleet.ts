#!/usr/bin/env npx tsx
/**
 * Tmux Fleet Demo
 *
 * Demonstrates programmatic control of tmux workers.
 *
 * Run inside tmux:
 *   tmux new-session -s demo
 *   npx tsx scripts/demo-tmux-fleet.ts
 */

import { FleetTmuxManager } from '../packages/tmux/src/index.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('\n🚀 Tmux Fleet Demo\n');
  console.log('═'.repeat(50));

  const manager = new FleetTmuxManager();

  // Check availability
  if (!manager.isAvailable()) {
    console.error('❌ Not running inside tmux!');
    console.error('\nStart a tmux session first:');
    console.error('  tmux new-session -s demo');
    console.error('\nThen run this script again.');
    process.exit(1);
  }

  console.log('✓ Running inside tmux\n');

  // Show initial status
  const status = manager.getStatus();
  console.log(`Session: ${status.session}`);
  console.log(`Window: ${status.window}`);
  console.log(`Current Pane: ${status.pane}`);
  console.log(`Total Panes: ${status.totalPanes}`);
  console.log();

  try {
    // Spawn workers
    console.log('━'.repeat(50));
    console.log('Spawning Workers...\n');

    const alice = await manager.spawnWorker({
      handle: 'alice',
      role: 'scout',
      direction: 'horizontal',
    });
    console.log(`  ✓ alice spawned in pane ${alice?.paneId}`);

    await sleep(500);

    const bob = await manager.spawnWorker({
      handle: 'bob',
      role: 'worker',
      direction: 'vertical',
    });
    console.log(`  ✓ bob spawned in pane ${bob?.paneId}`);

    await sleep(500);

    const carol = await manager.spawnWorker({
      handle: 'carol',
      role: 'analyst',
      command: 'echo "Carol initialized" && sleep 1',
    });
    console.log(`  ✓ carol spawned in pane ${carol?.paneId}`);

    console.log();

    // List workers
    console.log('━'.repeat(50));
    console.log('Workers:\n');
    for (const w of manager.listWorkers()) {
      console.log(`  ${w.handle.padEnd(10)} ${w.paneId}`);
    }
    console.log();

    // Send commands
    console.log('━'.repeat(50));
    console.log('Sending Commands...\n');

    await manager.sendToWorker('alice', 'echo "Hello from Alice!"');
    console.log('  → Sent to alice');

    await manager.sendToWorker('bob', 'echo "Hello from Bob!"');
    console.log('  → Sent to bob');

    await sleep(1000);
    console.log();

    // Capture output
    console.log('━'.repeat(50));
    console.log('Capturing Output...\n');

    const aliceOutput = manager.captureWorkerOutput('alice', 5);
    console.log('alice output:');
    console.log('---');
    console.log(aliceOutput);
    console.log('---\n');

    const bobOutput = manager.captureWorkerOutput('bob', 5);
    console.log('bob output:');
    console.log('---');
    console.log(bobOutput);
    console.log('---\n');

    // Execute command
    console.log('━'.repeat(50));
    console.log('Executing Command...\n');

    const result = await manager.executeInWorker('alice', 'echo "test" && date');
    console.log(`  Exit code: ${result.exitCode}`);
    console.log(`  Duration: ${result.duration}ms`);
    console.log(`  Output: ${result.output.slice(0, 100)}...`);
    console.log();

    // Wait for pattern
    console.log('━'.repeat(50));
    console.log('Waiting for Pattern...\n');

    await manager.sendToWorker('bob', 'echo "READY_SIGNAL"');
    const found = await manager.waitForWorkerPattern('bob', /READY_SIGNAL/, { timeout: 5000 });
    console.log(`  Pattern found: ${found}`);
    console.log();

    // Broadcast
    console.log('━'.repeat(50));
    console.log('Broadcasting...\n');

    await manager.broadcast('echo "Fleet broadcast at $(date)"');
    console.log('  → Broadcast sent to all workers');
    console.log();

    // Final status
    console.log('━'.repeat(50));
    console.log('Final Status:\n');

    const finalStatus = manager.getStatus();
    console.log(`  Workers: ${finalStatus.workers.length}`);
    console.log(`  Total Panes: ${finalStatus.totalPanes}`);
    console.log();

    // Cleanup
    console.log('━'.repeat(50));
    console.log('Cleanup...\n');

    const killed = manager.killAllWorkers();
    console.log(`  ✓ Killed ${killed} workers`);
    console.log();

  } catch (error) {
    console.error('Error:', error);

    // Cleanup on error
    try {
      manager.killAllWorkers();
    } catch {
      // Ignore cleanup errors
    }

    process.exit(1);
  }

  console.log('═'.repeat(50));
  console.log('✅ Demo Complete!\n');
}

main().catch(console.error);
