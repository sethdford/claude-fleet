/**
 * MCP Server Implementation
 *
 * Exposes CCT functionality as MCP tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
  type TextContent,
} from '@modelcontextprotocol/sdk/types.js';

import { SessionManager } from '@claude-fleet/session';
import { FleetManager, Blackboard } from '@claude-fleet/fleet';
import { SafetyManager } from '@claude-fleet/safety';
import { BeadStore, CheckpointStore, MailStore, TaskStore } from '@claude-fleet/storage';
import { FleetTmuxManager } from '@claude-fleet/tmux';

import { sessionTools } from './tools/session.js';
import { fleetTools } from './tools/fleet.js';
import { safetyTools } from './tools/safety.js';
import { beadTools } from './tools/bead.js';
import { mailTools } from './tools/mail.js';
import { tmuxTools } from './tools/tmux.js';

export interface MCPServerContext {
  sessionManager: SessionManager;
  fleetManager: FleetManager;
  safetyManager: SafetyManager;
  beadStore: BeadStore;
  checkpointStore: CheckpointStore;
  mailStore: MailStore;
  taskStore: TaskStore;
  blackboard: Blackboard;
  tmuxManager: FleetTmuxManager;
}

export class MCPServer {
  private server: Server;
  private context: MCPServerContext;

  constructor() {
    this.server = new Server(
      {
        name: 'claude-code-tools',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize context
    this.context = {
      sessionManager: new SessionManager(),
      fleetManager: new FleetManager(),
      safetyManager: new SafetyManager(),
      beadStore: new BeadStore(),
      checkpointStore: new CheckpointStore(),
      mailStore: new MailStore(),
      taskStore: new TaskStore(),
      blackboard: new Blackboard(),
      tmuxManager: new FleetTmuxManager(),
    };

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        ...sessionTools,
        ...fleetTools,
        ...safetyTools,
        ...beadTools,
        ...mailTools,
        ...tmuxTools,
      ];

      return { tools };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.executeTool(name, args || {});
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            } as TextContent,
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            } as TextContent,
          ],
          isError: true,
        };
      }
    });
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Session tools
    if (name === 'session_list') {
      return this.context.sessionManager.list(args as any);
    }
    if (name === 'session_get') {
      return this.context.sessionManager.get(args.id as string);
    }
    if (name === 'session_search') {
      return this.context.sessionManager.search(args.query as string, args as any);
    }
    if (name === 'session_resume') {
      const { resumeSession } = await import('@cct/session');
      return resumeSession(args.id as string, args as any);
    }
    if (name === 'session_export') {
      const { SessionExporter } = await import('@cct/session');
      const exporter = new SessionExporter();
      return exporter.export(args.id as string, args as any);
    }

    // Fleet tools
    if (name === 'team_spawn') {
      return this.context.fleetManager.spawn(args as any);
    }
    if (name === 'team_dismiss') {
      return this.context.fleetManager.dismiss(args.handle as string);
    }
    if (name === 'team_workers') {
      return this.context.fleetManager.listWorkers(args as any);
    }
    if (name === 'team_status') {
      return this.context.fleetManager.getStatus();
    }
    if (name === 'team_broadcast') {
      this.context.fleetManager.broadcast(args.message as string, args.from as string);
      return { success: true };
    }
    if (name === 'team_send') {
      this.context.fleetManager.sendMessage(
        args.to as string,
        args.message as string,
        args.from as string,
        args.subject as string | undefined
      );
      return { success: true };
    }
    if (name === 'team_handoff') {
      this.context.fleetManager.handoff(
        args.from as string,
        args.to as string,
        args.context as Record<string, unknown>
      );
      return { success: true };
    }

    // Blackboard tools
    if (name === 'blackboard_post') {
      return this.context.blackboard.post(args as any);
    }
    if (name === 'blackboard_read') {
      return this.context.blackboard.read(args as any);
    }

    // Checkpoint tools
    if (name === 'checkpoint_create') {
      return this.context.checkpointStore.create(args as any);
    }
    if (name === 'checkpoint_get') {
      return this.context.checkpointStore.getLatest(args.handle as string);
    }
    if (name === 'checkpoint_list') {
      return this.context.checkpointStore.list(args as any);
    }

    // Task tools
    if (name === 'team_tasks') {
      return this.context.taskStore.list(args as any);
    }
    if (name === 'team_assign') {
      return this.context.taskStore.assign(args.id as string, args.handle as string);
    }
    if (name === 'team_claim') {
      const tasks = this.context.taskStore.getUnassigned({ limit: 1 });
      if (tasks.length === 0) return null;
      this.context.taskStore.assign(tasks[0].id, args.handle as string);
      return tasks[0];
    }
    if (name === 'team_complete') {
      this.context.taskStore.updateStatus(args.id as string, 'completed');
      return { success: true };
    }

    // Bead tools
    if (name === 'bead_create') {
      return this.context.beadStore.create(args as any);
    }
    if (name === 'bead_list') {
      return this.context.beadStore.list(args as any);
    }
    if (name === 'bead_update') {
      this.context.beadStore.updateStatus(
        args.id as string,
        args.status as any,
        args.actor as string | undefined
      );
      return { success: true };
    }
    if (name === 'convoy_create') {
      return this.context.beadStore.createConvoy(args as any);
    }
    if (name === 'convoy_dispatch') {
      const count = this.context.beadStore.dispatchConvoy(
        args.convoyId as string,
        args.handle as string
      );
      return { dispatched: count };
    }

    // Mail tools
    if (name === 'mail_send') {
      return this.context.mailStore.send(args as any);
    }
    if (name === 'mail_read') {
      return this.context.mailStore.getInbox(args.handle as string, args as any);
    }

    // Safety tools
    if (name === 'safety_check') {
      return this.context.safetyManager.check(args as any);
    }
    if (name === 'safety_status') {
      return this.context.safetyManager.getStatus();
    }
    if (name === 'safety_enable') {
      return this.context.safetyManager.enableHook(args.hookId as string);
    }
    if (name === 'safety_disable') {
      return this.context.safetyManager.disableHook(args.hookId as string);
    }

    // Tmux tools
    if (name === 'tmux_status') {
      return this.context.tmuxManager.getStatus();
    }
    if (name === 'tmux_spawn') {
      return this.context.tmuxManager.spawnWorker(args as any);
    }
    if (name === 'tmux_spawn_claude') {
      return this.context.tmuxManager.spawnClaudeWorker(args as any);
    }
    if (name === 'tmux_send') {
      const worker = this.context.tmuxManager.getWorker(args.handle as string);
      if (!worker) {
        throw new Error(`Worker "${args.handle}" not found`);
      }
      const controller = this.context.tmuxManager.getController();
      await controller.sendKeys(worker.paneId, args.text as string, {
        noEnter: args.noEnter as boolean | undefined,
        instant: args.instant as boolean | undefined,
        delay: args.delay as number | undefined,
      });
      return { success: true };
    }
    if (name === 'tmux_capture') {
      return {
        output: this.context.tmuxManager.captureWorkerOutput(
          args.handle as string,
          args.lines as number | undefined
        ),
      };
    }
    if (name === 'tmux_execute') {
      return this.context.tmuxManager.executeInWorker(
        args.handle as string,
        args.command as string,
        { timeout: args.timeout as number | undefined }
      );
    }
    if (name === 'tmux_wait_idle') {
      const idle = await this.context.tmuxManager.waitForWorkerIdle(
        args.handle as string,
        {
          timeout: args.timeout as number | undefined,
          stableTime: args.stableTime as number | undefined,
        }
      );
      return { idle };
    }
    if (name === 'tmux_wait_pattern') {
      const found = await this.context.tmuxManager.waitForWorkerPattern(
        args.handle as string,
        new RegExp(args.pattern as string),
        { timeout: args.timeout as number | undefined }
      );
      return { found };
    }
    if (name === 'tmux_interrupt') {
      this.context.tmuxManager.interruptWorker(args.handle as string);
      return { success: true };
    }
    if (name === 'tmux_kill') {
      const success = this.context.tmuxManager.killWorker(args.handle as string);
      return { success };
    }
    if (name === 'tmux_kill_all') {
      const killed = this.context.tmuxManager.killAllWorkers();
      return { killed };
    }
    if (name === 'tmux_broadcast') {
      await this.context.tmuxManager.broadcast(args.message as string);
      return { success: true };
    }
    if (name === 'tmux_focus') {
      this.context.tmuxManager.focusWorker(args.handle as string);
      return { success: true };
    }
    if (name === 'tmux_list_panes') {
      const controller = this.context.tmuxManager.getController();
      return controller.listPanes();
    }
    if (name === 'tmux_escape') {
      this.context.tmuxManager.escapeWorker(args.handle as string);
      return { success: true };
    }
    if (name === 'tmux_list_windows') {
      const controller = this.context.tmuxManager.getController();
      return controller.listWindows(args.session as string | undefined);
    }
    if (name === 'tmux_list_sessions') {
      const controller = this.context.tmuxManager.getController();
      return controller.listSessions();
    }
    if (name === 'tmux_attach') {
      const controller = this.context.tmuxManager.getController();
      return {
        command: controller.getAttachCommand(args.session as string | undefined),
        message: 'Run this command in your terminal to attach to the session',
      };
    }
    if (name === 'tmux_create_session') {
      const controller = this.context.tmuxManager.getController();
      const sessionId = controller.createSession({
        name: args.name as string,
        cwd: args.cwd as string | undefined,
        command: args.command as string | undefined,
      });
      return { sessionId, success: !!sessionId };
    }
    if (name === 'tmux_cleanup') {
      const controller = this.context.tmuxManager.getController();
      const success = controller.killSession(args.session as string);
      return { success };
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('CCT MCP Server started');
  }
}

export function createServer(): MCPServer {
  return new MCPServer();
}
