//! Length-delimited framing for protocol envelopes on socket transports.

use bytes::BytesMut;
use tokio_util::codec::{Decoder, Encoder, LengthDelimitedCodec};

use crate::envelope::{ProtocolError, ProtocolMessage, decode_envelope, encode_envelope};

#[derive(Debug)]
pub struct PluginFrameCodec {
    inner: LengthDelimitedCodec,
}

impl Default for PluginFrameCodec {
    fn default() -> Self {
        Self {
            inner: LengthDelimitedCodec::new(),
        }
    }
}

impl Encoder<ProtocolMessage> for PluginFrameCodec {
    type Error = std::io::Error;

    fn encode(&mut self, item: ProtocolMessage, dst: &mut BytesMut) -> Result<(), Self::Error> {
        let bytes = encode_envelope(&item);
        self.inner.encode(bytes, dst)
    }
}

impl Decoder for PluginFrameCodec {
    type Item = ProtocolMessage;
    type Error = ProtocolCodecError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        match self.inner.decode(src)? {
            Some(frame) => Ok(Some(decode_envelope(&frame)?)),
            None => Ok(None),
        }
    }
}

#[derive(Debug)]
pub enum ProtocolCodecError {
    Io(std::io::Error),
    Protocol(ProtocolError),
}

impl core::fmt::Display for ProtocolCodecError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "io error while decoding protocol frame: {error}"),
            Self::Protocol(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ProtocolCodecError {}

impl From<std::io::Error> for ProtocolCodecError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<ProtocolError> for ProtocolCodecError {
    fn from(value: ProtocolError) -> Self {
        Self::Protocol(value)
    }
}
