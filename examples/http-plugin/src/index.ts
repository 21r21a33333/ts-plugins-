import { definePlugin } from "@balance/plugin-runtime";

import type { HttpPluginHandlers } from "../gen/plugin-handlers.js";

export default definePlugin<HttpPluginHandlers>({
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

  async fetchTodo(req) {
    const response = await fetch(req.url);
    const body = await response.json() as { title?: string; body?: string };

    return {
      outcome: {
        case: "ok",
        value: {
          status: response.status,
          title: body.title ?? "",
          body: body.body ?? "",
        },
      },
    };
  },
});
