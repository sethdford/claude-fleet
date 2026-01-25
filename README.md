# Claude Fleet

<p align="center">
  <img src="docs/images/logo.svg" alt="Claude Fleet Logo" width="120">
</p>

<p align="center">
  <strong>The infrastructure for AI agent fleets</strong>
</p>

<p align="center">
  <a href="https://github.com/sethdford/claude-fleet/actions/workflows/ci.yml"><img src="https://github.com/sethdford/claude-fleet/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/claude-fleet"><img src="https://img.shields.io/npm/v/claude-fleet" alt="NPM Version"></a>
  <a href="https://www.npmjs.com/package/claude-fleet"><img src="https://img.shields.io/npm/dm/claude-fleet" alt="NPM Downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="https://sethdford.github.io/claude-fleet/">Documentation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="https://github.com/sethdford/claude-fleet/issues">Issues</a>
</p>

---

Orchestrate multiple Claude Code instances with intelligent coordination, swarm intelligence, and real-time collaboration. Build production-grade multi-agent systems.

<p align="center">
  <img src="demo.gif" alt="Claude Fleet Dashboard" width="800">
</p>

---

## Features

- **Fleet Orchestration** - Spawn and manage multiple Claude Code worker agents
- **Swarm Coordination** - Blackboard messaging pattern for agent communication
- **Task Management** - Create, assign, and track tasks across agents
- **Git Worktrees** - Isolated workspaces for each agent to prevent conflicts
- **MCP Integration** - 25+ tools accessible via Model Context Protocol
- **Real-time Updates** - WebSocket notifications for live collaboration
- **JWT Authentication** - Secure role-based access control
- **Prometheus Metrics** - Production-ready observability

---

## Quick Start

### Option 1: NPM (Recommended)

```bash
# Install globally
npm install -g claude-fleet

# Start the server
claude-fleet

# Use the CLI in another terminal
fleet health
fleet workers
```

### Option 2: From Source

```bash
git clone https://github.com/sethdford/claude-fleet.git
cd claude-fleet
npm install
npm run build
./start.sh
```

---

## Usage

### Starting the Server

```bash
# Foreground (see logs)
./start.sh

# Background daemon
./start.sh --background

# Check status
./start.sh --status

# Stop daemon
./start.sh --stop
```

### CLI Commands

```bash
# Core Commands
fleet health                      # Server health check
fleet metrics                     # Prometheus metrics (JSON)
fleet audit                       # Run codebase audit (typecheck, lint, tests, build)

# Worker Management
fleet workers                     # List active workers
fleet spawn <handle> <prompt>     # Spawn a worker agent
fleet dismiss <handle>            # Stop a worker
fleet send <handle> <message>     # Send message to worker

# Team & Task Management
fleet swarms                      # List all swarms
fleet swarm-create <name> <max>   # Create a swarm
fleet teams <team>                # List team agents
fleet tasks <team>                # List team tasks

# Workflow Management
fleet workflows                   # List workflows
fleet workflow-start <id>         # Start workflow execution
fleet executions                  # List executions
```

### MCP Integration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "fleet": {
      "command": "npx",
      "args": ["claude-fleet-mcp"],
      "env": {
        "CLAUDE_FLEET_URL": "http://localhost:3847",
        "CLAUDE_FLEET_TEAM": "my-team",
        "CLAUDE_CODE_AGENT_NAME": "my-agent",
        "CLAUDE_CODE_AGENT_TYPE": "team-lead"
      }
    }
  }
}
```

Then use MCP tools in Claude Code:
- `team_status` - See team members
- `team_spawn` - Spawn worker agents
- `team_assign` - Assign tasks
- `team_broadcast` - Send team-wide messages
- `blackboard_post` - Post to swarm blackboard
- `checkpoint_create` - Save agent state

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Fleet Server                       │
│                    (localhost:3847)                          │
├─────────────────────────────────────────────────────────────┤
│  HTTP API          WebSocket         Worker Manager          │
│  ─────────         ─────────         ──────────────          │
│  • Auth            • Real-time       • Spawn/dismiss         │
│  • Tasks           • Subscriptions   • Health monitoring     │
│  • Teams           • Broadcasts      • Auto-restart          │
│  • Swarms                            • Git worktrees         │
├─────────────────────────────────────────────────────────────┤
│  Storage (SQLite)                                            │
│  ─────────────────                                           │
│  • Agents, Tasks, Messages, Checkpoints, Blackboard          │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ Claude  │         │ Claude  │         │ Claude  │
   │ Code    │         │ Code    │         │ Code    │
   │ (lead)  │         │ (worker)│         │ (worker)│
   └─────────┘         └─────────┘         └─────────┘
```

---

## Agent Roles

