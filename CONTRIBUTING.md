# Contributing to Claude Fleet

Thank you for your interest in contributing to Claude Fleet! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something cool together!

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Git
- Claude API key (for testing)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/claude-fleet.git
   cd claude-fleet
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/sethdford/claude-fleet.git
   ```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Build the Project

```bash
npm run build
```

### Link for Local Development

```bash
npm link
```

This allows you to run `fleet` commands using your local development version.

### Environment Setup

Create a `.env` file for local testing:

```bash
ANTHROPIC_API_KEY=your_api_key_here
FLEET_LOG_LEVEL=debug
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-new-command` - New features
- `fix/worker-crash-on-startup` - Bug fixes
- `docs/update-api-reference` - Documentation
- `refactor/simplify-worker-manager` - Code refactoring

### Commit Messages

Write clear, concise commit messages:

```
Add workflow pause/resume functionality

- Implement pause command for active workflows
- Add resume command with state restoration
- Update CLI help text
- Add tests for pause/resume cycle
```

## Pull Request Process

1. **Update your fork**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature
   ```

3. **Make your changes** and commit them

4. **Run tests**:
   ```bash
   npm test
   npm run e2e
   ```

5. **Run linting and type checking**:
   ```bash
   npm run lint
   npm run typecheck
   ```

6. **Push and create PR**:
   ```bash
   git push origin feature/your-feature
   ```
   Then open a pull request on GitHub.

### PR Requirements

- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] Linting passes
- [ ] Documentation updated if needed
- [ ] CHANGELOG updated for notable changes

## Coding Standards

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer `interface` over `type` for object shapes
- Use explicit return types for public functions
- Avoid `any` - use `unknown` and type guards instead

### Code Style

We use ESLint and Prettier. Run before committing:

```bash
npm run lint
npm run format
```

### File Organization

```
src/
├── index.ts          # CLI entry point
├── server.ts         # HTTP server
├── types.ts          # Type definitions
├── storage/          # Data persistence
├── workers/          # Worker management
├── mcp/              # MCP server implementation
└── utils/            # Utility functions
```

### Naming Conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

## Testing

### Running Tests

```bash
# Unit tests
npm test

# End-to-end tests
npm run e2e

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Writing Tests

- Place tests in `tests/` directory
- Name test files `*.test.ts`
- Use descriptive test names
- Test both happy paths and error cases

Example:

```typescript
describe('WorkerManager', () => {
  describe('spawnWorker', () => {
    it('should spawn a worker with valid configuration', async () => {
      // Test implementation
    });

    it('should throw error when max workers exceeded', async () => {
      // Test implementation
    });
  });
});
```

## Documentation

### Code Comments

- Add JSDoc comments for public APIs
- Explain "why" not "what" in inline comments
- Keep comments up to date with code changes

### README Updates

Update README.md when:
- Adding new commands
- Changing configuration options
- Adding new features

### Examples

Add examples in `examples/` for:
- New workflow types
- Complex configurations
- Integration patterns

## Architecture Decisions

When making significant architectural changes:

1. Open an issue first to discuss
2. Document the decision in the PR
3. Update architecture docs if needed

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Be as detailed as possible in bug reports

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Claude Fleet!
