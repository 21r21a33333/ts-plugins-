import { describe, expect, it } from "vitest";

import {
  assertUniqueMethodIds,
  canonicalMethodName,
  stableMethodId,
} from "../src/method-ids.js";

describe("canonicalMethodName", () => {
  it("builds the canonical service method path", () => {
    expect(
      canonicalMethodName(
        "balance.plugins.quote.v1",
        "QuotePluginService",
        "GetPrice",
      ),
    ).toBe("balance.plugins.quote.v1.QuotePluginService/GetPrice");
  });
});

describe("stableMethodId", () => {
  it("returns the same ID for the same canonical method", () => {
    const method = "balance.plugins.quote.v1.QuotePluginService/GetPrice";

    expect(stableMethodId(method)).toBe(stableMethodId(method));
  });

  it("returns different IDs for different canonical methods", () => {
    const init = "balance.plugins.quote.v1.QuotePluginService/Init";
    const getPrice = "balance.plugins.quote.v1.QuotePluginService/GetPrice";

    expect(stableMethodId(init)).not.toBe(stableMethodId(getPrice));
  });

  it("never returns zero because zero is reserved", () => {
    expect(stableMethodId("balance.plugins.quote.v1.QuotePluginService/Init"))
      .toBeGreaterThan(0);
  });
});

describe("assertUniqueMethodIds", () => {
  it("passes when all IDs are unique", () => {
    expect(() =>
      assertUniqueMethodIds([
        "balance.plugins.quote.v1.QuotePluginService/Init",
        "balance.plugins.quote.v1.QuotePluginService/GetPrice",
      ]),
    ).not.toThrow();
  });

  it("throws when duplicate canonical method names are provided", () => {
    expect(() =>
      assertUniqueMethodIds([
        "balance.plugins.quote.v1.QuotePluginService/Init",
        "balance.plugins.quote.v1.QuotePluginService/Init",
      ]),
    ).toThrow(/duplicate canonical method name/i);
  });
});
