# Claude Fleet - Development Guidelines

> Multi-agent orchestration server for Claude Code

## Quick Commands

```bash
npm run start          # Start server
npm run dev            # Start with watch mode
npm test               # Run unit tests
npm run e2e:all        # Run all E2E tests
npm run verify         # Full verification (typecheck + lint + test + e2e)
npm run audit          # Start continuous improvement loop
```

## Architecture

```
src/
├── index.ts           # Entry point only
├── server.ts          # HTTP/WebSocket server
├── types.ts           # ALL type definitions
├── cli.ts             # CLI commands
├── storage/           # Data layer (SQLite)
├── workers/           # Worker process management
├── routes/            # HTTP route handlers
├── validation/        # Zod schemas
├── metrics/           # Prometheus metrics
├── scheduler/         # Autonomous task scheduling
├── mcp/               # MCP server for Claude Code integration
└── middleware/        # Auth, validation middleware
```

## Layer Rules

| Layer | Can Import From |
|-------|-----------------|
| types.ts | Nothing |
| storage/ | types.ts |
| workers/ | storage/, types.ts |
| routes/ | workers/, storage/, validation/, types.ts |
| server.ts | All layers |

## Coding Standards

- **No `any` type** - use `unknown` with type guards
- **Types in types.ts** - don't scatter interfaces
- **Zod validation** - all API inputs validated
- **asyncHandler wrapper** - all async route handlers
- **Files under 500 lines** - split if larger

## Before Committing

```bash
npm run typecheck   # No TypeScript errors
npm run lint        # No ESLint errors
npm test            # All tests pass
```

---

## Continuous Improvement Loop

This project has a goal-oriented audit system. The audit loop keeps running until the codebase is production-ready.

### Quick Check

```bash
fleet audit    # Run local checks (typecheck, lint, tests, build)
```

### Full Audit Loop

```bash
npm run audit              # Run until complete
npm run audit:dry          # Dry run (no changes)
./scripts/audit-loop.sh    # Direct script access
```

### Completion Criteria

The loop continues until ALL criteria are met:

| Criterion | Check Command | Pass Condition |
|-----------|---------------|----------------|
| Code compiles | `npm run typecheck` | No errors |
| Code is clean | `npm run lint` | No warnings |
| Tests pass | `npm test` | 311/311 pass |
| Build works | `npm run build` | Compiles |
| E2E works | `npm run e2e:all` | All pass |
| No unsafe types | `grep ": any" src/` | No matches |
| No critical TODOs | `grep "TODO" src/` | None critical |

### How It Works

1. Script runs Claude with a goal: "Make this codebase production-ready"
2. Claude runs `fleet audit` and fixes failures
3. Claude runs E2E tests and fixes failures
4. Claude checks for TODOs, dead code, doc accuracy
5. When all criteria pass, Claude says "AUDIT COMPLETE"
6. Script verifies completion before exiting

**The loop will NOT terminate until all criteria are verified.**

---

## API Reference

### Public Endpoints (no auth)
- `GET /health` - Server health
- `GET /metrics` - Prometheus metrics
- `POST /auth` - Get JWT token

### Protected Endpoints (require JWT)
- All other endpoints require `Authorization: Bearer <token>`

### Team-Lead Only
- `GET /debug` - Debug info (server internals)
- `POST /orchestrate/spawn` - Spawn worker
- `POST /orchestrate/dismiss/:handle` - Dismiss worker
- `POST /teams/:name/broadcast` - Broadcast message

## Testing

| Suite | Command | Coverage |
|-------|---------|----------|
| Unit | `npm test` | 311 tests |
| E2E Core | `npm run e2e` | Auth, tasks, chat |
| E2E Phase 2-3 | `npm run e2e:phase2-3` | Work items, mail |
| E2E Security | `./scripts/e2e-security.sh` | Auth, RBAC |
| E2E Swarm | `./scripts/e2e-swarm-intelligence.sh` | 35 endpoints |
| E2E WebSocket | `./scripts/e2e-websocket.sh` | Real-time events |
| All E2E | `npm run e2e:all` | Everything |

## CLI Audit Command

The CLI includes a built-in audit command for quick codebase health checks:

```bash
fleet audit              # Run all checks
fleet audit --verbose    # Show details on failure
```

Runs these checks:
1. TypeScript compilation (`npm run typecheck`)
2. ESLint (`npm run lint`)
3. Unit tests (`npm test`)
4. Build (`npm run build`)

Example output:
```
╔════════════════════════════════════════════════════╗
║           CLAUDE FLEET AUDIT                       ║
╚════════════════════════════════════════════════════╝

  Checking TypeScript... ✓ pass
  Checking ESLint...     ✓ pass
  Running unit tests...  ✓ pass (311 tests)
  Checking build...      ✓ pass

────────────────────────────────────────────────────
  Results: 4 passed, 0 failed
────────────────────────────────────────────────────

✓ All checks passed - codebase is healthy
```
