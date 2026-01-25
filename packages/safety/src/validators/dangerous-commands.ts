/**
 * Dangerous Command Blocker
 *
 * Blocks known dangerous shell commands that could cause
 * system damage or data loss.
 */

import type { SafetyValidator, ValidationContext, ValidationResult } from '../types.js';

// Extremely dangerous commands that should always be blocked
const BLOCKED_COMMANDS = [
  // System destruction
  { pattern: /mkfs\s/, reason: 'Formatting filesystem' },
  { pattern: /dd\s+if=.*of=\/dev\/sd/, reason: 'Writing directly to disk device' },
  { pattern: /dd\s+if=.*of=\/dev\/nvme/, reason: 'Writing directly to NVMe device' },
  { pattern: /dd\s+if=.*of=\/dev\/hd/, reason: 'Writing directly to disk device' },

  // Fork bombs and resource exhaustion
  { pattern: /:\(\)\{.*:\|:.*\}/, reason: 'Fork bomb detected' },
  { pattern: /\$\{:\|:&\}/, reason: 'Fork bomb detected' },
  { pattern: /while\s+true.*do.*done/, reason: 'Potential infinite loop' },

  // Permission escalation
  { pattern: /chmod\s+(-R\s+)?777\s+\//, reason: 'Setting world-writable permissions on root' },
  { pattern: /chown\s+.*:\s*\//, reason: 'Changing ownership of root filesystem' },

  // Network attacks
  { pattern: /nc\s+-l.*-e\s*(\/bin\/sh|\/bin\/bash|sh|bash)/, reason: 'Network backdoor' },
  { pattern: /bash\s+-i\s+>&\s+\/dev\/tcp/, reason: 'Reverse shell' },

  // Data exfiltration
  { pattern: /curl.*\|.*sh/, reason: 'Piping remote script to shell' },
  { pattern: /wget.*\|.*sh/, reason: 'Piping remote script to shell' },
  { pattern: /curl.*\|.*bash/, reason: 'Piping remote script to bash' },
  { pattern: /wget.*\|.*bash/, reason: 'Piping remote script to bash' },

  // History manipulation (could hide malicious activity)
  { pattern: /history\s+-c/, reason: 'Clearing shell history' },
  { pattern: />\s*~\/\.bash_history/, reason: 'Clearing bash history' },
  { pattern: /unset\s+HISTFILE/, reason: 'Disabling history' },

  // Boot/system modification
  { pattern: /rm\s+.*\/boot\//, reason: 'Deleting boot files' },
  { pattern: /rm\s+.*\/etc\/passwd/, reason: 'Deleting password file' },
  { pattern: /rm\s+.*\/etc\/shadow/, reason: 'Deleting shadow file' },

  // Kernel manipulation
  { pattern: /insmod\s/, reason: 'Loading kernel module' },
  { pattern: /modprobe\s/, reason: 'Loading kernel module' },
  { pattern: /rmmod\s/, reason: 'Removing kernel module' },
];

// Commands that require extra caution
const CAUTIONARY_COMMANDS = [
  { pattern: /sudo\s/, reason: 'Elevated privileges requested' },
  { pattern: /su\s+-/, reason: 'Switching to root user' },
  { pattern: /chmod\s+.*\+s/, reason: 'Setting setuid/setgid bit' },
  { pattern: /crontab\s+-e/, reason: 'Editing cron jobs' },
  { pattern: /systemctl\s+(stop|disable|mask)/, reason: 'Stopping/disabling services' },
  { pattern: /kill\s+-9/, reason: 'Force killing process' },
  { pattern: /killall\s/, reason: 'Killing multiple processes' },
  { pattern: /pkill\s/, reason: 'Pattern-based process killing' },
  { pattern: /iptables\s/, reason: 'Modifying firewall rules' },
  { pattern: /ufw\s/, reason: 'Modifying firewall rules' },
];

/**
 * Validator for dangerous commands
 */
export const dangerousCommandValidator: SafetyValidator = (
  context: ValidationContext
): ValidationResult => {
  // Only check bash commands
  if (context.operation !== 'bash_command' || !context.command) {
    return { allowed: true };
  }

  const command = context.command.trim().toLowerCase();

  // Check for blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (blocked.pattern.test(command)) {
      return {
        allowed: false,
        reason: `Blocked: ${blocked.reason}`,
        suggestions: [
          'This command has been blocked for safety reasons',
          'If you believe this is a false positive, review the command carefully',
          'Contact an administrator if you need to run this command',
        ],
        severity: 'critical',
      };
    }
  }

  // Check for cautionary commands
  for (const caution of CAUTIONARY_COMMANDS) {
    if (caution.pattern.test(command)) {
      return {
        allowed: true,
        reason: `Caution: ${caution.reason}`,
        suggestions: [
          'This command requires elevated privileges or system access',
          'Ensure you understand the implications before proceeding',
        ],
        severity: 'warning',
      };
    }
  }

  // Check for command chaining with dangerous patterns
  if (command.includes('&&') || command.includes('||') || command.includes(';')) {
    // Check each part of the chain
    const parts = command.split(/&&|\|\||;/).map(p => p.trim());

    for (const part of parts) {
      for (const blocked of BLOCKED_COMMANDS) {
        if (blocked.pattern.test(part)) {
          return {
            allowed: false,
            reason: `Blocked in command chain: ${blocked.reason}`,
            severity: 'critical',
          };
        }
      }
    }
  }

  // Check for encoded/obfuscated commands
  if (command.includes('base64') && (command.includes('|') || command.includes('`'))) {
    return {
      allowed: false,
      reason: 'Executing base64-encoded commands is not allowed',
      suggestions: [
        'Decode and review the command before running',
        'Avoid obfuscated commands for security reasons',
      ],
      severity: 'critical',
    };
  }

  // Check for eval with variables (could hide malicious content)
  if (command.includes('eval ') && command.includes('$')) {
    return {
      allowed: false,
      reason: 'eval with variables could execute hidden commands',
      suggestions: [
        'Avoid using eval with dynamic content',
        'Use safer alternatives like direct command execution',
      ],
      severity: 'error',
    };
  }

  return { allowed: true };
};
