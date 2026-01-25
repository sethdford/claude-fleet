/**
 * HTTP Server Implementation
 *
 * Provides a REST API for Claude Code Tools functionality.
 */

import * as http from 'node:http';
import { SessionManager } from '@claude-fleet/session';
import { FleetManager } from '@claude-fleet/fleet';
import { SafetyManager } from '@claude-fleet/safety';
import { BeadStore, CheckpointStore, MailStore, TaskStore } from '@claude-fleet/storage';
import type { WorkerRole, WorkerStatus, TaskStatus, BeadStatus } from '@claude-fleet/common';
import type { OperationType } from '@claude-fleet/safety';

interface ServerContext {
  sessionManager: SessionManager;
  fleetManager: FleetManager;
  safetyManager: SafetyManager;
  beadStore: BeadStore;
  checkpointStore: CheckpointStore;
  mailStore: MailStore;
  taskStore: TaskStore;
}

interface Route {
  method: string;
  path: RegExp;
  handler: (ctx: ServerContext, req: http.IncomingMessage, params: Record<string, string>, body: unknown) => Promise<unknown>;
}

function createContext(): ServerContext {
  return {
    sessionManager: new SessionManager(),
    fleetManager: new FleetManager(),
    safetyManager: new SafetyManager(),
    beadStore: new BeadStore(),
    checkpointStore: new CheckpointStore(),
    mailStore: new MailStore(),
    taskStore: new TaskStore(),
  };
}

