// tools/opsforge-wording.test.mjs — A2: 文案守则 + 深链可见性规则断言 (WC1-WC4).
// 守护第零部分词典：业务用户看不懂/有风险的词不得出现在 user-facing 文案。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { promptInstallFlow } from './opsforge.mjs';

const FORBIDDEN_RE = /PAT|Personal Access Token|github\.com\/settings|Developer settings|repo 权限|\bPR\b|pull request|branch|commit|install|steering review|\bCI\b|\breview\b|\bbot\b|127\.0\.0\.1|\/capabilities\/|opsforge submit </;

const SCRIPT = fileURLToPath(import.meta.url).replace(/opsforge-wording\.test\.mjs$/, 'opsforge.mjs');

function runPrint(topic) {
  const r = spawnSync(process.execPath, [SCRIPT, 'print', topic], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`opsforge print ${topic} failed: ${r.stderr || ''}`);
  return r.stdout;
}

// WC1 PRINT_TOPICS 业务文案不含禁用词（CLI argv 路径 spawnSync）。
test('WC1 business topics contain no forbidden words', () => {
  const topics = ['new-flow', 'wizard-routing', 'error-recovery', 'distiller-steps', 'wizard-phases', 'catalog-hint', 'submit-flow', 'submit-hint'];
  for (const t of topics) {
    const content = runPrint(t);
    assert.doesNotMatch(content, FORBIDDEN_RE, `topic "${t}" contains a forbidden word`);
  }
});

// WC2 menu 含 8/9 选项且不含禁用词。
test('WC2 menu has 8/9 options and no forbidden words', () => {
  const content = runPrint('menu');
  assert.match(content, /8\) 打开能力目录/);
  assert.match(content, /9\) 提交我的能力/);
  assert.doesNotMatch(content, FORBIDDEN_RE);
});

// mock readline
function mockRl(answers) {
  const ee = new EventEmitter();
  let idx = 0;
  ee.question = (_q, cb) => { cb(answers[idx++] || ''); };
  ee.close = () => {};
  return ee;
}

// WC3 promptInstallFlow server 未跑时只打印业务指引不含 http://127.0.0.1。
test('WC3 install flow prints business hint (no http://127.0.0.1) when server not running', async () => {
  const out = [];
  const rl = mockRl(['', '', 'foo.bar', 'y']);  // platform=auto, method=default, capId, confirm=y
  await promptInstallFlow(rl, {
    dryRun: true,
    catalogServerRunning: false,
    out: (s) => out.push(String(s)),
  });
  const text = out.join('\n');
  assert.match(text, /主菜单选 8 打开能力目录/);
  assert.doesNotMatch(text, /http:\/\/127\.0\.0\.1/);
});

// WC4 server 在跑时含可点击链接。
test('WC4 install flow prints clickable deep link when server running', async () => {
  const out = [];
  const rl = mockRl(['', '', 'foo.bar', 'y']);
  await promptInstallFlow(rl, {
    dryRun: true,
    catalogServerRunning: true,
    catalogServerPort: 4173,
    out: (s) => out.push(String(s)),
  });
  const text = out.join('\n');
  assert.match(text, /http:\/\/127\.0\.0\.1:4173\/capabilities\/foo\.bar/);
});
