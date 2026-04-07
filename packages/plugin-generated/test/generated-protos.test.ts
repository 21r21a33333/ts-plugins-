import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  GetPriceRequestSchema,
  QuotePluginService,
} from "../src/generated/balance/plugins/quote/v1/quote_plugin_pb.js";
import {
  FrameworkErrorCode,
  WireEnvelopeSchema,
} from "../src/generated/balance/runtime/v1/plugin_protocol_pb.js";

describe("generated protobuf package", () => {
  it("exposes generated service descriptors for plugin contracts", () => {
    expect(QuotePluginService.method.getPrice.name).toBe("GetPrice");

    const request = create(GetPriceRequestSchema, {
      asset: "BTC",
      amount: "0.5",
    });

    expect(request.asset).toBe("BTC");
  });

  it("round-trips the runtime wire envelope with generated schemas", () => {
    const envelope = create(WireEnvelopeSchema, {
      protocolVersion: 1,
      requestId: 42n,
      body: {
        case: "frameworkError",
        value: {
          code: FrameworkErrorCode.TIMEOUT,
          message: "timed out",
        },
      },
    });

    const decoded = fromBinary(WireEnvelopeSchema, toBinary(WireEnvelopeSchema, envelope));

    expect(decoded.requestId).toBe(42n);
    expect(decoded.body.case).toBe("frameworkError");
    if (decoded.body.case !== "frameworkError") {
      throw new Error(`expected frameworkError body, received ${decoded.body.case}`);
    }
    expect(decoded.body.value.code).toBe(FrameworkErrorCode.TIMEOUT);
  });
});
