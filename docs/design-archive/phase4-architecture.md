I have read the plan, skill-up intel, and all the existing code files. I have enough context to produce the architecture. Below is the complete design document. The parent agent should land it at `D:\XD\ClaudeCode\sy-eeo\docs\design-archive\phase4-architecture.md`.

---

# Phase 4 架构与技术实施方案

> 产出：ecc:architect（2026-07-27）。基于 `docs/design-archive/phase4-skillup-fusion-plan.md`（planner 深化方案）+ 权威源代码（test-runner.mjs / validate.mjs / eval.mjs / opsforge.mjs / paths.mjs / new-capability.mjs / test-case.schema.json / guardrails.yml）。供 tdd-guide 直接据以 TDD 开发，无需再读 skill-up 情报。

## 0. 代码事实校准（影响所有切片的行号与签名）

读完权威源后确认/修正下列事实，tdd-guide 据此落代码：

1. **`schema/test-case.schema.json` 实有 10 properties**：`name` / `input` / `expect` / `expected` / `schema_ref` / `judge_rubric` / `judge_threshold` / `weight` / `platforms` / `timeout_ms`；`required: ["name","input","expect"]`；`additionalProperties:false`；`expect` enum 当前 7 值 `["exact","schema","contains","regex","llm_judge","golden","human"]`（L17）。→ 新增字段全部走"显式追加 properties + 同级子对象 additionalProperties:false"，closed-schema 不破。
2. **`tools/test-runner.mjs`**：
   - `SUPPORTED_MODES` Set 在 L15（**新增 `check` 后必须同步追加，否则 runCase L236 直接 fail**）。
   - `compareForMode(mode, actual, caseYaml, opts)` 在 L193，是 async 函数，分支 exact/contains/schema/regex/golden/llm_judge + default。
   - `runCase(capDir, caseYaml, opts = {})` 在 L231；L257 有 `if (opts.actual !== undefined)` 注入分支；L265 有 `runner === 'http'` 分支；L277 有 `runner === 'static-only'` 分支；L289 调 `executeDryRun`。
   - `executeHttpDryRun(capDir, caseYaml, opts)` 在 L311（**已存在，P2-A 多 engine 分派复用它做 dify 分支**）。
   - `executeDryRun(capDir, caseYaml, opts)` 在 L346（**P1-A 多轮 turns 扩展点 + P2-A 重命名为 `executeCliDryRun` 入口**）。
   - `runSuite(capDir, opts = {})` 在 L393；产物写 `~/.opsforge/runs/<eval-id>/results.json`（L423）。
3. **`tools/validate.mjs`**：
   - `SKELETON_GUARD_EXCLUSIONS` 在 L30（数组，4 项）→ P1-D benchmark-report.json 加这里。
   - `EXPECT_BLACKLIST` 在 L514（Set 7 项）→ R18 扩展复用。
   - `checkTestExpectNontrivial(cap)` 在 L517 → P0-A / P1-A / P1-B 都扩展此函数或同级新增。
   - `checkTestCasesDistinct(cap)` 在 L541，distinct key 在 L545（`{input, expect, expected}`）→ P1-A turns 需把 `turns` 加进 key。
   - `checkDraftRelaxed(cap, ctx)` 在 L405，checks 数组 → draft 态不触发新 R 规则（**新 R 规则只在 staged+**）。
   - `validateDir` staged 分支 L829-859，checks 数组按序 push → 新 R23 `test_turns_well_formed` 加在 `checkNoSelfCheatInBody` 之后、`checkScenarioSections` 之前。
   - ajv `strict: false`（L146）→ schema 加 enum/嵌套对象不会被 ajv 拒。
4. **`tools/eval.mjs`**：
   - `evaluateCap(capDir, opts = {})` 在 L70；`runSuite` 在 L78 调用；`computeAxes` 在 L29（纯函数）；写 `eval-report.json` 在 L125。
   - `loadConfig()` 在 L14 读 `tools/eval.config.yaml` → P1-D benchmark 段加进此 yaml。
   - **无 failures.jsonl 写入逻辑** → P0-B 在 L120 verdict 决出后插入 hook。
5. **`tools/opsforge.mjs`**：
   - `main(argv)` 在 L45，switch 在 L53 → P0-B `evolve` / P1-C `evals-import`/`evals-export` / P1-D `benchmark` 加 case。
   - `cmdFeedback(rl, opts)` 在 L415 → P0-B `evolve` 复用 `makeAsker()`（L89）与 `parseSimpleOpts`（L510）。
   - `parseSimpleOpts(argv)` 在 L510 → 子命令参数解析复用此函数。
6. **`tools/paths.mjs`**：`resolveHome()` L12、`resolveOpsforgeHome()` L18、`assertCapId` L82、`assertSlugSegment` L74、`atomicWriteSync` L57。**无 `resolveEvalHistoryDir`** → P0-B 新增。
7. **`tools/new-capability.mjs`**：`promote(srcPath, opts)` L180、`matchSkeletonSignature` L59、`writeOpsforgeState` L229。promote 前置 `matchSkeletonSignature`（L194）是 P0-B 回归草稿的人工 gate 强制点。
8. **`.github/workflows/guardrails.yml`**：path-guard filters 已覆盖 `tools/**` + `**/*.mjs` + `schema/**` + `templates/**`（L26-47）→ **Phase 4 所有新工具文件自动被 path-guard 保护，无需改 CI**。
9. **templates/skill/tests/case-01.yaml** 当前 8 字段实写（name/input/expect/expected/schema_ref/judge_rubric/judge_threshold/weight）→ P0-A 注释示例追加 `pre_gates: []` 默认；P1-A 新增 `templates/skill/tests/case-02.yaml` 多轮示例。

## A. 模块边界与依赖图

### A.1 模块清单（新增 vs 改现有）

| 切片 | 新增模块 | 改现有模块 |
|---|---|---|
| 1a (P0-A pre_gates) | `tools/test-pre-gates.test.mjs` | `schema/test-case.schema.json`、`tools/test-runner.mjs`（runCase 前置门 + compareForMode files_exist 分支）、`tools/validate.mjs`（R18 扩展 + `checkPreGatesNontrivial`）、`templates/skill/tests/case-01.yaml`（注释示例） |
| 1b (P0-B 回归闭环) | `tools/regression-sink.mjs`、`tools/test-regression-sink.test.mjs` | `tools/eval.mjs`（failures.jsonl hook）、`tools/opsforge.mjs`（`evolve` 子命令 + dispatch）、`tools/paths.mjs`（`resolveEvalHistoryDir` / `resolveEvalHistoryIterationDir` / `resolveFailuresJsonl`） |
| 2a (P1-A turns) | `tools/test-turns.test.mjs`、`templates/skill/tests/case-02.yaml` | `schema/test-case.schema.json`、`tools/test-runner.mjs`（executeDryRun 多轮分支）、`tools/validate.mjs`（R23 + R18/R19 扩展） |
| 2b (P1-B check) | `tools/test-check-mode.test.mjs` | `schema/test-case.schema.json`、`tools/test-runner.mjs`（`compareCheck` + SUPPORTED_MODES + compareForMode 分派）、`tools/validate.mjs`（R18 扩展） |
| 2c (P1-C evals.json) | `tools/evals-bridge.mjs`、`tools/test-evals-bridge.test.mjs` | `tools/opsforge.mjs`（`evals-import`/`evals-export` 子命令） |
| 2d (P1-D benchmark) | `tools/benchmark.mjs`、`tools/test-benchmark.test.mjs` | `tools/eval.config.yaml`（benchmark 段）、`tools/validate.mjs`（SKELETON_GUARD_EXCLUSIONS 加 `benchmark-report.json`）、`tools/test-runner.mjs`（`executeDryRun` 加 `baselineSystemPrompt` opts） |
| 3a (P2-A 多 engine) | `tools/test-multi-engine.test.mjs` | `tools/test-runner.mjs`（`executeDryRun` → `executeCliDryRun` 分派 + cursor/codex/cline spawn 分支） |
| 3b (P2-B iteration) | `tools/test-eval-iteration.test.mjs` | `tools/eval.mjs`（`--iteration N` flag + 归档）、`tools/opsforge.mjs`（`evolve` 读历史） |

### A.2 依赖图（吸收点顺序）

```
Slice 1a (pre_gates) ──┐
                       ├──► Slice 2a (turns)  ──┐
                       │                          ├──► Slice 3a (multi-engine)
Slice 1b (regression) ─┤                          │
                       │   Slice 2b (check)  ────┤
                       │                          │
                       │   Slice 2c (evals.json) ┤
                       │                          │
                       │   Slice 2d (benchmark) ──┤
                       │                          │
                       └──► Slice 3b (iteration) ──┘
```

**并行性分析**：
- **Slice 1a 与 1b 可并行**（1a 改 schema + test-runner 前置门；1b 新增 regression-sink + eval.mjs hook + paths.mjs；两者唯一交叠是 schema 文件，但 1a 加 `pre_gates` 字段、1b 不动 schema → 无冲突）。建议**先 1a 后 1b**串行，因 1a 改动小且把"前置门"模式确立下来供 1b 的 `regression-sink.generateCase` 默认值复用。
- **Slice 2a / 2b / 2c / 2d 可全并行**（2a/2b 各加一个 schema 字段互不冲突；2c/2d 不动 schema）。但 2a 与 2b 都改 `compareForMode` 调度（2a 加 turns 分支在 executeDryRun，2b 加 check 分支在 compareForMode switch）→ 若同一 PR 合并则需顺序 rebase，建议**串行 2a→2b**避免合并冲突。
- **Slice 3a 依赖 2a**（3a 重构 `executeDryRun` → `executeCliDryRun`，2a 已在 executeDryRun 加多轮分支，重构时需保留 turns 分支）。
- **Slice 3b 依赖 1b**（3b 的 `--iteration` 复用 1b 的 `resolveEvalHistoryDir`；`evolve` 读历史复用 1b 的 failures.jsonl 路径）。

