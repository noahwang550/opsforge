// tools/validate.mjs — 本地一行自检 + CI 校验（DESIGN.md §2.6 / §5 规则矩阵）。
// 纯函数便于测试；main() 为 CLI 入口。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import yaml from 'js-yaml';
import semver from 'semver';
import { atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 可被测试覆盖的根/模板目录（默认指向真实仓库结构）。
let repoRoot = null;
let templatesDir = path.resolve(__dirname, '..', 'templates');
let schemaPath = path.resolve(__dirname, '..', 'schema', 'capability.schema.json');

/** 测试用：设置仓库根目录（影响 id_unique / depends_on / validateAll 扫描）。 */
export function setRepoRoot(p) { repoRoot = p; }
/** 测试用：设置 templates 目录（影响 skeleton_guard / entry_guard 签名比对）。 */
export function setTemplatesDir(p) { templatesDir = p; }
/** 测试用：设置 schema 路径。 */
export function setSchemaPath(p) { schemaPath = p; }

const NAME_RE = /^[a-z][a-z0-9-]{2,30}$/;
const PLACEHOLDER_TOKENS = ['__FILL_ME__', 'TODO', 'FIXME'];

// §5.5 .opsforge-state.json + report artifacts skeleton-guard exclusion — runtime overlays.
// Phase 2.2: eval-report.json is the 3rd CI artifact (§21.4), also excluded.
// Phase 4 P1-D: benchmark-report.json is advisory (not in release gate) but must be
// excluded from skeleton_guard to avoid R8 false positive.
// Twin: tools/new-capability.mjs SKELETON_GUARD_EXCLUSIONS — kept in sync deliberately
// (that copy omits `benchmark-report.json` because scaffold/promote only see draft dirs).
// Phase 4 fix: upstream-ref.json — intake.mjs writes it into every --third-party draft
// after scaffold; without the exclusion R15 entry_guard / R8 skeleton_guard false-positive
// on every intaked third-party capability.
const SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json', 'validation-report.json', 'security-report.json', 'eval-report.json', 'benchmark-report.json', 'interview.md', 'upstream-ref.json'];
/** Test hook: returns the current exclusions list (read-only snapshot). */
export function SKELETON_GUARD_EXCLUSIONS_GET() {
  return [...SKELETON_GUARD_EXCLUSIONS];
}

// ---------- 工具 ----------
function toPosix(p) { return p.split(path.sep).join('/'); }

function readText(p) { return fs.readFileSync(p, 'utf8'); }

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

function getRepoRoot() {
  if (repoRoot) return repoRoot;
  // 从 cwd 向上找含 templates/ 的目录，兜底 cwd。
  let cur = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(cur, 'templates')) || fs.existsSync(path.join(cur, 'package.json'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

// ---------- manifest 发现 ----------
const MANIFEST_FILES = ['capability.yaml', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml', 'SKILL.md'];
const MANIFEST_KIND = {
  'capability.yaml': 'agent',
  'SKILL.md': 'skill',
  'mcp.yaml': 'mcp',
  'workflow.yaml': 'workflow',
  'bundle.yaml': 'bundle',
};

function findManifest(dir) {
  for (const f of MANIFEST_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function extractFrontmatter(raw) {
  // SKILL.md / source.md：取首对 --- 之间的 YAML。
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/**
 * 解析能力目录。返回 { yaml, rawYaml, path, state, kind, manifestFile, dir, parseError }。
 * state: 'draft' | 'staged'。kind: yaml.kind 或 manifest 推断。
 */
export function parseCapability(dir) {
  const manifest = findManifest(dir);
  if (!manifest) {
    return { dir, path: null, rawYaml: '', yaml: null, state: detectState(dir), kind: null, manifestFile: null, parseError: 'no manifest file found' };
  }
  const manifestFile = path.basename(manifest);
  let raw = readText(manifest);
  let rawYaml = raw;
  if (manifestFile === 'SKILL.md') {
    const fm = extractFrontmatter(raw);
    rawYaml = fm === null ? raw : fm;
  }
  let parsed = null;
  let parseError = null;
  try {
    parsed = yaml.load(rawYaml, { filename: manifest });
  } catch (e) {
    parseError = e.message;
  }
  const state = detectState(dir);
  const kind = parsed && parsed.kind ? parsed.kind : (MANIFEST_KIND[manifestFile] || null);
  return { dir, path: manifest, rawYaml, yaml: parsed, state, kind, manifestFile, parseError };
}

function detectState(dir) {
  const p = toPosix(dir);
  if (p.includes('/_drafts/')) return 'draft';
  if (p.includes('/_staged/')) return 'staged';
  // 兜底：无显式 state 段视为 staged（最严格）。
  return 'staged';
}

// ---------- 各 check（DESIGN.md §5 规则矩阵）----------

// D7: third-party intake relocated from packs/_third-party/ to packs/_drafts/third-party/
// (and packs/_staged/third-party/ after promote). Detect via the `third-party` path segment
// (covers both new _drafts/_staged locations and the legacy _third-party dir).
function isThirdPartyPath(p) {
  const posix = toPosix(p);
  return posix.split('/').some((seg) => seg === 'third-party' || seg === '_third-party');
}

// R2 yaml_parse
function checkYamlParse(cap) {
  if (cap.parseError) {
    return { name: 'yaml_parse', status: 'fail', detail: `yaml_parse: ${relPath(cap.path)} is not valid YAML: ${cap.parseError}` };
  }
  return { name: 'yaml_parse', status: 'pass', detail: '' };
}

// R1 schema
let _ajv = null;
function getValidator() {
  if (_ajv) return _ajv;
  const schema = JSON.parse(readText(schemaPath));
  const ajv = new Ajv({ allErrors: true, strict: false });
  _ajv = ajv.compile(schema);
  return _ajv;
}
export function checkSchema(cap) {
  const validator = getValidator();
  const ok = validator(cap.yaml);
  if (ok) return { name: 'schema', status: 'pass', detail: '' };
  const first = validator.errors[0];
  const ep = first.instancePath || '';
  const msg = `${first.keyword}: ${first.message}`;
  return { name: 'schema', status: 'fail', detail: `schema: ${relPath(cap.path)} failed AJV: ${ep} ${msg}` };
}

// R8 skeleton_guard
export function checkSkeletonGuard(cap) {
  const kind = cap.kind;
  const tmplDir = path.join(templatesDir, kind);
  const expected = walkFiles(tmplDir);
  const actual = walkFiles(cap.dir).filter((f) => !SKELETON_GUARD_EXCLUSIONS.includes(f));
  const expSet = new Set(expected);
  const actSet = new Set(actual);
  const missing = expected.filter((f) => !actSet.has(f));
  const extra = actual.filter((f) => !expSet.has(f));
  if (missing.length === 0 && extra.length === 0) {
    return { name: 'skeleton_guard', status: 'pass', detail: '' };
  }
  return { name: 'skeleton_guard', status: 'fail', detail: `skeleton_guard: file set mismatch; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]` };
}

// R15 entry_guard（draft 入口守卫）
// 宽松签名匹配：draft 允许"缺文件"（草稿进行中），但出现骨架外"多余文件"即视为手建。
export function checkEntryGuard(cap) {
  const kinds = fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const actual = walkFiles(cap.dir).filter((f) => !SKELETON_GUARD_EXCLUSIONS.includes(f));
  const actSet = new Set(actual);
  let matched = null;
  for (const k of kinds) {
    const expected = walkFiles(path.join(templatesDir, k));
    const expSet = new Set(expected);
    const extra = actual.filter((f) => !expSet.has(f));
    if (extra.length === 0) { matched = k; break; }
  }
  if (matched !== null) return { name: 'entry_guard', status: 'pass', detail: '' };
  return { name: 'entry_guard', status: 'fail', detail: `entry_guard: "${relPath(cap.dir)}" not generated by new-capability.mjs (no template signature match)` };
}

// R7 placeholder_clean
// opts.manifestOnly: drafts only enforce it in the manifest (the business fields the
// author owns); body/CHANGELOG/tests placeholders in drafts are the working state
// (scaffold ships them with __FILL_ME__) and stay enforced at staged+.
export function checkPlaceholder(cap, opts = {}) {
  const files = opts.manifestOnly && cap.manifestFile
    ? [cap.path]
    : walkFiles(cap.dir).map((f) => path.join(cap.dir, f));
  for (const full of files) {
    const lines = readText(full).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const tok of PLACEHOLDER_TOKENS) {
        if (lines[i].includes(tok)) {
          return { name: 'placeholder_clean', status: 'fail', detail: `placeholder_clean: ${relPath(full)}:${i + 1} contains placeholder "${tok}"` };
        }
      }
    }
  }
  return { name: 'placeholder_clean', status: 'pass', detail: '' };
}

// R4 naming
export function checkNaming(cap) {
  const y = cap.yaml;
  const pack = y.pack || '';
  const name = path.basename(cap.dir);
  if (!NAME_RE.test(pack)) {
    return { name: 'naming', status: 'fail', detail: `naming: "${pack}" does not match ^[a-z][a-z0-9-]{2,30}$` };
  }
  if (!NAME_RE.test(name)) {
    return { name: 'naming', status: 'fail', detail: `naming: "${name}" does not match ^[a-z][a-z0-9-]{2,30}$` };
  }
  const expectedId = `${pack}.${name}`;
  if (y.id !== expectedId) {
    return { name: 'naming', status: 'fail', detail: `naming: id "${y.id}" != "${expectedId}"` };
  }
  return { name: 'naming', status: 'pass', detail: '' };
}

// R9 engineering_fields_untampered
export function checkEngineeringFieldsUntampered(cap) {
  const y = cap.yaml;
  const name = path.basename(cap.dir);
  const posixDir = toPosix(cap.dir);
  const isDraftOrStaged = posixDir.includes('/_drafts/') || posixDir.includes('/_staged/') || posixDir.includes('/_third-party/');
  // D7: third-party detection via path segment (covers _drafts/third-party + legacy _third-party).
  const isThirdParty = isThirdPartyPath(posixDir);
  // Draft/staged: packs/_drafts/<pack>/<name> → parent = <pack>
  // Formal: packs/<pack>/<kind>/<name> → parent = <kind>, pack = grandparent
  const parentName = isDraftOrStaged
    ? path.basename(path.dirname(cap.dir))
    : path.basename(path.dirname(path.dirname(cap.dir)));
  const expected = {
    id: `${y.pack}.${name}`,
    kind: MANIFEST_KIND[cap.manifestFile] || y.kind,
    pack: parentName,
    tests: 'tests/',
    changelog: 'CHANGELOG.md',
  };
  // entrypoint 按 kind 期望
  const expKind = expected.kind;
  if (['agent', 'mcp'].includes(expKind)) expected.entrypoint = 'source.md';
  else if (expKind === 'skill') expected.entrypoint = 'SKILL.md';
  // source.origin — isThirdParty declared above (D7 path-segment detection).
  expected['source.origin'] = isThirdParty ? 'forked' : 'original';

  const flat = {
    id: y.id,
    kind: y.kind,
    pack: y.pack,
    entrypoint: y.entrypoint,
    tests: y.tests,
    changelog: y.changelog,
    'source.origin': y.source && y.source.origin,
  };
  for (const field of Object.keys(expected)) {
    const exp = expected[field];
    const got = flat[field];
    if (exp !== got) {
      return { name: 'engineering_fields_untampered', status: 'fail', detail: `engineering_fields_untampered: field "${field}" expected "${exp}" got "${got}"` };
    }
  }
  return { name: 'engineering_fields_untampered', status: 'pass', detail: '' };
}

// R5 version_lock
export function checkVersionLock(cap) {
  const v = cap.yaml.version;
  if (v !== '0.1.0') {
    return { name: 'version_lock', status: 'fail', detail: `version_lock: draft version must be 0.1.0, got "${v}"` };
  }
  return { name: 'version_lock', status: 'pass', detail: '' };
}

// R6 version_semver
function checkVersionSemver(cap) {
  const v = cap.yaml.version;
  if (!semver.valid(v)) {
    return { name: 'version_semver', status: 'fail', detail: `version_semver: "${v}" is not valid semver` };
  }
  return { name: 'version_semver', status: 'pass', detail: '' };
}

// R10 display_names_i18n
function checkDisplayNamesI18n(cap) {
  const y = cap.yaml;
  for (const f of ['display_name_zh', 'display_name_en']) {
    if (!y[f] || String(y[f]).trim() === '') {
      return { name: 'display_names_i18n', status: 'fail', detail: `display_names_i18n: ${f} is empty` };
    }
  }
  return { name: 'display_names_i18n', status: 'pass', detail: '' };
}

// R11 customer_dir_consistency
function checkCustomerDirConsistency(cap) {
  const y = cap.yaml;
  const customer = y.customer;
  if (!customer) return { name: 'customer_dir_consistency', status: 'pass', detail: '' };
  const p = toPosix(cap.dir);
  const expectedSeg = `customers/${customer}/`;
  if (!p.includes(expectedSeg)) {
    return { name: 'customer_dir_consistency', status: 'fail', detail: `customer_dir_consistency: customer "${customer}" but path "${p}" not under customers/${customer}/` };
  }
  if (!y.pack || !y.pack.startsWith(customer)) {
    return { name: 'customer_dir_consistency', status: 'fail', detail: `customer_dir_consistency: pack "${y.pack}" must start with "${customer}"` };
  }
  return { name: 'customer_dir_consistency', status: 'pass', detail: '' };
}

// R3 id_unique（需仓内全量 caps）
function checkIdUnique(cap, allCaps) {
  const id = cap.yaml && cap.yaml.id;
  if (!id) return { name: 'id_unique', status: 'pass', detail: '' };
  const dup = allCaps.find((c) => c.yaml && c.yaml.id === id && toPosix(c.dir) !== toPosix(cap.dir));
  if (dup) {
    return { name: 'id_unique', status: 'fail', detail: `id_unique: id "${id}" duplicated at ${relPath(dup.dir)}` };
  }
  return { name: 'id_unique', status: 'pass', detail: '' };
}

// R14 tests_min
function checkTestsMin(cap) {
  const testsDir = path.join(cap.dir, 'tests');
  if (!fs.existsSync(testsDir)) {
    return { name: 'tests_min', status: 'fail', detail: `tests_min: expected >=3 test cases, got 0` };
  }
  const n = fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).length;
  if (n < 3) {
    return { name: 'tests_min', status: 'fail', detail: `tests_min: expected >=3 test cases, got ${n}` };
  }
  return { name: 'tests_min', status: 'pass', detail: '' };
}

// R12 depends_on_resolvable
function checkDependsOnResolvable(cap, allCaps) {
  const y = cap.yaml;
  const deps = y.depends_on || [];
  const ids = new Set(allCaps.filter((c) => c.yaml && c.yaml.id).map((c) => c.yaml.id));
  for (const dep of deps) {
    const base = dep.split('@')[0];
    if (!ids.has(base)) {
      return { name: 'depends_on_resolvable', status: 'fail', detail: `depends_on_resolvable: "${dep}" unresolvable` };
    }
  }
  return { name: 'depends_on_resolvable', status: 'pass', detail: '' };
}

// R13 depends_on_direction
function classifyCap(cap) {
  // D7: detect third-party via source.origin=forked (set by intake scaffold) first,
  // falling back to the legacy /_third-party/ path segment. Covers the relocated
  // packs/_drafts/third-party/ and packs/_staged/third-party/ locations.
  if (cap.yaml && cap.yaml.source && cap.yaml.source.origin === 'forked') return 'third-party';
  const p = toPosix(cap.dir);
  if (isThirdPartyPath(p)) return 'third-party';
  if (p.includes('/customers/')) {
    const m = p.match(/\/customers\/([^/]+)\//);
    return m ? { kind: 'brand', brand: m[1] } : 'brand';
  }
  return 'general';
}
function classifyDep(dep, allCaps) {
  const base = dep.split('@')[0];
  const target = allCaps.find((c) => c.yaml && c.yaml.id === base);
  if (!target) return 'unknown';
  return classifyCap(target);
}
function checkDependsOnDirection(cap, allCaps) {
  const y = cap.yaml;
  const deps = y.depends_on || [];
  const selfClass = classifyCap(cap);
  for (const dep of deps) {
    const depClass = classifyDep(dep, allCaps);
    let ok = false;
    let reason = '';
    if (selfClass === 'third-party') { ok = deps.length === 0; reason = 'third-party may not depend on anything'; }
    else if (typeof selfClass === 'object' && selfClass.kind === 'brand') {
      const brand = selfClass.brand;
      if (depClass === 'general' || depClass === 'third-party') ok = true;
      else if (typeof depClass === 'object' && depClass.kind === 'brand' && depClass.brand === brand) ok = true;
      else reason = `brand ${brand} may only depend on general/third-party/same-brand, got ${JSON.stringify(depClass)}`;
    } else if (selfClass === 'general') {
      if (depClass === 'general' || depClass === 'third-party') ok = true;
      else reason = `general may only depend on general/third-party, got ${JSON.stringify(depClass)}`;
    }
    if (!ok) {
      return { name: 'depends_on_direction', status: 'fail', detail: `depends_on_direction: "${dep}" violates direction (${reason})` };
    }
  }
  return { name: 'depends_on_direction', status: 'pass', detail: '' };
}

// checkDraftRelaxed：draft 子集（DESIGN §2.6 导出）
export function checkDraftRelaxed(cap, ctx = {}) {
  const allCaps = ctx.allCaps || scanCapabilities(ctx.repoRoot || getRepoRoot());
  const checks = [];
  checks.push(checkYamlParse(cap));
  if (cap.parseError) {
    // entry_guard (R15) only needs the file set, not the YAML manifest. A purely
    // hand-made _drafts/ dir with no manifest is exactly the §7 T13 scenario and
    // must surface the entry_guard message, not be suppressed by yaml_parse.
    checks.push(checkEntryGuard(cap));
    return checks;
  }
  checks.push(checkIdUnique(cap, allCaps));
  checks.push(checkVersionLock(cap));
  checks.push(checkPlaceholder(cap, { manifestOnly: true }));
  checks.push(checkDisplayNamesI18n(cap));
  checks.push(checkCustomerDirConsistency(cap));
  checks.push(checkEntryGuard(cap));
  return checks;
}

// ---------- §21.7 anti-vacuous guards (staged-only) + v7 workflow rules ----------

// Body extraction: for agent/skill/mcp, read entrypoint body after frontmatter.
// For workflow/bundle, use description as body proxy (no entrypoint).
function getBody(cap) {
  const y = cap.yaml;
  if (!y) return '';
  if (['agent', 'skill', 'mcp'].includes(y.kind) && y.entrypoint) {
    const epPath = path.join(cap.dir, y.entrypoint);
    if (fs.existsSync(epPath)) {
      const raw = readText(epPath);
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      return m ? m[2].trim() : raw.trim();
    }
  }
  return y.description || '';
}

// Count body substance: Chinese chars + English words (≥2 letters).
function countBodyTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const enWords = (text.match(/[a-zA-Z]{2,}/g) || []).length;
  return cjk + enWords;
}

const BODY_MIN_THRESHOLDS = { agent: 150, skill: 100, mcp: 80 };

// R16 body_min_substance
export function checkBodyMinSubstance(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'body_min_substance', status: 'pass', detail: '' };
  const min = BODY_MIN_THRESHOLDS[y.kind];
  if (min === undefined) return { name: 'body_min_substance', status: 'pass', detail: '' };
  const body = getBody(cap);
  const count = countBodyTokens(body);
  if (count < min) {
    return { name: 'body_min_substance', status: 'fail', detail: `body_min_substance: body has ${count} tokens, need ≥${min} for kind "${y.kind}"` };
  }
  return { name: 'body_min_substance', status: 'pass', detail: '' };
}

// R17 body_not_boilerplate
const BOILERPLATE_PATTERNS = [
  /^\s*(return|echo|返回|输出)\s+(expected|the\s+expected|测试用例的)\b/i,
  /^\s*__FILL_ME__\s*$/,
  /^this\s+is\s+a\s+test\s*\.?$/i,
];

export function checkBodyNotBoilerplate(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'body_not_boilerplate', status: 'pass', detail: '' };
  if (!['agent', 'skill', 'mcp'].includes(y.kind)) return { name: 'body_not_boilerplate', status: 'pass', detail: '' };
  const body = getBody(cap).trim();
  if (body.length === 0) return { name: 'body_not_boilerplate', status: 'pass', detail: '' };
  for (const pat of BOILERPLATE_PATTERNS) {
    if (pat.test(body)) {
      return { name: 'body_not_boilerplate', status: 'fail', detail: `body_not_boilerplate: body matches boilerplate pattern ${pat}` };
    }
  }
  // description-body ≥80% overlap
  const desc = (y.description || '').trim();
  if (desc.length > 0 && body.length > 0) {
    const shorter = body.length <= desc.length ? body : desc;
    const longer = body.length <= desc.length ? desc : body;
    if (shorter.length > 10 && longer.includes(shorter)) {
      const ratio = shorter.length / longer.length;
      if (ratio >= 0.8) {
        return { name: 'body_not_boilerplate', status: 'fail', detail: `body_not_boilerplate: body-vs-description overlap ≥80% (${(ratio * 100).toFixed(0)}%)` };
      }
    }
  }
  return { name: 'body_not_boilerplate', status: 'pass', detail: '' };
}

// Read all test cases for a capability.
function readTestCases(cap) {
  const testsDir = path.join(cap.dir, 'tests');
  if (!fs.existsSync(testsDir)) return [];
  const cases = [];
  for (const f of fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).sort()) {
    try {
      const parsed = yaml.load(readText(path.join(testsDir, f)), { filename: f });
      if (parsed) cases.push({ file: f, ...parsed });
    } catch { /* skip unparseable */ }
  }
  return cases;
}

const EXPECT_BLACKLIST = new Set(['ok', 'true', 'pass', 'success', 'yes', 'done', 'ok.']);

// R18 test_expect_nontrivial
export function checkTestExpectNontrivial(cap) {
  const cases = readTestCases(cap);
  for (const c of cases) {
    const exp = c.expect;
    if (exp === 'llm_judge') {
      const rubric = c.judge_rubric || '';
      if (typeof rubric !== 'string' || rubric.length < 20) {
        return { name: 'test_expect_nontrivial', status: 'fail', detail: `test_expect_nontrivial: ${c.file} llm_judge requires judge_rubric ≥20 chars, got ${rubric.length}` };
      }
    }
    // Phase 4 P1-B: expect=check requires expected to be a non-empty object.
    if (exp === 'check') {
      if (!c.expected || typeof c.expected !== 'object' || Array.isArray(c.expected) || Object.keys(c.expected).length === 0) {
        return { name: 'test_expect_nontrivial', status: 'fail', detail: `test_expect_nontrivial: ${c.file} expect=check requires expected to be a non-empty object` };
      }
    }
    if (c.expected !== undefined && c.expected !== null) {
      const s = String(c.expected);
      if (s.length <= 3) {
        return { name: 'test_expect_nontrivial', status: 'fail', detail: `test_expect_nontrivial: ${c.file} expected too short (${s.length} chars, need >3)` };
      }
      if (EXPECT_BLACKLIST.has(s.toLowerCase().trim())) {
        return { name: 'test_expect_nontrivial', status: 'fail', detail: `test_expect_nontrivial: ${c.file} expected "${s}" is in blacklist` };
      }
    }
    // Phase 4 P0-A: each pre_gate.expected must be non-trivial (same R18 standard).
    if (Array.isArray(c.pre_gates)) {
      for (let i = 0; i < c.pre_gates.length; i++) {
        const g = c.pre_gates[i];
        if (!g || g.expected === undefined || g.expected === null) continue;
        const ge = Array.isArray(g.expected) ? g.expected.join(' ') : String(g.expected);
        if (ge.length <= 3) {
          return { name: 'test_expect_nontrivial', status: 'fail', detail: `test_expect_nontrivial: ${c.file} pre_gates[${i}].expected too short (${ge.length} chars, need >3)` };
        }
        if (EXPECT_BLACKLIST.has(ge.toLowerCase().trim())) {
          return { name: 'test_expect_nontrivial', status: 'fail', detail: `test_expect_nontrivial: ${c.file} pre_gates[${i}].expected "${ge}" is in blacklist` };
        }
      }
    }
  }
  return { name: 'test_expect_nontrivial', status: 'pass', detail: '' };
}

// Phase 4 P0-A: pre_gates structural validity (staged+; sibling to R18).
export function checkPreGatesNontrivial(cap) {
  const cases = readTestCases(cap);
  const VALID_MODES = new Set(['contains', 'regex', 'exact', 'files_exist']);
  for (const c of cases) {
    if (!Array.isArray(c.pre_gates) || c.pre_gates.length === 0) continue;
    for (let i = 0; i < c.pre_gates.length; i++) {
      const g = c.pre_gates[i];
      if (!g || typeof g !== 'object') {
        return { name: 'pre_gates_nontrivial', status: 'fail', detail: `pre_gates_nontrivial: ${c.file} pre_gates[${i}] not object` };
      }
      if (!VALID_MODES.has(g.mode)) {
        return { name: 'pre_gates_nontrivial', status: 'fail', detail: `pre_gates_nontrivial: ${c.file} pre_gates[${i}].mode "${g.mode}" invalid` };
      }
      if (g.expected === undefined || g.expected === null || g.expected === '') {
        return { name: 'pre_gates_nontrivial', status: 'fail', detail: `pre_gates_nontrivial: ${c.file} pre_gates[${i}].expected empty` };
      }
    }
  }
  return { name: 'pre_gates_nontrivial', status: 'pass', detail: '' };
}

// R19 test_cases_distinct
export function checkTestCasesDistinct(cap) {
  const cases = readTestCases(cap);
  const seen = new Map();
  for (const c of cases) {
    // Phase 4 P1-A: include turns in the distinct key so that two cases with
    // identical (input, expect, expected) but different turns are considered distinct.
    const key = JSON.stringify({ input: c.input, expect: c.expect, expected: c.expected, turns: c.turns || [] });
    if (seen.has(key)) {
      return { name: 'test_cases_distinct', status: 'fail', detail: `test_cases_distinct: ${c.file} duplicates ${seen.get(key)} on (input, expect, expected, turns)` };
    }
    seen.set(key, c.file);
  }
  return { name: 'test_cases_distinct', status: 'pass', detail: '' };
}

// R23 test_turns_well_formed (Phase 4 P1-A; staged+ sibling to R16-R22)
export function checkTurnsWellFormed(cap) {
  const cases = readTestCases(cap);
  for (const c of cases) {
    if (!Array.isArray(c.turns) || c.turns.length === 0) continue;
    for (let i = 0; i < c.turns.length; i++) {
      const t = c.turns[i];
      if (!t || typeof t !== 'object') return { name: 'test_turns_well_formed', status: 'fail', detail: `test_turns_well_formed: ${c.file} turn[${i}] not object` };
      if (!['user', 'assistant'].includes(t.role)) return { name: 'test_turns_well_formed', status: 'fail', detail: `test_turns_well_formed: ${c.file} turn[${i}].role invalid` };
      if (typeof t.content !== 'string' || t.content.length < 1) return { name: 'test_turns_well_formed', status: 'fail', detail: `test_turns_well_formed: ${c.file} turn[${i}].content empty` };
      if (t.post_condition) {
        if (!Array.isArray(t.post_condition.must_contain_any) || t.post_condition.must_contain_any.length === 0) return { name: 'test_turns_well_formed', status: 'fail', detail: `test_turns_well_formed: ${c.file} turn[${i}].post_condition.must_contain_any empty` };
        for (const s of t.post_condition.must_contain_any) {
          if (typeof s !== 'string' || s.length < 3) return { name: 'test_turns_well_formed', status: 'fail', detail: `test_turns_well_formed: ${c.file} turn[${i}] must_contain_any item <3 chars` };
        }
        if (!['skip', 'fail'].includes(t.post_condition.on_fail)) return { name: 'test_turns_well_formed', status: 'fail', detail: `test_turns_well_formed: ${c.file} turn[${i}].post_condition.on_fail invalid` };
      }
    }
  }
  return { name: 'test_turns_well_formed', status: 'pass', detail: '' };
}

// R24 process_stages_present (staged+ sibling to R23; methodology §8).
// kind-specific: skill=## 运行流程 ≥2 步骤含 数据:/决策:/交付工件:; agent=## 角色设定 非空;
// mcp=## 工具面 非空 + tools: 非空; workflow=steps≥2.
function splitStepBlocks(sec) {
  if (!sec) return [];
  const lines = sec.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (/^###\s*步骤/.test(line)) {
      if (cur) blocks.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}
export function checkProcessStagesPresent(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'process_stages_present', status: 'pass', detail: '' };
  const kind = y.kind;
  const body = readBodyMarkdown(cap);
  if (kind === 'skill') {
    const sec = extractH2Section(body, '运行流程');
    if (!sec) return { name: 'process_stages_present', status: 'fail', detail: 'process_stages_present: skill body missing "## 运行流程" section' };
    // splitStepBlocks groups lines by `### 步骤` headings — its length IS the
    // 步骤 count (the separate .filter(/^###\s*步骤/) was a redundant pass).
    const blocks = splitStepBlocks(sec);
    if (blocks.length < 2) return { name: 'process_stages_present', status: 'fail', detail: `process_stages_present: "## 运行流程" needs ≥2 "### 步骤" headings, got ${blocks.length}` };
    for (let i = 0; i < blocks.length; i++) {
      if (!/(数据:|决策:|交付工件:|人工闸门:)/.test(blocks[i].join('\n'))) {
        return { name: 'process_stages_present', status: 'fail', detail: `process_stages_present: 步骤 ${i + 1} missing 数据:/决策:/交付工件: marker` };
      }
    }
    return { name: 'process_stages_present', status: 'pass', detail: '' };
  }
  if (kind === 'agent') {
    const sec = extractH2Section(body, '角色设定');
    if (!sec || sec.trim().length === 0) return { name: 'process_stages_present', status: 'fail', detail: 'process_stages_present: agent body missing non-empty "## 角色设定" section' };
    return { name: 'process_stages_present', status: 'pass', detail: '' };
  }
  if (kind === 'mcp') {
    const sec = extractH2Section(body, '工具面');
    if (!sec || sec.trim().length === 0) return { name: 'process_stages_present', status: 'fail', detail: 'process_stages_present: mcp body missing non-empty "## 工具面" section' };
    if (!Array.isArray(y.tools) || y.tools.length === 0) return { name: 'process_stages_present', status: 'fail', detail: 'process_stages_present: mcp manifest "tools:" array empty' };
    return { name: 'process_stages_present', status: 'pass', detail: '' };
  }
  if (kind === 'workflow') {
    if (!Array.isArray(y.steps) || y.steps.length < 2) return { name: 'process_stages_present', status: 'fail', detail: `process_stages_present: workflow needs ≥2 steps, got ${y.steps ? y.steps.length : 0}` };
    return { name: 'process_stages_present', status: 'pass', detail: '' };
  }
  return { name: 'process_stages_present', status: 'n/a', detail: '' };
}

// R24b degradation_present (staged+).
export function checkDegradationPresent(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'degradation_present', status: 'pass', detail: '' };
  const kind = y.kind;
  const body = readBodyMarkdown(cap);
  if (kind === 'skill') {
    const sec = extractH2Section(body, '失败降级');
    if (!sec) return { name: 'degradation_present', status: 'fail', detail: 'degradation_present: skill body missing "## 失败降级" section' };
    const items = sec.split(/\r?\n/).filter((l) => /^\s*-\s+/.test(l) && !/^\s*-\s*__FILL_ME__/.test(l));
    if (items.length < 1) return { name: 'degradation_present', status: 'fail', detail: 'degradation_present: "## 失败降级" needs ≥1 list item' };
    return { name: 'degradation_present', status: 'pass', detail: '' };
  }
  if (kind === 'agent') {
    const sec = extractH2Section(body, '边界');
    if (!sec || sec.trim().length === 0) return { name: 'degradation_present', status: 'fail', detail: 'degradation_present: agent body missing non-empty "## 边界" section' };
    return { name: 'degradation_present', status: 'pass', detail: '' };
  }
  if (kind === 'mcp') {
    const sec = extractH2Section(body, '异常处理');
    if (!sec || sec.trim().length === 0) return { name: 'degradation_present', status: 'fail', detail: 'degradation_present: mcp body missing non-empty "## 异常处理" section' };
    return { name: 'degradation_present', status: 'pass', detail: '' };
  }
  if (kind === 'workflow') {
    for (const step of (y.steps || [])) {
      if (step && step.checkpoint) continue; // checkpoint is itself a HITL gate
      if (step && step.on_error !== undefined) {
        if (step.on_error === null || step.on_error === '' || step.on_error === false) {
          return { name: 'degradation_present', status: 'fail', detail: `degradation_present: step "${step.id}" declares on_error without a degradation action` };
        }
      }
    }
    return { name: 'degradation_present', status: 'pass', detail: '' };
  }
  return { name: 'degradation_present', status: 'n/a', detail: '' };
}

