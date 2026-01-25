/**
 * LMSH Command - Natural Language to Shell Translator
 *
 * Translates natural language descriptions to shell commands.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';

// Type definitions for the NAPI bindings
interface TranslationResult {
  command: string;
  confidence: number;
  alternatives: string[];
  explanation: string;
}

interface LmshTranslator {
  translate(input: string): TranslationResult;
  translateWithAliases(input: string): TranslationResult;
  addAlias(alias: string, command: string): void;
  getAliases(): Record<string, string>;
}

interface LmshModule {
  LmshTranslator: new () => LmshTranslator;
  createTranslator(): LmshTranslator;
}

export function lmshCommand(): Command {
  const lmsh = new Command('lmsh')
    .description('Translate natural language to shell commands')
    .argument('[description...]', 'Natural language description of the command')
    .option('-e, --execute', 'Execute the translated command')
    .option('-i, --interactive', 'Start interactive mode')
    .option('--json', 'Output as JSON')
    .action(async (descriptionParts, options) => {
      // Try to load the Rust NAPI module
      let translator: LmshTranslator;
      try {
        const lmshModule = await import('@claude-fleet/lmsh') as LmshModule;
        translator = lmshModule.createTranslator();
      } catch {
        console.log(chalk.yellow('LMSH native module not available.'));
        console.log(chalk.dim('Build Rust crates with: pnpm build:rust'));
        console.log(chalk.dim('\nUsing fallback pattern matcher...\n'));
        translator = createFallbackTranslator();
      }

      if (options.interactive) {
        await runInteractiveMode(translator, options);
        return;
      }

      const description = descriptionParts.join(' ');
      if (!description) {
        console.log(chalk.red('Please provide a description or use --interactive'));
        process.exit(1);
      }

      const result = translator.translate(description);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      displayResult(result, options);

      if (options.execute && result.command && result.confidence > 0.7) {
        await executeCommand(result.command);
      }
    });

  // Subcommand: add alias
  lmsh
    .command('alias')
    .description('Manage command aliases')
    .argument('<action>', 'Action: add, list, remove')
    .argument('[args...]', 'Arguments for the action')
    .action(async (action, args) => {
      let translator: LmshTranslator;
      try {
        const lmshModule = await import('@claude-fleet/lmsh') as LmshModule;
        translator = lmshModule.createTranslator();
      } catch {
        console.log(chalk.yellow('LMSH native module not available.'));
        return;
      }

      switch (action) {
        case 'add': {
          if (args.length < 2) {
            console.log(chalk.red('Usage: lmsh alias add <alias> <command>'));
            return;
          }
          const [alias, ...commandParts] = args;
          const command = commandParts.join(' ');
          translator.addAlias(alias, command);
          console.log(chalk.green(`Added alias: ${alias} -> ${command}`));
          break;
        }
        case 'list': {
          const aliases = translator.getAliases();
          if (Object.keys(aliases).length === 0) {
            console.log(chalk.yellow('No aliases configured.'));
            return;
          }
          console.log(chalk.bold('\nConfigured aliases:\n'));
          for (const [alias, command] of Object.entries(aliases)) {
            console.log(`  ${chalk.cyan(alias)} -> ${chalk.white(command)}`);
          }
          break;
        }
        default:
          console.log(chalk.red(`Unknown action: ${action}`));
          console.log('Available actions: add, list');
      }
    });

  return lmsh;
}

function displayResult(result: TranslationResult, options: { execute?: boolean }): void {
  if (!result.command) {
    console.log(chalk.yellow('Could not translate to a shell command.'));
    console.log(chalk.dim(result.explanation));
    return;
  }

  const confidenceColor = result.confidence >= 0.8
    ? chalk.green
    : result.confidence >= 0.6
      ? chalk.yellow
      : chalk.red;

  console.log(chalk.bold('Command:'));
  console.log('  ' + chalk.cyan(result.command));
  console.log();
  console.log(chalk.bold('Confidence:'), confidenceColor((result.confidence * 100).toFixed(0) + '%'));
  console.log(chalk.bold('Explanation:'), chalk.dim(result.explanation));

  if (result.alternatives.length > 0) {
    console.log();
    console.log(chalk.bold('Alternatives:'));
    for (const alt of result.alternatives) {
      console.log('  ' + chalk.dim(alt));
    }
  }

  if (options.execute) {
    if (result.confidence < 0.7) {
      console.log();
      console.log(chalk.yellow('⚠ Confidence too low for auto-execution (< 70%)'));
    }
  }
}

async function executeCommand(command: string): Promise<void> {
  console.log();
  console.log(chalk.bold('Executing:'), chalk.cyan(command));
  console.log(chalk.dim('─'.repeat(50)));

  const { spawn } = await import('child_process');
  const child = spawn(command, {
    shell: true,
    stdio: 'inherit',
  });

  await new Promise<void>((resolve) => {
    child.on('close', (code) => {
      console.log(chalk.dim('─'.repeat(50)));
      console.log(code === 0
        ? chalk.green('✓ Command completed')
        : chalk.red(`✗ Command exited with code ${code}`));
      resolve();
    });
  });
}

async function runInteractiveMode(translator: LmshTranslator, options: { execute?: boolean }): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.bold('\n🐚 LMSH - Natural Language Shell'));
  console.log(chalk.dim('Type a description to translate, or:'));
  console.log(chalk.dim('  !<command>  Execute a command directly'));
  console.log(chalk.dim('  /alias      Manage aliases'));
  console.log(chalk.dim('  /help       Show help'));
  console.log(chalk.dim('  /quit       Exit'));
  console.log();

  const prompt = () => {
    rl.question(chalk.green('lmsh> '), async (input) => {
      input = input.trim();

      if (!input) {
        prompt();
        return;
      }

      if (input === '/quit' || input === '/exit' || input === '/q') {
        console.log(chalk.dim('Goodbye!'));
        rl.close();
        return;
      }

      if (input === '/help') {
        console.log(chalk.bold('\nCommands:'));
        console.log('  /alias add <name> <cmd>  Add a custom alias');
        console.log('  /alias list              List all aliases');
        console.log('  /quit                    Exit LMSH');
        console.log('  !<command>               Run a shell command directly');
        console.log('\nExamples:');
        console.log('  list files               -> ls -la');
        console.log('  git status               -> git status');
        console.log('  search for "TODO"        -> grep -r "TODO" .');
        console.log();
        prompt();
        return;
      }

      if (input.startsWith('/alias')) {
        const parts = input.slice(6).trim().split(/\s+/);
        const aliasName = parts[1];
        if (parts[0] === 'add' && parts.length >= 3 && aliasName) {
          const command = parts.slice(2).join(' ');
          translator.addAlias(aliasName, command);
          console.log(chalk.green(`Added alias: ${aliasName} -> ${command}`));
        } else if (parts[0] === 'list') {
          const aliases = translator.getAliases();
          if (Object.keys(aliases).length === 0) {
            console.log(chalk.yellow('No aliases.'));
          } else {
            for (const [a, c] of Object.entries(aliases)) {
              console.log(`  ${chalk.cyan(a)} -> ${c}`);
            }
          }
        } else {
          console.log(chalk.yellow('Usage: /alias add <name> <cmd> or /alias list'));
        }
        prompt();
        return;
      }

      if (input.startsWith('!')) {
        await executeCommand(input.slice(1).trim());
        prompt();
        return;
      }

      // Translate and optionally execute
      const result = translator.translateWithAliases(input);

      if (!result.command) {
        console.log(chalk.yellow('Could not translate. Try rephrasing.'));
        prompt();
        return;
      }

      const conf = result.confidence >= 0.8 ? chalk.green : chalk.yellow;
      console.log(`${chalk.cyan(result.command)} ${conf(`(${(result.confidence * 100).toFixed(0)}%)`)}`);
      console.log(chalk.dim(result.explanation));

      if (options.execute && result.confidence >= 0.7) {
        rl.question(chalk.dim('Execute? [y/N] '), async (answer) => {
          if (answer.toLowerCase() === 'y') {
            await executeCommand(result.command);
          }
          prompt();
        });
      } else {
        prompt();
      }
    });
  };

  prompt();
}

/**
 * Fallback translator when Rust module is not available
 */
