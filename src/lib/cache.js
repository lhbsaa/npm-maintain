import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { dirSize, formatSize } from './scanner.js';
import { execText, execJSON, execCommand } from './bridge.js';
import { PM_COMMANDS, getCacheCommands } from './pm.js';

/**
 * Parse global packages from ls output (npm/pnpm/yarn format differences).
 * Shared between cache routes and packages routes.
 */
export function parseGlobalPackages(data, pm) {
  const packages = [];
  if (pm === 'npm' && data.dependencies) {
    for (const [name, info] of Object.entries(data.dependencies)) {
      const ver = info.version
        || ('overridden' in info ? 'overridden' : (info.link ? 'linked' : 'unknown'));
      packages.push({ name, version: ver });
    }
  } else if (pm === 'pnpm' && Array.isArray(data)) {
    for (const pkg of data) {
      if (pkg.name) packages.push({ name: pkg.name, version: pkg.version || 'unknown' });
    }
  } else if (data.dependencies) {
    for (const [name, info] of Object.entries(data.dependencies)) {
      const ver = info.version
        || ('overridden' in info ? 'overridden' : (info.link ? 'linked' : 'unknown'));
      packages.push({ name, version: ver });
    }
  }
  return packages;
}

/**
 * Get cache information for a specific package manager.
 * @param {string} pm - 'npm' | 'pnpm' | 'yarn'
 * @param {string} cwd - Working directory
 * @returns {Promise<object>} { pm, path, size, sizeFormatted }
 */
export async function getCacheInfo(pm, cwd) {
  const cacheCmds = getCacheCommands(pm);
  let cachePath = '';

  try {
    cachePath = await execText(cacheCmds.path, cwd);
    // pnpm store path may have quotes or extra output
    cachePath = cachePath.replace(/['"]/g, '').trim().split('\n')[0];
  } catch {
    // Fallback to default paths
    cachePath = getDefaultCachePath(pm);
  }

  let size = 0;
  if (cachePath && existsSync(cachePath)) {
    size = await dirSize(cachePath);
  }

  return {
    pm,
    path: cachePath || 'N/A',
    exists: cachePath && existsSync(cachePath),
    size,
    sizeFormatted: formatSize(size),
  };
}

/**
 * Check if a command exists on the system (fast, non-blocking).
 * Reuses the shared exec bridge instead of a separate dynamic import.
 */
async function commandExists(cmd) {
  const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
  try {
    await execCommand(checkCmd, undefined, 3000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get cache info for all installed package managers.
 */
export async function getAllCacheInfo(cwd) {
  const managers = ['npm'];
  for (const pm of ['pnpm', 'yarn']) {
    if (await commandExists(pm)) {
      managers.push(pm);
    }
  }

  const results = [];
  for (const pm of managers) {
    try {
      results.push(await getCacheInfo(pm, cwd));
    } catch (err) {
      results.push({ pm, error: err.message, path: 'N/A', size: 0, sizeFormatted: 'N/A' });
    }
  }
  return results;
}

/**
 * Get default cache path for a package manager (fallback).
 */
function getDefaultCachePath(pm) {
  const home = homedir();
  if (pm === 'pnpm') {
    // pnpm store: ~/.local/share/pnpm/store or AppData
    if (platform() === 'win32') {
      return join(home, 'AppData', 'Local', 'pnpm', 'store');
    }
    return join(home, '.local', 'share', 'pnpm', 'store');
  }
  if (pm === 'yarn') {
    if (platform() === 'win32') {
      return join(home, 'AppData', 'Local', 'Yarn', 'Cache');
    }
    return join(home, '.cache', 'yarn');
  }
  // npm
  if (platform() === 'win32') {
    return join(home, 'AppData', 'Local', 'npm-cache');
  }
  return join(home, '.npm');
}

/**
 * Get global packages info for a package manager.
 * @param {string} pm - 'npm' | 'pnpm' | 'yarn'
 * @param {string} cwd - Working directory
 * @returns {Promise<object>} { pm, root, packages }
 */
export async function getGlobalInfo(pm, cwd) {
  const cmds = PM_COMMANDS[pm];
  let root = '';
  let packages = [];

  try {
    root = await execText(cmds.globalRoot(), cwd);
    root = root.trim().split('\n')[0];
  } catch {
    root = '';
  }

  try {
    const data = await execJSON(cmds.globalLs(), cwd);
    packages = parseGlobalPackages(data, pm);
  } catch {
    // ignore parse errors
  }

  let rootSize = 0;
  if (root && existsSync(root)) {
    rootSize = await dirSize(root);
  }

  return {
    pm,
    root: root || 'N/A',
    rootSize,
    rootSizeFormatted: formatSize(rootSize),
    packages,
  };
}

/**
 * Get global packages info for all installed package managers.
 * Shared by cache/all-globals and cleanup/globals routes to avoid duplicated
 * iteration logic. Returns every manager's info (caller filters as needed).
 */
export async function getAllGlobalInfo(cwd) {
  const results = [];
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    try {
      const info = await getGlobalInfo(pm, cwd);
      results.push(info);
    } catch {
      // PM not installed or command failed
    }
  }
  return results;
}
