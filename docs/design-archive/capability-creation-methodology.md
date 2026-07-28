# 能力新建方法论 · 最终版

> 状态：FINAL。已过 AI 应用专家 v1 评审 + 主会话头脑风暴两轮 + 3 轮对抗性评审（可行性 / 业务使用习惯 / 应用 AI 最佳实践）。
> 核心转变：作者从"往空模板填字"变成"提供场景描述 + 审稿"；**LLM 先生成草稿、作者审核确认**（propose_and_confirm）；"建好"由真实输入跑通定义；能力成熟度由真实使用证据背书。
> 三轮关键修正：① 认知分工倒过来（LLM 先草拟作者确认，不要求作者从零提供精确真实样本）；② 数据不进会话（文件路径/生成测试数据/规避 PII）；③ `source: real` 升级为**可验证硬事实工件引用**（非自证）+ `llm_drafted_confirmed` 隔离 LLM 草拟样本；④ 负例/降级强制 `llm_judge`/`regex`（contains 退回 positive 专用）；⑤ interviewer 反锚定守卫 + distiller 蒸馏日志机械验证 + 实录未覆盖象限抛缺口回访谈不编造；⑥ `.opsforge-state` 加 `built_with_model` 模型升级触发重验；⑦ 跑通门 ≥2 case + 🟢 文案明示 cheapest 烟雾；⑧ 平台诚实（完整流水线仅 claude-code，Tier 2/3 经纯 prompt 访谈 + 🔵 静态）；⑨ evolve 被动触发。
> 不变量底线：零新 npm 依赖；`additionalProperties:false` 全保留；`registry*.yaml` auto-gen 不动；贡献者只写 `.md/.yaml/.json`；skeleton_guard 不破；R16–R22 不弱化、同级新增；release gate 三报告逻辑不动；Windows 兼容。

---

## 1. 背景与根因

当前 `tools/opsforge.mjs promptNew`（行 444-453）只问 `kind/name/brand/slug` 四项即 scaffold 空骨架；模板 body 仅 `## 能力说明`+`## 适用场景` 两个空 H2，`tests/case-01..03.yaml` 全 `__FILL_ME__`。"建好了"= 工程骨架签名匹配，不等于业务可用。

根因：① 模板先行；② 作者从头写系统提示词写不出；③ "建好"由结构完整性定义，缺真实输入跑通门；④ kind 开头选；⑤ 三套模板同构；⑥ CLI readline vs skill body 语义分裂（G8）；⑦ 迭代在创建之外。

标杆 `member-recall`（0→1→1.5→2→3→4）真正启示：① **LLM 先生成草稿、作者审核确认**的 `propose_and_confirm` 认知分工；② **数据不进会话**（给 CSV 文件路径/生成测试数据/schema 不含 PII）；③ 每步产出作者当天就要用的业务工件。

## 2. 核心原则

1. **认知分工倒过来**：凡需工程判断的字段（样本/象限/source/expected 修后行为/系统提示词），**LLM 先生成默认值草稿，作者只勾选确认/修正**，不让作者从零填。
2. **承重判断机械可验 / llm_judge 语义判定**：是否真实/是否对/是否拒绝这三类承重判断，**不靠 LLM 自证或作者自报**——`source: real` 须带可验证硬事实工件引用；负例/降级用 `llm_judge` 判语义；蒸馏日志溯源机械验证。
3. **统一原则**：人定一次"该有的行为"，机械门 replay assert 能力产出该行为；录决策/行为、不录 transcript、不 assert 逐字；LLM 非确定性隔离在单节点单测 loose 比对里。
4. **数据不进会话**：涉数据样本给文件路径/生成测试数据/规避 PII 的 schema，不贴原值。
5. **平台诚实**：完整流水线仅 claude-code 可用；Tier 2/3 经纯 prompt 访谈 + claude-code 侧 distiller 代跑 + 🔵 静态跑通。

## 3. 总览：5 期流水线 + 三态映射

```
访谈期 (capability-interviewer，纯 prompt 脚本 + claude-code agent 双形态)
   ├ 开头给成本预估区间
   ├ Mode A 最近一次真实执行的复述（数据不进会话）/ Mode B 苏格拉底访谈（作者选）
   ├ 反锚定守卫：先让作者自由复述场景，再出草稿；对不上 → 标 synthetic 不标 real
   ├ interviewer 先生成样本草稿 → 作者对照真实经历确认（propose_and_confirm）
   └ 产出: 操作实录（样本 source: real 须带可验证工件引用 / llm_drafted_confirmed / recalled / synthetic）→ set-phase interview_done（对作者透明，同会话交接 distiller）
        ↓
蒸馏期 (capability-distiller，claude-code 侧；Tier 2/3 经 claude-code 代跑或作者手贴)
   ├ 形状推导（附理由 + C12 业务语言例对，作者按场景匹配确认 enum）
   ├ distiller 给 quadrant/source/confidence/allow_exact_reason 默认值（作者只确认）+ 双工件
   ├ 蒸馏日志"来自实录步骤N"机械验证（防幻觉）；实录未覆盖象限 → 抛"行为缺口"回访谈，不编造
   ├ Bash scaffold → Write 覆写 → Bash set-phase distill_done
   └ 失败三选一分流 + 作者侧逃生舱（一键退回 Mode B 纯访谈+手填 body）
        ↓
跑通期 (CLI 接驳)
   ├ 结构门（必要）: validate draft gate + security-scan
   ├ 跑通门（充分）: test-runner dry-run ≥2 case（1 正 + 1 边界/负）；workflow 5 层门 v0.1=(a)(c)(e)
   ├ 记 built_with_model（endpoint id + 版本）；🟢 文案明示"cheapest endpoint 烟雾，未刻画部署模型"
   └ 过 = v0.1 建好；不过 = 回蒸馏期 → set-phase v0.1_built
        ↓
迭代期 (CLI + 人 paced + 被动触发)
   ├ 再跑 2 真例 → 崩了 evolve（被动触发：feedback≤2 或第3次调用自动提示）→ regression-sink 起草 case
   ├ distiller 生成 expected 草稿（负例/降级用 llm_judge 语义判定，positive 用 contains 事实子串）→ 作者确认 → promote --promote-case（良构+run-pass）→ bump
   ├ 收敛：连续 2 干净 OR max_iterations:5
   └ 升级门票: draft(1 真例) → staged(3 真例三象限，正例 source:real 或 recalled+med + 1 次部署模型跑) → formal(N 轮干净 + eval)
```

