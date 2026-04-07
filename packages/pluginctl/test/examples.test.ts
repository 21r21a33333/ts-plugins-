import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { validatePluginManifest } from "../src/validate-manifest.js";

describe("example plugin manifests", () => {
  const examples = [
    "examples/quote-plugin/plugin.json",
    "examples/calculation-plugin/plugin.json",
    "examples/http-plugin/plugin.json",
    "examples/crud-plugin/plugin.json",
  ];

  for (const manifestPath of examples) {
    it(`validates ${manifestPath}`, async () => {
      await expect(
        validatePluginManifest(resolve(process.cwd(), "../../", manifestPath)),
      ).resolves.toBeDefined();
    });
  }
});
