// tools/validate.test.mjs — TDD RED phase（T1–T18）。DESIGN.md §7 测试计划。
// 每个用例在临时目录构造 fixture（fs.mkdtempSync + os.tmpdir()），不污染真实仓库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import {
  parseCapability,
  checkSchema,
  checkSkeletonGuard,
  checkPlaceholder,
  checkNaming,
  checkEngineeringFieldsUntampered,
  checkVersionLock,
  checkBodyMinSubstance,
  checkBodyNotBoilerplate,
  checkTestExpectNontrivial,
  checkTestCasesDistinct,
  checkDescriptionBodyAlignment,
  checkTestExpectDeclared,
  checkNoSelfCheatInBody,
  checkWorkflowRef,
  checkWorkflowClosed,
  checkOpsforgeState,
  validateDir,
  validateAll,
  setRepoRoot,
  setTemplatesDir,
} from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_TEMPLATES = path.resolve(__dirname, '..', 'templates');

const FILL = 'filled';

// ---------- helpers ----------
function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-'));
  return root;
}

function copyTemplate(kind, dest) {
  fs.cpSync(path.join(REAL_TEMPLATES, kind), dest, { recursive: true });
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function replaceInFile(file, map) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(map)) s = s.split(k).join(v);
  fs.writeFileSync(file, s);
}

function replaceAll(dir, map) {
  for (const f of walkFiles(dir)) replaceInFile(path.join(dir, f), map);
}

