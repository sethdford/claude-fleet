//! Task dependency solver with topological sort, cycle detection,
//! critical path analysis, and parallelizable level extraction.
//!
//! All methods accept/return JSON or `#[napi(object)]` structs.
//! No storage access — pure computation.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

/// A node in the dependency graph
#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DagNode {
    /// Unique identifier
    pub id: String,
    /// Priority (higher = more important, default 0)
    pub priority: Option<i32>,
    /// Estimated duration in seconds
    pub estimated_duration: Option<f64>,
    /// IDs of nodes this node depends on
    pub depends_on: Option<Vec<String>>,
}

/// Result of topological sort
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct TopologicalResult {
    /// Sorted execution order (respects dependencies)
    pub order: Vec<String>,
    /// Parallelizable levels — nodes in same level can run concurrently
    pub levels: Vec<Vec<String>>,
    /// Whether a valid ordering exists (false if cycles detected)
    pub is_valid: bool,
    /// Total number of nodes processed
    pub node_count: u32,
}

/// Cycle detection result
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct CycleResult {
    /// Whether cycles exist
    pub has_cycles: bool,
    /// Nodes involved in cycles
    pub cycle_nodes: Vec<String>,
    /// Individual cycles found (each as a vec of node IDs)
    pub cycles: Vec<Vec<String>>,
}

/// Critical path result
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct CriticalPathResult {
    /// Node IDs on the critical path
    pub path: Vec<String>,
    /// Total duration of the critical path
    pub total_duration: f64,
    /// Slack per node (how much delay before it affects critical path)
    pub slack: Vec<NodeSlack>,
}

/// Slack information for a single node
#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct NodeSlack {
    pub id: String,
    pub slack: f64,
    pub earliest_start: f64,
    pub latest_start: f64,
}

/// The DAG solver engine
#[napi]
pub struct DagSolver {}

