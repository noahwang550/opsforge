// tools/paths.mjs — 共享路径/IO 助手（§5.1/§5.4）。steering 拥有。
// 所有从 id 拼路径的模块都 import assertSlugSegment / assertCapId。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const SLUG_RE = /^[a-z][a-z0-9-]{2,30}$/;
const CAP_ID_RE = /^[a-z][a-z0-9-]{2,30}\.[a-z][a-z0-9-]{2,30}$/;

/** Resolve ~ to USERPROFILE on Windows, HOME elsewhere. Honors OPSFORGE_HOME env.
 *  @returns {string} absolute home dir */
export function resolveHome() {
  if (process.env.OPSFORGE_HOME) return path.resolve(process.env.OPSFORGE_HOME);
  return process.env.USERPROFILE || os.homedir();
}

/** Resolve ~/.opsforge root. */
export function resolveOpsforgeHome() {
  return path.join(resolveHome(), '.opsforge');
}

/**
 * Resolve ~/.opsforge/eval-history/<cap-id>/ (created on first write).
 * Phase 4 P0-B: regression-sink consumption point.
 * @param {string} capId  "<pack>.<name>" — asserted via assertCapId
 * @returns {string} absolute dir
 */
export function resolveEvalHistoryDir(capId) {
  assertCapId(capId);
  return path.join(resolveOpsforgeHome(), 'eval-history', capId);
}

/**
 * Resolve ~/.opsforge/eval-history/<cap-id>/iteration-<N>/.
 * n=0 means "latest" (no subdir).
 * @param {string} capId
 * @param {number} n  iteration number (>=0; 0 = latest, no subdir)
 * @returns {string}
 */
export function resolveEvalHistoryIterationDir(capId, n) {
  assertCapId(capId);
  if (!Number.isInteger(n) || n < 0) throw new Error(`iteration must be >=0, got ${n}`);
  const base = resolveEvalHistoryDir(capId);
  return n === 0 ? base : path.join(base, `iteration-${n}`);
}

/**
 * Resolve ~/.opsforge/eval-history/<cap-id>/failures.jsonl (latest).
 */
export function resolveFailuresJsonl(capId) {
  return path.join(resolveEvalHistoryDir(capId), 'failures.jsonl');
}

/** Atomic write: write to <dest>.tmp.<pid> then rename. fsync before rename.
 *  Idempotent short-circuit: if existing content hash === new content, skip.
 *  @param {string} absDest  absolute target path
 *  @param {string|Buffer} content */
export async function atomicWrite(absDest, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(absDest)) {
    const existing = fs.readFileSync(absDest);
    if (existing.length === buf.length && existing.equals(buf)) return;
  }
  await fs.promises.mkdir(path.dirname(absDest), { recursive: true });
  const tmp = `${absDest}.tmp.${process.pid}`;
  const fh = await fs.promises.open(tmp, 'w');
  await fh.writeFile(buf);
  try { await fh.sync(); } catch { /* fsync best-effort on some platforms */ }
  await fh.close();
  await fs.promises.rename(tmp, absDest);
}

/** Read JSON if exists else return null. */
export async function readJsonOrNull(p) {
  try { return JSON.parse(await fs.promises.readFile(p, 'utf8')); }
  catch { return null; }
}

