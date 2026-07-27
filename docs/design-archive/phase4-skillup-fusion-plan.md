# Phase 4 skill-up 融合方案（深化版）

> 产出：ecc:planner 深化分析（2026-07-27）。基于 `docs/design-archive/skillup-intel.md` 的 skill-up schema 全量情报 + OpsForge repo 权威源。供 architect/tdd-guide 直接据以实施。

## 0. 前置事实校正（影响后续所有判断）

读完权威源后，**情报文件 §6 初评所依据的两条事实需修正**：

1. **`schema/test-case.schema.json` 实际是 10 个 properties，不是 7 个**。`required: ["name","input","expect"]`，其余 7 个可选（`expected` / `schema_ref` / `judge_rubric` / `judge_threshold` / `weight` / `platforms` / `timeout_ms`）。CLAUDE.md/PLAN §21 宣称的"7 字段"是 v8 Phase 1 历史标签，schema 已经长到 10。`templates/skill/tests/case-01.yaml` 实写 8 字段，dogfood `packs/opsforge-meta/skills/opsforge-wizard/tests/case-01.yaml` 只实写 4 字段（name/input/expect/expected）——证明 schema 已经允许"少写字段"。**这意味着新增可选字段不破坏现有用例，迁移成本低**。
2. **`~/.opsforge/eval-history/` 在 PLAN §17/§21.13 被声明为路径，但 repo 内没有任何 `.mjs` 往其写过**。当前 eval 运行只落 `~/.opsforge/runs/<eval-id>/results.json`（test-runner.mjs L423）。`re-eval.yml` 跑 `eval.mjs --all` 也不归档。**eval-history 是空壳，Phase 4 必须把它做实，否则回归闭环无处生根**。
3. feedback jsonl 字段（opsforge.mjs L432）：`{cap_id, rating:int 1-5, text, ts:ISO}`，落在 `~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl`。**回归沉淀的输入源已就绪**。

## 1. 执行摘要

深化后**修正初评结论两点**，整体方向（不引 Go 二进制、方案 A+D、Phase 4 落地）不变：

- **新增吸收点**：初评把"多轮 turns + capture + post_condition"归为"可考虑"，深化后升级为 **P1 部分吸收**（仅 `turns` + `post_condition`，不吸收 `capture` 变量模板——capture 与我们 `additionalProperties:false` + R18 反空洞冲突大、收益对当前 5 个 dogfood 能力低）。"expect 两段前置门"从"未识别"升级为 **P0**（成本极低、省 token、与现有 `contains/regex` 复用）。"结构化断言 `tool_called/files_exist`"从"未识别"升级为 **P1**（对 agent/workflow 类用例价值高，落为新 `expect: check` 模式，不破 closed schema）。
- **排除点维持**：`script` 外部脚本（违反 AGENTS.md #1/#5，不吸收）、`environment: opensandbox/docker`（我们走 adapter HTTP API + static-only，不引沙箱，不吸收）、CI Docker action + model secrets（违反 guardrails.yml zero-secret static-only，不吸收）、`judge.skills` 给 judge 装 Rubric Skill（我们的 `judge-prompt.md` 已是 SSOT 单一系统提示，不引第二条 skill 链路，不吸收）。
- **核心缺口确认**：失败→自动沉淀回归用例闭环（点 5）是 Phase 4 第一优先；evals.json 双向桥接（点 6）是生态对接面 Slice 2；多 engine 横跑（点 7）是内化进 `OPSFORGE_RUNNER` 的 Slice 3；`--iteration` 归档（点 8）是 eval-history 做实的配套。

初评的 Slice 1/2/3 划分保留，但 Slice 1 拆为 1a（regression-sink 草稿生成）+ 1b（`opsforge evolve` 交互闭环 + eval-history 落地）以保证两片可独立验收。

## 2. 逐点评估表

