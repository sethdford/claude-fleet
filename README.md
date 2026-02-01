# Claude Fleet

<p align="center">
  <img src="docs/images/logo.svg" alt="Claude Fleet Logo" width="120">
</p>

<p align="center">
  <strong>Waves of agents until the job is done</strong>
</p>

<p align="center">
  <a href="https://github.com/sethdford/claude-fleet/actions/workflows/ci.yml"><img src="https://github.com/sethdford/claude-fleet/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/claude-fleet"><img src="https://img.shields.io/npm/v/claude-fleet" alt="NPM Version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
</p>

---

Multi-agent orchestration server for Claude Code. Deploy specialized agent fleets, run iterative waves across repositories, and coordinate swarms via a REST API, CLI, and MCP integration. Supports TMUX visual mode or headless mode for CI/CD.

```bash
# Launch a wave across multiple repos
$ fleet wave --repos api,frontend,shared --objective "Add rate limiting"

Wave 1: Spawning scouts...
  Scout[api]      Mapped 47 endpoints
  Scout[frontend] Found 12 API calls
  Scout[shared]   Identified rate-limit types

Wave 2: Architect designing...
  Architect       Proposed middleware approach

Wave 3: Implementation...
  Worker[api]     Added middleware + config
  Kraken[api]     22 tests passing

Wave 4: Review...
  Critic          Approved. Creating PRs...

3 PRs created. Objective achieved in 4 waves.
```

---

## Architecture

```
src/
├── index.ts           # Entry point — starts CollabServer
├── server.ts          # Express HTTP + WebSocket server
├── types.ts           # All type definitions (centralized)
├── cli.ts             # CLI commands (fleet binary)
├── storage/           # Data layer (SQLite default, DynamoDB/Firestore/PostgreSQL optional)
├── workers/           # Worker process management & agent roles
├── routes/            # HTTP route handlers (core, waves, swarm, tasks, etc.)
├── validation/        # Zod schemas for all API inputs
├── metrics/           # Prometheus metrics collection
├── scheduler/         # Cron-based autonomous task scheduling
├── mcp/               # Model Context Protocol bridge (94 tools)
├── middleware/         # JWT auth, RBAC, validation middleware
└── integrations/      # Third-party integrations (Linear)
```

**Layer dependency rules:**

| Layer | Can Import From |
|-------|-----------------|
| `types.ts` | Nothing |
| `storage/` | `types.ts` |
| `workers/` | `storage/`, `types.ts` |
| `routes/` | `workers/`, `storage/`, `validation/`, `types.ts` |
| `server.ts` | All layers |

Additional directories:

```
crates/                # Rust crates (compound accumulator, search engine, lmsh)
packages/              # Monorepo packages (common, fleet, mcp, tmux, session, storage)
apps/cli/              # CLI app package
public/                # Dashboard UI & compound machine frontend
scripts/               # Build, E2E test, and deployment scripts
```

### Key Technologies

- **Express + WebSocket (ws)** — HTTP API and real-time events
- **better-sqlite3** — Default embedded database (with umzug migrations)
- **jsonwebtoken** — JWT authentication
- **Zod** — Input validation for all endpoints
- **prom-client** — Prometheus metrics
- **@modelcontextprotocol/sdk** — MCP server integration
- **Rust (NAPI)** — Optional native modules for compound accumulator and full-text search

---

## Agent Roles

7 specialized agent roles with role-based access control:

| Role | Purpose | Key Capability |
|------|---------|----------------|
| **Lead** | Orchestrates the fleet, delegates tasks | Can spawn other agents |
| **Worker** | General-purpose implementation | Code changes, commits |
| **Scout** | Explores codebases, maps dependencies | Read-only exploration |
| **Kraken** | TDD specialist — red-green-refactor | Test-first development |
| **Oracle** | Research and analysis | Deep code analysis |
| **Critic** | Code review, quality gates | Review and approve |
| **Architect** | System design, API contracts | Can spawn workers |

Each role has a custom system prompt, allowed tool list, maximum spawn depth, and default task priority.

### Wave Flow

