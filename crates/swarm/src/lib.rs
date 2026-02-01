//! Swarm intelligence computation engine.
//!
//! Pure computation — no storage access. Accepts data as JSON/NAPI objects,
//! returns computed results. Covers:
//! - Batch pheromone decay
//! - Multi-factor bid evaluation
//! - Vote tallying (majority, supermajority, ranked Borda, weighted)
//! - Game-theoretic payoff calculation
//! - ACO-style task routing

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// PHEROMONE DECAY
// ============================================================================

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PheromoneTrailData {
    pub id: String,
    pub intensity: f64,
    pub created_at: i64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct DecayResult {
    /// Trails with updated intensities
    pub trails: Vec<PheromoneTrailData>,
    /// Number of trails that decayed below threshold
    pub removed_count: u32,
    /// IDs of trails that should be marked as decayed
    pub removed_ids: Vec<String>,
}

// ============================================================================
// BID EVALUATION
// ============================================================================

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BidData {
    pub id: String,
    pub bidder_handle: String,
    pub bid_amount: f64,
    pub confidence: f64,
    pub reputation: f64,
    pub estimated_duration: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct BidEvaluationResult {
    /// Bids sorted by composite score (best first)
    pub ranked_bids: Vec<ScoredBid>,
    /// The winning bid ID
    pub winner_id: String,
    /// Winner's composite score
    pub winner_score: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct ScoredBid {
    pub id: String,
    pub bidder_handle: String,
    pub composite_score: f64,
    pub reputation_component: f64,
    pub confidence_component: f64,
    pub bid_component: f64,
}

// ============================================================================
// VOTE TALLYING
// ============================================================================

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VoteData {
    pub voter_handle: String,
    pub vote_value: String,
    pub vote_weight: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct ConsensusResult {
    pub winner: Option<String>,
    pub tally: Vec<TallyEntry>,
    pub quorum_met: bool,
    pub total_votes: u32,
    pub weighted_total: f64,
    pub participation_rate: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct TallyEntry {
    pub option: String,
    pub count: f64,
}

// ============================================================================
// SWARM ENGINE
// ============================================================================

#[napi]
pub struct SwarmEngine {}

#[napi]
impl SwarmEngine {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {}
    }

    /// Process batch pheromone decay.
    /// Multiplies each trail's intensity by (1 - decay_rate).
    /// Returns updated trails and IDs of those below min_intensity.
    #[napi]
    pub fn process_decay(
        &self,
        trails_json: String,
        decay_rate: f64,
        min_intensity: f64,
    ) -> Result<DecayResult> {
        let mut trails: Vec<PheromoneTrailData> = serde_json::from_str(&trails_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid trails JSON: {}", e)))?;

        let factor = 1.0 - decay_rate;
        let mut removed_ids: Vec<String> = Vec::new();

        for trail in &mut trails {
            trail.intensity *= factor;
            if trail.intensity < min_intensity {
                removed_ids.push(trail.id.clone());
            }
        }

        let removed_count = removed_ids.len() as u32;

        // Keep only surviving trails in result
        trails.retain(|t| t.intensity >= min_intensity);

        Ok(DecayResult {
            trails,
            removed_count,
            removed_ids,
        })
    }

    /// Evaluate bids using weighted multi-factor scoring.
    /// Factors: reputation, confidence, bid amount (lower is better by default).
    #[napi]
    pub fn evaluate_bids(
        &self,
        bids_json: String,
        reputation_weight: f64,
        confidence_weight: f64,
        bid_weight: f64,
        prefer_lower_bids: bool,
    ) -> Result<BidEvaluationResult> {
        let bids: Vec<BidData> = serde_json::from_str(&bids_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid bids JSON: {}", e)))?;

        if bids.is_empty() {
            return Ok(BidEvaluationResult {
                ranked_bids: vec![],
                winner_id: String::new(),
                winner_score: 0.0,
            });
        }

        // Normalize scores
        let max_bid = bids.iter().map(|b| b.bid_amount).fold(f64::MIN, f64::max);
        let max_rep = bids.iter().map(|b| b.reputation).fold(f64::MIN, f64::max);
        let total_weight = reputation_weight + confidence_weight + bid_weight;

        let mut scored: Vec<ScoredBid> = bids.iter().map(|b| {
            let rep_norm = if max_rep > 0.0 { b.reputation / max_rep } else { 0.0 };
            let bid_norm = if max_bid > 0.0 {
                if prefer_lower_bids { 1.0 - (b.bid_amount / max_bid) } else { b.bid_amount / max_bid }
            } else { 0.0 };

            let rep_component = rep_norm * reputation_weight / total_weight;
            let conf_component = b.confidence * confidence_weight / total_weight;
            let bid_component = bid_norm * bid_weight / total_weight;

            ScoredBid {
                id: b.id.clone(),
                bidder_handle: b.bidder_handle.clone(),
                composite_score: rep_component + conf_component + bid_component,
                reputation_component: rep_component,
                confidence_component: conf_component,
                bid_component,
            }
        }).collect();

        scored.sort_by(|a, b| b.composite_score.partial_cmp(&a.composite_score).unwrap_or(std::cmp::Ordering::Equal));

        let winner_id = scored.first().map(|b| b.id.clone()).unwrap_or_default();
        let winner_score = scored.first().map(|b| b.composite_score).unwrap_or(0.0);

        Ok(BidEvaluationResult {
            ranked_bids: scored,
            winner_id,
            winner_score,
        })
    }

    /// Tally votes using the specified method.
    /// Methods: "majority", "supermajority", "unanimous", "ranked", "weighted"
    #[napi]
    pub fn tally_votes(
        &self,
        votes_json: String,
        options_json: String,
        method: String,
        quorum_value: f64,
    ) -> Result<ConsensusResult> {
        let votes: Vec<VoteData> = serde_json::from_str(&votes_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid votes JSON: {}", e)))?;
        let options: Vec<String> = serde_json::from_str(&options_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid options JSON: {}", e)))?;

        let mut tally: HashMap<String, f64> = HashMap::new();
        for opt in &options {
            tally.insert(opt.clone(), 0.0);
        }

        let mut total_weight = 0.0;
        for vote in &votes {
            if method == "ranked" {
                // Borda count: parse rankings as JSON array
                if let Ok(rankings) = serde_json::from_str::<Vec<String>>(&vote.vote_value) {
                    let n = rankings.len() as f64;
                    for (i, option) in rankings.iter().enumerate() {
                        let points = (n - i as f64) * vote.vote_weight;
                        *tally.entry(option.clone()).or_insert(0.0) += points;
                    }
                    total_weight += vote.vote_weight;
                }
            } else {
                *tally.entry(vote.vote_value.clone()).or_insert(0.0) += vote.vote_weight;
                total_weight += vote.vote_weight;
            }
        }

        // Find winner
        let mut winner: Option<String> = None;
        let mut max_votes: f64 = 0.0;
        for (opt, &count) in &tally {
            if count > max_votes {
                max_votes = count;
                winner = Some(opt.clone());
            }
        }

        // Check quorum
        let quorum_met = if total_weight > 0.0 {
            let winner_ratio = max_votes / total_weight;
            match method.as_str() {
                "supermajority" => winner_ratio >= 0.667,
                "unanimous" => winner_ratio >= 1.0,
                _ => winner_ratio > 0.5 || options.len() <= 2,
            }
        } else {
            false
        };

        let participation_rate = if total_weight > 0.0 {
            votes.len() as f64 / total_weight
        } else {
            0.0
        };

        let tally_entries: Vec<TallyEntry> = tally.into_iter()
            .map(|(option, count)| TallyEntry { option, count })
            .collect();

        Ok(ConsensusResult {
            winner: if quorum_met { winner } else { None },
            tally: tally_entries,
            quorum_met,
            total_votes: votes.len() as u32,
            weighted_total: total_weight,
            participation_rate,
        })
    }

    /// Calculate game-theoretic payoff for cooperative/competitive scenarios.
    /// Uses a simple payoff matrix encoded as JSON.
    #[napi]
    pub fn calculate_payoff(
        &self,
        strategies_json: String,
        payoff_matrix_json: String,
    ) -> Result<String> {
        let strategies: Vec<String> = serde_json::from_str(&strategies_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid strategies: {}", e)))?;
        let matrix: HashMap<String, HashMap<String, f64>> = serde_json::from_str(&payoff_matrix_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid payoff matrix: {}", e)))?;

        // Compute expected payoffs for each strategy
        let mut payoffs: HashMap<String, f64> = HashMap::new();
        for strategy in &strategies {
            let mut total = 0.0;
            let mut count = 0;
            if let Some(row) = matrix.get(strategy) {
                for value in row.values() {
                    total += value;
                    count += 1;
                }
            }
            payoffs.insert(
                strategy.clone(),
                if count > 0 { total / count as f64 } else { 0.0 },
            );
        }

        // Find dominant strategy
        let dominant = payoffs.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(s, _)| s.clone());

        let result = serde_json::json!({
            "payoffs": payoffs,
            "dominant_strategy": dominant,
        });

        serde_json::to_string(&result)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Serialization error: {}", e)))
    }

    /// ACO-style task routing: assign tasks to workers based on pheromone trails.
    /// Higher trail intensity on a (worker, task_type) pair = higher assignment probability.
    #[napi]
    pub fn route_tasks(
        &self,
        tasks_json: String,
        workers_json: String,
        trail_strengths_json: String,
        alpha: f64,
    ) -> Result<String> {
        let tasks: Vec<String> = serde_json::from_str(&tasks_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid tasks: {}", e)))?;
        let workers: Vec<String> = serde_json::from_str(&workers_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid workers: {}", e)))?;
        // trail_strengths: { "worker_handle": { "task_type": intensity } }
        let trails: HashMap<String, HashMap<String, f64>> = serde_json::from_str(&trail_strengths_json)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid trail strengths: {}", e)))?;

        if workers.is_empty() {
            return Ok("{}".to_string());
        }

        let mut assignments: HashMap<String, String> = HashMap::new();
        let mut worker_load: HashMap<String, usize> = HashMap::new();

        for task in &tasks {
            let mut best_worker: Option<&String> = None;
            let mut best_score: f64 = f64::MIN;

            for worker in &workers {
                let trail_intensity = trails
                    .get(worker)
                    .and_then(|t| t.get(task))
                    .copied()
                    .unwrap_or(0.1); // small default for exploration

                let load = *worker_load.get(worker).unwrap_or(&0) as f64;
                let load_penalty = 1.0 / (1.0 + load);

                let score = trail_intensity.powf(alpha) * load_penalty;

                if score > best_score {
                    best_score = score;
                    best_worker = Some(worker);
                }
            }

            if let Some(worker) = best_worker {
                assignments.insert(task.clone(), worker.clone());
                *worker_load.entry(worker.clone()).or_insert(0) += 1;
            }
        }

        serde_json::to_string(&assignments)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Serialization error: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pheromone_decay() {
        let engine = SwarmEngine::new();
        let trails = serde_json::to_string(&vec![
            PheromoneTrailData { id: "t1".into(), intensity: 1.0, created_at: 0 },
            PheromoneTrailData { id: "t2".into(), intensity: 0.05, created_at: 0 },
        ]).unwrap();

        let result = engine.process_decay(trails, 0.1, 0.01).unwrap();
        assert_eq!(result.removed_count, 0); // 0.05 * 0.9 = 0.045, still above 0.01
        assert_eq!(result.trails.len(), 2);
    }

    #[test]
    fn test_bid_evaluation() {
        let engine = SwarmEngine::new();
        let bids = serde_json::to_string(&vec![
            BidData { id: "b1".into(), bidder_handle: "w1".into(), bid_amount: 10.0, confidence: 0.9, reputation: 0.8, estimated_duration: 60.0 },
            BidData { id: "b2".into(), bidder_handle: "w2".into(), bid_amount: 5.0, confidence: 0.7, reputation: 0.9, estimated_duration: 90.0 },
        ]).unwrap();

        let result = engine.evaluate_bids(bids, 0.4, 0.3, 0.3, true).unwrap();
        assert_eq!(result.ranked_bids.len(), 2);
        assert!(!result.winner_id.is_empty());
    }

    #[test]
    fn test_majority_vote() {
        let engine = SwarmEngine::new();
        let votes = serde_json::to_string(&vec![
            VoteData { voter_handle: "a1".into(), vote_value: "yes".into(), vote_weight: 1.0 },
            VoteData { voter_handle: "a2".into(), vote_value: "yes".into(), vote_weight: 1.0 },
            VoteData { voter_handle: "a3".into(), vote_value: "no".into(), vote_weight: 1.0 },
        ]).unwrap();
        let options = serde_json::to_string(&vec!["yes", "no"]).unwrap();

        let result = engine.tally_votes(votes, options, "majority".into(), 0.5).unwrap();
        assert!(result.quorum_met);
        assert_eq!(result.winner, Some("yes".to_string()));
        assert_eq!(result.total_votes, 3);
    }

    #[test]
    fn test_route_tasks() {
        let engine = SwarmEngine::new();
        let tasks = serde_json::to_string(&vec!["build", "test"]).unwrap();
        let workers = serde_json::to_string(&vec!["w1", "w2"]).unwrap();
        let trails = serde_json::to_string(&HashMap::from([
            ("w1".to_string(), HashMap::from([("build".to_string(), 2.0)])),
            ("w2".to_string(), HashMap::from([("test".to_string(), 3.0)])),
        ])).unwrap();

        let result = engine.route_tasks(tasks, workers, trails, 1.0).unwrap();
        let assignments: HashMap<String, String> = serde_json::from_str(&result).unwrap();
        assert_eq!(assignments.len(), 2);
    }
}
