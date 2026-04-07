import { definePlugin } from "@balance/plugin-runtime";

import type { QuotePluginHandlers } from "../gen/plugin-handlers.js";

export default definePlugin<QuotePluginHandlers>({
  async init(req, ctx) {
    return {
      outcome: {
        case: "ok",
        value: {
          pluginName: ctx.plugin.id,
          pluginVersion: `${ctx.plugin.version}:${req.environment}`,
        },
      },
    };
  },

  async getPrice(req, ctx) {
    const currency = ctx.config.currency ?? "USD";
    return {
      outcome: {
        case: "ok",
        value: {
          price: `${req.asset}:${req.amount}`,
          currency,
          expiresAt: "2030-01-01T00:00:00Z",
        },
      },
    };
  },
});