// 通用骨架：拷贝 templates/<kind> 到 dest，替换工程/业务占位符，得到一份"全绿"能力。
// Phase 1.3: also writes a substantial body (R16) and distinct test cases (R19).
function makeCap({ tmp, state = 'staged', kind = 'agent', slug = 'foo', name = 'bar', brand = null, fill = true }) {
  const stateSeg = state === 'draft' ? '_drafts' : '_staged';
  let dest;
  let tmplKind = kind;
  if (brand) {
    tmplKind = 'brand-draft';
    dest = path.join(tmp, 'customers', brand, 'packs', stateSeg, brand, name);
  } else {
    dest = path.join(tmp, 'packs', stateSeg, slug, name);
  }
  fs.mkdirSync(dest, { recursive: true });
  copyTemplate(tmplKind, dest);
  const map = { __NAME__: name, __BRAND_SLUG__: brand || slug };
  // __SLUG__ 对 brand-draft 不应替换 pack/owner（保持 __BRAND_SLUG__ 已替换）；普通模板替换为 slug
  if (!brand) map.__SLUG__ = slug;
  if (fill) map.__FILL_ME__ = FILL;
  replaceAll(dest, map);

  if (fill) {
    // R16 body_min_substance: write a substantial body with a noun from description.
    // agent≥150 / skill≥100 / mcp≥80 tokens (English words ≥2 letters + Chinese chars).
    // R_scenario: body must carry "## 能力说明" + "## 适用场景" H2 sections (staged+).
    const bodyNoun = FILL; // description is "filled"; body must contain "filled"
    const substance = `This is a ${bodyNoun} capability body for testing purposes. It performs operations including content creation, review, and reporting. The agent processes input data and generates output based on configured rules and templates. Quality assurance checks are performed on all generated content before delivery. Additional context and instructions are provided here to ensure the body meets minimum substance thresholds for the OpsForge validation gate. This section covers the primary workflow steps, input handling, output format, error handling, and edge case management. The capability supports multiple input formats and produces structured output suitable for downstream processing. Configuration parameters allow customization of behavior per project requirements. Logging and monitoring hooks are integrated for observability. The implementation follows best practices for maintainability and extensibility. Documentation references are included for each function. Performance considerations are addressed through lazy loading and caching strategies. The module exposes a clean public interface with comprehensive type annotations. Thread safety is ensured through immutable data structures wherever possible. Test coverage requirements dictate thorough validation of all code paths including error branches and boundary conditions.`;
    const runInstr = `You are a test capability. When invoked, receive the input data from the configured source path without pasting raw values, validate it against the schema, aggregate the performance indicators, decide the output format based on the configured rules, generate the structured report with key findings trends and recommendations, identify outliers and notable patterns, and present the results in a clear format suitable for stakeholders. Support multiple report formats including executive summaries and detailed breakdowns. Handle edge cases and boundary conditions gracefully with degradation. Never fabricate data; when a data source is unavailable, degrade to an empty report with an alert rather than crashing. All generated content passes a quality checkpoint before delivery. Maintain consistency across invocations and reuse style memory where applicable.`;
    const body = `## 能力说明\n\n${substance}\n\n## 适用场景\n\n- content creation and copywriting\n- review and reporting\n- performance analysis\n## 运行流程\n\n### 步骤1 接收数据\n数据:输入文件路径\n决策:校验通过\n交付工件:解析结果\n\n### 步骤2 生成输出\n数据:聚合指标\n决策:格式选择\n交付工件:最终报告\n\n## 失败降级\n\n- 数据源不可用时降级返回空报告并告警\n\n## 角色设定\n\n测试角色，处理输入并生成输出，不越权写入\n\n## 工具面\n\n- query-metrics\n\n## 数据契约\n\n- input: metric string; output: JSON {metric, value}\n\n## 异常处理\n\n- 网络错误重试退避；鉴权失败 fail loud\n\n## 边界\n\n- 不越权写入投放系统；不杜撰数据指标\n\n## 依赖\n\n- 无\n\n## 运行指令\n\n${runInstr}\n\n## 蒸馏日志\n\n- 接收数据来自实录步骤1\n- 生成输出来自实录步骤2`;
    const entrypoint = kind === 'skill' ? 'SKILL.md' : 'source.md';
    const epPath = path.join(dest, entrypoint);
    if (fs.existsSync(epPath)) {
      let raw = fs.readFileSync(epPath, 'utf8');
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (m) {
        raw = `---\n${m[1]}\n---\n${body}`;
        fs.writeFileSync(epPath, raw);
      }
    }
    // mcp R24: tools: array must be non-empty — inject a tool for the test fixture.
    if (kind === 'mcp') {
      const mcpPath = path.join(dest, 'source.md');
      if (fs.existsSync(mcpPath)) {
        let s = fs.readFileSync(mcpPath, 'utf8');
        if (/^tools:\s*\[\]\s*$/m.test(s)) {
          s = s.replace(/^tools:\s*\[\]\s*$/m, 'tools:\n  - name: query-metrics\n    description: Query metrics\n');
          fs.writeFileSync(mcpPath, s);
        }
      }
    }
    // R19/R26/R28: rewrite test cases with valid quadrant/source/confidence + expect modes.
    const testsDir = path.join(dest, 'tests');
    if (fs.existsSync(testsDir)) {
      const caseFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).sort();
      const QUADS = [
        { q: 'positive', exp: 'contains', rubric: null },
        { q: 'boundary', exp: 'contains', rubric: null },
        { q: 'negative', exp: 'llm_judge', rubric: 'a'.repeat(25) },
      ];
      caseFiles.forEach((f, i) => {
        const qd = QUADS[i % 3];
        const yamlStr = `name: case-${i}\ninput: case-input-${i}\nexpect: ${qd.exp}\nexpected: case-expected-${i}\nschema_ref: null\njudge_rubric: ${qd.rubric ? JSON.stringify(qd.rubric) : 'null'}\njudge_threshold: 0.7\nweight: 1.0\nquadrant: ${qd.q}\nsource: recalled\nconfidence: med\nallow_exact_reason: null\nref: null\n`;
        fs.writeFileSync(path.join(testsDir, f), yamlStr);
      });
    }
    // R_wf_ref: workflow step.capability must be resolvable — set ALL to own id.
    if (kind === 'workflow') {
      const wfPath = path.join(dest, 'workflow.yaml');
      if (fs.existsSync(wfPath)) {
        let s = fs.readFileSync(wfPath, 'utf8');
        const ownId = `${brand || slug}.${name}`;
        s = s.split('capability: filled').join(`capability: ${ownId}`);
        fs.writeFileSync(wfPath, s);
      }
    }
  }
  return dest;
}

function findCheck(checks, name) {
  return checks.find((c) => c.name === name);
}

