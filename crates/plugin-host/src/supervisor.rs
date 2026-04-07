//! Runtime process supervision, health tracking, and restart probing.

use std::path::{Path, PathBuf};

use tokio::process::{Child, Command};

use crate::{
    circuit_breaker::{CircuitBreaker, CircuitBreakerConfig},
    health::RuntimeHealth,
    registry::PluginManifest,
    Clock,
};

pub trait SupervisorRuntime {
    fn handshake(&mut self) -> Result<(), String>;
    fn ping(&mut self) -> Result<(), String>;
    fn shutdown(&mut self) -> Result<(), String>;
    fn is_alive(&self) -> bool;
}

pub trait SupervisorProcessFactory {
    fn start(
        &mut self,
        manifest: &PluginManifest,
        installed_path: &Path,
    ) -> Result<Box<dyn SupervisorRuntime>, String>;
}

pub struct RuntimeSupervisor<TFactory, TClock> {
    manifest: PluginManifest,
    installed_path: PathBuf,
    process_factory: TFactory,
    clock: TClock,
    circuit_breaker: CircuitBreaker,
    health: RuntimeHealth,
    runtime: Option<Box<dyn SupervisorRuntime>>,
}

impl<TFactory, TClock> RuntimeSupervisor<TFactory, TClock>
where
    TFactory: SupervisorProcessFactory,
    TClock: Clock,
{
    pub fn new(
        manifest: PluginManifest,
        installed_path: PathBuf,
        process_factory: TFactory,
        clock: TClock,
        circuit_breaker_config: CircuitBreakerConfig,
    ) -> Self {
        Self {
            manifest,
            installed_path,
            process_factory,
            clock,
            circuit_breaker: CircuitBreaker::new(circuit_breaker_config),
            health: RuntimeHealth::default(),
            runtime: None,
        }
    }

    pub fn start(&mut self) -> Result<(), SupervisorError> {
        self.start_runtime()
    }

    pub fn probe(&mut self) -> Result<(), SupervisorError> {
        let now = self.clock.now();
        if !self.circuit_breaker.allow_request(now) {
            return Err(SupervisorError::CircuitOpen);
        }

        let runtime_needs_restart = match self.runtime.as_mut() {
            Some(runtime) => !runtime.is_alive() || runtime.ping().is_err(),
            None => true,
        };

        if runtime_needs_restart {
            self.health.restart_count += 1;
            self.runtime = None;
            self.start_runtime()?;
        }

        self.circuit_breaker.record_success(now);
        Ok(())
    }

    pub fn shutdown(&mut self) -> Result<(), SupervisorError> {
        if let Some(runtime) = self.runtime.as_mut() {
            runtime.shutdown().map_err(SupervisorError::Shutdown)?;
        }
        self.runtime = None;
        Ok(())
    }

    pub fn record_failure(&mut self, _message: &str) {
        self.health.failure_count += 1;
        self.circuit_breaker.record_failure(self.clock.now());
    }

    pub fn record_timeout(&mut self) {
        self.health.timeout_count += 1;
        self.health.failure_count += 1;
        self.circuit_breaker.record_failure(self.clock.now());
    }

    pub fn circuit_breaker(&self) -> &CircuitBreaker {
        &self.circuit_breaker
    }

    pub fn health(&self) -> &RuntimeHealth {
        &self.health
    }

    fn start_runtime(&mut self) -> Result<(), SupervisorError> {
        let mut runtime = self
            .process_factory
            .start(&self.manifest, &self.installed_path)
            .map_err(SupervisorError::Start)?;
        runtime.handshake().map_err(SupervisorError::Handshake)?;
        self.runtime = Some(runtime);
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisorError {
    Start(String),
    Handshake(String),
    Shutdown(String),
    CircuitOpen,
}

impl core::fmt::Display for SupervisorError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Start(message) => write!(f, "failed to start runtime: {message}"),
            Self::Handshake(message) => write!(f, "failed runtime handshake: {message}"),
            Self::Shutdown(message) => write!(f, "failed runtime shutdown: {message}"),
            Self::CircuitOpen => write!(f, "circuit breaker is open"),
        }
    }
}

impl std::error::Error for SupervisorError {}

#[derive(Debug, Clone)]
pub struct TokioProcessFactory {
    program: String,
    args: Vec<String>,
}

impl TokioProcessFactory {
    pub fn new(program: impl Into<String>, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }
}

impl SupervisorProcessFactory for TokioProcessFactory {
    fn start(
        &mut self,
        _manifest: &PluginManifest,
        installed_path: &Path,
    ) -> Result<Box<dyn SupervisorRuntime>, String> {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        command.current_dir(installed_path);
        let child = command.spawn().map_err(|error| error.to_string())?;

        Ok(Box::new(TokioChildRuntime { child: Some(child) }))
    }
}

#[derive(Debug)]
struct TokioChildRuntime {
    child: Option<Child>,
}

impl SupervisorRuntime for TokioChildRuntime {
    fn handshake(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn ping(&mut self) -> Result<(), String> {
        if self.is_alive() {
            Ok(())
        } else {
            Err("runtime process is not alive".to_string())
        }
    }

    fn shutdown(&mut self) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            child.start_kill().map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.child
            .as_ref()
            .and_then(|child| child.id())
            .is_some()
    }
}
