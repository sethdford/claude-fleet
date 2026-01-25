/**
 * Safety Commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { SafetyManager } from '@claude-fleet/safety';
import type { OperationType } from '@claude-fleet/safety';

export function safetyCommands(): Command {
  const safety = new Command('safety')
    .description('Safety hook management');

  safety
    .command('status')
    .description('Show safety hook status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const manager = new SafetyManager();
      const status = manager.getStatus();

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(chalk.bold('\nSafety Hooks:\n'));

      for (const hook of status.hooks) {
        const statusIcon = hook.enabled ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${statusIcon} ${chalk.cyan(hook.id.padEnd(20))} ${chalk.gray(hook.description)}`);
      }
      console.log();
    });

  safety
    .command('enable <hookId>')
    .description('Enable a safety hook')
    .action(async (hookId) => {
      const manager = new SafetyManager();
      const success = manager.enableHook(hookId);

      if (success) {
        console.log(chalk.green(`Hook "${hookId}" enabled`));
      } else {
        console.log(chalk.red(`Hook "${hookId}" not found`));
        process.exit(1);
      }
    });

  safety
    .command('disable <hookId>')
    .description('Disable a safety hook')
    .action(async (hookId) => {
      const manager = new SafetyManager();
      const success = manager.disableHook(hookId);

      if (success) {
        console.log(chalk.yellow(`Hook "${hookId}" disabled`));
      } else {
        console.log(chalk.red(`Hook "${hookId}" not found`));
        process.exit(1);
      }
    });

  safety
    .command('test <command>')
    .description('Test if a command is safe')
    .option('--json', 'Output as JSON')
    .action(async (command, options) => {
      const manager = new SafetyManager();
      const result = manager.check({
        operation: 'bash_command',
        command,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.allowed) {
        console.log(chalk.green('✓ Command is allowed'));
        if (result.warnings.length > 0) {
          console.log(chalk.yellow('\nWarnings:'));
          for (const warning of result.warnings) {
            console.log(`  - ${warning}`);
          }
        }
      } else {
        console.log(chalk.red('✗ Command is blocked'));
        console.log(chalk.red(`\nReason: ${result.reason}`));
        if (result.suggestions && result.suggestions.length > 0) {
          console.log(chalk.yellow('\nSuggestions:'));
          for (const suggestion of result.suggestions) {
            console.log(`  - ${suggestion}`);
          }
        }
      }
      console.log();
    });

  safety
    .command('check-file <path>')
    .description('Check if a file operation is safe')
    .option('-o, --operation <op>', 'Operation type', 'file_read')
    .option('--json', 'Output as JSON')
    .action(async (path, options) => {
      const manager = new SafetyManager();
      const result = manager.check({
        operation: options.operation as OperationType,
        filePath: path,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.allowed) {
        console.log(chalk.green(`✓ ${options.operation} on ${path} is allowed`));
        if (result.warnings.length > 0) {
          console.log(chalk.yellow('\nWarnings:'));
          for (const warning of result.warnings) {
            console.log(`  - ${warning}`);
          }
        }
      } else {
        console.log(chalk.red(`✗ ${options.operation} on ${path} is blocked`));
        console.log(chalk.red(`\nReason: ${result.reason}`));
      }
      console.log();
    });

  return safety;
}
