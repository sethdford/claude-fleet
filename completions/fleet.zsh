#compdef fleet
# Claude Fleet CLI - Zsh Completion
# Install: Add to fpath and run compinit
# Or add to ~/.zshrc: source /path/to/completions/fleet.zsh

_fleet() {
    local -a commands
    local -a global_options
    local -a statuses

    commands=(
        'health:Check server health'
        'metrics:Get server metrics (JSON)'
        'debug:Get debug information'
        'auth:Authenticate with the server'
        'audit:Run audit checks'
        'teams:List team agents'
        'tasks:List team tasks'
        'workers:List all workers'
        'spawn:Spawn a new worker'
        'dismiss:Dismiss a worker'
        'send:Send message to worker'
        'output:Get worker output'
        'worktree-status:Get worktree git status'
        'worktree-commit:Commit changes in worktree'
        'worktree-push:Push worktree branch'
        'worktree-pr:Create PR from worktree'
        'task:Get task details'
        'task-create:Create a new task'
        'task-update:Update task status'
        'workitems:List work items'
        'workitem-create:Create a work item'
        'workitem-update:Update work item status'
        'batches:List all batches'
        'batch-create:Create a batch'
        'batch-dispatch:Dispatch batch to worker'
        'mail:Get unread mail'
        'mail-send:Send mail'
        'handoffs:List handoffs'
        'handoff-create:Create handoff'
        'checkpoints:List checkpoints'
        'checkpoint:Get checkpoint details'
        'checkpoint-create:Create checkpoint'
        'checkpoint-latest:Get latest checkpoint'
        'checkpoint-accept:Accept checkpoint'
        'checkpoint-reject:Reject checkpoint'
        'swarms:List all swarms'
        'swarm-create:Create a new swarm'
        'swarm-kill:Kill a swarm'
        'spawn-queue:Get spawn queue status'
        'blackboard:Read blackboard messages'
        'blackboard-post:Post to blackboard'
        'templates:List swarm templates'
        'template:Get template details'
        'template-save:Save template'
        'template-run:Run template'
        'workflows:List workflows'
        'workflow:Get workflow details'
        'workflow-start:Start workflow execution'
        'executions:List executions'
        'execution:Get execution details'
        'execution-steps:Get execution steps'
        'execution-pause:Pause execution'
        'execution-resume:Resume execution'
        'execution-cancel:Cancel execution'
        'roles:List all agent roles'
        'role:Get role details'
    )

    global_options=(
        '--url[Server URL]:url:_urls'
        '--token[JWT auth token]:token:'
        '--table[Output as formatted table]'
        '--verbose[Show request/response details]'
        '--help[Show help]'
        '--version[Show version]'
    )

    statuses=(pending in_progress completed blocked cancelled)

    _arguments -C \
        '1: :->command' \
        '*:: :->args' \
        $global_options

    case $state in
        command)
            _describe -t commands 'fleet commands' commands
            ;;
        args)
            case $words[1] in
                auth)
                    _arguments \
                        '1:handle:' \
                        '2:team:' \
                        '3:type:(team-lead worker)'
                    ;;
                spawn)
                    _arguments \
                        '1:handle:' \
                        '2:prompt:'
                    ;;
                dismiss|send|output|worktree-status|mail|handoffs|checkpoints|checkpoint-latest)
                    _arguments '1:handle:_fleet_workers'
                    ;;
                task-update)
                    _arguments \
                        '1:task-id:' \
                        '2:status:(pending in_progress completed blocked cancelled)'
                    ;;
                workitem-update)
                    _arguments \
                        '1:workitem-id:' \
                        '2:status:(pending in_progress completed blocked cancelled)' \
                        '3:reason:'
                    ;;
                workitems)
                    _arguments '1:status:(pending in_progress completed blocked cancelled --table)'
                    ;;
                swarm-kill|blackboard)
                    _arguments '1:swarm-id:_fleet_swarms'
                    ;;
                workflow|workflow-start)
                    _arguments '1:workflow-id:_fleet_workflows'
                    ;;
                workers|swarms|workflows|executions)
                    _arguments '--table[Format as table]'
                    ;;
            esac
            ;;
    esac
}

# Helper functions to get dynamic completions
_fleet_workers() {
    local -a workers
    workers=(${(f)"$(fleet workers 2>/dev/null | jq -r '.[].handle' 2>/dev/null)"})
    _describe -t workers 'workers' workers
}

_fleet_swarms() {
    local -a swarms
    swarms=(${(f)"$(fleet swarms 2>/dev/null | jq -r '.[].id' 2>/dev/null)"})
    _describe -t swarms 'swarms' swarms
}

_fleet_workflows() {
    local -a workflows
    workflows=(${(f)"$(fleet workflows 2>/dev/null | jq -r '.[].id' 2>/dev/null)"})
    _describe -t workflows 'workflows' workflows
}

_fleet "$@"