const routes: Route[] = [
  // Health check
  {
    method: 'GET',
    path: /^\/health$/,
    handler: async () => ({
      status: 'ok',
      version: '1.0.0',
      timestamp: Date.now(),
    }),
  },

  // Session routes
  {
    method: 'GET',
    path: /^\/api\/sessions$/,
    handler: async (ctx, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const projectPath = url.searchParams.get('projectPath');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      return ctx.sessionManager.list({
        ...(projectPath ? { projectPath } : {}),
        limit,
        offset,
      });
    },
  },
  {
    method: 'GET',
    path: /^\/api\/sessions\/([^/]+)$/,
    handler: async (ctx, _req, params) => {
      const session = ctx.sessionManager.get(params.id!);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      return session;
    },
  },
  {
    method: 'GET',
    path: /^\/api\/sessions\/([^/]+)\/messages$/,
    handler: async (ctx, _req, params) => {
      return ctx.sessionManager.getMessages(params.id!);
    },
  },
  {
    method: 'POST',
    path: /^\/api\/sessions\/search$/,
    handler: async (ctx, _req, _params, body) => {
      const { query, projectPath, limit } = body as { query: string; projectPath?: string; limit?: number };
      return ctx.sessionManager.search(query, {
        ...(projectPath ? { projectPath } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
    },
  },
  {
    method: 'GET',
    path: /^\/api\/sessions\/stats$/,
    handler: async (ctx, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const projectPath = url.searchParams.get('projectPath') || undefined;
      return ctx.sessionManager.getStats(projectPath);
    },
  },

  // Fleet routes
  {
    method: 'GET',
    path: /^\/api\/workers$/,
    handler: async (ctx, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const status = url.searchParams.get('status') as WorkerStatus | null;
      const role = url.searchParams.get('role') as WorkerRole | null;
      return ctx.fleetManager.listWorkers({ status: status || undefined, role: role || undefined });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/workers$/,
    handler: async (ctx, _req, _params, body) => {
      const { handle, role, prompt, worktree } = body as {
        handle: string;
        role?: string;
        prompt?: string;
        worktree?: boolean;
      };
      return ctx.fleetManager.spawn({
        handle,
        ...(role ? { role: role as WorkerRole } : {}),
        ...(prompt ? { prompt } : {}),
        ...(worktree !== undefined ? { worktree } : {}),
      });
    },
  },
  {
    method: 'GET',
    path: /^\/api\/workers\/([^/]+)$/,
    handler: async (ctx, _req, params) => {
      const worker = ctx.fleetManager.getWorker(params.id!);
      if (!worker) {
        throw { status: 404, message: 'Worker not found' };
      }
      return worker;
    },
  },
  {
    method: 'DELETE',
    path: /^\/api\/workers\/([^/]+)$/,
    handler: async (ctx, _req, params) => {
      const success = await ctx.fleetManager.dismiss(params.id!);
      if (!success) {
        throw { status: 404, message: 'Worker not found' };
      }
      return { success: true };
    },
  },
  {
    method: 'GET',
    path: /^\/api\/fleet\/status$/,
    handler: async (ctx) => {
      return ctx.fleetManager.getStatus();
    },
  },
  {
    method: 'POST',
    path: /^\/api\/fleet\/broadcast$/,
    handler: async (ctx, _req, _params, body) => {
      const { message, from } = body as { message: string; from?: string };
      ctx.fleetManager.broadcast(message, from);
      return { success: true };
    },
  },

  // Task routes
  {
    method: 'GET',
    path: /^\/api\/tasks$/,
    handler: async (ctx, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const status = url.searchParams.get('status') as TaskStatus | null;
      const assignedTo = url.searchParams.get('assignedTo');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return ctx.taskStore.list({
        ...(status ? { status: status } : {}),
        ...(assignedTo ? { assignedTo } : {}),
        limit,
      });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/tasks$/,
    handler: async (ctx, _req, _params, body) => {
      const { title, description, priority, assignedTo } = body as {
        title: string;
        description?: string;
        priority?: number;
        assignedTo?: string;
      };
      return ctx.taskStore.create({
        id: `task-${Date.now()}`,
        title,
        status: 'pending',
        priority: (priority as 1 | 2 | 3 | 4 | 5) ?? 3,
        ...(description ? { description } : {}),
        ...(assignedTo ? { assignedTo } : {}),
      });
    },
  },
  {
    method: 'PATCH',
    path: /^\/api\/tasks\/([^/]+)$/,
    handler: async (ctx, _req, params, body) => {
      const { status } = body as { status: TaskStatus };
      ctx.taskStore.updateStatus(params.id!, status);
      return { success: true };
    },
  },

  // Bead routes
  {
    method: 'GET',
    path: /^\/api\/beads$/,
    handler: async (ctx, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const status = url.searchParams.get('status') as BeadStatus | null;
      const convoyId = url.searchParams.get('convoyId');
      return ctx.beadStore.list({
        ...(status ? { status: status } : {}),
        ...(convoyId ? { convoyId } : {}),
      });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/beads$/,
    handler: async (ctx, _req, _params, body) => {
      const { title, description, convoyId } = body as {
        title: string;
        description?: string;
        convoyId?: string;
      };
      return ctx.beadStore.create({
        title,
        ...(description ? { description } : {}),
        ...(convoyId ? { convoyId } : {}),
      });
    },
  },
  {
    method: 'PATCH',
    path: /^\/api\/beads\/([^/]+)$/,
    handler: async (ctx, _req, params, body) => {
      const { status, actor } = body as { status: BeadStatus; actor?: string };
      ctx.beadStore.updateStatus(params.id!, status, actor);
      return { success: true };
    },
  },

  // Convoy routes
  {
    method: 'GET',
    path: /^\/api\/convoys$/,
    handler: async (ctx) => {
      return ctx.beadStore.listConvoys();
    },
  },
  {
    method: 'POST',
    path: /^\/api\/convoys$/,
    handler: async (ctx, _req, _params, body) => {
      const { name, description } = body as { name: string; description?: string };
      return ctx.beadStore.createConvoy({
        name,
        ...(description ? { description } : {}),
      });
    },
  },

  // Checkpoint routes
  {
    method: 'GET',
    path: /^\/api\/checkpoints$/,
    handler: async (ctx, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit') || '50');
      return ctx.checkpointStore.list({ limit });
    },
  },
  {
    method: 'GET',
    path: /^\/api\/checkpoints\/([^/]+)$/,
    handler: async (ctx, _req, params) => {
      const checkpoint = ctx.checkpointStore.getLatest(params.id!);
      if (!checkpoint) {
        throw { status: 404, message: 'Checkpoint not found' };
      }
      return checkpoint;
    },
  },
  {
    method: 'POST',
    path: /^\/api\/checkpoints$/,
    handler: async (ctx, _req, _params, body) => {
      const { workerHandle, goal, worked, remaining, context } = body as {
        workerHandle: string;
        goal: string;
        worked?: string[];
        remaining?: string[];
        context?: Record<string, unknown>;
      };
      return ctx.checkpointStore.create({
        workerHandle,
        goal,
        ...(worked ? { worked } : {}),
        ...(remaining ? { remaining } : {}),
        ...(context ? { context } : {}),
      });
    },
  },

  // Mail routes
  {
    method: 'GET',
    path: /^\/api\/mail\/([^/]+)$/,
    handler: async (ctx, req, params) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
      return ctx.mailStore.getInbox(params.id!, { unreadOnly });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/mail$/,
    handler: async (ctx, _req, _params, body) => {
      const { from, to, subject, body: mailBody } = body as {
        from: string;
        to: string;
        subject?: string;
        body: string;
      };
      return ctx.mailStore.send({
        from,
        to,
        ...(subject ? { subject } : {}),
        body: mailBody,
      });
    },
  },

  // Safety routes
  {
    method: 'GET',
    path: /^\/api\/safety\/status$/,
    handler: async (ctx) => {
      return ctx.safetyManager.getStatus();
    },
  },
  {
    method: 'POST',
    path: /^\/api\/safety\/check$/,
    handler: async (ctx, _req, _params, body) => {
      const { operation, command, filePath, content } = body as {
        operation: string;
        command?: string;
        filePath?: string;
        content?: string;
      };
      return ctx.safetyManager.check({
        operation: operation as OperationType,
        ...(command ? { command } : {}),
        ...(filePath ? { filePath } : {}),
        ...(content ? { content } : {}),
      });
    },
  },
  {
    method: 'POST',
    path: /^\/api\/safety\/hooks\/([^/]+)\/enable$/,
    handler: async (ctx, _req, params) => {
      const success = ctx.safetyManager.enableHook(params.id!);
      if (!success) {
        throw { status: 404, message: 'Hook not found' };
      }
      return { success: true };
    },
  },
  {
    method: 'POST',
    path: /^\/api\/safety\/hooks\/([^/]+)\/disable$/,
    handler: async (ctx, _req, params) => {
      const success = ctx.safetyManager.disableHook(params.id!);
      if (!success) {
        throw { status: 404, message: 'Hook not found' };
      }
      return { success: true };
    },
  },
];

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.path);
    if (match) {
      const params: Record<string, string> = {};
      if (match[1]) params.id = match[1];
      if (match[2]) params.id2 = match[2];
      return { route, params };
    }
  }
  return null;
}

export interface HttpServerOptions {
  port?: number;
  host?: string;
}

export class HttpServer {
  private server: http.Server;
  private context: ServerContext;
  private port: number;
  private host: string;

  constructor(options: HttpServerOptions = {}) {
    this.port = options.port || 3847;
    this.host = options.host || '0.0.0.0';
    this.context = createContext();
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      const matched = matchRoute(req.method || 'GET', pathname);

      if (!matched) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const body = await parseBody(req);
      const result = await matched.route.handler(this.context, req, matched.params, body);

      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      const err = error as { status?: number; message?: string };
      const status = err.status || 500;
      const message = err.message || 'Internal server error';

      res.writeHead(status);
      res.end(JSON.stringify({ error: message }));
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        console.log(`HTTP server listening on http://${this.host}:${this.port}`);
        console.log('\nAvailable endpoints:');
        console.log('  GET  /health                      Health check');
        console.log('  GET  /api/sessions                List sessions');
        console.log('  GET  /api/sessions/:id            Get session');
        console.log('  GET  /api/sessions/:id/messages   Get session messages');
        console.log('  POST /api/sessions/search         Search sessions');
        console.log('  GET  /api/sessions/stats          Session stats');
        console.log('  GET  /api/workers                 List workers');
        console.log('  POST /api/workers                 Spawn worker');
        console.log('  GET  /api/workers/:handle         Get worker');
        console.log('  DELETE /api/workers/:handle       Dismiss worker');
        console.log('  GET  /api/fleet/status            Fleet status');
        console.log('  POST /api/fleet/broadcast         Broadcast message');
        console.log('  GET  /api/tasks                   List tasks');
        console.log('  POST /api/tasks                   Create task');
        console.log('  GET  /api/beads                   List beads');
        console.log('  POST /api/beads                   Create bead');
        console.log('  GET  /api/convoys                 List convoys');
        console.log('  POST /api/convoys                 Create convoy');
        console.log('  GET  /api/checkpoints             List checkpoints');
        console.log('  POST /api/checkpoints             Create checkpoint');
        console.log('  GET  /api/mail/:handle            Get inbox');
        console.log('  POST /api/mail                    Send mail');
        console.log('  GET  /api/safety/status           Safety status');
        console.log('  POST /api/safety/check            Check safety');
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

export function createHttpServer(options?: HttpServerOptions): HttpServer {
  return new HttpServer(options);
}