**平台诚实分层**：
- claude-code：完整流水线可达（访谈→蒸馏→跑通🟢）。
- Tier 2/3：访谈员纯 prompt 脚本任意 LLM 可跑；蒸馏需 claude-code 侧代跑（或作者手贴）；跑通门 🔵 静态（HTTP/spawn runner 不发能力 body）。文档明写"完整流水线仅 claude-code 可用"。

## 4. 两个 Agent（承重构件）

### 4.1 capability-interviewer（访谈员，纯 prompt 脚本 + claude-code agent 双形态）

- **双形态**：① `packs/opsforge-meta/agents/capability-interviewer/source.md`（@-invoke）；② 同内容作纯 prompt 脚本 `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`，作者在任意 LLM 跑一遍产出 interview.md 贴回 `_drafts/`。不依赖被注入平台 agent 文件 → dify/cline 可达访谈期。
- **开头给成本预估**："这个能力预计访谈 ~1h、蒸馏 ~15min、跑通 ~$2、迭代 ~$5"。
- **Mode A 最近一次真实执行的复述**（非"会话内真做一次"）：作者回忆上次执行，agent 分段复述重构步骤+决策+边界，不要求贴敏感数据。**数据不进会话**：涉数据样本给文件路径/生成测试数据/规避 PII schema。Mode A 适用于"会话内可完成、数据不敏感"；Mode B 适用于"周/月频、数据敏感、长流程"，给 2 选 1 决策树。
- **反锚定守卫（F3）**：先让作者自由复述场景，再出草稿；草稿只能填作者说不出的空隙；**作者复述对不上草稿 → 标 `synthetic` 不标 `real`**；草稿生成前禁展示样本框架。
- **interviewer 先生成样本草稿，作者确认（propose_and_confirm）**：作者说"上周有个文案被风控拦了"，interviewer 草拟一条样本，作者只判"对，差不多"或"不对，产出是…"。
- **source 标注**：`real` 须带**可验证硬事实工件引用**（文件路径/记录 ID/hash），R29 检查引用可解析；interviewer 追问"这个输入你能从哪个系统再拿出来？A=能（须给路径/ID）B=不能只能复述"——A→`real`（带引用），B→`recalled`；LLM 草拟作者确认的样本标 `llm_drafted_confirmed`（与 `real` 隔离，不进 staged 正例）。
- **产出**：`_drafts/<slug>/interview.md`（LLM 填框架+草稿、作者审核确认）。
- **phase 推进**：claude-code 形态调 `opsforge set-phase interview_done`；纯 prompt 形态作者手贴后跑。同会话交接 distiller，set-phase 对作者透明。

### 4.2 capability-distiller（蒸馏器，claude-code 侧）

- **步骤序列（wizard body 编码）**：① 读 interview.md → 形状推导（附理由 + C12 业务语言例对，作者按场景匹配确认，非确认 enum）；② Bash `node tools/new-capability.mjs --kind <kind> --slug <slug>`；③ Write 覆写业务字段 + 双工件；④ distiller 给 quadrant/source/confidence/allow_exact_reason 默认值（作者只确认）；⑤ Bash `opsforge set-phase distill_done`。
- **双工件**：`## 运行指令`（系统提示词草稿，从实录真实跑通过的步骤蒸馏）+ `## 蒸馏日志`（每条指令标注"来自实录步骤N"，**机械验证**——validate 检查步骤 N 存在且内容与指令语义相关，幻觉引用 → fail，F4）。
- **行为缺口不编造（F5）**：实录未覆盖的象限（boundary/negative/degradation），distiller 不得从单条 positive trace 凭空补处理；必须**抛"行为缺口——需补样本"**回访谈期补，非编造。
- **跑通失败三选一强制分流 + 作者侧逃生舱**：输出格式错→改提示词；数据值不匹配→改 case/实录；步骤顺序错→改实录；+ 作者侧逃生"一键退回 Mode B 纯访谈+手填 body"。
- **约束**：只写 body/H2/业务字段 + workflow.yaml；不加 frontmatter 新字段；schema 不动；skeleton_guard 不破（interview.md 已排除）。
- **Tier 2/3 代跑**：非 claude-code 作者把 interview.md 交 claude-code 侧 distiller 代跑（或作者手贴输出 + 手动 set-phase）。

### 4.3 拆两 agent 理由

访谈（提问+复述+生成草稿）与蒸馏（转换+覆写+分类）认知模式不同；两 agent 各有独立 test suite 可回归；访谈员纯 prompt 脚本可移植任意 LLM，蒸馏器因需 Bash/Write 留 claude-code 侧。

## 5. 各期详细

### 5.1 访谈期

**实录模板** `templates/interview-record.md`（LLM 填框架+草稿、作者审核确认）：
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

落地：纯 prompt 脚本任意 LLM 可跑 / claude-code @-invoke；实录落 `_drafts/<slug>/interview.md`（已入 `SKELETON_GUARD_EXCLUSIONS`）；`opsforge set-phase interview_done`。

卡点：① 问题树+草稿生成+反锚定质量是承重墙；② 作者须能复述一次真实执行（拿不出则退 `llm_drafted_confirmed`/`synthetic` 只盖结构章）。

### 5.2 蒸馏期

