import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Validate a package name is safe for shell interpolation.
 * Allows: alphanumeric, hyphens, underscores, dots, @scope prefix, @version suffix.
 * Rejects: shell metacharacters (;|&$`<>!#\ etc.)
 * @throws Error on invalid name
 */
export function validatePackageName(name) {
  if (!name || typeof name !== 'string') throw new Error('Package name is required');
  // Allow scoped packages like @scope/name, and versioned like pkg@1.2.3
  const safePattern = /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*(@[a-zA-Z0-9._^~*-]+)?$/;
  if (!safePattern.test(name)) throw new Error(`Invalid package name: ${name}`);
  return name;
}

/**
 * Detect which package manager is in use based on lockfile presence.
 * Priority: pnpm-lock.yaml > yarn.lock > package-lock.json > npm (default)
 */
export function detectPackageManager(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Command mapping table for each package manager.
 * Each entry is a function that returns the full command string.
 */
export const PM_COMMANDS = {
  npm: {
    label: 'npm',
    install: (name, isDev) => `npm install ${isDev ? '--save-dev' : '--save'} ${validatePackageName(name)}`,
    uninstall: (name) => `npm uninstall ${validatePackageName(name)}`,
    upgrade: (name) => `npm install ${validatePackageName(name)}@latest`,
    update: (name) => `npm update ${validatePackageName(name)}`,
    updateAll: () => `npm update`,
    registry: () => `npm config get registry`,
    ls: () => `npm ls --json --all --depth=0`,
    lsAll: () => `npm ls --json --all`,
    outdated: () => `npm outdated --json`,
    dedupe: () => `npm dedupe`,
    prune: () => `npm prune`,
    cachePath: () => `npm config get cache`,
    cacheClean: () => `npm cache clean --force`,
    cacheVerify: () => `npm cache verify`,
    globalRoot: () => `npm root -g`,
    globalLs: () => `npm ls -g --depth=0 --json`,
  },
  pnpm: {
    label: 'pnpm',
    install: (name, isDev) => `pnpm add ${isDev ? '--save-dev' : ''} ${validatePackageName(name)}`.replace(/  +/g, ' '),
    uninstall: (name) => `pnpm remove ${validatePackageName(name)}`,
    upgrade: (name) => `pnpm update ${validatePackageName(name)} --latest`,
    update: (name) => `pnpm update ${validatePackageName(name)}`,
    updateAll: () => `pnpm update`,
    registry: () => `pnpm config get registry`,
    ls: () => `pnpm ls --json --depth 0`,
    lsAll: () => `pnpm ls --json --depth Infinity`,
    outdated: () => `pnpm outdated --json`,
    dedupe: () => `pnpm dedupe`,
    prune: () => `pnpm prune`,
    storePath: () => `pnpm store path`,
    storePrune: () => `pnpm store prune`,
    globalRoot: () => `pnpm root -g`,
    globalLs: () => `pnpm ls -g --json`,
  },
  yarn: {
    label: 'yarn',
    install: (name, isDev) => `yarn add ${isDev ? '--dev' : ''} ${validatePackageName(name)}`.replace(/  +/g, ' '),
    uninstall: (name) => `yarn remove ${validatePackageName(name)}`,
    upgrade: (name) => `yarn upgrade ${validatePackageName(name)} --latest`,
    update: (name) => `yarn upgrade ${validatePackageName(name)}`,
    updateAll: () => `yarn upgrade`,
    registry: () => `yarn config get registry`,
    ls: () => `yarn list --json --depth=0`,
    lsAll: () => `yarn list --json`,
    outdated: () => `yarn outdated --json`,
    dedupe: () => `yarn dedupe`,
    cacheDir: () => `yarn cache dir`,
    cacheClean: () => `yarn cache clean`,
    globalDir: () => `yarn global dir`,
    globalLs: () => `yarn global list --json`,
  },
};

/**
 * Get the cache-related commands for a given package manager.
 * Returns an object with path/clean commands appropriate for that PM.
 */
export function getCacheCommands(pm) {
  const cmds = PM_COMMANDS[pm];
  if (pm === 'pnpm') {
    return { path: cmds.storePath(), clean: cmds.storePrune(), verify: null };
  }
  if (pm === 'yarn') {
    return { path: cmds.cacheDir(), clean: cmds.cacheClean(), verify: null };
  }
  return { path: cmds.cachePath(), clean: cmds.cacheClean(), verify: cmds.cacheVerify() };
}
