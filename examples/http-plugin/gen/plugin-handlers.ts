import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  FetchTodoRequest,
  InitRequest,
} from "@balance/plugin-generated/generated/balance/plugins/http/v1/http_plugin_pb";
import {
  FetchTodoRequestSchema,
  FetchTodoResponseSchema,
  InitRequestSchema,
  InitResponseSchema,
} from "@balance/plugin-generated/generated/balance/plugins/http/v1/http_plugin_pb";
import type { PluginContext } from "@balance/plugin-runtime";

export interface HttpPluginHandlers {
  init(req: InitRequest, ctx: PluginContext): MessageInitShape<typeof InitResponseSchema> | Promise<MessageInitShape<typeof InitResponseSchema>>;
  fetchTodo(req: FetchTodoRequest, ctx: PluginContext): MessageInitShape<typeof FetchTodoResponseSchema> | Promise<MessageInitShape<typeof FetchTodoResponseSchema>>;
}

export const httpPluginMetadata = {
  packageName: "balance.plugins.http.v1",
  serviceName: "HttpPluginService",
  typeName: "balance.plugins.http.v1.HttpPluginService",
  methods: [
    {
      name: "Init",
      localName: "init",
      canonicalName: "balance.plugins.http.v1.HttpPluginService/Init",
      methodId: 2592113671,
      inputType: "balance.plugins.http.v1.InitRequest",
      outputType: "balance.plugins.http.v1.InitResponse",
      inputSchema: InitRequestSchema,
      outputSchema: InitResponseSchema,
    },
    {
      name: "FetchTodo",
      localName: "fetchTodo",
      canonicalName: "balance.plugins.http.v1.HttpPluginService/FetchTodo",
      methodId: 1223225735,
      inputType: "balance.plugins.http.v1.FetchTodoRequest",
      outputType: "balance.plugins.http.v1.FetchTodoResponse",
      inputSchema: FetchTodoRequestSchema,
      outputSchema: FetchTodoResponseSchema,
    },
  ],
} as const;
