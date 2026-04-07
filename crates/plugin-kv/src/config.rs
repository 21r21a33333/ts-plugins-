use serde::{Deserialize, Serialize};

use crate::{memory::MemoryKvConfig, redis::RedisKvConfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKvConfig {
    backend: KvBackend,
    namespace: KvNamespacePolicy,
}

impl HostKvConfig {
    pub fn memory() -> Self {
        Self {
            backend: KvBackend::Memory(MemoryKvConfig::default()),
            namespace: KvNamespacePolicy::default(),
        }
    }

    pub fn redis(url: impl Into<String>) -> Self {
        Self {
            backend: KvBackend::Redis(RedisKvConfig::new(url)),
            namespace: KvNamespacePolicy::default(),
        }
    }

    pub fn with_namespace(mut self, namespace: KvNamespacePolicy) -> Self {
        self.namespace = namespace;
        self
    }

    pub fn namespace(&self) -> &KvNamespacePolicy {
        &self.namespace
    }

    pub fn render_runtime_config(
        &self,
        plugin_id: &str,
        plugin_instance_id: Option<&str>,
    ) -> RuntimeKvConfig {
        RuntimeKvConfig {
            backend: match &self.backend {
                KvBackend::Memory(config) => RuntimeKvBackend::Memory(config.clone()),
                KvBackend::Redis(config) => RuntimeKvBackend::Redis(config.clone()),
            },
            namespace_prefix: self.namespace.render(plugin_id, plugin_instance_id),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KvBackend {
    Memory(MemoryKvConfig),
    Redis(RedisKvConfig),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KvNamespacePolicy {
    root_prefix: String,
    include_instance_id: bool,
}

impl KvNamespacePolicy {
    pub fn new(root_prefix: impl Into<String>) -> Self {
        Self {
            root_prefix: root_prefix.into(),
            include_instance_id: false,
        }
    }

    pub fn include_instance_id(mut self, include_instance_id: bool) -> Self {
        self.include_instance_id = include_instance_id;
        self
    }

    pub fn render(&self, plugin_id: &str, plugin_instance_id: Option<&str>) -> String {
        let mut components = vec![self.root_prefix.clone(), sanitize_component(plugin_id)];
        if self.include_instance_id {
            if let Some(instance_id) = plugin_instance_id {
                components.push(sanitize_component(instance_id));
            }
        }
        components.join(":")
    }
}

impl Default for KvNamespacePolicy {
    fn default() -> Self {
        Self::new("balance:plugins")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeKvConfig {
    pub backend: RuntimeKvBackend,
    pub namespace_prefix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RuntimeKvBackend {
    Memory(MemoryKvConfig),
    Redis(RedisKvConfig),
}

fn sanitize_component(input: &str) -> String {
    input
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '_',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{HostKvConfig, KvNamespacePolicy};

    #[test]
    fn memory_backend_config_serializes_correctly() {
        let config = HostKvConfig::memory().render_runtime_config("quote-plugin", None);

        assert_eq!(
            serde_json::to_value(config).expect("memory kv config should serialize"),
            serde_json::json!({
                "backend": { "kind": "memory" },
                "namespacePrefix": "balance:plugins:quote-plugin"
            })
        );
    }

    #[test]
    fn redis_backend_config_serializes_correctly() {
        let config = HostKvConfig::redis("redis://127.0.0.1:6379/1")
            .render_runtime_config("quote-plugin", None);

        assert_eq!(
            serde_json::to_value(config).expect("redis kv config should serialize"),
            serde_json::json!({
                "backend": {
                    "kind": "redis",
                    "url": "redis://127.0.0.1:6379/1"
                },
                "namespacePrefix": "balance:plugins:quote-plugin"
            })
        );
    }

    #[test]
    fn namespace_policy_is_deterministic() {
        let namespace = KvNamespacePolicy::new("plugins-root")
            .include_instance_id(true)
            .render("quote.plugin", Some("tenant/us-east-1"));

        assert_eq!(namespace, "plugins-root:quote_plugin:tenant_us-east-1");
    }
}
