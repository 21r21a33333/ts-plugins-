pub trait RuntimeHandle {
    fn init(&mut self) -> Result<(), String>;
}

pub trait RuntimeFactory {
    fn start(
        &mut self,
        manifest: &crate::registry::PluginManifest,
        installed_path: &std::path::Path,
    ) -> Result<Box<dyn RuntimeHandle>, String>;
}
