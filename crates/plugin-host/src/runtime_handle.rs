use std::collections::BTreeMap;

use plugin_kv::{HostKvConfig, RuntimeKvConfig};

use crate::registry::PluginManifest;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostRuntimeConfig {
    environment: String,
    config: BTreeMap<String, String>,
    kv: HostKvConfig,
}

impl HostRuntimeConfig {
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

    pub fn memory_for_local() -> Self {
        Self::new("local", BTreeMap::new(), HostKvConfig::memory())
    }

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
pub struct RuntimeInitContext {
    pub plugin_instance_id: String,
    pub environment: String,
    pub config: BTreeMap<String, String>,
    pub kv: RuntimeKvConfig,
}

pub trait RuntimeHandle {
    fn init(&mut self, init_context: &RuntimeInitContext) -> Result<(), String>;
}

pub trait RuntimeFactory {
    fn start(
        &mut self,
        manifest: &PluginManifest,
        installed_path: &std::path::Path,
    ) -> Result<Box<dyn RuntimeHandle>, String>;
}
