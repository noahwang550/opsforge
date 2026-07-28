# 能力新建方法论 · 文件级实现蓝图（基于 FINAL v1 设计文档）

> 基于 `docs/design-archive/capability-creation-methodology.md`（FINAL，权威）+ 当前代码实测（2026-07-28）。
> v2 文档（`capability-creation-methodology-v2.md`）仅作历史参照，已被 v1 取代；凡 v2 与 v1 冲突处以 v1 为准。
> 本蓝图不分 P0/P1/P2 阶段，按**技术依赖**排序：schema → R-rules → tools → agents → templates → dogfood backfill → tests。

## HARD INVARIANTS（实现者不得违反，逐条标注守护点）

1. **零新 npm 依赖** — 仅 `ajv`/`js-yaml`/`semver`；新 agent source.md 不得 `import`；纯 prompt 脚本零依赖。守护：`package.json` 不动 + `.github/workflows/guardrails.yml` deps-guard。
2. **`additionalProperties: false` 全保留** — 5 个新 test-case 字段是 schema 显式 `properties` 增项，`additionalProperties: false` 不改。守护：`schema/test-case.schema.json` line 7。
3. **`registry*.yaml` auto-gen** — 任何实现不得手改 registry；只动 `tools/release.mjs` 聚合逻辑（本蓝图不动 release.mjs）。
4. **贡献者只写 `.md`/`.yaml`/`.json`** — 2 新 agent + 模板 = steering-owned，CODEOWNERS + guardrails.yml 已覆盖 `packs/opsforge-meta/**` + `templates/**`。
5. **skeleton_guard 不破** — `interview.md` 必须进 **两处** `SKELETON_GUARD_EXCLUSIONS`（`new-capability.mjs:20` **和** `validate.mjs:32`，见 §J 风险 #1）；模板 body H2 增改不改文件集（不加新文件）。
6. **R16–R22 不弱化** — R24–R31 同级 append，staged+ 生效，draft gate（`checkDraftRelaxed` validate.mjs:411-429）不动。
7. **release gate 三报告逻辑不动** — R-rule 全在 `validate.mjs`；`security-scan.mjs`/`eval.mjs`/`release.mjs` 逻辑不变。
8. **Windows 兼容** — in-platform agent 路径无 readline；`opsforge set-phase` CLI 复用 `makeAsker`（opsforge.mjs:93）或纯 argv。
9. **424/424 基线不回退** — 预计 → ~470；新 R-rule 必须同步加 fixture。
10. **平台诚实** — 完整流水线仅 claude-code；Tier 2/3 退 🔵 静态 + 纯 prompt 访谈脚本。

---

## A. Implementation Order（依赖序，非 P0/P1/P2）

每项标注：文件 / 改动 / 触碰的 R-rule 或不变量。