落地：distiller 按 §4.2 步骤序列；草稿落 `_drafts/<slug>/`；distiller 给字段默认值作者确认；蒸馏日志机械验证；行为缺口回访谈；`set-phase distill_done`；doc-coauthoring 循环改到定稿；失败有作者侧逃生舱。

卡点：① 系统提示词即便从实录蒸馏仍可能不够好——跑通期兜底；② 覆写守 `additionalProperties:false` + 不动工程字段；③ workflow step 必须引用已毕业 capId（R30）。

### 5.3 跑通期

**目标**：v0.1 建好 = 结构门（必要）+ 跑通门（充分）。

**结构门（必要）**：`validate.mjs` draft gate（R7 + 命名 + 路径穿越 + skeleton 签名）+ `security-scan.mjs` 全绿。

**跑通门（充分）**——按 kind 分流：

#### skill / agent（仅 Tier 1 🟢）
`test-runner.mjs executeClaudeDryRun`（**剥 frontmatter 后传 --system-prompt**）跑 **≥2 case（1 positive + 1 boundary/negative，F7）**；用最便宜 endpoint；positive 用 `contains`（关键事实子串），negative/degradation 用 `llm_judge`（语义判定，F2）。**默认 `expect: contains`（positive）/ `llm_judge`（negative/degradation），禁 `exact`（R28）**。Tier 2/3 → 🔵 静态。

#### mcp
静态 schema 校验为主；`expect: schema` + `schema_ref`。

#### workflow（5 层门，v0.1 仅 (a)(c)(e)）
| 层 | 测什么 | v0.1 | v0.2+ |
|----|--------|------|-------|
| (a) 结构 | steps≥2、checkpoint 有目标、vars 声明 | ✅ 已有 | ✅ |
| (b) 控制流 | switch/if 条件取对分支 | ❌ 砍（condition 求值器不存在） | 受限求值器 |
| (c) 节点正确 | step.capability 引用已 staged+ 能力（R30） | ✅ 继承 | ✅ |
| (d) 交接契约 | vars schema 对 schema | ❌ 砍（vars 无 schema 字段） | 加 vars schema |
| (e) HITL 决策 | checkpoint 人拍板 | 人工走查签字 | runner decision 录制/注入 |

v0.1 = (a) + (c) + (e) 人工签字；v0.2 = (b)(d) + decision 注入。**decision replay 诚实（F9）**：只对确定性下游节点（MCP 工具）稳定；LLM 下游（agent/skill）assert 须用 `llm_judge` 非固定串，不得暗示 LLM 节点 replay 是 golden。

**统一原则落地**：端到端冒烟只 assert 最终交付物关键字段（loose contains / llm_judge）；checkpoint 录离散决策值（v0.2）；LLM 非确定性被 (c) 单节点单测隔离。

**质量灯两档 + 说明**：
- 🟢 真跑通：Tier 1 真实模型 dry-run 命中 expected；**文案明示"cheapest endpoint 烟雾通过，未刻画部署模型行为"**（F7）。
- 🔵 静态等效：Tier 2/3，标"本平台暂不支持真跑通，你的能力本身没问题"+ 升级出口路径（per-adapter dry-run 契约，P2-6）；不计入 effectiveness 主分母；升级门票 = 🔵 + 人工签字等价 🟢。
`tools/report-renderer.mjs` 两档渲染 + 说明文案。

**成本控制**：跑通门跑 ≥2 case + 最便宜 endpoint；边界/负例静态过 R-rule；作者可选"全跑"。

### 5.4 迭代期

**目标**：v0.1 建好 ≠ 完工；人 paced 闭环 + 被动触发。

**循环**：
1. 作者再拿 2 个真实案例跑能力。
2. 崩了 → **evolve 被动触发**（feedback≤2 分 或 同能力第3次调用时，opsforge discover/doctor 自动提示"考虑跑 `opsforge evolve`"，C4）→ `regression-sink generateCase` 起草 case（input + 空 expected + `quadrant: __FILL_ME__`）。
3. **distiller 生成 expected 草稿**（修后行为：负例/降级用 `llm_judge` 语义判定"是否正确拒绝/降级"，positive 用 `contains` 事实子串，F2）+ quadrant 草稿（附 C12 业务语言例对），作者审核确认。
4. **promote 门两道**（`new-capability.mjs promote() --promote-case <file>`）：
   - **良构检查**：expected 非空；expect 模式匹配 quadrant（负例/降级须 `llm_judge`/`regex`，禁 `exact`/`contains`-only，R28）；软提示 expected==当前产出（可能在描述 bug）。
   - **run-pass 检查**：能力产出 = expected = pass（llm_judge 判语义或 contains 命中）。
5. 修能力 + promote 跑通的回归 case + bump + 重跑。
6. **收敛**：连续 2 干净（1 正例 contains pass + 1 降级 llm_judge pass）OR `max_iterations:5` → `set-phase iteration_capped`。token 计数（test-runner 解析 stream-json usage 回传）入 `state.history`，report-renderer 渲染累计成本。

**升级门票（三态）**：
- draft = 结构绿 + 1 真例跑通（Tier 2/3 = 🔵 + 人工签字）
- staged = 3 真例三象限皆真实（正例 source:real 或 recalled+med）+ **1 次部署代表性模型跑**（F7，非仅 cheapest）+ R16–R31 全绿 + security 绿；recalled+med 样本看板标"未硬验证"
- formal = N 轮干净 + eval harness ≥阈值 + 平台矩阵

**effectiveness Tier 拆线**：`cmdFeedback` 强制带 capId；`effectivenessScan` 按 capId 查 manifest→platforms→adapter.tier() 排除 Tier2/3 出主分母；Tier2/3 单独一条线（人工签字数、feedback 评分）。

## 6. kind 形状推导 + workflow step 规范

