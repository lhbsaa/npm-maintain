import { existsSync } from 'fs';
import { readdir, rm, stat, readFile } from 'fs/promises';
import { join, extname, sep } from 'path';
import { execJSON, execText } from './bridge.js';
import { PM_COMMANDS } from './pm.js';
import { parseGlobalPackages } from './cache.js';
import { dirSize, formatSize } from './scanner.js';

// Directory names inside a global node_modules that are never packages.
const NM_SKIP = new Set(['.bin', '.pnpm', '.yarn', '.cache', '.package-lock.json']);
// Shim extensions npm/yarn drop into the global root on Windows.
const SHIM_EXTS = new Set(['.cmd', '.ps1', '.bat']);

/**
 * Resolve a package manager's global layout.
 * Layouts differ per PM/platform:
 * - npm:   `npm root -g` IS the node_modules dir; shims live in the prefix
 *          (Windows) or prefix/bin (Unix).
 * - yarn:  `yarn global dir` contains node_modules/ and bin/.
 * - pnpm:  versioned store layout with shims managed by pnpm itself — we only
 *          report orphan dirs and skip shim detection entirely.
 * @returns {Promise<{pm, root, nodeModules, shimDir: string|null} | null>}
 */
async function getGlobalLayout(pm, cwd) {
  const firstLine = async cmd => (await execText(cmd, cwd)).trim().split('\n')[0];
  try {
    if (pm === 'npm') {
      const nodeModules = await firstLine('npm root -g');
      if (!nodeModules || !existsSync(nodeModules)) return null;
      let shimDir = null;
      try {
        const prefix = await firstLine('npm prefix -g');
        shimDir = process.platform === 'win32' ? prefix : join(prefix, 'bin');
      } catch {
        shimDir = process.platform === 'win32' ? join(nodeModules, '..') : null;
      }
      return { pm, root: nodeModules, nodeModules, shimDir };
    }
    if (pm === 'yarn') {
      const root = await firstLine('yarn global dir');
      if (!root || !existsSync(root)) return null;
      return { pm, root, nodeModules: join(root, 'node_modules'), shimDir: join(root, 'bin') };
    }
    const nodeModules = await firstLine('pnpm root -g');
    if (!nodeModules || !existsSync(nodeModules)) return null;
    return { pm, root: nodeModules, nodeModules, shimDir: null };
  } catch {
    return null;
  }
}

/**
 * Parse the set of registered global package names from ls output.
 * yarn 1 streams `{"type":"list","data":{"trees":[{"name":"pkg@ver"}]}}`,
 * which parseGlobalPackages does not handle, so special-case it.
 * @returns {Set<string> | null} null when the output could not be parsed.
 */
export function parseRegisteredNames(data, pm) {
  if (pm === 'yarn' && data?.data?.trees && Array.isArray(data.data.trees)) {
    return new Set(data.data.trees.map(t => String(t.name).replace(/@[^/]+$/, '')));
  }
  const pkgs = parseGlobalPackages(data, pm);
  if (pkgs.length > 0) return new Set(pkgs.map(p => p.name));
  // Empty arrays / plain objects (npm ls --json with no globals prints {})
  // are valid empty registries; only bridge fallback shapes mean parse failure.
  if (Array.isArray(data)) return new Set();
  if (data && typeof data === 'object' && !data.raw && !data.error) return new Set();
  return null;
}

/**
 * List package directories under a global node_modules, resolving scoped dirs.
 */
async function listPackageDirs(nodeModules) {
  const dirs = [];
  const entries = await readdir(nodeModules, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || NM_SKIP.has(entry.name)) continue;
    if (entry.name.startsWith('@')) {
      const scopePath = join(nodeModules, entry.name);
      const scoped = await readdir(scopePath, { withFileTypes: true }).catch(() => []);
      for (const sub of scoped) {
        if (sub.isDirectory()) dirs.push({ name: `${entry.name}/${sub.name}`, path: join(scopePath, sub.name) });
      }
    } else {
      dirs.push({ name: entry.name, path: join(nodeModules, entry.name) });
    }
  }
  return dirs;
}

/**
 * Build a map of bin-name → package-name from the installed global packages.
 * Shim names come from each package's bin field (e.g. @anthropic-ai/claude-code
 * installs `claude`), so package names alone cannot tell valid shims apart.
 */
async function buildBinMap(nodeModules, registered) {
  const binMap = new Map();
  for (const name of registered) {
    try {
      const pkg = JSON.parse(await readFile(join(nodeModules, ...name.split('/'), 'package.json'), 'utf-8'));
      const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.keys(pkg.bin || {});
      for (const bin of bins) binMap.set(bin, name);
    } catch {
      // unreadable package — treat its shims as unknown, not orphan
      binMap.set(name, name);
    }
  }
  return binMap;
}

