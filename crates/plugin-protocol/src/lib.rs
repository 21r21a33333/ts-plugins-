//! Shared protocol primitives for Rust host and runtime transport.

mod control;
mod envelope;
mod framing;

pub use control::{ControlMessage, FrameworkError, FrameworkErrorCode};
pub use envelope::{
    PROTOCOL_VERSION, ProtocolError, ProtocolMessage, TraceContext, decode_envelope,
    encode_envelope,
};
pub use framing::{PluginFrameCodec, ProtocolCodecError};
