// tools/new-capability.mjs — 新建能力的唯一合法入口（DESIGN.md §2.7 / §6 CLI 契约）。
// 手写 process.argv 解析，不引入新依赖（§C.1）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES = path.resolve(__dirname, '..', 'templates');

const VALID_KINDS = ['agent', 'skill', 'mcp', 'workflow', 'bundle', 'brand-draft', 'profile'];

// slug/name/brand 命名规则（与 AGENTS.md §10、validate.mjs R4 一致）。
// scaffold 用此校验防止路径穿越：slug/name/brand 会拼进 destPath，若含 '/' 或 '..'
// 可写到 _drafts 之外（§C.4 路径守卫的运行时补充）。
const NAME_RE = /^[a-z][a-z0-9-]{2,30}$/;

// §5.5: .opsforge-state.json + report artifacts are runtime overlays, excluded from
// skeleton signature matching. Phase 2.2 adds eval-report.json (3rd CI artifact).
const SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json', 'validation-report.json', 'security-report.json', 'eval-report.json'];
function validateSlug(value, label) {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new Error(`scaffold: ${label} "${value}" does not match ^[a-z][a-z0-9-]{2,30}$`);
  }
}

function toPosix(p) { return p.split(path.sep).join('/'); }

function walkFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  out.sort();
  return out;
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

function replaceInDir(dir, map) {
  for (const rel of walkFiles(dir)) {
    const full = path.join(dir, rel);
    let s = fs.readFileSync(full, 'utf8');
    for (const [k, v] of Object.entries(map)) s = s.split(k).join(v);
    fs.writeFileSync(full, s);
  }
}

/**
 * matchSkeletonSignature(dir, kind, opts) — §6 签名比对算法（exact match）。
 * 返回 { match, expected, actual, missing, extra }。
 */
export function matchSkeletonSignature(dir, kind, opts = {}) {
  const tDir = path.join(opts.templatesDir || DEFAULT_TEMPLATES, kind);
  const expected = walkFiles(tDir);
  const actual = walkFiles(dir).filter((f) => !SKELETON_GUARD_EXCLUSIONS.includes(f));
  const expSet = new Set(expected);
  const actSet = new Set(actual);
  const missing = expected.filter((f) => !actSet.has(f));
  const extra = actual.filter((f) => !expSet.has(f));
  return { match: missing.length === 0 && extra.length === 0, expected, actual, missing, extra };
}

/**
 * scaffold({ kind, slug, name, brand, thirdParty, root, templatesDir })
 * → { destPath, prTitle }。从 templates/<kind>/ 拷贝到 _drafts/，替换占位符。
 */
export function scaffold({ kind = 'agent', slug, name, brand, thirdParty, root = process.cwd(), templatesDir = DEFAULT_TEMPLATES }) {
  if (!name) throw new Error('scaffold: --name is required');
  if (!VALID_KINDS.includes(kind)) throw new Error(`scaffold: invalid kind "${kind}"`);
  // 命名校验 = 路径穿越防御：name/slug/brand 会拼进 destPath，必须命中 NAME_RE。
  validateSlug(name, 'name');
  if (slug) validateSlug(slug, 'slug');
  if (brand) validateSlug(brand, 'brand');

  let templateKind = kind;
  let destPath;
  let prTitle;
  const map = {};

  if (thirdParty) {
    // D7: intake relocated to packs/_drafts/third-party/<name>/ so --promote can
    // migrate it (the path now contains /_drafts/, which promote() requires).
    // The old packs/_third-party/ path lacked /_drafts/ and was un-promotable.
    templateKind = kind;
    destPath = path.join(root, 'packs', '_drafts', 'third-party', name);
    if (!slug) slug = 'third-party';
    map.__SLUG__ = slug;
    map.__NAME__ = name;
    map.__BRAND_SLUG__ = brand || slug;
    prTitle = `[intake] third-party/${name}`;
  } else if (brand) {
    // 品牌：customers/<brand>/packs/_drafts/<brand>/<name>/
    destPath = path.join(root, 'customers', brand, 'packs', '_drafts', brand, name);
    map.__BRAND_SLUG__ = brand;
    map.__NAME__ = name;
    if (kind === 'agent') {
      templateKind = 'brand-draft'; // §3.6 品牌草稿骨架
    } else {
      // 非品牌骨架实体（D5）：用对应模板 + 运行时注入 customer 字段
      templateKind = kind;
    }
    map.__SLUG__ = brand;
    prTitle = `[draft-brand] ${brand}.${name}`;
  } else {
    // 通用：packs/_drafts/<slug>/<name>/
    if (!slug) throw new Error('scaffold: --slug is required (or use --brand / --third-party)');
    destPath = path.join(root, 'packs', '_drafts', slug, name);
    map.__SLUG__ = slug;
    map.__NAME__ = name;
    map.__BRAND_SLUG__ = slug;
    prTitle = `[draft] ${slug}.${name}`;
  }

  const srcTemplate = path.join(templatesDir, templateKind);
  if (!fs.existsSync(srcTemplate)) throw new Error(`scaffold: template "${templateKind}" not found`);

  if (fs.existsSync(destPath)) throw new Error(`scaffold: dest already exists: ${destPath}`);
  fs.mkdirSync(destPath, { recursive: true });
  copyDir(srcTemplate, destPath);
  replaceInDir(destPath, map);

  // 品牌非 agent 变体：注入 customer 字段（D5 运行时支持）
  if (brand && kind !== 'agent' && !thirdParty) {
    injectCustomer(destPath, brand, kind);
  }

  // third-party：置 source.origin=forked + upstream_ref
  if (thirdParty) {
    setOriginForked(destPath, kind, thirdParty);
  }

  // §22.10: write .opsforge-state.json (runtime overlay, excluded from skeleton_guard)
  writeOpsforgeState(destPath, 'draft', null);

  return { destPath, prTitle };
}

