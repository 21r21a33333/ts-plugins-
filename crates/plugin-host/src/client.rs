use bytes::Bytes;
use plugin_observability::current_trace_context;
use plugin_protocol::{FrameworkError, ProtocolMessage};
use prost::Message;

use crate::dynamic::DynamicMethod;

pub trait PluginTransport {
    fn send(&mut self, message: ProtocolMessage) -> Result<ProtocolMessage, PluginHostError>;
}

#[derive(Debug)]
pub struct PluginHost<TTransport> {
    transport: TTransport,
    next_request_id: u64,
}

impl<TTransport> PluginHost<TTransport> {
    pub fn new(transport: TTransport) -> Self {
        Self {
            transport,
            next_request_id: 1,
        }
    }
}

impl<TTransport> PluginHost<TTransport>
where
    TTransport: PluginTransport,
{
    pub fn invoke<TRequest, TResponse>(
        &mut self,
        method: DynamicMethod,
        request: &TRequest,
    ) -> Result<TResponse, PluginHostError>
    where
        TRequest: Message,
        TResponse: Message + Default,
    {
        let request_id = self.take_request_id();
        let payload = encode_request_message(request)?;

        let response = self.transport.send(ProtocolMessage::RpcRequest {
            request_id,
            method_id: method.method_id(),
            payload,
            trace_context: current_trace_context(),
        })?;

        match response {
            ProtocolMessage::RpcResponse {
                request_id: response_request_id,
                payload,
                ..
            } => {
                if response_request_id != request_id {
                    return Err(PluginHostError::UnexpectedRequestId {
                        expected: request_id,
                        actual: response_request_id,
                    });
                }

                TResponse::decode(payload)
                    .map_err(|error| PluginHostError::Decode(error.to_string()))
            }
            ProtocolMessage::Error {
                request_id: response_request_id,
                error,
                ..
            } => {
                if response_request_id != request_id {
                    return Err(PluginHostError::UnexpectedRequestId {
                        expected: request_id,
                        actual: response_request_id,
                    });
                }

                Err(PluginHostError::Framework(error))
            }
            other => Err(PluginHostError::UnexpectedMessage(other)),
        }
    }

    fn take_request_id(&mut self) -> u64 {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        request_id
    }
}

#[derive(Debug)]
pub enum PluginHostError {
    Encode(String),
    Decode(String),
    Framework(FrameworkError),
    Transport(String),
    Overloaded(String),
    Timeout { request_id: u64, timeout: std::time::Duration },
    CircuitOpen,
    UnexpectedRequestId { expected: u64, actual: u64 },
    UnexpectedMessage(ProtocolMessage),
}

impl core::fmt::Display for PluginHostError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Encode(error) => write!(f, "failed to encode request payload: {error}"),
            Self::Decode(error) => write!(f, "failed to decode response payload: {error}"),
            Self::Framework(error) => write!(
                f,
                "plugin framework error {:?}: {}",
                error.code, error.message
            ),
            Self::Transport(error) => write!(f, "transport error: {error}"),
            Self::Overloaded(error) => write!(f, "host scheduler overloaded: {error}"),
            Self::Timeout { request_id, timeout } => write!(
                f,
                "request {request_id} timed out after {}ms",
                timeout.as_millis()
            ),
            Self::CircuitOpen => write!(f, "circuit breaker is open"),
            Self::UnexpectedRequestId { expected, actual } => write!(
                f,
                "response request ID mismatch: expected {expected}, received {actual}"
            ),
            Self::UnexpectedMessage(message) => {
                write!(f, "unexpected protocol message from transport: {message:?}")
            }
        }
    }
}

impl std::error::Error for PluginHostError {}

pub(crate) fn encode_request_message(
    message: &impl Message,
) -> Result<Bytes, PluginHostError> {
    let mut buffer = Vec::new();
    message
        .encode(&mut buffer)
        .map_err(|error| PluginHostError::Encode(error.to_string()))?;
    Ok(Bytes::from(buffer))
}

pub(crate) fn decode_response_message<TResponse>(
    request_id: u64,
    response: ProtocolMessage,
) -> Result<TResponse, PluginHostError>
where
    TResponse: Message + Default,
{
    match response {
        ProtocolMessage::RpcResponse {
            request_id: response_request_id,
            payload,
            ..
        } => {
            if response_request_id != request_id {
                return Err(PluginHostError::UnexpectedRequestId {
                    expected: request_id,
                    actual: response_request_id,
                });
            }

            TResponse::decode(payload)
                .map_err(|error| PluginHostError::Decode(error.to_string()))
        }
        ProtocolMessage::Error {
            request_id: response_request_id,
            error,
            ..
        } => {
            if response_request_id != request_id {
                return Err(PluginHostError::UnexpectedRequestId {
                    expected: request_id,
                    actual: response_request_id,
                });
            }

            Err(PluginHostError::Framework(error))
        }
        other => Err(PluginHostError::UnexpectedMessage(other)),
    }
}