// R25 depends_declared (staged+): bidirectional body ## 依赖 ↔ frontmatter depends_on.
const CAPID_RE = /^[a-z][a-z0-9-]+\.[a-z0-9-]+(@[0-9.]+)?$/;
export function checkDependsDeclared(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'depends_declared', status: 'pass', detail: '' };
  if (!['agent', 'skill', 'mcp', 'workflow', 'bundle'].includes(y.kind)) return { name: 'depends_declared', status: 'n/a', detail: '' };
  const body = readBodyMarkdown(cap);
  const depSec = extractH2Section(body, '依赖');
  const bodyBases = new Set();
  if (depSec) {
    for (const line of depSec.split(/\r?\n/)) {
      // strip leading list marker "- " before matching capId
      const stripped = line.replace(/^\s*-\s*/, '').trim();
      const m = stripped.match(CAPID_RE);
      if (m) bodyBases.add(m[0].split('@')[0]);
    }
  }
  const declared = Array.isArray(y.depends_on) ? y.depends_on : [];
  const declaredBases = new Set(declared.map((d) => String(d).split('@')[0]));
  for (const b of bodyBases) {
    if (!declaredBases.has(b)) {
      return { name: 'depends_declared', status: 'fail', detail: `depends_declared: body "## 依赖" mentions "${b}" but not in depends_on` };
    }
  }
  for (const d of declared) {
    const base = String(d).split('@')[0];
    if (!bodyBases.has(base)) {
      return { name: 'depends_declared', status: 'fail', detail: `depends_declared: depends_on "${d}" not mentioned in body "## 依赖"` };
    }
  }
  return { name: 'depends_declared', status: 'pass', detail: '' };
}

