//! Host-managed KV backend configuration and adapters.

mod config;
mod memory;
mod redis;

pub use config::{HostKvConfig, KvBackend, KvNamespacePolicy, RuntimeKvBackend, RuntimeKvConfig};
pub use memory::MemoryKvConfig;
pub use redis::RedisKvConfig;
