//! Natural Language to Shell Command Translator
//!
//! This crate provides pattern-based translation of natural language
//! descriptions to shell commands.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;

/// A translation result containing the command and confidence
#[napi(object)]
pub struct TranslationResult {
    /// The translated shell command
    pub command: String,
    /// Confidence score (0.0 to 1.0)
    pub confidence: f64,
    /// Alternative commands if available
    pub alternatives: Vec<String>,
    /// Explanation of what the command does
    pub explanation: String,
}

/// Command pattern for matching
struct Pattern {
    triggers: Vec<&'static str>,
    command_template: &'static str,
    explanation: &'static str,
    confidence: f64,
}

/// Natural language to shell translator
#[napi]
pub struct LmshTranslator {
    patterns: Vec<Pattern>,
    aliases: HashMap<String, String>,
}

#[napi]
impl LmshTranslator {
    #[napi(constructor)]
    pub fn new() -> Self {
        let patterns = vec![
            // File listing
            Pattern {
                triggers: vec!["list files", "show files", "what files", "ls", "dir"],
                command_template: "ls -la",
                explanation: "List all files in the current directory with details",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["list hidden", "show hidden", "hidden files"],
                command_template: "ls -la",
                explanation: "List all files including hidden ones",
                confidence: 0.9,
            },

            // Directory navigation
            Pattern {
                triggers: vec!["go to", "change directory", "cd to", "navigate to"],
                command_template: "cd {path}",
                explanation: "Change to the specified directory",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["go home", "home directory", "go to home"],
                command_template: "cd ~",
                explanation: "Change to home directory",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["go back", "go up", "parent directory", "up one level"],
                command_template: "cd ..",
                explanation: "Go to parent directory",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["current directory", "where am i", "pwd", "print working"],
                command_template: "pwd",
                explanation: "Print current working directory",
                confidence: 0.95,
            },

            // File operations
            Pattern {
                triggers: vec!["create file", "make file", "touch", "new file"],
                command_template: "touch {filename}",
                explanation: "Create a new empty file",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["create directory", "make directory", "mkdir", "new folder", "make folder"],
                command_template: "mkdir -p {dirname}",
                explanation: "Create a new directory",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["remove file", "delete file", "rm file"],
                command_template: "rm {filename}",
                explanation: "Remove a file",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["remove directory", "delete directory", "delete folder", "rmdir"],
                command_template: "rm -r {dirname}",
                explanation: "Remove a directory and its contents",
                confidence: 0.8,
            },
            Pattern {
                triggers: vec!["copy file", "copy to", "cp"],
                command_template: "cp {source} {dest}",
                explanation: "Copy a file",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["move file", "rename file", "mv"],
                command_template: "mv {source} {dest}",
                explanation: "Move or rename a file",
                confidence: 0.85,
            },

            // File viewing
            Pattern {
                triggers: vec!["show file", "view file", "cat", "display file", "read file"],
                command_template: "cat {filename}",
                explanation: "Display file contents",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["head of file", "first lines", "head"],
                command_template: "head -n 20 {filename}",
                explanation: "Show first 20 lines of a file",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["tail of file", "last lines", "tail", "end of file"],
                command_template: "tail -n 20 {filename}",
                explanation: "Show last 20 lines of a file",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["less", "page through", "scroll through"],
                command_template: "less {filename}",
                explanation: "View file with pagination",
                confidence: 0.85,
            },

            // Searching
            Pattern {
                triggers: vec!["find file", "search for file", "locate file"],
                command_template: "find . -name '{pattern}'",
                explanation: "Find files matching a pattern",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["search in files", "grep", "find text", "search for text"],
                command_template: "grep -r '{pattern}' .",
                explanation: "Search for text in files recursively",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["search in file", "grep in"],
                command_template: "grep '{pattern}' {filename}",
                explanation: "Search for text in a specific file",
                confidence: 0.85,
            },

            // Git commands
            Pattern {
                triggers: vec!["git status", "check git", "what changed"],
                command_template: "git status",
                explanation: "Show git repository status",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["git log", "commit history", "show commits", "git history"],
                command_template: "git log --oneline -20",
                explanation: "Show recent commit history",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["git diff", "show changes", "what's different"],
                command_template: "git diff",
                explanation: "Show uncommitted changes",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["git add", "stage files", "add to staging"],
                command_template: "git add {files}",
                explanation: "Stage files for commit",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["git commit", "commit changes", "save changes"],
                command_template: "git commit -m '{message}'",
                explanation: "Commit staged changes",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["git push", "push changes", "upload commits"],
                command_template: "git push",
                explanation: "Push commits to remote",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["git pull", "pull changes", "get latest", "download commits"],
                command_template: "git pull",
                explanation: "Pull latest changes from remote",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["git branch", "list branches", "show branches"],
                command_template: "git branch -a",
                explanation: "List all branches",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["checkout branch", "switch branch", "git checkout"],
                command_template: "git checkout {branch}",
                explanation: "Switch to a branch",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["create branch", "new branch", "git branch create"],
                command_template: "git checkout -b {branch}",
                explanation: "Create and switch to a new branch",
                confidence: 0.9,
            },

            // Process management
            Pattern {
                triggers: vec!["running processes", "show processes", "ps", "what's running"],
                command_template: "ps aux",
                explanation: "Show all running processes",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["kill process", "stop process", "terminate"],
                command_template: "kill {pid}",
                explanation: "Terminate a process by PID",
                confidence: 0.8,
            },
            Pattern {
                triggers: vec!["top", "system monitor", "resource usage"],
                command_template: "top",
                explanation: "Show system resource usage",
                confidence: 0.9,
            },

            // Disk usage
            Pattern {
                triggers: vec!["disk space", "disk usage", "df", "free space"],
                command_template: "df -h",
                explanation: "Show disk space usage",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["directory size", "folder size", "du", "how big"],
                command_template: "du -sh {path}",
                explanation: "Show directory size",
                confidence: 0.85,
            },

            // Network
            Pattern {
                triggers: vec!["check internet", "ping", "test connection"],
                command_template: "ping -c 4 google.com",
                explanation: "Test internet connectivity",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["download", "curl", "fetch url", "wget"],
                command_template: "curl -O {url}",
                explanation: "Download a file from URL",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["my ip", "ip address", "network info"],
                command_template: "ifconfig || ip addr",
                explanation: "Show network interface information",
                confidence: 0.85,
            },

            // Permissions
            Pattern {
                triggers: vec!["make executable", "chmod +x", "add execute permission"],
                command_template: "chmod +x {filename}",
                explanation: "Make a file executable",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["change permissions", "chmod"],
                command_template: "chmod {mode} {filename}",
                explanation: "Change file permissions",
                confidence: 0.8,
            },
            Pattern {
                triggers: vec!["change owner", "chown"],
                command_template: "chown {owner} {filename}",
                explanation: "Change file ownership",
                confidence: 0.8,
            },

            // Compression
            Pattern {
                triggers: vec!["compress", "create tar", "tar", "archive"],
                command_template: "tar -czvf {archive}.tar.gz {source}",
                explanation: "Create a compressed archive",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["extract", "untar", "decompress", "unzip tar"],
                command_template: "tar -xzvf {archive}",
                explanation: "Extract a compressed archive",
                confidence: 0.85,
            },
            Pattern {
                triggers: vec!["unzip", "extract zip"],
                command_template: "unzip {archive}",
                explanation: "Extract a zip archive",
                confidence: 0.9,
            },

            // System info
            Pattern {
                triggers: vec!["system info", "os info", "uname"],
                command_template: "uname -a",
                explanation: "Show system information",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["date", "current time", "what time"],
                command_template: "date",
                explanation: "Show current date and time",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["uptime", "how long running", "system uptime"],
                command_template: "uptime",
                explanation: "Show system uptime",
                confidence: 0.95,
            },
            Pattern {
                triggers: vec!["memory usage", "free memory", "ram"],
                command_template: "free -h",
                explanation: "Show memory usage",
                confidence: 0.9,
            },

            // Environment
            Pattern {
                triggers: vec!["environment variables", "env", "show env"],
                command_template: "env",
                explanation: "Show environment variables",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["set variable", "export"],
                command_template: "export {var}={value}",
                explanation: "Set an environment variable",
                confidence: 0.8,
            },
            Pattern {
                triggers: vec!["echo", "print", "show variable"],
                command_template: "echo ${var}",
                explanation: "Print a variable or text",
                confidence: 0.85,
            },

            // History
            Pattern {
                triggers: vec!["command history", "history", "previous commands"],
                command_template: "history | tail -50",
                explanation: "Show recent command history",
                confidence: 0.9,
            },
            Pattern {
                triggers: vec!["clear screen", "clear", "cls"],
                command_template: "clear",
                explanation: "Clear the terminal screen",
                confidence: 0.95,
            },
        ];

        Self {
            patterns,
            aliases: HashMap::new(),
        }
    }

