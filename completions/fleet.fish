# Claude Fleet CLI - Fish Completion
# Install: cp completions/fleet.fish ~/.config/fish/completions/

# Disable file completion by default
complete -c fleet -f

# Main commands
complete -c fleet -n "__fish_use_subcommand" -a "health" -d "Check server health"
complete -c fleet -n "__fish_use_subcommand" -a "metrics" -d "Get server metrics"
complete -c fleet -n "__fish_use_subcommand" -a "debug" -d "Get debug information"
complete -c fleet -n "__fish_use_subcommand" -a "auth" -d "Authenticate with server"
complete -c fleet -n "__fish_use_subcommand" -a "teams" -d "List team agents"
complete -c fleet -n "__fish_use_subcommand" -a "tasks" -d "List team tasks"
complete -c fleet -n "__fish_use_subcommand" -a "workers" -d "List all workers"
complete -c fleet -n "__fish_use_subcommand" -a "spawn" -d "Spawn a new worker"
complete -c fleet -n "__fish_use_subcommand" -a "dismiss" -d "Dismiss a worker"
complete -c fleet -n "__fish_use_subcommand" -a "send" -d "Send message to worker"
complete -c fleet -n "__fish_use_subcommand" -a "output" -d "Get worker output"
complete -c fleet -n "__fish_use_subcommand" -a "worktree-status" -d "Get worktree git status"
complete -c fleet -n "__fish_use_subcommand" -a "worktree-commit" -d "Commit in worktree"
complete -c fleet -n "__fish_use_subcommand" -a "worktree-push" -d "Push worktree branch"
complete -c fleet -n "__fish_use_subcommand" -a "worktree-pr" -d "Create PR from worktree"
complete -c fleet -n "__fish_use_subcommand" -a "task" -d "Get task details"
complete -c fleet -n "__fish_use_subcommand" -a "task-create" -d "Create a new task"
complete -c fleet -n "__fish_use_subcommand" -a "task-update" -d "Update task status"
complete -c fleet -n "__fish_use_subcommand" -a "workitems" -d "List work items"
complete -c fleet -n "__fish_use_subcommand" -a "workitem-create" -d "Create work item"
complete -c fleet -n "__fish_use_subcommand" -a "workitem-update" -d "Update work item"
complete -c fleet -n "__fish_use_subcommand" -a "batches" -d "List all batches"
complete -c fleet -n "__fish_use_subcommand" -a "batch-create" -d "Create a batch"
complete -c fleet -n "__fish_use_subcommand" -a "batch-dispatch" -d "Dispatch batch"
complete -c fleet -n "__fish_use_subcommand" -a "mail" -d "Get unread mail"
complete -c fleet -n "__fish_use_subcommand" -a "mail-send" -d "Send mail"
complete -c fleet -n "__fish_use_subcommand" -a "handoffs" -d "List handoffs"
complete -c fleet -n "__fish_use_subcommand" -a "handoff-create" -d "Create handoff"
complete -c fleet -n "__fish_use_subcommand" -a "checkpoints" -d "List checkpoints"
complete -c fleet -n "__fish_use_subcommand" -a "checkpoint" -d "Get checkpoint details"
complete -c fleet -n "__fish_use_subcommand" -a "checkpoint-create" -d "Create checkpoint"
complete -c fleet -n "__fish_use_subcommand" -a "checkpoint-accept" -d "Accept checkpoint"
complete -c fleet -n "__fish_use_subcommand" -a "checkpoint-reject" -d "Reject checkpoint"
complete -c fleet -n "__fish_use_subcommand" -a "swarms" -d "List all swarms"
complete -c fleet -n "__fish_use_subcommand" -a "swarm-create" -d "Create a swarm"
complete -c fleet -n "__fish_use_subcommand" -a "swarm-kill" -d "Kill a swarm"
complete -c fleet -n "__fish_use_subcommand" -a "spawn-queue" -d "Get spawn queue"
complete -c fleet -n "__fish_use_subcommand" -a "blackboard" -d "Read blackboard"
complete -c fleet -n "__fish_use_subcommand" -a "blackboard-post" -d "Post to blackboard"
complete -c fleet -n "__fish_use_subcommand" -a "templates" -d "List templates"
complete -c fleet -n "__fish_use_subcommand" -a "template" -d "Get template details"
complete -c fleet -n "__fish_use_subcommand" -a "template-run" -d "Run template"
complete -c fleet -n "__fish_use_subcommand" -a "workflows" -d "List workflows"
complete -c fleet -n "__fish_use_subcommand" -a "workflow" -d "Get workflow details"
complete -c fleet -n "__fish_use_subcommand" -a "workflow-start" -d "Start workflow"
complete -c fleet -n "__fish_use_subcommand" -a "executions" -d "List executions"
complete -c fleet -n "__fish_use_subcommand" -a "execution" -d "Get execution details"
complete -c fleet -n "__fish_use_subcommand" -a "execution-pause" -d "Pause execution"
complete -c fleet -n "__fish_use_subcommand" -a "execution-resume" -d "Resume execution"
complete -c fleet -n "__fish_use_subcommand" -a "execution-cancel" -d "Cancel execution"
complete -c fleet -n "__fish_use_subcommand" -a "roles" -d "List agent roles"
complete -c fleet -n "__fish_use_subcommand" -a "role" -d "Get role details"

# Global options
complete -c fleet -l url -d "Server URL"
complete -c fleet -l token -d "JWT auth token"
complete -c fleet -l table -d "Output as table"
complete -c fleet -l verbose -d "Verbose output"
complete -c fleet -l help -d "Show help"
complete -c fleet -l version -d "Show version"

# Status completions for task-update and workitem-update
complete -c fleet -n "__fish_seen_subcommand_from task-update workitem-update" -a "pending in_progress completed blocked cancelled"

# Auth type completions
complete -c fleet -n "__fish_seen_subcommand_from auth" -a "team-lead worker"

# Dynamic completions for workers
function __fish_fleet_workers
    fleet workers 2>/dev/null | jq -r '.[].handle' 2>/dev/null
end

complete -c fleet -n "__fish_seen_subcommand_from dismiss send output worktree-status mail handoffs checkpoints" -a "(__fish_fleet_workers)"

# Dynamic completions for swarms
function __fish_fleet_swarms
    fleet swarms 2>/dev/null | jq -r '.[].id' 2>/dev/null
end

complete -c fleet -n "__fish_seen_subcommand_from swarm-kill blackboard" -a "(__fish_fleet_swarms)"