// R26 test_four_quadrants (staged+). Hard: ≥1 positive + ≥1 boundary + ≥1(negative|degradation);
// staged positive source ∈ {real, recalled(≤med→ high|med)}. Soft (warn): case name vs
// quadrant business-language keyword alignment. Keyword set derives from docs/methodology/
// capability-creation.md C12 table (J.5).
const QUADRANT_KEYWORDS = {
  positive: ['正常', '顺利', '成功', 'positive'],
  boundary: ['边界', '极端', '特殊', 'boundary'],
  negative: ['拒绝', '不该', '非法', '负例', '失败返回', 'negative'],
  degradation: ['降级', '兜底', '上游挂', 'degradation'],
};
export function checkTestFourQuadrants(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'test_four_quadrants', status: 'pass', detail: '' };
  const cases = readTestCases(cap);
  if (cases.length === 0) return { name: 'test_four_quadrants', status: 'n/a', detail: '' };
  let pos = 0, bnd = 0, negdeg = 0;
  for (const c of cases) {
    if (c.quadrant === 'positive') pos++;
    else if (c.quadrant === 'boundary') bnd++;
    else if (c.quadrant === 'negative' || c.quadrant === 'degradation') negdeg++;
  }
  if (pos < 1 || bnd < 1 || negdeg < 1) {
    return { name: 'test_four_quadrants', status: 'fail', detail: `test_four_quadrants: need ≥1 positive + ≥1 boundary + ≥1(negative|degradation); got positive=${pos} boundary=${bnd} neg/deg=${negdeg}` };
  }
  for (const c of cases) {
    if (c.quadrant !== 'positive') continue;
    const src = c.source;
    if (src === 'synthetic' || src === 'llm_drafted_confirmed') {
      return { name: 'test_four_quadrants', status: 'fail', detail: `test_four_quadrants: ${c.file} positive source "${src}" not allowed (staged positive must be real|recalled)` };
    }
    if (src !== 'real' && src !== 'recalled') {
      return { name: 'test_four_quadrants', status: 'fail', detail: `test_four_quadrants: ${c.file} positive source missing/invalid ("${src}"); staged positive must be real|recalled` };
    }
    if (src === 'recalled' && c.confidence === 'low') {
      return { name: 'test_four_quadrants', status: 'fail', detail: `test_four_quadrants: ${c.file} positive recalled+low not allowed (need high|med)` };
    }
  }
  // Soft keyword alignment (warn only — does not fail verdict).
  const misses = [];
  for (const c of cases) {
    if (!c.quadrant) continue;
    const kws = QUADRANT_KEYWORDS[c.quadrant] || [];
    const hay = String(c.name || '').toLowerCase();
    if (!kws.some((k) => hay.includes(k.toLowerCase()))) misses.push(`${c.file}(${c.quadrant})`);
  }
  if (misses.length > 0) {
    return { name: 'test_four_quadrants', status: 'warn', detail: `test_four_quadrants: case-name vs quadrant keyword soft-miss [${misses.join(', ')}]` };
  }
  return { name: 'test_four_quadrants', status: 'pass', detail: '' };
}

