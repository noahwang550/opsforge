// tools/opsforge-wording.test.mjs — A2: 文案守则 + 深链可见性规则断言 (WC1-WC4).
// 守护第零部分词典：业务用户看不懂/有风险的词不得出现在 user-facing 文案。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { promptInstallFlow } from './opsforge.mjs';

const FORBIDDEN_RE = /PAT|Personal Access Token|github\.com\/settings|Developer settings|repo 权限|\bPR\b|pull request|branch|commit|install|steering review|\bCI\b|\breview\b|\bbot\b|127\.0\.0\.1|\/capabilities\/|opsforge submit <|index\.json|registry|gh-pages|\bfetch\b|\bcache\b|\bTTL\b|raw\.githubusercontent|jsdelivr|\bCDN\b|\bhost\b|\bendpoint\b|\bclone\b|\brepo\b|git\s*地址|git\s*address|git\s*URL/;

const SCRIPT = fileURLToPath(import.meta.url).replace(/opsforge-wording\.test\.mjs$/, 'opsforge.mjs');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// WC6: catalog 远程站点徽章文案无禁用词（读 index.html 徽章 + app.js 文本）.
test('WC6 catalog connection badge wording has no forbidden words', () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'web', 'catalog', 'index.html'), 'utf8');
  // 徽章含"已连上能力仓".
  assert.match(html, /已连上能力仓/);
  // 徽章不含 URL/host/响应码.
  const badgeMatch = html.match(/<span[^>]*connection-badge[^>]*>([^<]*)<\/span>/);
  assert.ok(badgeMatch, 'connection-badge element must exist');
  assert.doesNotMatch(badgeMatch[1], /https?:|index\.json|200|404|host/i);
  assert.doesNotMatch(badgeMatch[1], FORBIDDEN_RE);
});

// WC7: install 边界提示——third-party 含"来源网址"不含"git"; 官方无仓库含"联系团队管理员"+"装一次"不含 clone/仓库/下到本地.
test('WC7 install boundary hints use business wording', async () => {
  const { RemoteHintError, RemoteNotFoundError } = await import('../install.mjs');
  // third-party + installHint 边界.
  {
    const out = [];
    const rl = mockRl(['', '', 'foo.bar', 'y']);
    await promptInstallFlow(rl, {
      dryRun: false, out: (s) => out.push(String(s)), workDir: REPO_ROOT,
      install: async () => { throw new RemoteHintError({ installHint: 'https://x.git', kind: 'skills', name: 'foo' }); },
    });
    const text = out.join('\n');
    assert.match(text, /来源网址/);
    assert.doesNotMatch(text, /\bgit\b/i, 'third-party boundary must not mention git');
    assert.doesNotMatch(text, FORBIDDEN_RE);
  }
  // 官方无仓库边界.
  {
    const out = [];
    const rl = mockRl(['', '', 'foo.bar', 'y']);
    await promptInstallFlow(rl, {
      dryRun: false, out: (s) => out.push(String(s)), workDir: REPO_ROOT,
      install: async () => { throw new RemoteNotFoundError({ capId: 'foo.bar' }); },
    });
    const text = out.join('\n');
    assert.match(text, /联系团队管理员/);
    assert.match(text, /装一次/);
    assert.doesNotMatch(text, /clone|仓库|下到本地/i, 'official boundary must not give impossible instructions');
    assert.doesNotMatch(text, FORBIDDEN_RE);
  }
});