| 实录特征 | 推导 kind | 关键工件 |
|---------|----------|---------|
| ≥2 有序步骤 + 工件交接，无分叉/无人工闸门 | skill | `## 运行流程` + `## 运行指令` |
| ≥2 有序步骤 + 分叉/人工闸门/循环 | workflow | `workflow.yaml` steps(capId 引用) + checkpoint + vars |
| 持续角色 + 工具使用，无固定序列 | agent | `## 角色设定` + `## 工具集` + `## 边界` |
| 暴露操作/接数据 | mcp | `## 工具面` + `## 数据契约` + `## 异常处理` |

推导附理由，作者可否决改轻。**workflow step 规范**：`step.capability` 必须引用已 staged+ 能力（R30）；内联新 prompt 的 workflow 视为反模式。

**业务语言对照表**（C12，落 `docs/methodology/capability-creation.md`）：作者说"出问题的情况" → 四象限映射（正常=positive；合法但极端=boundary；应拒绝=negative；上游挂应降级=degradation）。distiller 给象限默认值时附此例对，作者按场景匹配确认，非确认 enum。

## 7. schema / state 变更

### 7.1 `schema/test-case.schema.json`（扩展，保留 additionalProperties:false）
新增五字段（可选，staged+ 由 R-rule 约束）：
- `quadrant`: enum `[positive, boundary, negative, degradation]`。
- `source`: enum `[real, recalled, synthetic, llm_drafted_confirmed]`（F1，新增第四值隔离 LLM 草拟样本）。
- `confidence`: enum `[high, med, low]`。
- `allow_exact_reason`: `["string","null"]` — distiller 自动填，作者文档不出现此字段名。
- `ref`: `["string","null"]` — 可验证硬事实工件引用（real 必填，F1）。

### 7.2 `.opsforge-state.json` + `opsforge set-phase`
新增 `phase` 字段（interview_done/distill_done/v0.1_built/iteration_converged/iteration_capped），与 `state` 正交，已排除在 skeleton_guard 外。新增 `built_with_model`（endpoint id + 版本）+ `built_at`（F6），模型升级触发重验信号。新增 CLI `opsforge set-phase <capDir> <phase>` 转发 `writeOpsforgeState` + push history（in-platform agent 经 Bash 调，不直接编辑 JSON）。

## 8. R-rule 新增（staged+，同级 R23，不改 R16–R22）

| R | 名 | 规则 | 触发点 |
|---|---|---|---|
| R24 | `process_stages_present` | skill: `## 运行流程` ≥2 编号阶段含输入/输出标记；agent: `## 角色设定` 非空；mcp: `## 工具面` 非空且 tools 非空；workflow: steps≥2 | validate staged |
| R24b | `degradation_present` | skill: `## 失败降级` ≥1 条；agent: `## 边界` 非空；mcp: `## 异常处理` 非空；workflow: 每失败路径有降级动作 | validate staged |
| R25 | `depends_declared` | body `## 依赖` 提到的 capId 必须在 `depends_on:` frontmatter，反之亦然 | validate staged |
| R26 | `test_four_quadrants` | tests/ ≥1 positive + ≥1 negative/degradation + ≥1 boundary；staged 正例 `source` ∈ {real, recalled+med}，禁 `synthetic`/`llm_drafted_confirmed` 正例；**软检查**：case body 场景描述与 quadrant 业务语言例语义对齐（不对齐 → 软警告，F8） | validate staged |
| R27 | `run_instruction_present` | body 必含 `## 运行指令` ≥80 token | validate staged |
| R28 | `expect_mode_kind_safe` | skill/agent positive case `expect=exact` 且 `allow_exact_reason` 为空 → fail；**negative/degradation case `expect` 必须 `llm_judge` 或 `regex`**（F2，禁 `contains`-only/`exact`） | validate staged |
| R29 | `interview_real_sample_present` | `interview.md` 的 `## 真实样本` 正例 input 非空非 `__FILL_ME__`；`source: real` 须带可解析 `ref`（F1）；phase 合法性 | promote() |
| R30 | `workflow_step_refs_graduated` | workflow 每个 `step.capability` 必须引用已 staged+ 能力（扩 `scanCapabilities` 返回 state，`checkWorkflowRef` 读被引 cap state） | validate staged |
| R31 | `distill_log_verifiable`（F4） | `## 蒸馏日志` 每条"来自实录步骤N"必须机械验证：步骤 N 在 interview.md 存在且内容与指令语义相关（contains/嵌入相似度）；幻觉引用 → fail | validate staged |

## 9. 不变量守护

| 不变量 | 守护方式 |
|--------|---------|
| §C.1 零新 npm 依赖 | 访谈/蒸馏 in-platform 对话不引 import；纯 prompt 脚本无依赖；CLI 复用现有工具 |
| additionalProperties:false | test-case schema 加五字段是显式扩展，保留 false；工件落 body H2 / tests yaml / workflow.yaml |
| skeleton_guard 不破 | `interview.md` 加入 `SKELETON_GUARD_EXCLUSIONS`；模板改 body 不改文件集；.opsforge-state.json 已排除 |
| 贡献者只写 .md/.yaml/.json | 全部工件 markdown/yaml；工程字段 distiller 自动填；访谈/蒸馏由 steering-owned agent 干 |
| R16–R22 不弱化 | R24–R31 同级 append，staged+ 生效，draft 零门槛不变 |
| release gate 三报告不动 | R-rule 全在 validate.mjs |
| CLI/skill body 语义一致 | 访谈/蒸馏在 in-platform agent 路径 + 纯 prompt 脚本；CLI 只接驳，G8 根除 |
| Windows 兼容 | in-platform 对话无 readline 依赖；CLI 复用 makeAsker |
| 平台诚实 | 文档明写完整流水线仅 claude-code 可用；Tier 2/3 经纯 prompt 访谈 + claude-code 侧 distiller 代跑 + 🔵 静态跑通 |
| 存量 dogfood | P1 上线前补 H2 + quadrant/source/ref + case-01 `expect: exact`→`contains`/`llm_judge` |

## 10. 落地清单（文件级，P0/P1/P2）

