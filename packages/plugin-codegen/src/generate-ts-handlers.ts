import type { PluginMethodDefinition, PluginServiceDefinition } from "./plugin-contract.js";

export interface GenerateTsHandlersSourceInput {
  service: PluginServiceDefinition;
  messagesModuleSpecifier: string;
  runtimeModuleSpecifier?: string;
  contextTypeName?: string;
}

export function generateTsHandlersSource(
  input: GenerateTsHandlersSourceInput,
): string {
  const runtimeModuleSpecifier =
    input.runtimeModuleSpecifier ?? "@balance/plugin-runtime";
  const contextTypeName = input.contextTypeName ?? "PluginContext";
  const interfaceName = toHandlerInterfaceName(input.service.serviceName);
  const metadataName = `${toCamelCase(stripServiceSuffix(input.service.serviceName))}Metadata`;
  const messageImports = collectMessageImports(input.service.methods);
  const schemaImports = collectSchemaImports(input.service.methods);

  const lines = [
    `import type { ${messageImports.join(", ")} } from ${JSON.stringify(input.messagesModuleSpecifier)};`,
    `import { ${schemaImports.join(", ")} } from ${JSON.stringify(input.messagesModuleSpecifier)};`,
    `import type { ${contextTypeName} } from ${JSON.stringify(runtimeModuleSpecifier)};`,
    "",
    `export interface ${interfaceName} {`,
    ...input.service.methods.map((method) =>
      `  ${method.localName}(req: ${shortTypeName(method.inputType)}, ctx: ${contextTypeName}): Promise<${shortTypeName(method.outputType)}>;`,
    ),
    "}",
    "",
    `export const ${metadataName} = {`,
    `  packageName: ${JSON.stringify(input.service.packageName)},`,
    `  serviceName: ${JSON.stringify(input.service.serviceName)},`,
    `  typeName: ${JSON.stringify(input.service.typeName)},`,
    "  methods: [",
    ...input.service.methods.flatMap((method) => renderMethodMetadata(method)),
    "  ],",
    "} as const;",
    "",
  ];

  return lines.join("\n");
}

function collectMessageImports(methods: PluginMethodDefinition[]): string[] {
  return [...new Set(methods.flatMap((method) => [
    shortTypeName(method.inputType),
    shortTypeName(method.outputType),
  ]))].sort((left, right) => left.localeCompare(right));
}

function collectSchemaImports(methods: PluginMethodDefinition[]): string[] {
  return [...new Set(methods.flatMap((method) => [
    schemaTypeName(method.inputType),
    schemaTypeName(method.outputType),
  ]))].sort((left, right) => left.localeCompare(right));
}

function toHandlerInterfaceName(serviceName: string): string {
  return `${stripServiceSuffix(serviceName)}Handlers`;
}

function stripServiceSuffix(serviceName: string): string {
  return serviceName.endsWith("Service")
    ? serviceName.slice(0, -("Service".length))
    : serviceName;
}

function toCamelCase(value: string): string {
  return value.length === 0
    ? value
    : `${value[0]!.toLowerCase()}${value.slice(1)}`;
}

function shortTypeName(typeName: string): string {
  const segments = typeName.split(".");
  return segments[segments.length - 1]!;
}

function schemaTypeName(typeName: string): string {
  return `${shortTypeName(typeName)}Schema`;
}

function renderMethodMetadata(method: PluginMethodDefinition): string[] {
  return [
    "    {",
    `      name: ${JSON.stringify(method.name)},`,
    `      localName: ${JSON.stringify(method.localName)},`,
    `      canonicalName: ${JSON.stringify(method.canonicalName)},`,
      `      methodId: ${method.methodId},`,
      `      inputType: ${JSON.stringify(method.inputType)},`,
      `      outputType: ${JSON.stringify(method.outputType)},`,
      `      inputSchema: ${schemaTypeName(method.inputType)},`,
      `      outputSchema: ${schemaTypeName(method.outputType)},`,
    "    },",
  ];
}
