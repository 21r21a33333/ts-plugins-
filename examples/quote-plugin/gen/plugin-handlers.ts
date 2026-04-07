import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  GetPriceRequest,
  InitRequest,
} from "@balance/plugin-generated/generated/balance/plugins/quote/v1/quote_plugin_pb";
import {
  GetPriceRequestSchema,
  GetPriceResponseSchema,
  InitRequestSchema,
  InitResponseSchema,
} from "@balance/plugin-generated/generated/balance/plugins/quote/v1/quote_plugin_pb";
import type { PluginContext } from "@balance/plugin-runtime";

export interface QuotePluginHandlers {
  init(req: InitRequest, ctx: PluginContext): MessageInitShape<typeof InitResponseSchema> | Promise<MessageInitShape<typeof InitResponseSchema>>;
  getPrice(req: GetPriceRequest, ctx: PluginContext): MessageInitShape<typeof GetPriceResponseSchema> | Promise<MessageInitShape<typeof GetPriceResponseSchema>>;
}

export const quotePluginMetadata = {
  packageName: "balance.plugins.quote.v1",
  serviceName: "QuotePluginService",
  typeName: "balance.plugins.quote.v1.QuotePluginService",
  methods: [
    {
      name: "Init",
      localName: "init",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/Init",
      methodId: 2026714057,
      inputType: "balance.plugins.quote.v1.InitRequest",
      outputType: "balance.plugins.quote.v1.InitResponse",
      inputSchema: InitRequestSchema,
      outputSchema: InitResponseSchema,
    },
    {
      name: "GetPrice",
      localName: "getPrice",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/GetPrice",
      methodId: 758358830,
      inputType: "balance.plugins.quote.v1.GetPriceRequest",
      outputType: "balance.plugins.quote.v1.GetPriceResponse",
      inputSchema: GetPriceRequestSchema,
      outputSchema: GetPriceResponseSchema,
    },
  ],
} as const;
