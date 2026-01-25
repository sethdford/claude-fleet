# Changelog

All notable changes to Claude Fleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
| 2.0.2 | 2025-01-24 | Shell completions, workflows, tmux theme |
| 2.0.1 | 2025-01-23 | Dashboard, GitHub Pages |
| 2.0.0 | 2025-01-22 | TypeScript rewrite, MCP, workflows |
| 1.0.0 | 2025-01-15 | Initial release |
