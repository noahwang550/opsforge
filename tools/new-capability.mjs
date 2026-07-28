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
// Twin: tools/validate.mjs SKELETON_GUARD_EXCLUSIONS — kept in sync deliberately.
// Divergence: validate.mjs also lists `benchmark-report.json` (advisory eval-time
// artifact present at staged+); scaffold/promote paths only ever see draft dirs
// (no benchmark report yet), so it is intentionally omitted here.
const SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json', 'validation-report.json', 'security-report.json', 'eval-report.json', 'interview.md'];
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

  // R29 interview_real_sample_present (methodology §8): verify interview.md real samples
  // before the dir leaves _drafts/. No-op when interview.md absent (legacy caps).
  checkInterviewRealSample(srcPath);

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
// methodology §7.2: opts.phase / opts.builtWithModel / opts.builtAt extend the state
// record (orthogonal to state). Provided values overwrite; absent values are preserved.
export function writeOpsforgeState(destPath, newState, fromState, opts = {}) {
  const statePath = path.join(destPath, '.opsforge-state.json');
  let state = { state: newState, history: [] };
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch { /* fresh */ }
  }
  const prevPhase = state.phase;
  state.state = newState;
  if (opts.phase !== undefined) state.phase = opts.phase;
  if (opts.builtWithModel !== undefined) state.built_with_model = opts.builtWithModel;
  if (opts.builtAt !== undefined) state.built_at = opts.builtAt;
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({
    ts: new Date().toISOString(),
    from: fromState,
    to: newState,
    pr: null,
    ...(opts.phase !== undefined ? { phase: { from: prevPhase ?? null, to: opts.phase } } : {}),
  });
  // P1-5: use shared atomic write (§5.1, crash-safe)
  atomicWriteSync(statePath, JSON.stringify(state, null, 2));
}

// Local H2 section extractor (mirrors validate.mjs extractH2Section; not imported to keep
// new-capability.mjs dependency-light for the promote path).
function extractH2SectionLocal(text, heading) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  let capturing = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (capturing) break;
      if (line.slice(3).trim() === heading) capturing = true;
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join('\n').trim();
}

// R29 interview_real_sample_present (methodology §8). Runs at promote() / promoteCase()
// — NOT in validate.mjs. Verifies _drafts/<slug>/interview.md "## 真实样本" 正例:
// input non-empty non __FILL_ME__; source:real requires resolvable ref (file path OR
// ID/hash format); .opsforge-state.json phase legality. No-op when interview.md absent
// (legacy caps without the new methodology — R29 is opt-in via interview.md presence).
const VALID_PHASES = ['interview_done', 'distill_done', 'v0.1_built', 'iteration_converged', 'iteration_capped'];
export function checkInterviewRealSample(srcPath) {
  const interviewPath = path.join(srcPath, 'interview.md');
  if (!fs.existsSync(interviewPath)) return; // no interview record → R29 n/a
  let raw;
  try { raw = fs.readFileSync(interviewPath, 'utf8'); } catch { return; }
  const sampleSec = extractH2SectionLocal(raw, '真实样本');
  if (!sampleSec) return;
  const lines = sampleSec.split(/\r?\n/).filter((l) => /^\s*-\s*正例/.test(l));
  for (const line of lines) {
    const inM = line.match(/input:\s*(.*?)(?:\s+产出:|\s+source:|\s+降级\/产出:|\s+失败返回:|$)/);
    const inputVal = inM ? inM[1].trim() : '';
    if (!inputVal || inputVal === '__FILL_ME__') {
      throw new Error('R29 interview_real_sample_present: 正例 input empty or __FILL_ME__');
    }
    const srcM = line.match(/source:\s*(\S+)/);
    const src = srcM ? srcM[1].trim() : '';
    if (src === 'real') {
      const refM = line.match(/ref:\s*([^\s]+)/);
      const ref = refM ? refM[1].trim() : '';
      if (!ref || ref === '__FILL_ME__') {
        throw new Error('R29 interview_real_sample_present: source:real requires a resolvable ref');
      }
      const exists = fs.existsSync(ref) || fs.existsSync(path.join(srcPath, ref));
      const idFmt = /^[a-zA-Z0-9_:-]{4,}$/.test(ref);
      if (!exists && !idFmt) {
        throw new Error(`R29 interview_real_sample_present: ref "${ref}" not resolvable (not a file path nor ID/hash format)`);
      }
    }
  }
  // phase legality
  const statePath = path.join(srcPath, '.opsforge-state.json');
  if (fs.existsSync(statePath)) {
    let st;
    try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { st = null; }
    if (st && st.phase !== undefined && st.phase !== null && !VALID_PHASES.includes(st.phase)) {
      throw new Error(`R29 interview_real_sample_present: invalid phase "${st.phase}"`);
    }
  }
}

