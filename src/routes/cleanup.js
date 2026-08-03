import { scanNodeModules, formatSize, inspectNodeModules } from '../lib/scanner.js';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { getAllCacheInfo, getAllGlobalInfo } from '../lib/cache.js';
import { scanGlobalResidue, deleteGlobalResidue } from '../lib/global-cleanup.js';

// In-memory progress of the most recent scan, polled by the UI.
let scanProgress = null;

// POST /api/cleanup/scan  { rootDir }
async function scan(ctx) {
  // Default to the user's home dir — matches the UI hint and the tool's
  // purpose of finding stray node_modules across the filesystem.
  let rootDir = ctx.body.rootDir || homedir();
  scanProgress = { rootDir, found: 0, current: '', running: true, startedAt: Date.now() };
  const results = await scanNodeModules(rootDir, {
    onProgress: (count, path) => {
      scanProgress.found = count;
      scanProgress.current = path;
    },
  });
  scanProgress.running = false;

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

// GET /api/cleanup/scan-progress
async function scanProgressHandler(ctx) {
  return scanProgress || { running: false, found: 0, current: '', rootDir: '' };
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
      await rm(p, { recursive: true, force: true });
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

// GET /api/cleanup/global-residue
async function globalResidue(ctx) {
  return scanGlobalResidue(ctx.targetDir);
}

// POST /api/cleanup/global-residue/delete  { items: [{ pm, kind, path }] }
async function deleteGlobalResidueHandler(ctx) {
  const items = ctx.body.items || [];
  if (items.length === 0) return { error: 'No items specified' };
  const { results } = await deleteGlobalResidue(ctx.targetDir, items);
  const deleted = results.filter(r => r.success).length;
  return { success: true, deleted, failed: results.length - deleted, results };
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
  { method: 'GET',  pattern: '/api/cleanup/scan-progress', handler: scanProgressHandler },
  { method: 'POST', pattern: '/api/cleanup/delete',     handler: deleteDirs },
  { method: 'POST', pattern: '/api/cleanup/inspect',    handler: inspect },
  { method: 'GET',  pattern: '/api/cleanup/globals',    handler: globals },
  { method: 'GET',  pattern: '/api/cleanup/global-residue', handler: globalResidue },
  { method: 'POST', pattern: '/api/cleanup/global-residue/delete', handler: deleteGlobalResidueHandler },
  { method: 'GET',  pattern: '/api/cleanup/disk-usage',  handler: diskUsage },
];
