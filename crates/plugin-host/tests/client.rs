use bytes::Bytes;
use plugin_host::{DynamicMethod, PluginHost, PluginHostError, PluginTransport};
use plugin_protocol::ProtocolMessage;

mod quote_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/quote/v1/balance.plugins.quote.v1.rs"
    ));
}

#[test]
fn typed_call_serializes_the_expected_method_id() {
    let transport = RecordingTransport::respond_with(ProtocolMessage::RpcResponse {
        request_id: 1,
        payload: encode(&quote_v1::InitResponse {
            outcome: Some(quote_v1::init_response::Outcome::Ok(
                quote_v1::InitSuccess {
                    plugin_name: "quote-plugin".into(),
                    plugin_version: "1.0.0".into(),
                },
            )),
        }),
        trace_context: None,
    });
    let mut host = PluginHost::new(transport.clone());

    let _: quote_v1::InitResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/Init",
            ),
            &quote_v1::InitRequest {
                plugin_instance_id: "plugin-1".into(),
                environment: "test".into(),
                config: Default::default(),
            },
        )
        .expect("typed call should decode");

        let sent = transport.last_sent().expect("request should be recorded");
    match sent {
        ProtocolMessage::RpcRequest { method_id, .. } => {
            assert_eq!(method_id, 2_026_714_057);
        }
        other => panic!("expected rpc request, got {other:?}"),
    }
}

#[test]
fn dynamic_call_invokes_by_canonical_name() {
    let transport = RecordingTransport::respond_with(ProtocolMessage::RpcResponse {
        request_id: 1,
        payload: encode(&quote_v1::GetPriceResponse {
            outcome: Some(quote_v1::get_price_response::Outcome::Ok(
                quote_v1::GetPriceSuccess {
                    price: "42.00".into(),
                    currency: "USD".into(),
                    expires_at: "2026-04-07T00:00:00Z".into(),
                },
            )),
        }),
        trace_context: None,
    });
    let mut host = PluginHost::new(transport.clone());

    let response: quote_v1::GetPriceResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/GetPrice",
            ),
            &quote_v1::GetPriceRequest {
                asset: "BTC".into(),
                amount: "1".into(),
            },
        )
        .expect("dynamic call should decode");

    assert!(matches!(
        response.outcome,
        Some(quote_v1::get_price_response::Outcome::Ok(_))
    ));

    let sent = transport.last_sent().expect("request should be recorded");
    match sent {
        ProtocolMessage::RpcRequest { method_id, .. } => {
            assert_eq!(method_id, 758_358_830);
        }
        other => panic!("expected rpc request, got {other:?}"),
    }
}

#[test]
fn typed_domain_errors_return_cleanly() {
    let transport = RecordingTransport::respond_with(ProtocolMessage::RpcResponse {
        request_id: 1,
        payload: encode(&quote_v1::GetPriceResponse {
            outcome: Some(quote_v1::get_price_response::Outcome::Error(
                quote_v1::PluginError {
                    code: "rate_limit".into(),
                    message: "rate limited".into(),
                    details: Default::default(),
                },
            )),
        }),
        trace_context: None,
    });
    let mut host = PluginHost::new(transport);

    let response: quote_v1::GetPriceResponse = host
        .invoke(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/GetPrice",
            ),
            &quote_v1::GetPriceRequest {
                asset: "BTC".into(),
                amount: "2".into(),
            },
        )
        .expect("domain errors should decode inside the typed response");

    assert!(matches!(
        response.outcome,
        Some(quote_v1::get_price_response::Outcome::Error(_))
    ));
}

#[derive(Debug, Clone)]
struct RecordingTransport {
    sent: std::sync::Arc<std::sync::Mutex<Vec<ProtocolMessage>>>,
    response: std::sync::Arc<std::sync::Mutex<Option<ProtocolMessage>>>,
}

impl RecordingTransport {
    fn respond_with(response: ProtocolMessage) -> Self {
        Self {
            sent: Default::default(),
            response: std::sync::Arc::new(std::sync::Mutex::new(Some(response))),
        }
    }

    fn last_sent(&self) -> Option<ProtocolMessage> {
        self.sent.lock().expect("lock poisoned").last().cloned()
    }
}

impl PluginTransport for RecordingTransport {
    fn send(&mut self, message: ProtocolMessage) -> Result<ProtocolMessage, PluginHostError> {
        self.sent.lock().expect("lock poisoned").push(message);
        self.response
            .lock()
            .expect("lock poisoned")
            .take()
            .ok_or_else(|| PluginHostError::Transport("missing canned response".into()))
    }
}

fn encode(message: &impl prost::Message) -> Bytes {
    let mut buffer = Vec::new();
    message.encode(&mut buffer).expect("message should encode");
    Bytes::from(buffer)
}
