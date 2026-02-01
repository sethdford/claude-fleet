# Changelog

All notable changes to Claude Fleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2025-02-01

### Added
- **Rust-native acceleration layer** — 8 NAPI-RS crates (compound, search, lmsh, logstream, dag, swarm, metrics, ringbus) with automatic JS fallback for every path
- **Native Claude Code integration** — TeammateTool aliases, NativeTaskFile protocol, agent color assignment, env var signals
- **New API endpoints** — Search (`POST /search`, `GET /search/stats`), LMSH (`POST /lmsh/translate`, `GET/POST /lmsh/aliases`), DAG (`POST /dag/sort`, `/dag/cycles`, `/dag/critical-path`, `/dag/ready`)
- **New TypeScript wrappers** — SwarmAccelerator, NativeMetricsEngine, MessageBus (all with JS fallback)
- **Dashboard enhancements** — Connections view, Memory view, Hive visualization improvements with animations, gradients, and responsive UX
- **701 unit tests** (up from 372), 36 Rust tests across 8 crates
- **E2E native endpoint tests** — new test scripts for Rust-accelerated endpoints
- **MCP tools expanded to 98** (up from 93) including 5 native TeammateTool aliases

### Changed
- Package version aligned with Rust workspace (`3.0.0`)
- Architecture documentation updated with Rust acceleration layer
- Dashboard rebuilt with TypeScript + Vite, strict unused variable checks enabled
- Storage layer test coverage expanded to 84% line coverage

### Fixed
- 11 failing tests resolved across storage and worker modules
- Search crate test coverage added
- LMSH trigger detection fixed in native wrapper fallbacks
- Documentation: corrected stale test counts, tool counts, and legacy "collab" references
- `.env.example` port corrected from 3000 to 3847

## [2.2.0] - 2025-01-31

### Added
- **Policy & Safety Hooks** — regex-based operation guardrails with block/ask/allow decisions, violation audit trail, default seed rules
- **Session Lineage** — track worker context trim/continue chains with full lineage traversal and token accounting
- **Worker Session Search** — index session content into Knowledge FTS5, search with recency decay scoring
- **`fleet init` command** — one-command project setup: creates `.claude/CLAUDE.md` and installs MCP server in Claude Code
- **`fleet mcp-install` / `fleet mcp-uninstall`** — manage MCP server registration in Claude Code settings
- Enhanced MCP integration tests (28 tests with source-parsed tool registry verification)
- Phase 9 E2E coverage tests (43 assertions across all major features)

### Changed
- MCP server consolidated into `src/mcp/server.ts` (removed legacy `packages/mcp/`)
- **Dashboard refactored** to TypeScript + Vite build (replaced legacy JavaScript)
- Added new dashboard views: Hive visualization, Mail, Workflows
- Native coordination adapters added: task-router, task-sync, inbox-bridge, coordination-adapter
- Agent memory storage module for persistent agent state
- Documentation fully updated: ARCHITECTURE.md, DEPLOYMENT.md, README.md, CLAUDE.md
- All references to "Claude Code Collab" renamed to "Claude Fleet" throughout docs
- MCP tool count: 94 tools
- Test count: 372 tests

### Fixed
- MCP server `createServer()` now exported for testability
- MCP server guarded with `fileURLToPath` check to prevent auto-execution on import

## [2.1.0] - 2025-01-28

### Added
- **Autonomous Operations** — cron scheduling, webhook triggers, priority queues with retry logic
- **Eval Framework** — task-based evaluation with scoring, metrics tracking, and comparison
- **HITL (Human-in-the-Loop)** — pause workers for human approval with timeout and status tracking
- **Knowledge & RAG** — FTS5-powered knowledge base with chunked ingestion and recency decay scoring
- **Memory System** — persistent agent memory with namespace isolation
- **SSE Streaming** — server-sent events for real-time worker output streaming
- **Compound Dashboard** — Rust backend + TypeScript frontend for fleet visualization
- Phase 7 E2E autonomy tests

### Changed
- Storage interfaces extended with eval, HITL, knowledge, memory, and streaming support
- All storage adapters (SQLite, PostgreSQL, DynamoDB, Firestore, S3) updated with new interfaces

## [2.0.2] - 2025-01-24

### Added
- Shell completions for Bash, Zsh, and Fish
- Example workflow templates (feature-development, code-review, refactoring)
- GitHub issue and PR templates
- Premium tmux theme with fleet status integration
- Animated dashboard visualization on website
- Comprehensive CLI demo GIF
- CONTRIBUTING.md guidelines

### Changed
- Complete README rewrite with full CLI and MCP tool reference
- Updated website with professional SVG icons
- Migrated repository from claude-code-collab to claude-fleet

### Fixed
- CI/CD pipeline configuration
- Version mismatch in package.json

## [2.0.1] - 2025-01-23

### Added
- GitHub Pages documentation site
- Dashboard web interface with real-time updates
- Health monitoring and metrics collection

### Fixed
- Dashboard SVG icon rendering
- WebSocket connection stability

## [2.0.0] - 2025-01-22

### Added
- Complete TypeScript rewrite
- Worker orchestration system with 15+ specialized agent roles
- MCP (Model Context Protocol) server with 25+ tools
- Workflow engine with YAML-based definitions
- Swarm coordination for parallel task execution
- SQLite-based persistent storage
- Real-time dashboard with WebSocket updates
- Linear integration for issue tracking
- Launchd service management for macOS
- Health check endpoints
- Metrics collection system

### Changed
- CLI completely redesigned with intuitive command structure
- Configuration system moved to YAML
- Logging system improved with structured output

### Removed
- Legacy bash-based implementation
- Old configuration format

## [1.0.0] - 2025-01-15

### Added
- Initial release
- Basic worker spawning
- Simple task coordination
- CLI interface

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 3.0.0 | 2025-02-01 | 8 Rust crates, native Claude Code integration, 98 MCP tools, 701 tests |
| 2.2.0 | 2025-01-31 | Policy/safety hooks, session lineage, fleet init, doc cleanup |
| 2.1.0 | 2025-01-28 | Autonomous ops, eval, HITL, knowledge/RAG, memory, streaming |
| 2.0.2 | 2025-01-24 | Shell completions, workflows, tmux theme |
| 2.0.1 | 2025-01-23 | Dashboard, GitHub Pages |
| 2.0.0 | 2025-01-22 | TypeScript rewrite, MCP, workflows |
| 1.0.0 | 2025-01-15 | Initial release |