```
Wave 1 (parallel):  Scout ─────── Oracle
                         \       /
                          \     /
Wave 2 (sequential):       Architect
                              |
Wave 3 (parallel):    Worker ───── Kraken
                         \       /
                          \     /
Wave 4 (quality gate):     Critic
                              |
                    [ Loop if needed ]
```

---

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- An `ANTHROPIC_API_KEY` for Claude API access

### Installation

```bash
npm install -g claude-fleet
```

### Start the Server

```bash
# Set your API key (required for spawning agents)
export ANTHROPIC_API_KEY="sk-ant-..."

# Start the fleet server (default port 3847)
claude-fleet

# Or in development mode with hot reload
npm run dev
```

### Authenticate and Use

```bash
# Register as team lead
fleet auth my-lead my-team team-lead
export FLEET_TOKEN="<token>"

# Launch a wave
fleet wave --objective "Add input validation to all API endpoints"

# Monitor workers
fleet workers --table

# View the dashboard
open http://localhost:3847/dashboard/
```

### Multi-Repository Setup

```bash
fleet repos add api ./repos/api-service
fleet repos add frontend ./repos/web-client
fleet repos add shared ./repos/shared-types

fleet wave --repos api,frontend,shared \
  --objective "Implement rate limiting across all services"
```

---

## API Overview

### Public Endpoints (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health check |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/auth` | Get JWT token |

### Core Endpoints (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tasks` | Create task |
| `GET` | `/tasks/:id` | Get task details |
| `PUT` | `/tasks/:id` | Update task status |
| `POST` | `/orchestrate/spawn` | Spawn a worker |
| `POST` | `/orchestrate/dismiss/:handle` | Dismiss a worker |
| `GET` | `/orchestrate/workers` | List all workers |
| `POST` | `/waves/execute` | Launch a wave |
| `GET` | `/waves/:id` | Wave status |
| `POST` | `/waves/:id/cancel` | Cancel a wave |
| `POST` | `/multi-repo/execute` | Multi-repo wave |
| `POST` | `/swarms` | Create swarm |
| `POST` | `/swarms/:id/blackboard` | Post to blackboard |
| `GET` | `/swarms/:id/blackboard` | Read blackboard |
| `POST` | `/teams/:name/broadcast` | Broadcast to team (lead only) |
| `POST` | `/memory/store` | Store agent memory |
| `GET` | `/memory/recall/:agentId/:key` | Recall a memory |
| `POST` | `/memory/search` | Search memories (FTS5) |
| `GET` | `/memory/:agentId` | List agent memories |
| `POST` | `/routing/classify` | Classify task complexity |
| `POST` | `/dag/sort` | Topological sort of tasks |
| `POST` | `/dag/ready` | Find unblocked tasks |
| `POST` | `/lmsh/translate` | Natural language to shell |
| `POST` | `/search` | Full-text code search |

See `docs/api.md` for the complete API reference.

---

## CLI Reference

```bash
# Server
fleet health                        # Check server health
fleet metrics                       # Get Prometheus metrics

# Authentication
fleet auth <handle> <team> [type]   # Register (team-lead|worker)

# Workers
fleet workers                       # List workers
fleet workers --table               # Table output
fleet spawn <handle> <prompt>       # Spawn worker
fleet dismiss <handle>              # Dismiss worker
fleet output <handle>               # Get worker output

# Waves
fleet wave --objective <text>       # Launch wave
fleet wave --repos a,b,c            # Target repos
fleet wave --roles scout,critic     # Specific roles
fleet wave-status [id]              # Check progress
fleet wave-cancel <id>              # Cancel wave

# Repositories
fleet repos                         # List repos
fleet repos add <name> <path>       # Add repo
fleet repos remove <name>           # Remove repo
fleet repos sync                    # Sync all

# Swarm
fleet swarms                        # List swarms
fleet blackboard <swarmId>          # Read blackboard
fleet blackboard-post <swarm> <sender> <type> <payload>

# Templates
fleet templates                     # List templates
fleet templates use <name>          # Apply template

# Agent Memory
fleet memory-store <agent> <key> <value> [--type <type>] [--tags <t1,t2>]
fleet memory-recall <agent> <key>   # Recall a memory
fleet memory-search <agent> <query> [--type <type>] [--limit <n>]
fleet memory-list <agent> [--limit <n>]

# Task Routing
fleet route <subject> [description] # Classify task complexity

# DAG Operations
fleet dag-sort <team>               # Topological sort of tasks
fleet dag-cycles <team>             # Check for dependency cycles
fleet dag-critical-path <team>      # Find critical path
fleet dag-ready <team>              # Find unblocked tasks

# Natural Language Shell
fleet lmsh <natural-language>       # Translate to shell command

# Search
fleet search <query> [--limit <n>]  # Full-text code search

# Audit
fleet audit                         # Run all quality checks
fleet audit --verbose               # Verbose output
```