/**
 * promoteCase(srcPath, caseFile, opts) — single-case promote (methodology §5.4 P1-3).
 * Two gates: ① 良构 (expected non-empty; expect-mode vs quadrant matches R28; soft warn
 * if expected==current-output); ② run-pass (runSuite single-case dry-run; pending in
 * static-only is acceptable — can't hard-verify without a model; only pass:false blocks).
 * On pass, moves the case file to the staged dir's tests/ and writes state phase.
 */
export async function promoteCase(srcPath, caseFile, opts = {}) {
  const posixSrc = toPosix(srcPath);
  if (!posixSrc.includes('/_drafts/')) {
    throw new Error(`promoteCase: path "${posixSrc}" is not under .../_drafts/`);
  }
  if (posixSrc.split('/').some((seg) => seg === '..')) {
    throw new Error(`promoteCase: path "${posixSrc}" must not contain '..' segments`);
  }
  const yaml = (await import('js-yaml')).default;
  const casePath = path.join(srcPath, 'tests', caseFile);
  if (!fs.existsSync(casePath)) {
    throw new Error(`promoteCase: case file not found: ${casePath}`);
  }
  let c;
  try { c = yaml.load(fs.readFileSync(casePath, 'utf8')); }
  catch (e) { throw new Error(`promoteCase: case file unparseable: ${e.message}`); }
  if (!c || !c.name) throw new Error('promoteCase: case missing name');
  // ① 良构检查
  if (c.expected === undefined || c.expected === null || String(c.expected).trim() === '' || String(c.expected).includes('__FILL_ME__')) {
    throw new Error(`promoteCase: ${caseFile} expected empty or __FILL_ME__ (良构 gate)`);
  }
  // R28 expect-mode vs quadrant
  const q = c.quadrant;
  if (q === 'positive' && c.expect === 'exact' && !c.allow_exact_reason) {
    throw new Error(`promoteCase: ${caseFile} positive+exact requires allow_exact_reason (R28)`);
  }
  if ((q === 'negative' || q === 'degradation') && !['llm_judge', 'regex'].includes(c.expect)) {
    throw new Error(`promoteCase: ${caseFile} ${q} expect must be llm_judge|regex (R28)`);
  }
  // R29 (interview.md real sample) — runs before the case leaves _drafts/.
  checkInterviewRealSample(srcPath);
  // ② run-pass check (best-effort: pending/static-only acceptable; only pass:false blocks).
  if (!opts.skipRunPass) {
    let run;
    try {
      const { runSuite } = await import('./test-runner.mjs');
      run = await runSuite(srcPath, { runner: opts.runner || 'static-only', platform: opts.platform || 'claude-code', opsforgeHome: opts.opsforgeHome });
    } catch (e) {
      if (opts.requireRunPass) throw new Error(`promoteCase: run-pass error: ${e.message}`);
      run = null;
    }
    if (run) {
      const v = (run.cases || []).find((x) => x.case === c.name);
      if (v && v.pass === false) {
        throw new Error(`promoteCase: ${caseFile} run-pass failed (${v.mode}): ${v.reason || ''}`);
      }
    }
  }
  // Move case file to staged dir's tests/
  const destDir = path.normalize(posixSrc.replace('/_drafts/', '/_staged/'));
  const destTests = path.join(destDir, 'tests');
  fs.mkdirSync(destTests, { recursive: true });
  const destCase = path.join(destTests, caseFile);
  fs.renameSync(casePath, destCase);
  // write phase if provided
  if (opts.phase) {
    const statePath = path.join(destDir, '.opsforge-state.json');
    let existingState = 'staged';
    if (fs.existsSync(statePath)) {
      try { const st = JSON.parse(fs.readFileSync(statePath, 'utf8')); if (st && st.state) existingState = st.state; } catch { /* keep staged */ }
    }
    writeOpsforgeState(destDir, existingState, null, { phase: opts.phase });
  }
  return { destPath: destCase, capDir: destDir };
}

// ---------- CLI ----------
// Boolean flags take NO value — the next token is a positional arg, not the
// flag's value. Without this set, `--promote-case <srcDir> <caseFile>` would
// consume <srcDir> as the flag value, leaving <caseFile> as positional[0] and
// positional[1]=undefined, which BUG-1 turned into a usage error.
const BOOLEAN_FLAGS = new Set(['promote-case', 'skip-run-pass']);
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        args[key] = true;
        continue;
      }
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
    if (args['promote-case']) {
      // promote-case <srcDir> <caseFile>  (positional args after the flag)
      const positional = args._ || [];
      const srcDir = positional[0] || args.src;
      const caseFile = positional[1] || args.file;
      if (!srcDir || !caseFile) {
        console.error('usage: --promote-case <srcDir> <caseFile>');
        process.exit(1);
      }
      promoteCase(path.resolve(srcDir), caseFile, {
        runner: args.runner, platform: args.platform, opsforgeHome: args.opsforgeHome,
        phase: args.phase, skipRunPass: args['skip-run-pass'],
      }).then((r) => {
        console.log(`moved case: ${r.destPath}`);
        process.exit(0);
      }, (e) => { console.error(e.message); process.exit(1); });
      return;
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
