import { getAllCacheInfo, getCacheInfo, getGlobalInfo } from '../lib/cache.js';
import { execText } from '../lib/bridge.js';
import { getCacheCommands, detectPackageManager, PM_COMMANDS } from '../lib/pm.js';
import { formatSize } from '../lib/scanner.js';

// GET /api/cache/info
async function cacheInfo(ctx) {
  const caches = await getAllCacheInfo(ctx.targetDir);
  const totalSize = caches.reduce((sum, c) => sum + (c.size || 0), 0);
  return { caches, totalSize, totalSizeFormatted: formatSize(totalSize) };
}

// POST /api/cache/clean  { pm }
async function cacheClean(ctx) {
  const pm = ctx.body.pm || detectPackageManager(ctx.targetDir);
  const cacheCmds = getCacheCommands(pm);
  const output = await execText(cacheCmds.clean, ctx.targetDir);
  return { success: true, pm, output };
}

// POST /api/cache/verify  { pm }
async function cacheVerify(ctx) {
  const pm = ctx.body.pm || 'npm';
  const cmds = PM_COMMANDS[pm];
  if (!cmds.cacheVerify) {
    return { error: `${pm} does not support cache verify` };
  }
  const output = await execText(cmds.cacheVerify(), ctx.targetDir);
  return { success: true, pm, output };
}

// GET /api/cache/global
async function globalInfo(ctx) {
  const pm = ctx.query.pm || detectPackageManager(ctx.targetDir);
  const info = await getGlobalInfo(pm, ctx.targetDir);
  return info;
}

// GET /api/cache/all-globals
async function allGlobals(ctx) {
  const results = [];
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    try {
      const info = await getGlobalInfo(pm, ctx.targetDir);
      if (info.packages.length > 0 || (info.root && info.root !== 'N/A')) {
        results.push(info);
      }
    } catch {
      // PM not installed
    }
  }
  return { managers: results };
}

// POST /api/cache/store-prune  { pm }
async function storePrune(ctx) {
  const pm = ctx.body.pm || 'pnpm';
  const cmds = PM_COMMANDS[pm];
  if (!cmds.storePrune) {
    return { error: `${pm} does not support store prune` };
  }
  const output = await execText(cmds.storePrune(), ctx.targetDir);
  return { success: true, pm, output };
}

// GET /api/cache/registry
async function registryInfo(ctx) {
  const results = [];
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    const cmds = PM_COMMANDS[pm];
    if (!cmds.registry) continue;
    try {
      const output = await execText(cmds.registry(), ctx.targetDir);
      results.push({ pm, registry: output.trim() });
    } catch {
      // PM not installed
    }
  }
  return { registries: results };
}

export const cacheRoutes = [
  { method: 'GET',  pattern: '/api/cache/info',          handler: cacheInfo },
  { method: 'POST', pattern: '/api/cache/clean',         handler: cacheClean },
  { method: 'POST', pattern: '/api/cache/verify',        handler: cacheVerify },
  { method: 'GET',  pattern: '/api/cache/global',        handler: globalInfo },
  { method: 'GET',  pattern: '/api/cache/all-globals',   handler: allGlobals },
  { method: 'POST', pattern: '/api/cache/store-prune',   handler: storePrune },
  { method: 'GET',  pattern: '/api/cache/registry',      handler: registryInfo },
];