| # | 候选吸收点 | 结论 | 落点文件 | schema 改动 | 破 additionalProperties:false | 三态+R16-R22+release gate 影响 | 非技术贡献者影响 | 工作量 |
|---|---|---|---|---|---|---|---|---|
| 1 | 多轮 turns+capture+post_condition | **部分吸收**（turns+post_condition；不吸收 capture） | `schema/test-case.schema.json` + `tools/test-runner.mjs` + `templates/{skill,agent,mcp}/tests/case-01.yaml` | 新增可选 `turns: array`，每项 `{role: enum[user/assistant], content: string, post_condition?: {must_contain_any: string[], on_fail: enum[skip/fail]}}` | **不破**（显式新增字段，closed schema 保留） | staged+ 新增 R23 `test_turns_well_formed`；R18 扩展 turns 模式；R19 distinct key 扩展含 `turns`；release gate 不变 | 多步 skill 作者可写多轮用例；单步用例不填 `turns` 完全兼容 | 中 |
| 2 | benchmark with/without skill 对照 | **吸收**（P1，advisory 不入 gate） | 新增 `tools/benchmark.mjs`；`eval.config.yaml` 加 benchmark 段 | 不改 test-case schema | 不破 | 不进 release gate；`benchmark-report.json` 进 R8 EXCLUSIONS | 贡献者可选跑 `opsforge benchmark` 验证 skill 真有效 | 中 |
| 3 | expect 两段前置门 | **吸收**（P0） | `schema/test-case.schema.json` 加 `pre_gates`；`tools/test-runner.mjs` 改 `runCase` | `pre_gates: array of {mode: enum[contains/regex/exact/files_exist], expected: any}` | 不破 | R18 扩展 pre_gates；release gate 不变 | 给 llm_judge 用例加快速过滤可省 token | 低 |
| 4 | 结构化断言 tool_called/files_exist | **吸收**（P1，新 expect 模式 `check`） | `schema/test-case.schema.json` enum 追加 `check`；`tools/test-runner.mjs` 加 `compareCheck` | `expect: check` 时 `expected` 为对象 | 不破 | R18 扩展 check 模式；release gate 不变 | agent/workflow 作者可声明"必须调用 X 工具""必须生成 Y 文件" | 中 |
| 5 | 失败→自动沉淀回归用例闭环 | **吸收**（P0，Phase 4 核心） | 新增 `tools/regression-sink.mjs`；`tools/opsforge.mjs` 加 `evolve`；`tools/eval.mjs` 失败写 failures.jsonl | 不改 test-case schema | 不破 | 草稿落 `_drafts/`，留 `__FILL_ME__`，经 `--promote` 人工 gate；不绕过任何 gate | 仍是填空式 | 中高 |
| 6 | evals.json 双向桥接 | **吸收**（P1，Slice 2） | 新增 `tools/evals-bridge.mjs`；`opsforge.mjs` 加子命令 | 不改 schema | 不破 | 导入落 `_drafts/` 走 draft gate；导出只读 | 可从 Anthropic 评测样例库引入用例草稿 | 中 |
| 7 | 多 engine eval 横跑 | **吸收**（P2，Slice 3） | `tools/test-runner.mjs` 重构 `executeCliDryRun` 分派 | 不改 schema | 不破 | 不改 gate；runner 层 | 无（steering 工具） | 中 |
| 8 | --iteration N / eval-history 归档 | **吸收**（P2，配套） | `tools/eval.mjs` 加 `--iteration N` | 不改 schema | 不破 | 不改 gate | 无 | 低 |

## 3. 最终吸收清单

### P0-A：expect 两段前置门（点 3）

**落点**：`schema/test-case.schema.json` + `tools/test-runner.mjs` + `tools/validate.mjs` + `templates/skill/tests/case-01.yaml`（注释示例）

**schema 改动片段**（`additionalProperties:false` 保留）：
```json
"pre_gates": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["mode", "expected"],
    "properties": {
      "mode": { "enum": ["contains", "regex", "exact", "files_exist"] },
      "expected": {}
    }
  }
}
```

**test-runner.mjs 改动**：`runCase` 在 `compareForMode(mode,...)` 前，若 `caseYaml.pre_gates` 非空，先逐条跑 `compareForMode(gate.mode, actual, {expected: gate.expected}, opts)`；任一 `pass:false` → 返回 `{pass:false, reason:'pre_gate failed: '+r.reason, runner, mode, case}`，**跳过 llm_judge fetch**。`files_exist` 模式：`actual` 当工作区根，检查 `fs.existsSync(path.join(workspaceRoot, expected))`。

