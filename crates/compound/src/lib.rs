//! Compounding Machine - Data aggregation and time-series accumulation
//!
//! Provides high-performance data processing for the Compounding Machine
//! visualization, exposed to Node.js via NAPI-RS bindings.
//!
//! Key capabilities:
//! - Time-series accumulation with ring buffer (720 points = 1hr at 5s intervals)
//! - Compound growth rate calculation (linear regression on recent window)
//! - Knowledge velocity tracking (messages/min trend)
//! - Agent lineage tree construction from flat worker list

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::VecDeque;

const MAX_POINTS: usize = 720; // 1 hour at 5-second intervals

/// A single point in the compounding time series
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimeSeriesPoint {
    pub timestamp: i64,
    pub tasks_completed: u32,
    pub knowledge_entries: u32,
    pub credits_earned: u32,
    pub active_workers: u32,
    pub healthy_workers: u32,
    pub total_swarms: u32,
    pub blackboard_messages: u32,
    pub pheromone_trails: u32,
}

/// Worker info extracted from a snapshot for lineage building
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct WorkerInfo {
    handle: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    health: String,
    #[serde(default)]
    swarm_id: Option<String>,
    #[serde(default)]
    depth_level: Option<u32>,
    #[serde(default)]
    team_name: Option<String>,
}

/// Swarm info extracted from a snapshot
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SwarmInfo {
    id: String,
    name: String,
    #[serde(default)]
    agents: Vec<WorkerInfo>,
}

/// Snapshot data received from the fleet server
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SnapshotInput {
    #[serde(default)]
    workers: Vec<WorkerInfo>,
    #[serde(default)]
    swarms: Vec<SwarmInfo>,
    #[serde(default)]
    tasks_total: u32,
    #[serde(default)]
    tasks_completed: u32,
    #[serde(default)]
    knowledge_entries: u32,
    #[serde(default)]
    credits_total: u32,
    #[serde(default)]
    blackboard_messages: u32,
    #[serde(default)]
    pheromone_trails: u32,
}

/// Lineage tree node for JSON output
#[derive(Debug, Serialize)]
struct LineageNode {
    id: String,
    name: String,
    #[serde(rename = "type")]
    node_type: String,
    state: Option<String>,
    health: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<LineageNode>,
}

/// Stateful time-series accumulator for compound metrics.
///
/// Maintains a ring buffer of metric snapshots and computes
/// growth rates and velocities over sliding windows.
#[napi]
pub struct CompoundAccumulator {
    points: VecDeque<TimeSeriesPoint>,
}

