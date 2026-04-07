#![cfg(unix)]

use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

use plugin_e2e_harness::{
    build_workspace_targets, read_manifest_json, spawn_plugin_process, PluginProcessSpec,
};
use plugin_host::{DynamicMethod, PluginHost, UnixSocketTransport};

mod http_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/http/v1/balance.plugins.http.v1.rs"
    ));
}

#[test]
fn http_demo_plugin_fetches_a_local_api_end_to_end() {
    build_workspace_targets(&[
        "@balance/plugin-generated",
        "@balance/plugin-codegen",
        "@balance/plugin-runtime",
        "@balance/example-http-plugin",
    ]);

    let listener = TcpListener::bind("127.0.0.1:0").expect("http listener should bind");
    let address = listener.local_addr().expect("listener address should resolve");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("http client should connect");
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request).expect("request should read");
        let body = r#"{"title":"demo todo","body":"served from local test"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("response should write");
        stream.flush().expect("response should flush");
    });

    let mut runtime = spawn_plugin_process(PluginProcessSpec {
        manifest_json: read_manifest_json("examples/http-plugin/plugin.json"),
        entrypoint_relative: "examples/http-plugin/dist/src/index.js",
        descriptor_relative: "descriptors/contracts.binpb",
        service_name: "balance.plugins.http.v1.HttpPluginService",
        kv_json: None,
    });

    let transport = UnixSocketTransport::connect(runtime.socket_path()).expect("transport should connect");
    let mut host = PluginHost::new(transport);

    let _: http_v1::InitResponse = host
        .invoke(
            DynamicMethod::from_canonical_name("balance.plugins.http.v1.HttpPluginService/Init"),
            &http_v1::InitRequest {
                plugin_instance_id: "http-plugin".into(),
                environment: "test".into(),
                config: Default::default(),
            },
        )
        .expect("init should succeed");

    let response: http_v1::FetchTodoResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.http.v1.HttpPluginService/FetchTodo",
            ),
            &http_v1::FetchTodoRequest {
                url: format!("http://{address}/todos/1"),
            },
        )
        .expect("fetch should succeed");

    match response.outcome {
        Some(http_v1::fetch_todo_response::Outcome::Ok(success)) => {
            assert_eq!(success.status, 200);
            assert_eq!(success.title, "demo todo");
            assert_eq!(success.body, "served from local test");
        }
        other => panic!("expected ok fetch response, received {other:?}"),
    }

    runtime.kill();
    server.join().expect("http server should stop");
}
