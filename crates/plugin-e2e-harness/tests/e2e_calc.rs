#![cfg(unix)]

use plugin_e2e_harness::{build_workspace_targets, spawn_plugin_process, PluginProcessSpec};
use plugin_host::{DynamicMethod, PluginHost, UnixSocketTransport};

mod calc_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/calc/v1/balance.plugins.calc.v1.rs"
    ));
}

#[test]
fn calculation_demo_plugin_adds_numbers_end_to_end() {
    build_workspace_targets(&[
        "@balance/plugin-generated",
        "@balance/plugin-codegen",
        "@balance/plugin-runtime",
        "@balance/example-calculation-plugin",
    ]);

    let mut runtime = spawn_plugin_process(PluginProcessSpec {
        manifest_json: r#"{"id":"calculation-plugin","version":"0.1.0"}"#,
        entrypoint_relative: "examples/calculation-plugin/dist/src/index.js",
        descriptor_relative: "descriptors/contracts.binpb",
        service_name: "balance.plugins.calc.v1.CalcPluginService",
        kv_json: None,
    });

    let transport = UnixSocketTransport::connect(runtime.socket_path()).expect("transport should connect");
    let mut host = PluginHost::new(transport);

    let _: calc_v1::InitResponse = host
        .invoke(
            DynamicMethod::from_canonical_name("balance.plugins.calc.v1.CalcPluginService/Init"),
            &calc_v1::InitRequest {
                plugin_instance_id: "calculation-plugin".into(),
                environment: "test".into(),
                config: Default::default(),
            },
        )
        .expect("init should succeed");

    let response: calc_v1::AddResponse = host
        .invoke(
            DynamicMethod::from_canonical_name("balance.plugins.calc.v1.CalcPluginService/Add"),
            &calc_v1::AddRequest { left: 13.0, right: 29.5 },
        )
        .expect("add should succeed");

    match response.outcome {
        Some(calc_v1::add_response::Outcome::Ok(success)) => {
            assert!((success.sum - 42.5).abs() < f64::EPSILON);
        }
        other => panic!("expected ok add response, received {other:?}"),
    }

    runtime.kill();
}
