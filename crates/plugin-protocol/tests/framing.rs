use bytes::{Bytes, BytesMut};
use plugin_protocol::{
    ControlMessage,
    FrameworkError,
    FrameworkErrorCode,
    PluginFrameCodec,
    ProtocolMessage,
    TraceContext,
    decode_envelope,
    encode_envelope,
};
use tokio_util::codec::{Decoder, Encoder};

#[test]
fn rpc_request_round_trips_through_the_length_delimited_codec() {
    let mut codec = PluginFrameCodec::default();
    let mut buffer = BytesMut::new();
    let message = ProtocolMessage::RpcRequest {
        request_id: 42,
        method_id: 7,
        payload: Bytes::from_static(b"hello"),
        trace_context: Some(TraceContext {
            trace_id: "trace-1".into(),
            span_id: "span-1".into(),
            trace_flags: 1,
        }),
    };

    codec
        .encode(message.clone(), &mut buffer)
        .expect("frame should encode");

    let decoded = codec
        .decode(&mut buffer)
        .expect("frame should decode")
        .expect("frame should be present");

    assert_eq!(decoded, message);
}

#[test]
fn truncated_frames_do_not_decode_until_complete() {
    let mut codec = PluginFrameCodec::default();
    let mut encoded = BytesMut::new();

    codec
        .encode(
            ProtocolMessage::RpcResponse {
                request_id: 99,
                payload: Bytes::from_static(b"world"),
                trace_context: None,
            },
            &mut encoded,
        )
        .expect("frame should encode");

    let truncated = encoded.split_to(encoded.len() - 1);
    let mut truncated = BytesMut::from(truncated.as_ref());

    let decoded = codec.decode(&mut truncated).expect("truncated decode should not error");

    assert!(decoded.is_none());
}

#[test]
fn invalid_protocol_versions_are_rejected() {
    let message = ProtocolMessage::RpcRequest {
        request_id: 1,
        method_id: 9,
        payload: Bytes::from_static(b"payload"),
        trace_context: None,
    };
    let mut encoded = encode_envelope(&message).to_vec();
    encoded[1] = 2;

    let error = decode_envelope(&encoded).expect_err("decode should reject unexpected versions");

    assert!(error.to_string().contains("protocol version"));
}

#[test]
fn control_messages_stay_separate_from_rpc_traffic() {
    let message = ProtocolMessage::Control {
        request_id: 5,
        message: ControlMessage::Shutdown,
        trace_context: Some(TraceContext {
            trace_id: "trace-control".into(),
            span_id: "span-control".into(),
            trace_flags: 1,
        }),
    };

    let decoded = decode_envelope(&encode_envelope(&message)).expect("control frame should decode");

    assert_eq!(decoded, message);
    assert_ne!(
        decoded,
        ProtocolMessage::Error {
            request_id: 5,
            error: FrameworkError {
                code: FrameworkErrorCode::Timeout,
                message: "timed out".into(),
            },
            trace_context: None,
        }
    );
}
