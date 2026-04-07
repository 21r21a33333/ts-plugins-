use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use plugin_host::{
    ActivationMode, ConcurrencyMode, PluginManifest, PluginRegistry,
};

#[test]
fn loads_runtime_metadata_from_an_installed_manifest() {
    let install_dir = temp_install_dir("plugin-host-manifest");
    write_manifest(
        &install_dir,
        r#"{
  "schemaVersion": 1,
  "id": "quote-plugin",
  "version": "1.2.3",
  "main": "./dist/index.js",
  "sourceMap": "./dist/index.js.map",
  "contract": {
    "descriptorSet": "./descriptors/contracts.binpb",
    "service": "balance.plugins.quote.v1.QuotePluginService"
  },
  "runtime": {
    "language": "node",
    "activation": { "mode": "startup" },
    "concurrency": { "mode": "max_concurrency", "maxConcurrency": 4 },
    "initTimeoutMs": 7000,
    "requestTimeoutMs": 11000,
    "idleEvictionMs": 60000
  },
  "observability": {
    "emitLogs": true,
    "emitTraces": false,
    "emitMetrics": true
  }
}"#,
    );

    let manifest = PluginManifest::from_installed_path(&install_dir)
        .expect("installed manifest should load");

    assert_eq!(manifest.id, "quote-plugin");
    assert_eq!(manifest.version, "1.2.3");
    assert_eq!(manifest.main, "./dist/index.js");
    assert_eq!(manifest.source_map.as_deref(), Some("./dist/index.js.map"));
    assert_eq!(manifest.descriptor_set, "./descriptors/contracts.binpb");
    assert_eq!(manifest.service, "balance.plugins.quote.v1.QuotePluginService");
    assert_eq!(manifest.activation_mode, ActivationMode::Startup);
    assert_eq!(manifest.concurrency, ConcurrencyMode::MaxConcurrency(4));
    assert_eq!(manifest.init_timeout_ms, 7_000);
    assert_eq!(manifest.request_timeout_ms, 11_000);
    assert_eq!(manifest.idle_eviction_ms, Some(60_000));
    assert!(manifest.observability.emit_logs);
    assert!(!manifest.observability.emit_traces);
    assert!(manifest.observability.emit_metrics);

    fs::remove_dir_all(install_dir).ok();
}

#[test]
fn registry_can_be_created_from_installed_plugin_directories() {
    let startup_dir = temp_install_dir("plugin-host-startup");
    let lazy_dir = temp_install_dir("plugin-host-lazy");
    write_manifest(
        &startup_dir,
        r#"{
  "schemaVersion": 1,
  "id": "startup-plugin",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "contract": {
    "descriptorSet": "./descriptors/contracts.binpb",
    "service": "balance.plugins.quote.v1.QuotePluginService"
  },
  "runtime": {
    "language": "node",
    "activation": { "mode": "startup" },
    "concurrency": { "mode": "serial" },
    "initTimeoutMs": 5000,
    "requestTimeoutMs": 10000
  }
}"#,
    );
    write_manifest(
        &lazy_dir,
        r#"{
  "schemaVersion": 1,
  "id": "lazy-plugin",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "contract": {
    "descriptorSet": "./descriptors/contracts.binpb",
    "service": "balance.plugins.quote.v1.QuotePluginService"
  },
  "runtime": {
    "language": "node",
    "activation": { "mode": "lazy" },
    "concurrency": { "mode": "serial" },
    "initTimeoutMs": 5000,
    "requestTimeoutMs": 10000
  }
}"#,
    );

    let registry = PluginRegistry::from_installed_paths([
        startup_dir.clone(),
        lazy_dir.clone(),
    ])
    .expect("registry should load installed manifests");

    assert_eq!(registry.startup_plugin_ids(), vec!["startup-plugin".to_string()]);
    assert_eq!(registry.plugin_ids(), vec!["lazy-plugin".to_string(), "startup-plugin".to_string()]);

    fs::remove_dir_all(startup_dir).ok();
    fs::remove_dir_all(lazy_dir).ok();
}

fn temp_install_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
    fs::create_dir_all(&path).expect("temp install dir should be created");
    path
}

fn write_manifest(install_dir: &PathBuf, manifest: &str) {
    fs::write(install_dir.join("manifest.json"), manifest)
        .expect("manifest should be written");
}
