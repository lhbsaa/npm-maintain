import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { builtinModules } from 'module';
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

  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  const allDeps = new Set([...deps, ...devDeps]);

  // Skip the tool itself
  allDeps.delete('pkg-maintain');

  // Collect all imported/required package names from source files
  const usedPackages = new Set();
  await scanSourceFiles(cwd, usedPackages);

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
async function scanSourceFiles(dir, usedPackages, depth = 0) {
  if (depth > 15) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await scanSourceFiles(fullPath, usedPackages, depth + 1);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (SCAN_EXTENSIONS.has(ext)) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          extractImports(content, usedPackages);
        } catch {
          // Binary or unreadable file
        }
      }
    }
  }
}

/**
 * Strip JS/TS comments so import-like text inside comments (e.g. examples in
 * doc comments) is not mistaken for real imports. Best-effort: string literals
 * containing // or /* may be affected, but URL/local-path imports are already
 * filtered out by extractPackageName.
 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/[^\n]*/g, '');          // line comments
}

/**
 * Extract package names from import/require/export statements in file content.
 */
function extractImports(content, usedPackages) {
  const code = stripComments(content);
  let match;

  // Match: require('package-name'), require("package-name")
  const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) usedPackages.add(pkg);
  }

  // Match: import ... from 'package-name', import 'package-name'
  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  while ((match = importRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) usedPackages.add(pkg);
  }

  // Match: import('package-name') (dynamic import)
  const dynamicImportRegex = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) usedPackages.add(pkg);
  }

  // Match: export ... from 'package-name' (re-exports like export { x } from 'pkg')
  const exportRegex = /export\s+(?:[\s\S]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  while ((match = exportRegex.exec(code)) !== null) {
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
 * Uses Node's own builtinModules list so it stays accurate across versions
 * and covers newer modules (test, sea, node:dns/promises, ...).
 */
function isBuiltinModule(name) {
  const bare = name.startsWith('node:') ? name.slice(5) : name;
  return builtinModules.includes(bare) || builtinModules.includes('node:' + bare);
}
