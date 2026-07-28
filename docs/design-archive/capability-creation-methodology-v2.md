# 设计文档：能力新建方法论 v2（业务流程沉淀式）

> 状态：设计提案（未实现）。作者：planner + 主会话。评审：AI 应用专家 agent。
> 立项原因：当前新建流程只问 kind/name/brand/slug 四项即 scaffold 出一个空骨架，"建好了"= 工程骨架签名匹配，不等于业务可用。本设计把"新建可用能力"从"填模板"重构为"从真实操作蒸馏 + 真实输入跑通验收 + 真实使用证据定级"。
> 不变量底线：零新 npm 依赖；`additionalProperties:false` 全保留；`registry*.yaml` auto-gen 不动；贡献者只写 `.md/.yaml/.json`；skeleton_guard 不破；R16–R22 不弱化、同级新增；release gate 三报告逻辑不动；Windows 兼容。

---

## 1. 背景与问题诊断

### 1.1 当前新建链路事实

CLI 入口 `tools/opsforge.mjs` 的 `promptNew`（行 444-453）实际只问 4 项：`kind / name / brand / pack slug`。问完调 `new-capability.mjs scaffold()`（行 74-143）把 `templates/<kind>/` 拷到 `_drafts/`、替换 `__SLUG__`/`__NAME__`、写 `.opsforge-state.json`，结束。`cmdNewFlow`（行 167-178）打印一行"下一步: 填写业务字段"即 return。

模板里业务作者要填的只有：
- `templates/skill/SKILL.md` body 两个 H2：`## 能力说明`（一个 `__FILL_ME__`）+ `## 适用场景`（一个 `- __FILL_ME__`）。
- `templates/agent/source.md`、`templates/mcp/source.md` 与 skill 同构。
- `templates/<kind>/tests/case-01..03.yaml` 三个文件全 `__FILL_ME__`。

### 1.2 根因

1. **模板先行**：作者照空模板编内容，内容不来自真实操作，产出形式合规但跑不通。
2. **作者被要求从头写系统提示词**：`## 运行指令` 是最关键字段，非开发者从头写不出好提示词，模板留 `__FILL_ME__` 让他填，填出来的跑不通。
3. **"建好"由结构完整性定义**：所有 `__FILL_ME__` 清空 = 建好。缺真实输入跑通这道行为门。
4. **kind 在开头选**：作者未描述清楚流程形状就被迫选 skill/agent/mcp。
5. **skill/agent/mcp 三套模板同构**：未体现 skill 重多步流程、agent 重角色边界、mcp 重工具契约的差异。
6. **CLI readline 问答 vs opsforge-wizard skill body 语义分裂**（G8）：skill body 承诺"fill+test+validate+render"循环，CLI 只 scaffold+提示。
7. **迭代在创建之外**：能力崩了才发现问题，feedback/eval-history 不在创建期内。

### 1.3 标杆对照

用户提及的 `member-recall`（会员召回，步骤 0→1→1.5→2→3→4，每步可执行无模拟无假设）是"完整覆盖业务流程"的标杆。其真正启示不是"分了阶段"，而是：① 每阶段产出一个具体工件；② 每个工件过一个人工审核闸门；③ 工件喂给下一阶段。这是个 **pipeline**，不是单条 prompt。仓库内现有 dogfood 样本（activity-summary/copywriter/bi-connector）均未达此标杆——测试 placeholder 级、body 无分阶段结构。

---

## 2. 核心转变（一句话）

作者从"往空模板填字"变成"提供真实操作知识 + 审稿"；LLM 干访谈和蒸馏；"建好"由真实输入跑通定义，不由结构填满定义；能力成熟度由真实使用证据背书，不由字段完整性背书。

---

## 3. 总览：5 期创建流水线

