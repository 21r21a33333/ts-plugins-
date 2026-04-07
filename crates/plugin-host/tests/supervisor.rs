use plugin_host::{
    CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState, Clock, MockClock,
    PluginManifest, RuntimeSupervisor, SupervisorProcessFactory, SupervisorRuntime,
};
use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};

#[test]
fn runtime_crash_triggers_restart() {
    let starts = Rc::new(RefCell::new(Vec::new()));
    let factory = FakeProcessFactory::new(
        vec![Ok(FakeRuntime::dead_after_start()), Ok(FakeRuntime::healthy())],
        starts.clone(),
    );
    let clock = MockClock::default();
    let mut supervisor = RuntimeSupervisor::new(
        PluginManifest::lazy("quote-plugin"),
        PathBuf::from("/plugins/quote-plugin/1.0.0"),
        factory,
        clock,
        CircuitBreakerConfig::new(3, Duration::from_secs(30)),
    );

    supervisor.start().expect("initial start should succeed");
    supervisor
        .probe()
        .expect("dead runtime should restart and recover");

    assert_eq!(supervisor.health().restart_count, 1);
    assert_eq!(*starts.borrow(), vec!["quote-plugin".to_string(), "quote-plugin".to_string()]);
}

#[test]
fn repeated_failures_open_the_circuit_breaker() {
    let clock = MockClock::default();
    let mut supervisor = RuntimeSupervisor::new(
        PluginManifest::lazy("quote-plugin"),
        PathBuf::from("/plugins/quote-plugin/1.0.0"),
        FakeProcessFactory::new(vec![], Rc::new(RefCell::new(Vec::new()))),
        clock.clone(),
        CircuitBreakerConfig::new(2, Duration::from_secs(30)),
    );

    supervisor.record_failure("boom");
    assert_eq!(supervisor.circuit_breaker().state(clock.now()), CircuitBreakerState::Closed);

    supervisor.record_failure("boom again");
    assert_eq!(supervisor.circuit_breaker().state(clock.now()), CircuitBreakerState::Open);
}

#[test]
fn half_open_probes_allow_recovery() {
    let clock = MockClock::default();
    let mut breaker = CircuitBreaker::new(CircuitBreakerConfig::new(2, Duration::from_secs(30)));

    breaker.record_failure(clock.now());
    breaker.record_failure(clock.now());
    assert_eq!(breaker.state(clock.now()), CircuitBreakerState::Open);

    clock.advance(Duration::from_secs(31));

    assert!(breaker.allow_request(clock.now()));
    assert_eq!(breaker.state(clock.now()), CircuitBreakerState::HalfOpen);

    breaker.record_success(clock.now());
    assert_eq!(breaker.state(clock.now()), CircuitBreakerState::Closed);
}

#[test]
fn timeout_contributes_to_breaker_metrics() {
    let clock = MockClock::default();
    let mut supervisor = RuntimeSupervisor::new(
        PluginManifest::lazy("quote-plugin"),
        PathBuf::from("/plugins/quote-plugin/1.0.0"),
        FakeProcessFactory::new(vec![], Rc::new(RefCell::new(Vec::new()))),
        clock.clone(),
        CircuitBreakerConfig::new(2, Duration::from_secs(30)),
    );

    supervisor.record_timeout();
    supervisor.record_timeout();

    assert_eq!(supervisor.health().timeout_count, 2);
    assert_eq!(supervisor.circuit_breaker().state(clock.now()), CircuitBreakerState::Open);
}

#[derive(Debug)]
struct FakeRuntime {
    alive: bool,
}

impl FakeRuntime {
    fn healthy() -> Self {
        Self { alive: true }
    }

    fn dead_after_start() -> Self {
        Self { alive: false }
    }
}

impl SupervisorRuntime for FakeRuntime {
    fn handshake(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn ping(&mut self) -> Result<(), String> {
        if self.alive {
            Ok(())
        } else {
            Err("runtime exited".to_string())
        }
    }

    fn shutdown(&mut self) -> Result<(), String> {
        self.alive = false;
        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive
    }
}

#[derive(Debug)]
struct FakeProcessFactory {
    runtimes: Vec<Result<FakeRuntime, String>>,
    starts: Rc<RefCell<Vec<String>>>,
}

impl FakeProcessFactory {
    fn new(
        runtimes: Vec<Result<FakeRuntime, String>>,
        starts: Rc<RefCell<Vec<String>>>,
    ) -> Self {
        Self { runtimes, starts }
    }
}

impl SupervisorProcessFactory for FakeProcessFactory {
    fn start(
        &mut self,
        manifest: &PluginManifest,
        _installed_path: &Path,
    ) -> Result<Box<dyn SupervisorRuntime>, String> {
        self.starts.borrow_mut().push(manifest.id.clone());
        let runtime = self
            .runtimes
            .remove(0);
        match runtime {
            Ok(runtime) => Ok(Box::new(runtime)),
            Err(error) => Err(error),
        }
    }
}
