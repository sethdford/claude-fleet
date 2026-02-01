//! Topic-based pub/sub message ring buffer.
//!
//! High-throughput in-memory message bus for inter-agent communication.
//! Uses VecDeque channels per topic with priority ordering.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

const MAX_MESSAGES_PER_TOPIC: usize = 10_000;

/// A message in the ring bus
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BusMessage {
    /// Unique message ID
    pub id: String,
    /// Topic for routing
    pub topic: String,
    /// Sender identifier
    pub sender: String,
    /// Priority: 0 = low, 1 = normal, 2 = high, 3 = urgent
    pub priority: u32,
    /// JSON-encoded payload
    pub payload: String,
    /// Timestamp in milliseconds
    pub timestamp: i64,
    /// Comma-separated list of handles that have read this message
    pub read_by: String,
}

/// Bus statistics
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct BusStats {
    pub total_messages: i64,
    pub topic_count: u32,
    pub subscriber_count: u32,
    pub messages_per_topic: Vec<TopicCount>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct TopicCount {
    pub topic: String,
    pub count: i64,
}

/// Topic-based pub/sub ring buffer
#[napi]
pub struct RingBus {
    /// Messages per topic, ordered by timestamp
    channels: HashMap<String, VecDeque<BusMessage>>,
    /// Subscribers: handle → set of topics
    subscribers: HashMap<String, HashSet<String>>,
    /// Auto-incrementing message ID counter
    next_id: u64,
}

#[napi]
impl RingBus {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            channels: HashMap::new(),
            subscribers: HashMap::new(),
            next_id: 1,
        }
    }

    /// Publish a message to a topic
    #[napi]
    pub fn publish(
        &mut self,
        topic: String,
        sender: String,
        priority: u32,
        payload: String,
    ) -> String {
        let now = chrono::Utc::now().timestamp_millis();
        let id = format!("msg_{}", self.next_id);
        self.next_id += 1;

        let msg = BusMessage {
            id: id.clone(),
            topic: topic.clone(),
            sender,
            priority: priority.min(3),
            payload,
            timestamp: now,
            read_by: String::new(),
        };

        let channel = self.channels.entry(topic).or_insert_with(VecDeque::new);

        // Evict oldest if at capacity
        if channel.len() >= MAX_MESSAGES_PER_TOPIC {
            channel.pop_front();
        }

        channel.push_back(msg);

        id
    }

    /// Subscribe a handle to a topic
    #[napi]
    pub fn subscribe(&mut self, handle: String, topic: String) {
        self.subscribers
            .entry(handle)
            .or_insert_with(HashSet::new)
            .insert(topic);
    }

    /// Unsubscribe a handle from a topic
    #[napi]
    pub fn unsubscribe(&mut self, handle: String, topic: String) {
        if let Some(topics) = self.subscribers.get_mut(&handle) {
            topics.remove(&topic);
        }
    }

    /// Read messages for a subscriber (only from subscribed topics, optionally unread only)
    #[napi]
    pub fn read(
        &mut self,
        handle: String,
        limit: Option<u32>,
        unread_only: Option<bool>,
    ) -> Vec<BusMessage> {
        let limit = limit.unwrap_or(50) as usize;
        let unread_only = unread_only.unwrap_or(true);

        let topics: Vec<String> = self
            .subscribers
            .get(&handle)
            .map(|t| t.iter().cloned().collect())
            .unwrap_or_default();

        let mut messages: Vec<BusMessage> = Vec::new();

        for topic in &topics {
            if let Some(channel) = self.channels.get(topic) {
                for msg in channel.iter().rev() {
                    if messages.len() >= limit {
                        break;
                    }
                    if unread_only && msg.read_by.contains(&handle) {
                        continue;
                    }
                    messages.push(msg.clone());
                }
            }
        }

        // Sort by priority (desc) then timestamp (asc)
        messages.sort_by(|a, b| {
            b.priority.cmp(&a.priority).then(a.timestamp.cmp(&b.timestamp))
        });

        messages.truncate(limit);

        // Mark as read
        for msg in &messages {
            if let Some(channel) = self.channels.get_mut(&msg.topic) {
                for m in channel.iter_mut() {
                    if m.id == msg.id {
                        if !m.read_by.is_empty() {
                            m.read_by.push(',');
                        }
                        m.read_by.push_str(&handle);
                        break;
                    }
                }
            }
        }

        messages
    }

    /// Read messages from a specific topic
    #[napi]
    pub fn read_topic(
        &self,
        topic: String,
        limit: Option<u32>,
    ) -> Vec<BusMessage> {
        let limit = limit.unwrap_or(50) as usize;

        self.channels
            .get(&topic)
            .map(|channel| {
                channel
                    .iter()
                    .rev()
                    .take(limit)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get bus statistics
    #[napi]
    pub fn stats(&self) -> BusStats {
        let mut total: i64 = 0;
        let mut per_topic: Vec<TopicCount> = Vec::new();

        for (topic, channel) in &self.channels {
            let count = channel.len() as i64;
            total += count;
            per_topic.push(TopicCount {
                topic: topic.clone(),
                count,
            });
        }

        per_topic.sort_by(|a, b| b.count.cmp(&a.count));

        BusStats {
            total_messages: total,
            topic_count: self.channels.len() as u32,
            subscriber_count: self.subscribers.len() as u32,
            messages_per_topic: per_topic,
        }
    }

    /// Remove messages older than max_age_ms
    #[napi]
    pub fn drain_old(&mut self, max_age_ms: i64) -> u32 {
        let now = chrono::Utc::now().timestamp_millis();
        let cutoff = now - max_age_ms;
        let mut removed: u32 = 0;

        for channel in self.channels.values_mut() {
            let before = channel.len();
            channel.retain(|m| m.timestamp >= cutoff);
            removed += (before - channel.len()) as u32;
        }

        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_publish_and_read() {
        let mut bus = RingBus::new();
        bus.subscribe("w1".into(), "tasks".into());

        bus.publish("tasks".into(), "lead".into(), 1, r#"{"task":"build"}"#.into());
        bus.publish("tasks".into(), "lead".into(), 2, r#"{"task":"test"}"#.into());

        let msgs = bus.read("w1".into(), Some(10), Some(true));
        assert_eq!(msgs.len(), 2);
        // Higher priority first
        assert_eq!(msgs[0].priority, 2);
    }

    #[test]
    fn test_unread_filtering() {
        let mut bus = RingBus::new();
        bus.subscribe("w1".into(), "chat".into());

        bus.publish("chat".into(), "lead".into(), 1, "hello".into());

        let first = bus.read("w1".into(), Some(10), Some(true));
        assert_eq!(first.len(), 1);

        let second = bus.read("w1".into(), Some(10), Some(true));
        assert_eq!(second.len(), 0); // Already read
    }

    #[test]
    fn test_stats() {
        let mut bus = RingBus::new();
        bus.publish("a".into(), "s".into(), 0, "p".into());
        bus.publish("a".into(), "s".into(), 0, "p".into());
        bus.publish("b".into(), "s".into(), 0, "p".into());

        let stats = bus.stats();
        assert_eq!(stats.total_messages, 3);
        assert_eq!(stats.topic_count, 2);
    }

    #[test]
    fn test_ring_buffer_eviction() {
        let mut bus = RingBus::new();
        for i in 0..(MAX_MESSAGES_PER_TOPIC + 100) {
            bus.publish("flood".into(), "s".into(), 0, format!("{}", i));
        }

        let stats = bus.stats();
        let flood_count = stats.messages_per_topic.iter()
            .find(|t| t.topic == "flood")
            .map(|t| t.count)
            .unwrap_or(0);
        assert_eq!(flood_count, MAX_MESSAGES_PER_TOPIC as i64);
    }
}
