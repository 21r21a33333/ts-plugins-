//! Rust host control plane for the plugin platform.

mod activation;
mod circuit_breaker;
mod client;
mod dynamic;
mod health;
mod registry;
mod runtime_handle;
mod supervisor;
#[cfg(unix)]
mod unix_socket;

pub use activation::{ActivationError, ActivationManager, Clock, MockClock};
pub use circuit_breaker::{CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState};
pub use client::{PluginHost, PluginHostError, PluginTransport};
pub use dynamic::{DynamicMethod, stable_method_id};
pub use health::RuntimeHealth;
pub use registry::{
    ActivationMode, ActivationStatus, PluginManifest, PluginRegistry,
    PluginRegistryEntry,
};
pub use runtime_handle::{HostRuntimeConfig, RuntimeFactory, RuntimeHandle, RuntimeInitContext};
pub use supervisor::{
    RuntimeSupervisor, SupervisorError, SupervisorProcessFactory, SupervisorRuntime,
    TokioProcessFactory,
};
#[cfg(unix)]
pub use unix_socket::UnixSocketTransport;
