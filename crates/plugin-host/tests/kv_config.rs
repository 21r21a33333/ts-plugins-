use std::{
    cell::RefCell,
    collections::BTreeMap,
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};

use plugin_host::{
    ActivationManager, HostRuntimeConfig, MockClock, PluginManifest, PluginRegistry,
    RuntimeFactory, RuntimeHandle, RuntimeInitContext,
};
use plugin_kv::{HostKvConfig, KvNamespacePolicy};

#[test]
fn activation_injects_expected_kv_config_into_runtime_init() {
    let captured = Rc::new(RefCell::new(None));
    let factory = CaptureRuntimeFactory::new(captured.clone());
    let runtime_config = HostRuntimeConfig::new(
        "production",
        BTreeMap::from([(String::from("region"), String::from("ap-south-1"))]),
        HostKvConfig::redis("redis://127.0.0.1:6379/0")
            .with_namespace(KvNamespacePolicy::new("platform:plugins").include_instance_id(true)),
    );
    let mut manager = ActivationManager::new(
        PluginRegistry::from_entries([(
            PluginManifest::lazy("quote-plugin"),
            PathBuf::from("/plugins/quote-plugin/1.0.0"),
        )]),
        factory,
        MockClock::default(),
        Duration::from_secs(30),
        runtime_config,
    );

    manager
        .ensure_active("quote-plugin")
        .expect("activation should pass the init context to the runtime");

    let init_context = captured
        .borrow()
        .clone()
        .expect("runtime init context should be captured");
    assert_eq!(init_context.plugin_instance_id, "quote-plugin");
    assert_eq!(init_context.environment, "production");
    assert_eq!(
        init_context.config,
        BTreeMap::from([(String::from("region"), String::from("ap-south-1"))])
    );
    assert_eq!(
        serde_json::to_value(init_context.kv).expect("kv config should serialize"),
        serde_json::json!({
            "backend": {
                "kind": "redis",
                "url": "redis://127.0.0.1:6379/0"
            },
            "namespacePrefix": "platform:plugins:quote-plugin:quote-plugin"
        })
    );
}

#[derive(Debug)]
struct CaptureRuntimeFactory {
    captured: Rc<RefCell<Option<RuntimeInitContext>>>,
}

impl CaptureRuntimeFactory {
    fn new(captured: Rc<RefCell<Option<RuntimeInitContext>>>) -> Self {
        Self { captured }
    }
}

impl RuntimeFactory for CaptureRuntimeFactory {
    fn start(
        &mut self,
        _manifest: &PluginManifest,
        _installed_path: &Path,
    ) -> Result<Box<dyn RuntimeHandle>, String> {
        Ok(Box::new(CaptureRuntime {
            captured: self.captured.clone(),
        }))
    }
}

#[derive(Debug)]
struct CaptureRuntime {
    captured: Rc<RefCell<Option<RuntimeInitContext>>>,
}

impl RuntimeHandle for CaptureRuntime {
    fn init(&mut self, init_context: &RuntimeInitContext) -> Result<(), String> {
        *self.captured.borrow_mut() = Some(init_context.clone());
        Ok(())
    }
}