1. **`schema/test-case.schema.json`** — 加 5 字段（§B）。**不动 `additionalProperties:false`**。此为下游 R26/R28 的前置。
2. **`tools/new-capability.mjs:20` `SKELETON_GUARD_EXCLUSIONS`** — 追加 `'interview.md'`。**同时**改 `tools/validate.mjs:32`（doc 漏列此处，见 §J 风险 #1）。触不变量 5。
3. **`templates/interview-record.md`**（新文件）— 实录模板结构（§F）。落 `templates/` 根（非 `templates/<kind>/`，不计入任何 kind skeleton 签名）。
4. **`templates/skill/SKILL.md` / `templates/agent/source.md` / `templates/mcp/source.md`** — body 增 kind 专属 H2 占位（§F）。**不改文件集**（只改 body 内容）。
5. **`templates/skill/tests/case-01..03.yaml` + `templates/agent/tests/*` + `templates/mcp/tests/*`** — 三象限默认值：case-01 positive `expect: contains`，case-02 boundary `expect: contains`，case-03 negative `expect: llm_judge`；加 `quadrant`/`source`/`ref`/`confidence`/`allow_exact_reason`（§F）。
6. **`tools/validate.mjs`** — 新增 R24/R24b/R25/R26/R27/R28/R30/R31 八规则（§C），同级插入 R23（`checkTurnsWellFormed` line 604）之后、`checkScenarioSections`（line 718）之前；扩 `checkOpsforgeState`（line 795-818）校验 `phase` enum；扩 `checkWorkflowRef`（line 734）读被引 cap state（R30）。
7. **`tools/new-capability.mjs`** — `writeOpsforgeState`（line 229）export + 加 `phase`/`built_with_model`/`built_at` 写入参数；新增 `promoteCase(srcPath, caseFile, opts)` 函数（`--promote-case`，§G）；`main()` 加 `--promote-case` 分支。
8. **`tools/opsforge.mjs`** — 加 `set-phase` 子命令（§D）；`cmdNewFlow`（167-178）/`cmdWizard`（211-231）/`cmdNewSubcommand`（297-314）改为"提示 `@capability-interviewer` 或纯 prompt 脚本"接驳（删 promptNew 引导问答，保留 kind/name/slug 直跑 scaffold 的逃生路径）；`writeOpsforgeState` 若有本地副本改为 import new-capability 的导出版（避免双份）。
9. **`tools/test-runner.mjs`** — `executeClaudeDryRun`（512-559）+ `executeMultiTurnDryRun`（583-695）剥 frontmatter（§G）；解析 stream-json `usage` 回传 token；`runSuite` summary 增 token 字段。
10. **`tools/report-renderer.mjs`** — 新增 `renderRunLight`（跑通门两档灯 🟢/🔵 + cheapest 烟雾文案 + 🔵 升级出口 + recalled+med "未硬验证"标 + 模型版本不匹配降级标 + token 累计）（§G）。
11. **`install.mjs`** — `effectivenessScan`（477-493）按 capId 查 manifest→tier 拆线（§G）；修 feedback 数据源不一致（§J 风险 #2）。
12. **`tools/regression-sink.mjs`** — `generateCase`（71-108）产 yaml 加 `quadrant: __FILL_ME__`（§G）。
13. **`tools/opsforge.mjs` `cmdDiscover`/`cmdDoctor`** — evolve 被动触发提示（feedback≤2 或第3次调用）（§G）。
14. **`packs/opsforge-meta/agents/capability-interviewer/`**（新 agent 目录）— `source.md` + `capability.yaml` + `CHANGELOG.md` + `README.md` + `tests/case-01..03.yaml` + `.opsforge-state.json`（§E）。
15. **`packs/opsforge-meta/skills/opsforge-interview/`**（新 skill，纯 prompt 脚本）— `SKILL.md`（与 interviewer agent source.md 同内容）+ tests + 元文件（§E）。
16. **`packs/opsforge-meta/agents/capability-distiller/`**（新 agent 目录）— 同结构（§E）。
17. **`packs/opsforge-meta/skills/opsforge-wizard/SKILL.md`** — `## 运行指令` 改路由：访谈员→蒸馏器→跑通→迭代四期 + 指向 2 新 agent + 同会话交接。
18. **Dogfood backfill**（§H）— `packs/marketing-team/` activity-summary / copywriter / bi-connector：body 加 H2 + tests 加 quadrant/source/ref + case-01 `expect: exact`→`contains`/`llm_judge`。
19. **`tools/workflow-runner.mjs`**（v0.2，可后置）— checkpoint decision 注入 + 受限 condition 求值器 + decision replay 诚实标注。此项可独立 PR，不阻塞 1-18。
20. **测试**（§I）— 新增 R24–R31 fixture + interviewer/distiller 回归 + promote-case + set-phase + 两档灯渲染 + effectiveness Tier 拆线 + regression-sink quadrant。
21. **`.github/workflows/guardrails.yml` + `CODEOWNERS`** — 确认新 agent/新模板/schema 路径已被现有 glob 覆盖（实测已覆盖，§J 风险 #3 仅需复核）。
22. **`docs/methodology/capability-creation.md`**（新）— 贡献者文档：5 期 + 形状推导 + C12 业务语言对照表 + 平台诚实分层 + 成本预估 + source/ref 规则。

---

## B. Schema diff — `schema/test-case.schema.json`

在 `properties`（line 9-81）内、`turns` 之后追加 5 字段。`additionalProperties: false`（line 7）不动。全部可选（无 `required` 增项）。

```jsonc
"quadrant": {
  "type": "string",
  "enum": ["positive", "boundary", "negative", "degradation"]
},
"source": {
  "type": "string",
  "enum": ["real", "recalled", "synthetic", "llm_drafted_confirmed"]
},
"confidence": {
  "type": "string",
  "enum": ["high", "med", "low"]
},
"allow_exact_reason": {
  "type": ["string", "null"]
},
"ref": {
  "type": ["string", "null"]
}
```

注：`source` enum 第 4 值 `llm_drafted_confirmed` 是 v1 相对 v2 的新增（隔离 LLM 草拟样本，不进 staged 正例，由 R26 强制）。

---

## C. R-rule 表（R24/R24b/R25/R26/R27/R28/R29/R30/R31）

全部为 `validate.mjs` staged+ 同级 append，插在 `checkTurnsWellFormed`（line 604-624）之后、`checkDescriptionBodyAlignment`（line 626）之前。draft gate（`checkDraftRelaxed` line 411-429）不动。每规则返回 `{name, status, detail}`，`status ∈ {pass, fail, warn}`（R26 软警告用 `warn`，verdict 计算时 `warn` 不算 fail —— 需在 `validateDir` verdict 行 line 939 改为 `every((c) => c.status === 'pass' || c.status === 'n/a' || c.status === 'warn')`，**这是对 verdict 逻辑的最小扩展，非弱化 R16-R22**）。

