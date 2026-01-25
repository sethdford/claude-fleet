/**
 * MCP Server Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setDatabasePath, resetDatabase } from '@claude-fleet/storage';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import tool definitions to verify they're properly structured
import { sessionTools } from './tools/session.js';
import { fleetTools } from './tools/fleet.js';
import { safetyTools } from './tools/safety.js';
import { beadTools } from './tools/bead.js';
import { mailTools } from './tools/mail.js';

describe('MCP Tool Definitions', () => {
  describe('sessionTools', () => {
    it('defines session_list tool', () => {
      const tool = sessionTools.find(t => t.name === 'session_list');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toBeDefined();
      expect(tool?.inputSchema.type).toBe('object');
    });

    it('defines session_get tool with required id', () => {
      const tool = sessionTools.find(t => t.name === 'session_get');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('defines session_search tool with required query', () => {
      const tool = sessionTools.find(t => t.name === 'session_search');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('query');
    });

    it('defines session_resume with strategy enum', () => {
      const tool = sessionTools.find(t => t.name === 'session_resume');
      expect(tool).toBeDefined();
      const strategy = tool?.inputSchema.properties?.strategy;
      expect(strategy?.enum).toEqual(['full', 'smart-trim', 'summary-only', 'recent']);
    });

    it('defines session_export with format enum', () => {
      const tool = sessionTools.find(t => t.name === 'session_export');
      expect(tool).toBeDefined();
      const format = tool?.inputSchema.properties?.format;
      expect(format?.enum).toEqual(['markdown', 'json', 'html', 'txt']);
    });

    it('has 5 session tools', () => {
      expect(sessionTools.length).toBe(5);
    });
  });

  describe('fleetTools', () => {
    it('defines team_spawn with role enum', () => {
      const tool = fleetTools.find(t => t.name === 'team_spawn');
      expect(tool).toBeDefined();
      const role = tool?.inputSchema.properties?.role;
      expect(role?.enum).toContain('coordinator');
      expect(role?.enum).toContain('worker');
      expect(role?.enum).toContain('scout');
    });

    it('defines team_workers with status filter', () => {
      const tool = fleetTools.find(t => t.name === 'team_workers');
      expect(tool).toBeDefined();
      const status = tool?.inputSchema.properties?.status;
      expect(status?.enum).toContain('pending');
      expect(status?.enum).toContain('ready');
      expect(status?.enum).toContain('dismissed');
    });

    it('defines blackboard tools', () => {
      const post = fleetTools.find(t => t.name === 'blackboard_post');
      const read = fleetTools.find(t => t.name === 'blackboard_read');
      expect(post).toBeDefined();
      expect(read).toBeDefined();
    });

    it('defines checkpoint tools', () => {
      const create = fleetTools.find(t => t.name === 'checkpoint_create');
      const get = fleetTools.find(t => t.name === 'checkpoint_get');
      const list = fleetTools.find(t => t.name === 'checkpoint_list');
      expect(create).toBeDefined();
      expect(get).toBeDefined();
      expect(list).toBeDefined();
    });

    it('has 16 fleet tools', () => {
      expect(fleetTools.length).toBe(16);
    });
  });

  describe('safetyTools', () => {
    it('defines safety_check tool', () => {
      const tool = safetyTools.find(t => t.name === 'safety_check');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('command');
    });

    it('defines safety_status tool', () => {
      const tool = safetyTools.find(t => t.name === 'safety_status');
      expect(tool).toBeDefined();
    });

    it('defines safety_enable/disable tools', () => {
      const enable = safetyTools.find(t => t.name === 'safety_enable');
      const disable = safetyTools.find(t => t.name === 'safety_disable');
      expect(enable).toBeDefined();
      expect(disable).toBeDefined();
    });
  });

  describe('beadTools', () => {
    it('defines bead_create tool', () => {
      const tool = beadTools.find(t => t.name === 'bead_create');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('title');
    });

    it('defines bead_update with status enum', () => {
      const tool = beadTools.find(t => t.name === 'bead_update');
      expect(tool).toBeDefined();
      const status = tool?.inputSchema.properties?.status;
      expect(status?.enum).toContain('pending');
      expect(status?.enum).toContain('completed');
    });

    it('defines convoy tools', () => {
      const create = beadTools.find(t => t.name === 'convoy_create');
      const dispatch = beadTools.find(t => t.name === 'convoy_dispatch');
      expect(create).toBeDefined();
      expect(dispatch).toBeDefined();
    });

    it('has 5 bead tools', () => {
      expect(beadTools.length).toBe(5);
    });
  });

  describe('mailTools', () => {
    it('defines mail_send tool', () => {
      const tool = mailTools.find(t => t.name === 'mail_send');
      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain('to');
      expect(tool?.inputSchema.required).toContain('body');
    });

    it('defines mail_read tool', () => {
      const tool = mailTools.find(t => t.name === 'mail_read');
      expect(tool).toBeDefined();
    });

    it('has 2 mail tools', () => {
      expect(mailTools.length).toBe(2);
    });
  });
});

describe('MCP Server Integration', () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `cct-mcp-test-${Date.now()}.db`);
    resetDatabase();
    setDatabasePath(tempDbPath);
  });

  afterEach(() => {
    resetDatabase();
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('all tool names are unique', () => {
    const allTools = [
      ...sessionTools,
      ...fleetTools,
      ...safetyTools,
      ...beadTools,
      ...mailTools,
    ];

    const names = allTools.map(t => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('all tools have descriptions', () => {
    const allTools = [
      ...sessionTools,
      ...fleetTools,
      ...safetyTools,
      ...beadTools,
      ...mailTools,
    ];

    for (const tool of allTools) {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('all tools have valid input schemas', () => {
    const allTools = [
      ...sessionTools,
      ...fleetTools,
      ...safetyTools,
      ...beadTools,
      ...mailTools,
    ];

    for (const tool of allTools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('total tool count is 30+', () => {
    const allTools = [
      ...sessionTools,
      ...fleetTools,
      ...safetyTools,
      ...beadTools,
      ...mailTools,
    ];

    expect(allTools.length).toBeGreaterThanOrEqual(30);
  });
});
