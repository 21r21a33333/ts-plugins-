#![cfg(unix)]

use std::{
    fs,
    io::{Read, Write},
    os::unix::net::UnixListener,
    path::PathBuf,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use plugin_host::{DynamicMethod, PluginHost, UnixSocketTransport};
use plugin_protocol::{decode_envelope, encode_envelope, ProtocolMessage};
use prost::Message;

#[allow(dead_code)]
mod quote_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/quote/v1/balance.plugins.quote.v1.rs"
    ));
}

#[test]
fn unix_socket_transport_round_trips_a_typed_host_call() {
    let socket_path = temp_socket_path("plugin-host-transport");
    let listener = UnixListener::bind(&socket_path).expect("socket should bind");

    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("client should connect");
        let request = read_frame(&mut stream);
        let request = decode_envelope(&request).expect("request should decode");

        match request {
            ProtocolMessage::RpcRequest {
                request_id,
                method_id,
                payload,
                ..
            } => {
                assert_eq!(method_id, 758_358_830);

                let request = quote_v1::GetPriceRequest::decode(payload).expect("request payload should decode");
                assert_eq!(request.asset, "BTC");
                assert_eq!(request.amount, "1.5");

                let response = ProtocolMessage::RpcResponse {
                    request_id,
                    payload: encode_message(&quote_v1::GetPriceResponse {
                        outcome: Some(quote_v1::get_price_response::Outcome::Ok(
                            quote_v1::GetPriceSuccess {
                                price: "64321.00".into(),
                                currency: "USD".into(),
                                expires_at: "2030-01-01T00:00:00Z".into(),
                            },
                        )),
                    }),
                    trace_context: None,
                };

                write_frame(&mut stream, &encode_envelope(&response));
            }
            other => panic!("expected rpc request, received {other:?}"),
        }
    });

    let transport = UnixSocketTransport::connect(&socket_path).expect("transport should connect");
    let mut host = PluginHost::new(transport);

    let response: quote_v1::GetPriceResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/GetPrice",
            ),
            &quote_v1::GetPriceRequest {
                asset: "BTC".into(),
                amount: "1.5".into(),
            },
        )
        .expect("transport call should succeed");

    match response.outcome {
        Some(quote_v1::get_price_response::Outcome::Ok(success)) => {
            assert_eq!(success.price, "64321.00");
            assert_eq!(success.currency, "USD");
        }
        other => panic!("expected ok response, received {other:?}"),
    }

    server.join().expect("server thread should finish");
    fs::remove_file(&socket_path).ok();
}

fn temp_socket_path(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{unique}.sock"))
}

fn read_frame(stream: &mut std::os::unix::net::UnixStream) -> Vec<u8> {
    let mut len = [0_u8; 4];
    stream.read_exact(&mut len).expect("frame length should read");
    let length = u32::from_be_bytes(len) as usize;
    let mut payload = vec![0_u8; length];
    stream.read_exact(&mut payload).expect("frame payload should read");
    payload
}

fn write_frame(stream: &mut std::os::unix::net::UnixStream, payload: &[u8]) {
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .expect("frame length should write");
    stream.write_all(payload).expect("frame payload should write");
    stream.flush().expect("frame should flush");
}

fn encode_message(message: &impl prost::Message) -> Bytes {
    let mut buffer = Vec::new();
    message.encode(&mut buffer).expect("message should encode");
    Bytes::from(buffer)
}