function createFallbackTranslator(): LmshTranslator {
  const patterns: Array<{
    triggers: string[];
    command: string;
    explanation: string;
    confidence: number;
  }> = [
    { triggers: ['list files', 'show files', 'ls'], command: 'ls -la', explanation: 'List files', confidence: 0.9 },
    { triggers: ['git status', 'check git'], command: 'git status', explanation: 'Git status', confidence: 0.95 },
    { triggers: ['git log', 'commit history'], command: 'git log --oneline -20', explanation: 'Git log', confidence: 0.9 },
    { triggers: ['git diff', 'show changes'], command: 'git diff', explanation: 'Git diff', confidence: 0.9 },
    { triggers: ['current directory', 'where am i', 'pwd'], command: 'pwd', explanation: 'Print working directory', confidence: 0.95 },
    { triggers: ['disk space', 'free space'], command: 'df -h', explanation: 'Disk usage', confidence: 0.9 },
    { triggers: ['running processes', 'ps'], command: 'ps aux', explanation: 'Process list', confidence: 0.9 },
    { triggers: ['clear screen', 'clear'], command: 'clear', explanation: 'Clear terminal', confidence: 0.95 },
  ];

  const aliases: Record<string, string> = {};

  return {
    translate(input: string): TranslationResult {
      const lower = input.toLowerCase();
      for (const pattern of patterns) {
        for (const trigger of pattern.triggers) {
          if (lower.includes(trigger)) {
            return {
              command: pattern.command,
              confidence: pattern.confidence,
              alternatives: [],
              explanation: pattern.explanation,
            };
          }
        }
      }
      return {
        command: '',
        confidence: 0,
        alternatives: [],
        explanation: 'No match found',
      };
    },
    translateWithAliases(input: string): TranslationResult {
      const lower = input.toLowerCase();
      for (const [alias, command] of Object.entries(aliases)) {
        if (lower.includes(alias)) {
          return {
            command,
            confidence: 1.0,
            alternatives: [],
            explanation: `Custom alias for '${alias}'`,
          };
        }
      }
      return this.translate(input);
    },
    addAlias(alias: string, command: string): void {
      aliases[alias.toLowerCase()] = command;
    },
    getAliases(): Record<string, string> {
      return { ...aliases };
    },
  };
}
