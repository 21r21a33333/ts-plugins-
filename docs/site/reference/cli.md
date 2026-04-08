# CLI Reference

The first-party CLI is `pluginctl`.

## Commands

### `pluginctl init`

Scaffolds a new plugin workspace.

```bash
pnpm --filter @balance/pluginctl exec pluginctl init ./tmp/weather-plugin \
  --id weather-plugin \
  --package balance.plugins.weather.v1 \
  --service WeatherPluginService
```

### `pluginctl generate`

Generates descriptors, TS message bindings, and typed handler metadata.

```bash
pnpm exec pluginctl generate .
```

### `pluginctl build`

Builds the plugin and validates manifest/runtime assets.

```bash
pnpm exec pluginctl build .
```

### `pluginctl test`

Runs the plugin project tests.

```bash
pnpm exec pluginctl test .
```

### `pluginctl inspect`

Prints manifest and service metadata derived from the packaged descriptor set.

```bash
pnpm exec pluginctl inspect ./plugin.json
```

### `pluginctl pack`

Creates a distributable artifact with integrity metadata.

```bash
pnpm exec pluginctl pack ./examples/quote-plugin --output ./artifacts
```

### `pluginctl install`

Installs a plugin into the immutable plugin-home cache.

```bash
pnpm exec pluginctl install --kind folder --plugin-home ./.plugin-home ./examples/quote-plugin
```

Supported source kinds:

- `folder`
- `tarball`
- `npm`

## Root Scripts

From the repository root:

```bash
pnpm run docs:dev
pnpm run docs:build
pnpm run build
pnpm run test
```
