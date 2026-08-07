// tools/index-fetch.test.mjs — Slice A2: 远程拉取 + 缓存 + TTL + SSRF + schema 校验.
// A2-U1 缓存命中 / U2 未命中→fetch→写缓存 / U3 TTL 过期 / U4 --refresh 强拉 /
// U5 损坏 JSON / U6 schema 失败 / U7 SSRF 拒绝私网 / U8 官方 host 派生 / U9 官方源不经 assertPublicUrl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { fetchRemoteIndex, officialIndexUrl, readCacheIndex } from './index-fetch.mjs';
import { buildIndex } from './index-publish.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 构造一个 schema-valid index fixture.
async function validIndexFixture() {
  return (await buildIndex({ repoRoot: REPO_ROOT })).index;
}

function makeFetchReturning(body, { contentType = 'application/json', status = 200 } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => h.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => JSON.parse(payload),
    text: async () => payload,
  });
}

// A2-U1: 缓存命中不调 fetch.
test('A2-U1 cache hit returns cached index without fetch', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-hit-'));
  try {
    const index = await validIndexFixture();
    // 预写缓存.
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index));
    let fetchCalled = false;
    const r = await fetchRemoteIndex({
      url: 'https://example.github.io/opsforge/index.json',
      cacheDir, ttl: 86400, refresh: false,
      fetchImpl: async () => { fetchCalled = true; return { ok: true }; },
    });
    assert.equal(r.fromCache, true);
    assert.equal(fetchCalled, false, 'fetch must not be called on cache hit');
    assert.equal(r.index.count, index.count);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U2: 缓存未命中→fetch→写缓存→schema 校验通过.
