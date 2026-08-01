import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePackageName, detectPackageManager, PM_COMMANDS, getCacheCommands } from '../src/lib/pm.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function mkTmpDir() {
  return mkdtempSync(join(tmpdir(), 'pm-test-'));
}

describe('validatePackageName', () => {
  test('accepts valid names', () => {
    const valid = ['lodash', '@scope/pkg', 'pkg@1.2.3', '@scope/pkg@latest', 'react', '@types/node'];
    for (const n of valid) {
      assert.equal(validatePackageName(n), n);
    }
  });

  test('rejects shell metacharacters (injection-safe)', () => {
    const bad = [
      'pkg; rm -rf /', 'pkg && whoami', 'pkg`id`', 'pkg$(whoami)',
      'pkg|cat /etc/passwd', 'pkg > /tmp/x', 'pkg\nwhoami', 'pkg & calc',
    ];
    for (const b of bad) {
      assert.throws(() => validatePackageName(b), /Invalid package name/);
    }
  });

  test('rejects empty / null / undefined', () => {
    assert.throws(() => validatePackageName(''));
    assert.throws(() => validatePackageName(null));
    assert.throws(() => validatePackageName(undefined));
  });
});

describe('detectPackageManager', () => {
  test('defaults to npm with no lockfile', () => {
    const dir = mkTmpDir();
    assert.equal(detectPackageManager(dir), 'npm');
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects pnpm via pnpm-lock.yaml', () => {
    const dir = mkTmpDir();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    assert.equal(detectPackageManager(dir), 'pnpm');
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects yarn via yarn.lock', () => {
    const dir = mkTmpDir();
    writeFileSync(join(dir, 'yarn.lock'), '');
    assert.equal(detectPackageManager(dir), 'yarn');
    rmSync(dir, { recursive: true, force: true });
  });

  test('packageManager field takes priority over lockfile', () => {
    const dir = mkTmpDir();
    writeFileSync(join(dir, 'yarn.lock'), ''); // would imply yarn
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@8.15.0' }));
    assert.equal(detectPackageManager(dir), 'pnpm');
    rmSync(dir, { recursive: true, force: true });
  });

  test('packageManager field recognizes yarn', () => {
    const dir = mkTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.0.0' }));
    assert.equal(detectPackageManager(dir), 'yarn');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('getCacheCommands', () => {
  test('npm has path/clean/verify', () => {
    const c = getCacheCommands('npm');
    assert.ok(c.path);
    assert.ok(c.clean);
    assert.ok(c.verify);
  });
  test('pnpm has path/clean, verify is null', () => {
    const c = getCacheCommands('pnpm');
    assert.ok(c.path);
    assert.ok(c.clean);
    assert.equal(c.verify, null);
  });
  test('yarn has path/clean, verify is null', () => {
    const c = getCacheCommands('yarn');
    assert.ok(c.path);
    assert.ok(c.clean);
    assert.equal(c.verify, null);
  });
});

describe('PM_COMMANDS', () => {
  for (const pm of ['npm', 'pnpm', 'yarn']) {
    test(`${pm} exposes core commands`, () => {
      const cmds = PM_COMMANDS[pm];
      assert.ok(cmds.install);
      assert.ok(cmds.uninstall);
      assert.ok(cmds.upgrade);
      assert.ok(cmds.ls);
      assert.ok(cmds.outdated);
      assert.ok(cmds.dedupe);
    });
  }

  test('install command validates package name (injection-safe)', () => {
    assert.throws(() => PM_COMMANDS.npm.install('pkg; rm -rf /', false), /Invalid package name/);
  });
});
