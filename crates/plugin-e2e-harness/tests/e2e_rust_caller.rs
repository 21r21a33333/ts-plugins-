#![cfg(unix)]

use std::process::Command;

use plugin_e2e_harness::{build_workspace_targets, spawn_plugin_process, PluginProcessSpec};

#[test]
fn rust_caller_example_invokes_a_live_plugin_process() {
    build_workspace_targets(&[
        "@balance/plugin-generated",
        "@balance/plugin-codegen",
        "@balance/plugin-runtime",
        "@balance/example-quote-plugin",
    ]);

    let mut runtime = spawn_plugin_process(PluginProcessSpec {
        manifest_json: r#"{"id":"quote-plugin","version":"0.1.0"}"#,
        entrypoint_relative: "examples/quote-plugin/dist/src/index.js",
        descriptor_relative: "descriptors/contracts.binpb",
        service_name: "balance.plugins.quote.v1.QuotePluginService",
        kv_json: None,
    });

    let output = Command::new("cargo")
        .args([
            "run",
            "--quiet",
            "--manifest-path",
            "examples/rust-caller/Cargo.toml",
            "--",
            "--socket",
            runtime.socket_path().to_str().expect("socket path should be utf-8"),
            "--asset",
            "BTC",
            "--amount",
            "0.25",
            "--currency",
            "EUR",
        ])
        .current_dir(plugin_e2e_harness::workspace_root())
        .output()
        .expect("rust caller example should run");

    assert!(
        output.status.success(),
        "rust caller should exit successfully: stdout={:?} stderr={:?}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf-8");
    assert!(stdout.contains("\"price\": \"BTC:0.25\""));
    assert!(stdout.contains("\"currency\": \"EUR\""));

    runtime.kill();
}
