/**
 * Zod schema for the static `plugin.json` contract consumed by the CLI and host.
 */

import { z } from "zod";

const activationSchema = z.object({
  mode: z.enum(["lazy", "startup"]),
});

const concurrencySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("serial"),
  }),
  z.object({
    mode: z.literal("parallel-safe"),
  }),
  z.object({
    mode: z.literal("max_concurrency"),
    maxConcurrency: z.number().int().positive(),
  }),
]);

export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  main: z.string().min(1),
  sourceMap: z.string().min(1).optional(),
  contract: z.object({
    descriptorSet: z.string().min(1),
    service: z.string().min(1),
    protoSources: z.array(z.string().min(1)).optional(),
  }),
  runtime: z.object({
    language: z.literal("node"),
    activation: activationSchema,
    concurrency: concurrencySchema,
    initTimeoutMs: z.number().int().positive(),
    requestTimeoutMs: z.number().int().positive(),
    idleEvictionMs: z.number().int().positive().optional(),
  }),
  observability: z
    .object({
      emitLogs: z.boolean().optional(),
      emitTraces: z.boolean().optional(),
      emitMetrics: z.boolean().optional(),
    })
    .optional(),
  integrity: z
    .object({
      packageSha256: z.string().min(1).optional(),
    })
    .optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