```
访谈期 (capability-interviewer agent, in-platform LLM 对话)
   ├ Mode A 先做再蒸馏 / Mode B 苏格拉底访谈（作者开头选）
   └ 产出: 操作实录（含真实样本）→ state: 访谈完成
        ↓
蒸馏期 (capability-distiller agent)
   ├ 形状推导（skill/agent/mcp/workflow，作者确认）
   ├ new-capability.mjs 拿骨架 + 覆写业务字段 + 系统提示词从实录蒸馏 + tests 用真实样本
   └ 产出: _drafts/<slug>/ 草稿 → state: 蒸馏完成
        ↓
跑通期 (CLI 工具接驳)
   ├ 结构门（必要）: validate draft gate + security-scan 全绿
   ├ 跑通门（充分）: test-runner dry-run case-01 真实输入→真实产出；workflow 走查录 golden
   └ 过 = v0.1 建好；不过 = 回蒸馏期改提示词（内循环）→ state: v0.1 建好
        ↓
迭代期 (CLI 工具 + 人)
   ├ 再跑 2 个真实案例 → 崩了 regression-sink 自动沉淀草稿 → 人修 + promote（含跑通门）+ bump
   ├ 连续 2 干净 = 收敛
   └ 升级门票: draft(1 真例) → staged(3 真例三象限) → formal(N 轮干净 + eval)
```

三态映射（用真实案例数当升级门票，不用字段完整性）：
- **draft** = 结构绿 + 1 个真实案例跑通（v0.1 建好门槛）
- **staged** = 3 个真实案例跑通（正/边界/负三象限皆真实）+ R16–R27 全绿 + security 绿
- **formal** = N 轮迭代连续干净 + eval harness（5 轴）≥阈值 + 平台矩阵

---

## 4. 两个 Agent 设计（本设计的承重构件）

### 4.1 capability-interviewer（访谈员）

- **位置**：`packs/opsforge-meta/agents/capability-interviewer/source.md`（新 agent）。
- **职责**：把作者脑子里的操作知识（Mode B）或一次真实操作（Mode A）变成结构化操作实录。作者只回答/只做，不写结构化内容。
- **入口问句**：第一句让作者选 Mode A/B。
  - **Mode A 先做再蒸馏**：作者在同会话真的把这件事做一次（带真实数据）。agent 角色 = 影子 + 复述：不打断，结束时复述"步骤1你打开了X，步骤2你复制了Y到Z，步骤3你停下来判断了…对吗？漏了什么？"。实录从真实动作来。
  - **Mode B 苏格拉底访谈**：agent 用问题树把知识勾出来。作者负担最轻，实录质量取决于访谈深度。
- **问题树（按形状分支，访谈本身发现形状）**：
  - 第一层定性："这事是重复的多步流程，还是持续的角色判断，还是你就是需要接个数据/暴露个工具？"
  - 分支 A（多步流程）→ 每步追问：动了什么数据（来源/格式/字段）、哪里做了判断、哪步要人审/拍板、哪步改过不止一版、上步给下步交了什么。可能长成 workflow。
  - 分支 B（角色判断）→ 追问：你是谁、为谁服务、常用哪些工具、什么活接、什么活坚决不接（边界）。
  - 分支 C（数据/工具）→ 追问：暴露什么操作、输入/输出字段、上游是谁、错了怎么返回。
  - 问题树本身是 kind 推导器——访谈走完形状自然浮现，作者不开头选 kind。
- **产出**：`_drafts/<slug>/interview.md`（LLM 填、作者审），结构见 §5.1 实录模板。
- **最硬约束**：`## 真实样本` 行的 input 必须是作者真实遇到过的数据。拿不出真实样本的作者，Mode A/B 都救不了；兜底为"合成样本须标注'合成'"，合成样本跑通只盖"结构绿"章，不盖"真实跑通"章。

### 4.2 capability-distiller（蒸馏器）

- **位置**：`packs/opsforge-meta/agents/capability-distiller/source.md`（新 agent）。
- **职责**：读 `interview.md`，先调 `new-capability.mjs --kind <推导 kind>` 拿合法骨架，再把实录内容覆写进业务字段；形状显式给作者确认（不静默）；系统提示词从实录真实跑通过的步骤蒸馏（非凭空编）；测试用例用实录里的真实样本。
- **形状推导规则（作者确认）**：
  - 实录有 ≥2 个有序步骤 + 步骤间有工件交接 → **skill**；其中若有分叉/人工闸门/循环 → **workflow**（不是 skill）
  - 实录是持续角色 + 工具使用、无固定序列 → **agent**
  - 实录是"暴露操作/接数据" → **mcp**