// R27 run_instruction_present (staged+): body ## 运行指令 countBodyTokens ≥80.
export function checkRunInstructionPresent(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'run_instruction_present', status: 'pass', detail: '' };
  if (!['agent', 'skill', 'mcp'].includes(y.kind)) return { name: 'run_instruction_present', status: 'n/a', detail: '' };
  const sec = extractH2Section(readBodyMarkdown(cap), '运行指令');
  if (!sec) return { name: 'run_instruction_present', status: 'fail', detail: 'run_instruction_present: body missing "## 运行指令" section' };
  const cnt = countBodyTokens(sec);
  if (cnt < 80) return { name: 'run_instruction_present', status: 'fail', detail: `run_instruction_present: "## 运行指令" has ${cnt} tokens, need ≥80` };
  return { name: 'run_instruction_present', status: 'pass', detail: '' };
}

// R28 expect_mode_kind_safe (staged+): positive+exact requires allow_exact_reason;
// negative/degradation must use llm_judge|regex (contains-only/exact forbidden).
export function checkExpectModeKindSafe(cap) {
  const cases = readTestCases(cap);
  for (const c of cases) {
    const q = c.quadrant;
    if (!q) continue;
    if (q === 'positive' && c.expect === 'exact' && !c.allow_exact_reason) {
      return { name: 'expect_mode_kind_safe', status: 'fail', detail: `expect_mode_kind_safe: ${c.file} positive+exact requires allow_exact_reason (R28)` };
    }
    if ((q === 'negative' || q === 'degradation') && !['llm_judge', 'regex'].includes(c.expect)) {
      return { name: 'expect_mode_kind_safe', status: 'fail', detail: `expect_mode_kind_safe: ${c.file} ${q} expect must be llm_judge|regex, got "${c.expect}"` };
    }
  }
  return { name: 'expect_mode_kind_safe', status: 'pass', detail: '' };
}

