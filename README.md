# pkg-maintain

Unified GUI tool for npm/pnpm/yarn maintenance — cache cleanup, duplicate detection, garbage collection.

## Features

- **Package Management** — Install, uninstall, upgrade packages + npm registry search + global packages list
- **Cache Management** — View/clean cache for all package managers + global packages overview
- **Garbage Cleanup** — Scan filesystem for node_modules, multi-select delete, disk usage
- **Dependency Health** — Dependency tree, duplicate detection, dedupe, unused deps, prune, outdated

## Quick Start

```bash
# Start the server (default port 3721)
node bin/cli.js

# Custom port and target directory
node bin/cli.js --port 8080 --dir /path/to/project

# Open browser
# http://127.0.0.1:3721
```

## Requirements

- Node.js >= 18 (uses built-in `fetch` for npm registry API)
- Zero runtime dependencies

## Auto-Detection

Automatically detects npm/pnpm/yarn via lockfile:
- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn
- default → npm

## License

MIT