- **覆写映射**：
  - skill → `## 运行流程`（每步骤映射实录步骤，带输入/输出/决策/审核 4 标记）+ `## 失败降级` + `## 依赖` + `## 运行指令`（系统提示词草稿，从实录真实跑通过的步骤蒸馏）
  - workflow → `workflow.yaml` 的 `steps` 映射实录步骤，每个人工闸门落 `checkpoint`（HITL pause），工件交接落 `vars`
  - agent → `## 角色设定` + `## 工具集` + `## 边界`（边界来自实录"不做哪些"）
  - mcp → `## 工具面` + `## 数据契约` + `## 异常处理` + `config_template.auth_schema` 填 env 变量名
- **doc-coauthoring 循环**：LLM 起草 → 作者审/批注 → LLM 改 → 定稿。作者始终是审稿人。
- **约束**：只能写 body/H2/业务字段，不能加新 frontmatter 字段；schema 不动；skeleton_guard 不破（文件集不变）。

### 4.3 为什么拆两个 agent

- 单 skill 两段 prompt 会让 prompt 过长，访谈与蒸馏的认知模式也不同（访谈=提问+复述，蒸馏=转换+覆写），拆开各自专一。
- 两个 agent 各自有独立 test suite（`turns` + `post_condition` 多轮模式），可回归。
- 符合 OpsForge 既有"agent = 单角色"约定。

---

## 5. 各期详细设计

### 5.1 访谈期

**目标**：产出操作实录。

**操作实录模板**（`templates/interview-record.md`，LLM 填、作者审）：
```
# 操作实录: <工作名>
## 任务动机  痛点/频率/单次耗时/范围边界
## 流程实录
### 步骤1 <动作>  数据:…  决策:…  人工闸门:…  交付工件:…
### 步骤2 …
## 真实样本（关键，决定能不能跑通）
- 正例输入: <真实数据> → 产出: <真实产出>
- 边界输入: <真实遇到过的异常> → 降级/产出: …
- 负例输入: <真实失败过的> → 失败返回: …
## 不做哪些
## 依赖的外部资源（数据源/MCP/前置能力）
```

**落地**：
- capability-interviewer agent in-platform 对话（非 CLI readline）。
- 实录落 `_drafts/<slug>/interview.md`；`.opsforge-state.json` 记 `phase: interview_done`。

**卡点**：
1. 问题树质量是承重墙，steering 一次性写，需反复打磨——这是本设计最该投入之处。
2. 作者必须带真实输入；兜底为合成样本标注（合成只盖结构章不盖跑通章）。

### 5.2 蒸馏期

**目标**：实录 → 能力草稿文件。

**落地**：
- capability-distiller agent 读 `interview.md`，调 `new-capability.mjs` scaffold，覆写业务字段。
- 草稿落 `_drafts/<slug>/`；state 记 `phase: distill_done`。
- doc-coauthoring 循环改到定稿。

**卡点**：
1. 系统提示词即便从实录蒸馏仍可能不够好——跑通期兜底，跑不通回本期改（内循环）。
2. workflow checkpoint 在跑通期无法自动跑（见 5.3）。
3. 覆写守 `additionalProperties:false` + 不动工程字段。

### 5.3 跑通期

**目标**：v0.1 建好 = 结构门（必要）+ 跑通门（充分）都过。

**结构门（必要，机械可验）**：
- `validate.mjs` draft gate（R7 placeholder_clean + 命名 + 路径穿越 + skeleton 签名）+ `security-scan.mjs`（SSRF/密钥/越权）全绿。

**跑通门（充分，行为可验）**：
- `test-runner.mjs` 对 case-01（正例）跑一次 dry-run：
  - skill/agent → `claude -p` dry-run（Tier 1）或 `OPSFORGE_RUNNER=<platform>` HTTP API（Tier 2/3）
  - mcp → 静态 schema 校验为主 + 可选 HTTP 跑
  - workflow → 走查录 golden（见下）
