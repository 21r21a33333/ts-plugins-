//! Health counters surfaced by the host for runtime inspection and policy decisions.

#[derive(Debug, Clone, Default)]
/// Rolling runtime health counters tracked by the host.
pub struct RuntimeHealth {
    pub restart_count: u32,
    pub timeout_count: u32,
    pub failure_count: u32,
}