**tdd-guide 推荐执行序**：1a → 1b → 2a → 2b → 2c → 2d → 3a → 3b。

---

## B. 接口契约（逐切片）

### Slice 1a：P0-A expect 两段前置门

#### B.1a.1 schema 改动（`schema/test-case.schema.json`）

在 `properties` 末尾追加（`additionalProperties:false` 在顶层与子对象全保留）：

```json
"pre_gates": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["mode", "expected"],
    "properties": {
      "mode": { "type": "string", "enum": ["contains", "regex", "exact", "files_exist"] },
      "expected": { "description": "contains/regex/exact → string|string[]; files_exist → string|string[] (relative paths from capDir)" }
    }
  }
}
```

注意：`expected` 在 items 层不限定类型（保留 `{}` 自由度，与顶层 `expected` 一致），由 `compareForMode` 在运行期解释。`files_exist` 模式 actual 当工作区根，路径用 `path.join(opts.capDir || '.', p)`（**Windows 兼容：必须 path.join，不拼字符串**）。

#### B.1a.2 函数签名

**`tools/test-runner.mjs` 改动**：

1. `compareForMode` 不变（pre_gates 复用它，不新增分支；`files_exist` 新增独立小函数）。

2. 新增纯函数（紧邻 `compareForMode` 之后，L223 之后）：
```js
/**
 * Check file existence relative to a workspace root.
 * @param {string[]} relPaths  relative paths from workspaceRoot
 * @param {string} workspaceRoot  absolute cap dir
 * @returns {{pass: boolean, reason: string, missing?: string[]}}
 * Pure: only fs.existsSync side-effect (read-only, no write).
 */
export function checkFilesExist(relPaths, workspaceRoot) {
  const paths = Array.isArray(relPaths) ? relPaths : [String(relPaths)];
  const missing = paths.filter((p) => !fs.existsSync(path.join(workspaceRoot, p)));
  return missing.length === 0
    ? { pass: true, reason: '' }
    : { pass: false, reason: `files_exist: missing ${missing.join(', ')}`, missing };
}
```

3. `runCase` 在 L231 体内、`compareForMode` 主调用之前（即 L257 `opts.actual` 注入分支之后、L265 `runner === 'http'` 之前；以及 claude 分支 L290 `executeDryRun` 之后、L301 `compareForMode` 之前各插一次，**或在 compareForMode 调用前统一前置**）插入：
```js
// pre_gates: zero-cost front gates (skip llm_judge fetch on fail)
if (Array.isArray(caseYaml.pre_gates) && caseYaml.pre_gates.length > 0) {
  const actualForGate = opts.actual !== undefined ? String(opts.actual)
    : (runner === 'static-only' ? '' : '<pending-execution>');
  // For static-only + no injected actual, gates cannot run → fall through to pending.
  if (actualForGate !== '<pending-execution>') {
    for (const g of caseYaml.pre_gates) {
      const gr = g.mode === 'files_exist'
        ? checkFilesExist(g.expected, opts.capDir || capDir)
        : await compareForMode(g.mode, actualForGate, { expected: g.expected }, { ...opts, capDir });
      if (!gr.pass) {
        return {
          case: caseYaml.name || '<unnamed>',
          mode,
          pass: false,
          runner,
          reason: `pre_gate(${g.mode}) failed: ${gr.reason || ''}`,
          actual: actualForGate,
        };
      }
    }
  }
}
```

**关键决策**：pre_gates 在 `opts.actual` 注入分支（L257）之后执行——意味着 `eval.mjs` 注入 actual 后才跑前置门；static-only 模式无 actual → 不跑前置门（直接走 pending）。这保证 CI static-only 不会误报 pre_gate fail。

#### B.1a.3 数据流

输入：`<capDir>/tests/case-NN.yaml` 的 `pre_gates` 字段 → `runCase` 读取 → `compareForMode`/`checkFilesExist` 比对 → 输出 `~/.opsforge/runs/<eval-id>/results.json` 的 `cases[].reason`（前置门失败时 reason 含 `pre_gate(...)`）。

#### B.1a.4 与现有 gate 衔接

- **R18 `checkTestExpectNontrivial`（validate.mjs L517）扩展**：在 L519 for 循环体内，对 `c.pre_gates` 数组每条 `expected` 走与现有 `c.expected` 相同的 length<=3 / EXPECT_BLACKLIST 检查；`files_exist` 模式 expected 为路径字符串，仍走 length<=3 检查（路径必 >3 字符）。
- **新增 `checkPreGatesNontrivial(cap)`**（紧邻 `checkTestExpectNontrivial` 之后）：staged+ 检查 `pre_gates` 数组结构合法性（每项必须有 `mode` ∈ 4 值、`expected` 非空）。**不替换 R18**，是同级补充规则，加入 `validateDir` staged checks 数组（L853 之后）。
- **不绕过任何人工 gate**：pre_gates 在 test-case schema 内，贡献者写 yaml 即触发 R18 + 新规则。

---

### Slice 1b：P0-B 失败→自动沉淀回归用例闭环

#### B.1b.1 schema 改动

**无**（regression-sink 生成的草稿遵守现有 test-case schema）。

#### B.1b.2 函数签名

**`tools/paths.mjs` 新增 3 个纯函数**（紧邻 `resolveOpsforgeHome` 之后，L20）：

```js
/**
 * Resolve ~/.opsforge/eval-history/<cap-id>/ (created on first write).
 * @param {string} capId  "<pack>.<name>" — asserted via assertCapId
 * @returns {string} absolute dir
 */
export function resolveEvalHistoryDir(capId) {
  assertCapId(capId);
  return path.join(resolveOpsforgeHome(), 'eval-history', capId);
}

/**
 * Resolve ~/.opsforge/eval-history/<cap-id>/iteration-<N>/.
 * @param {string} capId
 * @param {number} n  iteration number (>=0; 0 means "latest", no subdir)
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
```

**`tools/eval.mjs` 改动**（L120 verdict 决出之后、L124 `if (opts.write)` 之前）：

```js
// Phase 4 P0-B: archive failures for regression-sink consumption.
if (verdict === 'fail') {
  try {
    const { resolveFailuresJsonl } = await import('./paths.mjs');
    const failPath = resolveFailuresJsonl(id);
    fs.mkdirSync(path.dirname(failPath), { recursive: true });
    const lines = cases
      .filter((c) => c.pass === false)
      .map((c) => JSON.stringify({
        cap_id: id,
        case: c.case,
        mode: c.mode,
        reason: String(c.reason || '').slice(0, 500),
        actual: String(c.actual ?? '').slice(0, 500),
        ts: new Date().toISOString(),
      }))
      .join('\n') + (cases.some((c) => c.pass === false) ? '\n' : '');
    if (lines.trim()) fs.appendFileSync(failPath, lines);
  } catch (e) {
    // Non-fatal: eval must not fail because archiving failed.
    report.archive_error = e.message;
  }
}
```

**`tools/regression-sink.mjs` 新模块**（steering 拥有，path-guard 已覆盖 `tools/**`）：

