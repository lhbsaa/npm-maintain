import { scanNodeModules, dirSize, formatSize, inspectNodeModules } from '../lib/scanner.js';
import { rmSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getAllCacheInfo, getAllGlobalInfo } from '../lib/cache.js';

// POST /api/cleanup/scan  { rootDir }
async function scan(ctx) {
  let rootDir = ctx.body.rootDir || homedir();
  const results = await scanNodeModules(rootDir, {
    onProgress: (count, path) => {
      // Could implement SSE for real-time updates later
    },
  });

  // Sort by size descending
  results.sort((a, b) => b.size - a.size);

  const totalSize = results.reduce((sum, r) => sum + r.size, 0);
  return {
    rootDir,
    count: results.length,
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
    results: results.map(r => ({ ...r, sizeFormatted: formatSize(r.size) })),
  };
}

// POST /api/cleanup/delete  { paths: [] }
async function deleteDirs(ctx) {
  const paths = ctx.body.paths || [];
  if (paths.length === 0) return { error: 'No paths specified' };

  const results = [];
  for (const p of paths) {
    // Security: only allow deleting paths that are node_modules directories
    const baseName = p.split(/[/\\]/).pop();
    if (baseName !== 'node_modules') {
      results.push({ path: p, success: false, error: 'Only node_modules directories can be deleted' });
      continue;
    }
    // Security: reject path traversal
    if (p.includes('..')) {
      results.push({ path: p, success: false, error: 'Path traversal not allowed' });
      continue;
    }
    if (!existsSync(p)) {
      results.push({ path: p, success: false, error: 'Path does not exist' });
      continue;
    }
    try {
      rmSync(p, { recursive: true, force: true });
      results.push({ path: p, success: true });
    } catch (err) {
      results.push({ path: p, success: false, error: err.message });
    }
  }

  const successCount = results.filter(r => r.success).length;
  return { success: true, deleted: successCount, failed: results.length - successCount, results };
}

// GET /api/cleanup/globals
async function globals(ctx) {
  const infos = await getAllGlobalInfo(ctx.targetDir);
  const managers = infos
    .filter(info => info.root && info.root !== 'N/A')
    .map(info => ({
      pm: info.pm,
      root: info.root,
      rootSize: info.rootSize,
      rootSizeFormatted: info.rootSizeFormatted,
      packageCount: info.packages.length,
      packages: info.packages,
    }));
  const totalSize = managers.reduce((sum, m) => sum + (m.rootSize || 0), 0);
  return { managers, totalSize, totalSizeFormatted: formatSize(totalSize) };
}

// GET /api/cleanup/disk-usage
async function diskUsage(ctx) {
  const caches = await getAllCacheInfo(ctx.targetDir);
  const totalSize = caches.reduce((sum, c) => sum + (c.size || 0), 0);
  return {
    caches: caches.map(c => ({
      pm: c.pm,
      path: c.path,
      size: c.size,
      sizeFormatted: c.sizeFormatted || formatSize(c.size || 0),
      exists: c.exists,
    })),
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
  };
}

// POST /api/cleanup/inspect  { path }
async function inspect(ctx) {
  const { path: nmPath } = ctx.body;
  if (!nmPath) return { error: 'Path is required' };
  // Security: only inspect node_modules directories
  const baseName = nmPath.split(/[/\\]/).pop();
  if (baseName !== 'node_modules') {
    return { error: 'Only node_modules directories can be inspected' };
  }
  if (nmPath.includes('..')) {
    return { error: 'Path traversal not allowed' };
  }
  if (!existsSync(nmPath)) {
    return { error: 'Path does not exist' };
  }
  const info = await inspectNodeModules(nmPath);
  return { path: nmPath, ...info };
}

export const cleanupRoutes = [
  { method: 'POST', pattern: '/api/cleanup/scan',       handler: scan },
  { method: 'POST', pattern: '/api/cleanup/delete',     handler: deleteDirs },
  { method: 'POST', pattern: '/api/cleanup/inspect',    handler: inspect },
  { method: 'GET',  pattern: '/api/cleanup/globals',    handler: globals },
  { method: 'GET',  pattern: '/api/cleanup/disk-usage',  handler: diskUsage },
];
