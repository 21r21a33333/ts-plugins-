use plugin_host::{
    ActivationManager, ActivationStatus, MockClock, PluginManifest, PluginRegistry,
    RuntimeFactory, RuntimeHandle,
};
use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};

#[test]
fn first_call_triggers_lazy_activation() {
    let starts = Rc::new(RefCell::new(Vec::new()));
    let factory = FakeRuntimeFactory::new(
        vec![Ok(FakeRuntime::succeeds())],
        starts.clone(),
    );
    let mut manager = ActivationManager::new(
        PluginRegistry::from_entries([(
            PluginManifest::lazy("quote-plugin"),
            PathBuf::from("/plugins/quote-plugin/1.0.0"),
        )]),
        factory,
        MockClock::default(),
        Duration::from_secs(30),
    );

    let activated = manager
        .ensure_active("quote-plugin")
        .expect("activation should succeed");

    assert!(activated);
    assert_eq!(*starts.borrow(), vec!["quote-plugin".to_string()]);
    assert_eq!(
        manager.registry().status("quote-plugin"),
        Some(ActivationStatus::Ready)
    );
}

#[test]
fn startup_plugins_activate_on_host_boot() {
    let starts = Rc::new(RefCell::new(Vec::new()));
    let factory = FakeRuntimeFactory::new(
        vec![Ok(FakeRuntime::succeeds())],
        starts.clone(),
    );
    let mut manager = ActivationManager::new(
        PluginRegistry::from_entries([(
            PluginManifest::startup("quote-plugin"),
            PathBuf::from("/plugins/quote-plugin/1.0.0"),
        )]),
        factory,
        MockClock::default(),
        Duration::from_secs(30),
    );

    let activated = manager
        .activate_startup_plugins()
        .expect("startup activation should succeed");

    assert_eq!(activated, vec!["quote-plugin".to_string()]);
    assert_eq!(*starts.borrow(), vec!["quote-plugin".to_string()]);
}

#[test]
fn failed_init_keeps_the_plugin_unhealthy() {
    let starts = Rc::new(RefCell::new(Vec::new()));
    let factory = FakeRuntimeFactory::new(
        vec![Ok(FakeRuntime::fails("init failed"))],
        starts.clone(),
    );
    let mut manager = ActivationManager::new(
        PluginRegistry::from_entries([(
            PluginManifest::lazy("quote-plugin"),
            PathBuf::from("/plugins/quote-plugin/1.0.0"),
        )]),
        factory,
        MockClock::default(),
        Duration::from_secs(30),
    );

    let error = manager
        .ensure_active("quote-plugin")
        .expect_err("activation should fail");

    assert!(error.to_string().contains("init failed"));
    assert_eq!(
        manager.registry().status("quote-plugin"),
        Some(ActivationStatus::Unhealthy)
    );
    assert_eq!(*starts.borrow(), vec!["quote-plugin".to_string()]);
}

#[test]
fn activation_retries_respect_backoff() {
    let starts = Rc::new(RefCell::new(Vec::new()));
    let clock = MockClock::default();
    let factory = FakeRuntimeFactory::new(
        vec![
            Ok(FakeRuntime::fails("init failed")),
            Ok(FakeRuntime::succeeds()),
        ],
        starts.clone(),
    );
    let mut manager = ActivationManager::new(
        PluginRegistry::from_entries([(
            PluginManifest::lazy("quote-plugin"),
            PathBuf::from("/plugins/quote-plugin/1.0.0"),
        )]),
        factory,
        clock.clone(),
        Duration::from_secs(30),
    );

    manager
        .ensure_active("quote-plugin")
        .expect_err("first activation should fail");

    let immediate_retry = manager
        .ensure_active("quote-plugin")
        .expect_err("retry inside backoff window should fail");
    assert!(immediate_retry.to_string().contains("backoff"));
    assert_eq!(starts.borrow().len(), 1);

    clock.advance(Duration::from_secs(31));

    let activated = manager
        .ensure_active("quote-plugin")
        .expect("activation should succeed after backoff");

    assert!(activated);
    assert_eq!(starts.borrow().len(), 2);
    assert_eq!(
        manager.registry().status("quote-plugin"),
        Some(ActivationStatus::Ready)
    );
}

#[derive(Debug)]
struct FakeRuntime {
    init_result: Result<(), String>,
}

impl FakeRuntime {
    fn succeeds() -> Self {
        Self { init_result: Ok(()) }
    }

    fn fails(message: &str) -> Self {
        Self {
            init_result: Err(message.to_string()),
        }
    }
}

impl RuntimeHandle for FakeRuntime {
    fn init(&mut self) -> Result<(), String> {
        self.init_result.clone()
    }
}

#[derive(Debug)]
struct FakeRuntimeFactory {
    runtimes: Vec<Result<FakeRuntime, String>>,
    starts: Rc<RefCell<Vec<String>>>,
}

impl FakeRuntimeFactory {
    fn new(
        runtimes: Vec<Result<FakeRuntime, String>>,
        starts: Rc<RefCell<Vec<String>>>,
    ) -> Self {
        Self { runtimes, starts }
    }
}

impl RuntimeFactory for FakeRuntimeFactory {
    fn start(
        &mut self,
        manifest: &PluginManifest,
        _installed_path: &Path,
    ) -> Result<Box<dyn RuntimeHandle>, String> {
        self.starts.borrow_mut().push(manifest.id.clone());
        let runtime = self.runtimes.remove(0)?;
        Ok(Box::new(runtime))
    }
}
