//! End-to-end harness for validating Rust host and plugin runtime behavior.

#![cfg(unix)]

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub struct PluginProcessSpec<'a> {
    pub manifest_json: &'a str,
    pub entrypoint_relative: &'a str,
    pub descriptor_relative: &'a str,
    pub service_name: &'a str,
    pub kv_json: Option<String>,
}

pub struct RunningPluginProcess {
    child: Child,
    socket_path: PathBuf,
}

impl RunningPluginProcess {
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    pub fn kill(&mut self) {
        self.child.kill().expect("runtime process should terminate");
        let _ = self.child.wait();
        std::fs::remove_file(&self.socket_path).ok();
    }
}

impl Drop for RunningPluginProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        std::fs::remove_file(&self.socket_path).ok();
    }
}

pub fn build_workspace_targets(targets: &[&str]) {
    run_workspace_command(["install"]);
    for target in targets {
        run_workspace_command(["--filter", *target, "build"]);
    }
}

pub fn spawn_plugin_process(spec: PluginProcessSpec<'_>) -> RunningPluginProcess {
    let workspace_root = workspace_root();
    let socket_path = temp_socket_path("plugin-e2e");
    let runtime_process = workspace_root.join("packages/plugin-runtime/dist/src/process-main.js");
    let plugin_entry = workspace_root.join(spec.entrypoint_relative);
    let descriptor_path = workspace_root.join(spec.descriptor_relative);

    let mut command = Command::new("node");
    command
        .arg(runtime_process)
        .current_dir(&workspace_root)
        .env("BALANCE_PLUGIN_SOCKET_PATH", &socket_path)
        .env("BALANCE_PLUGIN_MANIFEST_JSON", spec.manifest_json)
        .env("BALANCE_PLUGIN_ENTRYPOINT", plugin_entry)
        .env("BALANCE_PLUGIN_DESCRIPTOR_PATH", descriptor_path)
        .env("BALANCE_PLUGIN_SERVICE_NAME", spec.service_name);

    if let Some(kv_json) = spec.kv_json {
        command.env("BALANCE_PLUGIN_KV_JSON", kv_json);
    }

    let child = command
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("runtime process should spawn");

    wait_for_socket(&socket_path);
    RunningPluginProcess { child, socket_path }
}

pub fn run_workspace_command<TArgs, TArg>(args: TArgs)
where
    TArgs: IntoIterator<Item = TArg>,
    TArg: AsRef<OsStr>,
{
    let status = Command::new("pnpm")
        .args(args)
        .current_dir(workspace_root())
        .status()
        .expect("workspace command should start");

    assert!(status.success(), "workspace command failed: {status}");
}

pub fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate directory should have a parent")
        .parent()
        .expect("workspace path should exist")
        .to_path_buf()
}

pub fn wait_for_socket(socket_path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if socket_path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }

    panic!("runtime socket {:?} was not created in time", socket_path);
}

pub fn temp_socket_path(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{unique}.sock"))
}