| Role | Permissions |
|------|-------------|
| **team-lead** | Spawn workers, assign tasks, broadcast, merge code |
| **worker** | Claim tasks, complete work, send messages |
| **coordinator** | Full orchestration control |
| **monitor** | Read-only access, alerts |
| **merger** | Merge branches, push code |

---

## API Endpoints

### Core
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health |
| GET | `/metrics` | Prometheus metrics |
| POST | `/auth` | Authenticate agent |

### Teams & Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/teams/:team/agents` | List team agents |
| GET | `/teams/:team/tasks` | List team tasks |
| POST | `/tasks` | Create task |
| PATCH | `/tasks/:id` | Update task |

### Orchestration
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/orchestrate/spawn` | Spawn worker |
| POST | `/orchestrate/dismiss/:handle` | Dismiss worker |
| GET | `/orchestrate/workers` | List workers |

### Fleet Coordination
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/swarms` | Create swarm |
| GET | `/swarms` | List swarms |
| POST | `/blackboard` | Post message |
| GET | `/blackboard/:swarmId` | Read messages |
| POST | `/checkpoints` | Create checkpoint |

See [API Documentation](docs/api.md) for complete reference.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | Server port |
| `STORAGE_BACKEND` | `sqlite` | Storage backend (see below) |
| `DB_PATH` | `./fleet.db` | SQLite database path |
| `JWT_SECRET` | (random) | JWT signing secret |
| `JWT_EXPIRES_IN` | `24h` | Token expiration |
| `MAX_WORKERS` | `5` | Maximum concurrent workers |

### Storage Backends

Claude Fleet supports multiple storage backends for different deployment scenarios:

| Backend | Best For | Required Package |
|---------|----------|------------------|
| `sqlite` | Local development | Built-in |
| `dynamodb` | AWS serverless | `@aws-sdk/client-dynamodb` |
| `s3` | Archival/infrequent access | `@aws-sdk/client-s3` |
| `firestore` | Google Cloud | `@google-cloud/firestore` |
| `postgresql` | Production deployments | `pg` |

**SQLite (Default)**
```bash
STORAGE_BACKEND=sqlite
DB_PATH=./fleet.db
```

**DynamoDB**
```bash
STORAGE_BACKEND=dynamodb
AWS_REGION=us-east-1
DYNAMODB_TABLE_PREFIX=fleet_
# Optional: DYNAMODB_ENDPOINT for local development
```

**S3**
```bash
STORAGE_BACKEND=s3
S3_BUCKET=my-fleet-bucket
AWS_REGION=us-east-1
S3_PREFIX=data/
```

**Firestore**
```bash
STORAGE_BACKEND=firestore
GOOGLE_CLOUD_PROJECT=my-project
# Optional: GOOGLE_APPLICATION_CREDENTIALS for service account
```

**PostgreSQL**
```bash
STORAGE_BACKEND=postgresql
DATABASE_URL=postgres://user:pass@host:5432/fleet
POSTGRESQL_SCHEMA=public
POSTGRESQL_POOL_SIZE=10
```

### Agent Environment

| Variable | Description |
|----------|-------------|
| `CLAUDE_FLEET_URL` | Server URL |
| `CLAUDE_FLEET_TEAM` | Team name |
| `CLAUDE_CODE_AGENT_NAME` | Agent handle |
| `CLAUDE_CODE_AGENT_TYPE` | `team-lead` or `worker` |

---

## Development

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Run tests
npm test

# Run E2E tests
npm run e2e            # Core E2E tests
npm run e2e:cli        # CLI E2E tests (64 commands)
npm run e2e:all        # All E2E tests

# Type checking
npm run typecheck

# Linting
npm run lint

# Full verification
npm run verify         # typecheck + lint + test + e2e
```

### Audit Objective

Claude Fleet includes a goal-oriented audit system with wave-based task tracking:

```bash
# Quick codebase health check
fleet audit

# Full audit objective (loops through waves until complete)
fleet audit-loop [--dry-run] [--max N]
```

Each **Loop** deploys **Waves** of work:
- **Wave 1: Reconnaissance** - Run checks, discover issues, create tasks
- **Wave 2: Fleet Deployment** - Work through fix tasks
- **Wave 3: Verification** - Re-run checks, confirm fixes

**Exit Criteria** (all must pass to complete):
1. `fleet audit` passes (typecheck, lint, tests, build)
2. `npm run e2e:all` passes
3. No critical TODOs remain
4. All tasks complete

When everything passes: **"OBJECTIVE COMPLETE - Escaped the maze!"**

See [CLAUDE.md](CLAUDE.md) for detailed development guidelines.

---

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md) - System design and components
- [API Reference](docs/api.md) - Complete API documentation
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [Contributing](CONTRIBUTING.md) - How to contribute

---

## License

MIT - see [LICENSE](LICENSE)

---

## Credits

Created by [Seth Ford](https://github.com/sethdford)

Built for orchestrating [Claude Code](https://claude.ai/code) agents.