```js
// tools/regression-sink.mjs — Phase 4 P0-B: 失败/反馈 → tests/case-NN.yaml 草稿生成器。
// 纯函数 + 副作用仅 fs.mkdirSync/fs.writeFileSync（落 _drafts/）。不自动 promote。
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { assertCapId, assertSlugSegment } from './paths.mjs';

const NAME_RE = /^[a-z][a-z0-9-]{2,30}$/;

/**
 * CJK-tolerant slugify: lowercases ASCII, strips non-[a-z0-9-], CJK → pinyin
 * fallback NOT used (no new dep). Instead: hash CJK runs to a stable short
 * ascii prefix "c<base36(hash)>" to keep slug matching NAME_RE.
 * @param {string} text
 * @returns {string} slug matching ^[a-z][a-z0-9-]{2,30}$ (truncated to 30 chars)
 */
export function slugify(text) {
  const src = String(text || '').trim().toLowerCase();
  // ASCII-prefixed fast path: if text starts with [a-z], keep [a-z0-9-] only.
  const ascii = src.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii && NAME_RE.test(ascii.slice(0, 30))) {
    return ascii.slice(0, 30);
  }
  // CJK or empty: derive a stable ascii slug via djb2 hash → "c<base36>".
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  const slug = 'c' + h.toString(36);
  // Pad to satisfy {2,30} (slug is 'c' + ≥2 chars).
  return slug.padEnd(3, '0').slice(0, 30);
}

/**
 * Resolve name conflicts by appending -2, -3, ... until no existing case file
 * at <draftsDir>/tests/case-<NN>.yaml has this name in its `name:` field.
 * @param {string} baseName  initial slug
 * @param {string} draftsDir absolute _drafts/<pack>/<name>/ path
 * @returns {string} unique name matching NAME_RE
 */
export function resolveNameConflict(baseName, draftsDir) {
  const testsDir = path.join(draftsDir, 'tests');
  const existing = new Set();
  if (fs.existsSync(testsDir)) {
    for (const f of fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml'))) {
      try {
        const parsed = yaml.load(fs.readFileSync(path.join(testsDir, f), 'utf8'));
        if (parsed && parsed.name) existing.add(parsed.name);
      } catch { /* skip */ }
    }
  }
  let name = baseName;
  let i = 2;
  while (existing.has(name)) {
    const suffix = `-${i}`;
    name = (baseName.slice(0, 30 - suffix.length) + suffix);
    if (!NAME_RE.test(name)) name = baseName.slice(0, 27) + suffix;
    i++;
  }
  return name;
}

/**
 * Generate a tests/case-NN.yaml draft from a feedback entry or eval failure.
 * ALWAYS leaves expected / judge_rubric as __FILL_ME__ (R7 + R18 enforce human fill).
 *
 * @param {{cap_id: string, rating?: number, text?: string}} feedback   feedback jsonl entry (rating<=3 used)
 * @param {{cap_id: string, case?: string, mode?: string, reason?: string, actual?: string}} failure  failures.jsonl entry
 * @param {{draftsDir: string, caseNum?: number}} opts  draftsDir = absolute _drafts/<pack>/<name>/
 * @returns {{destPath: string, name: string, yaml: string}} written draft
 * @throws if neither feedback nor failure provides usable text
 */
export function generateCase(feedback, failure, opts) {
  if (!opts || !opts.draftsDir) throw new Error('generateCase: opts.draftsDir required');
  const capId = (feedback && feedback.cap_id) || (failure && failure.cap_id);
  assertCapId(capId);
  const text = (feedback && feedback.text && feedback.text.trim())
    || (failure && failure.actual && String(failure.actual).slice(0, 200))
    || '';
  if (!text) throw new Error('generateCase: no usable text in feedback or failure');
  const baseName = slugify(text.slice(0, 30));
  const name = resolveNameConflict(baseName, opts.draftsDir);
  // expect heuristic: failure with contains-mode reason → contains; else llm_judge.
  const reasonStr = String((failure && failure.reason) || '');
  const expect = /contains|substring|missing substr/i.test(reasonStr) ? 'contains' : 'llm_judge';
  const caseYaml = {
    name,
    input: text.slice(0, 200),
    expect,
    expected: '__FILL_ME__',
    schema_ref: null,
    judge_rubric: '__FILL_ME__',
    judge_threshold: 0.7,
    weight: 1.0,
  };
  const testsDir = path.join(opts.draftsDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  const existing = fs.existsSync(testsDir)
    ? fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).length
    : 0;
  const num = String(existing + 1).padStart(2, '0');
  const destPath = path.join(testsDir, `case-${num}.yaml`);
  fs.writeFileSync(destPath, yaml.dump(caseYaml, { lineWidth: 120 }));
  return { destPath, name, yaml: yaml.dump(caseYaml) };
}

/**
 * Read feedback jsonl + failures.jsonl for a capId, return "to-sink" entries.
 * @param {string} capId
 * @param {{opsforgeHome?: string}} opts
 * @returns {Promise<{feedbacks: Array, failures: Array}>}  feedbacks filtered to rating<=3
 */
export async function collectSources(capId, opts = {}) {
  assertCapId(capId);
  const { resolveOpsforgeHome, resolveFailuresJsonl } = await import('./paths.mjs');
  const home = opts.opsforgeHome || resolveOpsforgeHome();
  const pack = capId.split('.')[0];
  const fbPath = path.join(home, 'kb', pack, 'feedback', `${capId}.jsonl`);
  const feedbacks = [];
  if (fs.existsSync(fbPath)) {
    for (const line of fs.readFileSync(fbPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.rating === 'number' && e.rating <= 3) feedbacks.push(e);
      } catch { /* skip */ }
    }
  }
  const failPath = resolveFailuresJsonl(capId);
  const failures = [];
  if (fs.existsSync(failPath)) {
    for (const line of fs.readFileSync(failPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try { failures.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  return { feedbacks, failures };
}
```

**`tools/opsforge.mjs` 改动**（main switch L53 之后加 case，cmdFeedback 之后 L436 加 `cmdEvolve`）：

```js
case 'evolve': return await cmdEvolveInteractive(argv.slice(1));
```

```js
/**
 * opsforge evolve <capDir|capId> — 列待沉淀条目，多选后写 _drafts/ 草稿。
 * 不自动 promote（人工 gate 强制点）。
 */
async function cmdEvolveInteractive(args) {
  if (!requireTty('evolve')) return 2;
  const opts = parseSimpleOpts(args);
  const target = opts._[0];
  if (!target) { console.error('opsforge evolve: 需提供 capDir 或 capId'); return 2; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await cmdEvolve(rl, { target, opsforgeHome: opts.opsforgeHome });
  } finally { rl.close(); }
}

/**
 * @param {readline.Interface} rl
 * @param {{target: string, opsforgeHome?: string, workDir?: string}} opts
 * @returns {Promise<number>}
 */
export async function cmdEvolve(rl, opts = {}) {
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const { parseCapability } = await import('./validate.mjs');
  const { collectSources, generateCase } = await import('./regression-sink.mjs');
  const { resolveWorkDir } = await import('./opsforge-runtime.mjs');
  // target 可能是 capId 或 capDir；优先按 capId 处理。
  let capId, capDir;
  try {
    const { assertCapId } = await import('./paths.mjs');
    assertCapId(opts.target);
    capId = opts.target;
  } catch {
    // 按 capDir 解析。
    const cap = parseCapability(path.resolve(opts.target));
    if (!cap.yaml) { console.error(`evolve: 无法解析能力目录 ${opts.target}`); return 1; }
    capId = cap.yaml.id;
    capDir = cap.dir;
  }
  const { feedbacks, failures } = await collectSources(capId, { opsforgeHome: opts.opsforgeHome });
  if (feedbacks.length === 0 && failures.length === 0) {
    console.log('○ 没有可沉淀的反馈/失败条目（feedback rating<=3 或 eval failures）。');
    return 0;
  }
  console.log(`找到 ${feedbacks.length} 条低分反馈 + ${failures.length} 条 eval 失败。`);
  // 列条目，用户多选（用 1,3,5 这种语法）。
  const items = [];
  for (const f of feedbacks) items.push({ kind: 'feedback', label: `[反馈 ${f.rating}★] ${String(f.text||'').slice(0,60)}`, src: f });
  for (const f of failures) items.push({ kind: 'failure', label: `[失败 ${f.case||''} ${f.mode||''}] ${String(f.reason||'').slice(0,60)}`, src: null, failure: f });
  items.forEach((it, i) => console.log(`  ${i + 1}) ${it.label}`));
  const sel = (await ask('选择要沉淀的序号（逗号分隔，回车=全部）: ')).trim();
  const idxs = sel === '' ? items.map((_, i) => i) : sel.split(',').map((s) => Number(s.trim()) - 1).filter((n) => n >= 0 && n < items.length);
  if (idxs.length === 0) { console.log('未选择，已退出。'); return 0; }
  // 确定 draftsDir：capId → _drafts/<pack>/<name>/
  const pack = capId.split('.')[0];
  const name = capId.split('.')[1];
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  const draftsDir = path.join(workDir, 'packs', '_drafts', pack, name);
  let written = 0;
  for (const i of idxs) {
    const it = items[i];
    try {
      const fb = it.kind === 'feedback' ? it.src : null;
      const fail = it.kind === 'failure' ? it.failure : null;
      const { destPath, name: caseName } = generateCase(fb, fail, { draftsDir });
      console.log(`  绿 已生成 ${destPath} (name=${caseName})`);
      written++;
    } catch (e) { console.log(`  [红] 跳过 #${i + 1}: ${e.message}`); }
  }
  console.log(`\n已生成 ${written} 条草稿到 ${draftsDir}/tests/。`);
  console.log('下一步: 填写 expected + judge_rubric（标记 __FILL_ME__ 的位置），然后:');
  console.log(`  node tools/new-capability.mjs --promote ${draftsDir}`);
  console.log('草稿含 __FILL_ME__，draft gate (R7) 会挡住未填实的草稿——这是人工 gate。');
  return 0;
}
```

#### B.1b.3 数据流

```
源 1: ~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl  (rating<=3 entries)
源 2: ~/.opsforge/eval-history/<cap-id>/failures.jsonl  (eval.mjs verdict=fail 时 append)
        │
  opsforge evolve <capDir|capId>  (用户触发，cmdEvolve)
        │
  regression-sink.collectSources(capId)
        │
  用户多选 → regression-sink.generateCase(feedback, failure, {draftsDir})
        │
  写 <repoRoot>/packs/_drafts/<pack>/<name>/tests/case-NN.yaml
  字段：name(填实) / input(填实) / expect(填实) / expected=__FILL_ME__ / judge_rubric=__FILL_ME__
        │
  【draft gate】validate.mjs checkDraftRelaxed → R7 placeholder_clean 检测到 __FILL_ME__ → verdict=fail
        │
  用户填 expected + judge_rubric（填空式）
        │
  node tools/new-capability.mjs --promote <path>
     ├─ matchSkeletonSignature (防手改骨架)
     └─ _drafts/ → _staged/ → staged gate (R1-R22 + R23 + R_scenario + functional runSuite)
        │
  release.mjs (validation+security+eval 三报告 gate)
        │
  registry.yaml (auto-aggregated)
