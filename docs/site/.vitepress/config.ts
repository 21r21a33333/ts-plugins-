import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Balance TS Plugins",
  description:
    "Contract-first plugin infrastructure with a Rust host, TypeScript plugin runtimes, protobuf contracts, and end-to-end testing.",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "Balance TS Plugins",
    nav: [
      { text: "Guide", link: "/guide/what-is-balance-ts-plugins" },
      { text: "Architecture", link: "/architecture/system-overview" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Demos", link: "/demos/overview" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            {
              text: "What Is Balance TS Plugins?",
              link: "/guide/what-is-balance-ts-plugins",
            },
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Authoring A Plugin", link: "/guide/authoring-a-plugin" },
            { text: "Running And Installing Plugins", link: "/guide/running-and-installing-plugins" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Architecture",
          items: [
            { text: "System Overview", link: "/architecture/system-overview" },
            { text: "Contracts And Codegen", link: "/architecture/contracts-and-codegen" },
            { text: "Runtime And Host Flow", link: "/architecture/runtime-and-host-flow" },
            { text: "Storage, Observability, And Recovery", link: "/architecture/storage-observability-and-recovery" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "CLI", link: "/reference/cli" },
            { text: "plugin.json", link: "/reference/plugin-manifest" },
            { text: "Protobuf Contract Pattern", link: "/reference/protobuf-contract-pattern" },
            { text: "Testing Strategy", link: "/reference/testing-strategy" },
          ],
        },
      ],
      "/demos/": [
        {
          text: "Demos",
          items: [
            { text: "Overview", link: "/demos/overview" },
            { text: "Calculation Plugin", link: "/demos/calculation-plugin" },
            { text: "HTTP Plugin", link: "/demos/http-plugin" },
            { text: "CRUD Plugin", link: "/demos/crud-plugin" },
            { text: "Quote Plugin", link: "/demos/quote-plugin" },
            { text: "Rust Caller", link: "/demos/rust-caller" },
          ],
        },
      ],
    },
    search: {
      provider: "local",
    },
    socialLinks: [],
    footer: {
      message: "Built for contract-first plugin development with Rust and TypeScript.",
      copyright: "Balance TS Plugins",
    },
  },
});
