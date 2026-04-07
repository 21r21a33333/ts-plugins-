//! Structured logging helpers shared by host-side components.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestLogMetadata {
    pub plugin_id: String,
    pub runtime_instance_id: String,
    pub request_id: String,
    pub trace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogRecord {
    pub level: LogLevel,
    pub message: String,
    pub metadata: RequestLogMetadata,
}

#[derive(Debug, Default)]
pub struct StructuredLogger {
    records: Vec<LogRecord>,
}

impl StructuredLogger {
    pub fn log(&mut self, level: LogLevel, message: impl Into<String>, metadata: RequestLogMetadata) {
        self.records.push(LogRecord {
            level,
            message: message.into(),
            metadata,
        });
    }

    pub fn records(&self) -> &[LogRecord] {
        &self.records
    }
}

#[cfg(test)]
mod tests {
    use super::{LogLevel, RequestLogMetadata, StructuredLogger};

    #[test]
    fn log_records_include_request_metadata() {
        let mut logger = StructuredLogger::default();
        logger.log(
            LogLevel::Info,
            "starting request",
            RequestLogMetadata {
                plugin_id: "quote-plugin".to_string(),
                runtime_instance_id: "runtime-1".to_string(),
                request_id: "req-42".to_string(),
                trace_id: Some("feedfacefeedfacefeedfacefeedface".to_string()),
            },
        );

        let record = &logger.records()[0];
        assert_eq!(record.metadata.plugin_id, "quote-plugin");
        assert_eq!(record.metadata.runtime_instance_id, "runtime-1");
        assert_eq!(record.metadata.request_id, "req-42");
        assert_eq!(
            record.metadata.trace_id.as_deref(),
            Some("feedfacefeedfacefeedfacefeedface")
        );
    }
}
