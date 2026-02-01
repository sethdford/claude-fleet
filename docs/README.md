# Claude Fleet Documentation

Welcome to the Claude Fleet documentation. This index provides an overview of all available documentation.

## Quick Links

| Document | Description |
|----------|-------------|
| [README](../README.md) | Project overview, quick start, and CLI reference |
| [CLAUDE.md](../CLAUDE.md) | Development guidelines and audit commands |
| [CONTRIBUTING](../CONTRIBUTING.md) | Contribution guidelines |
| [CHANGELOG](../CHANGELOG.md) | Version history and release notes |

## Core Documentation

### Architecture & Design

| Document | Description |
|----------|-------------|
| [ARCHITECTURE](ARCHITECTURE.md) | System architecture, components, data flow, and types |
| [ARCHITECTURE-DIAGRAMS](ARCHITECTURE-DIAGRAMS.md) | Visual diagrams of system components |

### API & Integration

| Document | Description |
|----------|-------------|
| [API Reference](api.md) | Complete REST API documentation |
| [OpenAPI Spec](openapi.yaml) | OpenAPI 3.0 specification |

### Guides

| Document | Description |
|----------|-------------|
| [DEPLOYMENT](DEPLOYMENT.md) | Production deployment, Docker, systemd, monitoring |
| [TMUX-AUTOMATION](TMUX-AUTOMATION.md) | Advanced tmux automation with wave orchestration |
| [NATIVE-INTEGRATION](NATIVE-INTEGRATION.md) | Integration with Claude Code's native multi-agent features |
| [FEATURE-FLAGS](FEATURE-FLAGS.md) | Environment variables, config options, and constants |

## Documentation by Topic

### Getting Started

1. Start with the [README](../README.md) for installation and quick start
2. Review [ARCHITECTURE](ARCHITECTURE.md) to understand the system
3. Check [API Reference](api.md) for endpoint details
4. See [DEPLOYMENT](DEPLOYMENT.md) for production setup

### For Developers

1. Read [CONTRIBUTING](../CONTRIBUTING.md) for development setup
2. Follow [CLAUDE.md](../CLAUDE.md) for coding standards
3. Use [FEATURE-FLAGS](FEATURE-FLAGS.md) for configuration reference
4. Check [ARCHITECTURE](ARCHITECTURE.md) for system internals

### For DevOps

1. [DEPLOYMENT](DEPLOYMENT.md) - Service management, Docker, monitoring
2. [FEATURE-FLAGS](FEATURE-FLAGS.md) - Environment variables and tuning
3. [API Reference](api.md) - Health checks and metrics endpoints

### Advanced Usage

1. [TMUX-AUTOMATION](TMUX-AUTOMATION.md) - Wave orchestration and multi-repo ops
2. [NATIVE-INTEGRATION](NATIVE-INTEGRATION.md) - Native Claude Code features
3. [FEATURE-FLAGS](FEATURE-FLAGS.md) - Spawn modes and capability matrix

## Interactive Documentation

- **Dashboard**: `http://localhost:3847/dashboard/` - Live fleet monitoring
- **Health**: `http://localhost:3847/health` - Server status
- **Metrics**: `http://localhost:3847/metrics` - Prometheus metrics

## External Resources

- [GitHub Repository](https://github.com/sethdford/claude-fleet)
- [npm Package](https://www.npmjs.com/package/claude-fleet)
- [Issue Tracker](https://github.com/sethdford/claude-fleet/issues)

---

## Documentation Standards

When updating documentation:

1. **Keep versions current** - Update test counts, tool counts, version numbers
2. **Cross-reference** - Link related documents
3. **Code examples** - Include working examples
4. **Tables** - Use tables for reference data
5. **Consistency** - Follow existing formatting patterns

Current stats:
- **Version**: 2.2.0
- **Unit Tests**: 372
- **MCP Tools**: 94