- 判定：产出 `contains`/`schema`/`exact` 命中 case-01 的 expected（expected = 实录里真实产出）。
- 过 = v0.1 建好；不过 = 回蒸馏期改提示词。

**workflow HITL 跑通（本设计最硬技术点）——默认解法 2：作者走查录 golden**：
- 作者在跑通期亲自把 workflow 走一遍（带真实输入，每个 checkpoint 真做判断），这次走查录成一条 **golden 用例**（OpsForge 已有 `golden` expect mode + `workflow-runner.mjs --resume`）。
- 妙处：作者自己的走查 = 验收基线，人工判断正确性由"作者亲自走过一次"背书，而非自动批准糊弄。
- 解法 1（`--test-mode` 自动 approve checkpoint，标注"测试批准"）做快测兜底，非默认。

**质量灯拆两档（不混为一谈）**：
- 🟢 真跑通：真实模型 dry-run 产出命中 expected（Tier 1 / Tier 2 有 HTTP API 时）。
- 🟡 静态等效：Tier 3 国内平台 dry-run 退化为静态 schema 校验 + 人工看产出；诚实标注"未真实跑通，仅静态等效"。
- 报告渲染（`tools/report-renderer.mjs`）把跑通灯拆成两档分别显示。

**成本控制**：
- 跑通门只跑 1 条（正例 case-01），不跑 3 条。
- 边界/负例静态过 R-rule 即可（结构门），不强制真跑。
- 作者可选"全跑"（3 条真跑），非必要。

**落地**：`test-runner.mjs` + `validate.mjs` draft gate + `security-scan.mjs` + workflow `golden` mode + `workflow-runner.mjs --resume`；state 记 `phase: v0.1_built`。

**卡点**：
1. Tier 3 真实跑通打折——用质量灯两档诚实标注。
2. expected 软（合成样本）→ 跑通门软——合成只盖结构章。

### 5.4 迭代期

**目标**：v0.1 建好 ≠ 完工；用真实案例迭代收敛。

**循环（GAN 式）**：
1. v0.1 建好后，作者再拿 2 个真实案例（非原始那个）跑能力。
2. 崩了 → `tools/regression-sink.mjs`（Phase 4 已交付）自动把失败沉淀成回归草稿到 `_drafts/`，留 `__FILL_ME__`，过 `--promote` 人工 gate。
3. **promote 加跑通门（本设计强化点）**：regression 草稿 promote 成正式 case 前，该条 case 必须先跑通（dry-run 命中 expected），否则 promote 失败。防止把描述错的回归 case 污染 test suite。
4. 作者修能力（多半改系统提示词/加降级路径）+ promote 跑通的那条回归 case + bump 版本（patch=修 bug，minor=覆盖新场景）+ 重跑。
5. **收敛信号**：连续 2 个真实案例干净通过 = 本轮收敛；否则继续（loop-until-dry）。

**升级门票（三态）**：见 §3 末。

**落地**：`regression-sink.mjs` + `--promote`（加跑通门钩子）+ feedback jsonl + `eval.mjs --iteration N` eval-history + 版本 bump 改 frontmatter。

**卡点**：
1. "再拿 2 个真实案例"靠作者自觉；**不加 30 天降级软约束**（用户决定）。仅靠 feedback jsonl effectiveness<70% 既有机制兜底。
2. regression 草稿描述不准时，promote 跑通门是兜底（第 3 点）。

---

## 6. kind 形状推导规则（汇总）

| 实录特征 | 推导 kind | 关键工件 |
|---------|----------|---------|
| ≥2 有序步骤 + 工件交接，无分叉/无人工闸门 | skill | `## 运行流程` + `## 运行指令` |
| ≥2 有序步骤 + 分叉/人工闸门/循环 | workflow | `workflow.yaml` steps + checkpoint + vars |
| 持续角色 + 工具使用，无固定序列 | agent | `## 角色设定` + `## 工具集` + `## 边界` |
| 暴露操作/接数据 | mcp | `## 工具面` + `## 数据契约` + `## 异常处理` |

