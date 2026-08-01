import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

import { packagesRoutes } from './routes/packages.js';
import { cacheRoutes } from './routes/cache.js';
import { cleanupRoutes } from './routes/cleanup.js';
import { healthRoutes } from './routes/health.js';
import { detectPackageManager } from './lib/pm.js';
import { execText } from './lib/bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, 'ui');

const ALL_ROUTES = [
  ...packagesRoutes,
  ...cacheRoutes,
  ...cleanupRoutes,
  ...healthRoutes,
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Match a URL path against a route pattern with :params.
 * Returns { params } on match, null on no match.
 */
function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}

/**
 * Parse JSON body from a POST request.
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    const MAX_BODY = 1024 * 1024; // 1MB limit to prevent DoS
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response.
 */
function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  // No CORS headers: the SPA and API share the same origin, so cross-origin
  // access is not needed. Omitting Allow-Origin prevents malicious websites
  // open in the user's browser from driving the local tool (local CSRF).
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

/**
 * Serve static files from the UI directory.
 */
async function serveStatic(res, pathname) {
  // Normalize: strip leading slash, default to index.html
  let filePath = pathname === '/' || pathname === ''
    ? 'index.html'
    : pathname.replace(/^\//, '');

  // Prevent directory traversal
  if (filePath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const fullPath = join(UI_DIR, filePath);

  if (!existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  try {
    const content = await readFile(fullPath);
    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
}

/**
 * Get system status info.
 */
async function getStatus(targetDir) {
  const pm = detectPackageManager(targetDir);
  let versions = {};
  try {
    const nodeVer = process.version;
    const npmVer = await execText('npm --version', targetDir);
    versions = { node: nodeVer, npm: npmVer };
  } catch {
    versions = { node: process.version };
  }
  return { pm, targetDir, versions };
}

/**
 * Start the HTTP server.
 */
export function startServer({ port, targetDir }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());

    // Block cross-origin requests (defense against local CSRF from malicious
    // websites). Only same-origin (the served SPA) and loopback origin are allowed.
    const origin = req.headers.origin;
    const host = req.headers.host || '';
    if (origin && origin !== `http://${host}`) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: cross-origin requests are not allowed');
      return;
    }

    // Special: status endpoint
    if (pathname === '/api/status' && req.method === 'GET') {
      try {
        const status = await getStatus(targetDir);
        sendJSON(res, 200, status);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // Try API routes
    const ctx = { targetDir, query, params: {}, body: {} };
    for (const route of ALL_ROUTES) {
      if (route.method !== req.method) continue;
      const match = matchRoute(route.pattern, pathname);
      if (match) {
        ctx.params = match.params;
        try {
          if (req.method === 'POST') {
            ctx.body = await parseBody(req);
          }
          const result = await route.handler(ctx);
          sendJSON(res, 200, result);
        } catch (err) {
          sendJSON(res, 500, { error: err.message });
        }
        return;
      }
    }

    // Fallback: serve static UI files
    await serveStatic(res, pathname);
  });

  return server;
}