### P0（让新建从"问名字"变"LLM 引导式沉淀" + 事实修正 + 认知分工倒过来）

| # | 文件 | 改什么 |
|---|------|--------|
| P0-1 | `packs/opsforge-meta/agents/capability-interviewer/source.md` + `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`（纯 prompt 脚本） | 双形态：Mode A 最近一次复述 + 数据不进会话 + 反锚定守卫（先复述后草稿，对不上标 synthetic）+ interviewer 先生成样本草稿作者确认 + source 追问（real 须带 ref）+ 成本预估 |
| P0-2 | `packs/opsforge-meta/agents/capability-distiller/source.md` | 步骤序列 + 形状推导附理由+C12 例对 + 双工件 + distiller 给字段默认值 + 蒸馏日志机械验证 + 行为缺口回访谈不编造 + 失败三选一+作者侧逃生舱 |
| P0-3 | `templates/interview-record.md` | 实录结构 + 数据不进会话 + 样本草稿由 LLM 先填 + source/ref 字段 |
| P0-4 | `templates/skill/SKILL.md`、`templates/agent/source.md`、`templates/mcp/source.md` | 三套模板加各 kind 专属 H2 占位 |
| P0-5 | `templates/<kind>/tests/case-01..03.yaml` | positive/boundary/negative 三象限模板；positive 默认 `expect: contains`，negative 默认 `expect: llm_judge`；加 `allow_exact_reason: null` + `source`/`ref` 字段 |
| P0-6 | `tools/new-capability.mjs` `SKELETON_GUARD_EXCLUSIONS` | 追加 `'interview.md'` |
| P0-7 | `tools/opsforge.mjs` `cmdNewFlow`/`cmdWizard` | 不再引导问答；提示 `@capability-interviewer` 或用纯 prompt 脚本；CLI 只接驳 |
| P0-8 | `tools/opsforge.mjs` | 新增 `opsforge set-phase <capDir> <phase>` 子命令；`writeOpsforgeState` 加 `built_with_model`/`built_at` 写入 |
| P0-9 | `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md` | `## 运行指令` 对齐四期路由 + 编码 distiller 步骤序列 + 同会话交接 |

### P1（行为门 + R-rule + 被低估实现 + 业务化减负 + LLM 工程 soundness）

| # | 文件 | 改什么 |
|---|------|--------|
| P1-1 | `schema/test-case.schema.json` | 加 `quadrant`/`source`(+`llm_drafted_confirmed`)/`confidence`/`allow_exact_reason`/`ref` 五字段 |
| P1-2 | `tools/validate.mjs` | 新增 R24/R24b/R25/R26/R27/R28/R30/R31；R28 负例/降级强制 llm_judge/regex；R26 软检查场景-象限对齐 + 放宽（recalled+med）；R29 检查 real 须 ref 可解析；R30 扩 scanCapabilities 返回 state；R31 蒸馏日志机械验证 |
| P1-3 | `tools/new-capability.mjs promote()` | `--promote-case <file>` 单 case 粒度；R29 挂此；软提示 expected==当前产出；promote 前 run-pass |
| P1-4 | `tools/test-runner.mjs` | 剥 frontmatter + 解析 stream-json usage 回传 token；跑通门用最便宜 endpoint；llm_judge 跑 negative/degradation case |
| P1-5 | `tools/opsforge.mjs` 跑通门 + discover/doctor | 结构门后 dry-run ≥2 case 渲染两档灯；🟢 文案明示 cheapest 烟雾；evolve 被动触发（feedback≤2 或第3次调用） |
| P1-6 | `tools/report-renderer.mjs` | 两档灯 + 🔵 说明文案 + 升级出口；token 累计；recalled+med 标"未硬验证"；模型版本不匹配降级标记 |
| P1-7 | `install.mjs` `effectivenessScan` + `cmdFeedback` | feedback jsonl 带 capId；scan 按 capId 查 manifest→tier 排除 Tier2/3 出主分母；Tier2/3 单独一条线；模型版本比对触发重验 |
| P1-8 | `tools/regression-sink.mjs` `generateCase` | 产出 yaml 加 `quadrant: __FILL_ME__` |
| P1-9 | 存量 dogfood | activity-summary/copywriter/bi-connector 补 H2 + quadrant/source/ref + case-01 `expect: exact`→`contains`/`llm_judge` |
| P1-10 | `tools/workflow-runner.mjs`（v0.2） | checkpoint decision + resume 注入；受限 condition 求值器；vars schema 字段；decision replay 诚实标注（LLM 下游须 llm_judge） |

### P2（自动化 + guardrail + 文档）

| # | 文件 | 改什么 |
|---|------|--------|
| P2-1 | `packs/opsforge-meta/agents/capability-{interviewer,distiller}/tests/` | 两 agent 回归测试（含反锚定、行为缺口、蒸馏日志机械验证、步骤序列） |
| P2-2 | `templates/<kind>/` skeleton-signature 验证 | 确认新模板不破签名 + interview.md 在 exclusions |
| P2-3 | `.github/workflows/guardrails.yml` + CODEOWNERS | 新 agent/新模板/schema 路径纳入 |
| P2-4 | `docs/methodology/capability-creation.md` | 贡献者文档：5 期 + 形状推导 + 业务语言对照表（C12）+ 平台诚实分层 + 成本预估 + source/ref 规则 |
| P2-5 | per-adapter dry-run 契约（未来） | HTTP 加 system_prompt / CLI 加 --system-prompt，Tier 2 升 🟡 再 🟢 |

## 11. 风险与未决

