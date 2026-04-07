use bytes::{Bytes, BytesMut};
use prost::Message;

use crate::control::{ControlMessage, FrameworkError, FrameworkErrorCode};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceContext {
    pub trace_id: String,
    pub span_id: String,
    pub trace_flags: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolMessage {
    RpcRequest {
        request_id: u64,
        method_id: u32,
        payload: Bytes,
        trace_context: Option<TraceContext>,
    },
    RpcResponse {
        request_id: u64,
        payload: Bytes,
        trace_context: Option<TraceContext>,
    },
    Control {
        request_id: u64,
        message: ControlMessage,
        trace_context: Option<TraceContext>,
    },
    Error {
        request_id: u64,
        error: FrameworkError,
        trace_context: Option<TraceContext>,
    },
}

#[derive(Debug)]
pub enum ProtocolError {
    Decode(prost::DecodeError),
    UnsupportedVersion(u32),
    MissingBody,
    UnknownControlMessage(i32),
    UnknownFrameworkErrorCode(i32),
}

impl core::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Decode(error) => write!(f, "failed to decode protocol envelope: {error}"),
            Self::UnsupportedVersion(version) => {
                write!(f, "unsupported protocol version: {version}")
            }
            Self::MissingBody => write!(f, "protocol envelope missing body"),
            Self::UnknownControlMessage(value) => {
                write!(f, "unknown control message kind: {value}")
            }
            Self::UnknownFrameworkErrorCode(value) => {
                write!(f, "unknown framework error code: {value}")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

impl From<prost::DecodeError> for ProtocolError {
    fn from(value: prost::DecodeError) -> Self {
        Self::Decode(value)
    }
}

pub fn encode_envelope(message: &ProtocolMessage) -> Bytes {
    let envelope = WireEnvelope::from_message(message);
    let mut buffer = BytesMut::with_capacity(envelope.encoded_len());
    envelope
        .encode(&mut buffer)
        .expect("encoding an in-memory wire envelope should not fail");
    buffer.freeze()
}

pub fn decode_envelope(bytes: &[u8]) -> Result<ProtocolMessage, ProtocolError> {
    let envelope = WireEnvelope::decode(bytes)?;
    envelope.into_message()
}

#[derive(Clone, PartialEq, Message)]
struct WireTraceContext {
    #[prost(string, tag = "1")]
    trace_id: String,
    #[prost(string, tag = "2")]
    span_id: String,
    #[prost(uint32, tag = "3")]
    trace_flags: u32,
}

#[derive(Clone, PartialEq, Message)]
struct WireRpcRequest {
    #[prost(uint32, tag = "1")]
    method_id: u32,
    #[prost(bytes = "bytes", tag = "2")]
    payload: Bytes,
}

#[derive(Clone, PartialEq, Message)]
struct WireRpcResponse {
    #[prost(bytes = "bytes", tag = "1")]
    payload: Bytes,
}

#[derive(Clone, PartialEq, Message)]
struct WireControl {
    #[prost(int32, tag = "1")]
    kind: i32,
}

#[derive(Clone, PartialEq, Message)]
struct WireFrameworkError {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
}

#[derive(Clone, PartialEq, Message)]
struct WireEnvelope {
    #[prost(uint32, tag = "1")]
    protocol_version: u32,
    #[prost(uint64, tag = "2")]
    request_id: u64,
    #[prost(message, optional, tag = "3")]
    trace_context: Option<WireTraceContext>,
    #[prost(oneof = "wire_envelope::Body", tags = "4, 5, 6, 7")]
    body: Option<wire_envelope::Body>,
}

mod wire_envelope {
    use super::{WireControl, WireFrameworkError, WireRpcRequest, WireRpcResponse};
    use prost::Oneof;

    #[derive(Clone, PartialEq, Oneof)]
    pub enum Body {
        #[prost(message, tag = "4")]
        RpcRequest(WireRpcRequest),
        #[prost(message, tag = "5")]
        RpcResponse(WireRpcResponse),
        #[prost(message, tag = "6")]
        Control(WireControl),
        #[prost(message, tag = "7")]
        FrameworkError(WireFrameworkError),
    }
}

impl WireEnvelope {
    fn from_message(message: &ProtocolMessage) -> Self {
        match message {
            ProtocolMessage::RpcRequest {
                request_id,
                method_id,
                payload,
                trace_context,
            } => Self {
                protocol_version: PROTOCOL_VERSION,
                request_id: *request_id,
                trace_context: trace_context.clone().map(WireTraceContext::from),
                body: Some(wire_envelope::Body::RpcRequest(WireRpcRequest {
                    method_id: *method_id,
                    payload: payload.clone(),
                })),
            },
            ProtocolMessage::RpcResponse {
                request_id,
                payload,
                trace_context,
            } => Self {
                protocol_version: PROTOCOL_VERSION,
                request_id: *request_id,
                trace_context: trace_context.clone().map(WireTraceContext::from),
                body: Some(wire_envelope::Body::RpcResponse(WireRpcResponse {
                    payload: payload.clone(),
                })),
            },
            ProtocolMessage::Control {
                request_id,
                message,
                trace_context,
            } => Self {
                protocol_version: PROTOCOL_VERSION,
                request_id: *request_id,
                trace_context: trace_context.clone().map(WireTraceContext::from),
                body: Some(wire_envelope::Body::Control(WireControl {
                    kind: message.to_wire(),
                })),
            },
            ProtocolMessage::Error {
                request_id,
                error,
                trace_context,
            } => Self {
                protocol_version: PROTOCOL_VERSION,
                request_id: *request_id,
                trace_context: trace_context.clone().map(WireTraceContext::from),
                body: Some(wire_envelope::Body::FrameworkError(WireFrameworkError {
                    code: error.code.to_wire(),
                    message: error.message.clone(),
                })),
            },
        }
    }

    fn into_message(self) -> Result<ProtocolMessage, ProtocolError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(self.protocol_version));
        }

        let trace_context = self.trace_context.map(TraceContext::from);

        match self.body.ok_or(ProtocolError::MissingBody)? {
            wire_envelope::Body::RpcRequest(request) => Ok(ProtocolMessage::RpcRequest {
                request_id: self.request_id,
                method_id: request.method_id,
                payload: request.payload,
                trace_context,
            }),
            wire_envelope::Body::RpcResponse(response) => Ok(ProtocolMessage::RpcResponse {
                request_id: self.request_id,
                payload: response.payload,
                trace_context,
            }),
            wire_envelope::Body::Control(control) => {
                let message = ControlMessage::from_wire(control.kind)
                    .ok_or(ProtocolError::UnknownControlMessage(control.kind))?;
                Ok(ProtocolMessage::Control {
                    request_id: self.request_id,
                    message,
                    trace_context,
                })
            }
            wire_envelope::Body::FrameworkError(error) => {
                let code = FrameworkErrorCode::from_wire(error.code)
                    .ok_or(ProtocolError::UnknownFrameworkErrorCode(error.code))?;
                Ok(ProtocolMessage::Error {
                    request_id: self.request_id,
                    error: FrameworkError {
                        code,
                        message: error.message,
                    },
                    trace_context,
                })
            }
        }
    }
}

impl From<TraceContext> for WireTraceContext {
    fn from(value: TraceContext) -> Self {
        Self {
            trace_id: value.trace_id,
            span_id: value.span_id,
            trace_flags: value.trace_flags,
        }
    }
}

impl From<WireTraceContext> for TraceContext {
    fn from(value: WireTraceContext) -> Self {
        Self {
            trace_id: value.trace_id,
            span_id: value.span_id,
            trace_flags: value.trace_flags,
        }
    }
}
