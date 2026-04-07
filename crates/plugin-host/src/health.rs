#[derive(Debug, Clone, Default)]
pub struct RuntimeHealth {
    pub restart_count: u32,
    pub timeout_count: u32,
    pub failure_count: u32,
}