test('A2-U2 cache miss fetches writes cache schema-valid', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-miss-'));
  try {
    const index = await validIndexFixture();
    const fetchImpl = makeFetchReturning(index);
    const r = await fetchRemoteIndex({
      url: 'https://example.github.io/opsforge/index.json',
      cacheDir, ttl: 86400, refresh: true, fetchImpl,
    });
    assert.equal(r.fromCache, false);
    assert.ok(fs.existsSync(path.join(cacheDir, 'index.json')), 'cache file not written');
    const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8'));
    assert.equal(cached.count, index.count);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U3: TTL 过期→重新 fetch.
test('A2-U3 TTL expiry triggers re-fetch', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-ttl-'));
  try {
    const index = await validIndexFixture();
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'index.json');
    fs.writeFileSync(cacheFile, JSON.stringify(index));
    // 把 mtime 设为 25h 前.
    const oldTime = new Date(Date.now() - 25 * 3600 * 1000);
    fs.utimesSync(cacheFile, oldTime, oldTime);
    let fetchCalled = false;
    const r = await fetchRemoteIndex({
      url: 'https://example.github.io/opsforge/index.json',
      cacheDir, ttl: 86400, refresh: false,
      fetchImpl: async () => { fetchCalled = true; return makeFetchReturning(index)(); },
    });
    assert.equal(fetchCalled, true, 'fetch must be called when TTL expired');
    assert.equal(r.fromCache, false);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U4: --refresh 强拉（忽略有效缓存）.
test('A2-U4 refresh forces fetch even with valid cache', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-refresh-'));
  try {
    const index = await validIndexFixture();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index));
    let fetchCalled = false;
    const r = await fetchRemoteIndex({
      url: 'https://example.github.io/opsforge/index.json',
      cacheDir, ttl: 86400, refresh: true,
      fetchImpl: async () => { fetchCalled = true; return makeFetchReturning(index)(); },
    });
    assert.equal(fetchCalled, true, 'fetch must be called on refresh');
    assert.equal(r.fromCache, false);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U5: 损坏 JSON→抛错.
test('A2-U5 corrupted JSON throws', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-badjson-'));
  try {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => { throw new SyntaxError('Unexpected token'); },
      text: async () => 'not json',
    });
    await assert.rejects(
      fetchRemoteIndex({ url: 'https://example.github.io/opsforge/index.json', cacheDir, refresh: true, fetchImpl }),
      /json|parse|syntax/i,
    );
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U6: schema 校验失败→抛错，不返回半截数据.
test('A2-U6 schema validation failure throws', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-schema-'));
  try {
    const fetchImpl = makeFetchReturning({ foo: 'bar' });
    await assert.rejects(
      fetchRemoteIndex({ url: 'https://example.github.io/opsforge/index.json', cacheDir, refresh: true, fetchImpl }),
      /schema/i,
    );
    assert.ok(!fs.existsSync(path.join(cacheDir, 'index.json')), 'invalid index must not be cached');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U7: SSRF 拒绝私网（用户覆盖 URL，非 github.io 白名单）.
test('A2-U7 SSRF rejects private network user URLs', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-ssrf-'));
  try {
    const privateUrls = [
      'https://127.0.0.1/index.json',
      'https://10.0.0.1/index.json',
      'https://169.254.169.254/index.json',
      'https://localhost/index.json',
      'https://evil.local/index.json',
    ];
    for (const url of privateUrls) {
      await assert.rejects(
        fetchRemoteIndex({ url, cacheDir, refresh: true, fetchImpl: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }) }),
        /private|loopback|ssrf|reserved|internal/i,
        `should reject ${url}`,
      );
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U8: officialIndexUrl 从 mock git remote 派生 github.io URL.
test('A2-U8 officialIndexUrl derives github.io URL from git remote', () => {
  const url = officialIndexUrl({
    execFile: () => 'https://github.com/acme/opsforge.git\n',
  });
  assert.equal(url, 'https://acme.github.io/opsforge/index.json');
  const urlSsh = officialIndexUrl({
    execFile: () => 'git@github.com:acme/opsforge\n',
  });
  assert.equal(urlSsh, 'https://acme.github.io/opsforge/index.json');
  // 非 github remote 抛错.
  assert.throws(
    () => officialIndexUrl({ execFile: () => 'https://gitlab.com/acme/opsforge.git\n' }),
    /github/i,
  );
});

// A2-U9: 官方源（github.io）不经 assertPublicUrl——fetch 被调，lookup 不被调.
test('A2-U9 official github.io source skips assertPublicUrl', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-official-'));
  try {
    const index = await validIndexFixture();
    let lookupCalled = false;
    const r = await fetchRemoteIndex({
      url: 'https://acme.github.io/opsforge/index.json',
      cacheDir, refresh: true,
      fetchImpl: makeFetchReturning(index),
      lookup: async () => { lookupCalled = true; return [{ address: '1.2.3.4' }]; },
    });
    assert.equal(lookupCalled, false, 'official source must not invoke DNS lookup (assertPublicUrl)');
    assert.equal(r.fromCache, false);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-U10: readCacheIndex 离线降级读缓存（不校验 TTL，只校验 schema）.
test('A2-U10 readCacheIndex reads cache offline (schema-only)', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-read-'));
  try {
    // 无缓存 → null.
    assert.equal(readCacheIndex(cacheDir), null);
    const index = await validIndexFixture();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index));
    const cached = readCacheIndex(cacheDir);
    assert.ok(cached, 'should read valid cached index');
    assert.equal(cached.count, index.count);
    // 损坏缓存 → null.
    fs.writeFileSync(path.join(cacheDir, 'index.json'), '{ broken');
    assert.equal(readCacheIndex(cacheDir), null);
    // schema-invalid 缓存 → null.
    fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify({ foo: 'bar' }));
    assert.equal(readCacheIndex(cacheDir), null);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

// A2-I1: 集成测试——fetch→写缓存→readCacheIndex 离线读回（round-trip）.
test('A2-I1 integration: fetch writes cache that readCacheIndex reads offline', async () => {
  const index = await validIndexFixture();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cache-round-'));
  try {
    const r = await fetchRemoteIndex({
      url: 'https://acme.github.io/opsforge/index.json',
      cacheDir, refresh: true, fetchImpl: makeFetchReturning(index),
    });
    assert.equal(r.fromCache, false);
    assert.equal(r.index.count, index.count);
    assert.ok(fs.existsSync(path.join(cacheDir, 'index.json')), 'cache file not written');
    // 离线读回.
    const offline = readCacheIndex(cacheDir);
    assert.ok(offline, 'readCacheIndex should return the cached index');
    assert.equal(offline.count, index.count);
    // 再 fetch 命中缓存（不调 fetchImpl）.
    let fetchCalled = false;
    const r2 = await fetchRemoteIndex({
      url: 'https://acme.github.io/opsforge/index.json',
      cacheDir, refresh: false,
      fetchImpl: async () => { fetchCalled = true; return { ok: true }; },
    });
    assert.equal(fetchCalled, false, 'second fetch should hit cache');
    assert.equal(r2.fromCache, true);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
