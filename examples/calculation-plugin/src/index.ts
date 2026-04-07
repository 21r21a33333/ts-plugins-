import { definePlugin } from "@balance/plugin-runtime";

import type { CalcPluginHandlers } from "../gen/plugin-handlers.js";

export default definePlugin<CalcPluginHandlers>({
  init(_req, ctx) {
    return {
      outcome: {
        case: "ok",
        value: {
          pluginName: ctx.plugin.id,
          pluginVersion: ctx.plugin.version,
        },
      },
    };
  },

  add(req) {
    return {
      outcome: {
        case: "ok",
        value: {
          sum: req.left + req.right,
        },
      },
    };
  },
});
