import { describe, expect, it } from "vitest";

import { renderDefaultPluginTemplate } from "../src/index.js";

describe("renderDefaultPluginTemplate", () => {
  it("renders a complete plugin scaffold for the requested service", () => {
    const rendered = renderDefaultPluginTemplate({
      id: "weather-plugin",
      packageName: "balance.plugins.weather.v1",
      serviceName: "WeatherPluginService",
    });

    expect(rendered.protoPath).toBe(
      "proto/balance/plugins/weather/v1/weather_plugin.proto",
    );
    expect(rendered.files.find((file) => file.path === "plugin.json")?.contents).toContain(
      "\"service\": \"balance.plugins.weather.v1.WeatherPluginService\"",
    );
    expect(
      rendered.files.find((file) => file.path === "src/index.ts")?.contents,
    ).toContain("definePlugin");
  });
});