1. 问题树/草稿生成/反锚定/蒸馏 prompt 质量：steering-authored，承重墙，需反复打磨。
2. Tier 2/3 真实跑通不可达：🔵 静态诚实 + 升级出口；纯 prompt 访谈脚本让 Tier 2/3 至少进访谈期。
3. 真实样本依赖：拿不出精确样本 → `real` 须可验证 ref（文件路径/ID/hash），否则退 `recalled`/`llm_drafted_confirmed`（不进 staged 正例）；synthetic 只盖结构章。
4. workflow (b)(d) v0.2 求值器 + vars schema 是新建；decision replay 只对确定性下游稳。
5. regression promote "expected==当前产出"软提示无法机械区分 bug vs 修后行为，靠人审 + distiller 生成草稿 + llm_judge 降低作者负担。
6. 存量 dogfood 升级：P1 上线前同步补。
7. in-platform 依赖：完整流水线仅 claude-code；Tier 2/3 经纯 prompt 脚本 + claude-code 侧 distiller 代跑。
8. distiller 步骤序列跨 Bash/Write 多步，agent 一次跑通概率低——wizard body 编码步骤 + 回归测试 + 作者侧逃生舱兜底。
9. evolve 被动触发靠 feedback jsonl 完整性；feedback 不填则不触发。
10. `built_with_model` 模型升级重验靠 effectivenessScan 比对 endpoint 版本；无版本元数据的旧 endpoint 不触发。
11. R26 场景-象限对齐软检查靠业务语言对照表质量；对照表不准则软警告失真。
12. llm_judge 本身是非确定性判定（judge 模型）；judge 阈值（judge_threshold 0.7）需校准，过低假绿、过高永不收敛。

## 12. 成功判据

- [ ] 访谈→蒸馏→跑通走完后，body 含全 H2，tests 含四象限且样本来自 LLM 草稿+作者确认；正例 source:real（带可解析 ref）或 recalled+med，禁 synthetic/llm_drafted_confirmed 正例。
- [ ] 四 kind 走出的结构各异。
- [ ] 跑通期结构门 + ≥2 case dry-run（最便宜 endpoint，positive contains + negative/degradation llm_judge）都过才标 v0.1；🟢 文案明示 cheapest 烟雾；staged 加 1 次部署模型跑；Tier 2/3 🔵 + 说明。
- [ ] workflow v0.1 门：(a)结构 + (c)引用毕业（R30）+ (e)人工签字；v0.2 (b)(d) + decision 注入（LLM 下游用 llm_judge）。
- [ ] regression promote 两道门（良构+run-pass，单 case 粒度）；负例/降级 expected 用 llm_judge；跑不通不能 promote。
- [ ] `interview.md` 在 SKELETON_GUARD_EXCLUSIONS；promote 不挂。
- [ ] R28 用 `allow_exact_reason` 字段；负例/降级强制 llm_judge/regex。
- [ ] R29 检查 `source: real` 须带可解析 `ref`。
- [ ] R31 蒸馏日志溯源机械验证（防幻觉）。
- [ ] `opsforge set-phase` 子命令可用；set-phase 对作者透明；state 记 `built_with_model`。
- [ ] evolve 被动触发生效（feedback≤2/第3次调用提示）。
- [ ] 访谈员纯 prompt 脚本可在任意 LLM 跑（Tier 2/3 可达访谈期）。
- [ ] interviewer 反锚定守卫生效（对不上草稿标 synthetic 不标 real）。
- [ ] distiller 行为缺口回访谈不编造。
- [ ] R24–R31 staged+ 生效；424 测试基线不回退（预计 424 → ~470）。
- [ ] schema 加五字段保留 additionalProperties:false；package.json 零改动。

## 附录 A：三轮评审修正溯源

- **第1轮（可行性）**：interview.md 加入 SKELETON_GUARD_EXCLUSIONS；R28 注释→`allow_exact_reason` 字段；`opsforge set-phase` CLI；跑通门 Tier 诚实（Tier2/3 🔵）；workflow (b)(d) 砍到 v0.2；R29 移到 promote；R30 scanCapabilities 返回 state；promote `--promote-case` 单 case；test-runner 剥 frontmatter + 回传 token；effectiveness 摘 Tier；generateCase 加 quadrant；dogfood expect exact→contains。
- **第2轮（业务使用习惯）**：认知分工倒过来（LLM 先草拟作者确认，propose_and_confirm）；数据不进会话；Mode A 改"最近一次复述"；distiller 给字段默认值作者只确认；作者侧逃生舱；evolve 被动触发；成本预估；纯 prompt 脚本可移植；🔵 说明 + 升级出口；effectiveness Tier 拆线；dry-run 最便宜 endpoint；业务语言对照表；`real` 门槛降为"可复述场景+可验证硬事实"。
- **第3轮（应用 AI 最佳实践）**：`source: real` 升级为可验证工件引用 + `llm_drafted_confirmed` 隔离 LLM 草拟样本；负例/降级强制 `llm_judge`/`regex`；interviewer 反锚定守卫；蒸馏日志机械验证（R31）；行为缺口回访谈不编造；`built_with_model` 模型升级重验；跑通门 ≥2 case + 🟢 cheapest 烟雾文案 + staged 部署模型跑；象限分类附 C12 例对 + R26 软检查；workflow decision replay 诚实（LLM 下游 llm_judge）。

---

## 附录 B：作者交互脚本（业务语言、强引导、建议式选项）

> 原则：用户是业务人员，全程**无技术术语**（token/endpoint/schema/quadrant/expect/llm_judge/source/phase/Tier/dry-run/promote 等对作者全隐藏）；**强引导**每步给明确下一步；**建议式选项**2-4 个让作者勾选，开放问答只在让作者描述场景时短暂出现且紧跟选项收敛。本附录把工程机制翻译成作者可懂的话，不改机制本身。落地点：`capability-interviewer/source.md`、`capability-distiller/source.md`、`opsforge-wizard/SKILL.md`、`report-renderer.mjs`、`opsforge.mjs cmdDiscover/doctor`。

### 访谈期（capability-interviewer）