```

#### B.1b.4 与现有 gate 衔接

- **eval.mjs verdict=fail** 触发写 `failures.jsonl`（L120 hook，不绕过 eval gate）。
- **regression-sink 永远不写 expected/judge_rubric 实值**（强制 R7 + R18 人工填）。
- **`--promote`** 前置 `matchSkeletonSignature`（new-capability.mjs L194）——草稿若手改骨架文件会被拒。
- **不绕过任何 gate**：草稿落 `_drafts/` 走 draft gate；promote 后走 staged gate。

---

### Slice 2a：P1-A 多轮 turns + post_condition

#### B.2a.1 schema 改动

在 `properties` 末尾追加：
```json
"turns": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["role", "content"],
    "properties": {
      "role": { "type": "string", "enum": ["user", "assistant"] } },
      "content": { "type": "string", "minLength": 1 },
      "post_condition": {
        "type": "object",
        "additionalProperties": false,
        "required": ["must_contain_any", "on_fail"],
        "properties": {
          "must_contain_any": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
          "on_fail": { "type": "string", "enum": ["skip", "fail"] }
        }
      }
    }
  }
}
```

#### B.2a.2 函数签名

**`tools/test-runner.mjs` 改动**（`executeDryRun` L346 体内）：

```js
// P1-A: multi-turn support. If caseYaml.turns is non-empty, drive claude -p
// with --input-format stream-json, sending each turn as a JSON user message
// and reading stdout between turns to apply post_condition.
if (Array.isArray(caseYaml.turns) && caseYaml.turns.length > 0) {
  return await executeMultiTurnDryRun(capDir, caseYaml, opts);
}
```

新增 `executeMultiTurnDryRun`（紧邻 `executeDryRun` 之后）：
```js
/**
 * Multi-turn dry-run: spawn claude -p --input-format stream-json --output-format stream-json.
 * Send each turn.user content as {"type":"user","message":{"role":"user","content":<str>}}\n
 * on stdin; read stdout stream-json lines until an assistant result message arrives.
 * Apply post_condition.{must_contain_any,on_fail} between turns.
 *
 * @param {string} capDir
 * @param {Object} caseYaml  must have turns: [{role, content, post_condition?}]
 * @param {Object} opts  {timeout_ms?, baselineSystemPrompt?}
 * @returns {Promise<string>}  last assistant turn content (becomes `actual`)
 * Pure I/O: only spawn + stdin/stdout + fs.readFileSync (systemPrompt).
 */
async function executeMultiTurnDryRun(capDir, caseYaml, opts = {}) {
  const cap = parseCapability(capDir);
  const y = cap.yaml;
  let systemPrompt = (y.entrypoint && fs.existsSync(path.join(capDir, y.entrypoint)))
    ? fs.readFileSync(path.join(capDir, y.entrypoint), 'utf8')
    : '';
  if (opts.baselineSystemPrompt) systemPrompt = opts.baselineSystemPrompt;
  const { spawn } = await import('node:child_process');
  const argv = ['claude', '-p', `--system-prompt=${systemPrompt}`,
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages'];
  return new Promise((resolve, reject) => {
    const proc = spawn(argv[0], argv.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: opts.timeout_ms || caseYaml.timeout_ms || 30000,
    });
    let stdoutBuf = '';
    let lastAssistantText = '';
    let turnIdx = 0;
    let skipping = false;

    const sendTurn = (idx) => {
      if (idx >= caseYaml.turns.length) {
        try { proc.stdin.end(); } catch { /* closed */ }
        return;
      }
      const t = caseYaml.turns[idx];
      if (t.role !== 'user') {
        // assistant turn in yaml = assertion fixture; skip sending, advance.
        sendTurn(idx + 1);
        return;
      }
      const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: t.content } }) + '\n';
      try { proc.stdin.write(payload); } catch (e) { reject(new Error(`stdin write failed: ${e.message}`)); }
    };

    proc.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        // Assistant result message has type "assistant" or "result".
        if (msg.type === 'assistant' && msg.message && msg.message.content) {
          const text = Array.isArray(msg.message.content)
            ? msg.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
            : String(msg.message.content);
          if (text) lastAssistantText = text;
        } else if (msg.type === 'result') {
          // end of turn — apply post_condition for the turn just completed.
          const turn = caseYaml.turns[turnIdx];
          if (turn && turn.post_condition && !skipping) {
            const hit = turn.post_condition.must_contain_any.some((s) => lastAssistantText.includes(s));
            if (!hit) {
              if (turn.post_condition.on_fail === 'fail') {
                proc.kill(); reject(new Error(`post_condition fail at turn ${turnIdx}: missing ${turn.post_condition.must_contain_any.join('|')}`)); return;
              } else { skipping = true; } // skip → mark remaining turns skipped
            }
          }
          turnIdx++;
          if (turnIdx < caseYaml.turns.length) sendTurn(turnIdx);
          else { try { proc.stdin.end(); } catch {} }
        }
      }
    });
    proc.stderr.on('data', (d) => { /* capture but don't fail */ });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) return reject(new Error(`claude stream-json exited ${code}`));
      resolve(lastAssistantText.trim());
    });
    // Kick off turn 0.
    sendTurn(0);
  });
}
```

**关键决策（Windows）**：用 `spawn` + `proc.stdin.write(Buffer string)` + 行缓冲读 stdout，**不用 `execFileSync`**（execFileSync 同步阻塞 stdin 无法多轮流式喂入；spawn 是异步非阻塞，Windows 兼容）。stdin payload 以 `\n` 结尾的 UTF-8 Buffer 字符串（claude stream-json 行协议）。

**`tools/validate.mjs` 改动**：

1. **R23 `test_turns_well_formed`**（紧邻 `checkTestCasesDistinct` 之后 L552）：
```js
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
```
加入 `validateDir` staged checks（L853 `checkTestCasesDistinct` 之后）。

2. **R18 扩展**（`checkTestExpectNontrivial` L517）：turns 非空时，`expected` 允许为空（多轮断言走 post_condition），但每 `post_condition.must_contain_any` 项 ≥3 字符已由 R23 覆盖。R18 只在非 turns 模式强制 `expected` 非空。

3. **R19 distinct key 扩展**（L545）：`JSON.stringify({ input: c.input, expect: c.expect, expected: c.expected, turns: c.turns || [] })`。

#### B.2a.3 数据流

`tests/case-NN.yaml` 的 `turns` → `executeDryRun` 分派到 `executeMultiTurnDryRun` → spawn claude stream-json → 每轮 stdout → post_condition 比对 → 最终 `lastAssistantText` 作为 `actual` → `compareForMode` 走主 expect。

#### B.2a.4 与现有 gate 衔接

- R23 同级新增（staged+），不弱化 R16-R22。
- R18/R19 扩展 turns 模式，draft 态不触发（draft gate 不含 R18/R19/R23）。

---

### Slice 2b：P1-B 结构化断言 expect=check

#### B.2b.1 schema 改动

`expect` enum 追加 `"check"`（L17）。无其他字段改动——`expected` 在 check 模式为对象。

#### B.2b.2 函数签名

**`tools/test-runner.mjs`**：
1. `SUPPORTED_MODES` L15 加 `'check'`。
2. 新增 `compareCheck`（紧邻 `compareGolden` L116 之后）：
```js
/**
 * Structured assertions: tool_called / files_exist / files_not_exist / must_contain / must_not_contain.
 * Phase 4: text-contains matching (precise tool-call block parsing deferred).
 * @param {string} actual  transcript text (may include stream-json lines)
 * @param {Object} expected  shape: { tool_called?: {name, args?}, files_exist?: string[], files_not_exist?: string[], must_contain?: string[], must_not_contain?: string[] }
 * @param {Object} opts  {capDir?: string}
 * @returns {{pass: boolean, reason: string, actual: string}}
 * Side effects: fs.existsSync only (read-only).
 */