function assertCheckFail(checks, name, contains) {
  const c = findCheck(checks, name);
  assert.ok(c, `expected check ${name} to exist`);
  assert.equal(c.status, 'fail', `check ${name} status`);
  if (contains !== undefined) assert.ok(c.detail.includes(contains), `check ${name} detail "${c.detail}" should contain "${contains}"`);
}

function assertCheckPass(checks, name) {
  const c = findCheck(checks, name);
  assert.ok(c, `expected check ${name} to exist`);
  assert.equal(c.status, 'pass', `check ${name} status`);
}

function assertCheckAbsent(checks, name) {
  assert.equal(findCheck(checks, name), undefined, `check ${name} should be absent`);
}

// ---------- T1 schema rejects unknown field ----------
test('T1 schema rejects unknown field (additionalProperties)', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  y = y.replace('display_name:', 'bogus: 1\ndisplay_name:');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'schema', 'additionalProperties');
});

// ---------- T2 schema rejects missing required ----------
test('T2 schema rejects missing required display_name_en', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  y = y.replace(/display_name_en:.*\n/, '');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'schema', 'display_name_en');
});

// ---------- T3 skeleton_guard fails on extra file ----------
test('T3 skeleton_guard fails on extra file', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, 'extra.md'), 'nope');
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'skeleton_guard', 'extra=[extra.md]');
});

// ---------- T4 skeleton_guard fails on missing file ----------
test('T4 skeleton_guard fails on missing file', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.rmSync(path.join(dir, 'CHANGELOG.md'));
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'skeleton_guard', 'missing=[CHANGELOG.md]');
});

// ---------- T5 placeholder_clean fails on __FILL_ME__ ----------
test('T5 placeholder_clean fails on __FILL_ME__ in staged', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  y = y.replace('description: filled', 'description: __FILL_ME__');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'placeholder_clean', '__FILL_ME__');
  const c = findCheck(checks, 'placeholder_clean');
  assert.match(c.detail, /:\d+/, 'detail should point to a line number');
});

// ---------- T6 placeholder_clean fails on TODO ----------
test('T6 placeholder_clean fails on TODO', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.appendFileSync(path.join(dir, 'source.md'), '\nTODO: fixme later\n');
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'placeholder_clean', 'TODO');
});

// ---------- T7 naming rejects slug My_Slug ----------
test('T7 naming rejects slug My_Slug', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent', slug: 'foo', name: 'bar' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  y = y.replace('pack: foo', 'pack: My_Slug');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'naming', 'My_Slug');
  const c = findCheck(checks, 'naming');
  assert.match(c.detail, /\^\[a-z\]\[a-z0-9-\]\{2,30\}\$/);
});

// ---------- T8 naming rejects uppercase name ----------
test('T8 naming rejects uppercase name CamelCase', () => {
  const tmp = mkRepo();
  const dir = path.join(tmp, 'packs', '_staged', 'foo', 'CamelCase');
  fs.mkdirSync(dir, { recursive: true });
  copyTemplate('agent', dir);
  replaceAll(dir, { __SLUG__: 'foo', __NAME__: 'CamelCase', __FILL_ME__: FILL });
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'naming', 'CamelCase');
});

// ---------- T9 naming rejects id mismatch ----------
test('T9 naming rejects id != pack.name', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent', slug: 'foo', name: 'bar' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  // id 现为 foo.bar；改成 baz.bar，使其 != pack.name(foo.bar)
  y = y.replace('id: foo.bar', 'id: baz.bar');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'naming');
  const c = findCheck(checks, 'naming');
  assert.ok(c.detail.includes('id "baz.bar" != "foo.bar"'), c.detail);
});

// ---------- T10 version_lock fails when draft != 0.1.0 ----------
test('T10 version_lock fails when draft version != 0.1.0', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'draft', kind: 'agent' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  y = y.replace('version: 0.1.0', 'version: 0.2.0');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'version_lock', '0.1.0');
  const c = findCheck(checks, 'version_lock');
  assert.ok(c.detail.includes('0.2.0'), c.detail);
});