// R31 distill_log_verifiable (staged+; methodology §8 F4). Verifies each "来自实录步骤N"
// log entry against interview.md ## 流程实录 ### 步骤N (preferred) OR body ## 运行流程
// (fallback). Hallucinated step reference or zero keyword overlap → fail. n/a when no
// ## 蒸馏日志 section or no step-referenced entries.
function parseStepBlocks(sec) {
  const out = {};
  if (!sec) return out;
  const lines = sec.split(/\r?\n/);
  let curN = null;
  let cur = [];
  const flush = () => { if (curN !== null) out[curN] = cur.join('\n'); };
  for (const line of lines) {
    const m = line.match(/^###\s*步骤\s*(\d+)/);
    if (m) {
      flush();
      curN = m[1];
      cur = [line]; // include the heading line — its semantic label is the overlap target
    } else if (curN !== null) {
      // stop at next H3 not matching 步骤, or H2
      if (/^##\s/.test(line)) { flush(); curN = null; cur = []; }
      else cur.push(line);
    }
  }
  flush();
  return out;
}
function tokenizeSet(text) {
  const cjk = (text.match(/[一-鿿]/g) || []);
  const en = (text.match(/[a-zA-Z]{2,}/g) || []).map((w) => w.toLowerCase());
  return new Set([...cjk, ...en]);
}
function distillOverlap(logLine, stepText) {
  // Strip the structural "来自实录步骤N" / "step N" phrase from the log line so the
  // trivial 步骤 overlap (which appears in both the log phrase and the step heading)
  // does not fake a pass. The remaining descriptive tokens must overlap the step.
  const desc = logLine.replace(/来自实录步骤\s*\d+/g, '').replace(/step\s*\d+/gi, '');
  // Also strip the structural "### 步骤N" heading (and any stray 步骤N) from the step
  // text. parseStepBlocks includes the heading line in stepText; without this strip,
  // the heading's literal 步/骤 chars would overlap a log line that only shares that
  // structural word — a hallucinated reference would fake a pass (R31 loophole).
  const stepClean = stepText.replace(/^###[ 	]*步骤[ 	]*[0-9]+/m, '').replace(/步骤[ 	]*[0-9]+/g, '');
  const a = tokenizeSet(desc), b = tokenizeSet(stepClean);
  const cjkOverlap = [...a].filter((t) => /^[一-鿿]$/.test(t) && b.has(t)).length;
  const enOverlap = [...a].filter((t) => /^[a-z]{2,}$/.test(t) && b.has(t)).length;
  return (cjkOverlap >= 2 || enOverlap >= 2);
}
export function checkDistillLogVerifiable(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'distill_log_verifiable', status: 'pass', detail: '' };
  if (!['agent', 'skill', 'mcp'].includes(y.kind)) return { name: 'distill_log_verifiable', status: 'n/a', detail: '' };
  const body = readBodyMarkdown(cap);
  const logSec = extractH2Section(body, '蒸馏日志');
  if (!logSec) return { name: 'distill_log_verifiable', status: 'n/a', detail: '' };
  // resolve step source: interview.md (preferred) → body ## 运行流程 (fallback)
  const interviewPath = path.join(cap.dir, 'interview.md');
  let procSteps = {};
  if (fs.existsSync(interviewPath)) {
    procSteps = parseStepBlocks(extractH2Section(readText(interviewPath), '流程实录'));
  } else {
    procSteps = parseStepBlocks(extractH2Section(body, '运行流程'));
  }
  let verifiedAny = false;
  for (const line of logSec.split(/\r?\n/)) {
    const m = line.match(/来自实录步骤\s*(\d+)|step\s*(\d+)/i);
    if (!m) continue;
    const n = m[1] || m[2];
    verifiedAny = true;
    const stepText = procSteps[n];
    if (stepText === undefined) {
      return { name: 'distill_log_verifiable', status: 'fail', detail: `distill_log_verifiable: log references step ${n} not found in interview/流程实录` };
    }
    if (!distillOverlap(line, stepText)) {
      return { name: 'distill_log_verifiable', status: 'fail', detail: `distill_log_verifiable: log step ${n} zero keyword overlap with step content` };
    }
  }
  if (!verifiedAny) return { name: 'distill_log_verifiable', status: 'n/a', detail: '' };
  return { name: 'distill_log_verifiable', status: 'pass', detail: '' };
}

// R20 description_body_alignment
export function checkDescriptionBodyAlignment(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'description_body_alignment', status: 'pass', detail: '' };
  if (!['agent', 'skill', 'mcp'].includes(y.kind)) return { name: 'description_body_alignment', status: 'pass', detail: '' };
  const desc = y.description || '';
  const body = getBody(cap);
  if (!desc || !body) return { name: 'description_body_alignment', status: 'pass', detail: '' };
  // Noun extraction: Chinese 2+ contiguous chars, English ≥4-letter words
  const cjkNouns = (desc.match(/[一-鿿]{2,}/g) || []);
  const enNouns = (desc.match(/[a-zA-Z]{4,}/g) || []);
  const nouns = [...cjkNouns, ...enNouns];
  if (nouns.length === 0) return { name: 'description_body_alignment', status: 'pass', detail: '' };
  const found = nouns.some((n) => body.toLowerCase().includes(n.toLowerCase()));
  if (!found) {
    return { name: 'description_body_alignment', status: 'fail', detail: `description_body_alignment: no noun from description found in body (nouns: ${nouns.slice(0, 3).join(', ')}...)` };
  }
  return { name: 'description_body_alignment', status: 'pass', detail: '' };
}

// R21 test_expect_declared
export function checkTestExpectDeclared(cap) {
  const cases = readTestCases(cap);
  for (const c of cases) {
    if (!c.expect || typeof c.expect !== 'string') {
      return { name: 'test_expect_declared', status: 'fail', detail: `test_expect_declared: ${c.file} does not declare expect explicitly` };
    }
  }
  return { name: 'test_expect_declared', status: 'pass', detail: '' };
}

// R22 no_self_cheat_in_body
const SELF_CHEAT_PATTERNS = [
  /直接返回\s*(expected|测试用例的)/i,
  /pass\s+the\s+test\s+by\s+returning/i,
  /输出测试用例的\s*expected/i,
  /return\s+the\s+expected\s+field/i,
  /just\s+output\s+the\s+expected/i,
];

export function checkNoSelfCheatInBody(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'no_self_cheat_in_body', status: 'pass', detail: '' };
  if (!['agent', 'skill', 'mcp'].includes(y.kind)) return { name: 'no_self_cheat_in_body', status: 'pass', detail: '' };
  const body = getBody(cap);
  for (const pat of SELF_CHEAT_PATTERNS) {
    if (pat.test(body)) {
      return { name: 'no_self_cheat_in_body', status: 'fail', detail: `no_self_cheat_in_body: body contains self-cheat pattern ${pat}` };
    }
  }
  return { name: 'no_self_cheat_in_body', status: 'pass', detail: '' };
}