推导结果显式给作者确认，不静默。

---

## 7. 不变量守护

| 不变量 | 守护方式 |
|--------|---------|
| §C.1 零新 npm 依赖 | 访谈/蒸馏是 in-platform LLM 对话，不引 import；跑通/迭代复用 test-runner/validate/regression-sink 现有工具 |
| `additionalProperties:false` 不破 | 5 阶段工件全部落 body H2 / tests yaml / workflow.yaml，不落 frontmatter 新字段；schema 不动 |
| skeleton_guard 不破 | 模板改 body 内容不改文件集；新增 interview-record.md 是中间态非能力文件，不计入能力 skeleton 签名 |
| 贡献者只写 `.md/.yaml/.json` | 全部工件是 markdown/yaml；访谈/蒸馏由 steering-owned agent 干 |
| R16–R22 不弱化 | 新增 R24–R27 同级 append（参照 R23），staged+ 生效，draft 零门槛不变 |
| release gate 三报告不动 | R-rule 全在 validate.mjs（validation-report.json），不碰 security-scan/eval |
| CLI/skill body 语义一致 | 访谈/蒸馏只在 in-platform agent 路径，CLI 不再做引导问答（CLI 只接驳 scaffold/run/regression），G8 根除 |
| Windows 兼容 | in-platform 对话无 readline 依赖；CLI 工具复用现有 `makeAsker` |
| 存量 dogfood | activity-summary/copywriter/bi-connector 现状只有 2 个 H2，P1 R-rule 上线前同步给 3 样本补 H2（诚实地示范新标准） |

---

## 8. 落地变更清单（文件级，P0/P1/P2）

### P0（让新建流程从"问名字"变成"LLM 引导式沉淀"）

| # | 文件 | 改什么 |
|---|------|--------|
| P0-1 | `packs/opsforge-meta/agents/capability-interviewer/source.md` | 新 agent：编码 Mode A/B 入口 + 问题树 + 实录模板引用 |
| P0-2 | `packs/opsforge-meta/agents/capability-distiller/source.md` | 新 agent：形状推导规则 + 覆写映射 + 调 new-capability.mjs + doc-coauthoring 循环 |
| P0-3 | `templates/interview-record.md` | 新模板：实录结构（动机/流程实录/真实样本/不做哪些/依赖） |
| P0-4 | `templates/skill/SKILL.md`、`templates/agent/source.md`、`templates/mcp/source.md` | 三套模板分别加各 kind 专属 H2 占位（skill: 运行流程/输入契约/输出契约/失败降级/依赖/运行指令；agent: 角色设定/工具集/边界/依赖/运行指令；mcp: 工具面/数据契约/异常处理/依赖/运行指令），供蒸馏器覆写 |
| P0-5 | `templates/<kind>/tests/case-01..03.yaml` | 改正例/边界/负例三象限模板，顶部加 `# 象限: positive/boundary/negative` 注释；input/expected 仍 `__FILL_ME__`（蒸馏器用实录真实样本覆写） |
| P0-6 | `tools/opsforge.mjs` `cmdNewFlow`/`cmdWizard` | 不再做引导问答；改为"提示作者在平台内 `@capability-interviewer` 启动访谈"，CLI 只接驳 scaffold/run/regression。根除 G8 |
| P0-7 | `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md` | `## 运行指令` 对齐：访谈员→蒸馏器→跑通→迭代 四期路由，作者入口指向两个新 agent |

### P1（把"问对"升级为"必填" + 行为门）

