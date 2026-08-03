import { readdir, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Recursively calculate the total size of a directory.
 * Uses async fs to avoid blocking the event loop on large trees.
 * Dirent typing (withFileTypes) skips symlinks, so symlink loops cannot recurse.
 * @param {string} dirPath
 * @returns {Promise<number>} size in bytes
 */
export async function dirSize(dirPath) {
  let totalSize = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          totalSize += await dirSize(fullPath);
        } else if (entry.isFile()) {
          totalSize += (await stat(fullPath)).size;
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Directory not accessible
  }
  return totalSize;
}

/**
 * Scan a directory tree for top-level node_modules folders.
 * Skips searching inside node_modules (avoids redundant deep scans).
 * Also detects .pnpm-store, .npm, .yarn cache directories.
 *
 * @param {string} rootDir - Starting directory for the scan
 * @param {object} options - { maxDepth, excludeDirs, onProgress }
 * @returns {Promise<Array>} Array of { path, size, lastModified, type }
 */
export async function scanNodeModules(rootDir, options = {}) {
  const { maxDepth = 8, excludeDirs = [], onProgress } = options;
  const results = [];
  const excludeSet = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.cache',
    'tmp',
    'temp',
    'vendor',
    // System dirs that never hold project node_modules and are huge (Windows/macOS)
    'AppData',
    '.local',
    'Library',
    'Windows',
    'Program Files',
    'Program Files (x86)',
    'System Volume Information',
    'System32',
    ...excludeDirs,
  ]);

  async function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Found a node_modules directory at this level
      if (entry.isDirectory() && entry.name === 'node_modules') {
        const fullPath = join(dir, entry.name);
        try {
          const st = await stat(fullPath);
          const size = await dirSize(fullPath);
          const type = await detectProjectType(dir);
          results.push({
            path: fullPath,
            size,
            lastModified: st.mtime.toISOString(),
            type,
          });
          if (onProgress) onProgress(results.length, fullPath);
        } catch {
          // Permission denied or other error
        }
        // Don't recurse into node_modules
        continue;
      }

      // Recurse into subdirectories (but not excluded ones)
      if (entry.isDirectory() && !excludeSet.has(entry.name)) {
        // Skip hidden directories unless they're cache dirs we care about
        if (entry.name.startsWith('.') && entry.name !== '.config') {
          continue;
        }
        await walk(join(dir, entry.name), depth + 1);
      }
    }
  }

  await walk(rootDir, 0);
  return results;
}

/**
 * Detect the package manager type for a project directory.
 */
async function detectProjectType(dir) {
  try {
    const entries = await readdir(dir);
    if (entries.includes('pnpm-lock.yaml')) return 'pnpm';
    if (entries.includes('yarn.lock')) return 'yarn';
    if (entries.includes('package-lock.json')) return 'npm';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Format bytes to human-readable string.
 */
export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/**
 * Inspect a node_modules directory: count packages, list top packages by size.
 * @param {string} nmPath - path to node_modules directory
 * @returns {Promise<object>} { packageCount, topPackages: [{name, size, sizeFormatted}] }
 */
export async function inspectNodeModules(nmPath) {
  const packages = [];
  try {
    const entries = await readdir(nmPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Handle scoped packages (@scope/pkg)
      if (entry.name.startsWith('@')) {
        try {
          const scoped = await readdir(join(nmPath, entry.name), { withFileTypes: true });
          for (const sub of scoped) {
            if (!sub.isDirectory()) continue;
            const pkgPath = join(nmPath, entry.name, sub.name);
            const size = await dirSize(pkgPath);
            packages.push({ name: `${entry.name}/${sub.name}`, size });
          }
        } catch { /* skip */ }
        continue;
      }
      const pkgPath = join(nmPath, entry.name);
      const size = await dirSize(pkgPath);
      packages.push({ name: entry.name, size });
    }
  } catch {
    // not accessible
  }

  // Sort by size descending
  packages.sort((a, b) => b.size - a.size);

  return {
    packageCount: packages.length,
    topPackages: packages.slice(0, 20).map(p => ({
      name: p.name,
      size: p.size,
      sizeFormatted: formatSize(p.size),
    })),
  };
}
