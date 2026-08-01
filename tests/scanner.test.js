import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirSize, formatSize, scanNodeModules, inspectNodeModules } from '../src/lib/scanner.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function mkTmp() {
  return mkdtempSync(join(tmpdir(), 'scan-test-'));
}

describe('formatSize', () => {
  test('zero / negative / null', () => {
    assert.equal(formatSize(0), '0 B');
    assert.equal(formatSize(-5), '0 B');
    assert.equal(formatSize(null), '0 B');
  });
  test('bytes', () => {
    assert.equal(formatSize(500), '500 B');
  });
  test('KB / MB / GB', () => {
    assert.equal(formatSize(1024), '1.00 KB');
    assert.equal(formatSize(1048576), '1.00 MB');
    assert.equal(formatSize(1073741824), '1.00 GB');
  });
});

describe('dirSize', () => {
  test('sums file sizes recursively', async () => {
    const dir = mkTmp();
    writeFileSync(join(dir, 'a.txt'), 'aaaa'); // 4 bytes
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.txt'), 'bbbbbb'); // 6 bytes
    const size = await dirSize(dir);
    assert.equal(size, 10);
    rmSync(dir, { recursive: true, force: true });
  });

  test('nonexistent directory returns 0', async () => {
    const size = await dirSize(join(tmpdir(), 'no-such-dir-xyz-123'));
    assert.equal(size, 0);
  });
});

describe('scanNodeModules', () => {
  test('finds top-level node_modules and sizes them', async () => {
    const root = mkTmp();
    const proj = join(root, 'projA');
    mkdirSync(join(proj, 'node_modules', 'lodash'), { recursive: true });
    writeFileSync(join(proj, 'node_modules', 'lodash', 'pkg.json'), '{}');
    writeFileSync(join(proj, 'package.json'), '{}');
    const results = await scanNodeModules(root, { maxDepth: 5 });
    assert.equal(results.length, 1);
    assert.ok(results[0].path.endsWith('node_modules'));
    assert.ok(results[0].size > 0);
    rmSync(root, { recursive: true, force: true });
  });

  test('does not recurse into node_modules', async () => {
    const root = mkTmp();
    mkdirSync(join(root, 'proj', 'node_modules', 'dep', 'node_modules'), { recursive: true });
    const results = await scanNodeModules(root, { maxDepth: 8 });
    assert.equal(results.length, 1);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('inspectNodeModules', () => {
  test('counts packages and sorts by size descending', async () => {
    const nm = mkTmp();
    mkdirSync(join(nm, 'small'));
    writeFileSync(join(nm, 'small', 'f.txt'), 'a');
    mkdirSync(join(nm, 'big'));
    writeFileSync(join(nm, 'big', 'f.txt'), 'aaaaaaaaaa');
    const info = await inspectNodeModules(nm);
    assert.equal(info.packageCount, 2);
    assert.equal(info.topPackages[0].name, 'big');
    rmSync(nm, { recursive: true, force: true });
  });

  test('handles scoped packages (@scope/pkg)', async () => {
    const nm = mkTmp();
    mkdirSync(join(nm, '@scope', 'pkg'), { recursive: true });
    writeFileSync(join(nm, '@scope', 'pkg', 'f.txt'), 'aa');
    const info = await inspectNodeModules(nm);
    assert.equal(info.packageCount, 1);
    assert.equal(info.topPackages[0].name, '@scope/pkg');
    rmSync(nm, { recursive: true, force: true });
  });

  test('nonexistent path returns empty', async () => {
    const info = await inspectNodeModules(join(tmpdir(), 'no-such-nm-xyz'));
    assert.equal(info.packageCount, 0);
  });
});
