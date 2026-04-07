use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RedisKvConfig {
    pub url: String,
}

impl RedisKvConfig {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into() }
    }
}
