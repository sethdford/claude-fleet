//! High-performance NDJSON worker log parser
//!
//! Parses Claude Code worker output streams (NDJSON events) using a
//! VecDeque ring buffer. Extracts health signals, session IDs, and
//! worker state from the event stream.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

const MAX_OUTPUT_LINES: usize = 1000;
const MAX_EVENTS: usize = 500;

// --- Raw event structure from Claude Code NDJSON ---

#[derive(Deserialize)]
struct RawEvent {
    #[serde(rename = "type")]
    event_type: Option<String>,
    subtype: Option<String>,
    session_id: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    content: Option<Vec<RawContent>>,
}

#[derive(Deserialize)]
struct RawContent {
    #[serde(rename = "type")]
    content_type: Option<String>,
    text: Option<String>,
}

// --- NAPI-exported types ---

/// A parsed event extracted from an NDJSON line
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct ParsedEvent {
    /// Event type: "system", "assistant", "result", "unknown"
    pub event_type: String,
    /// Event subtype (e.g., "init" for system events)
    pub subtype: String,
    /// Session ID if present
    pub session_id: String,
    /// Extracted text content
    pub text: String,
    /// Whether this event indicates an error
    pub is_error: bool,
    /// Timestamp (milliseconds since epoch)
    pub timestamp: i64,
}

/// Health signal derived from the event stream
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct HealthSignal {
    /// Current worker state: "idle", "working", "ready", "unknown"
    pub state: String,
    /// Milliseconds since the last event was received
    pub ms_since_last_event: i64,
    /// Running count of error events
    pub error_count: u32,
    /// Running count of all events
    pub total_events: u32,
    /// Whether the worker appears healthy
    pub is_healthy: bool,
}

/// Stateful NDJSON parser with ring buffer for output history
#[napi]
pub struct LogStreamParser {
    /// Ring buffer of parsed events
    events: VecDeque<ParsedEvent>,
    /// Ring buffer of text output lines
    output_lines: VecDeque<String>,
    /// Incomplete line buffer (partial data from previous chunk)
    line_buffer: String,
    /// Detected session ID
    session_id: String,
    /// Current worker state
    state: String,
    /// Timestamp of last event
    last_event_at: i64,
    /// Error event counter
    error_count: u32,
    /// Total event counter
    total_events: u32,
}