| R | name | 触发点 | 检查逻辑 | validate.mjs 插入位置 |
|---|------|--------|---------|----------------------|
| R24 | `process_stages_present` | validate staged | skill: body 含 `## 运行流程` ≥2 编号阶段（`### 步骤` 计数 ≥2）且每步含 `数据:`/`决策:`/`交付工件:` 之一标记；agent: `## 角色设定` 非空（extractH2Section 后 trim 长度 >0）；mcp: `## 工具面` 非空 且 `tools:` 数组非空；workflow: `steps.length >= 2` | line 624 后 |
| R24b | `degradation_present` | validate staged | skill: `## 失败降级` ≥1 条（`-` 列表项计数 ≥1）；agent: `## 边界` 非空；mcp: `## 异常处理` 非空；workflow: 每个失败路径（step 含 `on_error` 或 checkpoint）有降级动作 | R24 后 |
| R25 | `depends_declared` | validate staged | body `## 依赖` H2 提到的 capId（正则 `^[a-z][a-z0-9-]+\.[a-z0-9-]+(@[0-9.]+)?$` 匹配）必须出现在 frontmatter `depends_on:` 数组；反之 `depends_on` 每个 capId 必须在 body `## 依赖` 出现。双向不一致 → fail | R24b 后 |
| R26 | `test_four_quadrants` | validate staged | `readTestCases` 后按 `c.quadrant` 分组：≥1 `positive` + ≥1（`negative` 或 `degradation`）+ ≥1 `boundary`。**正例** `source` ∈ {`real`, `recalled`}（若 `source=recalled` 则 `confidence` 须 `high`/`med`，`low` fail；`synthetic`/`llm_drafted_confirmed` 正例 → fail）。**软检查**（status=`warn` 不 fail）：case body `description` 或 `name` 与 quadrant 业务语言例对（§6 表）语义对齐 —— 用关键词集合启发式（positive: 正常/顺利/成功；boundary: 边界/极端/特殊；negative: 拒绝/不该/非法；degradation: 降级/兜底/上游挂），不命中 → warn | R25 后 |
| R27 | `run_instruction_present` | validate staged | body 含 `## 运行指令` H2，`countBodyTokens(该节)` ≥80（复用 line 450 `countBodyTokens`） | R26 后 |
| R28 | `expect_mode_kind_safe` | validate staged | 遍历 `readTestCases`：① `c.quadrant===positive` 且 `c.expect===exact` 且 `!c.allow_exact_reason` → fail；② `c.quadrant===negative` 或 `degradation` 且 `c.expect` ∉ {`llm_judge`,`regex`} → fail（禁 `contains`-only / `exact`）。boundary 不强制 | R27 后 |
| R29 | `interview_real_sample_present` | **promote()**（非 validate.mjs，挂 `new-capability.mjs promote()` line 180 + `promoteCase`） | 读 `_drafts/<slug>/interview.md` 的 `## 真实样本` 正例行：`input` 非空非 `__FILL_ME__`；凡 `source: real` 须带 `ref` 且 `ref` 可解析（文件存在 OR 匹配记录 ID/hash 格式 —— 文件存在性用 `fs.existsSync`，ID/hash 格式用正则 `^[a-zA-Z0-9_:-]{4,}$`）；`phase` 合法性（见 §D） | 不在 validate.mjs；在 `promote()`/`promoteCase()` 内调 |
| R30 | `workflow_step_refs_graduated` | validate staged | 扩 `checkWorkflowRef`（line 734）：现有 resolvable 检查后，加 `const refCap = allCaps.find(c => c.yaml.id === step.capability); if (refCap && refCap.state && refCap.state !== 'staged' && refCap.state !== 'released')` → fail "references non-graduated cap (state=<x>)"。`scanCapabilities` 已返回 `state`（`parseCapability` line 117），无需改 scanCapabilities | 改 line 734-756 |
| R31 | `distill_log_verifiable` | validate staged | body 含 `## 蒸馏日志` H2（无则 n/a）；每条日志行匹配 `来自实录步骤(\d+)` 或 `step (\d+)` 提取 N → 读 `interview.md` `## 流程实录` `### 步骤N` 存在性（`fs.existsSync` + 文本 contains 步骤标题）；内容与指令语义相关 = 步骤正文与日志条目的关键词重合度 ≥1 词（zero-dep：token 集合交集 ≥1，CJK 单字 + 英文 ≥2 字母词）。幻觉引用（步骤不存在 OR 零重合）→ fail | R28 后 |

**R29 特殊**：doc §8 表列 R29 触发点 = `promote()`，不在 validate.mjs staged gate。实现：`new-capability.mjs promote()`（line 180）在 `matchSkeletonSignature`（line 194）之后、`fs.renameSync`（line 205）之前调 `checkInterviewRealSample(srcPath)`；`promoteCase` 同样调。R29 失败 → throw（promote 失败）。

---

## D. State/CLI additions

### `.opsforge-state.json` 字段扩展

当前 `writeOpsforgeState`（new-capability.mjs:229-247）写 `{state, history[]}`。扩展：

- `phase`: string enum `[interview_done, distill_done, v0.1_built, iteration_converged, iteration_capped]`，与 `state`（draft/staged/released/registry）正交，默认不写（undefined 即"未进入新流程"）。
- `built_with_model`: `{endpoint: string, version: string} | null`（F6，模型升级触发重验信号）。
- `built_at`: ISO string | null。

`writeOpsforgeState(destPath, newState, fromState, opts = {})` 签名扩展：`opts.phase` / `opts.builtWithModel` / `opts.builtAt`。写时若 opts 提供则覆盖，否则保留既有值。

### `checkOpsforgeState` 扩展（validate.mjs:795-818）

在现有 `state.state` enum 校验后，加：
- 若 `state.phase` 存在则必须 ∈ 上述 5 enum 值，否则 fail。
- 若 `state.built_with_model` 存在则必须是 object 含 `endpoint`(string) + `version`(string)。
- `built_at` 若存在须 ISO string。

### CLI: `opsforge set-phase <capDir> <phase>`

`tools/opsforge.mjs` `main()` switch（line 53-71）加 `case 'set-phase': return cmdSetPhase(argv.slice(1));`。

