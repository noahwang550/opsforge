// tools/inventory.mjs — 动态能力清单（Phase 3.6 收尾）。纯派生模块：从
// registry.yaml + registry-brands.yaml（已发布 SSOT）+ scanCapabilities（三态）
// 派生能力清单，并从每个能力 body 的 H2 章节（## 能力说明 / ## 适用场景）
// 抽取详细说明与适配场景。两个只读出口：
//   1) README 标记块（`--readme` 重写 / `--check-readme` 漂移门控）
//   2) `opsforge discover --all` 全局总览（`--all` 渲染中文分组卡片）
// 零新依赖：js-yaml + Node 内置 + 动态 adapter import（复用 validate.mjs 的
// scanCapabilities / extractH2Section）。steering 拥有。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { scanCapabilities, extractH2Section } from './validate.mjs';
import { readJsonOrNullSync, atomicWriteSync } from './paths.mjs';

const START_MARK = '<!-- opsforge:capability-inventory start -->';
const END_MARK = '<!-- opsforge:capability-inventory end -->';

const KIND_LABEL = { agent: 'agent', skill: 'skill', mcp: 'mcp', workflow: 'workflow', bundle: 'bundle' };
const STATE_LABEL = { released: '已发布', staged: '暂存', formal: '正式', draft: '草稿' };

function toPosix(p) { return p.split(path.sep).join('/'); }

