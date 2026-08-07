// tools/submit.test.mjs — B1/B2: 提交能力草稿到中心仓库（mock fetch + execFile）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseGitRemote, resolveGitRemote, readSubmitToken, writeSubmitToken,
  assertDraftUnder, PreflightError, submit,
} from './submit.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-submit-')); }

// helper: make a fake draft dir under _drafts
function mkDraft(repoRoot, slug, name) {
  const dir = path.join(repoRoot, 'packs', '_drafts', slug, name);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.yaml'),
    `id: ${slug}.${name}\nversion: 0.1.0\nkind: skill\npack: ${slug}\nname: ${name}\nowner: tester\nentrypoint: SKILL.md\ntests: []\nchangelog: []\nsource: {}`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n## 能力说明\ntest body\n## 适用场景\nscenario`);
  fs.writeFileSync(path.join(dir, 'tests', 'case-01.yaml'),
    'name: case-01\nprompt: hi\nexpected: ok\nexpect: contains\n');
  return dir;
}

// SU1 parseGitRemote 支持 SSH + HTTPS。
test('SU1 parseGitRemote SSH and HTTPS', () => {
  assert.deepEqual(parseGitRemote('git@github.com:owner/repo.git'), { owner: 'owner', repo: 'repo' });
  assert.deepEqual(parseGitRemote('https://github.com/owner/repo.git'), { owner: 'owner', repo: 'repo' });
  assert.deepEqual(parseGitRemote('https://github.com/owner/repo'), { owner: 'owner', repo: 'repo' });
  assert.equal(parseGitRemote('https://gitlab.com/o/r'), null);
  assert.equal(parseGitRemote('not-a-url'), null);
});

// SU2 resolveGitRemote uses execFileSync argv (no shell).
test('SU2 resolveGitRemote uses execFile argv', () => {
  let captured;
  const execFile = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return 'git@github.com:owner/repo.git\n';
  };
  const r = resolveGitRemote({ execFile });
  assert.equal(captured.cmd, 'git');
  assert.deepEqual(captured.args, ['config', '--get', 'remote.origin.url']);
  assert.equal(r, 'git@github.com:owner/repo.git');
});

// SU3 assertDraftUnder 路径穿越拒绝。
test('SU3 assertDraftUnder rejects path traversal', () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  // valid
  assert.doesNotThrow(() => assertDraftUnder(draft, repoRoot));
  // outside _drafts
  const outside = path.join(repoRoot, 'packs', 'staged', 'foo', 'bar');
  fs.mkdirSync(outside, { recursive: true });
  assert.throws(() => assertDraftUnder(outside, repoRoot), /_drafts/);
  // traversal with ..
  assert.throws(() => assertDraftUnder(path.join(draft, '..', '..', '..', 'etc'), repoRoot), /path-guard|_drafts/);
});

// SU4 runLocalPreflight 三报告门（mock validate/securityScan/runSuite）。
test('SU4 runLocalPreflight blocks on security block', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const { runLocalPreflight } = await import('./submit.mjs');
  await assert.rejects(
    runLocalPreflight(draft, repoRoot, {
      validate: async () => ({ verdict: 'pass' }),
      securityScan: () => ({ verdict: 'block', findings: [{ rule: 'hardcoded_secret', status: 'block' }] }),
      runSuite: async () => ({ verdict: 'pass' }),
    }),
    (e) => { assert.ok(e instanceof PreflightError); assert.equal(e.kind, 'security'); return true; },
  );
});

test('SU4b runLocalPreflight passes on pass/pending', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const { runLocalPreflight } = await import('./submit.mjs');
  const r = await runLocalPreflight(draft, repoRoot, {
    validate: async () => ({ verdict: 'pass' }),
    securityScan: () => ({ verdict: 'pass', findings: [] }),
    runSuite: async () => ({ verdict: 'pending' }),
  });
  assert.deepEqual(r, { ok: true });
});

// SU5 callGithubApi 序列（mock fetch 响应序列）。
test('SU5 submit happy path opens PR', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    // step1: GET refs/heads/main → sha
    if (url.endsWith('/git/refs/heads/main') && (!init || !init.method)) {
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'basesha123' } }) };
    }
    // step2: GET refs/heads/{branch} → 404 new
    if (url.includes('/git/refs/heads/opsforge-') && (!init || !init.method === undefined)) {
      // branch ref check
    }
    if (url.includes('/git/refs/heads/opsforge-') && !init?.method) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    // step3: POST refs/heads/{branch} → 建分支
    if (url.includes('/git/refs/heads/opsforge-') && init?.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ object: { sha: 'basesha123' } }) };
    }
    // step4: POST trees
    if (url.endsWith('/git/trees')) {
      return { ok: true, status: 201, json: async () => ({ sha: 'treesha' }) };
    }
    // step5: POST commits
    if (url.endsWith('/git/commits')) {
      return { ok: true, status: 201, json: async () => ({ sha: 'commitsha' }) };
    }
    // step6: PATCH refs/heads/{branch}
    if (init?.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'commitsha' } }) };
    }
    // step7: POST /pulls
    if (url.endsWith('/pulls') && init?.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/owner/repo/pull/1', number: 1 }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'unexpected' }) };
  };
  const r = await submit({
    draftDir: draft, repoRoot, token: 'fake-token',
    gitRemote: 'git@github.com:owner/repo.git',
    fetch: fetchImpl,
    validate: async () => ({ verdict: 'pass' }),
    securityScan: () => ({ verdict: 'pass', findings: [] }),
    runSuite: async () => ({ verdict: 'pass' }),
  });
  assert.equal(r.updated, false);
  assert.equal(r.prUrl, 'https://github.com/owner/repo/pull/1');
  assert.equal(r.commitSha, 'commitsha');
  assert.ok(r.branch.startsWith('opsforge-foo-bar-'));
  // verify POST /pulls was called
  assert.ok(calls.some((c) => c.url.endsWith('/pulls') && c.method === 'POST'));
});