// R_scenario: staged+ body must carry non-empty "## 能力说明" and "## 适用场景" H2
// sections. The capability inventory (tools/inventory.mjs) extracts these same sections
// to render the README capability table and `opsforge discover --all`, so the rule
// guarantees the inventory never silently degrades to a bare description for
// released/staged caps. Applies to staged+ (drafts are still being filled — exempt,
// like R16–R22). Pure function so inventory.mjs + tests can reuse it.
export function extractH2Section(text, heading) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  let capturing = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (capturing) break; // next H2 ends the section
      if (line.slice(3).trim() === heading) capturing = true;
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join('\n').trim();
}

// Resolve the body file: entrypoint for agent/skill/mcp (frontmatter stripped),
// README.md for workflow/bundle (no frontmatter, no entrypoint).
function bodyFilePath(cap) {
  const y = cap.yaml;
  if (y && y.entrypoint) return path.join(cap.dir, y.entrypoint);
  return path.join(cap.dir, 'README.md');
}

function readBodyMarkdown(cap) {
  const p = bodyFilePath(cap);
  if (!fs.existsSync(p)) return '';
  let raw = readText(p);
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (m) raw = m[1];
  return raw;
}

export function checkScenarioSections(cap) {
  const y = cap.yaml;
  if (!y) return { name: 'scenario_sections', status: 'pass', detail: '' };
  const body = readBodyMarkdown(cap);
  const desc = extractH2Section(body, '能力说明');
  if (!desc) {
    return { name: 'scenario_sections', status: 'fail', detail: `scenario_sections: body missing non-empty "## 能力说明" section (see templates)` };
  }
  const scen = extractH2Section(body, '适用场景');
  if (!scen) {
    return { name: 'scenario_sections', status: 'fail', detail: `scenario_sections: body missing non-empty "## 适用场景" section (see templates)` };
  }
  return { name: 'scenario_sections', status: 'pass', detail: '' };
}

// R_wf_ref: workflow steps[].capability resolvable + outputs align with vars
export function checkWorkflowRef(cap, allCaps) {
  const y = cap.yaml;
  if (!y || y.kind !== 'workflow') return { name: 'workflow_ref', status: 'n/a', detail: '' };
  const ids = new Set(allCaps.filter((c) => c.yaml && c.yaml.id).map((c) => c.yaml.id));
  for (const step of (y.steps || [])) {
    if (!step.capability) continue;
    if (!ids.has(step.capability)) {
      return { name: 'workflow_ref', status: 'fail', detail: `workflow_ref: step "${step.id}" capability "${step.capability}" not resolvable in repo` };
    }
    // R30 workflow_step_refs_graduated: referenced cap must be staged+ (draft → fail).
    const refCap = allCaps.find((c) => c.yaml && c.yaml.id === step.capability);
    if (refCap && refCap.state && refCap.state !== 'staged' && refCap.state !== 'released') {
      return { name: 'workflow_ref', status: 'fail', detail: `workflow_ref: step "${step.id}" capability "${step.capability}" references non-graduated cap (state=${refCap.state})` };
    }
  }
  // outputs names align with vars declarations
  if (y.vars && Array.isArray(y.vars)) {
    const varNames = new Set(y.vars.map((v) => v.name));
    for (const step of (y.steps || [])) {
      for (const out of (step.outputs || [])) {
        if (!varNames.has(out)) {
          return { name: 'workflow_ref', status: 'fail', detail: `workflow_ref: step "${step.id}" output "${out}" not declared in vars` };
        }
      }
    }
  }
  return { name: 'workflow_ref', status: 'pass', detail: '' };
}

// R_wf_closed: control_flow references only existing step-ids; Phase 2.4: sequence/switch/if.
export function checkWorkflowClosed(cap) {
  const y = cap.yaml;
  if (!y || y.kind !== 'workflow') return { name: 'workflow_closed', status: 'n/a', detail: '' };
  if (!y.control_flow) return { name: 'workflow_closed', status: 'pass', detail: '' };
  const stepIds = new Set((y.steps || []).map((s) => s.id));
  const SUPPORTED = new Set(['sequence', 'switch', 'if', 'until', 'while', 'checkpoint']);
  const checkIds = (ids, label) => {
    for (const sid of ids) {
      if (!stepIds.has(sid)) {
        return `workflow_closed: ${label} references unknown step "${sid}"`;
      }
    }
    return null;
  };
  for (const node of y.control_flow) {
    const t = node.type || 'sequence';
    if (!SUPPORTED.has(t)) {
      return { name: 'workflow_closed', status: 'fail', detail: `workflow_closed: control_flow node type "${t}" not supported` };
    }
    let err = null;
    if (t === 'sequence') err = checkIds(node.steps || [], 'sequence');
    else if (t === 'switch') {
      for (const c of (node.cases || [])) { err = checkIds(c.steps || [], `switch case "${c.when}"`); if (err) break; }
      if (!err && node.default && node.default.steps) err = checkIds(node.default.steps, 'switch default');
    } else if (t === 'if') {
      if (node.then && node.then.steps) { err = checkIds(node.then.steps, 'if then'); }
      if (!err && node.else && node.else.steps) err = checkIds(node.else.steps, 'if else');
    } else if (t === 'until' || t === 'while' || t === 'checkpoint') {
      err = checkIds(node.steps || [], `${t} loop`);
    }
    if (err) return { name: 'workflow_closed', status: 'fail', detail: err };
  }
  return { name: 'workflow_closed', status: 'pass', detail: '' };
}

