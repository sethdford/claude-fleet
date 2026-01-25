/**
 * Tmux Commands
 *
 * Terminal automation for spawning and managing workers in tmux panes.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { FleetTmuxManager } from '@claude-fleet/tmux';

export function tmuxCommands(): Command {
  const tmux = new Command('tmux')
    .description('Tmux terminal automation for fleet management');

  const manager = new FleetTmuxManager();

  tmux
    .command('status')
    .description('Show tmux fleet status')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const status = manager.getStatus();

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      if (!status.insideTmux) {
        console.log(chalk.yellow('Not running inside tmux'));
        console.log(chalk.gray('Start a tmux session first: tmux new-session'));
        return;
      }

      console.log(chalk.bold('\nTmux Fleet Status:\n'));
      console.log(`  Session: ${chalk.cyan(status.session)}`);
      console.log(`  Window: ${chalk.cyan(status.window)}`);
      console.log(`  Current Pane: ${chalk.cyan(status.pane)}`);
      console.log(`  Total Panes: ${chalk.cyan(status.totalPanes)}`);

      if (status.workers.length > 0) {
        console.log(chalk.bold('\n  Workers:'));
        for (const w of status.workers) {
          console.log(`    ${chalk.green(w.handle)} (${w.paneId})`);
        }
      } else {
        console.log(chalk.gray('\n  No workers spawned'));
      }
      console.log();
    });

  tmux
    .command('spawn <handle>')
    .description('Spawn a worker in a new tmux pane')
    .option('-c, --command <command>', 'Initial command to run')
    .option('-d, --cwd <directory>', 'Working directory')
    .option('-D, --direction <direction>', 'Split direction (horizontal/vertical)', 'vertical')
    .option('-r, --role <role>', 'Worker role for display', 'worker')
    .action(async (handle, options) => {
      const spinner = ora(`Spawning worker "${handle}"...`).start();

      try {
        const worker = await manager.spawnWorker({
          handle,
          command: options.command,
          cwd: options.cwd,
          direction: options.direction as 'horizontal' | 'vertical',
          role: options.role,
        });

        if (worker) {
          spinner.succeed(`Worker "${handle}" spawned in pane ${worker.paneId}`);
        } else {
          spinner.fail('Failed to create pane');
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  tmux
    .command('spawn-claude <handle>')
    .description('Spawn a Claude Code worker in a tmux pane')
    .option('-p, --prompt <prompt>', 'Initial prompt for Claude')
    .option('-m, --model <model>', 'Model to use (sonnet, opus)')
    .option('--no-print', 'Disable --print mode')
    .option('-d, --cwd <directory>', 'Working directory')
    .action(async (handle, options) => {
      const spinner = ora(`Spawning Claude worker "${handle}"...`).start();

      try {
        const worker = await manager.spawnClaudeWorker({
          handle,
          prompt: options.prompt,
          model: options.model,
          printMode: options.print !== false,
          cwd: options.cwd,
        });

        if (worker) {
          spinner.succeed(`Claude worker "${handle}" spawned in pane ${worker.paneId}`);
        } else {
          spinner.fail('Failed to create pane');
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  tmux
    .command('send <handle> <text...>')
    .description('Send text to a worker pane')
    .option('--no-enter', 'Do not press Enter after sending')
    .option('--instant', 'Send immediately without delay before Enter')
    .option('-d, --delay <ms>', 'Custom delay in ms before Enter (default: 100)')
    .action(async (handle, textParts, options) => {
      const text = textParts.join(' ');

      try {
        const controller = manager.getController();
        const worker = manager.getWorker(handle);

        if (!worker) {
          console.error(chalk.red(`Worker "${handle}" not found`));
          process.exit(1);
        }

        const delayValue = options.delay ? parseInt(options.delay, 10) : undefined;
        await controller.sendKeys(worker.paneId, text, {
          noEnter: !options.enter,
          instant: options.instant,
          ...(delayValue !== undefined ? { delay: delayValue } : {}),
        });
        console.log(chalk.green(`Sent to ${handle}`));
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('capture <handle>')
    .description('Capture output from a worker pane')
    .option('-l, --lines <number>', 'Number of lines to capture', '50')
    .action((handle, options) => {
      try {
        const output = manager.captureWorkerOutput(handle, parseInt(options.lines, 10));
        console.log(output);
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('exec <handle> <command...>')
    .description('Execute a command and wait for completion')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '30000')
    .option('--json', 'Output as JSON')
    .action(async (handle, commandParts, options) => {
      const command = commandParts.join(' ');
      const spinner = ora(`Executing command...`).start();

      try {
        const result = await manager.executeInWorker(handle, command, {
          timeout: parseInt(options.timeout, 10),
        });

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.completed) {
          console.log(chalk.green(`Exit code: ${result.exitCode}`));
          console.log(chalk.gray(`Duration: ${result.duration}ms`));
          console.log();
          console.log(result.output);
        } else {
          console.log(chalk.yellow('Command timed out'));
          console.log(result.output);
        }
      } catch (error) {
        spinner.fail(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  tmux
    .command('wait-idle <handle>')
    .description('Wait for a worker to become idle')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '30000')
    .option('-s, --stable <ms>', 'Stable time required', '1000')
    .action(async (handle, options) => {
      const spinner = ora(`Waiting for ${handle} to become idle...`).start();

      try {
        const idle = await manager.waitForWorkerIdle(handle, {
          timeout: parseInt(options.timeout, 10),
          stableTime: parseInt(options.stable, 10),
        });

        if (idle) {
          spinner.succeed(`Worker ${handle} is idle`);
        } else {
          spinner.warn(`Timed out waiting for ${handle}`);
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  tmux
    .command('wait-pattern <handle> <pattern>')
    .description('Wait for a pattern to appear in output')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '30000')
    .action(async (handle, pattern, options) => {
      const spinner = ora(`Waiting for pattern in ${handle}...`).start();

      try {
        const found = await manager.waitForWorkerPattern(handle, new RegExp(pattern), {
          timeout: parseInt(options.timeout, 10),
        });

        if (found) {
          spinner.succeed(`Pattern found in ${handle}`);
        } else {
          spinner.warn(`Pattern not found before timeout`);
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  tmux
    .command('interrupt <handle>')
    .description('Send Ctrl+C to a worker')
    .action((handle) => {
      try {
        manager.interruptWorker(handle);
        console.log(chalk.green(`Interrupt sent to ${handle}`));
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('escape <handle>')
    .description('Send Escape key to a worker')
    .action((handle) => {
      try {
        manager.escapeWorker(handle);
        console.log(chalk.green(`Escape sent to ${handle}`));
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('kill <handle>')
    .description('Kill a worker pane')
    .action((handle) => {
      try {
        const success = manager.killWorker(handle);
        if (success) {
          console.log(chalk.green(`Worker ${handle} killed`));
        } else {
          console.log(chalk.yellow(`Worker ${handle} not found`));
        }
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('kill-all')
    .description('Kill all workers')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      const workers = manager.listWorkers();

      if (workers.length === 0) {
        console.log(chalk.yellow('No workers to kill'));
        return;
      }

      if (!options.yes) {
        console.log(chalk.yellow(`About to kill ${workers.length} worker(s):`));
        for (const w of workers) {
          console.log(`  - ${w.handle} (${w.paneId})`);
        }

        // Simple confirmation without readline
        console.log(chalk.gray('\nUse --yes to confirm'));
        return;
      }

      const killed = manager.killAllWorkers();
      console.log(chalk.green(`Killed ${killed} worker(s)`));
    });

  tmux
    .command('broadcast <message...>')
    .description('Send message to all workers')
    .action(async (messageParts) => {
      const message = messageParts.join(' ');

      try {
        await manager.broadcast(message);
        console.log(chalk.green(`Message broadcast to all workers`));
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('focus <handle>')
    .description('Focus on a worker pane')
    .action((handle) => {
      try {
        manager.focusWorker(handle);
        console.log(chalk.green(`Focused on ${handle}`));
      } catch (error) {
        console.error(chalk.red(`Failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  tmux
    .command('workers')
    .alias('ls')
    .description('List all workers')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const workers = manager.listWorkers();

      if (options.json) {
        console.log(JSON.stringify(workers, null, 2));
        return;
      }

      if (workers.length === 0) {
        console.log(chalk.yellow('No workers'));
        return;
      }

      console.log(chalk.bold('\nWorkers:\n'));
      for (const w of workers) {
        console.log(
          chalk.cyan(w.handle.padEnd(20)) +
          chalk.gray(w.paneId.padEnd(8)) +
          chalk.gray(new Date(w.createdAt).toISOString())
        );
      }
      console.log();
    });

  tmux
    .command('panes')
    .description('List all tmux panes in current window')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const controller = manager.getController();
      const panes = controller.listPanes();

      if (options.json) {
        console.log(JSON.stringify(panes, null, 2));
        return;
      }

      if (panes.length === 0) {
        console.log(chalk.yellow('No panes found'));
        return;
      }

      console.log(chalk.bold('\nPanes:\n'));
      for (const p of panes) {
        const activeMarker = p.active ? chalk.green('*') : ' ';
        console.log(
          `  ${activeMarker} ${chalk.cyan(p.id.padEnd(6))} ` +
          `${p.title.padEnd(20)} ` +
          `${chalk.gray(p.command)} ` +
          chalk.gray(`(${p.width}x${p.height})`)
        );
      }
      console.log();
    });

  // Remote mode commands
  tmux
    .command('windows')
    .description('List all tmux windows in current session')
    .option('-s, --session <name>', 'Session name')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const controller = manager.getController();
      const windows = controller.listWindows(options.session);

      if (options.json) {
        console.log(JSON.stringify(windows, null, 2));
        return;
      }

      if (windows.length === 0) {
        console.log(chalk.yellow('No windows found'));
        return;
      }

      console.log(chalk.bold('\nWindows:\n'));
      for (const w of windows) {
        const activeMarker = w.active ? chalk.green('*') : ' ';
        console.log(
          `  ${activeMarker} ${chalk.cyan(w.id.padEnd(6))} ` +
          `${w.index}: ${w.name.padEnd(20)} ` +
          chalk.gray(`(${w.paneCount} panes)`)
        );
      }
      console.log();
    });

  tmux
    .command('sessions')
    .description('List all tmux sessions')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const controller = manager.getController();
      const sessions = controller.listSessions();

      if (options.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }

      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found'));
        return;
      }

      console.log(chalk.bold('\nSessions:\n'));
      for (const s of sessions) {
        const attachedMarker = s.attached ? chalk.green('(attached)') : '';
        console.log(
          `  ${chalk.cyan(s.name.padEnd(20))} ` +
          `${s.windowCount} windows ` +
          attachedMarker
        );
      }
      console.log();
    });

  tmux
    .command('attach')
    .description('Get command to attach to a session')
    .option('-s, --session <name>', 'Session name')
    .action((options) => {
      const controller = manager.getController();
      const cmd = controller.getAttachCommand(options.session);
      console.log(chalk.bold('\nRun this command to attach:\n'));
      console.log(`  ${chalk.cyan(cmd)}`);
      console.log();
    });

  tmux
    .command('create-session <name>')
    .description('Create a new detached tmux session')
    .option('-c, --cwd <directory>', 'Working directory')
    .option('--command <command>', 'Initial command to run')
    .action((name, options) => {
      const controller = manager.getController();

      if (controller.sessionExists(name)) {
        console.error(chalk.red(`Session "${name}" already exists`));
        process.exit(1);
      }

      const sessionId = controller.createSession({
        name,
        cwd: options.cwd,
        command: options.command,
      });

      if (sessionId) {
        console.log(chalk.green(`Session "${name}" created`));
        console.log(chalk.gray(`Attach with: tmux attach-session -t ${name}`));
      } else {
        console.error(chalk.red('Failed to create session'));
        process.exit(1);
      }
    });

  tmux
    .command('cleanup <session>')
    .description('Kill an entire tmux session')
    .option('-y, --yes', 'Skip confirmation')
    .action((session, options) => {
      const controller = manager.getController();

      if (!controller.sessionExists(session)) {
        console.error(chalk.red(`Session "${session}" not found`));
        process.exit(1);
      }

      if (!options.yes) {
        console.log(chalk.yellow(`About to kill session "${session}"`));
        console.log(chalk.gray('Use --yes to confirm'));
        return;
      }

      const success = controller.killSession(session);
      if (success) {
        console.log(chalk.green(`Session "${session}" killed`));
      } else {
        console.error(chalk.red('Failed to kill session'));
        process.exit(1);
      }
    });

  return tmux;
}
