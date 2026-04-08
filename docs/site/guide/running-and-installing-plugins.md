# Running And Installing Plugins

There are two distinct flows:

- authoring flow inside a plugin workspace
- installation flow into a host-managed plugin home

## Authoring Flow

Inside the plugin project:

```bash
pnpm exec pluginctl generate .
pnpm exec pluginctl build .
pnpm exec pluginctl test .
pnpm exec pluginctl inspect ./plugin.json
```

## Pack A Plugin

```bash
pnpm --filter @balance/pluginctl exec pluginctl pack ./examples/quote-plugin --output ./artifacts
```

The packed artifact includes:

- compiled JS
- `plugin.json`
- descriptor set
- `.proto` sources
- integrity metadata
- source maps when present

## Install From A Folder

Useful for local development:

```bash
pnpm --filter @balance/pluginctl exec pluginctl install \
  --kind folder \
  --plugin-home ./.plugin-home \
  ./examples/quote-plugin
```

## Install From A Tarball

```bash
pnpm --filter @balance/pluginctl exec pluginctl install \
  --kind tarball \
  --plugin-home ./.plugin-home \
  ./artifacts/quote-plugin-0.1.0.tgz
```

## Install From npm

```bash
pnpm --filter @balance/pluginctl exec pluginctl install \
  --kind npm \
  --plugin-home ./.plugin-home \
  @balance/example-quote-plugin@0.1.0
```

## Install Model

The host resolves plugin sources into an immutable install cache. This gives:

- deterministic runtime assets
- integrity checks for packaged installs
- a stable location for manifests, descriptors, and runtime entrypoints

## Runtime Startup Model

When the host activates a plugin:

1. it reads installed metadata
2. it launches the Node runtime
3. it loads the packaged descriptor set
4. it calls `Init`
5. it routes future RPCs over the socket transport

## Recovery Model

If the runtime crashes:

- in-flight requests fail
- the host may restart the runtime
- `Init` runs again
- Redis-backed KV and external storage survive the restart

The CRUD demo tests this end to end.
