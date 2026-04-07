//! Installed-plugin manifest parsing and in-memory registry state.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::Deserialize;

use crate::circuit_breaker::CircuitBreakerState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Controls when a plugin runtime is activated.
pub enum ActivationMode {
    Lazy,
    Startup,
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Declares how a runtime may process concurrent requests.
pub enum ConcurrencyMode {
    Serial,
    ParallelSafe,
    MaxConcurrency(u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Static observability defaults carried from the installed manifest.
pub struct ObservabilityConfig {
    pub emit_logs: bool,
    pub emit_traces: bool,
    pub emit_metrics: bool,
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            emit_logs: true,
            emit_traces: true,
            emit_metrics: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Host-facing view of the installed `manifest.json` artifact.
pub struct PluginManifest {
    pub id: String,
    pub version: String,
    pub main: String,
    pub source_map: Option<String>,
    pub descriptor_set: String,
    pub service: String,
    pub activation_mode: ActivationMode,
    pub concurrency: ConcurrencyMode,
    pub init_timeout_ms: u64,
    pub request_timeout_ms: u64,
    pub idle_eviction_ms: Option<u64>,
    pub observability: ObservabilityConfig,
}

impl PluginManifest {
    /// Creates a minimal lazy-activation manifest for tests and examples.
    pub fn lazy(id: &str) -> Self {
        Self::new_with_activation(id, ActivationMode::Lazy)
    }

    /// Creates a minimal startup-activation manifest for tests and examples.
    pub fn startup(id: &str) -> Self {
        Self::new_with_activation(id, ActivationMode::Startup)
    }

    /// Loads and normalizes a packaged `manifest.json` from an installed plugin directory.
    pub fn from_installed_path(
        installed_path: impl AsRef<Path>,
    ) -> Result<Self, PluginManifestLoadError> {
        let manifest_path = installed_path.as_ref().join("manifest.json");
        let contents = fs::read_to_string(&manifest_path)
            .map_err(|source| PluginManifestLoadError::Read {
                path: manifest_path.clone(),
                source,
            })?;
        let raw: RawPluginManifest = serde_json::from_str(&contents).map_err(|source| {
            PluginManifestLoadError::Parse {
                path: manifest_path.clone(),
                source,
            }
        })?;

        Ok(Self {
            id: raw.id,
            version: raw.version,
            main: raw.main,
            source_map: raw.source_map,
            descriptor_set: raw.contract.descriptor_set,
            service: raw.contract.service,
            activation_mode: raw.runtime.activation.mode.into(),
            concurrency: raw.runtime.concurrency.into(),
            init_timeout_ms: raw.runtime.init_timeout_ms,
            request_timeout_ms: raw.runtime.request_timeout_ms,
            idle_eviction_ms: raw.runtime.idle_eviction_ms,
            observability: raw.observability.unwrap_or_default().into(),
        })
    }

    fn new_with_activation(id: &str, activation_mode: ActivationMode) -> Self {
        Self {
            id: id.to_string(),
            version: "0.1.0".to_string(),
            main: "./dist/index.js".to_string(),
            source_map: None,
            descriptor_set: "./descriptors/contracts.binpb".to_string(),
            service: String::new(),
            activation_mode,
            concurrency: ConcurrencyMode::Serial,
            init_timeout_ms: 5_000,
            request_timeout_ms: 10_000,
            idle_eviction_ms: None,
            observability: ObservabilityConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Runtime health state tracked by the registry.
pub enum ActivationStatus {
    Inactive,
    Ready,
    Unhealthy,
}

#[derive(Debug)]
/// Mutable registry entry for a single installed plugin.
pub struct PluginRegistryEntry {
    pub manifest: PluginManifest,
    pub installed_path: PathBuf,
    pub activation_status: ActivationStatus,
    pub circuit_breaker_state: CircuitBreakerState,
    pub next_retry_at: Option<Instant>,
    pub runtime_active: bool,
    pub last_activity_at: Option<Instant>,
}

#[derive(Debug)]
/// In-memory registry of installed plugins known to the host.
pub struct PluginRegistry {
    entries: BTreeMap<String, PluginRegistryEntry>,
}

impl PluginRegistry {
    /// Creates a registry from already-loaded manifest/path pairs.
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
                        last_activity_at: None,
                    },
                )
            })
            .collect();

        Self { entries }
    }

    /// Creates a registry by loading `manifest.json` files from installed plugin directories.
    pub fn from_installed_paths(
        installed_paths: impl IntoIterator<Item = PathBuf>,
    ) -> Result<Self, PluginManifestLoadError> {
        let mut entries = Vec::new();
        for installed_path in installed_paths {
            let manifest = PluginManifest::from_installed_path(&installed_path)?;
            entries.push((manifest, installed_path));
        }
        Ok(Self::from_entries(entries))
    }

    /// Returns a mutable entry by plugin identifier.
    pub fn entry_mut(&mut self, plugin_id: &str) -> Option<&mut PluginRegistryEntry> {
        self.entries.get_mut(plugin_id)
    }

    /// Returns the current activation status for a plugin, if present.
    pub fn status(&self, plugin_id: &str) -> Option<ActivationStatus> {
        self.entries
            .get(plugin_id)
            .map(|entry| entry.activation_status)
    }

    /// Lists plugin identifiers that should be activated at host startup.
    pub fn startup_plugin_ids(&self) -> Vec<String> {
        self.entries
            .values()
            .filter(|entry| entry.manifest.activation_mode == ActivationMode::Startup)
            .map(|entry| entry.manifest.id.clone())
            .collect()
    }

    /// Lists all registered plugin identifiers.
    pub fn plugin_ids(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    /// Marks a plugin inactive without removing its registry entry.
    pub fn deactivate(&mut self, plugin_id: &str) -> bool {
        if let Some(entry) = self.entries.get_mut(plugin_id) {
            entry.activation_status = ActivationStatus::Inactive;
            entry.runtime_active = false;
            entry.next_retry_at = None;
            return true;
        }

        false
    }
}

#[derive(Debug)]
/// Failures that can occur while loading installed manifests from disk.
pub enum PluginManifestLoadError {
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
}

impl core::fmt::Display for PluginManifestLoadError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Read { path, source } => {
                write!(f, "failed to read plugin manifest {}: {source}", path.display())
            }
            Self::Parse { path, source } => {
                write!(f, "failed to parse plugin manifest {}: {source}", path.display())
            }
        }
    }
}