// ---------- T11 version_semver fails on invalid staged version ----------
test('T11 version_semver fails on invalid staged version', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  // 引号确保 YAML 解析为字符串 "1.0"（非 semver，也违反 schema pattern）
  y = y.replace('version: 0.1.0', 'version: "1.0"');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'version_semver', '1.0');
});

// ---------- T12 engineering_fields_untampered fails when kind changed ----------
test('T12 engineering_fields_untampered fails when kind changed', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const yamlFile = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlFile, 'utf8');
  y = y.replace('kind: agent', 'kind: skill');
  fs.writeFileSync(yamlFile, y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'engineering_fields_untampered');
  const c = findCheck(checks, 'engineering_fields_untampered');
  assert.ok(c.detail.includes('field "kind"'), c.detail);
  assert.ok(c.detail.includes('"agent"'), c.detail);
  assert.ok(c.detail.includes('"skill"'), c.detail);
});

// ---------- T13 entry_guard fails on hand-made draft dir ----------
test('T13 entry_guard fails on hand-made draft dir', () => {
  const tmp = mkRepo();
  const dir = path.join(tmp, 'packs', '_drafts', 'hand', 'made');
  fs.mkdirSync(dir, { recursive: true });
  // 给一个能解析的 manifest + 一个骨架外文件
  copyTemplate('agent', dir);
  replaceAll(dir, { __SLUG__: 'hand', __NAME__: 'made', __FILL_ME__: FILL });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'random');
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'entry_guard', 'not generated by new-capability.mjs');
});

// ---------- T13b entry_guard fires on hand-made draft dir with NO manifest ----------
// 回归：e2e D1 — validateDir 曾在 cap.parseError 时提前 return，导致无 manifest 的手建
// _drafts 目录只报 yaml_parse，不报 entry_guard（§7 T13 原义）。
test('T13b entry_guard fires on hand-made draft dir with NO manifest (only stray file)', () => {
  const tmp = mkRepo();
  const dir = path.join(tmp, 'packs', '_drafts', 'hand', 'made');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'random');
  const { checks, verdict } = validateDir(dir, { repoRoot: tmp });
  // yaml_parse 仍须失败（无 manifest），但 entry_guard 必须执行
  assertCheckFail(checks, 'yaml_parse', 'no manifest file found');
  assertCheckFail(checks, 'entry_guard', 'not generated by new-capability.mjs');
  assert.equal(verdict, 'fail');
});

// ---------- T_wf staged workflow passes all checks ----------
// 回归：workflow 模板曾缺 source、含未声明 outputs 字段，staged 必过。
test('T_wf staged workflow passes all checks', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'workflow' });
  const { verdict, checks } = validateDir(dir, { repoRoot: tmp });
  assert.equal(verdict, 'pass', `workflow staged should pass; checks=${JSON.stringify(checks)}`);
});

// ---------- T_bd staged bundle passes all checks ----------
test('T_bd staged bundle passes all checks', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'bundle' });
  const { verdict, checks } = validateDir(dir, { repoRoot: tmp });
  // bundle 现在含 platforms/tests/tests 子目录/source，应全绿
  assert.equal(verdict, 'pass', `bundle staged should pass; checks=${JSON.stringify(checks)}`);
});

// ---------- T14 customer_dir_consistency fails when customer != path ----------
test('T14 customer_dir_consistency fails when customer != path', () => {
  const tmp = mkRepo();
  // 放在 customers/other/ 下，但 customer 字段写 acme
  const dir = path.join(tmp, 'customers', 'other', 'packs', '_staged', 'acme', 'bot');
  fs.mkdirSync(dir, { recursive: true });
  copyTemplate('brand-draft', dir);
  replaceAll(dir, { __BRAND_SLUG__: 'acme', __NAME__: 'bot', __FILL_ME__: FILL });
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'customer_dir_consistency', 'not under customers/acme');
});

// ---------- T15 tests_min fails when <3 cases in staged ----------
test('T15 tests_min fails when <3 cases in staged', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.rmSync(path.join(dir, 'tests', 'case-03.yaml'));
  const { checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckFail(checks, 'tests_min', 'got 2');
});

