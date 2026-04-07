import type { DescMethod, DescService } from "@bufbuild/protobuf";

import { canonicalMethodName, stableMethodId } from "./method-ids.js";

export interface PluginMethodDefinition {
  name: string;
  localName: string;
  canonicalName: string;
  methodId: number;
  inputType: string;
  outputType: string;
}

export interface PluginServiceDefinition {
  packageName: string;
  serviceName: string;
  typeName: string;
  methods: PluginMethodDefinition[];
}

type ServiceLike = Pick<DescService, "typeName" | "name" | "methods">;
type MethodLike = Pick<
  DescMethod,
  "name" | "localName" | "methodKind" | "input" | "output"
>;

export function buildPluginServiceDefinition(
  services: readonly ServiceLike[],
): PluginServiceDefinition {
  if (services.length !== 1) {
    throw new Error(
      `Expected exactly one service in plugin contract, found ${services.length}`,
    );
  }

  const service = services[0]!;
  const methods = service.methods as readonly MethodLike[];

  if (!methods.some((method) => method.name === "Init")) {
    throw new Error("Plugin service must define a required Init RPC");
  }

  const nonUnaryMethod = methods.find((method) => method.methodKind !== "unary");
  if (nonUnaryMethod !== undefined) {
    throw new Error(
      `Plugin service method ${nonUnaryMethod.name} must be unary in v1`,
    );
  }

  const lastDotIndex = service.typeName.lastIndexOf(".");
  const packageName =
    lastDotIndex >= 0 ? service.typeName.slice(0, lastDotIndex) : "";

  return {
    packageName,
    serviceName: service.name,
    typeName: service.typeName,
    methods: methods.map((method) => ({
      name: method.name,
      localName: method.localName,
      canonicalName: canonicalMethodName(
        packageName,
        service.name,
        method.name,
      ),
      methodId: stableMethodId(
        canonicalMethodName(packageName, service.name, method.name),
      ),
      inputType: method.input.typeName,
      outputType: method.output.typeName,
    })),
  };
}
