use std::{
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};

use crate::{
    registry::{ActivationStatus, PluginRegistry},
    runtime_handle::{HostRuntimeConfig, RuntimeFactory},
};

#[derive(Debug, Clone)]
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
    pub fn advance(&self, duration: Duration) {
        let updated = *self.now.borrow() + duration;
        *self.now.borrow_mut() = updated;
    }
}

pub trait Clock: Clone {
    fn now(&self) -> Instant;
}

impl Clock for MockClock {
    fn now(&self) -> Instant {
        *self.now.borrow()
    }
}

#[derive(Debug)]
pub struct ActivationManager<TFactory, TClock> {
    registry: PluginRegistry,
    runtime_factory: TFactory,
    clock: TClock,
    retry_backoff: Duration,
    runtime_config: HostRuntimeConfig,
}

impl<TFactory, TClock> ActivationManager<TFactory, TClock>
where
    TFactory: RuntimeFactory,
    TClock: Clock,
{
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
            clock,
            retry_backoff,
            runtime_config,
        }
    }

    pub fn ensure_active(&mut self, plugin_id: &str) -> Result<bool, ActivationError> {
        let now = self.clock.now();
        let entry = self
            .registry
            .entry_mut(plugin_id)
            .ok_or_else(|| ActivationError::UnknownPlugin(plugin_id.to_string()))?;

        if entry.activation_status == ActivationStatus::Ready {
            return Ok(false);
        }

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
        Ok(true)
    }

    pub fn activate_startup_plugins(&mut self) -> Result<Vec<String>, ActivationError> {
        let mut activated = Vec::new();
        for plugin_id in self.registry.startup_plugin_ids() {
            if self.ensure_active(&plugin_id)? {
                activated.push(plugin_id);
            }
        }
        Ok(activated)
    }

    pub fn registry(&self) -> &PluginRegistry {
        &self.registry
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationError {
    UnknownPlugin(String),
    RuntimeStart(String),
    InitializationFailed { plugin_id: String, message: String },
    BackoffActive { plugin_id: String },
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
        }
    }
}

impl std::error::Error for ActivationError {}
