# Claude Fleet

[![NPM Version](https://img.shields.io/npm/v/claude-fleet)](https://www.npmjs.com/package/claude-fleet)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

**Multi-agent fleet orchestration for Claude Code.**

Claude Fleet enables team collaboration, task management, and worker orchestration across multiple Claude Code instances. Spawn agent swarms, coordinate work via blackboard messaging, and manage distributed AI workflows.

![Demo](demo.gif)

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
fleet health                      # Server health check
fleet metrics                     # Prometheus metrics (JSON)
fleet workers                     # List active workers
fleet spawn <handle> <prompt>     # Spawn a worker agent
fleet dismiss <handle>            # Stop a worker
fleet send <handle> <message>     # Send message to worker
fleet swarms                      # List all swarms
fleet swarm-create <name> <max>   # Create a swarm
fleet teams <team>                # List team agents
fleet tasks <team>                # List team tasks
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
npm run e2e

# Type checking
npm run typecheck

# Linting
npm run lint
```

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
