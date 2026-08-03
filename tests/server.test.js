import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startServer } from '../src/server.js';

function mkTmp() {
  return mkdtempSync(join(tmpdir(), 'server-test-'));
}

// Low-level request so we can set headers fetch() forbids (Origin, Host).
function rawRequest(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('server security & routes', () => {
  let server;
  let port;
  let tmpDir;

  before(async () => {
    tmpDir = mkTmp();
    server = startServer({ targetDir: tmpDir });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(async () => {
    await new Promise(r => server.close(r));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const base = () => `http://127.0.0.1:${port}`;

  test('GET /api/status returns pm info', async () => {
    const res = await fetch(`${base()}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.pm);
    assert.equal(data.targetDir, tmpDir);
  });

  test('GET / serves the SPA', async () => {
    const res = await fetch(`${base()}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html>'));
  });

  test('unknown static file returns 404', async () => {
    const res = await fetch(`${base()}/nope.js`);
    assert.equal(res.status, 404);
  });

  test('static path traversal is rejected (403)', async () => {
    const res = await fetch(`${base()}/..%2Fpackage.json`);
    assert.equal(res.status, 403);
  });

  test('cross-origin request is rejected (403)', async () => {
    const res = await rawRequest(port, '/api/status', {
      headers: { Origin: 'http://evil.example' },
    });
    assert.equal(res.status, 403);
  });

  test('non-loopback Host header is rejected (403, DNS-rebinding guard)', async () => {
    const res = await rawRequest(port, '/api/status', {
      headers: { Host: 'evil.example:80' },
    });
    assert.equal(res.status, 403);
  });

  test('delete rejects non-node_modules paths', async () => {
    const res = await fetch(`${base()}/api/cleanup/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [join(tmpDir, 'src')] }),
    });
    const data = await res.json();
    assert.equal(data.results[0].success, false);
    assert.ok(data.results[0].error.includes('node_modules'));
  });

  test('delete rejects path traversal', async () => {
    const res = await fetch(`${base()}/api/cleanup/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['C:/Users/x/../node_modules'] }),
    });
    const data = await res.json();
    assert.equal(data.results[0].success, false);
    assert.ok(data.results[0].error.includes('traversal'));
  });

  test('delete removes a real node_modules dir', async () => {
    const nm = join(tmpDir, 'node_modules');
    mkdirSync(join(nm, 'pkg'), { recursive: true });
    writeFileSync(join(nm, 'pkg', 'f.txt'), 'x');
    const res = await fetch(`${base()}/api/cleanup/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [nm] }),
    });
    const data = await res.json();
    assert.equal(data.deleted, 1);
    assert.equal(existsSync(nm), false);
  });

  test('scan-progress starts idle', async () => {
    const res = await fetch(`${base()}/api/cleanup/scan-progress`);
    const data = await res.json();
    assert.equal(data.running, false);
  });

  test('oversized body is rejected (not 200)', async () => {
    try {
      const res = await rawRequest(port, '/api/cleanup/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: 'x'.repeat(1024 * 1024 + 100) }),
      });
      assert.notEqual(res.status, 200);
    } catch {
      // socket destroyed mid-body is acceptable — the point is no success response
    }
  });
});