#[napi]
impl DagSolver {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {}
    }

    /// Topological sort using Kahn's algorithm with priority ordering.
    /// Returns execution order and parallelizable levels.
    #[napi]
    pub fn topological_sort(&self, nodes_json: String) -> Result<TopologicalResult> {
        let nodes: Vec<DagNode> = serde_json::from_str(&nodes_json).map_err(|e| {
            Error::new(Status::InvalidArg, format!("Invalid nodes JSON: {}", e))
        })?;

        let (adj, in_degree, node_map) = build_graph(&nodes);
        let node_count = nodes.len() as u32;

        // Kahn's algorithm with level tracking
        let mut in_deg = in_degree.clone();
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut order: Vec<String> = Vec::new();
        let mut levels: Vec<Vec<String>> = Vec::new();

        // Seed queue with zero in-degree nodes
        for (id, &deg) in &in_deg {
            if deg == 0 {
                queue.push_back(id.clone());
            }
        }

        while !queue.is_empty() {
            // Sort current level by priority (descending)
            let mut level: Vec<String> = queue.drain(..).collect();
            level.sort_by(|a, b| {
                let pa = node_map.get(a).and_then(|n| n.priority).unwrap_or(0);
                let pb = node_map.get(b).and_then(|n| n.priority).unwrap_or(0);
                pb.cmp(&pa)
            });

            for id in &level {
                order.push(id.clone());
                if let Some(neighbors) = adj.get(id) {
                    for neighbor in neighbors {
                        if let Some(deg) = in_deg.get_mut(neighbor) {
                            *deg -= 1;
                            if *deg == 0 {
                                queue.push_back(neighbor.clone());
                            }
                        }
                    }
                }
            }

            levels.push(level);
        }

        let is_valid = order.len() == nodes.len();

        Ok(TopologicalResult {
            order,
            levels,
            is_valid,
            node_count,
        })
    }

    /// Detect cycles using DFS with three-coloring.
    #[napi]
    pub fn detect_cycles(&self, nodes_json: String) -> Result<CycleResult> {
        let nodes: Vec<DagNode> = serde_json::from_str(&nodes_json).map_err(|e| {
            Error::new(Status::InvalidArg, format!("Invalid nodes JSON: {}", e))
        })?;

        let (adj, _, _) = build_graph(&nodes);

        let mut white: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
        let mut gray: HashSet<String> = HashSet::new();
        let mut black: HashSet<String> = HashSet::new();
        let mut cycle_nodes: HashSet<String> = HashSet::new();
        let mut cycles: Vec<Vec<String>> = Vec::new();

        fn dfs(
            node: &str,
            adj: &HashMap<String, Vec<String>>,
            white: &mut HashSet<String>,
            gray: &mut HashSet<String>,
            black: &mut HashSet<String>,
            path: &mut Vec<String>,
            cycle_nodes: &mut HashSet<String>,
            cycles: &mut Vec<Vec<String>>,
        ) {
            white.remove(node);
            gray.insert(node.to_string());
            path.push(node.to_string());

            if let Some(neighbors) = adj.get(node) {
                for neighbor in neighbors {
                    if gray.contains(neighbor) {
                        // Found a cycle
                        let cycle_start = path.iter().position(|n| n == neighbor).unwrap_or(0);
                        let cycle: Vec<String> = path[cycle_start..].to_vec();
                        for n in &cycle {
                            cycle_nodes.insert(n.clone());
                        }
                        cycles.push(cycle);
                    } else if white.contains(neighbor) {
                        dfs(neighbor, adj, white, gray, black, path, cycle_nodes, cycles);
                    }
                }
            }

            path.pop();
            gray.remove(node);
            black.insert(node.to_string());
        }

        let start_nodes: Vec<String> = white.iter().cloned().collect();
        let mut path: Vec<String> = Vec::new();

        for node in start_nodes {
            if white.contains(&node) {
                dfs(&node, &adj, &mut white, &mut gray, &mut black, &mut path, &mut cycle_nodes, &mut cycles);
            }
        }

        let has_cycles = !cycles.is_empty();
        Ok(CycleResult {
            has_cycles,
            cycle_nodes: cycle_nodes.into_iter().collect(),
            cycles,
        })
    }

    /// Compute critical path (longest path through the DAG).
    /// Requires nodes to have estimated_duration set.
    #[napi]
    pub fn critical_path(&self, nodes_json: String) -> Result<CriticalPathResult> {
        let nodes: Vec<DagNode> = serde_json::from_str(&nodes_json).map_err(|e| {
            Error::new(Status::InvalidArg, format!("Invalid nodes JSON: {}", e))
        })?;

        let (adj, _, node_map) = build_graph(&nodes);

        // Forward pass: compute earliest start times
        let topo = self.topological_sort(nodes_json.clone())?;
        if !topo.is_valid {
            return Err(Error::new(Status::InvalidArg, "Graph contains cycles; cannot compute critical path"));
        }

        let mut earliest_start: HashMap<String, f64> = HashMap::new();
        let mut earliest_finish: HashMap<String, f64> = HashMap::new();

        for id in &topo.order {
            let duration = node_map.get(id).and_then(|n| n.estimated_duration).unwrap_or(1.0);
            let es = earliest_start.entry(id.clone()).or_insert(0.0);
            let ef = *es + duration;
            earliest_finish.insert(id.clone(), ef);

            if let Some(neighbors) = adj.get(id) {
                for neighbor in neighbors {
                    let neighbor_es = earliest_start.entry(neighbor.clone()).or_insert(0.0);
                    if ef > *neighbor_es {
                        *neighbor_es = ef;
                    }
                }
            }
        }

        // Find total project duration
        let total_duration = earliest_finish.values().copied().fold(0.0_f64, f64::max);

        // Backward pass: compute latest start times
        let mut latest_finish: HashMap<String, f64> = HashMap::new();
        let mut latest_start: HashMap<String, f64> = HashMap::new();

        for id in topo.order.iter().rev() {
            let duration = node_map.get(id).and_then(|n| n.estimated_duration).unwrap_or(1.0);
            let lf = latest_finish.entry(id.clone()).or_insert(total_duration);

            if let Some(neighbors) = adj.get(id) {
                for neighbor in neighbors {
                    let neighbor_ls = latest_start.get(neighbor).copied().unwrap_or(total_duration);
                    let current_lf = latest_finish.entry(id.clone()).or_insert(total_duration);
                    if neighbor_ls < *current_lf {
                        *current_lf = neighbor_ls;
                    }
                }
            }

            let lf_val = *latest_finish.get(id).unwrap_or(&total_duration);
            latest_start.insert(id.clone(), lf_val - duration);
        }

        // Compute slack and identify critical path
        let mut slack_info: Vec<NodeSlack> = Vec::new();
        let mut critical_path: Vec<String> = Vec::new();

        for id in &topo.order {
            let es = earliest_start.get(id).copied().unwrap_or(0.0);
            let ls = latest_start.get(id).copied().unwrap_or(0.0);
            let slack = ls - es;

            if slack.abs() < 0.001 {
                critical_path.push(id.clone());
            }

            slack_info.push(NodeSlack {
                id: id.clone(),
                slack,
                earliest_start: es,
                latest_start: ls,
            });
        }

        Ok(CriticalPathResult {
            path: critical_path,
            total_duration,
            slack: slack_info,
        })
    }

    /// Get IDs of nodes that have all dependencies satisfied.
    /// Useful for finding which tasks can be started immediately.
    #[napi]
    pub fn get_ready_nodes(&self, nodes_json: String, completed_json: String) -> Result<Vec<String>> {
        let nodes: Vec<DagNode> = serde_json::from_str(&nodes_json).map_err(|e| {
            Error::new(Status::InvalidArg, format!("Invalid nodes JSON: {}", e))
        })?;

        let completed: HashSet<String> = serde_json::from_str(&completed_json).map_err(|e| {
            Error::new(Status::InvalidArg, format!("Invalid completed JSON: {}", e))
        })?;

        let mut ready: Vec<String> = Vec::new();

        for node in &nodes {
            if completed.contains(&node.id) {
                continue;
            }

            let deps_met = node.depends_on.as_ref()
                .map(|deps| deps.iter().all(|d| completed.contains(d)))
                .unwrap_or(true);

            if deps_met {
                ready.push(node.id.clone());
            }
        }

        // Sort by priority (descending)
        let node_map: HashMap<String, &DagNode> = nodes.iter().map(|n| (n.id.clone(), n)).collect();
        ready.sort_by(|a, b| {
            let pa = node_map.get(a).and_then(|n| n.priority).unwrap_or(0);
            let pb = node_map.get(b).and_then(|n| n.priority).unwrap_or(0);
            pb.cmp(&pa)
        });

        Ok(ready)
    }
}

