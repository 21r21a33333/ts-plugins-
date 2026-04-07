use opentelemetry::trace::TraceContextExt;
use plugin_protocol::TraceContext;
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub fn current_trace_context() -> Option<TraceContext> {
    let context = tracing::Span::current().context();
    let span = context.span();
    let span_context = span.span_context();
    if !span_context.is_valid() {
        return None;
    }

    Some(TraceContext {
        trace_id: span_context.trace_id().to_string(),
        span_id: span_context.span_id().to_string(),
        trace_flags: u32::from(span_context.trace_flags().to_u8()),
    })
}

#[cfg(test)]
mod tests {
    use super::current_trace_context;
    use opentelemetry::trace::TracerProvider;
    use opentelemetry_sdk::trace::SdkTracerProvider;
    use tracing::subscriber::with_default;
    use tracing_subscriber::{layer::SubscriberExt, Registry};

    #[test]
    fn current_trace_context_reads_the_active_span() {
        let provider = SdkTracerProvider::builder().build();
        let tracer = provider.tracer("plugin-observability-tests");
        let subscriber = Registry::default().with(
            tracing_opentelemetry::layer().with_tracer(tracer),
        );

        with_default(subscriber, || {
            let span = tracing::info_span!("host_request");
            let _entered = span.enter();

            let trace = current_trace_context().expect("current span should expose trace context");
            assert_eq!(trace.trace_id.len(), 32);
            assert_eq!(trace.span_id.len(), 16);
        });
    }
}
