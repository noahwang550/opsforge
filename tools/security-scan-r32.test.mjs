// tools/security-scan-r32.test.mjs — B2: R32 scanRepoForSubmitSecrets (仓库级独立函数).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanRepoForSubmitSecrets } from './security-scan.mjs';

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-r32-'));
  for (const sub of ['tools', 'packs', 'templates', 'web', 'docs']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

// R32-1 干净仓库 pass。
test('R32-1 clean repo passes', () => {
  const root = mkRepo();
  const r = scanRepoForSubmitSecrets(root);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.findings.length, 0);
});

// R32-2 真 token block。
test('R32-2 real fine-grained PAT in repo blocks', () => {
  const root = mkRepo();
  // github_pat_ followed by 82+ chars
  const fakeToken = 'github_pat_' + 'a'.repeat(82);
  fs.writeFileSync(path.join(root, 'tools', 'leak.mjs'), `const t = "${fakeToken}";\n`);
  const r = scanRepoForSubmitSecrets(root);
  assert.equal(r.verdict, 'block');
  assert.ok(r.findings.some((f) => f.rule === 'R32_submit_no_secret_in_token_file'));
});

// R32-3 regex 定义行不误报（字符类+量词不是 82 个真实字符）。
test('R32-3 regex definition line does not self-report', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'tools', 'security-scan.mjs'),
    "const RE = /github_pat_[A-Za-z0-9_]{82,}/;\n");
  const r = scanRepoForSubmitSecrets(root);
  assert.equal(r.verdict, 'pass');
});

// R32-4 中文"贡献码"不误报。
test('R32-4 Chinese contribution code word does not false-positive', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'),
    '请联系团队管理员领取贡献码，粘贴一次即可。\n');
  const r = scanRepoForSubmitSecrets(root);
  assert.equal(r.verdict, 'pass');
});

// R32-5 拼接代码 'github_pat_' + 'a'.repeat(82) 不误报（运行时串非字面量）。
test('R32-5 concat code does not false-positive (runtime string not literal)', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'tools', 'submit.test.mjs'),
    "const t = 'github_pat_' + 'a'.repeat(82);\n");
  const r = scanRepoForSubmitSecrets(root);
  assert.equal(r.verdict, 'pass');
});

// R32-6 C1 CLI-argv 集成：security-scan --all 必须真 reaching R32 block（防死代码回归）。
test('R32-6 security-scan --all reaches R32 and blocks on PAT literal (CLI argv)', () => {
  const root = mkRepo();
  const token = 'github_pat_' + 'a'.repeat(90);
  fs.writeFileSync(path.join(root, 'tools', 'leak.mjs'), `const x = "${token}";\n`);
  const scanScript = fileURLToPath(new URL('./security-scan.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [scanScript, '--all'], {
    cwd: root, encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, 'security-scan --all 应在 R32 命中 PAT 字面时非零退出（C1 死代码防回归）');
  assert.match(r.stdout + r.stderr, /github_pat|R32|贡献码|BLOCK/);
});
