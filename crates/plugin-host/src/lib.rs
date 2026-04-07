//! Rust host control plane for the plugin platform.

mod client;
mod dynamic;

pub use client::{PluginHost, PluginHostError, PluginTransport};
pub use dynamic::{DynamicMethod, stable_method_id};
