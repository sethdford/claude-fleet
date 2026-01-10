# Team Collaboration Instructions

Add this section to your project's CLAUDE.md to enable consistent team coordination.

---

## Team Collaboration (Multi-Agent)

This project uses **Claude Code Collab** for multi-agent coordination. When working on complex tasks:

### Always Do

1. **Check team status** at session start:
   ```
   Use team_status to see who's online and what tasks are open
   ```

2. **Claim files** before editing to prevent conflicts:
   ```
   Use team_claim before modifying shared files
   ```

3. **Create tasks** for work that could be parallelized:
   ```
   Use team_assign to delegate subtasks to other agents
   ```

4. **Broadcast** important discoveries:
   ```
   Use team_broadcast to share findings with the team
   ```

### Task Dependencies

When creating related tasks, use `blockedBy` to enforce execution order:
- Research tasks have no blockers
- Design tasks are blocked by research
- Implementation tasks are blocked by design
- Testing tasks are blocked by implementation

### Wave Orchestration

For complex features requiring parallel work:
1. Use `team_spawn` to create worker agents
2. Use `team_send` to assign work to specific workers
3. Monitor with `team_workers`
4. Use `team_dismiss` when work is complete

Workers automatically output `<wave-complete>PROMISE</wave-complete>` when done.

---

## Copy This to Your CLAUDE.md

```markdown
## Team Collaboration

This project uses multi-agent coordination via Claude Code Collab.

### Quick Reference
| Action | Tool |
|--------|------|
| Check team status | `team_status` |
| See open tasks | `team_tasks` |
| Assign work | `team_assign` |
| Mark complete | `team_complete` |
| Claim a file | `team_claim` |
| Message everyone | `team_broadcast` |

### When to Use Team Tools
- **Starting a session**: Check `team_status` for context
- **Before editing shared files**: Use `team_claim`
- **Complex tasks**: Break into subtasks with `team_assign`
- **Found something important**: Use `team_broadcast`
- **Finished a task**: Use `team_complete`
```