**触点 1 · 开场：成本预估 + Mode 选择**
- 时机：作者刚调出 `@capability-interviewer`。
- agent："我们一起来把你这件事沉淀成一个能力，以后你和同事都能直接用它。先给你个预期——第一步'聊聊你平时怎么做'约 1 小时；第二步'我整理成能力草稿'约 15 分钟（我来干，你审核）；第三步'我拿一个真例子试跑'约几块钱、几分钟；以后每次发现新情况回来补一条，几分钟。第一步有两种聊法：**聊法一·回忆上次**（你把上一次从头到尾讲一遍，我帮你整理，适合'最近做过、还能回忆'）；**聊法二·一问一答**（我一档一档问你，适合'不常做、记不清、或数据不方便贴出来'）。"
- 选项：① 上次刚做过、能回忆 → 聊法一 ② 这事不常做/数据不方便贴 → 聊法二
- 工程机制：成本预估 §4.1；Mode A/B 决策树 §4.1。

**触点 2 · 聊法一·最近一次复述（分段）**
- 时机：作者选聊法一。
- agent："我们就聊上次那次，一段一段来。**上次做这件事，你第一个做的是什么？**（不用精确，大概'我先打开了什么/先问了谁'就行。）涉及真实数据的地方别把数据本身贴给我——"
- 选项（数据怎么给）：① 我给你文件路径/系统里大概在哪，你去取 ② 我跟你描述这数据长什么样，你别碰真数据
- 每段复述后确认：agent 复述成一句话 → 选项 ① 对，就是这样 ② 不太对，我改一下。"对"则记进步骤 N、继续问下一步；"不对"则让作者重述、agent 再复述确认。
- 工程机制：Mode A 分段复述 §4.1；数据不进会话 §2 原则 4；propose_and_confirm 步骤粒度。

**触点 3 · 聊法二·一问一答（问题树）**
- 时机：作者选聊法二。
- agent："我一档一档问你。第一档：**这事从头到尾，你大概分几个动作做完？**（不用想'分几阶段'，就想象跟新同事说'你先干嘛、再干嘛、最后干嘛'。）"
- 选项：① 就两三步、一下子做完 ② 步骤挺多、中间还要等人/等别的系统 ③ 不是固定几步、看情况走 ④ 都不像、我直接说
- 选①② → 按动作数展开触点 2 分段引导；选③ → 转向"持续角色 vs 分叉流程"追问（形状推导前置）；选④ → 自由描述后用①-③收敛。
- 工程机制：Mode B 苏格拉底 §4.1；选项③是形状推导信号 §6。

**触点 4 · 样本草稿 propose_and_confirm**
- 时机：作者复述完一个完整场景后。
- agent："你刚才说的那次，我帮你猜一条样本，你看像不像——**输入大概是**'…'；**产出大概是**'…'。"
- 选项：① 对，差不多 ② 产出不对，我改 ③ 输入不对，我改
- 选① → 样本定稿标 `llm_drafted_confirmed`（不进 staged 正例），进触点 5；选②③ → 作者口述实际、agent 重拟再确认。
- 工程机制：propose_and_confirm §2 原则 1 + §4.1；`llm_drafted_confirmed` 与 real 隔离 R26。

**触点 5 · 来源追问 + 反锚定守卫**
- 时机：样本确认后。
- agent："最后一件事：**这个情况，你现在还能从哪个系统里把它再找出来吗？**"
- 选项：① 能，我能找到（追问"大概在哪个文件/记录号"）② 不能，只是大概记得
- 选① → 记为 ref，标真实样本；选② → 标"凭回忆"。
- **反锚定触发时**（草稿与复述对不上）："等一下——我刚才猜的那条，跟你前面说的那次对不上。**那我先按你回忆的记，不按我猜的来。** 你前面说的是'…'，我就用这个，行吗？"选项 ① 行，就按我说的记 ② 不对，我再补充。选① → 标 `synthetic`（不标真实）。
- 工程机制：source 追问 real 须 ref（R29）§4.1；反锚定守卫 F3 §4.1。

### 蒸馏期（capability-distiller）

**触点 6 · 形状推导确认 + 四类情况分类**
- 时机：distiller 读完实录。
- agent："你说的这件事，我听下来像是——**一个分好几步、一步一步走的流程**（因为你提到'先拉数据、再发审、最后发出去'这种一环扣一环的）。你看哪种最贴——"
- 选项（形状）：① 分多步的流程（一环扣一环）→ skill ② 随时盯着的角色（没固定顺序）→ agent ③ 数据接入（接数据进来给系统用）→ mcp ④ 分多步+中间有分叉/要等人拍板 → workflow
- 紧接四类情况分类："再帮我把'可能出现的情况'分个类——**正常情况**（一切顺利按流程走完）；**边界但合法的情况**（数据有点特殊但还是要正常处理）；**该拒绝的情况**（不该做的直接挡回去）；**上游挂了该兜底的情况**（数据源拿不到要降级不崩）。你这事这四类里碰到过哪几类？"
- 选项（多选）：① 正常 ② 边界但合法 ③ 该拒绝 ④ 上游挂该兜底。选完 → distiller 去实录找对应样本，没找到的触发触点 8。
- 工程机制：形状推导 §6；四象限业务语言例对 C12 + R26 软检查。

**触点 7 · 字段默认值确认**
- 时机：distiller 给四类情况打了默认分类/来源/把握后。
- agent："我帮你把刚才那几类情况都标好了——'正常情况'那一条：来源真实可查、把握高；'边界但合法'：凭回忆、把握中；'该拒绝'：凭回忆、把握中；'上游挂该兜底'：我猜的、你确认过、把握中。你看——"
- 选项：① 都对，就这样 ② 有一条不对，我改。选② → 追问"分类不对/来源档不对/把握档不对"三选收敛，改后重确认。
- 工程机制：distiller 给 quadrant/source/confidence/allow_exact_reason 默认值作者只确认 §4.2 步骤④；`allow_exact_reason` 对作者隐藏 §7.1。