```
cmdSetPhase(args):
  capDir = args[0]; phase = args[1];
  validate phase ∈ 5 enum;
  export { writeOpsforgeState } from './new-capability.mjs'  // 须先 export
  read 既有 state（保留 state/built_with_model）;
  writeOpsforgeState(capDir, 既有state, 既有state, { phase, builtWithModel: opts.builtWithModel, builtAt: opts.builtAt });
  push history {ts, from: 旧phase, to: 新phase, pr: null};
```

Windows 兼容：纯 argv，无 readline。in-platform agent 经 Bash 调 `opsforge set-phase`，不直接编辑 JSON。

### `help` 文本（line 48-49）+ `available`（line 69）加 `set-phase`。

---

## E. 2 new agents + 1 new skill

### E.1 `capability-interviewer` agent

目录（镜像 `packs/opsforge-meta/agents/opsforge/` 结构）：
```
packs/opsforge-meta/agents/capability-interviewer/
  capability.yaml      # id: opsforge-meta.capability-interviewer, kind: agent, platforms: [claude-code], entrypoint: source.md
  source.md            # 主体（见下）
  CHANGELOG.md
  README.md
  tests/case-01.yaml   # 反锚定回归
  tests/case-02.yaml   # Mode A 复述回归
  tests/case-03.yaml   # source 追问 real 须 ref
  .opsforge-state.json # {state: released, ...}（或 staged）
```

`source.md` frontmirror `opsforge/source.md` 结构。`## 运行指令` 编码（来自 doc §4.1 + 附录 B 触点 1-5）：
- 开场成本预估 + Mode A/B 决策树（触点 1）。
- Mode A 分段复述 + 数据不进会话（触点 2）。
- Mode B 问题树 + 形状推导信号（触点 3）。
- 样本草稿 propose_and_confirm（触点 4），`llm_drafted_confirmed` 标注。
- 来源追问 + 反锚定守卫（触点 5）：草稿对不上复述 → 标 `synthetic` 不标 `real`；`real` 须带可解析 `ref`。
- 产出 `_drafts/<slug>/interview.md`（用 `templates/interview-record.md` 结构）。
- 结束调 `opsforge set-phase <capDir> interview_done`（Bash，对作者透明）。
- 约束：不写 frontmatter 新字段；不改 schema；只产 `interview.md`（已在 skeleton_guard exclusions）。

### E.2 `opsforge-interview` skill（纯 prompt 脚本，双形态）

```
packs/opsforge-meta/skills/opsforge-interview/
  SKILL.md             # 与 interviewer source.md 同内容（纯 prompt，不依赖被注入平台 agent 文件）
  CHANGELOG.md
  README.md
  tests/case-01..03.yaml
  .opsforge-state.json
```

`SKILL.md` body = interviewer `source.md` body 的副本（doc §4.1："同内容作纯 prompt 脚本"）。区别仅在 frontmatter `kind: skill` + `entrypoint: SKILL.md`。作者在任意 LLM 跑一遍产 interview.md 贴回 `_drafts/`。**不依赖 claude-code agent 文件注入** → dify/cline 可达访谈期。

### E.3 `capability-distiller` agent

```
packs/opsforge-meta/agents/capability-distiller/
  capability.yaml      # id: opsforge-meta.capability-distiller, kind: agent
  source.md
  CHANGELOG.md
  README.md
  tests/case-01.yaml   # 形状推导四分支
  tests/case-02.yaml   # 蒸馏日志机械验证
  tests/case-03.yaml   # 行为缺口回访谈
  .opsforge-state.json
```

`source.md` `## 运行指令` 编码（doc §4.2 + 附录 B 触点 6-9）：
- 步骤序列：① 读 interview.md → 形状推导附理由 + C12 业务语言例对（触点 6，作者按场景匹配确认非 enum）；② `Bash: node tools/new-capability.mjs --kind <推导kind> --slug <slug> --name <name>`；③ Write 覆写业务字段 + 双工件；④ distiller 给 quadrant/source/confidence/allow_exact_reason 默认值作者确认（触点 7，`allow_exact_reason` 对作者隐藏）；⑤ `Bash: opsforge set-phase <capDir> distill_done`。
- 双工件：`## 运行指令`（系统提示词草稿）+ `## 蒸馏日志`（每条"来自实录步骤N"，R31 机械验证）。
- 行为缺口不编造（触点 8，F5）：实录未覆盖象限 → 抛"行为缺口——需补样本"回访谈，不凭空补处理。
- 失败三选一分流 + 作者侧逃生舱（触点 9）：输出格式错→改提示词；数据值不匹配→改 case/实录；步骤顺序错→改实录；+ 一键退回 Mode B 纯访谈+手填 body。
- 约束：只写 body/H2/业务字段 + workflow.yaml；不加 frontmatter 新字段；schema 不动；skeleton_guard 不破。

### 通过 R1–R22 + release

三新 agent 须过 `validate.mjs --all`（R1-R22 + R_scenario + R_wf_* + R23 + 新 R24-R31）+ `security-scan.mjs` + `eval.mjs`（pending 可）+ `release.mjs`。`registry*.yaml` auto-regen。

---

## F. Template changes

### F.1 `templates/interview-record.md`（新）

落 `templates/` 根（非任何 `templates/<kind>/`，不计入 skeleton 签名）。内容（doc §5.1 + §10 P0-3）：

