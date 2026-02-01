//! High-performance metrics aggregation engine.
//!
//! Provides native histogram observation, percentile computation,
//! sliding window rate counters, and time-series downsampling.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Serialize;
use std::collections::HashMap;

const DEFAULT_BUCKETS: &[f64] = &[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

// ============================================================================
// HISTOGRAM
// ============================================================================

/// Bucket-based histogram with O(log n) observation and O(1) percentile
#[napi]
pub struct MetricsHistogram {
    buckets: Vec<f64>,
    counts: Vec<u64>,
    sum: f64,
    count: u64,
    /// Sorted observations for exact percentile (bounded by max_samples)
    samples: Vec<f64>,
    max_samples: usize,
}

#[napi]
impl MetricsHistogram {
    #[napi(constructor)]
    pub fn new(buckets: Option<Vec<f64>>, max_samples: Option<u32>) -> Self {
        let mut b = buckets.unwrap_or_else(|| DEFAULT_BUCKETS.to_vec());
        b.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let counts = vec![0u64; b.len() + 1]; // +1 for +Inf
        Self {
            buckets: b,
            counts,
            sum: 0.0,
            count: 0,
            samples: Vec::new(),
            max_samples: max_samples.unwrap_or(10_000) as usize,
        }
    }

    /// Record an observation
    #[napi]
    pub fn observe(&mut self, value: f64) {
        self.sum += value;
        self.count += 1;

        // Bucket counting
        let mut placed = false;
        for (i, &boundary) in self.buckets.iter().enumerate() {
            if value <= boundary {
                self.counts[i] += 1;
                placed = true;
                break;
            }
        }
        if !placed {
            // +Inf bucket
            *self.counts.last_mut().unwrap() += 1;
        }

        // Sample reservoir for exact percentiles
        if self.samples.len() < self.max_samples {
            self.samples.push(value);
        }
    }

    /// Get a specific percentile (0.0 to 1.0)
    #[napi]
    pub fn percentile(&mut self, p: f64) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        self.samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let idx = ((p * self.samples.len() as f64) as usize).min(self.samples.len() - 1);
        self.samples[idx]
    }

    /// Get p50, p95, p99 in one call
    #[napi]
    pub fn get_percentiles(&mut self) -> PercentileSnapshot {
        if self.samples.is_empty() {
            return PercentileSnapshot { p50: 0.0, p95: 0.0, p99: 0.0, mean: 0.0, count: 0, sum: 0.0 };
        }
        self.samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let len = self.samples.len();
        PercentileSnapshot {
            p50: self.samples[(0.5 * len as f64) as usize],
            p95: self.samples[((0.95 * len as f64) as usize).min(len - 1)],
            p99: self.samples[((0.99 * len as f64) as usize).min(len - 1)],
            mean: if self.count > 0 { self.sum / self.count as f64 } else { 0.0 },
            count: self.count as i64,
            sum: self.sum,
        }
    }

    /// Reset all counters
    #[napi]
    pub fn reset(&mut self) {
        self.counts.fill(0);
        self.sum = 0.0;
        self.count = 0;
        self.samples.clear();
    }
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
pub struct PercentileSnapshot {
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub mean: f64,
    pub count: i64,
    pub sum: f64,
}

// ============================================================================
// SLIDING WINDOW COUNTER
// ============================================================================

/// Time-bucketed sliding window for rate computation
#[napi]
pub struct SlidingWindowCounter {
    /// Duration of each bucket in milliseconds
    bucket_duration_ms: i64,
    /// Number of buckets
    bucket_count: usize,
    /// Ring buffer of bucket counts
    buckets: Vec<u64>,
    /// Timestamps for each bucket
    timestamps: Vec<i64>,
    /// Current head index
    head: usize,
}

#[napi]
impl SlidingWindowCounter {
    /// Create a counter with the given window duration and bucket count.
    /// E.g., window_seconds=60, bucket_count=60 gives 1-second buckets.
    #[napi(constructor)]
    pub fn new(window_seconds: u32, bucket_count: u32) -> Self {
        let bc = bucket_count.max(1) as usize;
        let bucket_duration_ms = (window_seconds as i64 * 1000) / bc as i64;
        Self {
            bucket_duration_ms,
            bucket_count: bc,
            buckets: vec![0; bc],
            timestamps: vec![0; bc],
            head: 0,
        }
    }

    /// Increment the counter at the current time
    #[napi]
    pub fn increment(&mut self, now_ms: i64) {
        self.advance_to(now_ms);
        self.buckets[self.head] += 1;
    }

    /// Get the current rate (events per second) over the window
    #[napi]
    pub fn get_rate(&mut self, now_ms: i64) -> f64 {
        self.advance_to(now_ms);

        let window_ms = self.bucket_duration_ms * self.bucket_count as i64;
        let cutoff = now_ms - window_ms;

        let mut total: u64 = 0;
        for i in 0..self.bucket_count {
            if self.timestamps[i] >= cutoff {
                total += self.buckets[i];
            }
        }

        let window_seconds = window_ms as f64 / 1000.0;
        if window_seconds > 0.0 { total as f64 / window_seconds } else { 0.0 }
    }

    /// Get total count within the window
    #[napi]
    pub fn get_count(&mut self, now_ms: i64) -> i64 {
        self.advance_to(now_ms);

        let window_ms = self.bucket_duration_ms * self.bucket_count as i64;
        let cutoff = now_ms - window_ms;

        let mut total: u64 = 0;
        for i in 0..self.bucket_count {
            if self.timestamps[i] >= cutoff {
                total += self.buckets[i];
            }
        }
        total as i64
    }

    fn advance_to(&mut self, now_ms: i64) {
        let current_bucket_ts = self.timestamps[self.head];

        if current_bucket_ts == 0 {
            self.timestamps[self.head] = now_ms;
            return;
        }

        let elapsed = now_ms - current_bucket_ts;
        if elapsed < self.bucket_duration_ms {
            return; // Still in current bucket
        }

        // Advance head
        let buckets_to_advance = ((elapsed / self.bucket_duration_ms) as usize).min(self.bucket_count);
        for _ in 0..buckets_to_advance {
            self.head = (self.head + 1) % self.bucket_count;
            self.buckets[self.head] = 0;
            self.timestamps[self.head] = now_ms;
        }
    }
}

// ============================================================================
// METRICS ENGINE (container)
// ============================================================================

/// Container that manages named histograms and counters
#[napi]
pub struct MetricsEngine {
    histograms: HashMap<String, usize>, // name → index
    histogram_store: Vec<MetricsHistogram>,
    counters: HashMap<String, usize>,
    counter_store: Vec<SlidingWindowCounter>,
}

#[napi]
impl MetricsEngine {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            histograms: HashMap::new(),
            histogram_store: Vec::new(),
            counters: HashMap::new(),
            counter_store: Vec::new(),
        }
    }

    #[napi]
    pub fn create_histogram(&mut self, name: String, buckets: Option<Vec<f64>>) -> u32 {
        let idx = self.histogram_store.len();
        self.histogram_store.push(MetricsHistogram::new(buckets, None));
        self.histograms.insert(name, idx);
        idx as u32
    }

    #[napi]
    pub fn observe_histogram(&mut self, name: String, value: f64) {
        if let Some(&idx) = self.histograms.get(&name) {
            self.histogram_store[idx].observe(value);
        }
    }

    #[napi]
    pub fn get_histogram_percentiles(&mut self, name: String) -> Option<PercentileSnapshot> {
        if let Some(&idx) = self.histograms.get(&name) {
            Some(self.histogram_store[idx].get_percentiles())
        } else {
            None
        }
    }

    #[napi]
    pub fn create_counter(&mut self, name: String, window_seconds: u32, bucket_count: u32) -> u32 {
        let idx = self.counter_store.len();
        self.counter_store.push(SlidingWindowCounter::new(window_seconds, bucket_count));
        self.counters.insert(name, idx);
        idx as u32
    }

    #[napi]
    pub fn increment_counter(&mut self, name: String, now_ms: i64) {
        if let Some(&idx) = self.counters.get(&name) {
            self.counter_store[idx].increment(now_ms);
        }
    }

    #[napi]
    pub fn get_counter_rate(&mut self, name: String, now_ms: i64) -> f64 {
        if let Some(&idx) = self.counters.get(&name) {
            self.counter_store[idx].get_rate(now_ms)
        } else {
            0.0
        }
    }

    /// Get a snapshot of all metrics
    #[napi]
    pub fn get_snapshot(&mut self) -> String {
        let now = chrono::Utc::now().timestamp_millis();
        let mut result: HashMap<String, serde_json::Value> = HashMap::new();

        for (name, &idx) in &self.histograms {
            let p = self.histogram_store[idx].get_percentiles();
            result.insert(name.clone(), serde_json::json!({
                "type": "histogram",
                "p50": p.p50, "p95": p.p95, "p99": p.p99,
                "mean": p.mean, "count": p.count, "sum": p.sum,
            }));
        }

        for (name, &idx) in &self.counters {
            let rate = self.counter_store[idx].get_rate(now);
            let count = self.counter_store[idx].get_count(now);
            result.insert(name.clone(), serde_json::json!({
                "type": "counter",
                "rate": rate,
                "count": count,
            }));
        }

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }
}

