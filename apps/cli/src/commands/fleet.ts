/**
 * Fleet Commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { FleetManager } from '@claude-fleet/fleet';

export function fleetCommands(): Command {
  const fleet = new Command('fleet')
    .description('Multi-agent fleet management');

  fleet
    .command('spawn <handle>')
    .description('Spawn a new worker')
    .option('-r, --role <role>', 'Worker role', 'worker')
    .option('-p, --prompt <prompt>', 'Initial prompt')
    .option('--no-worktree', 'Disable git worktree isolation')
    .action(async (handle, options) => {
      const spinner = ora(`Spawning worker "${handle}"...`).start();

      try {
        const manager = new FleetManager();
        const worker = await manager.spawn({
          handle,
          role: options.role as any,
          prompt: options.prompt,
          worktree: options.worktree,
        });

        spinner.succeed(`Worker "${handle}" spawned`);
        console.log(chalk.gray(`  ID: ${worker.id}`));
        console.log(chalk.gray(`  Role: ${worker.role}`));
        if (worker.worktreePath) {
          console.log(chalk.gray(`  Worktree: ${worker.worktreePath}`));
        }
      } catch (error) {
        spinner.fail(`Failed to spawn worker: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  fleet
    .command('dismiss <handle>')
    .description('Dismiss a worker')
    .action(async (handle) => {
      const spinner = ora(`Dismissing worker "${handle}"...`).start();

      try {
        const manager = new FleetManager();
        const success = await manager.dismiss(handle);

        if (success) {
          spinner.succeed(`Worker "${handle}" dismissed`);
        } else {
          spinner.fail(`Worker "${handle}" not found`);
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(`Failed to dismiss worker: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  fleet
    .command('workers')
    .alias('ls')
    .description('List all workers')
    .option('-s, --status <status>', 'Filter by status')
    .option('-r, --role <role>', 'Filter by role')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const manager = new FleetManager();
      const workers = manager.listWorkers({
        status: options.status as any,
        role: options.role as any,
      });

      if (options.json) {
        console.log(JSON.stringify(workers, null, 2));
        return;
      }

      if (workers.length === 0) {
        console.log(chalk.yellow('No workers found.'));
        return;
      }

      console.log(chalk.bold(`\nWorkers (${workers.length}):\n`));

      for (const w of workers) {
        const statusColor = {
          pending: chalk.yellow,
          ready: chalk.green,
          busy: chalk.blue,
          error: chalk.red,
          dismissed: chalk.gray,
        }[w.status] || chalk.white;

        console.log(
          chalk.cyan(w.handle.padEnd(20)) +
          statusColor(w.status.padEnd(12)) +
          chalk.gray(w.role || 'worker')
        );
      }
      console.log();
    });

  fleet
    .command('status')
    .description('Fleet status overview')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const manager = new FleetManager();
      const status = manager.getStatus();

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(chalk.bold('\nFleet Status:\n'));
      console.log(`  Total workers: ${chalk.cyan(status.totalWorkers)}`);
      console.log();
      console.log(chalk.bold('  By Status:'));
      for (const [s, count] of Object.entries(status.byStatus)) {
        console.log(`    ${s}: ${count}`);
      }
      console.log();
      console.log(chalk.bold('  By Role:'));
      for (const [r, count] of Object.entries(status.byRole)) {
        console.log(`    ${r}: ${count}`);
      }
      console.log();
    });

  fleet
    .command('broadcast <message>')
    .description('Broadcast message to all workers')
    .option('-f, --from <handle>', 'Sender handle')
    .action(async (message, options) => {
      const manager = new FleetManager();
      manager.broadcast(message, options.from);
      console.log(chalk.green('Message broadcast successfully'));
    });

  fleet
    .command('checkpoint create')
    .description('Create a checkpoint')
    .requiredOption('-h, --handle <handle>', 'Worker handle')
    .requiredOption('-g, --goal <goal>', 'Current goal')
    .option('-w, --worked <items>', 'Completed items (comma-separated)')
    .option('-r, --remaining <items>', 'Remaining items (comma-separated)')
    .action(async (options) => {
      const manager = new FleetManager();
      manager.createCheckpoint(options.handle, {
        goal: options.goal,
        worked: options.worked?.split(',').map((s: string) => s.trim()),
        remaining: options.remaining?.split(',').map((s: string) => s.trim()),
      });
      console.log(chalk.green(`Checkpoint created for ${options.handle}`));
    });

  fleet
    .command('checkpoint load <handle>')
    .description('Load latest checkpoint for a worker')
    .option('--json', 'Output as JSON')
    .action(async (handle, options) => {
      const manager = new FleetManager();
      const checkpoint = manager.getCheckpoint(handle);

      if (!checkpoint) {
        console.log(chalk.yellow(`No checkpoint found for ${handle}`));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
        return;
      }

      console.log(chalk.bold('\nCheckpoint:\n'));
      console.log(`  Goal: ${checkpoint.goal}`);
      if (checkpoint.worked?.length) {
        console.log(chalk.green('  Completed:'));
        for (const item of checkpoint.worked) {
          console.log(`    - ${item}`);
        }
      }
      if (checkpoint.remaining?.length) {
        console.log(chalk.yellow('  Remaining:'));
        for (const item of checkpoint.remaining) {
          console.log(`    - ${item}`);
        }
      }
      console.log();
    });

  return fleet;
}