```
# 操作实录: <工作名>
## 任务动机  痛点/频率/单次耗时/范围边界
## 流程实录
### 步骤1 <动作>  数据:<文件路径/测试数据生成方式/规避PII的schema，不贴原值>  决策:…  人工闸门:…  交付工件:…
## 真实样本（interviewer 先草拟，作者确认）
- 正例  input: <草稿> 产出: <草稿>  source: real|llm_drafted_confirmed|recalled|synthetic  ref: <可验证工件路径/ID，real 必填>
- 边界  input: <草稿> 降级/产出: …  source: real|recalled  confidence: high|med|low
- 负例  input: <草稿> 失败返回: …  source: real|recalled  confidence: high|med|low
## 不做哪些
## 依赖的外部资源（数据源/MCP/前置能力 capId）
```

### F.2 `templates/skill/SKILL.md` body 增 H2

当前只有 `## 能力说明` + `## 适用场景`（line 23-29）。在 `## 适用场景` 之后追加（全 `__FILL_ME__` 占位，不改文件集）：

```
## 运行流程
### 步骤1 __FILL_ME__  数据:__FILL_ME__  决策:__FILL_ME__  交付工件:__FILL_ME__
### 步骤2 __FILL_ME__  数据:__FILL_ME__  决策:__FILL_ME__  交付工件:__FILL_ME__
## 失败降级
- __FILL_ME__
## 依赖
- __FILL_ME__
## 运行指令
__FILL_ME__
## 蒸馏日志
- __FILL_ME__ 来自实录步骤1
```

### F.3 `templates/agent/source.md` body 增 H2

追加：`## 角色设定` / `## 工具集` / `## 边界` / `## 依赖` / `## 运行指令` / `## 蒸馏日志`（全 `__FILL_ME__`）。

### F.4 `templates/mcp/source.md` body 增 H2

追加：`## 工具面` / `## 数据契约` / `## 异常处理` / `## 依赖` / `## 运行指令` / `## 蒸馏日志`（全 `__FILL_ME__`）。

### F.5 `templates/<kind>/tests/case-01..03.yaml` 改默认值

当前三 case 全 `expect: exact`（line 3）。改为三象限 + 新字段：

**case-01.yaml**（positive）:
```yaml
name: positive-case
input: __FILL_ME__
expect: contains        # R28: positive 禁 exact 默认
expected: __FILL_ME__
schema_ref: null
judge_rubric: null
judge_threshold: 0.7
weight: 1.0
quadrant: positive
source: __FILL_ME__     # real|recalled|synthetic|llm_drafted_confirmed
confidence: __FILL_ME__ # high|med|low
allow_exact_reason: null
ref: null               # real 必填（R29）
```

**case-02.yaml**（boundary）:`expect: contains`, `quadrant: boundary`, 余同。
**case-03.yaml**（negative）:`expect: llm_judge`, `quadrant: negative`, `judge_rubric: __FILL_ME__`（R18 llm_judge 须 rubric ≥20 字符）。

`templates/agent/tests/*` + `templates/mcp/tests/*` 同模式（mcp case-01 可 `expect: schema` + `schema_ref` 替代，doc §5.3 mcp 静态 schema 校验为主）。

**注意**：`__FILL_ME__` 在 draft gate（R7 placeholder_clean）会挡 staged+，但 **draft gate 不跑这些**（draft 只跑 `checkDraftRelaxed`），且 templates 本身在 `templates/` 不被 validate。Scaffold 后 `_drafts/` 副本在 promote 前必须由 distiller 覆写清空 `__FILL_ME__`，否则 R7 fail（既有行为，不变）。

---

## G. Tool changes（per-tool exact edits）

### G.1 `tools/new-capability.mjs`

1. **line 20 `SKELETON_GUARD_EXCLUSIONS`**: 追加 `'interview.md'`。
2. **line 229 `writeOpsforgeState`**: 改为 `export function writeOpsforgeState(destPath, newState, fromState, opts = {})`；opts 内 `phase`/`builtWithModel`/`builtAt` 写入；history push 加 `phase` 字段。保留原子写（`atomicWriteSync` line 246）。
3. **新增 `promoteCase(srcPath, caseFile, opts)`**: 单 case 粒度 promote。读 `<srcPath>/tests/<caseFile>` → R29 `checkInterviewRealSample` → 良构检查（expected 非空非 `__FILL_ME__`；`expect` 模式 vs `quadrant` 匹配 R28；软提示 `expected==当前产出` 仅 console.warn 不挡）→ run-pass 检查（调 `test-runner.mjs runSuite` 单 case dry-run，`contains` 命中或 `llm_judge` pass）→ 通过则把该 case 文件 rename 到目标 staged dir 的 `tests/`（若 staged dir 不存在先建）→ 写 `.opsforge-state.json` phase。
4. **`main()` line 270**: 加 `if (args['promote-case'])` 分支调 `promoteCase`。加 `--promote-case <file>` 解析。

### G.2 `tools/test-runner.mjs`