---

## MCP Integration

Claude Fleet exposes 93 tools via Model Context Protocol for direct Claude Code integration:

```json
{
  "mcpServers": {
    "claude-fleet": {
      "command": "npx",
      "args": ["claude-fleet", "--mcp"],
      "env": {
        "CLAUDE_FLEET_URL": "http://localhost:3847",
        "FLEET_TOKEN": "your-jwt-token"
      }
    }
  }
}
```

Key MCP tools: `wave_launch`, `wave_status`, `team_spawn`, `repo_add`, `blackboard_post`.

---

## Swarm Intelligence

Agents coordinate through a blackboard pattern:

- **Blackboard** — Shared message board with typed entries (directive, report, query, discovery)
- **Pheromone trails** — Path optimization markers left by agents
- **Beliefs** — Agent knowledge base entries
- **Credits** — Agent reward and resource system
- **Priority routing** — Critical, high, normal, low message priorities
- **Read tracking** — Know which agents have seen which messages

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Environment |
| `JWT_SECRET` | auto-generated | **Required in production** |
| `MAX_WORKERS` | `5` | Max concurrent workers |
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `FLEET_MODE` | `tmux` | `tmux` or `headless` |
| `STORAGE_BACKEND` | `sqlite` | `sqlite`, `dynamodb`, `firestore`, `postgresql` |
| `DB_PATH` | — | SQLite database location |

### Storage Backends

The storage factory (`src/storage/factory.ts`) supports pluggable backends:

- **SQLite** (default) — Embedded, zero-config
- **DynamoDB** — AWS serverless (optional dependency)
- **Firestore** — Google Cloud (optional dependency)
- **PostgreSQL** — Traditional SQL (optional dependency)
- **S3** — Blob storage for large artifacts (optional dependency)

---

## Building & Testing

### Build

```bash
npm run build         # Compile TypeScript to dist/
npm run typecheck     # Type check only (no emit)
npm run lint          # ESLint
npm run lint:fix      # Auto-fix lint issues
```

### Test

```bash
npm test              # Run unit tests (Vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (60% threshold)
```

### E2E Tests

```bash
npm run e2e           # Core (auth, tasks, chat)
npm run e2e:phase2-3  # Work items, mail
npm run e2e:cli       # CLI commands
npm run e2e:dashboard # Dashboard UI
npm run e2e:compound  # Compound machine
npm run e2e:all       # All suites
```

### Full Verification

```bash
npm run verify        # typecheck + lint + test + e2e:all
```

### Audit Loop

Continuous improvement loop that runs until the codebase passes all quality gates:

```bash
npm run audit         # Run until all checks pass
npm run audit:dry     # Dry run (no changes)
```

---

## CI/CD (Headless Mode)

```yaml
# .github/workflows/fleet-audit.yml
name: Fleet Audit
on: [push]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Claude Fleet
        run: npm install -g claude-fleet
      - name: Run Audit Wave
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude-fleet --headless wave \
            --objective "Audit codebase for security vulnerabilities" \
            --roles scout,oracle,critic \
            --max-iterations 2
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
npm run dev       # Start with hot reload
npm test          # Unit tests
npm run e2e       # E2E tests
npm run lint      # Lint
```

## License

MIT — see [LICENSE](LICENSE).
