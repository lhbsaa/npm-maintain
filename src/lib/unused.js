import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';

// File extensions to scan for import/require statements
const SCAN_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro'
]);

// Directories to skip during source scanning
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '.nuxt',
  '.output', '.turbo', '.vercel', '.serverless', 'coverage',
  '.cache', 'out', 'vendor', '__pycache__'
]);

/**
 * Find unused dependencies in a project.
 * Reads package.json, scans source files for require/import statements,
 * and compares to find dependencies that are declared but never imported.
 *
 * @param {string} cwd - Project root directory
 * @returns {Promise<object>} { unused: string[], missing: string[] }
 */
export async function findUnusedDeps(cwd) {
  // Read package.json
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    return { error: 'No package.json found in the target directory' };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  const allDeps = new Set([...deps, ...devDeps]);

  // Skip the tool itself
  allDeps.delete('pkg-maintain');

  // Collect all imported/required package names from source files
  const usedPackages = new Set();
  scanSourceFiles(cwd, usedPackages);

  // Find unused: declared but not imported anywhere
  const unused = [];
  const unusedDev = [];
  for (const dep of deps) {
    if (!usedPackages.has(dep)) {
      // Also check if it might be referenced in scripts or config
      if (!isUsedInConfig(pkg, dep)) {
        unused.push(dep);
      }
    }
  }
  for (const dep of devDeps) {
    if (!usedPackages.has(dep)) {
      if (!isUsedInConfig(pkg, dep)) {
        unusedDev.push(dep);
      }
    }
  }

  // Find missing: imported but not declared
  const missing = [];
  for (const used of usedPackages) {
    if (!allDeps.has(used) && !isBuiltinModule(used)) {
      missing.push(used);
    }
  }

  return { unused, unusedDev, missing };
}

/**
 * Recursively scan source files and extract package names from import/require.
 */
function scanSourceFiles(dir, usedPackages, depth = 0) {
  if (depth > 15) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        scanSourceFiles(fullPath, usedPackages, depth + 1);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (SCAN_EXTENSIONS.has(ext)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          extractImports(content, usedPackages);
        } catch {
          // Binary or unreadable file
        }
      }
    }
  }
}

/**
 * Extract package names from import/require statements in file content.
 */
function extractImports(content, usedPackages) {
  // Match: require('package-name'), require("package-name")
  const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) usedPackages.add(pkg);
  }

  // Match: import ... from 'package-name', import 'package-name'
  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  while ((match = importRegex.exec(content)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) usedPackages.add(pkg);
  }

  // Match: import('package-name') (dynamic import)
  const dynamicImportRegex = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) usedPackages.add(pkg);
  }
}

/**
 * Extract the package name from an import path.
 * Handles scoped packages (@scope/name) and subpaths (package/sub/path).
 */
function extractPackageName(importPath) {
  if (!importPath || importPath.startsWith('.') || importPath.startsWith('/') || importPath.startsWith('http')) {
    return null;
  }
  // Handle Windows paths
  if (importPath.includes('\\') && !importPath.startsWith('@')) {
    return null;
  }
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.slice(0, 2).join('/');
  }
  return importPath.split('/')[0];
}

/**
 * Check if a dependency might be used in package.json scripts or config files.
 */
function isUsedInConfig(pkg, depName) {
  // Check scripts
  const scripts = pkg.scripts || {};
  for (const script of Object.values(scripts)) {
    if (script.includes(depName)) return true;
  }

  // Check for common config-based packages
  const configBased = new Set([
    'eslint', 'prettier', 'typescript', 'jest', 'vitest', 'vite',
    'webpack', 'rollup', 'babel', 'postcss', 'tailwindcss', 'sass',
    'husky', 'lint-staged', 'commitlint', 'stylelint', 'tsc',
    'ts-node', 'tsx', '@typescript-eslint', 'core-js'
  ]);
  if (configBased.has(depName) || [...configBased].some(c => depName.startsWith(c))) {
    return true;
  }

  return false;
}

/**
 * Check if a module name is a Node.js builtin module.
 */
function isBuiltinModule(name) {
  const builtins = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
    'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel',
    'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
    'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
    'process', 'punycode', 'querystring', 'readline', 'repl',
    'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
    'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
    'node:assert', 'node:async_hooks', 'node:buffer', 'node:child_process',
    'node:cluster', 'node:console', 'node:crypto', 'node:dgram',
    'node:dns', 'node:events', 'node:fs', 'node:http', 'node:http2',
    'node:https', 'node:module', 'node:net', 'node:os', 'node:path',
    'node:process', 'node:readline', 'node:stream', 'node:string_decoder',
    'node:timers', 'node:tls', 'node:url', 'node:util', 'node:v8',
    'node:vm', 'node:worker_threads', 'node:zlib'
  ]);
  return builtins.has(name);
}