1. **`executeClaudeDryRun` line 531-535**: 读 entrypoint 后剥 frontmatter：`const raw = fs.readFileSync(epPath,'utf8'); const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/); systemPrompt = m ? m[1].trim() : raw.trim();`（与 `validate.mjs:442` getBody 同正则）。当前**未剥**，传整文件含 frontmatter 给 `--system-prompt` —— 确认 gap。
2. **`executeMultiTurnDryRun` line 586-588**: 同样剥 frontmatter。
3. **stream-json usage 解析**: 在 `proc.stdout.on('data')` 解析（line 618-684）内，对 `msg.type === 'result'` 的消息读 `msg.usage`（input_tokens/output_tokens），累加到闭包变量 `tokenUsage`；resolve 时返回 `{ text: lastAssistantText, tokenUsage }` —— 需改返回类型。`runSuite` summary 增 `token_total` 字段。
4. **`runSuite` line 701-704**: 跑通门用最便宜 endpoint（环境变量 `OPSFORGE_CHEAPEST_MODEL` 或 `eval.config.yaml` 既有 endpoint），不跑全 case；只跑 positive + 1 boundary/negative（≥2 case，F7）。

### G.3 `tools/report-renderer.mjs`

新增 `renderRunLight(opts)`:
- 输入 `{tier: 1|2|3, pass: bool, tokenTotal, recalledMed: bool, modelMismatch: bool, capId}`。
- Tier 1 pass → `🟢` + "cheapest endpoint 烟雾通过，未刻画部署模型行为"（F7）。
- Tier 2/3 → `🔵` + "本平台暂不支持真跑通，你的能力本身没问题" + 升级出口路径文案。
- fail → `🔴` + 三选一修复引导。
- `recalled+med` → 标"未硬验证"。
- `modelMismatch` → 标"模型版本变更，建议重验"。
- token 累计渲染。
- 复用既有 template 引擎（`report-templates/`），新增 `run-light.zh.md` 模板。

`opsforge.mjs cmdStatus`（line 340-372）/`cmdReport`（274-294）跑通门后调 `renderRunLight`。

### G.4 `install.mjs` `effectivenessScan`（line 477-493）

当前读 `~/.opsforge/feedback/ratings.jsonl`（MCP `/rate` 写）。改为：
- 按 capId 查 manifest（`readManifest` line 88-90）→ 找该 cap 的 `platforms` → 调对应 `adapter.tier()`（`adapters/base.mjs tier()`）。
- Tier 1 caps 进主分母（feedback jsonl 评分）；Tier 2/3 排除主分母，单独一条线（人工签字数 + feedback 评分，仅展示不降级）。
- **修数据源不一致**（§J 风险 #2）：`cmdFeedback`（opsforge.mjs:419）写 `kb/<pack>/feedback/<cap-id>.jsonl`，`effectivenessScan` 读 `feedback/ratings.jsonl` —— 两者不通。改为 `effectivenessScan` 读 per-cap jsonl（`kb/<pack>/feedback/<cap-id>.jsonl`）按 capId 聚合 + manifest 查 tier。

### G.5 `tools/regression-sink.mjs` `generateCase`（line 89-98）

`caseYaml` 对象加 `quadrant: '__FILL_ME__'`（doc P1-8）。`__FILL_ME__` 由 R7 placeholder_clean 在 staged+ 挡，由 distiller 在迭代期覆写为真实象限。

### G.6 `tools/opsforge.mjs` evolve 被动触发

`cmdDiscover`（line 237-271）/`cmdDoctor`（375-392）：读 per-cap feedback jsonl 调用次数 + 评分；若某 cap 第 3 次被 discover/doctor 查询 OR feedback≤2 → console.log "考虑跑 `opsforge evolve <capId>` 补一条上次崩了的情况"（C4）。无状态则不触发（doc 风险 #9）。

---

## H. Dogfood backfill（`packs/marketing-team/`）

### H.1 `skills/activity-summary/SKILL.md`

`## 适用场景` 后追加：`## 运行流程`（≥2 步骤占位，用真实示例文案非 `__FILL_ME__`，因 staged+ R7）+ `## 失败降级` + `## 依赖` + `## 蒸馏日志`。`## 运行指令` 已存在（line 34）保留。R24/R24b/R25/R27 需非空真内容。

### H.2 `agents/copywriter/source.md`

追加：`## 角色设定` + `## 工具集` + `## 边界` + `## 依赖` + `## 蒸馏日志`。`## 运行指令` 已存在（line 34）。

### H.3 `mcps/bi-connector/source.md`

追加：`## 工具面`（引用 `query-metrics`）+ `## 数据契约` + `## 异常处理` + `## 依赖` + `## 蒸馏日志`。

### H.4 tests/case-01.yaml（三 cap）

当前 `expect: exact`（activity-summary line 4 / copywriter line 4 / bi-connector line 4）。改：
- activity-summary case-01: `expect: contains`, `quadrant: positive`, `source: recalled`, `confidence: med`, `ref: null`。
- copywriter case-01: `expect: contains`, `quadrant: positive`, `source: recalled`, `confidence: med`。
- bi-connector case-01: `expect: schema`, `schema_ref` 指向 inline schema, `quadrant: positive`。
- 各 case-02 改 `quadrant: boundary`，case-03 改 `quadrant: negative` + `expect: llm_judge` + `judge_rubric`（≥20 字符）。

**注**：dogfood 用 `recalled`+`med`（非 `real`+ref）—— 因 dogfood 无可验证工件引用，诚实标"未硬验证"（report-renderer 渲染）。R26 允许 recalled+med 正例。

---

## I. Test plan

### 新增测试文件（`node:test`）

