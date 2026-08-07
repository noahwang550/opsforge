// tools/install-remote-lookup.test.mjs — Slice C1: install 远程元数据 + 边界.
// C1-U1 本地无→远程命中 official / C1-U2 third-party+installHint→指向 installFromGit /
// C1-U3 远程未命中→null / C1 边界业务话（RemoteHintError / RemoteNotFoundError）.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { lookupRemoteCapability, RemoteHintError, RemoteNotFoundError } from '../install.mjs';
import { buildIndex } from './index-publish.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function remoteIndexFixture() {
  return (await buildIndex({ repoRoot: REPO_ROOT })).index;
}

// C1-U1: 本地无→远程命中 official（返回 version/pack/kind/source）.
test('C1-U1 lookupRemoteCapability returns meta for official cap on remote hit', async () => {
  const index = await remoteIndexFixture();
  const officialCap = index.capabilities.find((c) => c.source.key === 'official');
  if (!officialCap) { console.log('skip: no official cap in fixture'); return; }
  const r = await lookupRemoteCapability(officialCap.id, {
    repoRoot: REPO_ROOT,
    fetchRemoteIndex: async () => ({ index, fromCache: false }),
    officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
    readCacheIndex: () => index,
    fetchCapDetail: async () => null,
  });
  assert.ok(r, 'should return meta for official cap');
  assert.equal(r.version, officialCap.version);
  assert.equal(r.pack, officialCap.pack);
  assert.equal(r.kind, officialCap.kind);
  assert.equal(r.source.key, 'official');
});

// C1-U2: third-party+installHint→返回 installHint（供 installFromGit）.
// installHint 只存于 capabilities/<id>.json（detail 文件），不存于 index.json summary（schema 拒）.
test('C1-U2 lookupRemoteCapability returns installHint from detail file for third-party cap', async () => {
  const index = await remoteIndexFixture();
  const thirdParty = index.capabilities.find((c) => c.source.key === 'third-party') || index.capabilities[0];
  // summary 项无 installHint（schema additionalProperties:false）；installHint 从 detail 文件读.
  const fakeIndex = { ...index, capabilities: [{ ...thirdParty, source: { key: 'third-party', label: '第三方' } }] };
  const fakeDetail = { ...thirdParty, source: { key: 'third-party', label: '第三方' }, installHint: 'https://example.com/upstream.git' };
  const r = await lookupRemoteCapability(thirdParty.id, {
    repoRoot: REPO_ROOT,
    fetchRemoteIndex: async () => ({ index: fakeIndex, fromCache: false }),
    officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
    readCacheIndex: () => null,
    fetchCapDetail: async () => fakeDetail,
  });
  assert.ok(r, 'should return meta for third-party cap');
  assert.equal(r.source.key, 'third-party');
  assert.equal(r.installHint, 'https://example.com/upstream.git');
});

// C1-U3: 远程未命中→null.
test('C1-U3 lookupRemoteCapability returns null when remote miss', async () => {
  const index = await remoteIndexFixture();
  const r = await lookupRemoteCapability('nope.doesnotexist', {
    repoRoot: REPO_ROOT,
    fetchRemoteIndex: async () => ({ index, fromCache: false }),
    officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
    readCacheIndex: () => index,
  });
  assert.equal(r, null);
});

// C1-U4: 远程不可达 + 无缓存→null（边界由上层处理）.
test('C1-U4 lookupRemoteCapability returns null when remote unreachable + no cache', async () => {
  const r = await lookupRemoteCapability('marketing-team.copywriter', {
    repoRoot: REPO_ROOT,
    fetchRemoteIndex: async () => { throw new Error('network down'); },
    officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
    readCacheIndex: () => null,
  });
  assert.equal(r, null);
});

// C1-B1: RemoteHintError 是第三方可安装边界（带 installHint/kind/name）.
test('C1-B1 RemoteHintError carries installHint + kind + name', () => {
  const e = new RemoteHintError({ installHint: 'https://x.git', kind: 'skills', name: 'foo' });
  assert.equal(e.name, 'RemoteHintError');
  assert.equal(e.installHint, 'https://x.git');
  assert.equal(e.kind, 'skills');
  assert.equal(e.capName, 'foo');
});

// C1-B2: RemoteNotFoundError 是官方无仓库边界（带 capId）.
test('C1-B2 RemoteNotFoundError carries capId', () => {
  const e = new RemoteNotFoundError({ capId: 'marketing-team.copywriter' });
  assert.equal(e.name, 'RemoteNotFoundError');
  assert.equal(e.capId, 'marketing-team.copywriter');
});


// C1-U5 (回归 Fix A): 缓存命中 + OPSFORGE_INDEX_URL 指向私网 → detail fetch 必被 SSRF 守卫拒（installHint=null）.
// 设计 §2.10：env 覆盖 URL 必经 assertPublicUrl 全套；缓存命中时 fetchRemoteIndex 不跑，detail fetch 仍须守卫.
test('C1-U5 lookupRemoteCapability rejects env private URL on cache hit (SSRF guard on detail fetch)', async () => {
  const index = await remoteIndexFixture();
  const officialCap = index.capabilities.find((c) => c.source.key === 'official') || index.capabilities[0];
  const saved = process.env.OPSFORGE_INDEX_URL;
  process.env.OPSFORGE_INDEX_URL = 'http://127.0.0.1/';
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  try {
    const r = await lookupRemoteCapability(officialCap.id, {
      repoRoot: REPO_ROOT,
      // 缓存命中：readCacheIndex 返回 index，fetchRemoteIndex 不跑 → env URL 不被 fetchRemoteIndex 守卫.
      readCacheIndex: () => index,
      officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
      // 不注入 fetchCapDetail → 走默认实现（含 SSRF 守卫）.
    });
    // detail fetch 被 assertPublicUrl 拒（http://127.0.0.1 私网 + 非 https）→ detail=null → installHint=null.
    assert.equal(r.installHint, null, 'private env URL must be SSRF-rejected on detail fetch');
    assert.equal(fetchCalled, false, 'globalThis.fetch must NOT be called for SSRF-rejected detail URL');
  } finally {
    globalThis.fetch = origFetch;
    if (saved === undefined) delete process.env.OPSFORGE_INDEX_URL; else process.env.OPSFORGE_INDEX_URL = saved;
  }
});
