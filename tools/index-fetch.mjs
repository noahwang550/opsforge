// tools/index-fetch.mjs — Slice A2: 远程 index.json 拉取 + 缓存 + TTL + SSRF + schema 校验.
// 零新依赖：Node 22 内置 globalThis.fetch + AbortController + fs + path + URL + child_process.
// 官方源 host 硬编码白名单 ['github.io']（仿 submit.mjs api.github.com 模式）.
// 用户覆盖 URL（env OPSFORGE_INDEX_URL）必经 assertPublicUrl 全套 SSRF.
// index.json 是 untrusted data，fetch 后 ajv schema 校验才能消费.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveOpsforgeHome, atomicWriteSync, readJsonOrNullSync } from './paths.mjs';
import { assertPublicUrl } from './intake-fetch.mjs';
import { resolveGitRemote, parseGitRemote } from './submit.mjs';
import { validateIndex } from './index-publish.mjs';

const OFFICIAL_INDEX_HOSTS = ['github.io'];
const DEFAULT_TTL_SECONDS = 86400; // 24h
const FETCH_TIMEOUT_MS = 5000;

/**
 * isOfficialIndexHost(urlOrHost) — 官方索引源 host 白名单判定（后缀匹配覆盖 <owner>.github.io）.
 * 供 install.mjs detail-fetch 复用同一判定，避免 env 覆盖 URL 在缓存命中时绕过 SSRF 守卫（设计 §2.10）.
 * @param {string} urlOrHost  完整 URL 或 hostname
 * @returns {boolean}
 */
export function isOfficialIndexHost(urlOrHost) {
  if (!urlOrHost) return false;
  let host = urlOrHost;
  if (/^https?:\/\//i.test(urlOrHost)) {
    try { host = new URL(urlOrHost).hostname; } catch { return false; }
  }
  return OFFICIAL_INDEX_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/**
 * fetchRemoteIndex({url, cacheDir, ttl, refresh, fetchImpl, lookup}) —
 * 远程拉取 index.json，缓存 + TTL + SSRF + schema 校验.
 * @param {{url: string, cacheDir?: string, ttl?: number, refresh?: boolean,
 *          fetchImpl?: Function, lookup?: Function}} opts
 * @returns {Promise<{index: Object, fromCache: boolean, fetchedAt: string}>}
 * @throws {Error} fetch 失败 / Content-Type 不符 / schema 校验失败 / SSRF 拒绝
 */
export async function fetchRemoteIndex({ url, cacheDir, ttl, refresh, fetchImpl, lookup } = {}) {
  const home = resolveOpsforgeHome();
  cacheDir = cacheDir || path.join(home, 'cache');
  const cacheFile = path.join(cacheDir, 'index.json');
  // Number(undefined)=NaN, NaN 不被 ?? 视为 nullish，故显式判 NaN.
  const envTtl = Number(process.env.OPSFORGE_INDEX_TTL);
  ttl = ttl ?? (Number.isFinite(envTtl) ? envTtl : DEFAULT_TTL_SECONDS);

  // 1. 缓存命中（!refresh + 文件存在 + mtime 在 TTL 内 + schema 有效）→ 读缓存.
  if (!refresh && fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < ttl * 1000) {
      const cached = readJsonOrNullSync(cacheFile);
      if (cached && validateIndex(cached)) {
        return { index: cached, fromCache: true, fetchedAt: stat.mtimeMs ? new Date(stat.mtimeMs).toISOString() : cached.generatedAt };
      }
    }
  }

  // 2. SSRF 判定：官方源（host 在白名单，用后缀匹配覆盖 <owner>.github.io）可信不经 assertPublicUrl；
  //    用户覆盖 URL（非白名单 host）必经 assertPublicUrl 全套（私网/DNS rebinding/shell-metachar 拒绝）.
  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch { throw new Error(`index-fetch: invalid URL (${url})`); }
  const isOfficial = OFFICIAL_INDEX_HOSTS.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`));
  if (!isOfficial) {
    await assertPublicUrl(url, { lookup });
  }

  // 3. fetch（Node 内置，超时 5s 经 AbortController）.
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('index-fetch: fetch unavailable (Node >= 18 required)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetchFn(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`index-fetch: network error fetching index (${e.message})`);
  }
  clearTimeout(timer);
  if (!resp || !resp.ok) {
    throw new Error(`index-fetch: fetch failed (status ${resp ? resp.status : '?'})`);
  }
  const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
  if (!ct.includes('application/json') && !ct.includes('text/plain')) {
    throw new Error(`index-fetch: unexpected content-type "${ct}" (expected application/json or text/plain)`);
  }

  // 4. schema 校验（ajv + schema/index.schema.json）—— untrusted data.
  let json;
  try { json = await resp.json(); }
  catch (e) { throw new Error(`index-fetch: response is not valid JSON (${e.message})`); }
  if (!validateIndex(json)) {
    throw new Error('index-fetch: index schema validation failed (refusing to consume untrusted data)');
  }

  // 5. 原子写缓存.
  fs.mkdirSync(cacheDir, { recursive: true });
  atomicWriteSync(cacheFile, JSON.stringify(json));
  return { index: json, fromCache: false, fetchedAt: new Date().toISOString() };
}

/**
 * officialIndexUrl(opts) — 从 git remote 派生官方索引 URL（host 硬编码 github.io）.
 * @param {{execFile?: Function, repoRoot?: string}} opts
 * @returns {string} https://<owner>.github.io/<repo>/index.json
 * @throws {Error} git remote 非 github.com / 解析失败
 */
export function officialIndexUrl(opts = {}) {
  const remote = resolveGitRemote({ execFile: opts.execFile });
  const gh = parseGitRemote(remote);
  if (!gh) throw new Error('index-fetch: 官方索引源需 GitHub 仓库（remote.origin.url 非 github.com）');
  return `https://${gh.owner}.github.io/${gh.repo}/index.json`;
}

/**
 * readCacheIndex(cacheDir) — 离线降级读缓存（不校验 TTL，只校验 schema）.
 * @param {string} cacheDir
 * @returns {Object|null} index 或 null（无缓存/损坏/schema 失败）
 */
export function readCacheIndex(cacheDir) {
  const cacheFile = path.join(cacheDir || path.join(resolveOpsforgeHome(), 'cache'), 'index.json');
  const cached = readJsonOrNullSync(cacheFile);
  if (!cached) return null;
  if (!validateIndex(cached)) return null;
  return cached;
}

/** CLI main(): node tools/index-fetch.mjs [--url <url>] [--refresh]. */
export function main() {
  const argv = process.argv.slice(2);
  let url, refresh = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) { url = argv[++i]; }
    else if (argv[i] === '--refresh') { refresh = true; }
  }
  (async () => {
    try {
      const target = url || officialIndexUrl();
      const r = await fetchRemoteIndex({ url: target, refresh });
      console.log(`fromCache: ${r.fromCache}, count: ${r.index.count}, fetchedAt: ${r.fetchedAt}`);
    } catch (e) {
      console.error(`index-fetch failed: ${e.message}`);
      process.exit(1);
    }
  })();
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('index-fetch.mjs');
if (invokedDirect) main();