1. `tools/test/validate-r24-process-stages.test.mjs` — 4 kind fixture 各一 pass + 一 fail（缺 H2）。
2. `tools/test/validate-r24b-degradation.test.mjs` — 4 kind 降级缺失 fail。
3. `tools/test/validate-r25-depends-declared.test.mjs` — 双向不一致 fixture。
4. `tools/test/validate-r26-four-quadrants.test.mjs` — 三象限缺失 / synthetic 正例 / llm_drafted_confirmed 正例 fail；recalled+low fail；recalled+med pass；软警告 warn 不 fail。
5. `tools/test/validate-r27-run-instruction.test.mjs` — <80 token fail。
6. `tools/test/validate-r28-expect-mode.test.mjs` — positive+exact+无 allow_exact_reason fail；negative+contains fail；negative+llm_judge pass。
7. `tools/test/validate-r29-interview-real-sample.test.mjs` — `source:real` 无 ref fail；ref 不可解析 fail；promote 挂。
8. `tools/test/validate-r30-workflow-graduated.test.mjs` — step.capability 指向 draft cap fail。
9. `tools/test/validate-r31-distill-log.test.mjs` — 步骤 N 不存在 fail；零重合 fail；正常 pass。
10. `tools/test/promote-case.test.mjs` — `promoteCase` 良构 + run-pass 钩子。
11. `tools/test/set-phase.test.mjs` — phase enum 校验 + history push + 透明性。
12. `tools/test/render-run-light.test.mjs` — 两档灯 + cheapest 文案 + recalled+med 标 + modelMismatch 标。
13. `tools/test/effectiveness-tier-split.test.mjs` — Tier 2/3 排除主分母 + per-cap jsonl 读取。
14. `tools/test/regression-sink-quadrant.test.mjs` — `generateCase` 产 yaml 含 `quadrant: __FILL_ME__`。
15. `packs/opsforge-meta/agents/capability-interviewer/tests/case-01..03.yaml` — 反锚定 / Mode A / source 追问。
16. `packs/opsforge-meta/agents/capability-distiller/tests/case-01..03.yaml` — 形状推导 / 蒸馏日志 / 行为缺口。

### 既有测试须保持 green

- 全部 Phase 4 既有 424 测试（`tools/test/*.test.mjs`）。
- 7 既有 capability 的 `validate --all` / `security-scan --all` / `eval --all` / `release --all`。
- `SKELETON_GUARD_EXCLUSIONS_GET` 测试（validate.mjs:34）须断言含 `interview.md`。
- 模板签名测试：改 body H2 后须仍 match（签名比文件集非内容，应自动通过，但需复核 `tools/test/skeleton-guard.test.mjs` 若存在）。

预计 424 → ~470（+46）。

---

## J. Risk callouts（doc 与现实冲突 / under-specified）

### J.1 `interview.md` exclusions 漏列 validate.mjs（doc P0-6 不全）
doc §10 P0-6 只说改 `tools/new-capability.mjs SKELETON_GUARD_EXCLUSIONS`。实测 `validate.mjs:32` 有**独立副本**（多含 `benchmark-report.json`）。若只改 new-capability 不改 validate，`_drafts/<slug>/interview.md` 在 `validate --all` 时会被 `checkSkeletonGuard`（validate.mjs:167）判为 `extra` → fail。**必须两处都加**。

### J.2 `effectivenessScan` 数据源与 `cmdFeedback` 不通（doc P1-7 未提）
`cmdFeedback`（opsforge.mjs:419-440）写 `kb/<pack>/feedback/<cap-id>.jsonl`；`effectivenessScan`（install.mjs:477-493）读 `feedback/ratings.jsonl`（MCP `/rate` 写）。两者**完全不通**。doc P1-7 "feedback jsonl 带 capId" 已满足（cmdFeedback 写 `cap_id`），但 `effectivenessScan` 根本没读这个文件。Tier 拆线前必须先修数据源（§G.4）。否则 evolve 被动触发（§G.6）也无数据。

### J.3 distiller 多步 Bash/Write agent 可靠性（doc 风险 #8）
distiller 步骤序列跨 ① Bash scaffold ② Write 覆写 ③ Bash set-phase 三步。Claude Code agent 一次跑通概率低。doc 已认此风险，靠 wizard body 编码步骤 + 回归测试 + 逃生舱兜底。**实现者注意**：distiller tests 须用 `turns` + `post_condition` 多轮模式（Phase 4 P1-A 既有 `executeMultiTurnDryRun`），且 `must_contain_any` 用 loose contains 而非 exact（LLM 非确定性）。

### J.4 R31 蒸馏日志机械验证启发式弱（doc 风险 #11 同）
"步骤 N 内容与指令语义相关"用 zero-dep token 交集 ≥1 判定，过于宽松（任何共用一个英文词即 pass）。实现者可收紧为：CJK 共用 ≥2 单字 OR 英文共用 ≥2 个 ≥2 字母词。但勿引 embedding（违不变量 1）。

### J.5 R26 软检查业务语言表质量（doc 风险 #11）
R26 软警告靠关键词集合（positive:正常/顺利/成功…）。中文同义词多，启发式失真。doc §6 C12 业务语言对照表是 steering-authored，质量决定 R26 准确度。实现者须把对照表落 `docs/methodology/capability-creation.md` 且 R26 关键词集合从该表派生（可加注释指向）。

### J.6 `writeOpsforgeState` 双副本（new-capability.mjs:229 + opsforge.mjs 未导出）
grep 显示 opsforge.mjs **无** `writeOpsforgeState`。doc P0-8 说 "set-phase 转发 writeOpsforgeState"。实现：须从 `new-capability.mjs` export 该函数（当前非 export），`opsforge.mjs` import 调用。勿在 opsforge.mjs 复制副本（双源真相）。