// ---------- T16 draft relaxes skeleton_guard ----------
test('T16 draft relaxes skeleton_guard (exempt) even when missing CHANGELOG.md', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'draft', kind: 'agent' });
  fs.rmSync(path.join(dir, 'CHANGELOG.md'));
  const { verdict, checks } = validateDir(dir, { repoRoot: tmp });
  assertCheckAbsent(checks, 'skeleton_guard');
  assert.equal(verdict, 'pass', `draft should pass; checks=${JSON.stringify(checks)}`);
});

// ---------- T17 id_unique fails on duplicate ----------
test('T17 id_unique fails on duplicate across drafts', () => {
  const tmp = mkRepo();
  const dir1 = makeCap({ tmp, state: 'draft', kind: 'agent', slug: 'foo', name: 'bar' });
  // 第二个 draft 用相同 id foo.bar（不同目录）
  const dir2 = path.join(tmp, 'packs', '_drafts', 'foo', 'bar2');
  fs.mkdirSync(dir2, { recursive: true });
  copyTemplate('agent', dir2);
  replaceAll(dir2, { __SLUG__: 'foo', __NAME__: 'bar2', __FILL_ME__: FILL });
  // 修正 id 为 foo.bar 以制造重复（makeCap 默认填 foo.bar2，这里改成 foo.bar）
  const y2 = path.join(dir2, 'capability.yaml');
  let y = fs.readFileSync(y2, 'utf8');
  y = y.replace('id: foo.bar2', 'id: foo.bar');
  fs.writeFileSync(y2, y);
  const { verdict, results } = validateAll({ repoRoot: tmp });
  assert.equal(verdict, 'fail');
  // 至少有一个 id_unique 失败
  const dupFail = results.some((r) => r.checks.some((c) => c.name === 'id_unique' && c.status === 'fail'));
  assert.ok(dupFail, 'expected an id_unique failure somewhere');
});

// ---------- T18 --all aggregates verdict ----------
test('T18 --all aggregates verdict over mixed pass/fail', () => {
  const tmp = mkRepo();
  // 一个全绿 staged
  makeCap({ tmp, state: 'staged', kind: 'agent', slug: 'good', name: 'one' });
  // 一个失败 staged（占位符未清）
  makeCap({ tmp, state: 'staged', kind: 'agent', slug: 'bad', name: 'two', fill: false });
  const { verdict, results } = validateAll({ repoRoot: tmp });
  assert.equal(verdict, 'fail');
  assert.ok(results.length >= 2, 'should aggregate at least 2 results');
  // 列出每个失败
  const failures = results.filter((r) => r.verdict === 'fail');
  assert.ok(failures.length >= 1, 'should list failures');
});

// ---------- Phase 1.3: R16–R22 + R_wf + opsforge_state tests ----------

// T29 R16 body_min_substance fails on short body
test('T29 R16 body_min_substance fails on short agent body', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  // Overwrite body with very short content
  const srcPath = path.join(dir, 'source.md');
  let raw = fs.readFileSync(srcPath, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  raw = `---\n${m[1]}\n---\nshort`;
  fs.writeFileSync(srcPath, raw);
  const cap = parseCapability(dir);
  const r = checkBodyMinSubstance(cap);
  assert.equal(r.status, 'fail');
  assert.ok(r.detail.includes('≥150'));
});

// T30 R17 body_not_boilerplate fails on echo pattern
test('T30 R17 body_not_boilerplate fails on echo pattern', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const srcPath = path.join(dir, 'source.md');
  let raw = fs.readFileSync(srcPath, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  raw = `---\n${m[1]}\n---\nreturn expected`;
  fs.writeFileSync(srcPath, raw);
  const cap = parseCapability(dir);
  const r = checkBodyNotBoilerplate(cap);
  assert.equal(r.status, 'fail');
});

// T31 R18 test_expect_nontrivial fails on short expected
test('T31 R18 test_expect_nontrivial fails on short expected', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  // Overwrite case-01 with a trivial expected
  const casePath = path.join(dir, 'tests', 'case-01.yaml');
  fs.writeFileSync(casePath, 'name: case-one\ninput: hello\nexpect: exact\nexpected: ok\n');
  const cap = parseCapability(dir);
  const r = checkTestExpectNontrivial(cap);
  assert.equal(r.status, 'fail');
  assert.ok(r.detail.includes('blacklist') || r.detail.includes('short'));
});