// §22.10 .opsforge-state.json field validation
export function checkOpsforgeState(cap) {
  const statePath = path.join(cap.dir, '.opsforge-state.json');
  if (!fs.existsSync(statePath)) return { name: 'opsforge_state', status: 'pass', detail: '' };
  try {
    const state = JSON.parse(readText(statePath));
    if (!state.state || !['draft', 'staged', 'released', 'registry'].includes(state.state)) {
      return { name: 'opsforge_state', status: 'fail', detail: `opsforge_state: invalid state "${state.state}"` };
    }
    if (!Array.isArray(state.history)) {
      return { name: 'opsforge_state', status: 'fail', detail: 'opsforge_state: history must be an array' };
    }
    // methodology §7.2: phase enum (interview_done/distill_done/v0.1_built/
    // iteration_converged/iteration_capped) — orthogonal to state, optional.
    const VALID_PHASES = ['interview_done', 'distill_done', 'v0.1_built', 'iteration_converged', 'iteration_capped'];
    if (state.phase !== undefined && state.phase !== null) {
      if (!VALID_PHASES.includes(state.phase)) {
        return { name: 'opsforge_state', status: 'fail', detail: `opsforge_state: invalid phase "${state.phase}"` };
      }
    }
    if (state.built_with_model !== undefined && state.built_with_model !== null) {
      const b = state.built_with_model;
      if (typeof b !== 'object' || Array.isArray(b) || typeof b.endpoint !== 'string' || typeof b.version !== 'string') {
        return { name: 'opsforge_state', status: 'fail', detail: 'opsforge_state: built_with_model must be {endpoint:string, version:string}' };
      }
    }
    if (state.built_at !== undefined && state.built_at !== null) {
      if (typeof state.built_at !== 'string' || isNaN(Date.parse(state.built_at))) {
        return { name: 'opsforge_state', status: 'fail', detail: 'opsforge_state: built_at must be an ISO string' };
      }
    }
    for (const h of state.history) {
      // D4: `from` may be null (start transition) but must be PRESENT (not undefined).
      // The old `!h.from === undefined` was always false (boolean===undefined), so a
      // missing `from` key slipped through. Use a real undefined check.
      if (typeof h.ts !== 'string' || h.from === undefined || h.to === undefined || h.to === null) {
        return { name: 'opsforge_state', status: 'fail', detail: `opsforge_state: history entry missing required fields` };
      }
    }
  } catch (e) {
    return { name: 'opsforge_state', status: 'fail', detail: `opsforge_state: parse error: ${e.message}` };
  }
  return { name: 'opsforge_state', status: 'pass', detail: '' };
}

// §22.5 platform_conformance: call adapter.conform() for each platform in cap.platforms.
// Phase 2.1: dispatch to all 4 adapters (claude-code/cursor/codex/cline).
const _adapterCache = {};
async function loadAdapter(platform) {
  if (_adapterCache[platform]) return _adapterCache[platform];
  const mod = await import(`../adapters/${platform}/adapter.mjs`);
  _adapterCache[platform] = mod.adapter;
  return mod.adapter;
}

// Pre-load claude-code adapter for sync checkPlatformConformance (most common platform).
let _claudeCodeAdapter = null;
try {
  // Top-level await: pre-load adapter at module init (ESM supports this).
  const mod = await import('../adapters/claude-code/adapter.mjs');
  _claudeCodeAdapter = mod.adapter;
} catch {
  // Adapter not available (e.g. test fixture with custom paths) — conform check is skip.
}

// The known set of supported platforms (Phase 2.1 + F2 dify).
const KNOWN_PLATFORMS = new Set(['claude-code', 'cursor', 'codex', 'cline', 'dify']);

function checkPlatformConformance(cap) {
  const y = cap.yaml;
  if (!y || !y.platforms || y.platforms.length === 0) return null;
  const errors = [];
  for (const platform of y.platforms) {
    if (!KNOWN_PLATFORMS.has(platform)) {
      errors.push(`platform_conformance: unknown platform "${platform}"`);
      continue;
    }
    if (platform === 'claude-code') {
      if (!_claudeCodeAdapter) continue; // adapter unavailable — skip
      const r = _claudeCodeAdapter.conform(cap);
      if (!r.ok) for (const e of r.errors) errors.push(`platform_conformance: claude-code: ${e}`);
    } else {
      // Non-claude adapters: load synchronously via the module cache (already imported
      // at top-level below for cursor/codex/cline). Fall back to skip if unavailable.
      const a = _adapterCache[platform];
      if (!a) continue;
      const r = a.conform(cap);
      if (!r.ok) for (const e of r.errors) errors.push(`platform_conformance: ${platform}: ${e}`);
    }
  }
  if (errors.length === 0) {
    return { name: 'platform_conformance', status: 'pass', detail: '' };
  }
  return { name: 'platform_conformance', status: 'fail', detail: errors.join('; ') };
}

// Phase 2.1: pre-load the other 3 adapters at module init so checkPlatformConformance
// (which is sync) can use them. Failures are non-fatal (conform check skips).
try { _adapterCache['cursor'] = (await import('../adapters/cursor/adapter.mjs')).adapter; } catch { /* skip */ }
try { _adapterCache['codex'] = (await import('../adapters/codex/adapter.mjs')).adapter; } catch { /* skip */ }
try { _adapterCache['cline'] = (await import('../adapters/cline/adapter.mjs')).adapter; } catch { /* skip */ }
try { _adapterCache['dify'] = (await import('../adapters/dify/adapter.mjs')).adapter; } catch { /* skip */ }

/**
 * validateDir(dir, opts) → { verdict, checks }
 * 按 state 选择 draft / staged 规则子集（§5 矩阵 D/S 列）。
 */
export function validateDir(dir, opts = {}) {
  const repo = opts.repoRoot || getRepoRoot();
  const allCaps = opts.allCaps || scanCapabilities(repo);
  const cap = parseCapability(dir);
  const state = cap.state;

  // draft: entry_guard (R15) 仅依赖文件集合，即使无 manifest 也须执行，
  // 交给 checkDraftRelaxed 统一处理（§7 T13 手建目录场景）。
  if (state === 'draft') {
    const checks = checkDraftRelaxed(cap, { allCaps });
    const verdict = checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';
    return { verdict, checks, dir };
  }

  // staged: YAML 无法解析时只回 yaml_parse 失败（其余规则无法执行）。
  if (cap.parseError || !cap.yaml) {
    return { verdict: 'fail', checks: [checkYamlParse(cap)], dir };
  }

  // staged 子集：R1/R2/R3/R4/R6/R7/R8/R9/R10/R11/R12/R13/R14
  const checks = [];
  checks.push(checkSchema(cap));
  checks.push(checkYamlParse(cap));
  checks.push(checkIdUnique(cap, allCaps));
  checks.push(checkNaming(cap));
  checks.push(checkVersionSemver(cap));
  checks.push(checkPlaceholder(cap));
  checks.push(checkSkeletonGuard(cap));
  checks.push(checkEngineeringFieldsUntampered(cap));
  checks.push(checkDisplayNamesI18n(cap));
  checks.push(checkCustomerDirConsistency(cap));
  checks.push(checkDependsOnResolvable(cap, allCaps));
  checks.push(checkDependsOnDirection(cap, allCaps));
  checks.push(checkTestsMin(cap));

  // §21.7 anti-vacuous guards (staged-only)
  checks.push(checkBodyMinSubstance(cap));
  checks.push(checkBodyNotBoilerplate(cap));
  checks.push(checkTestExpectNontrivial(cap));
  checks.push(checkPreGatesNontrivial(cap));
  checks.push(checkTestCasesDistinct(cap));
  checks.push(checkTurnsWellFormed(cap));
  // methodology §8 R24–R28 + R31 (staged+ siblings of R23; R30 inside checkWorkflowRef).
  checks.push(checkProcessStagesPresent(cap));
  checks.push(checkDegradationPresent(cap));
  checks.push(checkDependsDeclared(cap));
  checks.push(checkTestFourQuadrants(cap));
  checks.push(checkRunInstructionPresent(cap));
  checks.push(checkExpectModeKindSafe(cap));
  checks.push(checkDistillLogVerifiable(cap));
  checks.push(checkDescriptionBodyAlignment(cap));
  checks.push(checkTestExpectDeclared(cap));
  checks.push(checkNoSelfCheatInBody(cap));
  // R_scenario: staged+ body carries "## 能力说明" + "## 适用场景" for the inventory.
  checks.push(checkScenarioSections(cap));
  // v7 §20.1 workflow structural rules (staged-only)
  checks.push(checkWorkflowRef(cap, allCaps));
  checks.push(checkWorkflowClosed(cap));
  // §22.10 .opsforge-state.json field validation
  checks.push(checkOpsforgeState(cap));

  // §22.5 platform_conformance hook — call adapter.conform() for each platform
  const platformConf = checkPlatformConformance(cap);
  if (platformConf) checks.push(platformConf);

  // R26 soft-check introduces `warn` status — warn does NOT fail the verdict
  // (R16–R22 unchanged; only R26 may emit warn). This is a minimal extension.
  const verdict = checks.every((c) => c.status === 'pass' || c.status === 'n/a' || c.status === 'warn') ? 'pass' : 'fail';
  return { verdict, checks, dir };
}

