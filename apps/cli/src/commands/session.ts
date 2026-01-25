/**
 * Session Commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { SessionManager, SessionExporter, resumeSession } from '@claude-fleet/session';
import type { ResumeStrategy, ExportFormat } from '@claude-fleet/session';

export function sessionCommands(): Command {
  const session = new Command('session')
    .description('Session management commands');

  session
    .command('list')
    .description('List all sessions')
    .option('-p, --project <path>', 'Filter by project path')
    .option('-l, --limit <n>', 'Maximum number of sessions', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const manager = new SessionManager();
      const sessions = manager.list({
        projectPath: options.project,
        limit: parseInt(options.limit),
      });

      if (options.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }

      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found.'));
        return;
      }

      console.log(chalk.bold(`\nSessions (${sessions.length}):\n`));

      for (const s of sessions) {
        const date = new Date(s.lastAccessed).toLocaleDateString();
        const time = new Date(s.lastAccessed).toLocaleTimeString();
        console.log(chalk.cyan(s.id.slice(0, 8)) + ' ' +
          chalk.gray(`[${date} ${time}]`) + ' ' +
          chalk.white(s.projectPath) + ' ' +
          chalk.gray(`(${s.messageCount} messages)`));

        if (s.summary) {
          console.log('  ' + chalk.dim(s.summary.slice(0, 80) + (s.summary.length > 80 ? '...' : '')));
        }
      }
      console.log();
    });

  session
    .command('resume <id>')
    .description('Resume a session')
    .option('-s, --strategy <strategy>', 'Resume strategy', 'smart-trim')
    .option('-m, --max-messages <n>', 'Maximum messages', '50')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      const result = resumeSession(id, {
        strategy: options.strategy as ResumeStrategy,
        maxMessages: parseInt(options.maxMessages),
      });

      if (!result) {
        console.error(chalk.red(`Session not found: ${id}`));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.green(`\nResumed session: ${result.session.id}`));
      console.log(chalk.gray(`Strategy: ${result.strategy}`));
      console.log(chalk.gray(`Messages: ${result.messages.length} of ${result.originalCount}`));
      if (result.truncated) {
        console.log(chalk.yellow('(truncated)'));
      }
      console.log();

      // Output messages for piping to Claude
      for (const msg of result.messages) {
        console.log(`--- ${msg.role.toUpperCase()} ---`);
        console.log(msg.content);
        console.log();
      }
    });

  session
    .command('search <query>')
    .description('Search sessions by content')
    .option('-p, --project <path>', 'Filter by project path')
    .option('-l, --limit <n>', 'Maximum results', '10')
    .option('--json', 'Output as JSON')
    .action(async (query, options) => {
      const manager = new SessionManager();
      const results = manager.search(query, {
        projectPath: options.project,
        limit: parseInt(options.limit),
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(chalk.yellow(`No matches for "${query}"`));
        return;
      }

      console.log(chalk.bold(`\nSearch results for "${query}" (${results.length}):\n`));

      for (const { session, matches } of results) {
        console.log(chalk.cyan(session.id.slice(0, 8)) + ' ' +
          chalk.white(session.projectPath));

        for (const match of matches) {
          console.log('  ' + chalk.dim(match));
        }
        console.log();
      }
    });

  session
    .command('export <id>')
    .description('Export a session')
    .option('-f, --format <format>', 'Export format', 'markdown')
    .option('-o, --output <file>', 'Output file')
    .option('--no-metadata', 'Exclude metadata')
    .option('--timestamps', 'Include timestamps')
    .action(async (id, options) => {
      const exporter = new SessionExporter();
      const result = exporter.export(id, {
        format: options.format as ExportFormat,
        includeMetadata: options.metadata,
        includeTimestamps: options.timestamps,
      });

      if (!result) {
        console.error(chalk.red(`Session not found: ${id}`));
        process.exit(1);
      }

      if (options.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.output, result.content);
        console.log(chalk.green(`Exported to ${options.output}`));
      } else {
        console.log(result.content);
      }
    });

  session
    .command('stats')
    .description('Show session statistics')
    .option('-p, --project <path>', 'Filter by project path')
    .action(async (options) => {
      const manager = new SessionManager();
      const stats = manager.getStats(options.project);

      console.log(chalk.bold('\nSession Statistics:\n'));
      console.log(`  Total sessions:   ${chalk.cyan(stats.totalSessions)}`);
      console.log(`  Total messages:   ${chalk.cyan(stats.totalMessages)}`);
      console.log(`  Active (7 days):  ${chalk.cyan(stats.recentActivity)}`);
      console.log();
    });

  return session;
}
