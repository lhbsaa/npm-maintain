import { detectPackageManager, PM_COMMANDS } from '../lib/pm.js';
import { execText, execJSON } from '../lib/bridge.js';
import { findUnusedDeps } from '../lib/unused.js';

// GET /api/health/tree
async function depTree(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const data = await execJSON(PM_COMMANDS[pm].lsAll(), ctx.targetDir);
  return { pm, tree: data };
}

// GET /api/health/duplicates
async function duplicates(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const data = await execJSON(PM_COMMANDS[pm].lsAll(), ctx.targetDir);

  // Walk the dependency tree and find packages with multiple versions
  const versionMap = new Map(); // name -> Set of versions

  function walk(node) {
    if (!node || !node.dependencies) return;
    for (const [name, info] of Object.entries(node.dependencies)) {
      if (info.version) {
        if (!versionMap.has(name)) {
          versionMap.set(name, new Map()); // version -> count
        }
        const versions = versionMap.get(name);
        versions.set(info.version, (versions.get(info.version) || 0) + 1);
      }
      // Recurse into nested deps
      walk(info);
    }
  }

  walk(data);

  // Find packages with more than one version
  const dups = [];
  for (const [name, versions] of versionMap) {
    if (versions.size > 1) {
      dups.push({
        name,
        versions: [...versions.entries()].map(([ver, count]) => ({ version: ver, count })),
        versionCount: versions.size,
      });
    }
  }

  dups.sort((a, b) => b.versionCount - a.versionCount);

  return { pm, duplicates: dups, totalUnique: versionMap.size };
}

// POST /api/health/dedupe
async function dedupe(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const output = await execText(PM_COMMANDS[pm].dedupe(), ctx.targetDir);
  return { success: true, pm, output };
}

// GET /api/health/unused
async function unused(ctx) {
  const result = await findUnusedDeps(ctx.targetDir);
  return result;
}

// POST /api/health/prune
async function prune(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const output = await execText(PM_COMMANDS[pm].prune(), ctx.targetDir);
  return { success: true, pm, output };
}

// GET /api/health/outdated
async function outdated(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const data = await execJSON(PM_COMMANDS[pm].outdated(), ctx.targetDir);

  // npm outdated returns: { "package-name": { current, wanted, latest, type } }
  // pnpm outdated returns: array or object depending on version
  const packages = [];
  if (Array.isArray(data)) {
    // pnpm format
    for (const pkg of data) {
      if (pkg.current !== pkg.latest) {
        packages.push({
          name: pkg.name || pkg.dependencyName,
          current: pkg.current || pkg.installedVersion,
          wanted: pkg.wanted,
          latest: pkg.latest || pkg.latestVersion,
          type: pkg.type || pkg.dependencyType,
        });
      }
    }
  } else {
    // npm format
    for (const [name, info] of Object.entries(data)) {
      packages.push({
        name,
        current: info.current || 'missing',
        wanted: info.wanted,
        latest: info.latest,
        type: info.type || 'dep',
      });
    }
  }

  return { pm, outdated: packages };
}

export const healthRoutes = [
  { method: 'GET',  pattern: '/api/health/tree',       handler: depTree },
  { method: 'GET',  pattern: '/api/health/duplicates', handler: duplicates },
  { method: 'POST', pattern: '/api/health/dedupe',     handler: dedupe },
  { method: 'GET',  pattern: '/api/health/unused',     handler: unused },
  { method: 'POST', pattern: '/api/health/prune',      handler: prune },
  { method: 'GET',  pattern: '/api/health/outdated',   handler: outdated },
];
