//! Utilities for working with runtime-resolved plugin method descriptors.

#[derive(Debug, Clone, PartialEq, Eq)]
/// Stores the canonical method name alongside its stable on-the-wire identifier.
pub struct DynamicMethod {
    canonical_name: String,
    method_id: u32,
}

impl DynamicMethod {
    /// Builds a dynamic method descriptor from a fully-qualified canonical RPC name.
    pub fn from_canonical_name(canonical_name: impl Into<String>) -> Self {
        let canonical_name = canonical_name.into();
        let method_id = stable_method_id(&canonical_name);
        Self {
            canonical_name,
            method_id,
        }
    }

    /// Returns the canonical service/method name used by metadata and diagnostics.
    pub fn canonical_name(&self) -> &str {
        &self.canonical_name
    }

    /// Returns the compact method id used on the protocol hot path.
    pub fn method_id(&self) -> u32 {
        self.method_id
    }
}

/// Derives the stable method id shared by Rust and TypeScript for a canonical RPC name.
pub fn stable_method_id(canonical_name: &str) -> u32 {
    let mut hash = 0x811c9dc5_u32;

    for byte in canonical_name.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }

    if hash == 0 { 1 } else { hash }
}