// T32 R19 test_cases_distinct fails on identical cases
test('T32 R19 test_cases_distinct fails on identical cases', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  // Make all 3 cases identical
  const identical = 'name: case-aaa\ninput: same\nexpect: exact\nexpected: same-result\n';
  for (const f of ['case-01.yaml', 'case-02.yaml', 'case-03.yaml']) {
    fs.writeFileSync(path.join(dir, 'tests', f), identical);
  }
  const cap = parseCapability(dir);
  const r = checkTestCasesDistinct(cap);
  assert.equal(r.status, 'fail');
  assert.ok(r.detail.includes('duplicates'));
});

// T33 R20 description_body_alignment fails when no noun from description in body
test('T33 R20 description_body_alignment fails when no noun from description in body', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  // Set description to a word not in body
  const yamlPath = path.join(dir, 'capability.yaml');
  let y = fs.readFileSync(yamlPath, 'utf8');
  y = y.replace('description: filled', 'description: xyzabc');
  fs.writeFileSync(yamlPath, y);
  const cap = parseCapability(dir);
  const r = checkDescriptionBodyAlignment(cap);
  assert.equal(r.status, 'fail');
});

// T34 R21 test_expect_declared fails when expect missing
test('T34 R21 test_expect_declared fails when expect missing', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const casePath = path.join(dir, 'tests', 'case-01.yaml');
  fs.writeFileSync(casePath, 'name: case-one\ninput: hello\nexpected: result\n');
  const cap = parseCapability(dir);
  const r = checkTestExpectDeclared(cap);
  assert.equal(r.status, 'fail');
});

// T35 R22 no_self_cheat_in_body fails on self-cheat pattern
test('T35 R22 no_self_cheat_in_body fails on self-cheat pattern', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const srcPath = path.join(dir, 'source.md');
  let raw = fs.readFileSync(srcPath, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  raw = `---\n${m[1]}\n---\nThis agent will 直接返回 expected to pass the test.`;
  fs.writeFileSync(srcPath, raw);
  const cap = parseCapability(dir);
  const r = checkNoSelfCheatInBody(cap);
  assert.equal(r.status, 'fail');
});

// T36 R_wf_ref fails on unresolvable step.capability
test('T36 R_wf_ref fails on unresolvable step.capability', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'workflow' });
  // Set step.capability to a non-existent id
  const wfPath = path.join(dir, 'workflow.yaml');
  let y = fs.readFileSync(wfPath, 'utf8');
  y = y.replace(/capability: foo\.bar/, 'capability: nonexistent.cap');
  fs.writeFileSync(wfPath, y);
  const cap = parseCapability(dir);
  const allCaps = [cap]; // only this cap exists
  const r = checkWorkflowRef(cap, allCaps);
  assert.equal(r.status, 'fail');
  assert.ok(r.detail.includes('not resolvable'));
});

// T37 R_wf_closed fails on non-sequence control_flow (schema rejects, but also runtime check)
test('T37 R_wf_closed fails on non-sequence control_flow', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'workflow' });
  const wfPath = path.join(dir, 'workflow.yaml');
  let y = fs.readFileSync(wfPath, 'utf8');
  // Add control_flow with a loop node (will be rejected by workflow.schema.json at schema level,
  // but checkWorkflowClosed also checks at runtime)
  y += '\ncontrol_flow:\n  - type: loop\n    steps: [step-one]\n';
  fs.writeFileSync(wfPath, y);
  const cap = parseCapability(dir);
  const r = checkWorkflowClosed(cap);
  assert.equal(r.status, 'fail');
  assert.ok(r.detail.includes('loop') || r.detail.includes('not supported'));
});

// T38 skeleton_guard does NOT flag .opsforge-state.json
test('T38 skeleton_guard excludes .opsforge-state.json from file set check', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({ state: 'staged', history: [] }));
  const cap = parseCapability(dir);
  const r = checkSkeletonGuard(cap);
  assert.equal(r.status, 'pass', `should pass with .opsforge-state.json excluded; got: ${r.detail}`);
});

