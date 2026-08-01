import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findUnusedDeps } from '../src/lib/unused.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function mkTmpProj() {
  return mkdtempSync(join(tmpdir(), 'unused-test-'));
}

describe('findUnusedDeps', () => {
  test('flags declared-but-unused packages', async () => {
    const dir = mkTmpProj();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.0.0', express: '^4.0.0' },
    }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), "import _ from 'lodash';\n");
    const result = await findUnusedDeps(dir);
    assert.ok(result.unused.includes('express'));
    assert.ok(!result.unused.includes('lodash'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects export...from re-exports as used', async () => {
    const dir = mkTmpProj();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.0.0' },
    }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), "export { map } from 'lodash';\n");
    const result = await findUnusedDeps(dir);
    assert.ok(!result.unused.includes('lodash'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('ignores import-like text inside comments', async () => {
    const dir = mkTmpProj();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'),
      "// import 'package-name'\n/* import 'other-fake' */\nconsole.log('hi');\n");
    const result = await findUnusedDeps(dir);
    assert.ok(!result.missing.includes('package-name'));
    assert.ok(!result.missing.includes('other-fake'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('flags imported-but-undeclared as missing', async () => {
    const dir = mkTmpProj();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), "import React from 'react';\n");
    const result = await findUnusedDeps(dir);
    assert.ok(result.missing.includes('react'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('does not flag builtin modules as missing', async () => {
    const dir = mkTmpProj();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'),
      "import fs from 'fs';\nimport path from 'node:path';\n");
    const result = await findUnusedDeps(dir);
    assert.equal(result.missing.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns error when no package.json present', async () => {
    const dir = mkTmpProj();
    const result = await findUnusedDeps(dir);
    assert.ok(result.error);
    rmSync(dir, { recursive: true, force: true });
  });
});
