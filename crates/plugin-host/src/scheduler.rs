//! Bounded request scheduling and circuit-breaker-aware host invocation.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use plugin_observability::current_trace_context;
use plugin_protocol::ProtocolMessage;
use prost::Message;

use crate::{
    circuit_breaker::{CircuitBreaker, CircuitBreakerConfig},
    client::{decode_response_message, encode_request_message, PluginHostError, PluginTransport},
    DynamicMethod,
};

#[derive(Debug, Clone, Copy)]
pub struct ScheduledPluginHostConfig {
    pub max_queue_depth: usize,
    pub request_timeout: Duration,
    pub circuit_breaker: CircuitBreakerConfig,
}

impl ScheduledPluginHostConfig {
    pub fn new(
        max_queue_depth: usize,
        request_timeout: Duration,
        circuit_breaker: CircuitBreakerConfig,
    ) -> Self {
        Self {
            max_queue_depth,
            request_timeout,
            circuit_breaker,
        }
    }
}

#[derive(Clone)]
pub struct ScheduledPluginHost {
    sender: SyncSender<WorkItem>,
    next_request_id: Arc<AtomicU64>,
    request_timeout: Duration,
    breaker: Arc<Mutex<CircuitBreaker>>,
}

impl ScheduledPluginHost {
    pub fn new<TTransport>(
        transport: TTransport,
        config: ScheduledPluginHostConfig,
    ) -> Self
    where
        TTransport: PluginTransport + Send + 'static,
    {
        let (sender, receiver) = mpsc::sync_channel(config.max_queue_depth);
        let breaker = Arc::new(Mutex::new(CircuitBreaker::new(config.circuit_breaker)));
        spawn_worker_thread(transport, receiver, breaker.clone());

        Self {
            sender,
            next_request_id: Arc::new(AtomicU64::new(1)),
            request_timeout: config.request_timeout,
            breaker,
        }
    }

    pub fn invoke<TRequest, TResponse>(
        &self,
        method: DynamicMethod,
        request: &TRequest,
    ) -> Result<TResponse, PluginHostError>
    where
        TRequest: Message,
        TResponse: Message + Default,
    {
        let request_id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let payload = encode_request_message(request)?;

        {
            let mut breaker = self.breaker.lock().expect("breaker lock should not poison");
            if !breaker.allow_request(Instant::now()) {
                return Err(PluginHostError::CircuitOpen);
            }
        }

        let (response_tx, response_rx) = mpsc::channel();
        let message = ProtocolMessage::RpcRequest {
            request_id,
            method_id: method.method_id(),
            payload,
            trace_context: current_trace_context(),
        };

        match self.sender.try_send(WorkItem {
            message,
            response_tx,
        }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                return Err(PluginHostError::Overloaded(
                    "scheduler queue is full".to_string(),
                ));
            }
            Err(TrySendError::Disconnected(_)) => {
                return Err(PluginHostError::Transport(
                    "scheduler worker is no longer running".to_string(),
                ));
            }
        }

        let response = response_rx
            .recv_timeout(self.request_timeout)
            .map_err(|_| {
                self.breaker
                    .lock()
                    .expect("breaker lock should not poison")
                    .record_failure(Instant::now());
                PluginHostError::Timeout {
                    request_id,
                    timeout: self.request_timeout,
                }
            })?
            ?;

        decode_response_message(request_id, response)
    }
}

struct WorkItem {
    message: ProtocolMessage,
    response_tx: mpsc::Sender<Result<ProtocolMessage, PluginHostError>>,
}

fn spawn_worker_thread<TTransport>(
    mut transport: TTransport,
    receiver: Receiver<WorkItem>,
    breaker: Arc<Mutex<CircuitBreaker>>,
) where
    TTransport: PluginTransport + Send + 'static,
{
    thread::spawn(move || {
        while let Ok(item) = receiver.recv() {
            let response = transport.send(item.message);
            {
                let mut breaker = breaker.lock().expect("breaker lock should not poison");
                match &response {
                    Ok(ProtocolMessage::RpcResponse { .. }) => breaker.record_success(Instant::now()),
                    Ok(_) | Err(_) => breaker.record_failure(Instant::now()),
                }
            }
            let _ = item.response_tx.send(response);
        }
    });
}
