#!/bin/bash
# Claude Fleet CLI - Bash Completion
# Install: source completions/fleet.bash
# Or add to ~/.bashrc: source /path/to/completions/fleet.bash

_fleet_completions() {
    local cur prev commands
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    # Main commands
    commands="health metrics debug auth audit audit-loop teams tasks workers spawn dismiss send output worktree-status worktree-commit worktree-push worktree-pr task task-create task-update workitems workitem-create workitem-update batches batch-create batch-dispatch mail mail-send handoffs handoff-create checkpoints checkpoint checkpoint-create checkpoint-latest checkpoint-accept checkpoint-reject swarms swarm-create swarm-kill spawn-queue blackboard blackboard-post templates template template-save template-run template-delete roles role plan-run workflows workflow workflow-start executions execution execution-steps execution-pause execution-resume execution-cancel step-retry step-complete"

    # Status values
    statuses="pending in_progress completed blocked cancelled"

    case "${prev}" in
        fleet)
            COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
            return 0
            ;;
        auth)
            # Suggest handle, then team, then type
            if [[ ${COMP_CWORD} -eq 4 ]]; then
                COMPREPLY=($(compgen -W "team-lead worker" -- "${cur}"))
            fi
            return 0
            ;;
        spawn|dismiss|send|output|worktree-status|worktree-commit|worktree-push|worktree-pr|mail|handoffs|checkpoints|checkpoint-latest)
            # These take a worker handle - try to get from server
            local workers
            workers=$(fleet workers 2>/dev/null | jq -r '.[].handle' 2>/dev/null)
            if [[ -n "$workers" ]]; then
                COMPREPLY=($(compgen -W "${workers}" -- "${cur}"))
            fi
            return 0
            ;;
        task-update|workitem-update)
            COMPREPLY=($(compgen -W "${statuses}" -- "${cur}"))
            return 0
            ;;
        workitems)
            COMPREPLY=($(compgen -W "${statuses} --table" -- "${cur}"))
            return 0
            ;;
        swarm-kill|blackboard)
            # Get swarm IDs
            local swarms
            swarms=$(fleet swarms 2>/dev/null | jq -r '.[].id' 2>/dev/null)
            if [[ -n "$swarms" ]]; then
                COMPREPLY=($(compgen -W "${swarms}" -- "${cur}"))
            fi
            return 0
            ;;
        workflow|workflow-start)
            # Get workflow IDs
            local workflows
            workflows=$(fleet workflows 2>/dev/null | jq -r '.[].id' 2>/dev/null)
            if [[ -n "$workflows" ]]; then
                COMPREPLY=($(compgen -W "${workflows}" -- "${cur}"))
            fi
            return 0
            ;;
        --url)
            COMPREPLY=()
            return 0
            ;;
        --token)
            COMPREPLY=()
            return 0
            ;;
        *)
            # Global options
            if [[ "${cur}" == -* ]]; then
                COMPREPLY=($(compgen -W "--url --token --table --verbose --help --version" -- "${cur}"))
                return 0
            fi
            ;;
    esac

    COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
    return 0
}

complete -F _fleet_completions fleet
