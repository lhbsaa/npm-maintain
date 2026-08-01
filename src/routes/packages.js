import { detectPackageManager, PM_COMMANDS, validatePackageName } from '../lib/pm.js';
import { execText, execJSON } from '../lib/bridge.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseGlobalPackages } from '../lib/cache.js';

// GET /api/packages/list
async function listPackages(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const data = await execJSON(PM_COMMANDS[pm].ls(), ctx.targetDir);

  const pkgPath = join(ctx.targetDir, 'package.json');
  let pkg = {};
  if (existsSync(pkgPath)) {
    pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  }

  // Parse into a clean array of { name, installed, wanted, type }
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  const installed = data.dependencies || {};

  const packages = [];
  for (const [name, range] of Object.entries(deps)) {
    const info = installed[name] || {};
    packages.push({ name, wanted: range, installed: info.version || 'missing', type: 'dep' });
  }
  for (const [name, range] of Object.entries(devDeps)) {
    const info = installed[name] || {};
    packages.push({ name, wanted: range, installed: info.version || 'missing', type: 'dev' });
  }

  return { pm, packages, projectName: pkg.name || 'unnamed' };
}

// GET /api/packages/search?q=
async function searchPackages(ctx) {
  const q = ctx.query.q || '';
  if (!q.trim()) return { objects: [] };
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`;
  const res = await fetch(url);
  const data = await res.json();
  return data;
}

// GET /api/packages/latest/:name
async function getLatestVersion(ctx) {
  const name = ctx.params.name;
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const res = await fetch(url);
  if (!res.ok) return { name, latest: null, error: 'Package not found' };
  const data = await res.json();
  return { name, latest: data.version, description: data.description };
}

// POST /api/packages/install  { name, isDev }
async function installPackage(ctx) {
  const { name, isDev } = ctx.body;
  if (!name) return { error: 'Package name is required' };
  const pm = detectPackageManager(ctx.targetDir);
  const cmd = PM_COMMANDS[pm].install(name, isDev);
  const output = await execText(cmd, ctx.targetDir);
  return { success: true, pm, output };
}

// POST /api/packages/uninstall  { name }
async function uninstallPackage(ctx) {
  const { name } = ctx.body;
  if (!name) return { error: 'Package name is required' };
  const pm = detectPackageManager(ctx.targetDir);
  const cmd = PM_COMMANDS[pm].uninstall(name);
  const output = await execText(cmd, ctx.targetDir);
  return { success: true, pm, output };
}

// POST /api/packages/upgrade  { name }
async function upgradePackage(ctx) {
  const { name } = ctx.body;
  if (!name) return { error: 'Package name is required' };
  const pm = detectPackageManager(ctx.targetDir);
  const cmd = PM_COMMANDS[pm].upgrade(name);
  const output = await execText(cmd, ctx.targetDir);
  return { success: true, pm, output };
}

// POST /api/packages/update  { name }
async function updatePackage(ctx) {
  const { name } = ctx.body;
  if (!name) return { error: 'Package name is required' };
  const pm = detectPackageManager(ctx.targetDir);
  const cmd = PM_COMMANDS[pm].update(name);
  const output = await execText(cmd, ctx.targetDir);
  return { success: true, pm, output };
}

// POST /api/packages/update-all
async function updateAllPackages(ctx) {
  const pm = detectPackageManager(ctx.targetDir);
  const cmd = PM_COMMANDS[pm].updateAll();
  const output = await execText(cmd, ctx.targetDir);
  return { success: true, pm, output };
}

// GET /api/packages/global-list
async function listGlobalPackages(ctx) {
  const results = [];
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    const cmds = PM_COMMANDS[pm];
    if (!cmds || !cmds.globalLs) continue;
    try {
      const data = await execJSON(cmds.globalLs(), ctx.targetDir);
      const packages = parseGlobalPackages(data, pm);
      if (packages.length > 0) {
        results.push({ pm, packages });
      }
    } catch {
      // PM not installed or command failed
    }
  }
  return { managers: results };
}

// POST /api/packages/global-uninstall  { name, pm }
async function globalUninstallPackage(ctx) {
  const { name, pm: pmName } = ctx.body;
  if (!name) return { error: 'Package name is required' };
  try {
    validatePackageName(name);
  } catch (e) {
    return { error: e.message };
  }
  const pm = pmName || 'npm';
  let cmd;
  if (pm === 'npm') cmd = `npm uninstall -g ${name}`;
  else if (pm === 'pnpm') cmd = `pnpm remove -g ${name}`;
  else if (pm === 'yarn') cmd = `yarn global remove ${name}`;
  else return { error: `Unsupported package manager: ${pm}` };
  const output = await execText(cmd, ctx.targetDir);
  return { success: true, pm, output };
}

export const packagesRoutes = [
  { method: 'GET',  pattern: '/api/packages/list',            handler: listPackages },
  { method: 'GET',  pattern: '/api/packages/global-list',     handler: listGlobalPackages },
  { method: 'GET',  pattern: '/api/packages/search',          handler: searchPackages },
  { method: 'GET',  pattern: '/api/packages/latest/:name',    handler: getLatestVersion },
  { method: 'POST', pattern: '/api/packages/install',         handler: installPackage },
  { method: 'POST', pattern: '/api/packages/uninstall',        handler: uninstallPackage },
  { method: 'POST', pattern: '/api/packages/upgrade',          handler: upgradePackage },
  { method: 'POST', pattern: '/api/packages/update',          handler: updatePackage },
  { method: 'POST', pattern: '/api/packages/update-all',     handler: updateAllPackages },
  { method: 'POST', pattern: '/api/packages/global-uninstall', handler: globalUninstallPackage },
];
