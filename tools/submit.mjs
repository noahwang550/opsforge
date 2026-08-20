// tools/submit.mjs — B1/B2: 把本地草稿提交成中心仓库 PR（贡献码模型，纯菜单）。
// 零新依赖：node:child_process execFileSync / node:crypto createHash / node:fs /
// globalThis.fetch / 全局 URL。GitHub API host 硬编码 api.github.com。
// token 只在 Authorization 头，不进 URL/body/日志；存 ~/.opsforge/submit-token.json 0600。
// 全 argv execFileSync('git', [...]) 无 shell（N2 RCE 思路复用）；草稿路径 assertDraftUnder
// 防穿越；预检先跑 §A+§B+static-only tests。
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { submitTokenPath, assertSlugSegment, assertCapId, atomicWriteSync, readJsonOrNullSync } from './paths.mjs';
import { scan as securityScanDefault } from './security-scan.mjs';

const GITHUB_API = 'https://api.github.com';

/** 预检失败（§A/§B/tests 任一阻断）。kind: 'validation'|'security'|'tests'。 */
export class PreflightError extends Error {
  constructor(kind, report) {
    super(`preflight ${kind} block`);
    this.name = 'PreflightError';
    this.kind = kind;
    this.report = report;
  }
}

/**
 * parseGitRemote(gitRemote) — 解析 git remote URL 为 {owner, repo}。
 * 支持 git@github.com:owner/repo.git (SSH) 与 https://github.com/owner/repo(.git) (HTTPS)。
 * 非 github.com 返回 null。
 * @param {string} gitRemote
 * @returns {{owner: string, repo: string}|null}
 */
export function parseGitRemote(gitRemote) {
  if (typeof gitRemote !== 'string') return null;
  // SSH: git@github.com:owner/repo.git
  let m = gitRemote.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return validOwnerRepo(m[1], m[2]);
  // HTTPS: https://github.com/owner/repo(.git)
  m = gitRemote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (m) return validOwnerRepo(m[1], m[2]);
  return null;
}

// H1 防御：owner/repo 拼进 GitHub API URL，必须匹配 GitHub 命名规则，
// 防 ? & .. 等字符注入 path/query 改写 API 端点。不合规返回 null。
function validOwnerRepo(owner, repo) {
  const RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  if (!RE.test(owner) || !RE.test(repo)) return null;
  return { owner, repo };
}

/**
 * resolveGitRemote(opts) — 用 execFileSync('git', argv) 读 remote.origin.url。
 * 全 argv 无 shell。opts.execFile 注入测试。
 * @param {{execFile?: Function}} opts
 * @returns {string} remote URL
 */
export function resolveGitRemote(opts = {}) {
  const execFile = opts.execFile || execFileSync;
  return String(execFile('git', ['config', '--get', 'remote.origin.url'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })).trim();
}

/**
 * readSubmitToken() — 读 ~/.opsforge/submit-token.json → {token}|null。
 * @returns {{token: string}|null}
 */
export function readSubmitToken() {
  const p = submitTokenPath();
  const data = readJsonOrNullSync(p);
  if (data && typeof data.token === 'string') return data;
  return null;
}

/**
 * writeSubmitToken(token) — 写 ~/.opsforge/submit-token.json 0600。
 * @param {string} token
 */
export function writeSubmitToken(token) {
  const p = submitTokenPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWriteSync(p, JSON.stringify({ token }));
  if (process.platform !== 'win32') {
    try { fs.chmodSync(p, 0o600); } catch { /* best-effort */ }
  }
}

/**
 * assertDraftUnder(draftDir, repoRoot) — 草稿必须在 packs/_drafts/ 或
 * customers/<brand>/packs/_drafts/ 下，防路径穿越。assertSlugSegment 防 ..。
 * @param {string} draftDir
 * @param {string} repoRoot
 * @throws {Error} if not under a _drafts root
 */
