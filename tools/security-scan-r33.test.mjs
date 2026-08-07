// tools/security-scan-r33.test.mjs — Slice AB: R33 scanRepoForIndexFetchSsrf (仓库级独立函数).
// R33-1 干净 pass / R33-2 fetch(变量) 未经 assertPublicUrl block / R33-3 官方 host 未硬编码 block /
// R33-4 fetch 后无 schema 校验 block / R33-5 本仓库自身 pass / R33-6 CLI --all 死代码防回归.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanRepoForIndexFetchSsrf } from './security-scan.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r33-'));
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  return root;
}

// R33-1 干净仓库（无 fetch 调用）pass.
test('R33-1 clean repo with no fetch passes', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'tools', 'clean.mjs'), 'export const x = 1;\n');
  const r = scanRepoForIndexFetchSsrf(root);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.rule, 'R33_index_fetch_no_user_host');
});

// R33-2 fetch(变量) 未经 assertPublicUrl 直接消费 → block.
test('R33-2 fetch(variable) without assertPublicUrl blocks', () => {
  const root = mkRepo();
  // 写到被扫描的 tools/index-fetch.mjs 路径.
  fs.writeFileSync(path.join(root, 'tools', 'index-fetch.mjs'),
    "const r = await fetch(userUrl);\n" +
    "const data = await r.json();\n");
  const r = scanRepoForIndexFetchSsrf(root);
  assert.equal(r.verdict, 'block');
  assert.ok(r.findings.some((f) => f.rule === 'R33_index_fetch_no_user_host'));
});

// R33-3 fetch(变量) 经 assertPublicUrl + validateIndex → pass.
test('R33-3 fetch(variable) with assertPublicUrl + validateIndex passes', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'tools', 'index-fetch.mjs'),
    "await assertPublicUrl(userUrl);\n" +
    "const r = await fetch(userUrl);\n" +
    "const json = await r.json();\n" +
    "if (!validateIndex(json)) throw new Error('schema');\n");
  const r = scanRepoForIndexFetchSsrf(root);
  assert.equal(r.verdict, 'pass');
});

// R33-4 fetch 后无 schema 校验 → block.
test('R33-4 fetch without validateIndex blocks', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'tools', 'index-fetch.mjs'),
    "await assertPublicUrl(userUrl);\n" +
    "const r = await fetch(userUrl);\n" +
    "const json = await r.json();\n");
  const r = scanRepoForIndexFetchSsrf(root);
  assert.equal(r.verdict, 'block');
});

// R33-5 本仓库自身 pass（真实代码无 SSRF 泄露）.
test('R33-5 real repo passes (no SSRF leaks in index-fetch/opsforge/install)', () => {
  const r = scanRepoForIndexFetchSsrf(REPO_ROOT);
  assert.equal(r.verdict, 'pass', `R33 found issues: ${JSON.stringify(r.findings)}`);
});

// R33-6 C1 CLI-argv 集成：security-scan --all 必须真 reaching R33 block（防死代码回归）.
test('R33-6 security-scan --all reaches R33 and blocks on fetch(variable) no-guard (CLI argv)', () => {
  const root = mkRepo();
  // 需要一个 capability 让 scanCapabilities 返回（否则 --all 空跑）.
  fs.mkdirSync(path.join(root, 'packs', 'demo', 'skills', 'hello', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packs', 'demo', 'skills', 'hello', 'capability.yaml'),
    "id: demo.hello\nversion: 0.1.0\nkind: skill\npack: demo\nowner: test\nentrypoint: SKILL.md\ntests:\n  - tests/case-01.yaml\nchangelog:\n  - version: 0.1.0\n    date: '2026-01-01'\n    changes:\n      - Initial release.\nsource:\n  origin: original\n");
  fs.writeFileSync(path.join(root, 'packs', 'demo', 'skills', 'hello', 'SKILL.md'),
    "---\nid: demo.hello\n---\n# Hello\n## 能力说明\nDemo.\n## 适用场景\nDemo.\n");
  fs.mkdirSync(path.join(root, 'packs', 'demo', 'skills', 'hello', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packs', 'demo', 'skills', 'hello', 'tests', 'case-01.yaml'),
    "id: case-01\nprompt: hi\nexpect:\n  mode: contains\n  value: hello\n");
  fs.mkdirSync(path.join(root, 'adapters', 'claude-code'), { recursive: true });
  fs.writeFileSync(path.join(root, 'adapters', 'claude-code', 'platform.yaml'),
    "platform: claude-code\ndisplay_name_zh: Claude Code\n");
  // 植入 R33 违规（写到被扫描的 tools/index-fetch.mjs）.
  fs.writeFileSync(path.join(root, 'tools', 'index-fetch.mjs'),
    "const r = await fetch(userUrl);\nconst j = await r.json();\n");
  const scanScript = fileURLToPath(new URL('./security-scan.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [scanScript, '--all'], {
    cwd: root, encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, 'security-scan --all 应在 R33 命中 fetch(变量) 未守卫时非零退出（死代码防回归）');
  assert.match(r.stdout + r.stderr, /R33|fetch|SSRF|BLOCK/);
});
