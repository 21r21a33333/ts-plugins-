use std::{
    collections::BTreeMap,
    path::PathBuf,
    time::Instant,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationMode {
    Lazy,
    Startup,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginManifest {
    pub id: String,
    pub activation_mode: ActivationMode,
}

impl PluginManifest {
    pub fn lazy(id: &str) -> Self {
        Self {
            id: id.to_string(),
            activation_mode: ActivationMode::Lazy,
        }
    }

    pub fn startup(id: &str) -> Self {
        Self {
            id: id.to_string(),
            activation_mode: ActivationMode::Startup,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivationStatus {
    Inactive,
    Ready,
    Unhealthy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitBreakerState {
    Closed,
}

#[derive(Debug)]
pub struct PluginRegistryEntry {
    pub manifest: PluginManifest,
    pub installed_path: PathBuf,
    pub activation_status: ActivationStatus,
    pub circuit_breaker_state: CircuitBreakerState,
    pub next_retry_at: Option<Instant>,
    pub runtime_active: bool,
}

#[derive(Debug)]
pub struct PluginRegistry {
    entries: BTreeMap<String, PluginRegistryEntry>,
}

impl PluginRegistry {
    pub fn from_entries(
        entries: impl IntoIterator<Item = (PluginManifest, PathBuf)>,
    ) -> Self {
        let entries = entries
            .into_iter()
            .map(|(manifest, installed_path)| {
                let id = manifest.id.clone();
                (
                    id,
                    PluginRegistryEntry {
                        manifest,
                        installed_path,
                        activation_status: ActivationStatus::Inactive,
                        circuit_breaker_state: CircuitBreakerState::Closed,
                        next_retry_at: None,
                        runtime_active: false,
                    },
                )
            })
            .collect();

        Self { entries }
    }

    pub fn entry_mut(&mut self, plugin_id: &str) -> Option<&mut PluginRegistryEntry> {
        self.entries.get_mut(plugin_id)
    }

    pub fn status(&self, plugin_id: &str) -> Option<ActivationStatus> {
        self.entries
            .get(plugin_id)
            .map(|entry| entry.activation_status)
    }

    pub fn startup_plugin_ids(&self) -> Vec<String> {
        self.entries
            .values()
            .filter(|entry| entry.manifest.activation_mode == ActivationMode::Startup)
            .map(|entry| entry.manifest.id.clone())
            .collect()
    }
}
