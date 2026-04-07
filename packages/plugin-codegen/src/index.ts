/**
 * Public entrypoint for descriptor loading and code generation helpers.
 */

export {
  assertUniqueMethodIds,
  canonicalMethodName,
  stableMethodId,
} from "./method-ids.js";
export { loadDescriptorRegistry } from "./descriptor-loader.js";
export {
  generateTsHandlersSource,
  type GenerateTsHandlersSourceInput,
} from "./generate-ts-handlers.js";
export {
  buildPluginServiceDefinition,
  type PluginMethodDefinition,
  type PluginServiceDefinition,
} from "./plugin-contract.js";
