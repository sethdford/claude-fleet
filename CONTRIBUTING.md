# Contributing to Claude Fleet

Thanks for your interest in contributing! Claude Fleet enables multi-agent orchestration for Claude Code.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/claude-fleet.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Setup

```bash
# Install dependencies
npm install

# Start the server in dev mode (hot reload)
npm run dev

# Run tests
npm test

# Run E2E tests
npm run e2e

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix  # Auto-fix issues
```

## Project Structure

```
claude-fleet/
├── src/
│   ├── index.ts           # Entry point
│   ├── server.ts          # Main server class
│   ├── cli.ts             # CLI tool
│   ├── types.ts           # TypeScript types
│   ├── routes/            # Route handlers (modular)
│   │   ├── core.ts        # Health, auth, metrics
│   │   ├── chats.ts       # Chat/message routes
│   │   ├── tasks.ts       # Task routes
│   │   ├── orchestrate.ts # Worker routes
│   │   ├── fleet.ts       # Swarm/blackboard routes
│   │   └── ...
│   ├── storage/           # Database layer
│   │   ├── sqlite.ts      # Main SQLite storage
│   │   ├── blackboard.ts  # Blackboard messages
│   │   ├── checkpoint.ts  # Agent checkpoints
│   │   └── ...
│   ├── workers/           # Worker management
│   │   ├── manager.ts     # Worker lifecycle
│   │   ├── worktree.ts    # Git worktree
│   │   └── spawn-controller.ts
│   ├── middleware/        # Express middleware
│   ├── mcp/               # MCP server
│   └── validation/        # Zod schemas
├── tests/                 # Unit tests
├── scripts/               # E2E test scripts
├── docs/                  # Documentation
└── public/                # Dashboard
```

## How to Contribute

### Reporting Bugs

- Check existing issues first
- Include steps to reproduce
- Include Node.js version and OS
- Include relevant logs

### Suggesting Features

- Open an issue describing the feature
- Explain the use case
- Be open to discussion

### Submitting Pull Requests

1. **Keep PRs focused** - One feature or fix per PR
2. **Update documentation** - If you change behavior
3. **Add tests** - For new features or bug fixes
4. **Follow code style** - Match existing patterns
5. **Write clear commit messages**

## Code Style

- TypeScript with strict mode
- 2-space indentation
- Single quotes for strings
- Zod for runtime validation
- JSDoc comments for public functions

### Example

```typescript
/**
 * Creates a new task and broadcasts to the team
 */
export function createTaskHandler(deps: RouteDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createTaskSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }
    // ...
  };
}
```

## Testing

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:coverage

# E2E tests
npm run e2e

# All E2E tests
npm run e2e:all
```

### Writing Tests

- Use Vitest for unit tests
- Place tests in `tests/` or alongside source (`*.test.ts`)
- E2E tests go in `scripts/`

## Areas for Contribution

### High Priority
- Performance optimization for large swarms
- Better error messages and recovery
- Dashboard improvements

### Nice to Have
- Additional MCP tools
- Metrics visualization
- Plugin system

### Documentation
- More usage examples
- Tutorial videos
- Architecture diagrams

## Commit Messages

Follow conventional commits:

```
feat: add swarm priority support
fix: resolve worktree cleanup race condition
docs: update API reference
test: add checkpoint storage tests
refactor: extract route handlers
```

## Questions?

Open an issue with the `question` label.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
