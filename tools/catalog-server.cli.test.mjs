// CLI-argv smoke: spawn the real `node tools/catalog-server.mjs` against the real
// web/catalog/ assets on an ephemeral port (--port 0), probe the live endpoints,
// then terminate. Covers the CLI entry path that catalog-server.test.mjs (which
// calls startCatalogServer() in-process with a fixture webRoot) does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(here, 'catalog-server.mjs');

function startCli({ port = 0 } = {}) {
  const child = spawn(process.execPath, [serverScript, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  return { child, stdout, stderr };
}

async function waitForReady(child, stdout, stderr) {
  // The CLI prints "OpsForge catalog: http://127.0.0.1:<PORT> (<N> capabilities)"
  // only after listen() resolves. Poll stdout until the line appears.
  const text = () => Buffer.concat(stdout).toString('utf8');
  for (let i = 0; i < 100; i++) {
    const match = text().match(/OpsForge catalog: http:\/\/127\.0\.0\.1:(\d+) \((\d+) capabilities\)/);
    if (match) return { port: Number(match[1]), count: Number(match[2]) };
    if (child.exitCode !== null) {
      throw new Error(`catalog server exited early with ${child.exitCode}: stdout=${text()} stderr=${Buffer.concat(stderr).toString()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`catalog server did not become ready: stdout=${text()} stderr=${Buffer.concat(stderr).toString()}`);
}

async function withCliServer(fn) {
  const { child, stdout, stderr } = startCli({ port: 0 });
  try {
    const { port, count } = await waitForReady(child, stdout, stderr);
    const base = `http://127.0.0.1:${port}`;
    await fn(base, count);
  } finally {
    child.kill('SIGTERM');
    if (process.platform === 'win32') {
      // Windows has no real SIGTERM; ensure the tree is gone so the port releases.
      try { child.kill('SIGKILL'); } catch {}
    }
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

test('catalog server CLI serves real web/catalog assets and live APIs', async () => withCliServer(async (base, count) => {
  assert.ok(count >= 12, `expected >=12 capabilities, got ${count}`);

  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.status, 'ok');
  assert.equal(health.count, count);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const indexHtml = await index.text();
  assert.match(indexHtml, /OpsForge 能力目录/);

  const styles = await fetch(`${base}/styles.css`);
  assert.equal(styles.status, 200);
  assert.match(styles.headers.get('content-type'), /text\/css/);

  const app = await fetch(`${base}/app.js`);
  assert.equal(app.status, 200);
  assert.match(app.headers.get('content-type'), /javascript/);

  const summary = await fetch(`${base}/api/catalog`).then((response) => response.json());
  assert.equal(summary.count, count);
  assert.ok(summary.capabilities.length > 0);
  assert.ok(Array.isArray(summary.platforms));

  // Deep-link to a real capability detail (dogfood cap present in every release).
  const detail = await fetch(`${base}/api/capabilities/opsforge-meta.opsforge`).then((response) => response.json());
  assert.equal(detail.id, 'opsforge-meta.opsforge');
  assert.ok(detail.usage['claude-code']);
}));