/**
 * Scan every installed package manager's global dir for residue:
 * - orphan package dirs: on disk but no longer in the global registry list
 * - stray shims: bin wrappers (pkg, pkg.cmd, pkg.ps1) with no package dir left
 * @returns {Promise<{managers: Array}>}
 */
export async function scanGlobalResidue(cwd) {
  const managers = [];
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    const layout = await getGlobalLayout(pm, cwd);
    if (!layout) continue;

    let registered = null;
    try {
      const data = await execJSON(PM_COMMANDS[pm].globalLs(), cwd);
      registered = parseRegisteredNames(data, pm);
    } catch {
      registered = null;
    }

    const orphans = [];
    const shims = [];
    if (registered === null) {
      // Could not read the registry list — do not guess, mark unknown.
      managers.push({ pm, root: layout.root, registered: 'unknown', orphans, shims });
      continue;
    }

    if (existsSync(layout.nodeModules)) {
      for (const dir of await listPackageDirs(layout.nodeModules)) {
        if (registered.has(dir.name)) continue;
        const size = await dirSize(dir.path);
        orphans.push({
          name: dir.name,
          path: dir.path,
          size,
          sizeFormatted: formatSize(size),
        });
      }
    }

    // Stray shims live in the PM's bin dir (npm prefix[/bin], yarn global/bin).
    // pnpm manages its own bin layout, so shimDir is null for it.
    if (layout.shimDir && existsSync(layout.shimDir)) {
      const binMap = await buildBinMap(layout.nodeModules, registered);
      const shimEntries = await readdir(layout.shimDir, { withFileTypes: true }).catch(() => []);
      for (const entry of shimEntries) {
        if (!entry.isFile()) continue;
        const ext = extname(entry.name);
        const bare = ext ? entry.name.slice(0, -ext.length) : entry.name;
        if (!SHIM_EXTS.has(ext) && ext !== '') continue; // only shim-like names
        if (binMap.has(bare)) continue; // valid bin of an installed package
        // A shim is stray only when its package dir is gone too.
        if (existsSync(join(layout.nodeModules, entry.name)) || existsSync(join(layout.nodeModules, bare))) continue;
        shims.push({ name: entry.name, path: join(layout.shimDir, entry.name) });
      }
    }

    managers.push({ pm, root: layout.root, registered: 'ok', orphans, shims });
  }
  return { managers };
}

/**
 * Check that a path is strictly inside a parent directory.
 * Separator- and case-insensitive: `npm root -g` output may mix `/` and `\`,
 * and readdir joins always use the native separator.
 */
export function isInside(parent, child) {
  const norm = s => process.platform === 'win32' ? s.toLowerCase().replace(/\//g, '\\') : s;
  const p = norm(parent);
  const c = norm(child);
  return c.startsWith(p + sep) && c.length > p.length + sep.length;
}

/**
 * Delete residue items reported by scanGlobalResidue.
 * Every path is re-validated against the current global layout so a stale or
 * tampered payload cannot touch anything outside the global dirs.
 * @param {string} cwd
 * @param {Array<{pm: string, kind: 'dir'|'shim', path: string}>} items
 * @returns {Promise<{results: Array}>}
 */
export async function deleteGlobalResidue(cwd, items) {
  const layouts = {};
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    layouts[pm] = await getGlobalLayout(pm, cwd);
  }

  const results = [];
  for (const item of items) {
    const layout = layouts[item.pm];
    if (!layout) {
      results.push({ ...item, success: false, error: 'Global dir unavailable' });
      continue;
    }
    const base = item.kind === 'dir' ? layout.nodeModules : layout.shimDir;
    if (!base) {
      results.push({ ...item, success: false, error: `${item.pm} shim cleanup is not supported` });
      continue;
    }
    if (!isInside(base, item.path)) {
      results.push({ ...item, success: false, error: 'Path is outside the global dir' });
      continue;
    }
    try {
      const st = await stat(item.path);
      const isDir = st.isDirectory();
      if (item.kind === 'dir' && !isDir) {
        results.push({ ...item, success: false, error: 'Expected a directory' });
        continue;
      }
      if (item.kind === 'shim' && isDir) {
        results.push({ ...item, success: false, error: 'Expected a file' });
        continue;
      }
      await rm(item.path, { recursive: true, force: true });
      results.push({ ...item, success: true });
    } catch (err) {
      results.push({ ...item, success: false, error: err.message });
    }
  }
  return { results };
}