export function compareCheck(actual, expected, opts = {}) {
  if (!expected || typeof expected !== 'object') return { pass: false, reason: 'check: expected must be object', actual };
  const act = String(actual);
  const ws = opts.capDir || '.';
  if (expected.tool_called) {
    const tc = expected.tool_called;
    if (!tc.name || typeof tc.name !== 'string') return { pass: false, reason: 'check: tool_called.name required', actual };
    // Text-contains match: look for "name":"<tc.name>" in transcript (stream-json tool_use blocks).
    const needle = `"name":"${tc.name}"`;
    if (!act.includes(needle)) return { pass: false, reason: `check: tool_called "${tc.name}" not found in transcript`, actual };
    if (tc.args && typeof tc.args === 'object') {
      const argsJson = JSON.stringify(tc.args).slice(0, 200);
      if (!act.includes(argsJson)) return { pass: false, reason: `check: tool_called "${tc.name}" args mismatch (text-contains)`, actual };
    }
  }
  if (Array.isArray(expected.files_exist)) {
    for (const p of expected.files_exist) {
      if (!fs.existsSync(path.join(ws, p))) return { pass: false, reason: `check: files_exist missing ${p}`, actual };
    }
  }
  if (Array.isArray(expected.files_not_exist)) {
    for (const p of expected.files_not_exist) {
      if (fs.existsSync(path.join(ws, p))) return { pass: false, reason: `check: files_not_exist present ${p}`, actual };
    }
  }
  if (Array.isArray(expected.must_contain)) {
    for (const s of expected.must_contain) {
      if (!act.includes(String(s))) return { pass: false, reason: `check: must_contain missing ${String(s).slice(0,60)}`, actual };
    }
  }
  if (Array.isArray(expected.must_not_contain)) {
    for (const s of expected.must_not_contain) {
      if (act.includes(String(s))) return { pass: false, reason: `check: must_not_contain present ${String(s).slice(0,60)}`, actual };
    }
  }
  return { pass: true, reason: '', actual };
}
```
3. `compareForMode` L193 switch 加 `case 'check': return { ...compareCheck(actual, caseYaml.expected, { capDir: opts.capDir }), actual };`。

**`tools/validate.mjs`**：R18 `checkTestExpectNontrivial` L517 体内加：`if (c.expect === 'check') { if (!c.expected || typeof c.expected !== 'object' || Object.keys(c.expected).length === 0) return fail; }`。

#### B.2b.3 数据流 & gate

- 输入 `tests/case-NN.yaml` expect=check + expected=对象 → `runCase` → `compareForMode('check', actual, ...)` → `compareCheck` → 比对 transcript + fs.existsSync。
- R18 扩展（staged+），draft 不触发。

---

### Slice 2c：P1-C evals.json 双向桥接

#### B.2c.1 schema 改动

**无**（evals.json 是外部格式，桥接模块负责映射）。

#### B.2c.2 函数签名

**`tools/evals-bridge.mjs` 新模块**：

```js
// tools/evals-bridge.mjs — Phase 4 P1-C: evals.json 双向桥接（Anthropic 标准格式）。
// 纯函数 + fs 读写（导入落 _drafts/，导出读 tests/*.yaml）。不引新依赖。
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { assertCapId, assertSlugSegment } from './paths.mjs';

const COMPARATOR_MAP = {
  exact: 'equals', contains: 'contains_all', regex: 'regex', schema: 'json_schema',
  llm_judge: 'judge', golden: 'fuzzy_match', check: 'custom', human: 'manual',
};

/**
 * Map an OpsForge case yaml → evals.json case object (Anthropic shape).
 * Pure; no I/O.
 */
export function exportCase(caseYaml) {
  const out = {
    case_id: caseYaml.name,
    user_message: typeof caseYaml.input === 'string' ? caseYaml.input : JSON.stringify(caseYaml.input),
    expected_comparator: COMPARATOR_MAP[caseYaml.expect] || 'manual',
    expected_value: caseYaml.expected,
  };
  if (caseYaml.judge_rubric) out.rubric = caseYaml.judge_rubric;
  if (typeof caseYaml.judge_threshold === 'number') out.pass_threshold = caseYaml.judge_threshold;
  if (caseYaml.schema_ref) out.expected_value = { schema: caseYaml.schema_ref, value: caseYaml.expected };
  if (Array.isArray(caseYaml.pre_gates) && caseYaml.pre_gates.length) {
    out.preconditions = caseYaml.pre_gates.map((g) => ({ type: g.mode, value: g.expected }));
  }
  if (Array.isArray(caseYaml.turns) && caseYaml.turns.length) {
    out.turns = caseYaml.turns.map((t) => ({ role: t.role, content: t.content }));
  }
  // metadata.opsforge.* round-trip carrier
  out.metadata = { opsforge: { weight: caseYaml.weight, timeout_ms: caseYaml.timeout_ms, platforms: caseYaml.platforms } };
  return out;
}

/**
 * Map an evals.json case → OpsForge case yaml object.
 * Inverse of exportCase; missing fields → __FILL_ME__ (human fills).
 */
export function importCase(evalsCase) {
  const revMap = Object.fromEntries(Object.entries(COMPARATOR_MAP).map(([k, v]) => [v, k]));
  const expect = revMap[evalsCase.expected_comparator] || 'llm_judge';
  const c = {
    name: evalsCase.case_id || 'imported-case',
    input: typeof evalsCase.user_message === 'string' ? evalsCase.user_message : JSON.stringify(evalsCase.user_message || ''),
    expect,
    expected: (evalsCase.expected_value !== undefined && evalsCase.expected_value !== null)
      ? evalsCase.expected_value : '__FILL_ME__',
    schema_ref: null,
    judge_rubric: evalsCase.rubric || '__FILL_ME__',
    judge_threshold: typeof evalsCase.pass_threshold === 'number' ? evalsCase.pass_threshold : 0.7,
    weight: 1.0,
  };
  if (evalsCase.metadata && evalsCase.metadata.opsforge) {
    const m = evalsCase.metadata.opsforge;
    if (typeof m.weight === 'number') c.weight = m.weight;
    if (typeof m.timeout_ms === 'number') c.timeout_ms = m.timeout_ms;
    if (Array.isArray(m.platforms)) c.platforms = m.platforms;
  }
  return c;
}

/**
 * Export: read <capDir>/tests/*.yaml → evals.json object.
 * @param {string} capDir
 * @returns {{schema_version: string, cases: Array}}  evals.json shape
 */
export function exportToEvalsJson(capDir) {
  const testsDir = path.join(capDir, 'tests');
  const cases = [];
  if (fs.existsSync(testsDir)) {
    for (const f of fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).sort()) {
      try {
        const parsed = yaml.load(fs.readFileSync(path.join(testsDir, f), 'utf8'), { filename: f });
        if (parsed) cases.push(exportCase(parsed));
      } catch { /* skip */ }
    }
  }
  return { schema_version: 'v1alpha1', cases };
}

/**
 * Import: evals.json → tests/case-NN.yaml drafts in <draftsDir>/tests/.
 * If draftsDir doesn't exist, caller (opsforge.mjs) scaffolds via new-capability first.
 * Missing expected/rubric → __FILL_ME__ (R7 + R18 enforce human fill on promote).
 *
 * @param {Object} evalsJson  parsed evals.json
 * @param {{draftsDir: string, startNum?: number}} opts
 * @returns {{written: string[], skipped: number}}
 */
export function importFromEvalsJson(evalsJson, opts) {
  if (!opts || !opts.draftsDir) throw new Error('importFromEvalsJson: opts.draftsDir required');
  const testsDir = path.join(opts.draftsDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  const start = opts.startNum || (fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter((f)=>f.endsWith('.yaml')).length + 1 : 1);
  const written = [];
  let skipped = 0;
  const items = Array.isArray(evalsJson) ? evalsJson : (evalsJson.cases || []);
  items.forEach((ec, i) => {
    try {
      const c = importCase(ec);
      const num = String(start + i).padStart(2, '0');
      const dest = path.join(testsDir, `case-${num}.yaml`);
      fs.writeFileSync(dest, yaml.dump(c, { lineWidth: 120 }));
      written.push(dest);
    } catch { skipped++; }
  });
  return { written, skipped };
}
```

**`tools/opsforge.mjs` 改动**（main switch L53 加 case）：
```js
case 'evals-import': return await cmdEvalsImport(argv.slice(1));
case 'evals-export': return await cmdEvalsExport(argv.slice(1));
```
两个函数复用 `parseSimpleOpts`，调 `evals-bridge.mjs`。导入时若 `<draftsDir>` 不存在则先调 `new-capability.mjs scaffold`。

#### B.2c.3 数据流 & gate

- 导入：`evals.json` → `importFromEvalsJson` → `_drafts/<pack>/<name>/tests/case-NN.yaml`（含 `__FILL_ME__`）→ draft gate R7 挡 → 用户填 → `--promote` → staged gate。
- 导出：`<capDir>/tests/*.yaml` → `exportToEvalsJson` → stdout `evals.json`（只读，不落仓内）。

---

### Slice 2d：P1-D benchmark with/without skill

#### B.2d.1 schema 改动

**无**。`tools/eval.config.yaml` 加段：
```yaml
benchmark:
  enabled: false
  baseline_prompt: "You are a helpful assistant. Answer the user's request."
  min_delta: 0.1
```

#### B.2d.2 函数签名

**`tools/benchmark.mjs` 新模块**：
```js
// tools/benchmark.mjs — Phase 4 P1-D: with/without skill delta benchmark (advisory).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { atomicWriteSync } from './paths.mjs';

/**
 * Run benchmark for a capability: runSuite twice (with-skill + without-skill),
 * compute delta, write benchmark-report.json. Advisory — not in release gate.
 *
 * @param {string} capDir
 * @param {{runner?: string, platform?: string, opsforgeHome?: string, configPath?: string, runSuite: Function}} opts
 * @returns {Promise<{cap_id: string, with_skill: Object, without_skill: Object, delta: number, verdict: string}>}
 * Side effect: writes <capDir>/benchmark-report.json.
 */
export async function runBenchmark(capDir, opts = {}) {
  const { runSuite } = opts.runSuite ? { runSuite: opts.runSuite } : await import('./test-runner.mjs');
  const { parseCapability } = await import('./validate.mjs');
  const cap = parseCapability(capDir);
  const id = (cap.yaml && cap.yaml.id) || path.basename(capDir);
  // Load baseline prompt from eval.config.yaml.
  const cfgPath = opts.configPath || path.join(path.dirname(new URL('.', import.meta.url).pathname), 'eval.config.yaml');
  let baseline = 'You are a helpful assistant. Answer the user\'s request.';
  let minDelta = 0.1;
  try {
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.benchmark) {
      if (typeof cfg.benchmark.baseline_prompt === 'string') baseline = cfg.benchmark.baseline_prompt;
      if (typeof cfg.benchmark.min_delta === 'number') minDelta = cfg.benchmark.min_delta;
    }
  } catch { /* defaults */ }

  const { summary: withS } = await runSuite(capDir, { runner: opts.runner, platform: opts.platform, opsforgeHome: opts.opsforgeHome });
  const { summary: withoutS } = await runSuite(capDir, { runner: opts.runner, platform: opts.platform, opsforgeHome: opts.opsforgeHome, baselineSystemPrompt: baseline });

  const withOverall = withS.score_mean || 0;
  const withoutOverall = withoutS.score_mean || 0;
  const delta = Math.round((withOverall - withoutOverall) * 1000) / 1000;
  const verdict = delta >= minDelta ? 'effective' : 'neutral';
  const report = {
    cap_id: id,
    with_skill: { overall: withOverall, n: withS.total, passed: withS.passed },
    without_skill: { overall: withoutOverall, n: withoutS.total, passed: withoutS.passed },
    delta,
    min_delta: minDelta,
    verdict,
  };
  atomicWriteSync(path.join(capDir, 'benchmark-report.json'), JSON.stringify(report, null, 2));
  return report;
}
```

**`tools/test-runner.mjs` 改动**（`executeDryRun` L346，body 取 systemPrompt 处）：
```js
if (opts.baselineSystemPrompt) systemPrompt = opts.baselineSystemPrompt;
```
插在 L363 `let systemPrompt = '';` 之后读取逻辑内——当 opts 传 baselineSystemPrompt 时跳过 entrypoint 读取直接用 baseline。

**`tools/validate.mjs` 改动**（L30 `SKELETON_GUARD_EXCLUSIONS`）：
```js
const SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json', 'validation-report.json', 'security-report.json', 'eval-report.json', 'benchmark-report.json'];
```

**`tools/opsforge.mjs` 改动**：main switch 加 `case 'benchmark': return await cmdBenchmark(argv.slice(1));`，调用 `benchmark.mjs runBenchmark`。

#### B.2d.3 数据流 & gate

`<capDir>` → `runBenchmark` → `runSuite`(with) + `runSuite`(without, baselineSystemPrompt) → `benchmark-report.json`（advisory，**不进 release gate**，仅 SKELETON_GUARD_EXCLUSIONS 加它防 skeleton_guard 误报）。

---

### Slice 3a：P2-A 多 engine eval 横跑

#### B.3a.1 schema 改动

**无**。

#### B.3a.2 函数签名

**`tools/test-runner.mjs` 改动**（`executeDryRun` L346 重命名为 `executeCliDryRun` 加分派）：

```js
/**
 * Dispatch to a platform-specific CLI runner. Falls back to static-only error
 * if the platform CLI is unavailable.
 * @param {string} platform  claude-code|cursor|codex|cline|dify
 * @param {string} capDir
 * @param {Object} caseYaml
 * @param {Object} opts
 * @returns {Promise<string>} actual output
 */