/// Downsample a time series by averaging consecutive groups of `factor` points.
#[napi]
pub fn downsample(points_json: String, factor: u32) -> Result<String> {
    let points: Vec<Vec<f64>> = serde_json::from_str(&points_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid points: {}", e)))?;

    let factor = factor.max(1) as usize;
    let mut result: Vec<Vec<f64>> = Vec::new();

    for chunk in points.chunks(factor) {
        if chunk.is_empty() { continue; }
        let cols = chunk[0].len();
        let mut avg = vec![0.0; cols];
        for point in chunk {
            for (i, &val) in point.iter().enumerate() {
                if i < cols { avg[i] += val; }
            }
        }
        let n = chunk.len() as f64;
        for val in &mut avg {
            *val /= n;
        }
        result.push(avg);
    }

    serde_json::to_string(&result)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Serialization error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_histogram() {
        let mut h = MetricsHistogram::new(None, None);
        for i in 0..100 {
            h.observe(i as f64 / 100.0);
        }
        let p = h.get_percentiles();
        assert!(p.p50 > 0.0);
        assert!(p.p95 > p.p50);
        assert_eq!(p.count, 100);
    }

    #[test]
    fn test_sliding_window() {
        let mut counter = SlidingWindowCounter::new(60, 60);
        let now = 1000000i64;
        for _ in 0..10 {
            counter.increment(now);
        }
        let rate = counter.get_rate(now);
        assert!(rate > 0.0);
    }

    #[test]
    fn test_downsample() {
        let points = serde_json::to_string(&vec![
            vec![1.0, 10.0], vec![2.0, 20.0],
            vec![3.0, 30.0], vec![4.0, 40.0],
        ]).unwrap();
        let result = downsample(points, 2).unwrap();
        let ds: Vec<Vec<f64>> = serde_json::from_str(&result).unwrap();
        assert_eq!(ds.len(), 2);
        assert_eq!(ds[0], vec![1.5, 15.0]);
    }
}
