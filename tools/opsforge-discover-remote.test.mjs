// tools/opsforge-discover-remote.test.mjs — Slice B1: cmdDiscover 远程优先 + 本地回退 + repo-less 死循环防御.
// B1-C1 远程命中 / B1-C2 失败+仓库在 / B1-C3 失败+repo-less 不提示选 8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cmdDiscover } from './opsforge.mjs';
import { buildIndex } from './index-publish.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'opsforge.mjs');

async function collectOut(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  try {
    const code = await fn();
    return { lines, code };
  } finally {
    console.log = orig;
  }
}

function makeRemoteIndex() {
  return buildIndex({ repoRoot: REPO_ROOT }).then(({ index }) => index);
}

// B1-C1: 远程命中→顶部"已连上能力仓"+ 每条"主菜单选 8 可看详情".
test('B1-C1 discover --all remote hit prints connection banner', async () => {
  const index = await makeRemoteIndex();
  const { lines, code } = await collectOut(async () => cmdDiscover({
    all: true,
    workDir: REPO_ROOT,
    fetchRemoteIndex: async () => ({ index, fromCache: false, fetchedAt: '2026-08-07T00:00:00.000Z' }),
    officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
  }));
  assert.equal(code, 0);
  const text = lines.join('\n');
  assert.match(text, /已连上能力仓/);
  assert.match(text, /主菜单选 8 可看详情/);
  // 无技术禁词.
  assert.doesNotMatch(text, /index\.json|registry|fetch|cache|TTL|host|endpoint/i);
});

// B1-C2: 远程失败+仓库在→本地回退+"暂时连不上能力仓"+"显示本地".
test('B1-C2 discover --all remote fail + repo present falls back local', async () => {
  const { lines, code } = await collectOut(async () => cmdDiscover({
    all: true,
    workDir: REPO_ROOT,
    fetchRemoteIndex: async () => { throw new Error('network down'); },
    officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
  }));
  assert.equal(code, 0);
  const text = lines.join('\n');
  assert.match(text, /暂时连不上能力仓/);
  assert.match(text, /显示本地/);
});

// B1-C3: 远程失败+repo-less→"稍后再试或联系团队管理员" 且不含"主菜单选 8"（死循环防御）.
test('B1-C3 discover --all remote fail + repo-less no menu-8 hint', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-repoless-'));
  try {
    const { lines, code } = await collectOut(async () => cmdDiscover({
      all: true,
      workDir: tmpDir,
      fetchRemoteIndex: async () => { throw new Error('network down'); },
      officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
    }));
    assert.equal(code, 0);
    const text = lines.join('\n');
    assert.match(text, /稍后再试或联系团队管理员/);
    assert.doesNotMatch(text, /主菜单选 8/, 'repo-less + no network must not suggest menu 8 (avoid loop)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// B1-C4: repo-less + 远程命中→仍展示远程清单（不死循环）.
test('B1-C4 discover --all repo-less + remote hit shows remote list', async () => {
  const index = await makeRemoteIndex();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-repoless2-'));
  try {
    const { lines, code } = await collectOut(async () => cmdDiscover({
      all: true,
      workDir: tmpDir,
      fetchRemoteIndex: async () => ({ index, fromCache: false, fetchedAt: '2026-08-07T00:00:00.000Z' }),
      officialIndexUrl: () => 'https://acme.github.io/opsforge/index.json',
    }));
    assert.equal(code, 0);
    const text = lines.join('\n');
    assert.match(text, /已连上能力仓/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// WC5: PRINT_TOPICS['discover-remote-hint'] 无禁用词（CLI argv spawn）.
test('WC5 discover-remote-hint topic has no forbidden words', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'print', 'discover-remote-hint'], { encoding: 'utf8', timeout: 20000, cwd: REPO_ROOT });
  assert.equal(r.status, 0, `print failed: ${r.stderr || ''}`);
  assert.doesNotMatch(r.stdout, /index\.json|registry|fetch|cache|TTL|host|endpoint|clone|repo|git\s*地址/i);
});