async function executeCliDryRun(platform, capDir, caseYaml, opts) {
  switch (platform) {
    case 'claude-code': return executeClaudeDryRun(capDir, caseYaml, opts);
    case 'cursor': return spawnCursorDryRun(capDir, caseYaml, opts);
    case 'codex': return spawnCodexDryRun(capDir, caseYaml, opts);
    case 'cline': return spawnClineDryRun(capDir, caseYaml, opts);
    case 'dify': return executeHttpDryRun(capDir, caseYaml, opts); // 已有 L311
    default: throw new Error(`unsupported platform runner: ${platform}`);
  }
}

// 现有 executeDryRun L346 重命名为 executeClaudeDryRun（行为不变）。
// P1-A 多轮分支保留在 executeClaudeDryRun 体内（仅 claude-code 支持 stream-json 多轮）。

async function spawnCursorDryRun(capDir, caseYaml, opts) {
  return spawnSimple('cursor', ['--print', JSON.stringify(caseYaml.input)], capDir, caseYaml, opts);
}
async function spawnCodexDryRun(capDir, caseYaml, opts) {
  return spawnSimple('codex', ['exec', JSON.stringify(caseYaml.input)], capDir, caseYaml, opts);
}
async function spawnClineDryRun(capDir, caseYaml, opts) {
  return spawnSimple('cline', ['-p', JSON.stringify(caseYaml.input)], capDir, caseYaml, opts);
}

function spawnSimple(bin, args, capDir, caseYaml, opts) {
  const { spawn } = require('node:child_process'); // ESM: 动态 import 已在 executeMultiTurnDryRun 演示
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['pipe','pipe','pipe'], timeout: opts.timeout_ms || caseYaml.timeout_ms || 30000 });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => reject(new Error(`${bin} CLI not available`)));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`${bin} exited ${code}: ${stderr.slice(0,200)}`));
      else resolve(stdout.trim());
    });
  });
}
```

`runCase` L290 `executeDryRun(capDir, caseYaml, opts)` 调用改为 `executeCliDryRun(platform, capDir, caseYaml, opts)`。

**关键决策**：spawnSimple 用 `spawn`（非 execFileSync）以支持超时 + 流式 stderr；argv 形式不拼 shell（Windows 兼容 + §B.3 RCE 防护）。

#### B.3a.3 数据流 & gate

`OPSFORGE_RUNNER=cursor` env → `runSuite` runner='claude'（仍跑 claude）→ **OPSFORGE_PLATFORM env 或 opts.platform** → `executeCliDryRun` 分派 → cursor/codex/cline spawn。不改任何 gate。

---

### Slice 3b：P2-B --iteration N / eval-history 归档

#### B.3b.1 schema 改动

**无**。

#### B.3b.2 函数签名

**`tools/eval.mjs` 改动**：

1. `main` L131 解析 `--iteration N` flag：
```js
const iterFlag = argv.find((a) => a.startsWith('--iteration'));
const iteration = iterFlag ? Number(iterFlag.split('=')[1] || argv[argv.indexOf(iterFlag)+1]) : 0;
```

2. `evaluateCap` 加 `iteration` opts，verdict 决出后（L120 hook 之后）：
```js
if (opts.iteration && opts.iteration >= 1) {
  const { resolveEvalHistoryIterationDir } = await import('./paths.mjs');
  const iterDir = resolveEvalHistoryIterationDir(id, opts.iteration);
  fs.mkdirSync(iterDir, { recursive: true });
  fs.copyFileSync(path.join(capDir, 'eval-report.json'), path.join(iterDir, 'eval-report.json'));
  // latest.json always overwritten (last-write-wins)
  fs.writeFileSync(path.join(resolveEvalHistoryIterationDir(id, 0), 'latest.json'), JSON.stringify(report, null, 2));
}
```

3. `cmdEvolve`（Slice 1b）读历史：`collectSources` 扩展可选参数 `{ includeIterations: true }`，遍历 `iteration-*/failures.jsonl` 去重 by case name。

#### B.3b.3 数据流 & gate

`eval.mjs --all --iteration 3` → 每个 cap 跑完 eval → 复制 `eval-report.json` 到 `iteration-3/` + 更新 `latest.json`。`opsforge evolve` 读 `latest/failures.jsonl` + 所有 `iteration-*/failures.jsonl` 去重。不改 gate。

---

## C. 测试策略（逐切片）

### C.1 Slice 1a 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-pre-gates.test.mjs`

**用例清单**：
```
describe('pre_gates') {
  it('PG1: 空 pre_gates 数组兼容（现有用例不破）'  → runCase 静态调用，assert pass==='pending'
  it('PG2: contains 前置门命中后跑主 judge（mock fetch 调 1 次）'  → opts.actual 注入，mock fetch 计数
  it('PG3: pre_gate contains 失败跳 llm_judge（mock fetch 调 0 次）'  → assert reason 含 'pre_gate'
  it('PG4: files_exist 模式两分支（存在/不存在）'  → 临时目录建/不建文件，断言 pass 切换
  it('PG5: R18 校验 pre_gates expected 太短'  → checkPreGatesNontrivial + checkTestExpectNontrivial
  it('PG6: SC test-case.schema 拒绝 pre_gates.items 未知字段'  → ajv additionalProperties
  it('PG7: Windows 路径兼容 files_exist（path.join）'  → 仅断言不抛 EAGAIN
}
```

**mock 策略**：
- `compareLlmJudge` 通过 `opts.fetch` 注入 mock（计数调用次数），不真调外部。
- `fs.existsSync` 在 files_exist 测试中通过 `mkdtempSync` 临时目录控制存在性，**不 mock fs 本身**（保持真实 I/O 语义）。
- 静态模式（runner='static-only'）不跑 pre_gate（actual 未注入），断言 pass==='pending'。

### C.2 Slice 1b 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-regression-sink.test.mjs`

**用例清单**：
```
describe('regression-sink') {
  it('RS1: slugify 纯 ASCII 文本生成合法 slug'  → slugify('hello world') === 'hello-world'
  it('RS2: slugify CJK 文本生成 c<hash> 形式（符合 NAME_RE）'  → slugify('你好世界') 匹配 NAME_RE
  it('RS3: resolveNameConflict 加 -2/-3 后缀'  → 在 tmp 目录预置同名 case，断言后缀
  it('RS4: generateCase 从 feedback 生成草稿（name 正则+input 含 text+expected=__FILL_ME__）'
  it('RS5: generateCase 从 failure 生成草稿（contains 类 reason → expect=contains）'
  it('RS6: generateCase 草稿落 _drafts/ 后 validateDir verdict=fail（R7 placeholder）'  → 集成 validate.mjs
  it('RS7: 草稿填实 expected + judge_rubric 后 --promote 成功'  → 集成 new-capability.mjs promote
  it('RS8: collectSources 读 feedback jsonl（rating<=3 过滤）+ failures.jsonl'
  it('RS9: cmdEvolve 交互（管道 stdin）生成草稿 + 打印 promote 提示'  → makeAsker 管道模式
  it('RS10: eval.mjs verdict=fail 写 failures.jsonl（mock runSuite 返回 failed case）'
}
```

