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
  <a href="https://www.npmjs.com/package/claude-fleet"><img src="https://img.shields.io/npm/dm/claude-fleet" alt="NPM Downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript"></a>
</p>

<p align="center">
  <a href="https://sethdford.github.io/claude-fleet/">Website</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#key-features">Features</a> •
  <a href="#agent-roles">Agent Roles</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="https://github.com/sethdford/claude-fleet/issues">Issues</a>
</p>

---

Deploy specialized agent fleets across multiple repositories. Run iterative waves until objectives are achieved. TMUX or headless mode for full CI/CD integration.

```bash
# Launch a wave across multiple repos
$ claude-fleet wave --repos api,frontend,shared --objective "Add rate limiting"

Wave 1: Spawning scouts...
  ✓ Scout[api]      Mapped 47 endpoints
  ✓ Scout[frontend] Found 12 API calls
  ✓ Scout[shared]   Identified rate-limit types

Wave 2: Architect designing...
  ✓ Architect       Proposed middleware approach

Wave 3: Implementation...
  ✓ Worker[api]     Added middleware + config
  ✓ Kraken[api]     22 tests passing

Wave 4: Review...
  ✓ Critic          Approved. Creating PRs...

✓ Objective achieved in 4 waves. 3 PRs created.
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Wave Orchestration** | Phased execution with dependencies. Parallel within waves, sequential across phases. Iterate until objectives are met. |
| **7 Specialized Agents** | Lead, Scout, Kraken (TDD), Oracle, Critic, Architect, Worker - each with distinct capabilities. |
| **Multi-Repository Ops** | Parallel operations across repos. Auto-branching, auto-commit, auto-PR. Atomic commits with rollback. |
| **TMUX & Headless Mode** | Visual TMUX sessions or headless for CI/CD. Context monitoring with auto-rollover. |
| **Swarm Intelligence** | Blackboard-based coordination. Workers post discoveries, others subscribe. |
| **24/7 Autonomous Ops** | Cron scheduling, webhook triggers, alert-driven tasks. Priority queues with retry logic. |
| **E2E Audit Loops** | Continuous quality enforcement across your pipeline. Pattern detection and automatic retries. |

---

## Agent Roles

Claude Fleet provides 7 specialized agent roles:

| Role | Description | Capabilities |
|------|-------------|--------------|
| **Lead** | Orchestrates the fleet, delegates tasks, monitors progress | Can spawn other agents |
| **Worker** | General-purpose implementation, executes assigned tasks | Code changes, commits |
| **Scout** | Explores codebases, maps dependencies, gathers intel | Read-only exploration |
| **Kraken** | TDD specialist - red-green-refactor cycle | Test-first development |
| **Oracle** | Research and analysis, investigates patterns | Deep code analysis |
| **Critic** | Code review, quality gates, security checks | Review and approve |
| **Architect** | System design, API contracts, architecture decisions | Can spawn workers |

### Wave Flow Example

```
Wave 1 (parallel):  Scout ─────── Oracle
                         ╲       ╱
                          ╲     ╱
Wave 2 (sequential):       Architect
                              │
                              ▼
Wave 3 (parallel):    Worker ───── Kraken
                         ╲       ╱
                          ╲     ╱
Wave 4 (quality gate):     Critic
                              │
                              ▼
                    ┌─────────────────┐
                    │ Loop if needed  │
                    └─────────────────┘
```

---

## Quick Start

### Installation

```bash
# Install globally via NPM
npm install -g claude-fleet

# Start the fleet server
claude-fleet

# In another terminal, use the CLI
fleet health
```

### Your First Wave

```bash
# 1. Start the server
claude-fleet

# 2. Authenticate as team lead
fleet auth my-lead my-team team-lead
export FLEET_TOKEN="<token from above>"

# 3. Launch a wave
fleet wave --objective "Add input validation to all API endpoints"

# 4. Monitor progress
fleet workers --table

# 5. View the dashboard
open http://localhost:3847/dashboard/
```

### Multi-Repository Setup

```bash
# Configure repositories
fleet repos add api ./repos/api-service
fleet repos add frontend ./repos/web-client
fleet repos add shared ./repos/shared-types

# Launch cross-repo wave
fleet wave --repos api,frontend,shared \
  --objective "Implement rate limiting across all services"
```

---

## Wave Orchestration

Execute complex multi-phase workflows with automatic dependency management:

```typescript
import { WaveOrchestrator } from 'claude-fleet';

const orchestrator = new WaveOrchestrator({
  fleetName: 'feature-implementation',
  remote: true, // headless mode for CI/CD
});

// Wave 1: Discovery (parallel)
orchestrator.addWave({
  name: 'discovery',
  workers: [
    { handle: 'scout-1', role: 'scout', prompt: 'Map the authentication module' },
    { handle: 'oracle-1', role: 'oracle', prompt: 'Research OAuth2 patterns' },
  ],
});

// Wave 2: Design (depends on discovery)
orchestrator.addWave({
  name: 'design',
  workers: [
    { handle: 'architect-1', role: 'architect', prompt: 'Design the auth flow' },
  ],
  afterWaves: ['discovery'],
});

// Wave 3: Implementation (parallel, depends on design)
orchestrator.addWave({
  name: 'implementation',
  workers: [
    { handle: 'worker-1', role: 'worker', prompt: 'Implement auth middleware' },
    { handle: 'kraken-1', role: 'kraken', prompt: 'Write auth tests (TDD)' },
  ],
  afterWaves: ['design'],
});

