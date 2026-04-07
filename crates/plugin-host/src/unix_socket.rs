#![cfg(unix)]
//! Unix domain socket transport for host-to-runtime RPC traffic.


use std::{
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::Path,
};

use plugin_protocol::{decode_envelope, encode_envelope, ProtocolMessage};

use crate::{PluginHostError, PluginTransport};

#[derive(Debug)]
pub struct UnixSocketTransport {
    stream: UnixStream,
}

impl UnixSocketTransport {
    pub fn connect(socket_path: impl AsRef<Path>) -> Result<Self, PluginHostError> {
        let stream = UnixStream::connect(socket_path)
            .map_err(|error| PluginHostError::Transport(error.to_string()))?;
        Ok(Self { stream })
    }
}

impl PluginTransport for UnixSocketTransport {
    fn send(&mut self, message: ProtocolMessage) -> Result<ProtocolMessage, PluginHostError> {
        let payload = encode_envelope(&message);
        self.stream
            .write_all(&(payload.len() as u32).to_be_bytes())
            .map_err(|error| PluginHostError::Transport(error.to_string()))?;
        self.stream
            .write_all(&payload)
            .map_err(|error| PluginHostError::Transport(error.to_string()))?;
        self.stream
            .flush()
            .map_err(|error| PluginHostError::Transport(error.to_string()))?;

        let mut len = [0_u8; 4];
        self.stream
            .read_exact(&mut len)
            .map_err(|error| PluginHostError::Transport(error.to_string()))?;
        let frame_len = u32::from_be_bytes(len) as usize;
        let mut frame = vec![0_u8; frame_len];
        self.stream
            .read_exact(&mut frame)
            .map_err(|error| PluginHostError::Transport(error.to_string()))?;

        decode_envelope(&frame).map_err(|error| PluginHostError::Transport(error.to_string()))
    }
}