#[napi]
impl CompoundAccumulator {
    /// Create a new empty accumulator
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            points: VecDeque::with_capacity(MAX_POINTS),
        }
    }

    /// Push a JSON snapshot from the fleet server into the accumulator.
    /// Extracts metrics and appends to the ring buffer.
    #[napi]
    pub fn push_snapshot(&mut self, snapshot_json: String) -> Result<()> {
        let snapshot: SnapshotInput = serde_json::from_str(&snapshot_json).map_err(|e| {
            Error::new(
                Status::InvalidArg,
                format!("Failed to parse snapshot JSON: {}", e),
            )
        })?;

        let now = chrono::Utc::now().timestamp_millis();

        let active_workers = snapshot
            .workers
            .iter()
            .filter(|w| w.state != "stopped")
            .count() as u32;

        let healthy_workers = snapshot
            .workers
            .iter()
            .filter(|w| w.health == "healthy")
            .count() as u32;

        let point = TimeSeriesPoint {
            timestamp: now,
            tasks_completed: snapshot.tasks_completed,
            knowledge_entries: snapshot.knowledge_entries,
            credits_earned: snapshot.credits_total,
            active_workers,
            healthy_workers,
            total_swarms: snapshot.swarms.len() as u32,
            blackboard_messages: snapshot.blackboard_messages,
            pheromone_trails: snapshot.pheromone_trails,
        };

        // Ring buffer: remove oldest if at capacity
        if self.points.len() >= MAX_POINTS {
            self.points.pop_front();
        }
        self.points.push_back(point);

        Ok(())
    }

    /// Get the full accumulated time series
    #[napi]
    pub fn get_time_series(&self) -> Vec<TimeSeriesPoint> {
        self.points.iter().cloned().collect()
    }

    /// Get the number of accumulated data points
    #[napi]
    pub fn get_point_count(&self) -> u32 {
        self.points.len() as u32
    }

    /// Calculate the compound growth rate for tasks (tasks/min over last 5 min window).
    /// Uses simple linear regression on the recent window.
    #[napi]
    pub fn get_compound_rate(&self) -> f64 {
        self.compute_rate(|p| p.tasks_completed as f64, 60) // 60 points = 5 min
    }

    /// Calculate knowledge velocity (knowledge entries/min over last 5 min window)
    #[napi]
    pub fn get_knowledge_velocity(&self) -> f64 {
        self.compute_rate(|p| p.knowledge_entries as f64, 60)
    }

    /// Calculate credits velocity (credits/min over last 5 min window)
    #[napi]
    pub fn get_credits_velocity(&self) -> f64 {
        self.compute_rate(|p| p.credits_earned as f64, 60)
    }

    /// Build a lineage tree JSON from a flat worker list.
    /// Groups workers by swarm, then by depth level within each swarm.
    #[napi]
    pub fn build_lineage_tree(&self, workers_json: String) -> Result<String> {
        let workers: Vec<WorkerInfo> = serde_json::from_str(&workers_json).map_err(|e| {
            Error::new(
                Status::InvalidArg,
                format!("Failed to parse workers JSON: {}", e),
            )
        })?;

        let mut root = LineageNode {
            id: "fleet".to_string(),
            name: "Fleet".to_string(),
            node_type: "root".to_string(),
            state: None,
            health: None,
            children: Vec::new(),
        };

        // Group workers by swarm
        let mut by_swarm: HashMap<String, Vec<&WorkerInfo>> = HashMap::new();
        let mut unassigned: Vec<&WorkerInfo> = Vec::new();

        for worker in &workers {
            match &worker.swarm_id {
                Some(sid) if !sid.is_empty() => {
                    by_swarm.entry(sid.clone()).or_default().push(worker);
                }
                _ => {
                    unassigned.push(worker);
                }
            }
        }

        // Build swarm subtrees
        for (swarm_id, mut members) in by_swarm {
            members.sort_by_key(|w| w.depth_level.unwrap_or(0));

            let mut swarm_node = LineageNode {
                id: swarm_id.clone(),
                name: format!("Swarm {}", &swarm_id[..8.min(swarm_id.len())]),
                node_type: "swarm".to_string(),
                state: None,
                health: None,
                children: Vec::new(),
            };

            // Build depth-based hierarchy
            let mut depth_buckets: HashMap<u32, Vec<LineageNode>> = HashMap::new();
            for w in &members {
                let depth = w.depth_level.unwrap_or(0);
                let node = LineageNode {
                    id: w.handle.clone(),
                    name: w.handle.clone(),
                    node_type: "worker".to_string(),
                    state: Some(w.state.clone()),
                    health: Some(w.health.clone()),
                    children: Vec::new(),
                };
                depth_buckets.entry(depth).or_default().push(node);
            }

            // Nest: depth 0 at top, deeper nodes become children
            let mut max_depth = 0u32;
            for &d in depth_buckets.keys() {
                if d > max_depth {
                    max_depth = d;
                }
            }

            // Build from deepest to shallowest
            let mut current_children: Vec<LineageNode> = Vec::new();
            for depth in (0..=max_depth).rev() {
                if let Some(mut nodes) = depth_buckets.remove(&depth) {
                    if !current_children.is_empty() {
                        // Distribute children among nodes at this depth (round-robin)
                        let node_count = nodes.len();
                        if node_count > 0 {
                            for (i, child) in current_children.drain(..).enumerate() {
                                nodes[i % node_count].children.push(child);
                            }
                        }
                    }
                    current_children = nodes;
                }
            }

            swarm_node.children = current_children;
            root.children.push(swarm_node);
        }

        // Add unassigned workers
        if !unassigned.is_empty() {
            let mut unassigned_node = LineageNode {
                id: "unassigned".to_string(),
                name: "Unassigned".to_string(),
                node_type: "group".to_string(),
                state: None,
                health: None,
                children: Vec::new(),
            };

            for w in unassigned {
                unassigned_node.children.push(LineageNode {
                    id: w.handle.clone(),
                    name: w.handle.clone(),
                    node_type: "worker".to_string(),
                    state: Some(w.state.clone()),
                    health: Some(w.health.clone()),
                    children: Vec::new(),
                });
            }

            root.children.push(unassigned_node);
        }

        serde_json::to_string(&root).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to serialize lineage tree: {}", e),
            )
        })
    }
}