### J.7 R29 `ref` 可解析判定
doc 说 "ref 可解析"。但 ref 可能是记录 ID（非文件路径），`fs.existsSync` 不适用。实现：先 `fs.existsSync`（文件路径场景），失败则正则 `^[a-zA-Z0-9_:-]{4,}$`（ID/hash 场景）。两者皆不过 → fail。doc 未给精确判定，此为实现裁量，须在 R29 测试 fixture 覆盖三种（文件存在 / ID 格式 / 两者皆非）。

### J.8 verdict 逻辑扩展（warn 不算 fail）
当前 `validateDir` line 939 `every((c) => c.status === 'pass' || c.status === 'n/a')`。R26 软警告引入 `warn`。须扩展为 `pass || n/a || warn`。**这不是弱化 R16-R22**（R16-R22 仍 fail 不变），仅是新增 warn 状态。实现者须确认既有 R-rule 无用 warn 状态（实测无），且新测试断言 warn 不改变 verdict。

### J.9 模板签名测试复核
改 `templates/<kind>/` body H2 不改文件集，签名应自动通过。但 `interview-record.md` 落 `templates/` 根 —— 若任何签名扫描逻辑误把它当 `templates/<kind>/` 子文件会出错。实测 `walkFiles`（validate.mjs:43-54）按 `templates/<kind>/` 起算，`templates/interview-record.md` 不在任何 kind 目录下，安全。复核 `tools/test/skeleton-guard.test.mjs`。

### J.10 doc §10 P2-5 per-adapter dry-run 契约（未来）
doc 标"未来"，本蓝图不实现。但 Tier 2 升 🟡 需 HTTP 加 `system_prompt` 字段或 CLI 加 `--system-prompt`。当前 `executeCliDryRun`（test-runner.mjs:457-468）仅 dispatch claude-code。此项 deferred。

### J.11 workflow-runner v0.2（doc P1-10）
受限 condition 求值器 + vars schema 字段 + decision 注入是新建工作（doc §5.3 表 v0.2 列）。本蓝图列 Implementation Order #19 但标注可独立 PR 不阻塞 1-18。v0.1 门 (a)(c)(e) 已有（R_wf_ref + R30 + 人工签字）。

### J.12 `cmdNewFlow`/`cmdWizard` 改接驳后 `promptNew` 保留？
doc P0-7 说"不再引导问答；提示 @capability-interviewer"。但 `promptNew`（444-453）是 `cmdNewSubcommand` 的依赖。实现者：保留 `promptNew` 作逃生路径（作者明确要绕过 LLM 直接 scaffold 时用），但 `cmdNewFlow`/`cmdWizard` 默认改提示 interviewer。勿删 `promptNew`（向后兼容 + 测试可能依赖）。

---

## 关键文件路径清单（实现者按此索引）

- Schema: `D:\XD\ClaudeCode\sy-eeo\schema\test-case.schema.json`
- Exclusions: `D:\XD\ClaudeCode\sy-eeo\tools\new-capability.mjs:20` + `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs:32`
- R-rules: `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs`（R23 line 604 后插；verdict line 939 改）
- State: `D:\XD\ClaudeCode\sy-eeo\tools\new-capability.mjs:229`（export）+ `D:\XD\ClaudeCode\sy-eeo\tools\opsforge.mjs`（set-phase）
- checkOpsforgeState: `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs:795`
- checkWorkflowRef: `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs:734`
- promote: `D:\XD\ClaudeCode\sy-eeo\tools\new-capability.mjs:180`
- test-runner frontmatter: `D:\XD\ClaudeCode\sy-eeo\tools\test-runner.mjs:512-559` + `583-695`
- report-renderer: `D:\XD\ClaudeCode\sy-eeo\tools\report-renderer.mjs`（新增 renderRunLight）
- effectivenessScan: `D:\XD\ClaudeCode\sy-eeo\install.mjs:477-493`
- regression-sink: `D:\XD\ClaudeCode\sy-eeo\tools\regression-sink.mjs:71-108`
- cmdDiscover/cmdDoctor: `D:\XD\ClaudeCode\sy-eeo\tools\opsforge.mjs:237` + `375`
- Templates: `D:\XD\ClaudeCode\sy-eeo\templates\{interview-record.md,skill/SKILL.md,agent/source.md,mcp/source.md}` + `tests/case-01..03.yaml`
- 新 agents: `D:\XD\ClaudeCode\sy-eeo\packs\opsforge-meta\agents\capability-{interviewer,distiller}\`
- 新 skill: `D:\XD\ClaudeCode\sy-eeo\packs\opsforge-meta\skills\opsforge-interview\`
- wizard: `D:\XD\ClaudeCode\sy-eeo\packs\opsforge-meta\skills\opsforge-wizard\SKILL.md`
- Dogfood: `D:\XD\ClaudeCode\sy-eeo\packs\marketing-team\{skills\activity-summary,agents\copywriter,mcps\bi-connector}\`
- CI: `D:\XD\ClaudeCode\sy-eeo\.github\workflows\guardrails.yml`（复核，无需改）
- 贡献者文档: `D:\XD\ClaudeCode\sy-eeo\docs\methodology\capability-creation.md`（新）