**validate.mjs 改动**：`checkTestExpectNontrivial`（R18）扩展——遍历 `c.pre_gates`，每条 `expected` 字符串 `length<=3` 或命中 `EXPECT_BLACKLIST` 则 fail。新增纯函数 `checkPreGatesNontrivial(cap)`，staged 分支加入 checks 数组。

**新增测试**（`tools/test-pre-gates.test.mjs`，5 条）：空数组兼容、contains 命中后跑 judge、pre_gate 失败跳 judge（mock fetch 0 次）、files_exist 两分支、R18 校验。

**验收**：bare `node --test` +5；`validate.mjs --all` exit 0。

---

### P0-B：失败→自动沉淀回归用例闭环（点 5）

**落点**：新增 `tools/regression-sink.mjs` + `tools/opsforge.mjs` 加 `evolve` + `tools/eval.mjs` 失败写 failures.jsonl + `tools/paths.mjs` 加 `resolveEvalHistoryDir(capId)` + 运行期 `~/.opsforge/eval-history/<cap-id>/failures.jsonl`

**输入**（两个源）：
1. feedback jsonl（`~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl`）：`{cap_id, rating 1-5, text, ts:ISO}`。取 `rating<=3`。
2. eval failures（`~/.opsforge/eval-history/<cap-id>/failures.jsonl`，由 `eval.mjs` 在 `verdict==='fail'` 追加）：`{cap_id, case, mode, reason, actual, ts}`。

**输出**（`tests/case-NN.yaml` 草稿，落 `_drafts/<pack>/<name>/tests/`）：
```yaml
name: auto-<slug>
input: <text 或 actual 截 200 字符>
expect: llm_judge          # 默认；actual 含明确字符串且 reason 是 contains 类 → contains
expected: __FILL_ME__      # 强制人填（R7 挡）
judge_rubric: __FILL_ME__  # 强制人填（R18 挡）
judge_threshold: 0.7
weight: 1.0
schema_ref: null
```

