#![cfg(unix)]

use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use plugin_host::{DynamicMethod, PluginHost, UnixSocketTransport};

mod quote_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/quote/v1/balance.plugins.quote.v1.rs"
    ));
}

#[test]
fn quote_plugin_runtime_serves_requests_across_the_real_process_boundary() {
    run_workspace_command(["install"]);
    run_workspace_command(["--filter", "@balance/plugin-generated", "build"]);
    run_workspace_command(["--filter", "@balance/plugin-codegen", "build"]);
    run_workspace_command(["--filter", "@balance/plugin-runtime", "build"]);
    run_workspace_command(["--filter", "@balance/example-quote-plugin", "build"]);

    let workspace_root = workspace_root();
    let socket_path = temp_socket_path("quote-plugin-e2e");
    let mut child = spawn_quote_plugin_process(&workspace_root, &socket_path);

    wait_for_socket(&socket_path);

    let transport = UnixSocketTransport::connect(&socket_path).expect("transport should connect");
    let mut host = PluginHost::new(transport);

    let init_response: quote_v1::InitResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/Init",
            ),
            &quote_v1::InitRequest {
                plugin_instance_id: "quote-plugin".into(),
                environment: "test".into(),
                config: [("currency".to_string(), "EUR".to_string())].into_iter().collect(),
            },
        )
        .expect("init should succeed");

    assert!(matches!(
        init_response.outcome,
        Some(quote_v1::init_response::Outcome::Ok(_))
    ));

    let quote_response: quote_v1::GetPriceResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/GetPrice",
            ),
            &quote_v1::GetPriceRequest {
                asset: "BTC".into(),
                amount: "0.5".into(),
            },
        )
        .expect("get price should succeed");

    match quote_response.outcome {
        Some(quote_v1::get_price_response::Outcome::Ok(success)) => {
            assert_eq!(success.price, "BTC:0.5");
            assert_eq!(success.currency, "EUR");
        }
        other => panic!("expected ok quote response, received {other:?}"),
    }

    child.kill().expect("runtime process should terminate");
    let _ = child.wait();
    std::fs::remove_file(&socket_path).ok();
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate directory should have a parent")
        .parent()
        .expect("workspace path should exist")
        .to_path_buf()
}

fn spawn_quote_plugin_process(workspace_root: &Path, socket_path: &Path) -> Child {
    let runtime_process = workspace_root.join("packages/plugin-runtime/dist/src/process-main.js");
    let plugin_entry = workspace_root.join("examples/quote-plugin/dist/src/index.js");
    let service_module = workspace_root.join("examples/quote-plugin/dist/gen/plugin-handlers.js");

    Command::new("node")
        .arg(runtime_process)
        .current_dir(workspace_root)
        .env("BALANCE_PLUGIN_SOCKET_PATH", socket_path)
        .env(
            "BALANCE_PLUGIN_MANIFEST_JSON",
            r#"{"id":"quote-plugin","version":"0.1.0"}"#,
        )
        .env("BALANCE_PLUGIN_ENTRYPOINT", plugin_entry)
        .env("BALANCE_PLUGIN_SERVICE_MODULE", service_module)
        .env("BALANCE_PLUGIN_SERVICE_EXPORT", "quotePluginMetadata")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("runtime process should spawn")
}

fn wait_for_socket(socket_path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if socket_path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }

    panic!("runtime socket {:?} was not created in time", socket_path);
}

fn run_workspace_command(args: impl IntoIterator<Item = &'static str>) {
    let status = Command::new("pnpm")
        .args(args)
        .current_dir(workspace_root())
        .status()
        .expect("workspace command should start");

    assert!(status.success(), "workspace command failed: {status}");
}

fn temp_socket_path(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{unique}.sock"))
}
