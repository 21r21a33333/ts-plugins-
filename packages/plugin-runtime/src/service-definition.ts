/**
 * Resolves descriptor-backed service metadata for runtime startup.
 */

import {
  buildPluginServiceDefinition,
  loadDescriptorRegistry,
  type PluginServiceDefinition,
} from "@balance/plugin-codegen";

type SchemaAwarePluginServiceDefinition = PluginServiceDefinition & {
  methods: Array<
    NonNullable<PluginServiceDefinition["methods"][number]> & {
      inputSchema: NonNullable<
        PluginServiceDefinition["methods"][number]["inputSchema"]
      >;
      outputSchema: NonNullable<
        PluginServiceDefinition["methods"][number]["outputSchema"]
      >;
    }
  >;
};

export interface LoadRuntimeServiceDefinitionInput {
  descriptorPath: string;
  serviceName: string;
}

export async function loadRuntimeServiceDefinition(
  input: LoadRuntimeServiceDefinitionInput,
): Promise<SchemaAwarePluginServiceDefinition> {
  const registry = await loadDescriptorRegistry(input.descriptorPath);
  const service = registry.getService(input.serviceName);
  if (service === undefined) {
    throw new Error(
      `Descriptor set ${input.descriptorPath} does not define service ${input.serviceName}`,
    );
  }

  const definition = buildPluginServiceDefinition([service]);
  for (const method of definition.methods) {
    if (method.inputSchema === undefined || method.outputSchema === undefined) {
      throw new Error(
        `Descriptor-derived service ${input.serviceName} is missing schemas for ${method.name}`,
      );
    }
  }

  return definition as SchemaAwarePluginServiceDefinition;
}