/** Sync variant for convenience. */
export function readJsonOrNullSync(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

/** Sync atomic write: write to <dest>.tmp.<pid> then rename. fsync before rename.
 *  Idempotent short-circuit: if existing content hash === new content, skip.
 *  @param {string} absDest  absolute target path
 *  @param {string|Buffer} content */
export function atomicWriteSync(absDest, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(absDest)) {
    const existing = fs.readFileSync(absDest);
    if (existing.length === buf.length && existing.equals(buf)) return;
  }
  fs.mkdirSync(path.dirname(absDest), { recursive: true });
  const tmp = `${absDest}.tmp.${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, buf);
  try { fs.fsyncSync(fd); } catch { /* best-effort on some platforms */ }
  fs.closeSync(fd);
  fs.renameSync(tmp, absDest);
}

/** @param {string} seg  @param {string} label  @returns {string} seg
 *  @throws {Error} if seg fails SLUG_RE (also rejects '..', '/', leading '.') */
export function assertSlugSegment(seg, label = 'segment') {
  if (typeof seg !== 'string' || !SLUG_RE.test(seg)) {
    throw new Error(`path-guard: ${label} "${seg}" does not match ^[a-z][a-z0-9-]{2,30}$`);
  }
  return seg;
}

/** Splits "<pack>.<name>" and asserts both halves. @returns {string} */
export function assertCapId(capId) {
  if (!CAP_ID_RE.test(capId)) throw new Error(`path-guard: capId "${capId}" invalid`);
  return capId;
}

/**
 * draftsRoots(repoRoot) — B1: 枚举所有 _drafts 根（通用 + 品牌）。
 * 复用 validate.mjs scanCapabilities 同款枚举逻辑，只取 _drafts/。
 * @param {string} repoRoot
 * @returns {string[]} absolute draft root dirs that exist
 */
export function draftsRoots(repoRoot) {
  const out = [];
  const general = path.join(repoRoot, 'packs', '_drafts');
  if (fs.existsSync(general)) out.push(general);
  const customersDir = path.join(repoRoot, 'customers');
  if (fs.existsSync(customersDir)) {
    for (const brand of fs.readdirSync(customersDir, { withFileTypes: true })) {
      if (!brand.isDirectory()) continue;
      const bp = path.join(customersDir, brand.name, 'packs', '_drafts');
      if (fs.existsSync(bp)) out.push(bp);
    }
  }
  return out;
}

/**
 * listDrafts(repoRoot) — B1: 列所有 _drafts 下的草稿能力目录。
 * @param {string} repoRoot
 * @returns {{slug: string, name: string, kind: string, path: string, mtime: number, hasFillMe: boolean}[]}
 *  mtime 倒序（最近改的在前）；kind 从 capability/mcp/workflow/bundle.yaml 解析默认 agent；
 *  hasFillMe 扫所有文本文件含 __FILL_ME__。
 */
export function listDrafts(repoRoot) {
  const out = [];
  for (const draftsDir of draftsRoots(repoRoot)) {
    if (!fs.existsSync(draftsDir)) continue;
    for (const slug of fs.readdirSync(draftsDir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      assertSlugSegment(slug.name, 'draft slug');
      const slugDir = path.join(draftsDir, slug.name);
      for (const name of fs.readdirSync(slugDir, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        assertSlugSegment(name.name, 'draft name');
        const capDir = path.join(slugDir, name.name);
        let kind = 'agent', hasFillMe = false;
        for (const f of fs.readdirSync(capDir, { withFileTypes: true })) {
          const fp = path.join(capDir, f.name);
          if (['capability.yaml', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml'].includes(f.name)) {
            try {
              const raw = fs.readFileSync(fp, 'utf8');
              const km = raw.match(/^kind:\s*(\S+)/m);
              if (km) kind = km[1].replace(/['"]/g, '');
            } catch { /* skip */ }
          }
          if (f.isFile()) {
            try { if (fs.readFileSync(fp, 'utf8').includes('__FILL_ME__')) hasFillMe = true; } catch { /* skip */ }
          }
        }
        const st = fs.statSync(capDir);
        out.push({ slug: slug.name, name: name.name, kind, path: capDir, mtime: st.mtimeMs, hasFillMe });
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** submitTokenPath() — B1: 贡献码存盘路径 ~/.opsforge/submit-token.json。 */
export function submitTokenPath() {
  return path.join(resolveOpsforgeHome(), 'submit-token.json');
}

/**
 * 平台 → 安装根目录名 的单一真相源。加新平台只加一行。
 * detectPlatform / detectAllPlatforms / platformInstallDir / mcpConfigPathFor 共用。
 */
export const PLATFORM_DIRS = {
  'claude-code': '.claude',
  'cursor': '.cursor',
  'codex': '.codex',
  'cline': '.cline',
  'dify': '.dify',
  'workbuddy': '.workbuddy',
};

/** MCP 配置文件相对 home 的路径（dify 无本地 mcp 配置 → null）。 */
export const PLATFORM_MCP_PATHS = {
  'claude-code': '.claude.json',
  'cursor': '.cursor/mcp.json',
  'codex': '.codex/config.json',
  'cline': '.cline/mcp_settings.json',
  'dify': null,
  'workbuddy': '.workbuddy/mcp.json',
};

/** 平台安装根目录绝对路径（未知平台 → null）。 */
export function platformInstallDir(platform) {
  const sub = PLATFORM_DIRS[platform];
  return sub ? path.join(resolveHome(), sub) : null;
}

/** 平台 MCP 配置文件绝对路径（无本地 mcp 配置的平台 → null）。 */
export function mcpConfigPathFor(platform) {
  const sub = PLATFORM_MCP_PATHS[platform];
  return sub ? path.join(resolveHome(), sub) : null;
}

/**
 * detectPlatform(opts) — 自动探测目标平台。
 * 优先级：OPSFORGE_PLATFORM env > 已装平台首个（按 PLATFORM_DIRS 顺序）> claude-code 默认。
 * 遍历 PLATFORM_DIRS，返回首个 ~/.<dir> 存在的平台；均不中则默认 claude-code。
 * 多平台命中时按 PLATFORM_DIRS 定义顺序（Tier1 平台在前）取首个。
 * @param {{opsforgeHome?: string}} opts
 * @returns {string} platform id
 */
export function detectPlatform(opts = {}) {
  if (process.env.OPSFORGE_PLATFORM) return process.env.OPSFORGE_PLATFORM;
  const home = opts.opsforgeHome || resolveHome();
  for (const [p, sub] of Object.entries(PLATFORM_DIRS)) {
    if (fs.existsSync(path.join(home, sub))) return p;
  }
  return 'claude-code';
}

/** 返回所有已探测到的平台（多平台场景供业务话提示）。按 PLATFORM_DIRS 顺序。 */
export function detectAllPlatforms(opts = {}) {
  const home = opts.opsforgeHome || resolveHome();
  const out = [];
  for (const [p, sub] of Object.entries(PLATFORM_DIRS)) {
    if (fs.existsSync(path.join(home, sub))) out.push(p);
  }
  return out;
}

/**
 * 判断 MCP entrypoint 是否为可执行脚本（.mjs/.js）。
 * 示例性 MCP 的 entrypoint 常为 source.md（非可执行），运行时需实现真实 server 后方可运行。
 * @param {string} ep
 * @returns {boolean}
 */
export function isExecutableEntrypoint(ep) {
  return typeof ep === 'string' && /\.(mjs|js)$/i.test(ep);
}

/** 注记文案：示例性 MCP，entrypoint 非可执行，需实现真实 server 后方可运行。 */
export const EXAMPLE_MCP_NOTE = '示例性 MCP，entrypoint 非可执行，需实现真实 server 后方可运行';