// T39 checkOpsforgeState passes on valid state file
test('T39 checkOpsforgeState passes on valid state file', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({
    state: 'staged',
    history: [{ ts: '2026-01-01T00:00:00Z', from: 'draft', to: 'staged', pr: '#1' }],
  }));
  const cap = parseCapability(dir);
  const r = checkOpsforgeState(cap);
  assert.equal(r.status, 'pass');
});

// T40 checkOpsforgeState fails on invalid state value
test('T40 checkOpsforgeState fails on invalid state value', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({ state: 'bogus', history: [] }));
  const cap = parseCapability(dir);
  const r = checkOpsforgeState(cap);
  assert.equal(r.status, 'fail');
});

// T40b D4: checkOpsforgeState detects a history entry missing the `from` key.
// Bug: `!h.from === undefined` was always false, so a missing `from` slipped through.
test('T40b checkOpsforgeState fails when history entry missing from', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({
    state: 'staged',
    history: [{ ts: '2026-01-01T00:00:00Z', to: 'staged', pr: '#1' }], // no `from`
  }));
  const cap = parseCapability(dir);
  const r = checkOpsforgeState(cap);
  assert.equal(r.status, 'fail', `should fail on missing from; got: ${r.detail}`);
  assert.match(r.detail, /missing required fields/);
});

// T40c D4: checkOpsforgeState passes when from is explicitly null (start transition).
test('T40c checkOpsforgeState passes when from is null', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({
    state: 'staged',
    history: [{ ts: '2026-01-01T00:00:00Z', from: null, to: 'staged', pr: '#1' }],
  }));
  const cap = parseCapability(dir);
  const r = checkOpsforgeState(cap);
  assert.equal(r.status, 'pass', `null from is valid (start); got: ${r.detail}`);
});

// T_brand_iso Phase 3.4: brand isolation — a brand cap may NOT depend on another brand's cap.
test('T_brand_iso brand cap depending on a different brand fails depends_on_direction', () => {
  const tmp = mkRepo();
  // brand acme cap
  const acmeDir = path.join(tmp, 'customers', 'acme', 'packs', '_staged', 'acme', 'bot');
  fs.mkdirSync(acmeDir, { recursive: true });
  fs.writeFileSync(path.join(acmeDir, 'capability.yaml'), yaml.dump({
    id: 'acme.bot', version: '1.0.0', kind: 'agent', pack: 'acme', owner: 'acme',
    customer: 'acme',
    display_name: 'Bot', display_name_zh: 'Bot', display_name_en: 'Bot',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: ['acme2.other@^1.0.0'], // different brand!
    source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(acmeDir, 'source.md'), 'body content here that is long enough for the gate');
  fs.mkdirSync(path.join(acmeDir, 'tests'), { recursive: true });
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(acmeDir, 'tests', `c${i}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(acmeDir, 'CHANGELOG.md'), '# bot\n');
  // target brand acme2 cap
  const acme2Dir = path.join(tmp, 'customers', 'acme2', 'packs', '_staged', 'acme2', 'other');
  fs.mkdirSync(acme2Dir, { recursive: true });
  fs.writeFileSync(path.join(acme2Dir, 'capability.yaml'), yaml.dump({
    id: 'acme2.other', version: '1.0.0', kind: 'agent', pack: 'acme2', owner: 'acme2',
    customer: 'acme2',
    display_name: 'O', display_name_zh: 'O', display_name_en: 'O',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(acme2Dir, 'source.md'), 'body content here that is long enough');
  fs.mkdirSync(path.join(acme2Dir, 'tests'), { recursive: true });
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(acme2Dir, 'tests', `c${i}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(acme2Dir, 'CHANGELOG.md'), '# other\n');
  const allCaps = [parseCapability(acmeDir), parseCapability(acme2Dir)];
  const r = validateDir(acmeDir, { repoRoot: tmp, allCaps });
  const dep = r.checks.find((c) => c.name === 'depends_on_direction');
  assert.ok(dep, 'depends_on_direction should run');
  assert.equal(dep.status, 'fail', 'brand→other-brand dep must fail');
});

// T41 staged full validation passes with all R16-R22 + opsforge_state
test('T41 staged agent passes all checks including R16-R22', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({
    state: 'staged',
    history: [{ ts: '2026-01-01T00:00:00Z', from: 'draft', to: 'staged', pr: '#1' }],
  }));
  const { verdict, checks } = validateDir(dir, { repoRoot: tmp });
  assert.equal(verdict, 'pass', `staged agent should pass all checks; failing: ${checks.filter(c => c.status === 'fail').map(c => c.name).join(', ')}`);
});