// 向 brand 非 agent 的 manifest 注入 customer 行。
function injectCustomer(destPath, brand, kind) {
  const manifestFile = manifestForKind(kind);
  const p = path.join(destPath, manifestFile);
  let s = fs.readFileSync(p, 'utf8');
  if (/^customer:/m.test(s)) return; // 已有
  // 在 owner 行后插入 customer
  s = s.replace(/^(owner: .*)$/m, `$1\ncustomer: ${brand}`);
  fs.writeFileSync(p, s);
}

function manifestForKind(kind) {
  switch (kind) {
    case 'agent': case 'brand-draft': return 'capability.yaml';
    case 'skill': return 'SKILL.md';
    case 'mcp': return 'mcp.yaml';
    case 'workflow': return 'workflow.yaml';
    case 'bundle': return 'bundle.yaml';
    default: throw new Error(`unknown kind ${kind}`);
  }
}

function setOriginForked(destPath, kind, upstream) {
  const manifestFile = manifestForKind(kind);
  const p = path.join(destPath, manifestFile);
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/(source:\s*\n\s*origin: )original/, `$1forked`);
  s = s.replace(/(upstream_ref: )null/, `$1${upstream}`);
  fs.writeFileSync(p, s);
}

/**
 * promote(srcPath, opts) → { destPath }。_drafts/ → _staged/ 迁移（§6 --promote）。
 * 禁止手移；promote 前校验骨架签名；不修改 frontmatter。
 */
export function promote(srcPath, opts = {}) {
  const tDir = opts.templatesDir || DEFAULT_TEMPLATES;
  const posixSrc = toPosix(srcPath);
  if (!posixSrc.includes('/_drafts/')) {
    throw new Error(`promote: path "${posixSrc}" is not under .../_drafts/`);
  }
  // 防止 dest 路径穿越：/_drafts/ 之后的 '..' 段会让 replace 后的 _staged 目标逃出 _staged/。
  if (posixSrc.split('/').some((seg) => seg === '..')) {
    throw new Error(`promote: path "${posixSrc}" must not contain '..' segments`);
  }
  // 推断 kind（从 manifest 文件名）
  const kind = detectKindFromDir(srcPath);
  if (!kind) throw new Error('promote: cannot determine kind from manifest');

  const sig = matchSkeletonSignature(srcPath, kind, { templatesDir: tDir });
  if (!sig.match) {
    throw new Error(`promote: skeleton signature mismatch (missing=[${sig.missing.join(', ')}], extra=[${sig.extra.join(', ')}]); dir was hand-modified, not generated by new-capability.mjs`);
  }

  const destPath = posixSrc.replace('/_drafts/', '/_staged/');
  const dest = path.normalize(destPath);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    throw new Error(`promote: target already exists and is non-empty: ${dest}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(srcPath, dest);

  // §22.10: update .opsforge-state.json on promote
  writeOpsforgeState(dest, 'staged', 'draft');

  return { destPath: dest };
}

const MANIFEST_FILES = ['capability.yaml', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml', 'SKILL.md'];
const MANIFEST_KIND = {
  'capability.yaml': 'agent',
  'SKILL.md': 'skill',
  'mcp.yaml': 'mcp',
  'workflow.yaml': 'workflow',
  'bundle.yaml': 'bundle',
};
function detectKindFromDir(dir) {
  for (const f of MANIFEST_FILES) {
    if (fs.existsSync(path.join(dir, f))) return MANIFEST_KIND[f];
  }
  return null;
}

// §22.10: write/update .opsforge-state.json (runtime overlay, excluded from skeleton_guard).
function writeOpsforgeState(destPath, newState, fromState) {
  const statePath = path.join(destPath, '.opsforge-state.json');
  let state = { state: newState, history: [] };
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch { /* fresh */ }
  }
  state.state = newState;
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({
    ts: new Date().toISOString(),
    from: fromState,
    to: newState,
    pr: null,
  });
  // P1-5: use shared atomic write (§5.1, crash-safe)
  atomicWriteSync(statePath, JSON.stringify(state, null, 2));
}

// ---------- CLI ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.promote) {
      const { destPath, prTitle } = doPromote(args.promote);
      console.log(`moved: ${destPath}`);
      if (prTitle) console.log(`pr-title: ${prTitle}`);
      process.exit(0);
    }
    const kind = args.kind || 'agent';
    const slug = args.slug;
    const name = args.name;
    const brand = args.brand;
    const thirdParty = args['third-party'];
    if (!name) { console.error('error: --name is required'); process.exit(1); }
    if (!slug && !brand && !thirdParty) { console.error('error: --slug (or --brand / --third-party) is required'); process.exit(1); }
    const { destPath, prTitle } = scaffold({ kind, slug, name, brand, thirdParty });
    console.log(`created: ${destPath}`);
    console.log(`next: node tools/validate.mjs ${destPath}`);
    console.log(`pr-title: ${prTitle}`);
    process.exit(0);
  } catch (e) {
    console.error(`${e.message}`);
    process.exit(1);
  }
}

function doPromote(src) {
  const { destPath } = promote(path.resolve(src));
  const posix = toPosix(destPath);
  const isBrand = posix.includes('/customers/');
  const name = path.basename(destPath);
  const parent = path.basename(path.dirname(destPath));
  const prTitle = isBrand ? `[stage-brand] ${parent}.${name}` : `[stage] ${parent}.${name}`;
  return { destPath, prTitle };
}

// 直接运行入口。
if (process.argv[1] && process.argv[1].endsWith('new-capability.mjs')) {
  main();
}
