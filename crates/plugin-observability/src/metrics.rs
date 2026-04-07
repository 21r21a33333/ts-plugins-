use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RequestOutcome {
    Success,
    TypedError,
    FrameworkFailure,
}

#[derive(Debug, Default)]
pub struct PluginMetrics {
    request_counts: BTreeMap<(String, String, RequestOutcome), u64>,
    queue_depth: BTreeMap<String, u64>,
    restart_count: BTreeMap<String, u64>,
    breaker_transitions: BTreeMap<(String, String), u64>,
    latency_ms: BTreeMap<(String, String), Vec<u64>>,
}

impl PluginMetrics {
    pub fn record_request(
        &mut self,
        plugin_id: &str,
        method_name: &str,
        outcome: RequestOutcome,
        latency_ms: u64,
    ) {
        *self
            .request_counts
            .entry((plugin_id.to_string(), method_name.to_string(), outcome))
            .or_default() += 1;
        self.latency_ms
            .entry((plugin_id.to_string(), method_name.to_string()))
            .or_default()
            .push(latency_ms);
    }

    pub fn set_queue_depth(&mut self, plugin_id: &str, depth: u64) {
        self.queue_depth.insert(plugin_id.to_string(), depth);
    }

    pub fn record_restart(&mut self, plugin_id: &str) {
        *self.restart_count.entry(plugin_id.to_string()).or_default() += 1;
    }

    pub fn record_breaker_transition(&mut self, plugin_id: &str, transition: &str) {
        *self
            .breaker_transitions
            .entry((plugin_id.to_string(), transition.to_string()))
            .or_default() += 1;
    }

    pub fn request_count(
        &self,
        plugin_id: &str,
        method_name: &str,
        outcome: RequestOutcome,
    ) -> u64 {
        *self
            .request_counts
            .get(&(plugin_id.to_string(), method_name.to_string(), outcome))
            .unwrap_or(&0)
    }

    pub fn queue_depth(&self, plugin_id: &str) -> u64 {
        *self.queue_depth.get(plugin_id).unwrap_or(&0)
    }

    pub fn restart_count(&self, plugin_id: &str) -> u64 {
        *self.restart_count.get(plugin_id).unwrap_or(&0)
    }

    pub fn breaker_transition_count(&self, plugin_id: &str, transition: &str) -> u64 {
        *self
            .breaker_transitions
            .get(&(plugin_id.to_string(), transition.to_string()))
            .unwrap_or(&0)
    }
}

#[cfg(test)]
mod tests {
    use super::{PluginMetrics, RequestOutcome};

    #[test]
    fn metrics_increment_on_success_and_failure() {
        let mut metrics = PluginMetrics::default();

        metrics.record_request("quote-plugin", "GetPrice", RequestOutcome::Success, 14);
        metrics.record_request("quote-plugin", "GetPrice", RequestOutcome::TypedError, 18);
        metrics.record_request(
            "quote-plugin",
            "GetPrice",
            RequestOutcome::FrameworkFailure,
            40,
        );
        metrics.set_queue_depth("quote-plugin", 3);
        metrics.record_restart("quote-plugin");
        metrics.record_breaker_transition("quote-plugin", "closed_to_open");

        assert_eq!(
            metrics.request_count("quote-plugin", "GetPrice", RequestOutcome::Success),
            1
        );
        assert_eq!(
            metrics.request_count("quote-plugin", "GetPrice", RequestOutcome::TypedError),
            1
        );
        assert_eq!(
            metrics.request_count(
                "quote-plugin",
                "GetPrice",
                RequestOutcome::FrameworkFailure
            ),
            1
        );
        assert_eq!(metrics.queue_depth("quote-plugin"), 3);
        assert_eq!(metrics.restart_count("quote-plugin"), 1);
        assert_eq!(
            metrics.breaker_transition_count("quote-plugin", "closed_to_open"),
            1
        );
    }
}