    /// Translate natural language to a shell command
    #[napi]
    pub fn translate(&self, input: String) -> TranslationResult {
        let input_lower = input.to_lowercase();
        let mut best_match: Option<(&Pattern, f64)> = None;
        let mut alternatives: Vec<String> = Vec::new();

        // Find the best matching pattern
        for pattern in &self.patterns {
            for trigger in &pattern.triggers {
                if input_lower.contains(trigger) {
                    let score = calculate_match_score(&input_lower, trigger, pattern.confidence);
                    match &best_match {
                        None => best_match = Some((pattern, score)),
                        Some((_, best_score)) if score > *best_score => {
                            if let Some((old_pattern, _)) = best_match {
                                alternatives.push(old_pattern.command_template.to_string());
                            }
                            best_match = Some((pattern, score));
                        }
                        Some(_) => {
                            alternatives.push(pattern.command_template.to_string());
                        }
                    }
                }
            }
        }

        match best_match {
            Some((pattern, score)) => {
                let command = self.substitute_placeholders(pattern.command_template, &input);
                TranslationResult {
                    command,
                    confidence: score,
                    alternatives: alternatives.into_iter().take(3).collect(),
                    explanation: pattern.explanation.to_string(),
                }
            }
            None => TranslationResult {
                command: String::new(),
                confidence: 0.0,
                alternatives: vec![],
                explanation: "No matching command pattern found".to_string(),
            },
        }
    }

