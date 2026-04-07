import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  AddRequest,
  InitRequest,
} from "@balance/plugin-generated/generated/balance/plugins/calc/v1/calc_plugin_pb";
import {
  AddRequestSchema,
  AddResponseSchema,
  InitRequestSchema,
  InitResponseSchema,
} from "@balance/plugin-generated/generated/balance/plugins/calc/v1/calc_plugin_pb";
import type { PluginContext } from "@balance/plugin-runtime";

export interface CalcPluginHandlers {
  init(req: InitRequest, ctx: PluginContext): MessageInitShape<typeof InitResponseSchema> | Promise<MessageInitShape<typeof InitResponseSchema>>;
  add(req: AddRequest, ctx: PluginContext): MessageInitShape<typeof AddResponseSchema> | Promise<MessageInitShape<typeof AddResponseSchema>>;
}

export const calcPluginMetadata = {
  packageName: "balance.plugins.calc.v1",
  serviceName: "CalcPluginService",
  typeName: "balance.plugins.calc.v1.CalcPluginService",
  methods: [
    {
      name: "Init",
      localName: "init",
      canonicalName: "balance.plugins.calc.v1.CalcPluginService/Init",
      methodId: 3793644231,
      inputType: "balance.plugins.calc.v1.InitRequest",
      outputType: "balance.plugins.calc.v1.InitResponse",
      inputSchema: InitRequestSchema,
      outputSchema: InitResponseSchema,
    },
    {
      name: "Add",
      localName: "add",
      canonicalName: "balance.plugins.calc.v1.CalcPluginService/Add",
      methodId: 2122879104,
      inputType: "balance.plugins.calc.v1.AddRequest",
      outputType: "balance.plugins.calc.v1.AddResponse",
      inputSchema: AddRequestSchema,
      outputSchema: AddResponseSchema,
    },
  ],
} as const;