function getRepoRoot() {
  let cur = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(cur, 'templates')) || fs.existsSync(path.join(cur, 'package.json'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

function loadRegistry(repoRoot) {
  const regPath = path.join(repoRoot, 'registry.yaml');
  const brandsPath = path.join(repoRoot, 'registry-brands.yaml');
  let registry = { capabilities: {} };
  let brands = { brands: {} };
  try { registry = yaml.load(fs.readFileSync(regPath, 'utf8')) || registry; } catch { /* fresh */ }
  try { brands = yaml.load(fs.readFileSync(brandsPath, 'utf8')) || brands; } catch { /* fresh */ }
  return { registry, brands };
}

// 三态：草稿 / 暂存 / 正式 / 已发布。registry 决定 released；路径决定 draft/staged。
function detectCapState(capDir, isReleased) {
  const p = toPosix(capDir);
  if (p.includes('/_drafts/') || p.includes('/_third-party/')) return 'draft';
  if (p.includes('/_staged/')) return 'staged';
  return isReleased ? 'released' : 'formal';
}

function classifyScope(capDir) {
  const m = toPosix(capDir).match(/\/customers\/([^/]+)\//);
  if (m) return { scope: 'brand', brand: m[1] };
  return { scope: 'general', brand: null };
}

// body 文件：agent/skill/mcp 用 entrypoint（含 frontmatter，剥离）；workflow/bundle 用 README.md。
function bodyFilePath(cap) {
  const y = cap.yaml;
  if (y && y.entrypoint) return path.join(cap.dir, y.entrypoint);
  return path.join(cap.dir, 'README.md');
}

function readBodyMarkdown(cap) {
  const p = bodyFilePath(cap);
  if (!fs.existsSync(p)) return '';
  let raw = fs.readFileSync(p, 'utf8');
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (m) raw = m[1];
  return raw;
}

// 取适用场景首条 bullet 作为 README 表格的"适用场景"列。
function firstScenarioTag(scenariosText) {
  if (!scenariosText) return '';
  for (const ln of scenariosText.split(/\r?\n/)) {
    const m = ln.match(/^\s*[-•]\s*(.+)/);
    if (m) return m[1].trim();
  }
  return '';
}

// 每平台支持情况：Tier（adapter.tier()）+ 硬依赖缺失（adapter.supports(point)）。
const _adapterCache = {};
async function loadAdapter(platform) {
  if (_adapterCache[platform]) return _adapterCache[platform];
  try {
    const mod = await import(`../adapters/${platform}/adapter.mjs`);
    _adapterCache[platform] = mod.adapter;
    return mod.adapter;
  } catch { return null; }
}

async function computePlatformSupport(cap) {
  const y = cap.yaml;
  const platforms = y.platforms || [];
  const requires = y.requires || [];
  const hardPoints = requires.filter((r) => r.severity === 'hard').map((r) => r.point);
  const out = [];
  for (const platform of platforms) {
    const a = await loadAdapter(platform);
    let tier = null;
    let hardUnmet = [];
    if (a) {
      if (typeof a.tier === 'function') tier = a.tier();
      if (typeof a.supports === 'function') {
        for (const pt of hardPoints) {
          try { if (!a.supports(pt)) hardUnmet.push(pt); } catch { /* skip */ }
        }
      }
    }
    out.push({ platform, tier, hardUnmet });
  }
  return out;
}

// 质量灯：validation/security/eval 三报告 verdict。任一 fail/block=红；全 pass=绿；否则黄。
function qualityLight(cap) {
  const v = readJsonOrNullSync(path.join(cap.dir, 'validation-report.json'));
  const s = readJsonOrNullSync(path.join(cap.dir, 'security-report.json'));
  const e = readJsonOrNullSync(path.join(cap.dir, 'eval-report.json'));
  const verdicts = [v && v.verdict, s && s.verdict, e && e.verdict];
  if (verdicts.includes('fail') || verdicts.includes('block')) return '红';
  const present = [v, s, e].filter(Boolean);
  if (present.length === 3 && verdicts.every((x) => x === 'pass')) return '绿';
  return '黄';
}

/**
 * buildInventory(opts) — 派生能力清单。
 * @param {{repoRoot?: string, includeDrafts?: boolean}} opts
 * @returns {Promise<{general: Array, brands: Object, all: Array}>}
 *   每个 entry：{id, version, kind, pack, owner, customer, display_name_zh,
 *   display_name_en, description, detail, scenarios, scenarioTag, platformSupport,
 *   light, state, scope, brand, dir}
 */
export async function buildInventory(opts = {}) {
  const repo = opts.repoRoot || getRepoRoot();
  const { registry } = loadRegistry(repo);
  const releasedIds = new Set(Object.keys(registry.capabilities || {}));
  const allCaps = scanCapabilities(repo);
  const entries = [];
  for (const cap of allCaps) {
    if (!cap.yaml) continue;
    const id = cap.yaml.id;
    const isReleased = releasedIds.has(id);
    const state = detectCapState(cap.dir, isReleased);
    if (state === 'draft' && !opts.includeDrafts) continue;
    const { scope, brand } = classifyScope(cap.dir);
    const body = readBodyMarkdown(cap);
    const detail = extractH2Section(body, '能力说明');
    const scenarios = extractH2Section(body, '适用场景');
    const scenarioTag = firstScenarioTag(scenarios) || (cap.yaml.description || '');
    const platformSupport = await computePlatformSupport(cap);
    const light = qualityLight(cap);
    entries.push({
      id,
      version: cap.yaml.version,
      kind: cap.yaml.kind,
      pack: cap.yaml.pack,
      owner: cap.yaml.owner,
      customer: cap.yaml.customer || null,
      display_name_zh: cap.yaml.display_name_zh || '',
      display_name_en: cap.yaml.display_name_en || '',
      description: cap.yaml.description || '',
      detail,
      scenarios,
      scenarioTag,
      platformSupport,
      light,
      state,
      scope,
      brand,
      dir: cap.dir,
    });
  }
  const kindOrder = ['agent', 'skill', 'mcp', 'workflow', 'bundle'];
  const sortEntries = (a, b) => {
    const ko = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    if (ko !== 0) return ko;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const general = entries.filter((e) => e.scope === 'general').sort(sortEntries);
  const brandMap = {};
  for (const e of entries.filter((e) => e.scope === 'brand')) {
    (brandMap[e.brand] ||= []).push(e);
  }
  for (const b of Object.keys(brandMap)) brandMap[b].sort(sortEntries);
  return { general, brands: brandMap, all: entries };
}

function platformCell(e) {
  return e.platformSupport.map((p) => {
    const tier = p.tier ? `T${p.tier}` : '?';
    const unmet = p.hardUnmet.length ? '⚠' : '';
    return `${p.platform}(${tier}${unmet})`;
  }).join(' · ') || '-';
}

/** renderReadmeBlock(inv) → markdown 片段（标记块内容，不含标记本身）。 */
export function renderReadmeBlock(inv) {
  const lines = [];
  lines.push('## 能力清单（自动生成，请勿手动编辑）');
  lines.push('');
  lines.push('> 由 `node tools/inventory.mjs --readme` 从 registry + 能力 body 的 `## 能力说明` / `## 适用场景` 章节派生。草稿不出现。');
  lines.push('');
  const renderTable = (title, entries) => {
    if (!entries || entries.length === 0) return;
    lines.push(`### ${title}`);
    lines.push('');
    lines.push('| id | 中文名 | 类型 | 平台 | 适用场景 | 状态 | 版本 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const e of entries) {
      const zh = e.display_name_zh || e.id;
      const tag = (e.scenarioTag || '-').replace(/\|/g, '\\\\|');
      lines.push(`| \`${e.id}\` | ${zh} | ${e.kind} | ${platformCell(e)} | ${tag} | ${STATE_LABEL[e.state] || e.state} | ${e.version} |`);
    }
    lines.push('');
  };
  renderTable('通用能力', inv.general);
  for (const brand of Object.keys(inv.brands).sort()) {
    renderTable(`品牌定制：${brand}`, inv.brands[brand]);
  }
  if (inv.all.length === 0) {
    lines.push('_暂无已发布 / 暂存能力。_');
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** renderDiscoverAll(inv, opts) → 中文分组卡片（discover --all 输出）。 */
export function renderDiscoverAll(inv /*, opts */) {
  const lines = [];
  const renderGroup = (title, entries) => {
    if (!entries || entries.length === 0) return;
    lines.push(`=== ${title} ===`);
    lines.push('');
    const byKind = {};
    for (const e of entries) (byKind[e.kind] ||= []).push(e);
    const kindOrder = ['agent', 'skill', 'mcp', 'workflow', 'bundle'];
    for (const k of kindOrder) {
      const list = byKind[k];
      if (!list || list.length === 0) continue;
      lines.push(`【${KIND_LABEL[k]}类】`);
      for (const e of list) {
        const stateTag = e.state === 'draft' ? '[草稿] ' : (e.state === 'staged' ? '[暂存] ' : '');
        lines.push(`  ▌ ${e.id}  v${e.version}  ${e.light}  ${stateTag}`);
        if (e.display_name_zh) lines.push(`    ${e.display_name_zh}`);
        lines.push('    【能力说明】');
        if (e.detail) {
          for (const ln of e.detail.split(/\r?\n/)) lines.push(`    ${ln}`);
        } else {
          lines.push('    （待补）');
        }
        lines.push('    【适用场景】');
        if (e.scenarios) {
          for (const ln of e.scenarios.split(/\r?\n/)) lines.push(`    ${ln}`);
        } else {
          lines.push('    （待补）');
        }
        const plat = e.platformSupport.map((p) => {
          const tier = p.tier ? `T${p.tier}` : '?';
          const unmet = p.hardUnmet.length ? ` 缺硬依赖:${p.hardUnmet.join(',')}` : '';
          return `${p.platform}(${tier}${unmet})`;
        }).join(' · ');
        lines.push(`    平台: ${plat || '-'}`);
        lines.push('    ----------------------------------------');
      }
      lines.push('');
    }
  };
  renderGroup('通用能力', inv.general);
  for (const brand of Object.keys(inv.brands).sort()) {
    renderGroup(`品牌定制：${brand}`, inv.brands[brand]);
  }
  if (inv.all.length === 0) lines.push('○ 仓库中暂无能力。');
  return lines.join('\n').replace(/\n+$/, '\n');
}

// ---------- README 标记块原地替换 ----------

function replaceBlock(readme, blockContent) {
  const startIdx = readme.indexOf(START_MARK);
  const endIdx = readme.indexOf(END_MARK);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { ok: false, readme };
  }
  const before = readme.slice(0, startIdx) + START_MARK;
  const after = END_MARK + readme.slice(endIdx + END_MARK.length);
  return { ok: true, readme: `${before}\n${blockContent}\n${after}` };
}

function insertBlock(readme, blockContent) {
  const block = `${START_MARK}\n${blockContent}\n${END_MARK}`;
  for (const anchor of ['## 文档导览', '## 贡献', '## License']) {
    const idx = readme.indexOf(anchor);
    if (idx !== -1) return `${readme.slice(0, idx)}${block}\n\n${readme.slice(idx)}`;
  }
  return `${readme.replace(/\n+$/, '')}\n\n${block}\n`;
}

async function mainReadme(opts) {
  const repo = opts.repoRoot || getRepoRoot();
  const inv = await buildInventory(opts);
  const block = renderReadmeBlock(inv);
  const readmePath = path.join(repo, 'README.md');
  let readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  const hasMarkers = readme.includes(START_MARK) && readme.includes(END_MARK);
  const out = hasMarkers ? replaceBlock(readme, block).readme : insertBlock(readme, block);
  atomicWriteSync(readmePath, out);
  console.log(`inventory: README block ${hasMarkers ? 'refreshed' : 'inserted'} (${inv.all.length} capabilities)`);
  return 0;
}

async function mainCheckReadme(opts) {
  const repo = opts.repoRoot || getRepoRoot();
  const inv = await buildInventory(opts);
  const block = renderReadmeBlock(inv);
  const readmePath = path.join(repo, 'README.md');
  if (!fs.existsSync(readmePath)) {
    console.error('inventory: README.md not found');
    return 1;
  }
  const readme = fs.readFileSync(readmePath, 'utf8');
  if (!readme.includes(START_MARK) || !readme.includes(END_MARK)) {
    console.error('inventory: README markers missing — run `node tools/inventory.mjs --readme` first');
    return 1;
  }
  const { ok, readme: expected } = replaceBlock(readme, block);
  if (!ok || expected !== readme) {
    console.error('inventory: README capability block is stale — run `node tools/inventory.mjs --readme`');
    return 1;
  }
  console.log(`inventory: README block up to date (${inv.all.length} capabilities)`);
  return 0;
}

async function mainAll(opts) {
  const inv = await buildInventory(opts);
  console.log(renderDiscoverAll(inv, opts));
  return 0;
}

/** CLI: --readme | --check-readme | --all [--include-drafts] [--repo-root <path>] */
export async function main() {
  const argv = process.argv.slice(2);
  const opts = { repoRoot: process.cwd() };
  if (argv.includes('--include-drafts')) opts.includeDrafts = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo-root' && argv[i + 1]) { opts.repoRoot = argv[i + 1]; i++; }
  }
  const cmd = argv.find((a) => ['--readme', '--check-readme', '--all'].includes(a));
  if (cmd === '--readme') { await mainReadme(opts); return 0; }
  if (cmd === '--check-readme') return await mainCheckReadme(opts);
  if (cmd === '--all') return await mainAll(opts);
  console.error('usage: node tools/inventory.mjs --readme | --check-readme | --all [--include-drafts] [--repo-root <path>]');
  return 2;
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('inventory.mjs');
if (invokedDirect) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