// SU6 readSubmitToken / writeSubmitToken (0600).
test('SU6 readSubmitToken reads writeSubmitToken wrote (0600)', () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    writeSubmitToken('abc123');
    const r = readSubmitToken();
    assert.equal(r.token, 'abc123');
    // verify 0600 on posix
    if (process.platform !== 'win32') {
      const stat = fs.statSync(path.join(home, '.opsforge', 'submit-token.json'));
      const mode = stat.mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// SU7 401/403 统一业务话过期提示（不报 HTTP status）。
test('SU7 submit 401 prints business hint not HTTP status', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/git/refs/heads/main') && !init?.method) {
      return { ok: false, status: 401, json: async () => ({ message: 'Bad credentials', status: '401' }) };
    }
    return { ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) };
  };
  await assert.rejects(
    submit({
      draftDir: draft, repoRoot, token: 'bad',
      gitRemote: 'git@github.com:owner/repo.git',
      fetch: fetchImpl,
      validate: async () => ({ verdict: 'pass' }),
      securityScan: () => ({ verdict: 'pass', findings: [] }),
      runSuite: async () => ({ verdict: 'pass' }),
    }),
    /贡献码可能已过期/,
  );
});

// SU8 同名分支 force-update 不重开（已有 open PR → updated=true + 评论，不新建）。
test('SU8 submit same-branch force-updates existing PR', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const fetchImpl = async (url, init) => {
    // step1: base sha
    if (url.endsWith('/git/refs/heads/main') && !init?.method) {
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'basesha' } }) };
    }
    // step2: branch exists
    if (url.includes('/git/refs/heads/opsforge-') && !init?.method) {
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'oldcommit' } }) };
    }
    // step2b: open PR exists
    if (url.includes('/pulls?head=') && !init?.method) {
      return { ok: true, status: 200, json: async () => [{ number: 7, html_url: 'https://github.com/owner/repo/pull/7' }] };
    }
    if (url.endsWith('/git/trees')) {
      return { ok: true, status: 201, json: async () => ({ sha: 'treesha' }) };
    }
    if (url.endsWith('/git/commits')) {
      return { ok: true, status: 201, json: async () => ({ sha: 'newcommit' }) };
    }
    if (init?.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'newcommit' } }) };
    }
    // step7: comment on existing PR (POST /pulls/{n}/comments)
    if (url.includes('/pulls/7/comments') && init?.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 99 }) };
    }
    // must NOT call POST /pulls (new PR)
    if (url.endsWith('/pulls') && init?.method === 'POST') {
      throw new Error('SU8 must NOT open a new PR when open PR exists');
    }
    return { ok: false, status: 404, json: async () => ({ message: 'unexpected' }) };
  };
  const r = await submit({
    draftDir: draft, repoRoot, token: 'fake',
    gitRemote: 'git@github.com:owner/repo.git',
    fetch: fetchImpl,
    validate: async () => ({ verdict: 'pass' }),
    securityScan: () => ({ verdict: 'pass', findings: [] }),
    runSuite: async () => ({ verdict: 'pass' }),
  });
  assert.equal(r.updated, true);
  assert.equal(r.prUrl, 'https://github.com/owner/repo/pull/7');
  assert.equal(r.commitSha, 'newcommit');
});

// SU9 fetchPrReviewSummary 业务话摘要（不暴露技术词）。
test('SU9 fetchPrReviewSummary returns business-language summary', async () => {
  const { fetchPrReviewSummary } = await import('./submit.mjs');
  const fetchImpl = async (url) => {
    if (url.includes('/comments')) {
      return { ok: true, status: 200, json: async () => [{ body: '请改第二段文案' }] };
    }
    if (url.includes('/reviews')) {
      return { ok: true, status: 200, json: async () => [{ body: '整体不错，建议补充场景' }] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await fetchPrReviewSummary({
    gh: { owner: 'o', repo: 'r' }, prNumber: 1, token: 't', fetchImpl,
  });
  assert.ok(r.summary.some((s) => s.includes('审核意见') && s.includes('请改第二段文案')));
  assert.ok(r.summary.some((s) => s.includes('运营团队的意见') && s.includes('补充场景')));
  // no technical state words
  for (const s of r.summary) {
    assert.doesNotMatch(s, /APPROVED|CHANGES_REQUESTED|COMMENTED/);
  }
});

// SU10 403 也走业务话过期提示。
test('SU10 submit 403 prints business hint', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) });
  await assert.rejects(
    submit({
      draftDir: draft, repoRoot, token: 'expired',
      gitRemote: 'git@github.com:owner/repo.git',
      fetch: fetchImpl,
      validate: async () => ({ verdict: 'pass' }),
      securityScan: () => ({ verdict: 'pass', findings: [] }),
      runSuite: async () => ({ verdict: 'pass' }),
    }),
    /贡献码可能已过期/,
  );
});
