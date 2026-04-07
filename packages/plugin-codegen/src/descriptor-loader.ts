/**
 * Loads packaged descriptor sets and converts them into an inspectable registry.
 */

import { createFileRegistry, fromBinary, type FileRegistry } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { readFile } from "node:fs/promises";

export async function loadDescriptorRegistry(
  descriptorPath: string,
): Promise<FileRegistry> {
  const bytes = await readFile(descriptorPath);
  const descriptorSet = fromBinary(FileDescriptorSetSchema, bytes);
  return createFileRegistry(descriptorSet);
}
