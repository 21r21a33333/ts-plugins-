//! Rust host control plane for the plugin platform.

mod activation;
mod client;
mod dynamic;
mod registry;
mod runtime_handle;

pub use activation::{ActivationError, ActivationManager, Clock, MockClock};
pub use client::{PluginHost, PluginHostError, PluginTransport};
pub use dynamic::{DynamicMethod, stable_method_id};
pub use registry::{
    ActivationMode, ActivationStatus, CircuitBreakerState, PluginManifest, PluginRegistry,
    PluginRegistryEntry,
};
pub use runtime_handle::{RuntimeFactory, RuntimeHandle};
