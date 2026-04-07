//! Simple circuit-breaker policy used by the host scheduler and supervisor paths.

use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Current admission-control state for a plugin runtime.
pub enum CircuitBreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Copy)]
/// Static thresholds that define when the breaker opens and when it may probe again.
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub reset_timeout: Duration,
}

impl CircuitBreakerConfig {
    /// Creates a new circuit-breaker configuration.
    pub fn new(failure_threshold: u32, reset_timeout: Duration) -> Self {
        Self {
            failure_threshold,
            reset_timeout,
        }
    }
}

#[derive(Debug, Clone)]
/// Tracks recent failures so the host can shed load from unhealthy runtimes.
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    consecutive_failures: u32,
    opened_at: Option<Instant>,
    half_open_probe_in_flight: bool,
}

impl CircuitBreaker {
    /// Creates a breaker in the closed state.
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            consecutive_failures: 0,
            opened_at: None,
            half_open_probe_in_flight: false,
        }
    }

    /// Returns the externally visible state at the supplied point in time.
    pub fn state(&self, now: Instant) -> CircuitBreakerState {
        match self.opened_at {
            None => CircuitBreakerState::Closed,
            Some(opened_at) => {
                // Once the reset timeout elapses, allow exactly one probe before fully closing.
                if now >= opened_at + self.config.reset_timeout && self.half_open_probe_in_flight {
                    CircuitBreakerState::HalfOpen
                } else {
                    CircuitBreakerState::Open
                }
            }
        }
    }

    /// Returns whether a new request may enter the protected section.
    pub fn allow_request(&mut self, now: Instant) -> bool {
        match self.opened_at {
            None => true,
            Some(opened_at) if now >= opened_at + self.config.reset_timeout => {
                if self.half_open_probe_in_flight {
                    false
                } else {
                    // The first post-timeout request becomes the half-open probe.
                    self.half_open_probe_in_flight = true;
                    true
                }
            }
            Some(_) => false,
        }
    }

    /// Resets failure tracking after a healthy request completes.
    pub fn record_success(&mut self, _now: Instant) {
        self.consecutive_failures = 0;
        self.opened_at = None;
        self.half_open_probe_in_flight = false;
    }

    /// Records a failed request and opens the breaker once the threshold is reached.
    pub fn record_failure(&mut self, now: Instant) {
        if self.opened_at.is_some() {
            self.opened_at = Some(now);
            self.half_open_probe_in_flight = false;
            return;
        }

        self.consecutive_failures += 1;
        if self.consecutive_failures >= self.config.failure_threshold {
            self.opened_at = Some(now);
            self.half_open_probe_in_flight = false;
        }
    }
}