**触点 8 · 行为缺口回访谈**
- 时机：实录没覆盖某类情况。
- agent："我发现还差一种情况没问到——**上游数据拿不到的时候，你怎么办？** 我们回去补一下。上次要是数据源挂了/拿不到，你会怎么做？"
- 选项：① 直接告诉对方拿不到、先等 ② 换备用数据源 ③ 先发一半、缺的后面补 ④ 没碰到过、我先想。选①-③ → 记进该类、补样本走触点 4；选④ → "那我们先跳过这一类，等你哪天碰到了再回来补，行吗？"选项 ① 行先跳过 ② 我现在想一下。跳过则该类留空、staged 升级门票缺时再触发回访谈。
- 工程机制：行为缺口回访谈不编造 F5 §4.2。

**触点 9 · 作者侧逃生舱**
- 时机：蒸馏步骤挂了或作者觉得卡住。
- agent："看起来卡住了。我们换个简单点的路子——**只按你回忆的填，不让我猜了**，行吗？我不再自动推导和补草稿，你给我什么我填什么，缺的留空你自己补。"
- 选项：① 好，换简单路子（只按我回忆的填，你别猜了）② 再试一次刚才那个 ③ 我自己来填剩下的。选① → 一键退回 Mode B 纯访谈+手填 body；选② → 重跑挂掉的步骤，再挂强制回①/③；选③ → distiller 让出控制权、只做格式校验。
- 工程机制：作者侧逃生舱 §4.2"失败三选一+一键退回 Mode B 纯访谈+手填 body"。

### 跑通期（report-renderer 渲染）

**触点 10 · 质量灯解释**
- 🟢："🟢 我拿一个真例子把这个能力跑了一遍，结果对得上，能用了。说清楚一点：我跑的时候用的是最便宜的那种跑法，**只证明'逻辑通'，不保证你以后正式用的时候模型一定也这样**——等你用真实环境跑顺了，才算真的稳。"
- 🔵："🔵 你用的这个平台，没法让我真拿一个例子跑一遍。**我只能静态看一遍——没问题，但没真跑过。** 这不是你的能力有问题，是平台限制。等你在能真跑的环境里跑顺一次，就转绿。"
- 🔴："🔴 有一处对不上——我跑'该拒绝的情况'时，它没按你说的拒绝。我们回去调一下。"选项 ① 是我对你那个情况的处理理解错了（我改理解）② 是能力的指令写错了（你去改指令）③ 是我给的那个例子本身不对（我换例子）。
- 🟢/🔵 后："那这个能力就算 v0.1 建好了，能用了。以后碰到新情况，回来补就行。"→ 进迭代期。
- 工程机制：🟢 cheapest 烟雾文案 F7 §5.3；🔵 Tier2/3 静态 §5.3；🔴 回蒸馏期 §3。

### 迭代期（evolve + promote）

**触点 11 · evolve 被动触发提示**
- 时机：第 3 次调用或 feedback≤2 时 discover/doctor 自动提示。
- agent："这个能力你最近用过几次了。要不要回头补一个'上次崩了的情况'，让它更稳？我看你上次给这条打过不太好的分——正好补一条'那种崩了的情况'进来。"
- 选项：① 好，补一个 ② 先不用。选① → 起草空壳情况（input 填上、产出留空、类别留空）进触点 12；选② → 下次第 5 次或再低分再提示。
- 工程机制：evolve 被动触发 C4 §5.4；generateCase 起草 P1-8。

**触点 12 · 修后行为草稿确认**
- 时机：distiller 拿空壳情况后生成修后行为草稿。
- agent："上次崩了，是因为'…'。我让它现在碰到这种情况就——**'…'（业务语言修后行为）**。你觉得这样处理对吗？"
- 选项：① 对，就该这么处理 ② 不对，应该……（你说）。选① → 修后行为定稿，该拒绝/兜底用语义判定、正常用关键字命中，进触点 13；选② → 作者口述、重拟再确认。
- 工程机制：distiller 生成 expected 草稿 §5.4 步骤③；负例/降级 llm_judge、positive contains F2 R28。

**触点 13 · promote 确认 + 收敛判断**
- 时机：修后行为定稿 + 该条又跑通了。
- agent："我拿你补的这条情况又跑了一遍，**这次对了**。可以正式收进能力里了。收进去之后，以后碰到这种情况它就按你说的处理。"
- 选项：① 收进去 ② 再调调。选① → `--promote-case` 正式并入、版本号 +1、重跑确认；选② → 回触点 12 改或触点 10 重跑。
- 收敛判断（agent 主动告知）："提醒一下：如果**连续两次都没崩**，这个能力就算稳了，你可以先放着，等下次碰到新情况再说。要是改了 5 次还没稳，我们也先停一停，回头再补——别卡在这。"选项 ① 好，先这样 ② 我想再补一条。选① → 标记已收敛/达上限进稳定期；选② → 回触点 11 重新起草。
- 工程机制：promote 两道门单 case 粒度 §5.4 + P1-3 + R29；收敛"连续 2 干净 OR max_iterations:5"§5.4 步骤⑥；版本 bump §5.4 步骤⑤。

### 通用交互守则（贯穿所有触点）

1. **永远先给草稿再让作者确认**，不让作者从零填（propose_and_confirm）。
2. **选项永远是 2-4 个具体建议**，开放问答只在让作者描述场景时短暂出现，且紧跟选项收敛。
3. **数据不进会话**：涉真实数据一律"文件路径/描述数据形状"二选一，不贴原值。
4. **草稿对不上复述 → 降级标 synthetic，不硬标真实**（反锚定守卫）。
5. **缺口回访谈，不编造**：实录没覆盖的情况回访谈补，不替作者编处理方式。
6. **平台诚实**：🔵 明说"没真跑过，只静态看了一遍"，不伪装绿灯。
7. **技术词对作者全隐藏**：每个触点末尾"工程机制"一句是给工程师的，不进 agent 对作者说的话。
