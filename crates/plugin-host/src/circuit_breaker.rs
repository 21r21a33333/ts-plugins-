use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitBreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Copy)]
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub reset_timeout: Duration,
}

impl CircuitBreakerConfig {
    pub fn new(failure_threshold: u32, reset_timeout: Duration) -> Self {
        Self {
            failure_threshold,
            reset_timeout,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    consecutive_failures: u32,
    opened_at: Option<Instant>,
    half_open_probe_in_flight: bool,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            consecutive_failures: 0,
            opened_at: None,
            half_open_probe_in_flight: false,
        }
    }

    pub fn state(&self, now: Instant) -> CircuitBreakerState {
        match self.opened_at {
            None => CircuitBreakerState::Closed,
            Some(opened_at) => {
                if now >= opened_at + self.config.reset_timeout && self.half_open_probe_in_flight {
                    CircuitBreakerState::HalfOpen
                } else {
                    CircuitBreakerState::Open
                }
            }
        }
    }

    pub fn allow_request(&mut self, now: Instant) -> bool {
        match self.opened_at {
            None => true,
            Some(opened_at) if now >= opened_at + self.config.reset_timeout => {
                if self.half_open_probe_in_flight {
                    false
                } else {
                    self.half_open_probe_in_flight = true;
                    true
                }
            }
            Some(_) => false,
        }
    }

    pub fn record_success(&mut self, _now: Instant) {
        self.consecutive_failures = 0;
        self.opened_at = None;
        self.half_open_probe_in_flight = false;
    }

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
