# Native Integration with Claude Code Multi-Agent Primitives

> Reference documentation for Claude Code's built-in (feature-gated) multi-agent system and how Claude Fleet integrates with it.

## Overview

Claude Code v2.1.29+ contains a feature-gated multi-agent orchestration system:

- **TeammateTool** — 13 operations for team lifecycle management
- **SendMessageTool** — messaging between agents (write, broadcast, requestShutdown, etc.)
- **File-based coordination** at `~/.claude/teams/` and `~/.claude/tasks/`
- **Environment variables** for agent identity and team membership

These features are gated behind Statsig flags. Claude Fleet provides an intelligence layer that works both today (HTTP/MCP) and natively when these features ship publicly.

## TeammateTool Operations

### Team Lifecycle

| Operation | Description | File System Effect |
|-----------|-------------|-------------------|
| `spawnTeam` | Create a new team | Creates `~/.claude/teams/{name}/` |
| `discoverTeams` | List available teams | Reads `~/.claude/teams/` directory |
| `requestJoin` | Request to join a team | Writes join request file |
| `approveJoin` | Approve a join request | Updates membership file |
| `leaveTeam` | Leave a team | Removes agent from membership |

### Task Management

| Operation | Description | File System Effect |
|-----------|-------------|-------------------|
| `createTask` | Create a new task | Creates `~/.claude/tasks/{team}/{id}.json` |
| `listTasks` | List team tasks | Reads `~/.claude/tasks/{team}/` |
| `claimTask` | Take ownership of a task | Updates task JSON (`owner` field) |
| `updateTask` | Update task status | Updates task JSON (`status` field) |

### Communication

| Operation | Description | File System Effect |
|-----------|-------------|-------------------|
| `write` | Send a message to agent | Writes to `~/.claude/teams/{team}/messages/{session}/` |
| `broadcast` | Send to all team members | Writes to each agent's inbox |
| `requestShutdown` | Request graceful shutdown | Writes shutdown signal file |
| `approvePlan` | Approve an agent's plan | Writes approval to inbox |

## File System Structure

```
~/.claude/
├── teams/
│   └── {team-name}/
│       ├── config.json          # Team configuration
│       ├── members.json         # Active team members
│       └── messages/
│           └── {session-id}/
│               └── {timestamp}-{from}.json   # Individual messages
├── tasks/
│   └── {team-name}/
│       └── {task-id}.json       # Task definition + status
```

### Task File Format

```json
{
  "id": "1",
  "subject": "Implement auth module",
  "description": "Add JWT authentication to the API endpoints",
  "status": "in_progress",
  "owner": "agent-id",
  "blockedBy": ["2"],
  "createdAt": "2026-02-01T00:00:00Z",
  "updatedAt": "2026-02-01T01:00:00Z"
}
```

**Status values**: `pending` | `in_progress` | `completed`

### Message File Format

```json
{
  "from": "fleet-lead",
  "text": "Please review the auth implementation",
  "timestamp": "2026-02-01T00:00:00Z",
  "color": "blue"
}
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CLAUDE_CODE_TEAM_NAME` | Current team name | `alpha` |
| `CLAUDE_CODE_AGENT_ID` | Unique agent identifier | `agent-abc123` |
| `CLAUDE_CODE_AGENT_TYPE` | Agent role | `team-lead`, `worker` |
| `CLAUDE_CODE_AGENT_SWARMS` | Swarm membership | `swarm-1,swarm-2` |
| `CLAUDE_CODE_SPAWN_BACKEND` | Spawn backend type | `native`, `process` |

## Fleet Integration Architecture

### Status Mapping

Fleet uses slightly different status names than the native system:

| Fleet Status | Native Status | Direction |
|-------------|---------------|-----------|
| `open` | `pending` | Fleet → Native |
| `in_progress` | `in_progress` | Bidirectional |
| `resolved` | `completed` | Fleet → Native |
| `blocked` | (via `blockedBy`) | Fleet only |

### Spawn Modes

Fleet supports four spawn modes, one of which bridges to native:

| Mode | Description |
|------|-------------|
| `process` | Direct `child_process.spawn` with NDJSON streaming |
| `tmux` | Visible tmux pane via tmux adapter |
| `external` | Agent managed externally, registered with Fleet |
| `native` | Uses Claude Code's built-in Task tool with TeammateTool env vars |

### Coordination Adapters

Fleet uses an adapter pattern to abstract coordination:

- **HttpAdapter** — current default: HTTP API + WebSocket
- **NativeAdapter** — file-based inbox + task sync + native spawn
- **HybridAdapter** — auto-detects and routes to best available

## Feature Flags

Key Statsig flags to monitor (use `scripts/flag-monitor.sh`):

| Flag | Impact on Fleet |
|------|----------------|
| `tengu_teammate_tool` | Core TeammateTool availability |
| `tengu_task_tool` | Native task management |
| `tengu_session_memory` | May replace Fleet's SQLite memory layer |
| `tengu_remote_backend` | Alternative to Fleet's tmux/process spawning |
| `tengu_mcp_tool_search` | Affects Fleet MCP bridge discoverability |
| `tengu_agent_swarms` | Native swarm coordination |
| `tengu_scratch` | Working memory / scratchpad |

### Monitoring Flag Changes

```bash
# Compare current binary against baseline
./scripts/flag-monitor.sh

# Update baseline after Claude Code update
./scripts/flag-monitor.sh --update
```

## Testing

```bash
# Run native integration tests (requires claude-sneakpeek)
./scripts/e2e-native.sh

# Skip cleanup to inspect artifacts
./scripts/e2e-native.sh --skip-cleanup
```

### Installing claude-sneakpeek

```bash
npx @realmikekelly/claude-sneakpeek quick --name claudesp
```

This creates `~/.claude-sneakpeek/claudesp/` with a patched binary. Production Claude Code is untouched.

## Experimentation Guide

1. **Install sneakpeek** — isolated patched binary
2. **Run flag monitor** — understand what's available
3. **Exercise TeammateTool** — `claudesp` with team env vars
4. **Capture schemas** — JSON schemas for each operation
5. **Test file sync** — verify Fleet ↔ native task compatibility
6. **Build confidence** — native mode works alongside HTTP mode

---

## See Also

- [Documentation Index](README.md) - Full documentation overview
- [ARCHITECTURE](ARCHITECTURE.md) - System architecture
- [FEATURE-FLAGS](FEATURE-FLAGS.md) - Environment variables and configuration
- [TMUX-AUTOMATION](TMUX-AUTOMATION.md) - Tmux integration and wave orchestration