**字段填充策略**：name 填实（`auto-` + slugify(text/case 前 30 字符，保证正则，冲突加 -2/-3）；input 填实（feedback.text 优先，否则 failures.actual 截 200）；expect 填实（默认 llm_judge，contains 类 reason → contains）；expected/judge_rubric **留 `__FILL_ME__`**；其余填默认。

**关键设计**：R7 placeholder_clean 在 draft 态就生效，所以 `__FILL_ME__` 草稿在 draft 态会 fail——**这是对的**，草稿不是合法终点。`regression-sink.mjs` 生成后打印"请填 expected/judge_rubric 后跑 `node tools/new-capability.mjs --promote <path>`"，`--promote` 前 skeleton 签名 + draft checks，`__FILL_ME__` 未清 → 拒绝 promote。**这就是人工 gate 强制点**。

**`opsforge evolve` 交互流程**：读 failures.jsonl + feedback jsonl → 列"待沉淀"条目（case 名 + reason 摘要）→ 用户多选 → 对每条调 `regression-sink.generateCase()` 写 `_drafts/` → 打印"已生成 N 条草稿，请填 `__FILL_ME__` 后 --promote" → **不自动 promote**。

**`eval.mjs` 改动**：`evaluateCap` 在 `verdict==='fail'` 时，遍历 `cases.filter(c=>c.pass===false)`，每条 append `{cap_id:id, case:c.case, mode:c.mode, reason:c.reason, actual:String(c.actual||'').slice(0,500), ts:new Date().toISOString()}` 到 `~/.opsforge/eval-history/<id>/failures.jsonl`（mkdirSync recursive）。

**新增测试**（`tools/test-regression-sink.test.mjs`，6 条）：feedback→草稿 name 正则+input 含 text+expected=`__FILL_ME__`；failures→草稿；slugify 冲突加后缀；草稿落 `_drafts/` 后 `validateDir` 返回 verdict=fail（R7 placeholder，证明未绕 gate）；草稿填实后 `--promote` 成功。

**验收**：`node --test` +6；`eval.mjs --all` exit 0（dogfood caps verdict=pending，不写 failures）；手动 fail → evolve → 草稿 → 填空 → promote 成功。

---

### P1-A：多轮 turns + post_condition（点 1，部分吸收）

**落点**：`schema/test-case.schema.json` + `tools/test-runner.mjs` + `tools/validate.mjs` + `templates/skill/tests/case-02.yaml`

**schema 字段片段**：
```json
"turns": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["role", "content"],
    "properties": {
      "role": { "enum": ["user", "assistant"] },
      "content": { "type": "string", "minLength": 1 },
      "post_condition": {
        "type": "object",
        "additionalProperties": false,
        "required": ["must_contain_any", "on_fail"],
        "properties": {
          "must_contain_any": { "type": "array", "items": {"type":"string"}, "minItems": 1 },
          "on_fail": { "enum": ["skip", "fail"] }
        }
      }
    }
  }
}
```

**不吸收 `capture`**：capture 引入运行期变量态，与"声明式无状态用例"哲学冲突；`{{variable}}` 模板替换会被 §B.1 prompt-injection 扫描误报。如未来真需再加 `captures` 字段，仍 closed。

**test-runner.mjs 改动**：`executeDryRun` 扩展——`caseYaml.turns` 非空时用 `claude -p --input-format stream-json` 发多轮（每轮读 stdout 后发下一轮）；每轮结束若有 `post_condition` 跑 `compareForMode('contains', stdout, {expected:post_condition.must_contain_any}, opts)`，`on_fail:skip` → 标 SKIP 余下 turn；`on_fail:fail` → 立即 `{pass:false}`。最终 actual = 最后一轮 stdout。

**validate.mjs 改动**：新增 R23 `test_turns_well_formed`（staged+）：`turns` 非空时每项 `role`/`content` 必填，`post_condition.on_fail` 必填；R18 扩展 turns 模式下 `expected` 可空但每 turn `must_contain_any` 每项 ≥3 字符；R19 distinct key 加 `turns`。

**新增测试**（`tools/test-turns.test.mjs`，5 条）。

**验收**：`node --test` +5；`validate.mjs --all` exit 0；dogfood 不填 `turns` 完全兼容。

---

### P1-B：结构化断言 expect=check（点 4）

**落点**：`schema/test-case.schema.json`（enum 加 `check`）+ `tools/test-runner.mjs`（`compareCheck`）+ `tools/validate.mjs`（R18 扩展）

**test-runner.mjs 改动**：`compareCheck(actual, expectedObj, opts)`：
- `expected.tool_called`：检查 actual（transcript 字符串）含 `"name":"<name>` 且（若 `args` 给定）含 args JSON 片段。**Phase 4 先文本包含匹配**，精确 block 解析留后续。
- `expected.files_exist`/`files_not_exist`：检查 `path.join(opts.workspaceRoot || capDir, p)` 存在性。
- `expected.must_contain`/`must_not_contain`：复用 contains。
- 所有 matcher 全过 → pass:true。

**validate.mjs 改动**：R18 扩展：`expect==='check'` 时 `expected` 必须是对象且至少 1 键，每键值非空。

**新增测试**（`tools/test-check-mode.test.mjs`，4 条）。

---

### P1-C：evals.json 双向桥接（点 6）

**落点**：新增 `tools/evals-bridge.mjs` + `opsforge.mjs` 加 `evals-import`/`evals-export`

**字段映射表**：

| OpsForge 字段 | evals.json 字段 |
|---|---|
| `name` | `case_id` / filename |
| `input`（string） | `user_message` |
| `input`（array）/`turns` | `turns[].content` |
| `expect`+`expected` | `expected_comparator`+`expected_value`（exact→equals;contains→contains_all;regex→regex;schema→json_schema;llm_judge→judge;golden→fuzzy_match;check→custom） |
| `judge_rubric` | `rubric` |
| `judge_threshold` | `pass_threshold` |
| `schema_ref` | 嵌入 expected_value.schema |
| `pre_gates` | `preconditions[]` |
| `weight`/`timeout_ms`/`platforms` | `metadata.opsforge.*`（导出塞，导入忽略） |

**import**：`opsforge evals-import <evals.json> --pack <slug> --name <name>` → 每 case 生成 `tests/case-NN.yaml` 草稿落 `_drafts/<slug>/<name>/tests/`（不存在则 new-capability scaffold；存在则追加）。`expected`/`judge_rubric` 无对应 → 留 `__FILL_ME__`。

**export**：`opsforge evals-export <capDir> > evals.json` → 读 `tests/*.yaml` → 按映射表生成。

**新增测试**（`tools/test-evals-bridge.test.mjs`，round-trip 不丢字段）。

---

### P1-D：benchmark with/without skill（点 2）

**落点**：新增 `tools/benchmark.mjs` + `tools/eval.config.yaml` 加 benchmark 段 + `tools/validate.mjs` R8 EXCLUSIONS 加 `benchmark-report.json` + `tools/test-runner.mjs` `executeDryRun` 加 `baselineSystemPrompt` opts

**流程**：跑 `runSuite(capDir,{runner:'claude'})` 得 with-skill → 跑 `runSuite(capDir,{runner:'claude', baselineSystemPrompt: config.benchmark.baseline_prompt})`（opts 传 baselineSystemPrompt 时替换 cap body 作 system prompt，模拟"不装 skill"）→ delta = with.overall - without.overall → 写 `benchmark-report.json` `{cap_id, with_skill:{overall,n}, without_skill:{overall,n}, delta, verdict: delta>=min_delta?'effective':'neutral'}`。**不进 release gate**（advisory）。

**eval.config.yaml**：
```yaml
benchmark:
  enabled: false
  baseline_prompt: "You are a helpful assistant. Answer the user's request."
  min_delta: 0.1
```

**新增测试**（`tools/test-benchmark.test.mjs`，mock runSuite 两次，断言 delta + verdict）。

---

### P2-A：多 engine eval 横跑（点 7）

**落点**：`tools/test-runner.mjs` 重构 `executeDryRun` → `executeCliDryRun(platform, capDir, caseYaml, opts)` 分派

```
executeCliDryRun(platform, capDir, caseYaml, opts):
  switch(platform):
    case 'claude-code': return spawnClaude(...)    // 现有 executeDryRun
    case 'cursor':       return spawnCursor(...)   // cursor --print
    case 'codex':        return spawnCodex(...)    // codex exec
    case 'cline':        return spawnCline(...)   // cline -p
    case 'dify':         return executeHttpDryRun(...) // 已有
    default: throw Error('unsupported platform runner')
```
每分支独立 try/catch，spawn 失败 → `{pass:false, runner:platform, reason:'<platform> CLI not available'}`。`OPSFORGE_RUNNER=cursor` 触发 cursor 分支。

**新增测试**：mock spawn 各平台分支 → 断言 argv 正确。

---

### P2-B：--iteration N / eval-history 归档（点 8）

**落点**：`tools/eval.mjs` 加 `--iteration N` flag + `~/.opsforge/eval-history/<cap-id>/iteration-N/`

**语义**：`--iteration 0`（默认）→ 追加 `latest.json` + `failures.jsonl`；`--iteration N`（N≥1）→ 跑完复制 `{results.json, eval-report.json, benchmark.json?}` 到 `iteration-N/`，`latest.json` 也更新（last-write-wins）。`opsforge evolve` 读 `latest.failures.jsonl` + 所有历史 `iteration-*/failures.jsonl`（去重 by case name）。

**新增测试**（`tools/test-eval-iteration.test.mjs`，mock evaluateCap，断言目录创建 + latest 更新）。

---

## 4. 三态流衔接（回归用例草稿完整路径）

```
源 1: ~/.opsforge/kb/<pack>/feedback/<id>.jsonl
源 2: ~/.opsforge/eval-history/<id>/failures.jsonl
        │
  opsforge evolve <capDir>  (用户触发)
        │
  regression-sink.mjs.generateCase()
        │
  生成 tests/case-NN.yaml 落 _drafts/
  填实: name/input/expect/默认值
  留空: expected=__FILL_ME__, judge_rubric=__FILL_ME__
        │
  【draft gate】R2 yaml_parse + R3 id_unique + R5 version_lock
  + R7 placeholder_clean (__FILL_ME__ 未清 → R7 FAIL)
        │
  用户填 expected + judge_rubric（填空式）
        │
  node tools/new-capability.mjs --promote <path>
        │
  【promote 前置】matchSkeletonSignature（防手改）
        │
  落 _staged/，触发 staged gate:
  R1 schema + R4 naming + R8 skeleton_guard + R9 engineering_fields_untampered
  + R14 tests_min(>=3) + R16 body_min_substance + R17 body_not_boilerplate
  + R18 test_expect_nontrivial(judge_rubric>=20 chars)
  + R19 test_cases_distinct + R20 description_body_alignment
  + R21 test_expect_declared + R22 no_self_cheat_in_body + R_scenario
  + functional runSuite (static-only in CI)
        │ 全过
  release.mjs (aggregateAll 调 release() per cap)
        │
  【release gate】validation-report.verdict=pass
  + security-report.verdict=pass
  + eval-report.verdict∈{pass,pending}
        │
  formal 区，进 registry.yaml
```

**关键不变量**：
- regression-sink **永远**只落 `_drafts/`，**永远**留 `__FILL_ME__`，**永远**不自动 promote。
- 自动沉淀"用例骨架"不沉淀"断言"——保留 R18 反空洞的人工判断。
- promote 仍是唯一 `_drafts/` → `_staged/` 入口（AGENTS.md #11），skeleton 签名比对防手改。
- 三态不可跳级（AGENTS.md #12）。

## 5. Phase 4 落点映射

| 方案项 | PLAN.md 条目 |
|---|---|
| P0-A expect 两段前置门 | §21.4 eval 成本控制 / §21.13 Phase 4 "eval 成本失控"风险缓解 |
| P0-B 回归闭环 | §21.13 Phase 4 "反馈闭环飞轮" + §15 Phase 4 "草稿采集 agent" |
| P1-A 多轮 turns | §21.2 test-case schema 扩展（PLAN 未覆盖多轮，Phase 4 新增） |
| P1-B expect=check | §21.2 expect 模式扩展（PLAN 列 7 模式，Phase 4 加第 8） |
| P1-C evals.json 桥接 | §15 Phase 4 "第三方收录扩到 10+ 社区能力" |
| P1-D benchmark | §21.13 Phase 4 "effectiveness SLA 监控" |
| P2-A 多 engine | §22.12 Phase 4 "平台能力点自动探测"配套 |
| P2-B iteration 归档 | §21.13 Phase 4 "eval-history 趋势看板" |

整体对应 **PLAN §21.13 Phase 4 + §22.12 Phase 4** 双映射；不破 §C.1（无新依赖，复用 Node 内置 fetch/spawn/fs）、§C.4（新工具全 steering 拥有，guardrails.yml 已覆盖 `tools/**`）、§14（R16-R22 保留，R23 新增属同级扩展）。

## 6. 风险与回滚

- **P0-A**：schema 与 test-runner 同 PR；ajv 已 strict:false。回滚：删 `pre_gates` + revert runCase 前置门段；模板未强制写，无遗留。
- **P0-B**：name 生成走 NAME_RE + 冲突加后缀；`opsforge evolve` 输出明确提示草稿含 `__FILL_ME__`。回滚：删 `regression-sink.mjs` + `evolve` 子命令 + `eval.mjs` 失败写段；已生成草稿可手动删 `_drafts/`。
- **P1-A**：Windows stdin 编码测试纳入。回滚：删 `turns` + 多轮分支；用例不填 turns 完全兼容。
- **P1-B**：文档标注"文本匹配，精确 block 解析留后续"。回滚：删 `check` enum + `compareCheck`。
- **P1-C**：round-trip 测试覆盖。回滚：删 `evals-bridge.mjs` + 子命令。
- **P1-D**：`eval.config.yaml` 注释明确 baseline 须是合理基线；advisory 不入 gate。回滚：删 `benchmark.mjs` + 从 R8 EXCLUSIONS 移除。

## 7. MVP 切片排序（给 architect/tdd-guide）

每片可独立验收、独立 merge。

### Slice 1a：P0-A expect 两段前置门（1.5d）
1. schema 加 `pre_gates`（含 AJV 测试）
2. test-runner `runCase` 前置门逻辑（含 mock fetch 测试）
3. validate R18 扩展 + `checkPreGatesNontrivial`
4. 模板注释示例
5. bare `node --test` +5；`validate.mjs --all` exit 0

### Slice 1b：P0-B 回归闭环（3d）
1. `eval.mjs` 失败写 `failures.jsonl`（含测试）
2. `regression-sink.mjs` 纯函数 `generateCase(feedback, failure, opts)`（含 6 条测试）
3. `opsforge.mjs` `evolve` 子命令（交互流程，复用 makeAsker）
4. `paths.mjs` 加 `resolveEvalHistoryDir(capId)`
5. 集成测试：构造 fail → evolve → 生成草稿 → 填空 → promote 成功
6. bare `node --test` +6；`eval.mjs --all` exit 0

### Slice 2a：P1-A 多轮 turns（2d）
1. schema 加 `turns`
2. test-runner `executeDryRun` 多轮分支（stream-json）
3. validate R23 + R18/R19 扩展
4. 模板示例
5. bare `node --test` +5

### Slice 2b：P1-B expect=check（1.5d）
1. schema enum 加 `check`
2. test-runner `compareCheck`
3. validate R18 扩展
4. bare `node --test` +4

### Slice 2c：P1-C evals.json 桥接（2d）
1. `evals-bridge.mjs` import/export 纯函数
2. `opsforge.mjs` 加子命令
3. round-trip 测试 +3

### Slice 2d：P1-D benchmark（1.5d）
1. `benchmark.mjs`
2. `eval.config.yaml` 加 benchmark 段
3. `validate.mjs` R8 EXCLUSIONS 加 `benchmark-report.json`
4. `executeDryRun` 加 `baselineSystemPrompt` opts
5. 测试 +3

### Slice 3a：P2-A 多 engine（2d）
1. `executeCliDryRun` 分派重构
2. cursor/codex/cline spawn 分支（mock 测试）
3. `OPSFORGE_RUNNER=<platform>` 文档

### Slice 3b：P2-B iteration 归档（1d）
1. `eval.mjs` `--iteration N` flag
2. `eval-history/<id>/iteration-N/` 目录逻辑
3. `opsforge evolve` 读历史
4. 测试 +2

**总工作量**：约 15 人日（P0 4.5d，P1 7d，P2 3d）。

## 8. 不变量清单（architect 实现时必须守住）

1. `additionalProperties:false` 在 `test-case.schema.json` + 所有 turn/gate 子对象上保持 `false`。
2. `registry*.yaml` 保持 auto-generated（不动 release.mjs 聚合逻辑）。
3. 贡献者仍只写 `.md/.yaml/.json`——`regression-sink.mjs`/`evals-bridge.mjs`/`benchmark.mjs` 全是 steering 拥有的 `.mjs`，guardrails.yml path-guard 已覆盖 `tools/**`。
4. 回归用例草稿**必须**经 `--promote` 人工 gate；`regression-sink.mjs` 永远不写 `expected`/`judge_rubric` 实值（留 `__FILL_ME__`）。
5. 不引入新 npm 依赖（ajv/js-yaml/semver 已有；fetch/spawn/fs/readline 全 Node 内置）。
6. Windows 兼容：所有路径用 `path.join`；`execFileSync`/`spawn` argv 形式（不拼 shell）；多轮 stream-json stdin 用 Buffer。
7. R16-R22 保留不动；R23（turns）+ R18 扩展（pre_gates/check）是同级新增，不弱化现有反空洞。
8. release gate 三报告（validation/security/eval）逻辑不动；benchmark-report.json 是 advisory，不进 gate。

## 9. 验收总标准

- bare `node --test` 全绿（基线 341 → Phase 4 完成后预计 ≈ 360）。
- `node tools/validate.mjs --all` exit 0（7 dogfood caps，含新 R23/R18 扩展）。
- `node tools/security-scan.mjs --all` exit 0（新工具须过 §B 扫描，无 prompt-injection/SSRF/secret）。
- `node tools/eval.mjs --all` exit 0（dogfood caps verdict=pending，failures.jsonl 不写）。
- `node tools/release.mjs --all` exit 0（3-report gate 不变，benchmark-report.json 不进 gate）。
- 手动 E2E：构造 fail eval → `opsforge evolve` → 生成草稿 → 填空 → `--promote` → `_staged/` → release；构造多轮 skill 用例 → `turns` + `post_condition` 跑通；构造 `expect:check` 用例 → `files_exist` 验证。
