// Zero-dependency, read-only HTTP server for the public capability catalog. steering owned.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCapId } from './paths.mjs';
import { buildCatalogSnapshot, catalogSummary } from './catalog-model.mjs';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function sendJson(res, status, body) {
  const content = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(content);
}

function sendFile(res, filePath) {
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(content);
}

export function createCatalogHandler({ snapshot, webRoot }) {
  const summaries = catalogSummary(snapshot);
  const byId = new Map(snapshot.capabilities.map((item) => [item.id, item]));
  const assets = new Map([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/app.js', 'app.js'],
    ['/styles.css', 'styles.css'],
  ]);

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
      pathname = decodeURIComponent(pathname);
    } catch {
      sendJson(res, 400, { error: 'invalid_url' });
      return;
    }
    if (pathname === '/healthz') {
      sendJson(res, 200, { status: 'ok', count: snapshot.count, generatedAt: snapshot.generatedAt });
      return;
    }
    if (pathname === '/api/catalog') {
      sendJson(res, 200, summaries);
      return;
    }
    if (pathname.startsWith('/api/capabilities/')) {
      const id = pathname.slice('/api/capabilities/'.length);
      try { assertCapId(id); } catch { sendJson(res, 400, { error: 'invalid_capability_id' }); return; }
      const capability = byId.get(id);
      if (!capability) { sendJson(res, 404, { error: 'capability_not_found' }); return; }
      sendJson(res, 200, capability);
      return;
    }
    if (pathname.startsWith('/capabilities/')) {
      sendFile(res, path.join(webRoot, 'index.html'));
      return;
    }
    const asset = assets.get(pathname);
    if (asset) {
      sendFile(res, path.join(webRoot, asset));
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  };
}

export async function startCatalogServer(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const webRoot = path.resolve(opts.webRoot || path.join(repoRoot, 'web', 'catalog'));
  for (const file of ['index.html', 'styles.css', 'app.js']) {
    if (!fs.existsSync(path.join(webRoot, file))) throw new Error(`catalog asset missing: ${file}`);
  }
  const snapshot = opts.snapshot || await buildCatalogSnapshot({ repoRoot });
  if (!snapshot.count) throw new Error('catalog startup refused: no released capabilities');
  const server = http.createServer(createCatalogHandler({ snapshot, webRoot }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 4173, opts.host || '127.0.0.1', resolve);
  });
  return { server, snapshot };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) opts.port = Number(argv[++i]);
    else if (argv[i] === '--host' && argv[i + 1]) opts.host = argv[++i];
    else if (argv[i] === '--repo-root' && argv[i + 1]) opts.repoRoot = argv[++i];
  }
  if (opts.port !== undefined && (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535)) {
    throw new Error('port must be an integer from 0 to 65535');
  }
  return opts;
}

const invokedDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirect) {
  startCatalogServer(parseArgs(process.argv.slice(2))).then(({ server, snapshot }) => {
    const address = server.address();
    console.log(`OpsForge catalog: http://${address.address}:${address.port} (${snapshot.count} capabilities)`);
  }).catch((error) => { console.error(error.message); process.exit(1); });
}
