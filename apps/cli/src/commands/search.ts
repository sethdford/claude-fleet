/**
 * Search Command
 *
 * Full-text search across sessions (TUI when Rust crate is available).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { SessionManager } from '@claude-fleet/session';

function getDefaultIndexPath(): string {
  return resolve(homedir(), '.cct', 'search-index');
}

export function searchCommand(): Command {
  const search = new Command('search')
    .description('Search sessions')
    .argument('[query]', 'Search query')
    .option('-p, --project <path>', 'Filter by project path')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('-t, --tui', 'Launch interactive TUI')
    .option('--json', 'Output as JSON')
    .action(async (query, options) => {
      if (options.tui) {
        // Try to launch Rust TUI
        try {
          const { SearchIndex } = await import('@claude-fleet/search');
          const index = new SearchIndex(getDefaultIndexPath());
          index.launchTui();
          return;
        } catch {
          console.log(chalk.yellow('TUI not available. Using basic search.'));
        }
      }

      if (!query) {
        console.log(chalk.red('Please provide a search query or use --tui'));
        process.exit(1);
      }

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
        const date = new Date(session.lastAccessed).toLocaleDateString();
        console.log(
          chalk.cyan(session.id.slice(0, 8)) + ' ' +
          chalk.gray(`[${date}]`) + ' ' +
          chalk.white(session.projectPath)
        );

        for (const match of matches) {
          // Highlight matches
          const highlighted = match.replace(
            /\*\*\*(.*?)\*\*\*/g,
            (_, p1) => chalk.yellow.bold(p1)
          );
          console.log('  ' + chalk.dim(highlighted));
        }
        console.log();
      }
    });

  return search;
}