/// Build adjacency list and in-degree map from nodes
fn build_graph(nodes: &[DagNode]) -> (
    HashMap<String, Vec<String>>,
    HashMap<String, usize>,
    HashMap<String, &DagNode>,
) {
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut node_map: HashMap<String, &DagNode> = HashMap::new();

    // Initialize
    for node in nodes {
        adj.entry(node.id.clone()).or_default();
        in_degree.entry(node.id.clone()).or_insert(0);
        node_map.insert(node.id.clone(), node);
    }

    // Build edges (dependency → dependent)
    for node in nodes {
        if let Some(deps) = &node.depends_on {
            for dep in deps {
                adj.entry(dep.clone()).or_default().push(node.id.clone());
                *in_degree.entry(node.id.clone()).or_insert(0) += 1;
            }
        }
    }

    (adj, in_degree, node_map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_nodes_json(nodes: &[(&str, Option<i32>, Option<f64>, Vec<&str>)]) -> String {
        let dag_nodes: Vec<DagNode> = nodes.iter().map(|(id, prio, dur, deps)| DagNode {
            id: id.to_string(),
            priority: *prio,
            estimated_duration: *dur,
            depends_on: if deps.is_empty() { None } else { Some(deps.iter().map(|s| s.to_string()).collect()) },
        }).collect();
        serde_json::to_string(&dag_nodes).unwrap()
    }

    #[test]
    fn test_topological_sort_simple() {
        let solver = DagSolver::new();
        let json = make_nodes_json(&[
            ("a", None, None, vec![]),
            ("b", None, None, vec!["a"]),
            ("c", None, None, vec!["a"]),
            ("d", None, None, vec!["b", "c"]),
        ]);
        let result = solver.topological_sort(json).unwrap();
        assert!(result.is_valid);
        assert_eq!(result.node_count, 4);
        // "a" must come before "b", "c", "d"
        let pos_a = result.order.iter().position(|x| x == "a").unwrap();
        let pos_d = result.order.iter().position(|x| x == "d").unwrap();
        assert!(pos_a < pos_d);
    }

    #[test]
    fn test_cycle_detection() {
        let solver = DagSolver::new();
        let json = make_nodes_json(&[
            ("a", None, None, vec!["c"]),
            ("b", None, None, vec!["a"]),
            ("c", None, None, vec!["b"]),
        ]);
        let result = solver.detect_cycles(json).unwrap();
        assert!(result.has_cycles);
        assert!(!result.cycle_nodes.is_empty());
    }

    #[test]
    fn test_no_cycles() {
        let solver = DagSolver::new();
        let json = make_nodes_json(&[
            ("a", None, None, vec![]),
            ("b", None, None, vec!["a"]),
        ]);
        let result = solver.detect_cycles(json).unwrap();
        assert!(!result.has_cycles);
    }

    #[test]
    fn test_critical_path() {
        let solver = DagSolver::new();
        let json = make_nodes_json(&[
            ("a", None, Some(3.0), vec![]),
            ("b", None, Some(2.0), vec!["a"]),
            ("c", None, Some(5.0), vec!["a"]),
            ("d", None, Some(1.0), vec!["b", "c"]),
        ]);
        let result = solver.critical_path(json).unwrap();
        // Critical path: a(3) → c(5) → d(1) = 9
        assert!((result.total_duration - 9.0).abs() < 0.01);
        assert!(result.path.contains(&"a".to_string()));
        assert!(result.path.contains(&"c".to_string()));
        assert!(result.path.contains(&"d".to_string()));
    }

    #[test]
    fn test_ready_nodes() {
        let solver = DagSolver::new();
        let nodes_json = make_nodes_json(&[
            ("a", Some(1), None, vec![]),
            ("b", Some(2), None, vec!["a"]),
            ("c", Some(3), None, vec![]),
        ]);
        let completed_json = serde_json::to_string(&Vec::<String>::new()).unwrap();
        let ready = solver.get_ready_nodes(nodes_json, completed_json).unwrap();
        // "a" and "c" are ready (no deps), sorted by priority desc: c(3), a(1)
        assert_eq!(ready.len(), 2);
        assert_eq!(ready[0], "c");
        assert_eq!(ready[1], "a");
    }
}