    /// Add a custom alias
    #[napi]
    pub fn add_alias(&mut self, alias: String, command: String) {
        self.aliases.insert(alias.to_lowercase(), command);
    }

    /// Get all aliases
    #[napi]
    pub fn get_aliases(&self) -> HashMap<String, String> {
        self.aliases.clone()
    }

    /// Translate using aliases first, then patterns
    #[napi]
    pub fn translate_with_aliases(&self, input: String) -> TranslationResult {
        let input_lower = input.to_lowercase();

        // Check aliases first
        for (alias, command) in &self.aliases {
            if input_lower.contains(alias) {
                return TranslationResult {
                    command: command.clone(),
                    confidence: 1.0,
                    alternatives: vec![],
                    explanation: format!("Custom alias for '{}'", alias),
                };
            }
        }

        // Fall back to pattern matching
        self.translate(input)
    }

    fn substitute_placeholders(&self, template: &str, input: &str) -> String {
        let mut result = template.to_string();

        // Extract potential arguments from input
        let words: Vec<&str> = input.split_whitespace().collect();

        // Simple placeholder substitution
        if result.contains("{path}") || result.contains("{filename}") || result.contains("{dirname}") {
            // Try to find a path-like argument
            for word in &words {
                if word.starts_with('/') || word.starts_with('.') || word.contains('.') {
                    result = result.replace("{path}", word);
                    result = result.replace("{filename}", word);
                    result = result.replace("{dirname}", word);
                    break;
                }
            }
        }

        if result.contains("{pattern}") {
            // Look for quoted strings or the last word
            if let Some(quoted) = extract_quoted(&input) {
                result = result.replace("{pattern}", &quoted);
            } else if let Some(last) = words.last() {
                result = result.replace("{pattern}", last);
            }
        }

        if result.contains("{branch}") {
            // Look for branch name (last word usually)
            if let Some(last) = words.last() {
                result = result.replace("{branch}", last);
            }
        }

        if result.contains("{message}") {
            // Look for quoted message
            if let Some(quoted) = extract_quoted(&input) {
                result = result.replace("{message}", &quoted);
            } else {
                result = result.replace("{message}", "update");
            }
        }

        if result.contains("{source}") && result.contains("{dest}") {
            // Need two paths
            let paths: Vec<&str> = words.iter()
                .filter(|w| w.contains('/') || w.contains('.'))
                .copied()
                .collect();
            if paths.len() >= 2 {
                result = result.replace("{source}", paths[0]);
                result = result.replace("{dest}", paths[1]);
            }
        }

        if result.contains("{files}") {
            // Use all remaining arguments or "."
            let files: Vec<&str> = words.iter()
                .filter(|w| w.contains('/') || w.contains('.') || **w == "*")
                .copied()
                .collect();
            if !files.is_empty() {
                result = result.replace("{files}", &files.join(" "));
            } else {
                result = result.replace("{files}", ".");
            }
        }

        if result.contains("{url}") {
            // Look for URL
            for word in &words {
                if word.starts_with("http://") || word.starts_with("https://") {
                    result = result.replace("{url}", word);
                    break;
                }
            }
        }

        if result.contains("{pid}") {
            // Look for numeric PID
            for word in &words {
                if word.parse::<u32>().is_ok() {
                    result = result.replace("{pid}", word);
                    break;
                }
            }
        }

        if result.contains("{var}") && result.contains("{value}") {
            // Look for VAR=VALUE pattern
            for word in &words {
                if word.contains('=') {
                    let parts: Vec<&str> = word.splitn(2, '=').collect();
                    if parts.len() == 2 {
                        result = result.replace("{var}", parts[0]);
                        result = result.replace("{value}", parts[1]);
                        break;
                    }
                }
            }
        }

        if result.contains("{mode}") {
            // Look for chmod mode (like 755, 644)
            for word in &words {
                if word.len() == 3 && word.chars().all(|c| c.is_ascii_digit()) {
                    result = result.replace("{mode}", word);
                    break;
                }
            }
        }

        if result.contains("{owner}") {
            // Look for user:group or just user
            for word in &words {
                if word.contains(':') || (word.chars().all(|c| c.is_alphanumeric() || c == '_')) {
                    result = result.replace("{owner}", word);
                    break;
                }
            }
        }

        if result.contains("{archive}") {
            // Look for archive file
            for word in &words {
                if word.ends_with(".tar.gz") || word.ends_with(".tgz") ||
                   word.ends_with(".zip") || word.ends_with(".tar") {
                    result = result.replace("{archive}", word);
                    break;
                }
            }
        }

        // Clean up any remaining placeholders
        result = result.replace("{path}", ".")
            .replace("{filename}", "file")
            .replace("{dirname}", "directory")
            .replace("{pattern}", "*")
            .replace("{branch}", "main")
            .replace("{message}", "update")
            .replace("{source}", "source")
            .replace("{dest}", "dest")
            .replace("{files}", ".")
            .replace("{url}", "https://example.com")
            .replace("{pid}", "0")
            .replace("{var}", "VAR")
            .replace("{value}", "value")
            .replace("{mode}", "755")
            .replace("{owner}", "user")
            .replace("{archive}", "archive.tar.gz");

        result
    }
}

