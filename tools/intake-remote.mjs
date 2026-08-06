// tools/intake-remote.mjs — P1-A: reference-scope intake (API LICENSE fetch, no clone).
// GitHub: /repos/<o>/<r>/license + /repos/<o>/<r>/commits/HEAD via Node built-in fetch.
// Non-GitHub: git ls-remote (argv form, no shell — N2 RCE guard preserved).
// SSRF guard reused from intake-fetch.mjs assertPublicUrl (https-only,
// shell-metachar reject, private/loopback reject, DNS rebinding reject).
// Zero new deps (Node built-in fetch + execFileSync from intake-fetch.mjs).
import { execFileSync } from 'node:child_process';
import { assertPublicUrl } from './intake-fetch.mjs';

/**
 * Parse a GitHub URL into {owner, repo} or return null for non-GitHub.
 * @param {string} url
 * @returns {{owner: string, repo: string}|null}
 */
function parseGitHubUrl(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * Fetch GitHub metadata via API (license + commit sha, no clone).
 * @param {{owner: string, repo: string}} gh
 * @param {string} url  original git URL (written to upstream-ref.repo)
 * @param {{fetch?: Function, githubToken?: string}} opts
 * @returns {Promise<{repo: string, commit: string, license: string, sizeBytes: null, intakeScope: 'reference'}>}
 */
async function fetchGitHubMeta(gh, url, opts) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error('intake-remote: fetch unavailable (Node < 18?)');
  const headers = { 'Accept': 'application/vnd.github+json' };
  const token = opts.githubToken || process.env.OPSFORGE_GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${gh.owner}/${gh.repo}`;
  // Concurrent license + commit fetch.
  const [licResp, commitResp] = await Promise.all([
    fetchImpl(`${base}/license`, { headers }),
    fetchImpl(`${base}/commits/HEAD`, { headers }),
  ]);
  let license = 'UNKNOWN';
  if (licResp.ok) {
    const data = await licResp.json();
    license = (data.license && data.license.spdx_id) || 'UNKNOWN';
  }
  let commit = 'unknown';
  if (commitResp.ok) {
    const data = await commitResp.json();
    commit = (data.sha || '').slice(0, 7) || 'unknown';
  }
  return { repo: url, commit, license, sizeBytes: null, intakeScope: 'reference' };
}

/**
 * Fetch metadata via `git ls-remote` (non-GitHub fallback, no clone).
 * argv form — no shell, so the URL is never tokenized (N2 RCE guard preserved).
 * @param {string} url
 * @param {{execFile?: Function}} opts
 * @returns {Promise<{repo: string, commit: string, license: string, sizeBytes: null, intakeScope: 'reference'}>}
 */
async function fetchViaLsRemote(url, opts) {
  const execFile = opts.execFile
    || ((cmd, args, o) => execFileSync(cmd, args, { encoding: 'utf8', ...o }));
  let out;
  try {
    out = execFile('git', ['ls-remote', url, 'HEAD'], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`intake-remote: git ls-remote failed for ${url}: ${e.message}`);
  }
  // Output format: <sha>\tHEAD
  const commit = (out.split('\t')[0] || '').slice(0, 7) || 'unknown';
  return { repo: url, commit, license: 'UNKNOWN', sizeBytes: null, intakeScope: 'reference' };
}

/**
 * Fetch upstream metadata via API (no clone). GitHub: /repos/<o>/<r>/license
 * + /repos/<o>/<r>/commits/HEAD. Non-GitHub: git ls-remote (argv, no shell).
 * Reuses assertPublicUrl SSRF guard (https-only, shell-metachar reject,
 * private/loopback reject, DNS rebinding reject). reference-scope only stores
 * the URL — it does NOT clone, but still passes the SSRF gate.
 * @param {string} url  https public git URL
 * @param {{fetch?: Function, execFile?: Function, lookup?: Function, githubToken?: string}} opts
 *   opts.fetch injectable for tests; opts.githubToken passes Authorization header.
 * @returns {Promise<{repo: string, commit: string, license: string, sizeBytes: null, intakeScope: 'reference'}>}
 * @throws {Error} URL not https / SSRF / API failed / ls-remote failed
 */
export async function fetchRemoteMeta(url, opts = {}) {
  // First line: SSRF guard (https-only, shell-metachar reject, private reject,
  // DNS rebinding reject). reference-scope only stores URL but STILL must pass.
  await assertPublicUrl(url, { lookup: opts.lookup });
  const gh = parseGitHubUrl(url);
  if (gh) {
    return await fetchGitHubMeta(gh, url, opts);
  }
  return await fetchViaLsRemote(url, opts);
}

export function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/intake-remote.mjs <https-url>');
    process.exit(2);
  }
  (async () => {
    try {
      const meta = await fetchRemoteMeta(argv[0]);
      console.log(`remote: ${meta.repo} @${meta.commit} (license=${meta.license}, scope=${meta.intakeScope})`);
      process.exit(0);
    } catch (e) {
      console.error(`intake-remote failed: ${e.message}`);
      process.exit(1);
    }
  })();
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('intake-remote.mjs') && !process.env.NODE_TEST_CONTEXT;
if (invokedDirect) { main(); }
