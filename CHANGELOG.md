# Changelog

All notable changes to Claude Fleet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-24

### Added

- **Fleet Orchestration**
  - Swarm coordination with blackboard messaging pattern
  - Spawn queue with dependency management and depth limits
  - Checkpoint system for agent state persistence
  - Agent hierarchy tracking (depth levels)

- **CLI Tool (`fleet`)**
  - 25+ commands for server management
  - Health checks, metrics, worker management
  - Swarm creation and monitoring
  - Work item and batch management

- **MCP Integration**
  - 25+ MCP tools for Claude Code integration
  - Role-based permission system
  - Blackboard, checkpoint, and spawn queue tools
  - Team coordination tools

- **Worker Management**
  - Git worktree isolation per worker
  - Auto-restart with configurable health monitoring
  - NDJSON streaming for bidirectional communication
  - Session resumption support

- **Work Items & Batches**
  - Work item tracking with status management
  - Batch operations for bulk task dispatch
  - Event history for audit trails

- **Mail System**
  - Inter-agent messaging with read tracking
  - Handoff support for agent transitions

- **TLDR Integration**
  - Token-efficient code analysis storage
  - File summaries and dependency graphs
  - Codebase overview caching

- **Observability**
  - Prometheus metrics endpoint (`/metrics`)
  - JSON metrics endpoint (`/metrics/json`)
  - Real-time HTML dashboard
  - Comprehensive health checks

### Changed

- **Full TypeScript Rewrite**
  - Type-safe codebase with strict mode
  - Zod validation for all API inputs
  - Modular route architecture (12 route modules)
  - 116 unit tests with Vitest

- **Project Rename**
  - Renamed from `claude-code-collab` to `claude-fleet`
  - CLI renamed from `collab` to `fleet`
  - Updated environment variables (`CLAUDE_FLEET_*`)

- **Architecture Improvements**
  - Route handlers split into focused modules
  - Dependency injection for testability
  - Storage layer abstraction

### Security

- JWT authentication with configurable expiration
- Role-based access control (team-lead, worker, coordinator, monitor, merger)
- Input validation and sanitization via Zod schemas
- Rate limiting middleware

## [1.0.0] - 2025-01-08

### Added

- Initial release of Claude Code Collab
- **Local Collaboration Server**
  - Express + WebSocket server
  - SQLite persistence for messages, tasks, and agent state
  - Real-time message delivery via WebSocket
  - RESTful API for all operations

- **CLI Patcher** (`patch-cli.js`)
  - Enables hidden feature flags
  - Injects local collaboration client
  - Backup and unpatch support

- **Shell Scripts**
  - `run-lead.sh` - Run Claude Code as team lead
  - `run-worker.sh` - Run Claude Code as worker
  - Server health checks before launch

- **Database Schema**
  - `users` - Agent registration and metadata
  - `chats` - Conversation threads between agents
  - `messages` - Message history with status tracking
  - `unread` - Unread message counts per user per chat
  - `tasks` - Task delegation and tracking

- **API Endpoints**
  - `/auth` - Agent authentication/registration
  - `/chats` - Chat listing and creation
  - `/chats/:id/messages` - Message operations
  - `/teams/:name/broadcast` - Team-wide broadcasts
  - `/tasks` - Task CRUD operations
  - `/health` - Server health check
  - `/ws` - WebSocket endpoint

### Technical Details

- Node.js >= 18.0.0 required (native fetch)
- SQLite via better-sqlite3 for persistence
- WebSocket for real-time updates
- Graceful shutdown handling