// T42 staged agent fails when entrypoint missing (platform_conformance via conform)
test('T42 platform_conformance fails when entrypoint missing', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  fs.unlinkSync(path.join(dir, 'source.md'));
  const { checks } = validateDir(dir, { repoRoot: tmp });
  const pc = checks.find(c => c.name === 'platform_conformance');
  if (pc) {
    assert.equal(pc.status, 'fail');
    assert.ok(pc.detail.includes('entrypoint'));
  }
});

// T_report: main() writes validation-report.json per cap (P0-5)
test('T_report main() --all writes validation-report.json per cap dir', () => {
  const tmp = mkRepo();
  // Create a package.json so getRepoRoot() finds the temp dir
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"test-repo"}');
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  // Run main() via subprocess; isolate OPSFORGE_HOME so run artifacts don't pollute real home.
  const r = spawnSync(process.execPath, [path.resolve(__dirname, 'validate.mjs'), '--all'], {
    cwd: tmp, env: { ...process.env, OPSFORGE_HOME: path.join(tmp, '.opsforge') }, encoding: 'utf8',
  });
  const reportPath = path.join(dir, 'validation-report.json');
  assert.ok(fs.existsSync(reportPath), `validation-report.json should be written; stdout=${r.stdout} stderr=${r.stderr}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.ok(report.verdict, 'report should have verdict');
  assert.ok(report.checks, 'report should have checks');
  assert.equal(report.origin, 'original');
});

// T_report_rc D1: validation-report.json must carry REAL regression_cases from runSuite,
// not the hardcoded all-zero stub. The fixture has 3 test cases; static-only runner
// marks all 3 pending → pending_human===3 and total===3.
test('T_report_rc main() --all wires runSuite summary into regression_cases', () => {
  const tmp = mkRepo();
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"test-repo"}');
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  const r = spawnSync(process.execPath, [path.resolve(__dirname, 'validate.mjs'), '--all'], {
    cwd: tmp, env: { ...process.env, OPSFORGE_HOME: path.join(tmp, '.opsforge') }, encoding: 'utf8',
  });
  const reportPath = path.join(dir, 'validation-report.json');
  assert.ok(fs.existsSync(reportPath), `report missing; stdout=${r.stdout} stderr=${r.stderr}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const rc = report.regression_cases;
  assert.ok(rc, 'regression_cases must be present');
  assert.equal(rc.total, 3, `regression_cases.total should be 3 (3 fixture cases); got ${rc.total}`);
  assert.equal(rc.passed, 0);
  assert.equal(rc.failed, 0);
  assert.equal(rc.pending_human, 3, `pending_human should be 3 in static-only; got ${rc.pending_human}`);
  assert.ok(rc.runner, 'regression_cases should record the runner used');
});

// ---------- F2: dify platform_conformance ----------

// T_dify_pc F2: checkPlatformConformance accepts platforms:['dify']
test('T_dify_pc checkPlatformConformance accepts dify platform', () => {
  const tmp = mkRepo();
  const dir = makeCap({ tmp, state: 'staged', kind: 'agent' });
  let y = fs.readFileSync(path.join(dir, 'capability.yaml'), 'utf8');
  y = y.replace(/platforms: \[claude-code\]/, 'platforms: [dify]');
  fs.writeFileSync(path.join(dir, 'capability.yaml'), y);
  const { checks } = validateDir(dir, { repoRoot: tmp });
  const pc = checks.find((c) => c.name === 'platform_conformance');
  // dify is now a known platform — no 'unknown platform' failure.
  assert.ok(!pc || pc.status === 'pass', `platform_conformance should pass/absent for dify; got: ${pc && pc.detail}`);
});
