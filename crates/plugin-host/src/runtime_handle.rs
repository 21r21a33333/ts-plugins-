//! Abstractions for starting runtimes and delivering Init configuration into them.

use std::collections::BTreeMap;

use plugin_kv::{HostKvConfig, RuntimeKvConfig};

use crate::registry::PluginManifest;

#[derive(Debug, Clone, PartialEq, Eq)]
/// Host-provided runtime configuration supplied during Init.
pub struct HostRuntimeConfig {
    environment: String,
    config: BTreeMap<String, String>,
    kv: HostKvConfig,
}

impl HostRuntimeConfig {
    /// Builds a runtime config with explicit environment, init config, and KV backend.
    pub fn new(
        environment: impl Into<String>,
        config: BTreeMap<String, String>,
        kv: HostKvConfig,
    ) -> Self {
        Self {
            environment: environment.into(),
            config,
            kv,
        }
    }

    /// Creates a local-development config backed by in-memory KV.
    pub fn memory_for_local() -> Self {
        Self::new("local", BTreeMap::new(), HostKvConfig::memory())
    }

    /// Renders the Init payload for a specific plugin manifest.
    pub fn init_context_for(&self, manifest: &PluginManifest) -> RuntimeInitContext {
        RuntimeInitContext {
            plugin_instance_id: manifest.id.clone(),
            environment: self.environment.clone(),
            config: self.config.clone(),
            kv: self.kv.render_runtime_config(&manifest.id, Some(&manifest.id)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Serialized Init payload delivered to the runtime.
pub struct RuntimeInitContext {
    pub plugin_instance_id: String,
    pub environment: String,
    pub config: BTreeMap<String, String>,
    pub kv: RuntimeKvConfig,
}

/// Handle to a live runtime instance owned by the host.
pub trait RuntimeHandle {
    /// Performs the required Init handshake for the runtime.
    fn init(&mut self, init_context: &RuntimeInitContext) -> Result<(), String>;
    /// Gracefully shuts the runtime down when the host deactivates or evicts it.
    fn shutdown(&mut self) -> Result<(), String>;
}

/// Factory that creates runtime handles for installed plugins.
pub trait RuntimeFactory {
    /// Starts a runtime process or connection for the plugin at the installed path.
    fn start(
        &mut self,
        manifest: &PluginManifest,
        installed_path: &std::path::Path,
    ) -> Result<Box<dyn RuntimeHandle>, String>;
}