/**
 * 扫描仓内所有能力目录（drafts/staged，通用+品牌）。
 */
export function scanCapabilities(root) {
  const caps = [];
  const roots = [
    path.join(root, 'packs', '_drafts'),
    path.join(root, 'packs', '_staged'),
    path.join(root, 'packs', '_third-party'),
  ];
  // 品牌
  const customersDir = path.join(root, 'customers');
  if (fs.existsSync(customersDir)) {
    for (const brand of fs.readdirSync(customersDir, { withFileTypes: true })) {
      if (!brand.isDirectory()) continue;
      const brandPacks = path.join(customersDir, brand.name, 'packs');
      if (!fs.existsSync(brandPacks)) continue;
      roots.push(path.join(brandPacks, '_drafts'));
      roots.push(path.join(brandPacks, '_staged'));
      // formal brand caps: customers/<brand>/packs/<brand-slug>/... (aligns with
      // release.mjs collectCapDirs; previously validate missed formal brand caps).
      for (const ent of fs.readdirSync(brandPacks, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (['_drafts', '_staged', '_third-party'].includes(ent.name)) continue;
        roots.push(path.join(brandPacks, ent.name));
      }
    }
  }
  // Also scan formal dirs: packs/<contributor-slug>/ (excluding _drafts/_staged/_third-party)
  const packsDir = path.join(root, 'packs');
  if (fs.existsSync(packsDir)) {
    for (const ent of fs.readdirSync(packsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (['_drafts', '_staged', '_third-party'].includes(ent.name)) continue;
      for (const found of walkCapabilityDirs(path.join(packsDir, ent.name))) {
        try {
          const cap = parseCapability(found);
          if (cap.yaml) caps.push(cap);
        } catch { /* 忽略无法解析的目录 */ }
      }
    }
  }
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const found of walkCapabilityDirs(r)) {
      try {
        const cap = parseCapability(found);
        if (cap.yaml) caps.push(cap);
      } catch { /* 忽略无法解析的目录 */ }
    }
  }
  return caps;
}

// 找出"含 manifest 文件"的目录（最深到含 manifest 即止，不再下钻）。
function walkCapabilityDirs(root) {
  const out = [];
  function recurse(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (MANIFEST_FILES.some((f) => fs.existsSync(path.join(d, f)))) {
      out.push(d);
      return; // 不再下钻（tests/ 等子目录跳过）
    }
    for (const ent of ents) {
      if (ent.isDirectory() && ent.name !== '.git') recurse(path.join(d, ent.name));
    }
  }
  recurse(root);
  return out;
}

/**
 * validateAll(opts) → { verdict, results }，扫描全仓 drafts/staged。
 */
export function validateAll(opts = {}) {
  const repo = opts.repoRoot || getRepoRoot();
  const allCaps = scanCapabilities(repo);
  const results = [];
  for (const cap of allCaps) {
    results.push(validateDir(cap.dir, { repoRoot: repo, allCaps }));
  }
  const verdict = results.every((r) => r.verdict === 'pass') ? 'pass' : 'fail';
  return { verdict, results };
}

function relPath(p) {
  if (!p) return '<unknown>';
  const root = repoRoot || getRepoRoot();
  let r = path.relative(root, p);
  if (r === '' || r === p) return toPosix(p);
  return toPosix(r);
}

// ---------- CLI ----------

/**
 * Run the capability's regression suite (static-only by default) and map the
 * runSuite summary into the validation-report regression_cases shape.
 * D1: previously regression_cases was hardcoded to all-zero, so the release
 * gate never saw real behavioral data. We run static-only here (no model calls
 * during structural validation); tools/eval.mjs does the full LLM eval.
 * Lazy dynamic import avoids the validate↔test-runner circular init.
 */
async function runRegression(capDir, opts = {}) {
  try {
    const { runSuite } = await import('./test-runner.mjs');
    const { summary } = await runSuite(capDir, {
      runner: opts.runner || 'static-only',
      platform: opts.platform || 'claude-code',
      opsforgeHome: opts.opsforgeHome,
    });
    return {
      total: summary.total || 0,
      passed: summary.passed || 0,
      failed: summary.failed || 0,
      pending_human: summary.pending || 0,
      modes: summary.modes || {},
      runner: summary.runner || 'static-only',
      failures: (summary.failures || []).map((f) => ({ case: f.case, mode: f.mode, reason: f.reason })),
    };
  } catch (e) {
    return {
      total: 0, passed: 0, failed: 0, pending_human: 0, modes: {},
      runner: 'error', failures: [{ reason: `regression run error: ${e.message}` }],
    };
  }
}

/** Build validation-report.json shape (§3.3) from a validateDir result.
 *  @param {{verdict: string, checks: Array, dir: string}} r
 *  @param {Object} [regressionCases]  mapped runSuite summary (D1). */
function buildReport(r, regressionCases) {
  const checks = {};
  for (const c of r.checks) {
    checks[c.name] = c.status;
  }
  const rc = regressionCases || {
    total: 0, passed: 0, failed: 0, pending_human: 0, modes: {}, failures: [],
  };
  return {
    id: undefined, // set by writeReport
    origin: 'original',
    checks,
    regression_cases: rc,
    verdict: r.verdict,
  };
}

/** Write validation-report.json into a cap dir (P0-5: §3.3 shape).
 *  Async: runs the regression suite to populate real regression_cases (D1). */
async function writeReport(dir, r, opts = {}) {
  const cap = parseCapability(dir);
  const id = cap.yaml && cap.yaml.id ? cap.yaml.id : path.basename(dir);
  const rc = await runRegression(dir, opts);
  const report = buildReport(r, rc);
  report.id = id;
  atomicWriteSync(path.join(dir, 'validation-report.json'), JSON.stringify(report, null, 2));
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/validate.mjs <path> | --all');
    process.exit(2);
  }
  let verdict;
  if (argv[0] === '--all') {
    const res = validateAll();
    verdict = res.verdict;
    for (const r of res.results) {
      await writeReport(r.dir, r); // P0-5: write validation-report.json per cap (D1: real rc)
      const fails = r.checks.filter((c) => c.status === 'fail');
      if (fails.length === 0) {
        console.log(`PASS  ${relPath(r.dir)}`);
      } else {
        console.log(`FAIL  ${relPath(r.dir)}`);
        for (const c of fails) console.log(`       ${c.detail}`);
      }
    }
    console.log(`\nverdict: ${verdict} (${res.results.length} capability(ies))`);
  } else {
    const target = path.resolve(argv[0]);
    const res = validateDir(target);
    verdict = res.verdict;
    await writeReport(target, res); // P0-5: write validation-report.json (D1: real rc)
    for (const c of res.checks) {
      const tag = c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : c.status === 'n/a' ? 'N/A' : 'FAIL';
      console.log(`${tag}  ${c.name}${c.detail ? '  ' + c.detail : ''}`);
    }
    console.log(`\nverdict: ${verdict}`);
  }
  process.exit(verdict === 'pass' ? 0 : 1);
}

// 直接运行时入口。
const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('validate.mjs');
if (invokedDirect) { main().catch((e) => { console.error(e); process.exit(1); }); }
