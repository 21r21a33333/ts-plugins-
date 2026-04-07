#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlMessage {
    Ping,
    Pong,
    Shutdown,
}

impl ControlMessage {
    pub(crate) fn from_wire(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::Ping),
            1 => Some(Self::Pong),
            2 => Some(Self::Shutdown),
            _ => None,
        }
    }

    pub(crate) fn to_wire(self) -> i32 {
        match self {
            Self::Ping => 0,
            Self::Pong => 1,
            Self::Shutdown => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameworkErrorCode {
    Unknown,
    Timeout,
    ProtocolVersionMismatch,
    DecodeFailed,
}

impl FrameworkErrorCode {
    pub(crate) fn from_wire(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::Unknown),
            1 => Some(Self::Timeout),
            2 => Some(Self::ProtocolVersionMismatch),
            3 => Some(Self::DecodeFailed),
            _ => None,
        }
    }

    pub(crate) fn to_wire(self) -> i32 {
        match self {
            Self::Unknown => 0,
            Self::Timeout => 1,
            Self::ProtocolVersionMismatch => 2,
            Self::DecodeFailed => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameworkError {
    pub code: FrameworkErrorCode,
    pub message: String,
}