#[napi]
impl LogStreamParser {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            events: VecDeque::with_capacity(MAX_EVENTS),
            output_lines: VecDeque::with_capacity(MAX_OUTPUT_LINES),
            line_buffer: String::new(),
            session_id: String::new(),
            state: "idle".to_string(),
            last_event_at: 0,
            error_count: 0,
            total_events: 0,
        }
    }

    /// Parse a single NDJSON line. Returns a ParsedEvent if the line is valid JSON,
    /// or None if it's plain text (which gets added to the output buffer).
    #[napi]
    pub fn parse_line(&mut self, line: String) -> Option<ParsedEvent> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }

        let now = chrono::Utc::now().timestamp_millis();
        self.last_event_at = now;

        match serde_json::from_str::<RawEvent>(trimmed) {
            Ok(raw) => {
                let event = self.process_raw_event(raw, now);
                self.push_event(event.clone());
                Some(event)
            }
            Err(_) => {
                // Not JSON — treat as plain text output
                self.push_output(trimmed.to_string());
                None
            }
        }
    }

    /// Parse a batch of NDJSON lines (newline-separated chunk from stdout).
    /// Returns all successfully parsed events.
    #[napi]
    pub fn parse_batch(&mut self, chunk: String) -> Vec<ParsedEvent> {
        let mut results = Vec::new();

        // Prepend any leftover data from previous chunk
        let data = if self.line_buffer.is_empty() {
            chunk
        } else {
            let mut combined = std::mem::take(&mut self.line_buffer);
            combined.push_str(&chunk);
            combined
        };

        let mut lines: Vec<&str> = data.split('\n').collect();

        // Last element might be incomplete — save for next chunk
        if let Some(last) = lines.pop() {
            if !last.is_empty() {
                self.line_buffer = last.to_string();
            }
        }

        for line in lines {
            if let Some(event) = self.parse_line(line.to_string()) {
                results.push(event);
            }
        }

        results
    }

    /// Get the current health signal
    #[napi]
    pub fn get_health_signal(&self) -> HealthSignal {
        let now = chrono::Utc::now().timestamp_millis();
        let ms_since = if self.last_event_at > 0 {
            now - self.last_event_at
        } else {
            0
        };

        // Consider unhealthy if no event for 60s and state is working
        let is_healthy = ms_since < 60_000 || self.state != "working";

        HealthSignal {
            state: self.state.clone(),
            ms_since_last_event: ms_since,
            error_count: self.error_count,
            total_events: self.total_events,
            is_healthy,
        }
    }

    /// Get recent output lines (up to `limit`)
    #[napi]
    pub fn get_recent_output(&self, limit: Option<u32>) -> Vec<String> {
        let limit = limit.unwrap_or(100) as usize;
        let start = if self.output_lines.len() > limit {
            self.output_lines.len() - limit
        } else {
            0
        };
        self.output_lines.iter().skip(start).cloned().collect()
    }

    /// Get detected session ID
    #[napi]
    pub fn get_session_id(&self) -> String {
        self.session_id.clone()
    }

    /// Get current worker state
    #[napi]
    pub fn get_state(&self) -> String {
        self.state.clone()
    }

    // --- Internal helpers ---

    fn process_raw_event(&mut self, raw: RawEvent, now: i64) -> ParsedEvent {
        let event_type = raw.event_type.unwrap_or_default();
        let subtype = raw.subtype.unwrap_or_default();
        let session_id = raw.session_id.unwrap_or_default();
        let mut text = String::new();
        let mut is_error = false;

        // Extract session ID from init events
        if event_type == "system" && subtype == "init" && !session_id.is_empty() {
            self.session_id = session_id.clone();
            self.state = "ready".to_string();
        }

        // Extract text from assistant message content
        if event_type == "assistant" {
            self.state = "working".to_string();
            if let Some(msg) = &raw.message {
                if let Some(content) = &msg.content {
                    for c in content {
                        if c.content_type.as_deref() == Some("text") {
                            if let Some(t) = &c.text {
                                text.push_str(t);
                                self.push_output(t.clone());
                            }
                        }
                    }
                }
            }
        }

        // Detect errors
        if event_type == "result" || subtype == "error" {
            is_error = subtype == "error";
            if is_error {
                self.error_count += 1;
            }
        }

        self.total_events += 1;

        ParsedEvent {
            event_type,
            subtype,
            session_id,
            text,
            is_error,
            timestamp: now,
        }
    }

    fn push_event(&mut self, event: ParsedEvent) {
        if self.events.len() >= MAX_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }

    fn push_output(&mut self, line: String) {
        if self.output_lines.len() >= MAX_OUTPUT_LINES {
            self.output_lines.pop_front();
        }
        self.output_lines.push_back(line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_system_init() {
        let mut parser = LogStreamParser::new();
        let line = r#"{"type":"system","subtype":"init","session_id":"abc123"}"#;
        let event = parser.parse_line(line.to_string()).unwrap();
        assert_eq!(event.event_type, "system");
        assert_eq!(event.subtype, "init");
        assert_eq!(parser.get_session_id(), "abc123");
        assert_eq!(parser.get_state(), "ready");
    }

    #[test]
    fn test_parse_assistant_message() {
        let mut parser = LogStreamParser::new();
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}"#;
        let event = parser.parse_line(line.to_string()).unwrap();
        assert_eq!(event.event_type, "assistant");
        assert_eq!(event.text, "Hello world");
        assert_eq!(parser.get_state(), "working");
    }

    #[test]
    fn test_parse_plain_text() {
        let mut parser = LogStreamParser::new();
        let result = parser.parse_line("just some text".to_string());
        assert!(result.is_none());
        let output = parser.get_recent_output(None);
        assert_eq!(output.len(), 1);
        assert_eq!(output[0], "just some text");
    }

    #[test]
    fn test_parse_batch() {
        let mut parser = LogStreamParser::new();
        let chunk = r#"{"type":"system","subtype":"init","session_id":"s1"}
{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}
plain text
"#;
        let events = parser.parse_batch(chunk.to_string());
        assert_eq!(events.len(), 2);
        assert_eq!(parser.get_session_id(), "s1");
    }

    #[test]
    fn test_health_signal() {
        let parser = LogStreamParser::new();
        let health = parser.get_health_signal();
        assert_eq!(health.state, "idle");
        assert!(health.is_healthy);
        assert_eq!(health.error_count, 0);
    }

    #[test]
    fn test_ring_buffer_eviction() {
        let mut parser = LogStreamParser::new();
        for i in 0..1100 {
            parser.push_output(format!("line {}", i));
        }
        assert_eq!(parser.output_lines.len(), MAX_OUTPUT_LINES);
        let output = parser.get_recent_output(Some(5));
        assert_eq!(output.len(), 5);
    }
}
