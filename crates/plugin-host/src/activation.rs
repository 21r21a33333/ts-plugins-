//! Activation bookkeeping for installed plugins, including retry backoff and idle eviction.

use std::{
    collections::BTreeMap,
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};

use crate::{
    registry::{ActivationStatus, PluginRegistry},
    runtime_handle::{HostRuntimeConfig, RuntimeFactory},
};

#[derive(Debug, Clone)]
/// Controllable clock used by activation tests and retry bookkeeping.
pub struct MockClock {
    now: Rc<RefCell<Instant>>,
}

impl Default for MockClock {
    fn default() -> Self {
        Self {
            now: Rc::new(RefCell::new(Instant::now())),
        }
    }
}

impl MockClock {
    /// Advances the clock by a fixed duration.
    pub fn advance(&self, duration: Duration) {
        let updated = *self.now.borrow() + duration;
        *self.now.borrow_mut() = updated;
    }
}

/// Provides the current time to activation logic.
pub trait Clock: Clone {
    /// Returns the current instant.
    fn now(&self) -> Instant;
}

impl Clock for MockClock {
    fn now(&self) -> Instant {
        *self.now.borrow()
    }
}

/// Tracks runtime activation state, retries, and idle-eviction lifecycle.
pub struct ActivationManager<TFactory, TClock> {
    registry: PluginRegistry,
    runtime_factory: TFactory,
    active_runtimes: BTreeMap<String, Box<dyn crate::runtime_handle::RuntimeHandle>>,
    clock: TClock,
    retry_backoff: Duration,
    runtime_config: HostRuntimeConfig,
}

impl<TFactory, TClock> ActivationManager<TFactory, TClock>
where
    TFactory: RuntimeFactory,
    TClock: Clock,
{
    /// Creates a new activation manager around a registry and runtime factory.
    pub fn new(
        registry: PluginRegistry,
        runtime_factory: TFactory,
        clock: TClock,
        retry_backoff: Duration,
        runtime_config: HostRuntimeConfig,
    ) -> Self {
        Self {
            registry,
            runtime_factory,
            active_runtimes: BTreeMap::new(),
            clock,
            retry_backoff,
            runtime_config,
        }
    }

    /// Ensures a plugin runtime is started and has successfully completed Init.
    pub fn ensure_active(&mut self, plugin_id: &str) -> Result<bool, ActivationError> {
        let now = self.clock.now();
        let entry = self
            .registry
            .entry_mut(plugin_id)
            .ok_or_else(|| ActivationError::UnknownPlugin(plugin_id.to_string()))?;

        if entry.activation_status == ActivationStatus::Ready {
            return Ok(false);
        }

        // Failed Init attempts enter backoff so the host does not thrash runtimes.
        if let Some(next_retry_at) = entry.next_retry_at {
            if next_retry_at > now {
                return Err(ActivationError::BackoffActive {
                    plugin_id: plugin_id.to_string(),
                });
            }
        }

        let mut runtime = self
            .runtime_factory
            .start(&entry.manifest, &entry.installed_path)
            .map_err(ActivationError::RuntimeStart)?;
        let init_context = self.runtime_config.init_context_for(&entry.manifest);

        if let Err(error) = runtime.init(&init_context) {
            entry.activation_status = ActivationStatus::Unhealthy;
            entry.runtime_active = false;
            entry.next_retry_at = Some(now + self.retry_backoff);
            return Err(ActivationError::InitializationFailed {
                plugin_id: plugin_id.to_string(),
                message: error,
            });
        }

        entry.activation_status = ActivationStatus::Ready;
        entry.runtime_active = true;
        entry.next_retry_at = None;
        entry.last_activity_at = Some(now);
        self.active_runtimes.insert(plugin_id.to_string(), runtime);
        Ok(true)
    }

    /// Activates all plugins whose manifest requests startup activation.
    pub fn activate_startup_plugins(&mut self) -> Result<Vec<String>, ActivationError> {
        let mut activated = Vec::new();
        for plugin_id in self.registry.startup_plugin_ids() {
            if self.ensure_active(&plugin_id)? {
                activated.push(plugin_id);
            }
        }
        Ok(activated)
    }

    /// Returns the underlying activation registry for inspection.
    pub fn registry(&self) -> &PluginRegistry {
        &self.registry
    }

    /// Shuts down a specific runtime and marks it inactive in the registry.
    pub fn deactivate(&mut self, plugin_id: &str) -> Result<(), ActivationError> {
        self.shutdown_runtime(plugin_id)?;
        if self.registry.deactivate(plugin_id) {
            Ok(())
        } else {
            Err(ActivationError::UnknownPlugin(plugin_id.to_string()))
        }
    }

    /// Marks the plugin as recently used so idle eviction does not remove it.
    pub fn record_activity(&mut self, plugin_id: &str) -> Result<(), ActivationError> {
        let entry = self
            .registry
            .entry_mut(plugin_id)
            .ok_or_else(|| ActivationError::UnknownPlugin(plugin_id.to_string()))?;
        entry.last_activity_at = Some(self.clock.now());
        Ok(())
    }

    /// Shuts down runtimes that have been idle longer than the configured timeout.
    pub fn evict_idle_plugins(
        &mut self,
        idle_timeout: Duration,
    ) -> Result<Vec<String>, ActivationError> {
        let now = self.clock.now();
        let mut evicted = Vec::new();

        for plugin_id in self.registry.plugin_ids() {
            let should_evict = {
                let entry = match self.registry.entry_mut(&plugin_id) {
                    Some(entry) => entry,
                    None => continue,
                };
                // Idle eviction is based on the runtime's last observed activity timestamp.
                entry.runtime_active
                    && entry
                        .last_activity_at
                        .map(|last_activity_at| now >= last_activity_at + idle_timeout)
                        .unwrap_or(false)
            };

            if should_evict {
                self.shutdown_runtime(&plugin_id)?;
                self.registry.deactivate(&plugin_id);
                evicted.push(plugin_id);
            }
        }

        evicted.sort();
        evicted.dedup();
        Ok(evicted)
    }

    fn shutdown_runtime(&mut self, plugin_id: &str) -> Result<(), ActivationError> {
        if let Some(mut runtime) = self.active_runtimes.remove(plugin_id) {
            runtime
                .shutdown()
                .map_err(|message| ActivationError::ShutdownFailed {
                    plugin_id: plugin_id.to_string(),
                    message,
                })?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Activation failures surfaced to host-side callers and tests.
pub enum ActivationError {
    UnknownPlugin(String),
    RuntimeStart(String),
    InitializationFailed { plugin_id: String, message: String },
    BackoffActive { plugin_id: String },
    ShutdownFailed { plugin_id: String, message: String },
}

impl core::fmt::Display for ActivationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::UnknownPlugin(plugin_id) => write!(f, "unknown plugin: {plugin_id}"),
            Self::RuntimeStart(message) => write!(f, "failed to start runtime: {message}"),
            Self::InitializationFailed { plugin_id, message } => {
                write!(f, "plugin {plugin_id} failed Init: {message}")
            }
            Self::BackoffActive { plugin_id } => {
                write!(f, "plugin {plugin_id} is still in activation backoff")
            }
            Self::ShutdownFailed { plugin_id, message } => {
                write!(f, "plugin {plugin_id} failed shutdown: {message}")
            }
        }
    }
}

impl std::error::Error for ActivationError {}