impl CompoundAccumulator {
    /// Compute rate of change per minute using linear regression over a window
    fn compute_rate<F>(&self, extract: F, window_size: usize) -> f64
    where
        F: Fn(&TimeSeriesPoint) -> f64,
    {
        let n = self.points.len();
        if n < 2 {
            return 0.0;
        }

        let start = if n > window_size { n - window_size } else { 0 };
        let window: Vec<&TimeSeriesPoint> = self.points.iter().skip(start).collect();
        let wn = window.len() as f64;

        if wn < 2.0 {
            return 0.0;
        }

        // Simple linear regression: slope = (n*sum_xy - sum_x*sum_y) / (n*sum_xx - sum_x^2)
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_xy = 0.0;
        let mut sum_xx = 0.0;

        for (i, point) in window.iter().enumerate() {
            let x = i as f64;
            let y = extract(point);
            sum_x += x;
            sum_y += y;
            sum_xy += x * y;
            sum_xx += x * x;
        }

        let denom = wn * sum_xx - sum_x * sum_x;
        if denom.abs() < f64::EPSILON {
            return 0.0;
        }

        let slope_per_point = (wn * sum_xy - sum_x * sum_y) / denom;
        // Convert from per-point (5s) to per-minute (12 points/min)
        slope_per_point * 12.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_accumulator_basic() {
        let mut acc = CompoundAccumulator::new();
        assert_eq!(acc.get_point_count(), 0);

        let snapshot = r#"{
            "workers": [{"handle": "w1", "state": "working", "health": "healthy"}],
            "swarms": [],
            "tasksTotal": 5,
            "tasksCompleted": 3,
            "knowledgeEntries": 10,
            "creditsTotal": 100,
            "blackboardMessages": 5,
            "pheromoneTrails": 2
        }"#;

        acc.push_snapshot(snapshot.to_string()).unwrap();
        assert_eq!(acc.get_point_count(), 1);

        let series = acc.get_time_series();
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].tasks_completed, 3);
        assert_eq!(series[0].active_workers, 1);
        assert_eq!(series[0].healthy_workers, 1);
    }

    #[test]
    fn test_lineage_tree() {
        let acc = CompoundAccumulator::new();
        let workers = r#"[
            {"handle": "lead-1", "state": "working", "health": "healthy", "swarmId": "s1", "depthLevel": 0},
            {"handle": "worker-1", "state": "working", "health": "healthy", "swarmId": "s1", "depthLevel": 1},
            {"handle": "worker-2", "state": "idle", "health": "healthy", "swarmId": "s1", "depthLevel": 1},
            {"handle": "solo", "state": "working", "health": "healthy"}
        ]"#;

        let tree_json = acc.build_lineage_tree(workers.to_string()).unwrap();
        let tree: serde_json::Value = serde_json::from_str(&tree_json).unwrap();

        assert_eq!(tree["id"], "fleet");
        assert_eq!(tree["children"].as_array().unwrap().len(), 2); // s1 + unassigned
    }

    #[test]
    fn test_ring_buffer_cap() {
        let mut acc = CompoundAccumulator::new();
        let snapshot = r#"{"workers":[],"swarms":[],"tasksTotal":0,"tasksCompleted":0,"knowledgeEntries":0,"creditsTotal":0,"blackboardMessages":0,"pheromoneTrails":0}"#;

        for _ in 0..800 {
            acc.push_snapshot(snapshot.to_string()).unwrap();
        }

        assert_eq!(acc.get_point_count(), 720); // MAX_POINTS
    }

    #[test]
    fn test_compound_rate() {
        let mut acc = CompoundAccumulator::new();

        // Push increasing task counts
        for i in 0..20 {
            let snapshot = format!(
                r#"{{"workers":[],"swarms":[],"tasksTotal":{},"tasksCompleted":{},"knowledgeEntries":0,"creditsTotal":0,"blackboardMessages":0,"pheromoneTrails":0}}"#,
                i * 2, i
            );
            acc.push_snapshot(snapshot).unwrap();
        }

        let rate = acc.get_compound_rate();
        // Should be positive since tasks_completed is increasing
        assert!(rate > 0.0, "Rate should be positive, got {}", rate);
    }
}
