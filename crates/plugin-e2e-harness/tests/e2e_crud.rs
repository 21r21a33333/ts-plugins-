#![cfg(unix)]

use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use plugin_e2e_harness::{build_workspace_targets, spawn_plugin_process, PluginProcessSpec};
use plugin_host::{DynamicMethod, PluginHost, UnixSocketTransport};
use redis::Commands;
use serde_json::json;

#[allow(dead_code)]
mod crud_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/crud/v1/balance.plugins.crud.v1.rs"
    ));
}

#[test]
fn crud_demo_plugin_persists_db_state_and_redis_kv_across_restart() {
    build_workspace_targets(&[
        "@balance/plugin-generated",
        "@balance/plugin-codegen",
        "@balance/plugin-runtime",
        "@balance/example-crud-plugin",
    ]);

    let (mut redis_process, redis_url) = spawn_redis_server();
    let kv_json = json!({
        "backend": {
            "kind": "redis",
            "url": redis_url,
        },
        "namespacePrefix": "balance:test:crud-plugin"
    })
    .to_string();
    let db_path = temp_file_path("crud-plugin", "sqlite");

    let mut runtime = spawn_plugin_process(PluginProcessSpec {
        manifest_json: r#"{"id":"crud-plugin","version":"0.1.0"}"#,
        entrypoint_relative: "examples/crud-plugin/dist/src/index.js",
        service_module_relative: "examples/crud-plugin/dist/gen/plugin-handlers.js",
        service_export_name: "crudPluginMetadata",
        kv_json: Some(kv_json.clone()),
    });

    let transport = UnixSocketTransport::connect(runtime.socket_path()).expect("transport should connect");
    let mut host = PluginHost::new(transport);
    init_crud_plugin(&mut host, &db_path);

    let create_response: crud_v1::CreateNoteResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.crud.v1.CrudPluginService/CreateNote",
            ),
            &crud_v1::CreateNoteRequest {
                id: "note-1".into(),
                title: "First".into(),
                body: "Created before restart".into(),
            },
        )
        .expect("create should succeed");

    assert!(matches!(
        create_response.outcome,
        Some(crud_v1::create_note_response::Outcome::Ok(_))
    ));
    runtime.kill();

    let redis_client = redis::Client::open(redis_url.clone()).expect("redis client should open");
    let mut redis = redis_client
        .get_connection()
        .expect("redis connection should succeed");
    let mutation_count: String = redis
        .get("balance:test:crud-plugin:data:mutation_count")
        .expect("mutation count should be stored");
    assert_eq!(mutation_count, "1");
    let last_note_id: String = redis
        .get("balance:test:crud-plugin:data:last_note_id")
        .expect("last note id should be stored");
    assert_eq!(last_note_id, "\"note-1\"");

    let mut runtime = spawn_plugin_process(PluginProcessSpec {
        manifest_json: r#"{"id":"crud-plugin","version":"0.1.0"}"#,
        entrypoint_relative: "examples/crud-plugin/dist/src/index.js",
        service_module_relative: "examples/crud-plugin/dist/gen/plugin-handlers.js",
        service_export_name: "crudPluginMetadata",
        kv_json: Some(kv_json),
    });

    let transport = UnixSocketTransport::connect(runtime.socket_path()).expect("transport should reconnect");
    let mut host = PluginHost::new(transport);
    init_crud_plugin(&mut host, &db_path);

    let first_get: crud_v1::GetNoteResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.crud.v1.CrudPluginService/GetNote",
            ),
            &crud_v1::GetNoteRequest {
                id: "note-1".into(),
            },
        )
        .expect("get should succeed after restart");
    assert!(matches!(
        first_get.outcome,
        Some(crud_v1::get_note_response::Outcome::Ok(_))
    ));

    let second_get: crud_v1::GetNoteResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.crud.v1.CrudPluginService/GetNote",
            ),
            &crud_v1::GetNoteRequest {
                id: "note-1".into(),
            },
        )
        .expect("second get should succeed");
    assert!(matches!(
        second_get.outcome,
        Some(crud_v1::get_note_response::Outcome::Ok(_))
    ));

    let update_response: crud_v1::UpdateNoteResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.crud.v1.CrudPluginService/UpdateNote",
            ),
            &crud_v1::UpdateNoteRequest {
                id: "note-1".into(),
                title: "Updated".into(),
                body: "Changed after restart".into(),
            },
        )
        .expect("update should succeed");

    match update_response.outcome {
        Some(crud_v1::update_note_response::Outcome::Ok(note)) => {
            assert_eq!(note.version, 2);
            assert_eq!(note.title, "Updated");
        }
        other => panic!("expected ok update response, received {other:?}"),
    }

    let list_response: crud_v1::ListNotesResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.crud.v1.CrudPluginService/ListNotes",
            ),
            &crud_v1::ListNotesRequest {},
        )
        .expect("list should succeed");

    match list_response.outcome {
        Some(crud_v1::list_notes_response::Outcome::Ok(success)) => {
            assert_eq!(success.notes.len(), 1);
            assert_eq!(success.cache_hits, 1);
        }
        other => panic!("expected ok list response, received {other:?}"),
    }

    let mutation_count: String = redis
        .get("balance:test:crud-plugin:data:mutation_count")
        .expect("mutation count should still be readable");
    assert_eq!(mutation_count, "2");

    runtime.kill();
    let _ = redis_process.kill();
    let _ = redis_process.wait();
    std::fs::remove_file(&db_path).ok();
}

fn init_crud_plugin(host: &mut PluginHost<UnixSocketTransport>, db_path: &PathBuf) {
    let _: crud_v1::InitResponse = host
        .invoke(
            DynamicMethod::from_canonical_name("balance.plugins.crud.v1.CrudPluginService/Init"),
            &crud_v1::InitRequest {
                plugin_instance_id: "crud-plugin".into(),
                environment: "test".into(),
                config: [(
                    "dbPath".to_string(),
                    db_path.to_string_lossy().into_owned(),
                )]
                .into_iter()
                .collect(),
            },
        )
        .expect("init should succeed");
}

fn spawn_redis_server() -> (Child, String) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("temporary listener should bind");
    let port = listener.local_addr().expect("port should resolve").port();
    drop(listener);

    let child = Command::new("redis-server")
        .arg("--port")
        .arg(port.to_string())
        .arg("--save")
        .arg("")
        .arg("--appendonly")
        .arg("no")
        .arg("--bind")
        .arg("127.0.0.1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("redis-server should start");

    let url = format!("redis://127.0.0.1:{port}/0");
    for _ in 0..50 {
        if redis::Client::open(url.clone())
            .and_then(|client| client.get_connection())
            .is_ok()
        {
            return (child, url);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    panic!("redis-server did not become ready in time");
}

fn temp_file_path(prefix: &str, extension: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{unique}.{extension}"))
}
