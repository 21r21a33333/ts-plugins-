#![cfg(unix)]
//! Minimal Rust caller example that invokes a live plugin over the Unix socket transport.

use std::{collections::BTreeMap, error::Error, path::PathBuf};

use plugin_host::{DynamicMethod, PluginHost, UnixSocketTransport};
use serde_json::json;

mod quote_v1 {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../gen/rust/balance/plugins/quote/v1/balance.plugins.quote.v1.rs"
    ));
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = CliArgs::parse(std::env::args().skip(1))?;
    let transport = UnixSocketTransport::connect(&args.socket)?;
    let mut host = PluginHost::new(transport);

    let _: quote_v1::InitResponse = host.invoke(
        DynamicMethod::from_canonical_name("balance.plugins.quote.v1.QuotePluginService/Init"),
        &quote_v1::InitRequest {
            plugin_instance_id: "rust-caller".into(),
            environment: "cli".into(),
            config: [(String::from("currency"), args.currency.clone())]
                .into_iter()
                .collect(),
        },
    )?;

    let response: quote_v1::GetPriceResponse = host.invoke(
        DynamicMethod::from_canonical_name(
            "balance.plugins.quote.v1.QuotePluginService/GetPrice",
        ),
        &quote_v1::GetPriceRequest {
            asset: args.asset,
            amount: args.amount,
        },
    )?;

    let output = match response.outcome {
        Some(quote_v1::get_price_response::Outcome::Ok(success)) => json!({
            "status": "ok",
            "price": success.price,
            "currency": success.currency,
            "expiresAt": success.expires_at,
        }),
        Some(quote_v1::get_price_response::Outcome::Error(error)) => json!({
            "status": "error",
            "code": error.code,
            "message": error.message,
            "details": BTreeMap::from_iter(error.details),
        }),
        None => json!({
            "status": "error",
            "code": "missing_outcome",
            "message": "plugin returned no outcome"
        }),
    };

    println!("{}", serde_json::to_string_pretty(&output)?);

    Ok(())
}

/// CLI arguments required by the standalone Rust caller example.
struct CliArgs {
    socket: PathBuf,
    asset: String,
    amount: String,
    currency: String,
}

impl CliArgs {
    /// Parses the minimal flag set used by the example without pulling in a full CLI framework.
    fn parse(
        args: impl IntoIterator<Item = String>,
    ) -> Result<Self, Box<dyn Error>> {
        let mut socket = None;
        let mut asset = None;
        let mut amount = None;
        let mut currency = None;
        let mut iter = args.into_iter();

        while let Some(argument) = iter.next() {
            let value = iter
                .next()
                .ok_or_else(|| format!("missing value for argument {argument}"))?;

            match argument.as_str() {
                "--socket" => socket = Some(PathBuf::from(value)),
                "--asset" => asset = Some(value),
                "--amount" => amount = Some(value),
                "--currency" => currency = Some(value),
                _ => return Err(format!("unsupported argument: {argument}").into()),
            }
        }

        Ok(Self {
            socket: socket.ok_or("--socket is required")?,
            asset: asset.ok_or("--asset is required")?,
            amount: amount.ok_or("--amount is required")?,
            currency: currency.ok_or("--currency is required")?,
        })
    }
}
