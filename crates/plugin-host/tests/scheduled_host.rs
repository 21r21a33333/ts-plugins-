use std::{
    sync::{Arc, Condvar, Mutex},
    thread,
    time::Duration,
};

use bytes::Bytes;
use plugin_host::{
    CircuitBreakerConfig, DynamicMethod, PluginHostError, ScheduledPluginHost,
    ScheduledPluginHostConfig,
};
use plugin_protocol::ProtocolMessage;

#[allow(dead_code)]
mod quote_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/quote/v1/balance.plugins.quote.v1.rs"
    ));
}

#[test]
fn scheduled_host_rejects_requests_when_queue_capacity_is_exhausted() {
    let gate = Arc::new(Gate::default());
    let host = ScheduledPluginHost::new(
        BlockingTransport::new(gate.clone()),
        ScheduledPluginHostConfig::new(
            1,
            Duration::from_secs(1),
            CircuitBreakerConfig::new(3, Duration::from_secs(30)),
        ),
    );

    let method = DynamicMethod::from_canonical_name(
        "balance.plugins.quote.v1.QuotePluginService/GetPrice",
    );
    let request = quote_v1::GetPriceRequest {
        asset: "BTC".into(),
        amount: "1".into(),
    };

    let first = {
        let host = host.clone();
        let method = method.clone();
        let request = request.clone();
        thread::spawn(move || {
            let _: quote_v1::GetPriceResponse = host
                .invoke(method, &request)
                .expect("first request should eventually succeed");
        })
    };

    gate.wait_until_started();

    let second = {
        let host = host.clone();
        let method = method.clone();
        let request = request.clone();
        thread::spawn(move || {
            let _: quote_v1::GetPriceResponse = host
                .invoke(method, &request)
                .expect("second queued request should eventually succeed");
        })
    };

    thread::sleep(Duration::from_millis(50));

    let overload = host
        .invoke::<_, quote_v1::GetPriceResponse>(method, &request)
        .expect_err("third request should be rejected when the queue is full");
    assert!(matches!(overload, PluginHostError::Overloaded(_)));

    gate.release();
    first.join().expect("first request thread should finish");
    second.join().expect("second request thread should finish");
}

#[test]
fn scheduled_host_times_out_slow_requests() {
    let host = ScheduledPluginHost::new(
        SleepTransport::new(Duration::from_millis(75)),
        ScheduledPluginHostConfig::new(
            2,
            Duration::from_millis(10),
            CircuitBreakerConfig::new(3, Duration::from_secs(30)),
        ),
    );

    let error = host
        .invoke::<_, quote_v1::GetPriceResponse>(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/GetPrice",
            ),
            &quote_v1::GetPriceRequest {
                asset: "BTC".into(),
                amount: "1".into(),
            },
        )
        .expect_err("slow request should time out");

    assert!(matches!(error, PluginHostError::Timeout { .. }));
}

#[test]
fn scheduled_host_opens_the_circuit_after_repeated_transport_failures() {
    let host = ScheduledPluginHost::new(
        FailingTransport,
        ScheduledPluginHostConfig::new(
            2,
            Duration::from_secs(1),
            CircuitBreakerConfig::new(2, Duration::from_secs(30)),
        ),
    );

    for _ in 0..2 {
        let error = host
            .invoke::<_, quote_v1::GetPriceResponse>(
                DynamicMethod::from_canonical_name(
                    "balance.plugins.quote.v1.QuotePluginService/GetPrice",
                ),
                &quote_v1::GetPriceRequest {
                    asset: "BTC".into(),
                    amount: "1".into(),
                },
            )
            .expect_err("transport should fail");
        assert!(matches!(error, PluginHostError::Transport(_)));
    }

    let breaker = host
        .invoke::<_, quote_v1::GetPriceResponse>(
            DynamicMethod::from_canonical_name(
                "balance.plugins.quote.v1.QuotePluginService/GetPrice",
            ),
            &quote_v1::GetPriceRequest {
                asset: "BTC".into(),
                amount: "1".into(),
            },
        )
        .expect_err("third request should be blocked by the open circuit");

    assert!(matches!(breaker, PluginHostError::CircuitOpen));
}

#[derive(Default)]
struct Gate {
    state: Mutex<(bool, bool)>,
    started: Condvar,
    release: Condvar,
}

impl Gate {
    fn wait_until_started(&self) {
        let mut state = self.state.lock().expect("gate lock should not poison");
        while !state.0 {
            state = self
                .started
                .wait(state)
                .expect("gate condvar should not poison");
        }
    }

    fn release(&self) {
        let mut state = self.state.lock().expect("gate lock should not poison");
        state.1 = true;
        self.release.notify_all();
    }
}

struct BlockingTransport {
    gate: Arc<Gate>,
}

impl BlockingTransport {
    fn new(gate: Arc<Gate>) -> Self {
        Self { gate }
    }
}

impl plugin_host::PluginTransport for BlockingTransport {
    fn send(&mut self, message: ProtocolMessage) -> Result<ProtocolMessage, PluginHostError> {
        let request_id = match message {
            ProtocolMessage::RpcRequest { request_id, .. } => request_id,
            other => panic!("expected rpc request, got {other:?}"),
        };

        let mut state = self
            .gate
            .state
            .lock()
            .expect("gate lock should not poison");
        state.0 = true;
        self.gate.started.notify_all();
        while !state.1 {
            state = self
                .gate
                .release
                .wait(state)
                .expect("gate condvar should not poison");
        }

        Ok(ProtocolMessage::RpcResponse {
            request_id,
            payload: encode(&quote_v1::GetPriceResponse {
                outcome: Some(quote_v1::get_price_response::Outcome::Ok(
                    quote_v1::GetPriceSuccess {
                        price: "42.00".into(),
                        currency: "USD".into(),
                        expires_at: "2030-01-01T00:00:00Z".into(),
                    },
                )),
            }),
            trace_context: None,
        })
    }
}

struct SleepTransport {
    delay: Duration,
}

impl SleepTransport {
    fn new(delay: Duration) -> Self {
        Self { delay }
    }
}

impl plugin_host::PluginTransport for SleepTransport {
    fn send(&mut self, message: ProtocolMessage) -> Result<ProtocolMessage, PluginHostError> {
        let request_id = match message {
            ProtocolMessage::RpcRequest { request_id, .. } => request_id,
            other => panic!("expected rpc request, got {other:?}"),
        };
        thread::sleep(self.delay);
        Ok(ProtocolMessage::RpcResponse {
            request_id,
            payload: encode(&quote_v1::GetPriceResponse {
                outcome: Some(quote_v1::get_price_response::Outcome::Ok(
                    quote_v1::GetPriceSuccess {
                        price: "42.00".into(),
                        currency: "USD".into(),
                        expires_at: "2030-01-01T00:00:00Z".into(),
                    },
                )),
            }),
            trace_context: None,
        })
    }
}

struct FailingTransport;

impl plugin_host::PluginTransport for FailingTransport {
    fn send(&mut self, _message: ProtocolMessage) -> Result<ProtocolMessage, PluginHostError> {
        Err(PluginHostError::Transport("boom".into()))
    }
}

fn encode(message: &impl prost::Message) -> Bytes {
    let mut buffer = Vec::new();
    message.encode(&mut buffer).expect("message should encode");
    Bytes::from(buffer)
}
