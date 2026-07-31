import { readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Recursively calculate the total size of a directory.
 * Uses sync fs for simplicity in a local tool.
 * @param {string} dirPath
 * @returns {number} size in bytes
 */
export function dirSize(dirPath) {
  let totalSize = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          totalSize += dirSize(fullPath);
        } else if (entry.isFile()) {
          totalSize += statSync(fullPath).size;
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
    ...excludeDirs,
  ]);

  function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Found a node_modules directory at this level
      if (entry.isDirectory() && entry.name === 'node_modules') {
        const fullPath = join(dir, entry.name);
        try {
          const stat = statSync(fullPath);
          const size = dirSize(fullPath);
          const type = detectProjectType(dir);
          results.push({
            path: fullPath,
            size,
            lastModified: stat.mtime.toISOString(),
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
        walk(join(dir, entry.name), depth + 1);
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

/**
 * Detect the package manager type for a project directory.
 */
function detectProjectType(dir) {
  try {
    const entries = readdirSync(dir);
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
