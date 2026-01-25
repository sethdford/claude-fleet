/**
 * Server Command
 *
 * Start the MCP server or HTTP API server.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

export function serveCommand(): Command {
  const serve = new Command('serve')
    .description('Start server')
    .option('-p, --port <port>', 'HTTP server port', '3847')
    .option('-H, --host <host>', 'HTTP server host', '0.0.0.0')
    .option('--mcp', 'Start MCP server (stdio)')
    .option('--http', 'Start HTTP server')
    .action(async (options) => {
      if (options.mcp) {
        // Start MCP server
        const { createServer } = await import('@cct/mcp');
        const server = createServer();
        await server.start();
        return;
      }

      if (options.http) {
        const spinner = ora('Starting HTTP server...').start();

        try {
          const { createHttpServer } = await import('../server/http.js');
          const server = createHttpServer({
            port: parseInt(options.port),
            host: options.host,
          });

          spinner.succeed(chalk.green('HTTP server starting...'));
          await server.start();

          // Keep server running
          process.on('SIGINT', async () => {
            console.log(chalk.yellow('\nShutting down...'));
            await server.stop();
            process.exit(0);
          });

          process.on('SIGTERM', async () => {
            await server.stop();
            process.exit(0);
          });
        } catch (error) {
          spinner.fail(chalk.red(`Failed to start server: ${(error as Error).message}`));
          process.exit(1);
        }
        return;
      }

      // Default: show help
      console.log(chalk.bold('\nServer Options:\n'));
      console.log('  cct serve --mcp               Start MCP server (for Claude Code integration)');
      console.log('  cct serve --http              Start HTTP API server');
      console.log('  cct serve --http -p 8080      Start HTTP server on port 8080');
      console.log('  cct serve --http -H localhost Start HTTP server on localhost only');
      console.log();
    });

  return serve;
}