export function assertDraftUnder(draftDir, repoRoot) {
  // H2 防御：path.resolve 只归一化 .. 不解析符号链接；符号链接可指向
  // ~/.opsforge/submit-token.json 等敏感文件，被 buildTreeEntries 读出上传。
  // 用 fs.realpathSync 解析真实路径后再做 _drafts 归属判断；
  // 路径不存在时回退 path.resolve（相对穿越 .. 检查仍生效）。
  let resolved;
  try { resolved = fs.realpathSync(draftDir); }
  catch { resolved = path.resolve(draftDir); }
  let root;
  try { root = fs.realpathSync(repoRoot); }
  catch { root = path.resolve(repoRoot); }
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path-guard: draftDir "${draftDir}" outside repo root`);
  }
  // must be under packs/_drafts/ or customers/<brand>/packs/_drafts/
  const parts = rel.split(path.sep);
  const underDrafts = parts.includes('_drafts');
  if (!underDrafts) {
    throw new Error(`path-guard: draftDir "${draftDir}" not under a _drafts root`);
  }
  // validate slug/name segments (reject .., slashes in segments)
  const draftIdx = parts.indexOf('_drafts');
  const slug = parts[draftIdx + 1];
  const name = parts[draftIdx + 2];
  if (slug) assertSlugSegment(slug, 'draft slug');
  if (name) assertSlugSegment(name, 'draft name');
  return resolved;
}

function hash8(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 8);
}

/**
 * runLocalPreflight(draftDir, repoRoot, opts) — 跑 validate + security-scan + test-runner
 * (static-only)。三报告需 pass/pending；阻断抛 PreflightError(kind, report)。
 * @param {string} draftDir
 * @param {string} repoRoot
 * @param {{validate?: Function, securityScan?: Function, runSuite?: Function}} opts
 * @returns {Promise<{ok: true}>}
 */
export async function runLocalPreflight(draftDir, repoRoot, opts = {}) {
  const validateFn = opts.validate || (async () => {
    const m = await import('./validate.mjs');
    return m.validateDir(draftDir, { repoRoot });
  });
  const securityFn = opts.securityScan || (() => securityScanDefault(draftDir));
  const runSuiteFn = opts.runSuite || (async () => {
    const m = await import('./test-runner.mjs');
    return m.runSuite(draftDir, { runner: 'static-only' });
  });
  const valReport = await validateFn(draftDir, repoRoot);
  // validateDir 返回 verdict 'fail'（不是 'block'）；'block'/'fail' 均需阻断预检。
  if (valReport && (valReport.verdict === 'block' || valReport.verdict === 'fail')) {
    throw new PreflightError('validation', valReport);
  }
  const secReport = securityFn(draftDir);
  if (secReport && secReport.verdict === 'block') throw new PreflightError('security', secReport);
  const testReport = await runSuiteFn(draftDir, { runner: 'static-only' });
  if (testReport && testReport.verdict === 'fail') throw new PreflightError('tests', testReport);
  return { ok: true };
}

function buildTreeEntries(draftDir, repoRoot) {
  const entries = [];
  // H2：从真实路径起步（assertDraftUnder 已 realpath 校验，这里再 realpath 防二次注入）
  const realDraft = fs.realpathSync(draftDir);
  const realRoot = fs.realpathSync(repoRoot);
  const rel = path.relative(realRoot, realDraft).split(path.sep).join('/');
  function walk(dir, prefix) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      // H2：跳过符号链接，防链接逃逸读仓库外敏感文件
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      const relPath = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { walk(full, relPath); continue; }
      // skip generated/transient files
      const base = ent.name;
      if (base === '.opsforge-state.json') continue;
      if (base.endsWith('-report.json')) continue;
      if (base === 'interview.md') continue;
      const buf = fs.readFileSync(full);
      // detect binary
      const isText = !buf.includes(0) && buf.length < 5 * 1024 * 1024;
      entries.push({
        path: `${rel}/${relPath}`,
        mode: '100644',
        type: 'blob',
        content: isText ? buf.toString('utf8') : buf.toString('base64'),
        _encoding: isText ? 'utf-8' : 'base64',
      });
    }
  }
  walk(realDraft, '');
  return entries;
}

/**
 * callGithubApi({gh, draftDir, repoRoot, token, fetchImpl, execFile}) —
 * GitHub API 调用序列（见架构文档第 2 节）：取 base SHA → 算 branchName + 检测同名 →
 * 建分支（若不存在）→ 上传草稿为 tree → 建 commit → force-update 分支 ref →
 * 开 PR 或追加评论（同名分支 force-update 不重开）。401/403 统一业务话过期提示。
 * @returns {Promise<{prUrl: string, branch: string, commitSha: string, updated: boolean}>}
 */
export async function callGithubApi({ gh, draftDir, repoRoot, token, fetchImpl, execFile }) {
  const fetch = fetchImpl || globalThis.fetch;
  if (!fetch) throw new Error('submit: fetch unavailable (Node < 18?)');
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = `${GITHUB_API}/repos/${gh.owner}/${gh.repo}`;

  async function ghJson(url, init = {}) {
    const resp = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('贡献码可能已过期，请联系团队管理员重新领取。');
    }
    const json = await resp.json();
    return { ok: resp.ok, status: resp.status, json };
  }
  // M2：写操作（建分支/tree/commit/patch-ref/开PR）必须成功；非 ok 抛业务话，不泄漏 status/body。
  async function ghMust(url, init) {
    const r = await ghJson(url, init);
    if (!r.ok) {
      throw new Error('提交时中心仓库返回异常，请稍后再试或联系团队管理员。');
    }
    return r;
  }

  // step1: 取 base SHA (main → master fallback)
  let baseSha = null;
  const baseMain = await ghJson(`${base}/git/refs/heads/main`);
  if (baseMain.ok) baseSha = baseMain.json.object.sha;
  else {
    const baseMaster = await ghJson(`${base}/git/refs/heads/master`);
    if (baseMaster.ok) baseSha = baseMaster.json.object.sha;
  }
  if (!baseSha) throw new Error('中心仓库找不到 main/master 分支，请联系团队管理员。');

  // step2: 算 branchName + 检测同名（opsforge-<slug>-<name>-<hash8>）
  const relDraft = path.relative(repoRoot, draftDir).split(path.sep);
  const draftIdx = relDraft.indexOf('_drafts');
  const slugSeg = draftIdx >= 0 ? relDraft[draftIdx + 1] : 'draft';
  const nameSeg = draftIdx >= 0 ? relDraft[draftIdx + 2] : 'cap';
  const branchName = `opsforge-${slugSeg}-${nameSeg}-${hash8(draftDir)}`;
  let branchExists = false, oldCommitSha = null, openPrNumber = null, openPrUrl = null;
  const branchCheck = await ghJson(`${base}/git/refs/heads/${branchName}`);
  if (branchCheck.ok) {
    branchExists = true;
    oldCommitSha = branchCheck.json.object.sha;
    // check open PR
    const prs = await ghJson(`${base}/pulls?head=${gh.owner}:${branchName}&state=open`);
    if (prs.ok && Array.isArray(prs.json) && prs.json.length > 0) {
      openPrNumber = prs.json[0].number;
      openPrUrl = prs.json[0].html_url;
    }
  }

  // step3: 建分支（若不存在）
  if (!branchExists) {
    // GitHub create-ref: POST /git/refs with body { ref: "refs/heads/<branch>", sha }.
    // POSTing to /git/refs/heads/<branch> is not a valid endpoint -> GitHub 422.
    await ghMust(`${base}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // step4: 上传草稿为 tree
  const entries = buildTreeEntries(draftDir, repoRoot);
  const parentSha = branchExists ? oldCommitSha : baseSha;
  const treeResp = await ghMust(`${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentSha, tree: entries }),
    headers: { 'Content-Type': 'application/json' },
  });
  const treeSha = treeResp.json.sha;

  // step5: 建 commit
  const commitResp = await ghMust(`${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      tree: treeSha,
      parents: [parentSha],
      message: `opsforge: 提交能力草稿`,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const commitSha = commitResp.json.sha;

  // step6: force-update 分支 ref
  await ghMust(`${base}/git/refs/heads/${branchName}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: true }),
    headers: { 'Content-Type': 'application/json' },
  });

  // step7: 开 PR 或追加评论（同名分支 force-update 不重开）
  let prUrl, updated;
  if (openPrNumber) {
    updated = true;
    prUrl = openPrUrl;
    await ghMust(`${base}/pulls/${openPrNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `opsforge 已更新此提交（${new Date().toISOString()}）。` }),
      headers: { 'Content-Type': 'application/json' },
    });
  } else {
    updated = false;
    const prResp = await ghMust(`${base}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `opsforge: 提交能力草稿`,
        head: branchName,
        base: 'main',
        body: '由 opsforge submit 一键提交。请运营团队审核。',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    prUrl = prResp.json.html_url;
  }
  return { prUrl, branch: branchName, commitSha, updated };
}

/**
 * fetchPrReviewSummary({gh, prNumber, token, fetchImpl}) — B2 体验增强：
 * 并发 GET /pulls/{n}/comments + /pulls/{n}/reviews → 业务话摘要。
 * 不暴露 APPROVED/CHANGES_REQUESTED 等技术词；fetch 失败只打印"审核意见暂不可读"不阻断。
 * @returns {Promise<{summary: string[]}>}
 */
export async function fetchPrReviewSummary({ gh, prNumber, token, fetchImpl }) {
  const fetch = fetchImpl || globalThis.fetch;
  if (!fetch) return { summary: ['审核意见暂不可读。'] };
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = `${GITHUB_API}/repos/${gh.owner}/${gh.repo}`;
  try {
    const [commentsResp, reviewsResp] = await Promise.all([
      fetch(`${base}/pulls/${prNumber}/comments`, { headers }),
      fetch(`${base}/pulls/${prNumber}/reviews`, { headers }),
    ]);
    const summary = [];
    if (commentsResp.ok) {
      const comments = await commentsResp.json();
      for (const c of (Array.isArray(comments) ? comments : []).slice(0, 3)) {
        if (c.body) summary.push(`审核意见：${String(c.body).slice(0, 80)}`);
      }
    }
    if (reviewsResp.ok) {
      const reviews = await reviewsResp.json();
      for (const rv of (Array.isArray(reviews) ? reviews : []).slice(0, 3)) {
        if (rv.body) summary.push(`运营团队的意见：${String(rv.body).slice(0, 80)}`);
      }
    }
    if (summary.length === 0) summary.push('暂无审核意见。');
    return { summary };
  } catch {
    return { summary: ['审核意见暂不可读。'] };
  }
}

/**
 * submit({draftDir, repoRoot, token, gitRemote, ...opts}) — B1 核心：
 * 1. assertDraftUnder 2. runLocalPreflight 3. resolveGitRemote+parseGitRemote 4. callGithubApi
 * @returns {Promise<{prUrl, branch, commitSha, updated}>}
 */
export async function submit({ draftDir, repoRoot, token, gitRemote, ...opts }) {
  assertDraftUnder(draftDir, repoRoot);
  await runLocalPreflight(draftDir, repoRoot, opts);
  const remote = gitRemote || resolveGitRemote({ execFile: opts.execFile });
  const gh = parseGitRemote(remote);
  if (!gh) throw new Error('无法识别中心仓库地址，请联系团队管理员确认 git remote 指向 github.com。');
  return callGithubApi({ gh, draftDir, repoRoot, token, fetchImpl: opts.fetch, execFile: opts.execFile });
}