fn calculate_match_score(input: &str, trigger: &str, base_confidence: f64) -> f64 {
    let input_len = input.len() as f64;
    let trigger_len = trigger.len() as f64;

    // Boost score if trigger is a larger portion of the input
    let coverage = trigger_len / input_len;
    let coverage_boost = coverage * 0.2;

    // Boost score if trigger appears at the start
    let position_boost = if input.starts_with(trigger) { 0.1 } else { 0.0 };

    (base_confidence + coverage_boost + position_boost).min(1.0)
}

fn extract_quoted(input: &str) -> Option<String> {
    // Try to extract content between quotes
    if let Some(start) = input.find('"') {
        if let Some(end) = input[start + 1..].find('"') {
            return Some(input[start + 1..start + 1 + end].to_string());
        }
    }
    if let Some(start) = input.find('\'') {
        if let Some(end) = input[start + 1..].find('\'') {
            return Some(input[start + 1..start + 1 + end].to_string());
        }
    }
    None
}

/// Create a new translator instance
#[napi]
pub fn create_translator() -> LmshTranslator {
    LmshTranslator::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_files() {
        let translator = LmshTranslator::new();
        let result = translator.translate("list files".to_string());
        assert_eq!(result.command, "ls -la");
        assert!(result.confidence > 0.8);
    }

    #[test]
    fn test_git_status() {
        let translator = LmshTranslator::new();
        let result = translator.translate("git status".to_string());
        assert_eq!(result.command, "git status");
    }

    #[test]
    fn test_search_pattern() {
        let translator = LmshTranslator::new();
        let result = translator.translate("search for \"TODO\" in files".to_string());
        assert!(result.command.contains("grep"));
        assert!(result.command.contains("TODO"));
    }

    #[test]
    fn test_no_match() {
        let translator = LmshTranslator::new();
        let result = translator.translate("xyznonsense".to_string());
        assert!(result.command.is_empty());
        assert_eq!(result.confidence, 0.0);
    }

    #[test]
    fn test_custom_alias() {
        let mut translator = LmshTranslator::new();
        translator.add_alias("deploy".to_string(), "npm run deploy".to_string());

        let result = translator.translate_with_aliases("deploy".to_string());
        assert_eq!(result.command, "npm run deploy");
        assert_eq!(result.confidence, 1.0);
    }
}