// Wave 4: Review (depends on implementation)
orchestrator.addWave({
  name: 'review',
  workers: [
    { handle: 'critic-1', role: 'critic', prompt: 'Review implementation' },
  ],
  afterWaves: ['implementation'],
  continueOnFailure: false, // Quality gate
});

// Execute with iteration until success
const results = await orchestrator.execute({
  maxIterations: 3,
  successCriteria: (results) => results.every(r => r.success),
});
```

---

## Multi-Repository Operations

Coordinate work across multiple repositories with atomic commits:

```typescript
import { MultiRepoOrchestrator } from 'claude-fleet';

const multiRepo = new MultiRepoOrchestrator({
  fleetName: 'cross-repo-update',
  repositories: [
    { name: 'api', path: './repos/api', tags: ['backend'] },
    { name: 'frontend', path: './repos/web', tags: ['frontend'] },
    { name: 'shared', path: './repos/shared', tags: ['common'] },
  ],
  maxParallel: 3,
  remote: true,
});

// Run task across all repos
await multiRepo.runTask({
  name: 'update-dependencies',
  prompt: 'Update all npm dependencies to latest versions',
  createBranch: true,
  branchPattern: 'chore/update-deps-{{repo}}',
  autoCommit: true,
  createPR: true,
  prTitlePattern: 'chore({{repo}}): Update dependencies',
});
```

---

## CI/CD Integration

### Headless Mode

Run fleets in CI/CD pipelines without TMUX:

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

### Webhook Triggers

```bash
# Configure webhook endpoint
fleet webhook create --event pull_request --action "Run review wave"

# Fleet responds to GitHub webhooks automatically
```

---

## CLI Reference

### Core Commands

```bash
fleet health                    # Check server health
fleet metrics                   # Get server metrics
fleet auth <handle> <team> [type]  # Authenticate (team-lead|worker)
```

### Wave Operations

```bash
fleet wave --objective <text>   # Launch a new wave
fleet wave --repos a,b,c        # Target specific repos
fleet wave --roles scout,critic # Use specific roles
fleet wave-status               # Check wave progress
fleet wave-cancel <id>          # Cancel running wave
```

### Worker Management

```bash
fleet workers                   # List all workers
fleet workers --table           # Formatted table output
fleet spawn <handle> <prompt>   # Spawn individual worker
fleet dismiss <handle>          # Dismiss a worker
fleet output <handle>           # Get worker output
```

### Repository Management

```bash
fleet repos                     # List configured repos
fleet repos add <name> <path>   # Add repository
fleet repos remove <name>       # Remove repository
fleet repos sync                # Sync all repos
```

### Swarm Operations

```bash
fleet swarms                    # List all swarms
fleet blackboard <swarmId>      # Read blackboard messages
fleet blackboard-post <swarm> <sender> <type> <payload>
```

---

## Dashboard

Access the real-time dashboard at `http://localhost:3847/dashboard/`

Features:
- **Wave Progress** - Visual wave execution status
- **Workers** - Real-time worker status and output
- **Repositories** - Multi-repo status overview
- **Blackboard** - Swarm communication messages
- **Metrics** - Performance and health monitoring

---

## MCP Integration

Claude Fleet exposes 40+ tools via Model Context Protocol:

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

Key MCP tools:
- `wave_launch` - Start a new wave
- `wave_status` - Check wave progress
- `team_spawn` - Spawn individual workers
- `repo_add` - Add repository to fleet
- `blackboard_post` - Post to swarm blackboard

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `MAX_WORKERS` | `5` | Maximum concurrent workers |
| `ANTHROPIC_API_KEY` | - | API key for Claude |
| `FLEET_MODE` | `tmux` | Mode: `tmux` or `headless` |
| `STORAGE_BACKEND` | `sqlite` | Storage: `sqlite`, `postgresql` |

### Fleet Configuration File

```yaml
# fleet.config.yaml
fleet:
  name: my-project
  maxWorkers: 8
  mode: headless

repositories:
  - name: api
    path: ./services/api
    defaultBranch: main
  - name: frontend
    path: ./apps/web
    defaultBranch: main

waves:
  defaultRoles: [scout, worker, critic]
  maxIterations: 3

scheduling:
  enabled: true
  timezone: America/New_York
  tasks:
    - name: nightly-audit
      cron: "0 2 * * *"
      objective: "Run security audit"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Wave Orchestrator                           │
│              (phases, dependencies, iterations)                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Scout   │    │  Oracle  │    │ Architect│
    │ (explore)│    │(research)│    │ (design) │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
┌────────┐         ┌──────────┐         ┌──────────┐
│ Worker │         │  Kraken  │         │  Critic  │
│(implem)│         │  (TDD)   │         │ (review) │
└────────┘         └──────────┘         └──────────┘
         ╲               │               ╱
          ╲              ▼              ╱
           └──────► Blackboard ◄──────┘
                   (coordination)
```

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development
npm run dev          # Start with hot reload
npm test             # Run unit tests
npm run e2e          # Run E2E tests
npm run lint         # Lint code
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <a href="https://sethdford.github.io/claude-fleet/">Website</a> •
  <a href="https://www.npmjs.com/package/claude-fleet">NPM</a> •
  <a href="https://github.com/sethdford/claude-fleet">GitHub</a>
</p>