**mock 策略**：
- `runSuite` 在 RS10 中通过 `monkeypatch` 临时替换（或直接构造 `cases` 数组传给 `computeAxes` + 手工触发 failures hook）。
- `child_process.spawn` 不调用（regression-sink 无 spawn）。
- `fs` 用 `mkdtempSync` 真实临时目录，不 mock。

### C.3 Slice 2a 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-turns.test.mjs`

**用例清单**：
```
describe('turns') {
  it('TU1: schema 接受 turns 含 role/content/post_condition'  → ajv
  it('TU2: schema 拒绝 turns.items 未知字段'  → additionalProperties
  it('TU3: R23 turns 非空时 role/content 必填 + must_contain_any ≥3 字符'  → checkTurnsWellFormed
  it('TU4: R19 distinct key 含 turns（同 turns 不同 expect 视为不同 case）'
  it('TU5: executeMultiTurnDryRun mock spawn（断言 stdin stream-json payload + post_condition fail 路径）'  → monkeypatch child_process.spawn 返回假 proc
  it('TU6: dogfood 用例不填 turns 完全兼容（现有 4 dogfood caps 仍 pass）'  → validateDir
  it('TU7: Windows stdin Buffer 编码不丢字节（payload 含非 ASCII）'  → 断言 write 被调
}
```

**mock 策略**：
- `child_process.spawn` 通过 `require.cache` 替换或 `monkeypatch`（Node test 不支持 import mock，需用 `--import=mock` 或在测试中直接调一个包装函数）。**推荐**：把 `spawn` 调用包成模块级 `let _spawn = spawn; export function _setSpawn(fn){_spawn=fn}` 供测试注入。
- `fetch` 不调用（turns 不走 judge）。

### C.4 Slice 2b 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-check-mode.test.mjs`

**用例清单**：
```
describe('expect=check') {
  it('CK1: compareCheck tool_called 命中（transcript 含 "name":"grep"）'
  it('CK2: compareCheck tool_called args 文本包含不命中'
  it('CK3: compareCheck files_exist/files_not_exist 临时目录'
  it('CK4: compareCheck must_contain/must_not_contain'
  it('CK5: R18 expect=check 时 expected 必须是对象且 ≥1 键'
  it('CK6: schema enum 加 check'  → ajv 接受
}
```

**mock 策略**：纯函数测试，无外部调用。

### C.5 Slice 2c 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-evals-bridge.test.mjs`

**用例清单**：
```
describe('evals-bridge') {
  it('EB1: exportCase 7 字段映射正确（comparator 映射表）'
  it('EB2: importCase 缺 expected_value → __FILL_ME__'
  it('EB3: round-trip export→import 不丢字段（weight/timeout_ms/platforms 经 metadata.opsforge）'
  it('EB4: exportToEvalsJson 读 <capDir>/tests/*.yaml → evals.json'
  it('EB5: importFromEvalsJson 落 _drafts/<pack>/<name>/tests/case-NN.yaml + 缺字段 __FILL_ME__'
  it('EB6: cmdEvalsImport 子命令（opsforge.mjs dispatch）调 new-capability scaffold 当 draftsDir 不存在'
}
```

### C.6 Slice 2d 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-benchmark.test.mjs`

**用例清单**：
```
describe('benchmark') {
  it('BM1: runBenchmark mock runSuite 两次（with/without）+ delta 计算'
  it('BM2: verdict effective 当 delta >= min_delta'
  it('BM3: verdict neutral 当 delta < min_delta'
  it('BM4: benchmark-report.json 写入 + SKELETON_GUARD_EXCLUSIONS 豁免'
  it('BM5: baselineSystemPrompt opts 替换 entrypoint systemPrompt'
}
```

**mock 策略**：`opts.runSuite` 注入 mock（计数调用次数 + 比对 opts.baselineSystemPrompt）。

### C.7 Slice 3a 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-multi-engine.test.mjs`

**用例清单**：
```
describe('multi-engine') {
  it('ME1: executeCliDryRun platform=claude-code 调 executeClaudeDryRun（行为不变）'
  it('ME2: executeCliDryRun platform=cursor 调 spawn cursor argv'
  it('ME3: executeCliDryRun platform=dify 调 executeHttpDryRun'
  it('ME4: 未知 platform 抛 unsupported'
  it('ME5: spawn 失败 → {pass:false, reason:"<platform> CLI not available"}'
}
```

**mock 策略**：通过 `_setSpawn` 注入 mock spawn，返回假 proc 模拟 close event。

### C.8 Slice 3b 测试

**文件**：`D:\XD\ClaudeCode\sy-eeo\tools\test-eval-iteration.test.mjs`

**用例清单**：
```
describe('eval-iteration') {
  it('IT1: --iteration 0 默认不创建 iteration-N/ 目录'
  it('IT2: --iteration 3 复制 eval-report.json 到 iteration-3/ + 写 latest.json'
  it('IT3: resolveEvalHistoryIterationDir 断言 capId + N>=0'
  it('IT4: cmdEvolve 读历史 iteration-*/failures.jsonl 去重 by case name'
}
```

---

## D. 实施顺序与并行性

**tdd-guide 实施序列**（每片独立 PR、独立验收）：

| 序 | 切片 | 工时 | 增量测试 | 最小验收命令 |
|---|---|---|---|---|
| 1 | Slice 1a (pre_gates) | 1.5d | +7 | `node --test` 全绿（基线 341 → 348）；`node tools/validate.mjs --all` exit 0 |
| 2 | Slice 1b (regression-sink) | 3d | +10 | `node --test` 全绿（348 → 358）；`node tools/eval.mjs --all` exit 0 |
| 3 | Slice 2a (turns) | 2d | +7 | `node --test` 全绿（358 → 365）；`validate.mjs --all` exit 0 |
| 4 | Slice 2b (check) | 1.5d | +6 | `node --test` 全绿（365 → 371）；`validate.mjs --all` exit 0 |
| 5 | Slice 2c (evals.json) | 2d | +6 | `node --test` 全绿（371 → 377） |
| 6 | Slice 2d (benchmark) | 1.5d | +5 | `node --test` 全绿（377 → 382）；`validate.mjs --all` exit 0 |
| 7 | Slice 3a (multi-engine) | 2d | +5 | `node --test` 全绿（382 → 387） |
| 8 | Slice 3b (iteration) | 1d | +4 | `node --test` 全绿（387 → 391） |

**总工作量**：约 14.5 人日；最终 bare `node --test` 预计 ≈ 391（基线 341 + 50）。

**并行机会**：
- Slice 2c 和 2d 可并行（不动同一文件除 opsforge.mjs switch case，但 case 加在不同行段无冲突）。
- Slice 3a 与 3b 可并行（3a 改 test-runner，3b 改 eval.mjs，无文件冲突）。
- 其余建议串行（schema/compareForMode 系列改动叠加易冲突）。

---

## E. 风险点与设计决策记录

### E.1 关键决策

**决策 1：Windows 多轮 stdin 用 `spawn` + Buffer 字符串，不用 `execFileSync`**
- 理由：execFileSync 同步阻塞，无法在多轮之间读 stdout 再喂下一轮 stdin；spawn 异步 + 行缓冲读 stdout 是 stream-json 协议必需。Windows 兼容：`proc.stdin.write(stringPayload)` 接受 UTF-8 Buffer 字符串，`path.join` 处理路径。
- 备选：`execFileSync` 单轮（已有 executeDryRun L370 用 spawn + Promise，非 execFileSync——继续复用此模式）。

**决策 2：`tool_called` 文本包含匹配，不做精确 block 解析**
- 理由：claude stream-json 的 tool_use block 在 `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"<name>","input":{...}}]}}`。文本包含 `"name":"<name>"` 是稳健的（JSON 序列化无空格）。args 匹配用 `JSON.stringify(args)` 前 200 字符——若 args 顺序不稳定会漏报，但 Phase 4 标注为"文本匹配，精确解析留后续"。
- 风险：agent 输出含字面 `"name":"grep"` 但非 tool_use 块（如 markdown 代码块）会误报。Phase 4 接受此风险（agent 输出极少含此字面）。

**决策 3：`regression-sink.slugify` CJK 处理用 djb2 hash → `c<base36>`**
- 理由：不引新依赖（pinyin 库违反 §C.1）；CJK 直接转 slug 会空字符串违反 NAME_RE。djb2 hash 是零依赖稳定算法，`c` 前缀保证首字符 `[a-z]`，`<base36>` 保证 ≥2 字符。冲突率低（30 字符窗口内哈希空间足够）。
- 备选：要求用户手填 name（违反"自动沉淀"目标）——拒绝。

**决策 4：`regression-sink` 永远不自动 promote**
- 理由：方案文档 §8 不变量 #4 + AGENTS.md #11。`__FILL_ME__` 留空让 R7 在 draft gate 挡住，`--promote` 前置 `matchSkeletonSignature` 防手改。这是人工判断断言的反空洞防线（保留 R18 语义）。