impl std::error::Error for PluginManifestLoadError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifest {
    id: String,
    version: String,
    main: String,
    #[serde(default)]
    source_map: Option<String>,
    contract: RawContract,
    runtime: RawRuntime,
    #[serde(default)]
    observability: Option<RawObservability>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawContract {
    descriptor_set: String,
    service: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRuntime {
    activation: RawActivation,
    concurrency: RawConcurrency,
    init_timeout_ms: u64,
    request_timeout_ms: u64,
    #[serde(default)]
    idle_eviction_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawActivation {
    mode: RawActivationMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RawActivationMode {
    Lazy,
    Startup,
}

impl From<RawActivationMode> for ActivationMode {
    fn from(value: RawActivationMode) -> Self {
        match value {
            RawActivationMode::Lazy => Self::Lazy,
            RawActivationMode::Startup => Self::Startup,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
enum RawConcurrency {
    #[serde(rename = "serial")]
    Serial,
    #[serde(rename = "parallel-safe")]
    ParallelSafe,
    #[serde(rename = "max_concurrency")]
    MaxConcurrency {
        #[serde(rename = "maxConcurrency")]
        max_concurrency: u32,
    },
}

impl From<RawConcurrency> for ConcurrencyMode {
    fn from(value: RawConcurrency) -> Self {
        match value {
            RawConcurrency::Serial => Self::Serial,
            RawConcurrency::ParallelSafe => Self::ParallelSafe,
            RawConcurrency::MaxConcurrency { max_concurrency } => {
                Self::MaxConcurrency(max_concurrency)
            }
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawObservability {
    #[serde(default = "default_true")]
    emit_logs: bool,
    #[serde(default = "default_true")]
    emit_traces: bool,
    #[serde(default = "default_true")]
    emit_metrics: bool,
}

impl From<RawObservability> for ObservabilityConfig {
    fn from(value: RawObservability) -> Self {
        Self {
            emit_logs: value.emit_logs,
            emit_traces: value.emit_traces,
            emit_metrics: value.emit_metrics,
        }
    }
}

fn default_true() -> bool {
    true
}
