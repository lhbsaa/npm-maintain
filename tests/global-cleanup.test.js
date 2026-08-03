import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseRegisteredNames, isInside, deleteGlobalResidue } from '../src/lib/global-cleanup.js';

describe('parseRegisteredNames', () => {
  test('npm format (dependencies object)', () => {
    const names = parseRegisteredNames({ dependencies: { lodash: {}, '@scope/pkg': {}, express: {} } }, 'npm');
    assert.deepEqual([...names], ['lodash', '@scope/pkg', 'express']);
  });

  test('pnpm format (array of packages)', () => {
    const names = parseRegisteredNames([{ name: 'vue' }, { name: 'vite' }], 'pnpm');
    assert.deepEqual([...names], ['vue', 'vite']);
  });

  test('yarn 1 format (trees with name@version)', () => {
    const names = parseRegisteredNames(
      { type: 'list', data: { type: 'list', trees: [{ name: 'lodash@4.17.21' }, { name: '@babel/core@7.24.0' }] } },
      'yarn'
    );
    assert.deepEqual([...names], ['lodash', '@babel/core']);
  });

  test('empty npm ls output ({}) yields empty set, not null', () => {
    const names = parseRegisteredNames({}, 'npm');
    assert.ok(names instanceof Set);
    assert.equal(names.size, 0);
  });

  test('bridge fallback shape ({ raw }) yields null', () => {
    assert.equal(parseRegisteredNames({ raw: 'some log output' }, 'npm'), null);
  });
});

describe('isInside', () => {
  const root = 'C:/Users/Admin/AppData/Roaming/npm';

  test('accepts a direct child', () => {
    assert.ok(isInside(root, join(root, 'node_modules', 'pkg')));
  });

  test('accepts nested children', () => {
    assert.ok(isInside(join(root, 'node_modules'), join(root, 'node_modules', '@scope', 'pkg')));
  });

  test('rejects the parent itself (not strictly inside)', () => {
    assert.equal(isInside(root, root), false);
  });

  test('rejects a sibling with a shared prefix', () => {
    assert.equal(isInside(root, `${root}_evil/x`), false);
  });

  test('rejects an unrelated path', () => {
    assert.equal(isInside(root, 'C:/Users/Admin/Desktop/x'), false);
  });
});

describe('deleteGlobalResidue', () => {
  test('rejects paths outside the global dir', async () => {
    const { results } = await deleteGlobalResidue(process.cwd(), [
      { pm: 'npm', kind: 'dir', path: join(tmpdir(), 'somewhere-not-global') },
    ]);
    assert.equal(results[0].success, false);
    assert.ok(results[0].error.length > 0);
  });
});
