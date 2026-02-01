# Changelog

All notable changes to Claude Fleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
| 2.2.0 | 2025-01-31 | Policy/safety hooks, session lineage, fleet init, doc cleanup |
| 2.1.0 | 2025-01-28 | Autonomous ops, eval, HITL, knowledge/RAG, memory, streaming |
| 2.0.2 | 2025-01-24 | Shell completions, workflows, tmux theme |
| 2.0.1 | 2025-01-23 | Dashboard, GitHub Pages |
| 2.0.0 | 2025-01-22 | TypeScript rewrite, MCP, workflows |
| 1.0.0 | 2025-01-15 | Initial release |
