#!/usr/bin/env node

import { createServer } from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { startServer } from '../src/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parse CLI args ---
const args = process.argv.slice(2);
let port = 3721;
let dir = process.cwd();

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if ((args[i] === '--dir' || args[i] === '-d') && args[i + 1]) {
    dir = resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
pkg-maintain - Unified npm/pnpm/yarn maintenance GUI

Usage:
  node bin/cli.js [options]

Options:
  -p, --port <number>   Server port (default: 3721)
  -d, --dir <path>      Target project directory (default: current directory)
  -h, --help            Show this help message
`);
    process.exit(0);
  }
}

// --- Start server ---
const server = startServer({ port, targetDir: dir });

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  pkg-maintain is running at ${url}`);
  console.log(`  Target directory: ${dir}`);
  console.log(`  Press Ctrl+C to stop\n`);

  // Auto-open browser (Windows)
  if (process.platform === 'win32') {
    exec(`start ${url}`);
  } else if (process.platform === 'darwin') {
    exec(`open ${url}`);
  } else {
    exec(`xdg-open ${url}`);
  }
});