**决策 5：`benchmark-report.json` advisory 不进 release gate，但加 SKELETON_GUARD_EXCLUSIONS**
- 理由：方案 §6 风险表。若不加 EXCLUSIONS，skeleton_guard R8 会把它当 extra 文件 fail。release.mjs 三报告 gate（validation+security+eval）逻辑不动。

**决策 6：pre_gates 在 `opts.actual` 注入后才跑（static-only 不跑）**
- 理由：static-only 模式无 actual 输出，pre_gate 无法比对。若强行跑会误报 fail。CI static-only 模式下 pre_gates 静默跳过，与现有"static-only → pending"语义一致。

**决策 7：`turns` 多轮仅 claude-code 支持（cursor/codex/cline 仍单轮）**
- 理由：stream-json 多轮协议是 claude-code 特性；其他平台 CLI 的多轮协议差异大且未验证。`executeMultiTurnDryRun` 只在 `executeClaudeDryRun` 体内调；其他平台 turns 非空时退化为单轮（首 turn content 作 input）。

### E.2 与方案文档的偏差

**偏差 1：`regression-sink.generateCase` 的 expect 启发式更保守**
- 方案 §P0-B 说"actual 含明确字符串且 reason 是 contains 类 → contains"。实际实现：仅当 failure.reason 文本匹配 `/contains|substring|missing substr/i` 时用 contains，否则 llm_judge。理由：feedback 无 reason 字段，统一默认 llm_judge 更安全（强制人填 judge_rubric）。

**偏差 2：`executeCliDryRun` 分派用 `spawn` 而非 `execFileSync`**
- 方案 §P2-A 未指定。实际：cursor/codex/cline spawn 用 `spawn`（非 execFileSync）以支持超时 + 流式 stderr，与现有 executeDryRun L370 模式一致。

**偏差 3：`evals-bridge.importCase` 缺 `expected_value` 时 `expected=__FILL_ME__`**
- 方案 §P1-C 表说"无对应 → 留 __FILL_ME__"。实际实现：expected_value 为 null/undefined 时 expected=__FILL_ME__，否则直接复制。schema_ref 在 evals.json 中嵌入 expected_value.schema，导入时 flattened 到 expected（可能不是 OpsForge 期望的字符串）——人填阶段校正。

### E.3 其他风险

- **ajv strict:false**（validate.mjs L146）：新增 schema 字段不会被 ajv 拒，但 tdd-guide 须跑 `node tools/schema-contracts.test.mjs` 确认 SC1-SC12 仍绿（additionalProperties:false 在子对象层）。
- **R7 placeholder_clean** 在 draft 态就生效 → regression-sink 草稿含 `__FILL_ME__` 必 fail draft gate。**这是设计意图**，不是 bug——草稿不是合法终点。
- **`eval.mjs` 失败写 failures.jsonl 的容错**：若 `~/.opsforge/eval-history/` 不可写（权限），eval 不能因此 fail。实现中 try/catch + `report.archive_error` 字段记录，不抛。
- **`opsforge evolve` 在非 TTY 需 capId 位置参数**（复用 cmdFeedback 模式 OP21/OP22）。

---

## F. 关键代码路径索引（tdd-guide "先读这些"清单）

| 切片 | 文件 | 关键函数/行号 |
|---|---|---|
| 1a | `D:\XD\ClaudeCode\sy-eeo\schema\test-case.schema.json` | 全文件（10 properties，追加 `pre_gates`） |
| 1a | `D:\XD\ClaudeCode\sy-eeo\tools\test-runner.mjs` | `SUPPORTED_MODES` L15；`compareForMode` L193；`runCase` L231（opts.actual 分支 L257、http 分支 L265、static-only 分支 L277、claude 分支 L290） |
| 1a | `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs` | `EXPECT_BLACKLIST` L514；`checkTestExpectNontrivial` L517；staged checks 数组 L829-859 |
| 1a | `D:\XD\ClaudeCode\sy-eeo\templates\skill\tests\case-01.yaml` | 全文件（追加 `pre_gates: []` 注释） |
| 1b | `D:\XD\ClaudeCode\sy-eeo\tools\paths.mjs` | `resolveOpsforgeHome` L18（在其后加 3 个 resolveEvalHistory* 函数）；`assertCapId` L82 |
| 1b | `D:\XD\ClaudeCode\sy-eeo\tools\eval.mjs` | `evaluateCap` L70；verdict 决出 L103-110；写 eval-report.json L125（在 L120 插 failures hook） |
| 1b | `D:\XD\ClaudeCode\sy-eeo\tools\opsforge.mjs` | `main` switch L53；`makeAsker` L89；`parseSimpleOpts` L510；`cmdFeedback` L415（模板）；`cmdFeedbackInteractive` L394 |
| 1b | `D:\XD\ClaudeCode\sy-eeo\tools\new-capability.mjs` | `promote` L180；`matchSkeletonSignature` L59；`writeOpsforgeState` L229 |
| 2a | `D:\XD\ClaudeCode\sy-eeo\tools\test-runner.mjs` | `executeDryRun` L346（多轮分支插入口 + 重命名 executeClaudeDryRun）；`runCase` L231 |
| 2a | `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs` | `checkTestCasesDistinct` L541（R19 distinct key L545）；staged checks L853（加 R23） |
| 2b | `D:\XD\ClaudeCode\sy-eeo\tools\test-runner.mjs` | `SUPPORTED_MODES` L15（加 'check'）；`compareForMode` L193（加 case 'check'）；`compareGolden` L116（compareCheck 加在其后） |
| 2b | `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs` | `checkTestExpectNontrivial` L517（加 expect==='check' 分支） |
| 2c | `D:\XD\ClaudeCode\sy-eeo\tools\opsforge.mjs` | `main` switch L53（加 evals-import/evals-export case） |
| 2d | `D:\XD\ClaudeCode\sy-eeo\tools\eval.config.yaml` | 全文件（加 benchmark 段） |
| 2d | `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs` | `SKELETON_GUARD_EXCLUSIONS` L30（加 'benchmark-report.json'） |
| 2d | `D:\XD\ClaudeCode\sy-eeo\tools\test-runner.mjs` | `executeDryRun` L346（systemPrompt 读取处加 baselineSystemPrompt opts） |
| 3a | `D:\XD\ClaudeCode\sy-eeo\tools\test-runner.mjs` | `executeDryRun` L346（重命名 executeClaudeDryRun + 加 executeCliDryRun 分派）；`executeHttpDryRun` L311（dify 分支复用）；`runCase` L290（调用改 executeCliDryRun） |
| 3b | `D:\XD\ClaudeCode\sy-eeo\tools\eval.mjs` | `main` L131（解析 --iteration）；`evaluateCap` L70（加 iteration opts）；`paths.mjs resolveEvalHistoryIterationDir`（1b 已加） |

---

## G. 不变量守卫清单（architect 已确认，tdd-guide 实施时复核）

1. `additionalProperties:false` 在 `test-case.schema.json` 顶层 + `pre_gates.items` + `turns.items` + `turns.items.post_condition` 全保留 `false`。
2. `registry*.yaml` 仍由 `tools/release.mjs` auto-aggregate（不动 release.mjs）。
3. 新增 `regression-sink.mjs` / `evals-bridge.mjs` / `benchmark.mjs` 全是 `.mjs`（steering 拥有，guardrails.yml path-guard 已覆盖 `tools/**` + `**/*.mjs`）。
4. 回归草稿必经 `--promote`（matchSkeletonSignature 前置 + R7 draft gate 挡 `__FILL_ME__`）。
5. 不引新 npm 依赖（fetch/spawn/fs/readline 全 Node 内置；ajv/js-yaml/semver 已有）。
6. Windows 兼容：所有路径 `path.join`；spawn argv 形式；多轮 stdin Buffer 字符串。
7. R16-R22 保留不动；R23（turns）+ R18 扩展（pre_gates/check/turns）是同级新增，不弱化现有反空洞。
8. release gate 三报告逻辑不动；`benchmark-report.json` 仅加 SKELETON_GUARD_EXCLUSIONS，不进 release gate。

---

## H. 验收总标准（Phase 4 完成时）

- bare `node --test` 全绿（基线 341 → 预计 ≈ 391）。
- `node tools/validate.mjs --all` exit 0（7 dogfood caps + 新 R23/R18 扩展）。
- `node tools/security-scan.mjs --all` exit 0（新工具过 §B，无 prompt-injection/SSRF/secret）。
- `node tools/eval.mjs --all` exit 0（dogfood caps verdict=pending，不写 failures.jsonl）。
- `node tools/release.mjs --all` exit 0（3-report gate 不变，benchmark 不进 gate）。
- 手动 E2E：构造 fail eval → `opsforge evolve` → 生成草稿 → 填空 → `--promote` → `_staged/` → release；构造多轮 skill 用例 → `turns` + `post_condition` 跑通；构造 `expect:check` 用例 → `files_exist` 验证；构造 evals.json → `evals-import` → 草稿；`opsforge benchmark` 跑出 delta。

---

以上是完整设计。parent agent 应将其落盘到 `D:\XD\ClaudeCode\sy-eeo\docs\design-archive\phase4-architecture.md`。
agentId: a68cbdfff00dc8630 (use SendMessage with to: 'a68cbdfff00dc8630', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 87078
tool_uses: 21
duration_ms: 431241</usage>