| # | 文件 | 改什么 |
|---|------|--------|
| P1-1 | `tools/validate.mjs` 新增 R24 `process_stages_present`（staged+，同级 R23） | skill: body 必含 `## 运行流程` ≥2 编号阶段含输入/输出标记；agent: `## 角色设定` 非空；mcp: `## 工具面` 非空且 tools 非空；workflow: steps ≥2 |
| P1-2 | `tools/validate.mjs` R24 同级 `degradation_present` | skill: `## 失败降级` ≥1 条；agent: `## 边界` 非空；mcp: `## 异常处理` 非空；workflow: 每个失败路径有降级动作 |
| P1-3 | `tools/validate.mjs` 新增 R25 `depends_declared`（staged+） | body `## 依赖` 提到的 capId 必须在 `depends_on:` frontmatter，反之亦然 |
| P1-4 | `tools/validate.mjs` 新增 R26 `test_three_quadrants`（staged+） | tests/ ≥1 正例 + ≥1 负例/降级例 + ≥1 边界例（靠 `# 象限:` 注释判定，非 name 前缀启发式） |
| P1-5 | `tools/validate.mjs` 新增 R27 `run_instruction_present`（staged+） | body 必含 `## 运行指令` ≥80 token |
| P1-6 | `tools/opsforge.mjs` 跑通门 | 跑通期结构门后自动调 `test-runner.mjs` 对 case-01 dry-run，渲染质量灯两档（真跑通/静态等效） |
| P1-7 | `tools/regression-sink.mjs` promote 钩子 | `--promote` 前先跑该条 case dry-run，跑通才允许 promote |
| P1-8 | `tools/report-renderer.mjs` | 跑通灯拆 🟢 真跑通 / 🟡 静态等效 两档分别显示 |

### P2（自动化与 guardrail）

| # | 文件 | 改什么 |
|---|------|--------|
| P2-1 | `packs/opsforge-meta/agents/capability-interviewer/tests/` | 给访谈员加回归测试（Mode A/B 分叉、问题树覆盖） |
| P2-2 | `packs/opsforge-meta/agents/capability-distiller/tests/` | 给蒸馏器加回归测试（形状推导四分支、覆写映射、doc-coauthoring 循环） |
| P2-3 | `templates/<kind>/` skeleton-signature 验证 | 确认新模板 H2 占位不影响签名（文件集不变） |
| P2-4 | `.github/workflows/guardrails.yml` | 新 agent / 新模板路径纳入 CODEOWNERS + path-guard |
| P2-5 | `docs/methodology/capability-creation.md` | 贡献者文档：5 期方法论 + 形状推导 + 真实样本要求 |

---

## 9. 风险与未决

1. **问题树/蒸馏 prompt 质量**：steering-authored，需反复打磨；这是本设计的承重墙，非机械改动。
2. **Tier 3 真实跑通打折**：用质量灯两档诚实标注；不混为一谈。
3. **真实样本依赖**：作者拿不出真实样本则地基软；合成样本标注兜底但只盖结构章。
4. **workflow 走查成本**：作者亲自走一遍录 golden 比自动批准慢一截；解法 1 做快测兜底。
5. **regression promote 跑通门**：可能让 promote 变慢；但防污染 suite，值得。
6. **存量 dogfood 升级**：P1 R-rule 上线前须同步补 3 样本 H2，否则 staged gate 挂。
7. **in-platform 依赖**：访谈/蒸馏必须 in-platform（Claude Code）跑，纯 CLI 路径只接驳不引导；无平台环境时退化为"作者手填 interview.md"兜底。

---

## 10. 成功判据

- [ ] 作者走完访谈→蒸馏→跑通后，`_drafts/` 能力 body 含全 5 阶段 H2（非 `__FILL_ME__`），tests 含正/边界/负 3 象限且 input 来自实录真实样本。
- [ ] skill/agent/mcp/workflow 四 kind 走出的结构各异（skill 有 `## 运行流程`，workflow 有 checkpoint+vars，agent 有 `## 角色设定`+`## 边界`，mcp 有 `## 工具面`+`## 异常处理`）。
- [ ] 跑通期结构门 + 1 条真实 case dry-run 都过才标 v0.1 建好；Tier 3 静态等效诚实标黄。
- [ ] workflow 走查录 golden 能 replay 回归。
- [ ] regression promote 跑通门生效：跑不通的回归 case 不能 promote。
- [ ] R24–R27 staged+ 生效，draft 不挡；424 测试基线不回退（新增 R-rule 同步加测试，预计 424 → ~450）。
- [ ] schema/test-case schema 零改动；package.json 零改动；`additionalProperties:false` 保留。
