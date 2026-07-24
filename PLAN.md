# 消费者运营能力包（OpsForge）方案设计 v9

> **v9 相对 v8 的核心调整：补"国内自研平台强兼容性"与"全流程非技术用户 UX"两块。**
> v8 建立了行为评估层，但 §6/§8/§9 隐含假设目标平台是 Claude Code/Cursor/Codex/Cline 这类有公开 SDK/CLI、有 slash-command、有 MCP、有约定配置目录的主流平台；实际落地中 agent 平台可能是国内自研平台（只有 HTTP API / Web UI / 私有协议，能力点各异）。同时 v6–v8 的护栏工程正确但对人不对——裸 CLI、JSON artifact 对非技术用户太硬核。v9 补两块：① 把"平台能做什么"分解为 9 个正交能力点 + 3 级 Tier + 9 能力点 × 5 降级策略的通用降级矩阵（把 v7 P8 单点兜底推广到任意原语缺失），国内自研平台以"一个 platform.yaml + thin adapter"最小路径接入；② `tools/opsforge.mjs` 交互式向导 + `tools/report-renderer.mjs` 中文 plain 报告渲染层包裹裸 CLI 与 JSON，使非技术用户从"想法→能力→安装→使用→反馈"全链路有引导有反馈。6 项决策 D1–D6 已全部按推荐默认确认（见 §22.6）。
>
> 因此 v9 新增 §22「v9 正式修订」：平台能力点模型 + `platform.yaml` 声明、adapter 契约加 `supports(point)`/`tier()`、`requires` 可选字段声明硬依赖、通用降级矩阵（cli-engine/http-inject/manual-paste/http-direct/fail-loud）、无 SDK/CLI 平台 dry-run 与 eval 降级、judge 国内模型 endpoint、`data-residency-cn` 合规扫描；`opsforge new/wizard/install/status/doctor/report/discover/feedback` 交互式向导、`.opsforge-state.json` 流转状态、`report-renderer.mjs` 三份 JSON 报告→中文 plain 红绿灯渲染、能力发现与错误恢复指引。业务作者仍只写 `.md/.yaml/.json`，所有新工具属 steering，无新 npm 依赖（复用 Node 内置 readline/fetch）。
>
> 历史逐文件蓝图见 `docs/design-archive/supplement-v9.md`（Phase 1 已落地，本文件为权威；归档件含 platform.yaml 形态、降级矩阵、opsforge 向导交互流、plain 报告示例，仅供设计史查阅）。

> **v8 相对 v7 的核心调整：补"能力质量验证"层——验证 vibe-coded 能力是否真正有效。**
> v7 建立了循环工作流执行与可组合自定义安装，但 §A/§B/§C + `validate.mjs` R1–R15 全是**静态结构校验**：一个 body 写一行废话、3 个 `expected:"ok"` 的测试用例能过所有门禁却毫无实效。v8 叠加**第四层行为评估**（behavioral）：跑用例判输出、LLM-judge 打分、防空头静态守卫、发布后反馈闭环防模型漂移。11 项决策 Q1–Q11 已全部按推荐默认确认（见 §21.9）。
>
> 因此 v8 新增 §21「v8 正式修订」：升级 `tools/test-runner.mjs` 为真评估器（7 字段用例 schema + 7 种 `expect` 模式 + dry-run harness）、引入 `tools/eval.mjs` 五维 rubric + `eval-report.json` 第三份 CI artifact、`validate.mjs` 加 R16–R22 防空头守卫、三态门禁升级（draft 静态 / staged +functional runSuite / released +eval harness +平台 matrix +workflow dry-run）、`release.mjs` 要求三报告齐备、`opsforge-feedback` MCP + `--doctor` effectiveness 体检 + weekly re-eval cron 防腐烂。业务作者仍只写 `.md/.yaml/.json`，所有评估器属 steering。其余 v7 结构保留不动。
>
> 历史逐文件蓝图见 `docs/design-archive/supplement-v8.md`（Phase 1 已落地，本文件为权威；归档件含用例 schema、judge 提示词契约、阈值矩阵、CI 集成点，仅供设计史查阅）。

> **v7 相对 v6 的核心调整：补"循环工作流执行"与"可组合自定义安装"两块。**
> v6 建立了工程基线（§C）、三态流转、品牌隔离、§A/§B 门禁、跨平台 adapter，但两个真实诉求未充分定义：(1) 循环型工作流（如会员制咨询：取数表→SQL→数据充分性评估→不足补数回流→策略→数据挖掘）如何在通用 agent 平台上"一条斜杠"触发并持久化沉淀；(2) 仓库作为资源仓，不同项目要装不同子集的 skill/agent/mcp/workflow，需可复现的自定义组合安装。
>
> 因此 v7 新增 §20「v7 正式修订」：扩展 workflow.yaml 控制流（`control_flow`/`vars`/`kb_mount`）、引入运行期引擎与 per-run 持久化与断点续跑、引入 **Profile**（消费方项目的安装清单 + `profile.lock.json`）与依赖解析器、扩展安装器 CLI、补平台不支持 workflow 的兜底策略。8 项设计决策 P1–P8 已全部按推荐默认确认（见 §20.9）。其余 v6 结构保留不动；§20 末附"与既有 § 的集成点"表，逐条标注对 §2/§6.1/§7/§8/§9/§11/§13/§14/§15/§17/§C 的具体变更。
>
> 历史逐文件蓝图见 `docs/design-archive/supplement-v7.md`（Phase 1 已落地，本文件为权威；归档件含完整示例 workflow.yaml 与 profile.lock.json，仅供设计史查阅）。

---

> **v6 相对 v5 的核心调整：补"面向无开发背景业务人员的工程基线与 vibe-coding 护栏"层。**
> v5 已建立三态流转、品牌隔离、§A 规范门禁、§B 安全门禁。但 v5 隐含一个未言明的假设：贡献者具备基本工程素养（知道选什么语言、怎么命名、怎么放文件、怎么写测试）。实际业务场景中，后续所有 skill/agent/mcp 的迭代将由**毫无开发基础的业务运营人员**通过 **vibe coding**（自然语言驱动 AI 编码代理生成）完成。这意味着 v5 的"人审兜底工程判断"假设不成立——业务人员没有工程判断可供兜底。
>
> 因此 v6 在 v5 之上新增 §C「工程基线与 vibe-coding 护栏」，把工程基线前置为机器强制的约束，让业务人员 vibe coding 时**只有业务逻辑可变，工程实施方式统一可控**。核心新增：
> 1. **固定技术栈与"一种语言"原则**（§C.1）：全项目 pin Node 22 LTS + ESM `.mjs`，业务作者不得引入新语言/框架/构建工具。
> 2. **统一项目布局与"填空式"能力骨架**（§C.2）：业务作者只能复制官方模板、在预定义槽位里写业务逻辑，不得自创目录结构。
> 3. **非开发者开发流程**（§C.3）：从"我想加一个能力"到"已发布"的端到端轨道，draft→staged→released 重定位为补偿作者缺乏工程判断的过程门禁。
> 4. **CI 机器强制规范**（§C.4）：把开发者"凭直觉知道"的每条规范映射到具体的 lint/validate 规则，由 CI 兜底。
> 5. **vibe coding 护栏**（§C.5）：官方模板即唯一合法起点、`tools/validate.mjs` 任何偏差即 fail-loud、禁止新增依赖/禁止骨架外新文件、仓库级 `AGENTS.md`+`CLAUDE.md` 让 AI 编码代理成为工程纪律的执行者。
> 6. **被剥夺的工程决策清单**（§C.6）：依赖选择、版本号策略、安全策略、平台目标等决策从业务作者手里收归 steering/CI。
> 7. §14 约束清单与 §16 风险表同步更新，反映工程基线层；§A 规范门禁与 §B 安全门禁成为工程纪律的执行骨干。
>
> 其余 v5 结构（三态流转、品牌隔离、§A、§B、跨平台 adapter）保留不动，仅与新层集成。
>
> v5 相对 v4 的核心调整：强化"审核机制"与"安全审核"。§A 能力规范审核机制、§B 安全审核机制。其余结构与 v4 一致。v4 把品牌定制目录 `customers/<brand-slug>/` 加回来，极简化——只做能力隔离存放，不引入合同/license/交付包机制。

---

## 0. 一句话定位

`OpsForge` 是一个**简单但规范、可由无开发背景的业务人员通过 vibe coding 持续贡献、可直接收录开源能力、版本管理清晰、容易安装和使用、并支持品牌定制能力隔离存放的运营能力仓库 + 安装器**。它通过跨平台 adapter 把运营团队沉淀的 agent / skill / mcp / workflow 一键装配到任意 Agent 平台（Claude Code / Codex / Cursor / Cline）。v6 的关键设计是把"工程纪律"从"靠贡献者自觉"改为"靠机器强制 + AI 编码代理执行"——业务人员只表达业务流程逻辑，工程实施方式、技术栈、目录结构、命名、测试、安全全部由仓库基线统一且不可被贡献者绕过。品牌定制能力在仓库内独立存放与隔离，但仓库本身不引入合同/license/交付包机制——这些属于业务层，技术层只负责"装得下、装得开、不串台"。

---

## 1. 第一性原理推导

### 1.1 这个东西的本质是什么

剥到最底层，`OpsForge` 回答四个问题（v6 加第 4 条）：

1. **生产侧**：运营/开发者如何以最低门槛把经验沉淀为可复用能力？
2. **消费侧**：这些能力如何被"发现-安装-组合-执行"？
3. **隔离侧**：给品牌方单独造的能力如何与通用能力、与其他品牌能力物理隔离，又不引入复杂的合同/license 机制？
4. **工程基线侧（v6 新增）**：当贡献者是无开发背景的业务人员、用 vibe coding 生产能力时，如何保证每条贡献的工程实施方式统一可控、符合最佳实践，而不是把"工程判断"的责任丢给一个没有工程判断的人？

价值侧暂不建模——商业化是能力仓库成熟后的自然延伸，不在 v6 范围内。

### 1.2 为什么"原子能力 + 编排"是正确的抽象

运营工作天然多步骤。因此抽象为三层：

- **Capability（能力原子）**：agent / skill / mcp，最小可执行单元。
- **Workflow（编排原子）**：多 Capability 按图编排，参数化、可复用。
- **Bundle（打包单元）**：按场景打包多个 Capability + Workflow。

这三层与安装平台、品牌归属、售卖方式、**贡献者工程能力**全部解耦。v6 的关键判断：正因为贡献者工程能力不可控，这三层的**承载格式**（.md / .yaml / .json）必须足够简单、足够受限，让"填空"即"贡献"。

### 1.3 为什么必须跨平台适配层

不同 Agent 平台的能力载体约定不同，但底层原语统一（提示词、工具调用、上下文规则、MCP 接入点）。正确设计：**仓库内只存平台无关的"能力源"，安装时由 adapter 翻译为目标平台产物**。一次定义、处处安装。v6 补充：能力源格式（frontmatter + markdown body + yaml 元数据）是**业务人员唯一需要碰的东西**；adapter 由 steering 维护，业务人员不得碰。

### 1.4 为什么"低门槛入库 + 强约束正式区"是治理基石

v5 的三态流转在 v6 被重新定位：**三态不只是"治理流转"，更是"补偿作者缺乏工程判断的过程门禁"**。业务人员在 `_drafts/` 可以随意 vibe code（因为草稿区校验极轻），但每往前一态，CI 就替作者补上一层工程纪律（schema、命名、测试、安全、依赖方向）。到正式区时，所有本应由开发者"凭直觉保证"的工程属性，已全部由 CI 兜底校验通过。这是 v6 对 v5 三态语义的升级。

### 1.5 为什么品牌隔离用"目录 + 命名空间前缀"而非 license

v4 的关键判断保留：品牌定制能力的"归属品牌方"是业务/合同层的事，技术层不该背这个锅。技术层只需保证：

- 品牌间能力物理隔离（目录边界）
- 命名空间前缀防冲突（pack id = `<brand-slug>.<name>`）
- 依赖方向单向（品牌可依赖通用，通用不得依赖品牌）

做到这三点，"不串台"就成立了。

### 1.6 为什么工程纪律必须机器强制而非靠人审（v6 新增）

v5 依赖"steering 人审"作为最后兜底。但人审对"命名是否规范、是否引入了新依赖、是否在骨架外造了文件、是否写了测试、是否硬编码了密钥"这类**机械可判定的工程规范**既低效又不可靠——尤其当贡献量上来之后。v6 的判断：**一切能被机器判定的工程规范，一律由 CI 判定并阻断；人审只保留对"业务逻辑是否合理、能力是否值得收录"这类需要人类判断的事项**。把工程纪律从"人审职责"下放到"CI 职责"，人审才能聚焦真正需要人判断的事。

---

## 2. 核心概念模型

| 概念 | 定义 |
|------|------|
| **Capability** | 最小可执行能力：agent / skill / mcp |
| **Workflow** | 多 Capability 编排图，参数化、可复用 |
| **Bundle** | Capability + Workflow 的场景套装 |
| **Pack** | 命名空间，归属 Owner，含若干能力 |
| **通用能力** | 存于 `packs/<contributor-slug>/`，所有人可见可装 |
| **品牌定制能力** | 存于 `customers/<brand-slug>/packs/<brand-slug>/`，用 `customer` 字段标记归属品牌 |
| **Adapter** | 平台适配层，把能力源翻译为目标平台产物（steering 维护，业务作者禁碰） |
| **能力三态** | `draft`（草稿区）/ `staged`（审核区）/ `released`（正式区），通用区与品牌区各自三态。v6 语义：三态即"逐步叠加工程纪律的过程门禁" |
| **能力骨架（v6 新增）** | 每个能力目录的法定文件集合（`capability.yaml` + `source.md`/`SKILL.md` + `tests/` + `CHANGELOG.md` 等），业务作者只能在槽位内填，不得增删骨架文件 |
| **工程基线（v6 新增）** | 全仓库固定的技术栈、目录布局、命名规则、测试要求、安全策略，由 CI 与 AI 编码代理指令文件共同强制，业务作者不得偏离 |

每个原子标识：`<pack>.<name>@<version>`，全局唯一可寻址。品牌定制能力的 pack id 以品牌 slug 为前缀，天然防冲突。

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│                    仓库（monorepo）                       │
│  packs/{_drafts,_staged,<contributor>,_third-party}/      │
│  customers/<brand-slug>/packs/{_drafts,_staged,<brand>}/  │
│  workflows/  bundles/  adapters/  registry.yaml  schema/  │
│  tools/  ci/  docs/  templates/  AGENTS.md  CLAUDE.md      │
└──────────────┬───────────────────────────────────────────┘
               │
      ┌────────┴────────┐
      │                 │
┌─────▼──────┐   ┌──────▼──────┐
│ installer  │   │  registry   │
│ (sh + mjs) │   │  index.json │
└─────┬──────┘   └─────────────┘
      │ 按平台 adapter 翻译并写入
      │
 ┌────▼───────────────────────────────────────┐
 │  目标平台安装目录                            │
 │  Claude Code / Cursor / Codex / Cline       │
└─────────────────────────────────────────────┘
```

分层：源层（三态 packs + 品牌定制三态 customers）/ 注册表层 / 适配层 / 安装层 / 运行时层。v6 在仓库根新增 `templates/`（官方唯一合法起点骨架）、`AGENTS.md` + `CLAUDE.md`（AI 编码代理工程纪律指令文件）。品牌隔离由目录 + 命名空间 + CI 守卫实现；工程基线由 `templates/` + `tools/validate.mjs` + `AGENTS.md`/`CLAUDE.md` + CI 共同守卫。

---

## 4. 仓库目录结构

```text
opsforge/
├── README.md
├── LICENSE                          # 内核开源协议（Apache-2.0）
├── AGENTS.md                        # v6 新增：AI 编码代理工程纪律指令（通用，所有代理读）
├── CLAUDE.md                        # v6 新增：Claude Code 专属补充指令（指向 AGENTS.md）
├── package.json                     # v6 新增：pin Node 22 LTS + type:module + 受控依赖清单
├── .nvmrc                           # v6 新增：锁定 Node 版本
├── .markdownlint.json               # v6 新增：能力 .md body 的 lint 规则
├── install.sh                       # POSIX sh 安装器（Git Bash 兼容）——唯一允许的非 JS 例外
├── install.mjs                      # Node 版安装器
├── registry.yaml                    # 通用能力正式区清单（唯一事实源）
├── registry-brands.yaml             # 品牌定制能力清单（按品牌分段，需 --brand 可见）
├── schema/
│   ├── capability.schema.json
│   ├── workflow.schema.json
│   ├── bundle.schema.json
│   ├── pack.schema.json
│   ├── brand.schema.json
│   └── upstream-ref.schema.json
├── templates/                       # v6 新增：官方唯一合法能力骨架模板
│   ├── agent/                        # agent 骨架（capability.yaml + source.md + tests/ + CHANGELOG.md）
│   ├── skill/                        # skill 骨架（SKILL.md + tests/ + CHANGELOG.md）
│   ├── mcp/                          # mcp 骨架（mcp.yaml + source.md + tests/ + CHANGELOG.md）
│   ├── workflow/                     # workflow 骨架
│   ├── bundle/                       # bundle 骨架
│   └── brand-draft/                  # 品牌定制草稿骨架（多 customer 字段）
├── adapters/
│   ├── claude-code/
│   │   ├── adapter.mjs
│   │   └── mcp-config.template.json
│   ├── cursor/
│   ├── codex/
│   └── cline/
├── packs/                           # 通用能力（自研 + 收录）
│   ├── _drafts/                     # 草稿区：零门槛
│   │   └── <contributor-slug>/
│   ├── _staged/                     # 审核区
│   │   └── <contributor-slug>/
│   ├── <contributor-slug>/          # 正式区：自研能力
│   │   ├── pack.yaml
│   │   ├── agents/
│   │   ├── skills/
│   │   ├── mcps/
│   │   └── workflows/
│   └── _third-party/                # 收录区：GitHub 已有能力的二次封装
│       └── <upstream-name>/
│           ├── upstream.ref.yaml
│           ├── wrapping.yaml
│           └── source.md
├── customers/                      # 品牌定制能力（极简，不绑合同）
│   └── <brand-slug>/
│       ├── brand.yaml
│       └── packs/
│           ├── _drafts/
│           ├── _staged/
│           └── <brand-slug>/
│               ├── pack.yaml
│               ├── agents/
│               ├── skills/
│               ├── mcps/
│               └── workflows/
├── workflows/                       # 跨 pack 的通用 workflow
├── bundles/                         # 跨 pack 的通用 bundle
├── tools/
│   ├── validate.mjs                 # 本地一行自检 + CI 校验（含品牌隔离守卫 + v6 骨架守卫）
│   ├── lint.mjs                     # 密钥/硬编码扫描
│   ├── test-runner.mjs              # 跑回归样例（Node 内置 node:test）
│   ├── release.mjs                  # staged → released，更新 registry / registry-brands
│   ├── security-scan.mjs            # v5 安全审核
│   ├── upstream-bump.mjs            # 第三方收录的版本追踪
│   ├── workflow-compile.mjs         # workflow 编译器
│   └── new-capability.mjs           # v6 新增：脚手架命令，唯一合法的"新建能力"入口
├── ci/
│   └── github-actions/
│       ├── validate.yml
│       ├── test.yml
│       ├── release.yml
│       └── guardrails.yml           # v6 新增：骨架/依赖/布局守卫专档
└── docs/
    ├── contributing.md
    ├── authoring-guide.md           # v6 重写：面向无开发背景业务人员的填空式指南
    ├── vibe-coding-playbook.md      # v6 新增：业务人员 vibe coding 操作手册
    ├── intake-guide.md
    ├── brand-guide.md
    ├── packaging-guide.md
    ├── platform-matrix.md
    └── engineering-baseline.md      # v6 新增：工程基线一页纸（技术栈/命名/骨架速查）
```

设计要点（v6 补充）：

- `templates/` 是业务作者**唯一合法起点**：`tools/new-capability.mjs` 是新建能力的唯一入口，它从 `templates/` 拷贝骨架到 `_drafts/`，禁止手建目录。
- `AGENTS.md` + `CLAUDE.md` 让任何 AI 编码代理在动手前先读到工程纪律，使 AI 成为纪律执行者。
- `package.json` 锁定受控依赖清单（ajv、js-yaml、semver 等少数几个），业务作者无权新增 dependency——CI 守卫 `package.json` diff。
- 业务作者可写的文件类型**只有** `.md` / `.yaml` / `.json`；`.mjs`/`.js`/`.sh` 一律 steering 专属，CI 守卫。

---

## 5. capability 元数据（v4：加回轻量 customer 标记）

在 v3 基础上只增加一个可选字段 `customer`，标识品牌归属。无 distribution、无合同字段。v6 不改字段集，但强约束：业务作者只能通过 `templates/` 骨架填写，不得自创字段；schema 对未知字段 `additionalProperties: false` 严格拒绝。

### 5.1 通用能力（不填 customer）

```yaml
id: marketing-team.copywriter        # = <pack>.<name>
version: 1.3.0                        # 强制语义版本
kind: agent                          # agent | skill | mcp | workflow | bundle
pack: marketing-team                 # 命名空间 = 贡献者 slug
owner: marketing-team
display_name: Copywriter Agent
display_name_zh: 文案生成助手
display_name_en: Copywriter Agent
description: ...
platforms: [claude-code, cursor, codex, cline]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
depends_on:
  - marketing-team.tone-ll@>=1.0     # 版本范围约束
source:
  origin: original                   # original | forked
  upstream_ref: null
```

### 5.2 品牌定制能力（填 customer）

```yaml
id: acme-corp.campaign-bot           # pack id = <brand-slug>.<name>
version: 1.0.0
kind: agent
pack: acme-corp                      # 命名空间 = 品牌 slug
owner: opsforge-team                 # 实际开发方（团队内部记录）
customer: acme-corp                  # 品牌归属标记（极简，仅此一字段）
display_name: Acme Campaign Bot
display_name_zh: Acme 活动机器人
display_name_en: Acme Campaign Bot
description: ...
platforms: [claude-code, cursor]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
depends_on:
  - marketing-team.copywriter@>=1.3
  - third-party.data-tool@>=1.0
source:
  origin: original
  upstream_ref: null
```

### 5.3 品牌元数据（brand.yaml，极简）

```yaml
brand_slug: acme-corp
display_name: Acme Corp
display_name_zh: Acme 集团
created_at: 2026-07-21
contact: ops+acme@opsforge.com
notes: ""
```

无合同编号、无维护期、无 SLA、无交付批次——这些都不进仓库。

### 5.4 收录能力（source.origin: forked）

```yaml
id: third-party.awesome-agent-x
version: 1.0.0
kind: agent
pack: third-party
owner: opsforge-intake
display_name: Awesome Agent X
display_name_zh: Awesome Agent X
display_name_en: Awesome Agent X
platforms: [claude-code, cursor]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
source:
  origin: forked
  upstream_ref: upstream.ref.yaml
```

`upstream.ref.yaml` 与 v3 一致。v6 补充：收录能力的 `wrapping.yaml` 必须显式记录"为达到 OpsForge 工程基线做了哪些规范化改动"（与 §A.3 三方与自研同标准呼应）。

---

## 6. 跨平台适配层

### 6.1 平台约定矩阵

| 平台 | agents 路径 | rules 路径 | skills 路径 | commands 路径 | MCP 配置 |
|------|-------------|-----------|------------|--------------|---------|
| Claude Code | `~/.claude/agents/*.md` | `~/.claude/rules/` | `~/.claude/skills/` | `~/.claude/commands/` | `~/.claude.json` |
| Cursor | `.cursor/rules/*.mdc` | 同左 | 复用 rules | — | `.cursor/mcp.json` |
| Codex | `~/.codex/agents/` | `~/.codex/rules/` | 复用 | `~/.codex/commands/` | `~/.codex/config.toml` |
| Cline | `.cline/rules` | 同左 | 复用 | `.cline/commands` | `.cline/mcp_settings.json` |

### 6.2 Adapter 契约

```ts
interface Adapter {
  platform: string;
  conform(cap: CapabilitySource): ConformResult;   // §A.2 语义层
  translate(cap: CapabilitySource): PlatformArtifact[];
  install(artifacts: PlatformArtifact[], opts: InstallOpts): Manifest;
  injectMcp(mcp: McpSpec, opts: InstallOpts): void;
  uninstall(capId: string, opts: InstallOpts): void;
  detect(): boolean;
}
```

通用能力与品牌定制能力走同一套 adapter——adapter 不感知 `customer` 字段，只负责平台翻译。**adapter 源码（`adapters/*/adapter.mjs`）属 steering 维护范围，业务作者禁碰**（CI 守卫路径，见 §C.4）。

### 6.3 安装清单（Manifest）

每次安装后写 `.opsforge-manifest.json`，记录 id + version + source commit + 安装时间 + 平台 + `customer`（如有）+ `security_policy`（§B.2）。品牌定制能力在 manifest 里带 customer 标记，便于 `doctor` 与卸载时识别归属。

---

## 7. Workflow 设计

### 7.1 定义格式

```yaml
id: marketing-team.campaign-retrospect
version: 2.1.0
display_name: 活动复盘全自动工作流
params_schema: params.schema.json
steps:
  - id: pull_data
    capability: data-team.bi-query@>=1.2
    inputs: { sql: "{{params.campaign_sql}}" }
    outputs: [raw_metrics]
  - id: analyze
    capability: data-team.anomaly-finder@>=1.0
    inputs: { metrics: "{{steps.pull_data.raw_metrics}}" }
    outputs: [anomalies]
  - id: rewrite
    capability: marketing-team.copywriter@>=1.3
    inputs: { brief: "{{steps.analyze.anomalies}}", tone: "{{params.tone}}" }
    outputs: [copy]
  - id: render
    capability: common.report-renderer@>=2.0
    inputs: { sections: [copy, anomalies] }
    outputs: [report_path]
outputs:
  report: "{{steps.render.report_path}}"
```

品牌定制 workflow 同构，只是 `id` 带品牌前缀、可选 `customer` 字段、`steps.capability` 可引用通用能力。**业务作者写 workflow 即在 `templates/workflow/` 骨架里填 steps**，不得自创字段（schema `additionalProperties: false`）。

### 7.2 编排引擎

三种执行模式：

1. Cursor / Cline 模式：展开为规则链 + commands。
2. Claude Code 模式：生成编排型 agent，body 里串接调用其它 agent/skill/MCP。
3. Codex / 远程模式：生成 CLI 脚本按 DAG 调用 MCP server，适合后台批跑。

引擎核心 `tools/workflow-compile.mjs`：把 `workflow.yaml` 编译为各平台目标产物，参数通过环境变量或 `.opsforge-params.yaml` 注入。**编译器属 steering 维护，业务作者只填 `workflow.yaml`**。

### 7.3 参数化与复用

- `params.schema.json` 声明参数类型、默认值、约束。
- 同一 workflow 可保存多套 `params.yaml` 预设。
- 输出可挂载到团队知识库（通过 MCP），形成"用了就沉淀"的闭环。

---

## 8. 安装器与使用（v4：补 --brand 支持）

### 8.1 一行安装

```bash
./install.sh --install marketing-team.copywriter@1.3.0
./install.sh --platform cursor --install marketing-team.copywriter
./install.sh --platform claude-code --pack marketing-team
./install.sh --platform cline --bundle growth-starter
./install.sh --platform claude-code --brand acme-corp --pack acme-corp
./install.sh --platform claude-code --brand acme-corp --install acme-corp.campaign-bot@1.0.0
./install.sh --install marketing-team.copywriter@1.2.0
```

安装器行为：探测/读取 `--platform` → 取 registry 段（带 `--brand` 取品牌段）→ 解析能力源（含 `depends_on` 递归）→ adapter `translate()` → 幂等写入 → 注入 MCP 配置 → 更新 manifest（带 customer 标记）。

### 8.2 安装后在 Agent 平台里怎么用

adapter 在安装时同步生成调用入口：Claude Code `/agent <name>` 或 `@<name>`；Cursor `.cursor/rules/*.mdc` + commands；Codex agents/rules + CLI 触发；Cline rules + commands。品牌定制能力的 `name` 用 pack id 的后缀（如 `campaign-bot`），不带品牌前缀，但 manifest 与平台规则文件内会标注 `customer`。

### 8.3 升级、卸载、体检

```bash
./install.sh --list
./install.sh --list --brand acme-corp
./install.sh --upgrade marketing-team.copywriter
./install.sh --brand acme-corp --upgrade acme-corp.campaign-bot
./install.sh --uninstall marketing-team.copywriter
./install.sh --doctor
./install.sh --doctor --brand acme-corp
```

`doctor` 检查项：manifest 与实际文件一致性、`depends_on` 是否满足、MCP 配置是否完整、平台约定路径是否可写、是否版本落后、品牌定制能力是否仍在其归属品牌目录可见。

### 8.4 Windows Git Bash 兼容

- `install.sh` 用 POSIX sh，避免 bashism；路径用 `/` 风格，Git Bash 下直接可跑。**这是全项目唯一允许的非 JavaScript 例外**（§C.1 说明原因）。
- Node 版 `install.mjs` 跨平台，处理 `~` 展开、符号链接、行尾。
- 目标目录探测兼容 Windows 的 `%USERPROFILE%` 与 `%APPDATA%`。
- CI 在 Windows runner 上跑 `install.sh` 验证 Git Bash 兼容。

---

## 9. MCP 的分发与配置注入

### 9.1 三种 MCP 形态

1. **声明式 MCP**：只提供 `mcp.yaml`，描述远端 server URL + 鉴权，安装器只注入配置。
2. **打包式 MCP**：`mcps/<name>/server/` 含可执行实现，安装时拷贝二进制 + 注入配置。
3. **引用式 MCP**：`upstream.ref.yaml` 指向 GitHub 既有 MCP，二次封装只覆盖 `config.template`。

### 9.2 配置注入策略

每个平台 adapter 实现 `injectMcp`：Claude Code 写 `~/.claude.json` 的 `mcpServers`；Cursor 写 `~/.cursor/mcp.json`；Codex 写 `~/.codex/config.toml`；Cline 写 `.cline/mcp_settings.json`。安装器做幂等合并，manifest 记录注入键便于卸载。品牌定制 MCP 的配置注入与通用 MCP 完全一致，仅 manifest 标记 customer。

### 9.3 鉴权与密钥

仓库只存 `auth_schema`（声明需要哪些字段），密钥不入仓；安装时读环境变量或交互填充，写入用户本地配置。`tools/lint.mjs` 在 CI 阶段扫描硬编码密钥，命中即阻断。品牌定制 MCP 的品牌方鉴权凭证不入仓，随交付物离线传递（业务层动作，不进仓库）。

---

## 10. 商业化方向（v4 极简）

本版不展开任何商业化机制。仅保留方向性陈述：未来，仓库中沉淀成熟、通用的运营能力，会随公司 Agent 平台出货——客户买平台即得这批能力，作为平台产品力的一部分。品牌定制能力作为给品牌方的项目交付物存在于仓库的 `customers/<brand-slug>/` 目录中，技术层只负责隔离存放与命名空间管理，不涉及合同/license/维护合同机制。当前阶段，仓库聚焦"能力规范化、可贡献、可安装、可复用、品牌隔离不串台、**工程基线统一可控（v6）**"。

---

## 11. 多人 vibe coding 贡献

> v6 重写：本节面向**无开发背景的业务运营人员**，他们通过 AI 编码代理（Claude Code / Cursor 等）用自然语言驱动生成能力。流程把所有工程决策从作者手里收走，只留"表达业务逻辑"这一件事给作者。

### 11.1 贡献门槛：低到"复制模板 + 填业务逻辑"

业务人员不"从零写文件"。唯一入口是脚手架命令：

```bash
node tools/new-capability.mjs --kind skill --slug my-slug --name first-skill
node tools/new-capability.mjs --kind agent --brand acme-corp --name campaign-bot
```

`new-capability.mjs` 从 `templates/<kind>/` 拷贝法定骨架到 `packs/_drafts/<slug>/<name>/`（或品牌区），并预填 frontmatter 的工程字段（`id`/`version: 0.1.0`/`kind`/`pack`/`platforms`），业务作者**只填** `display_name_zh`/`display_name_en`/`description` 与 `source.md`/`SKILL.md` 的业务逻辑正文。最简 skill 骨架长这样：

```markdown
---
id: my-slug.first-skill              # 脚手架预填，勿改
version: 0.1.0                       # 脚手架预填，勿改
kind: skill                         # 脚手架预填
pack: my-slug                       # 脚手架预填
owner: my-slug                      # 脚手架预填
display_name: __FILL_ME__           # 业务作者填
display_name_zh: __FILL_ME__        # 业务作者填（中文展示名）
display_name_en: __FILL_ME__        # 业务作者填（英文展示名）
description: __FILL_ME__           # 业务作者填（一句话，用于检索激活）
platforms: [claude-code]            # 脚手架预填默认值，业务作者可缩窄但不得扩到未审批平台
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
---

<!-- 业务作者在此写业务逻辑正文。不要新增 frontmatter 字段，不要改文件名，不要在骨架外造文件。 -->
你是一个运营数据总结助手。当用户给你一段活动数据时，
请用一句话总结最重要的趋势和异常。
```

品牌定制草稿由脚手架自动多加 `customer: <brand-slug>` 并放进 `customers/<brand-slug>/packs/_drafts/<brand-slug>/`。业务作者无需理解目录规则——脚手架已安置好。

### 11.2 三态流转（v6 语义升级）

```
packs/_drafts/    ──(PR + 基础 CI)──►   packs/_staged/   ──(人审 + 完整 CI)──►   packs/<contributor-slug>/   ──(release.mjs)──►   registry.yaml
customers/<brand>/packs/_drafts/ ──► customers/<brand>/packs/_staged/ ──► customers/<brand>/packs/<brand>/ ──► registry-brands.yaml
   零门槛（只校验 id 唯一+可解析+中英名+customer 一致）        打磨中（叠加 schema+命名+骨架+测试门禁）          正式区（叠加全量安全+平台 matrix）        唯一事实源
```

v6 把三态重新定位为"**逐态叠加工程纪律以补偿作者缺乏工程判断的过程门禁**"：

- **草稿区 `_drafts/`**：零工程门槛，只校验 id 唯一 + YAML 可解析 + display_name 中英齐全 + `__FILL_ME__` 占位已被替换 + （品牌区）customer 字段与目录一致。业务作者可随意 vibe code，AI 代理可随意改写正文。**此态允许工程纪律缺失**，因为还没承诺质量。
- **审核区 `_staged/`**：过基础 CI——schema 合规（`additionalProperties: false` 拒绝自创字段）、命名空间无冲突、**骨架守卫**（文件集合与 `templates/` 一致，无骨架外文件）、品牌隔离守卫、无硬编码密钥、占位符已清空。补 `tests/`（≥3 条回归）+ `CHANGELOG.md` + `depends_on`。**此态由 CI 替作者补上"开发者本应凭直觉保证的结构性纪律"**。
- **正式区 `<slug>/`**：过完整 CI——含 §A 规范符合性、§B 全量安全门禁、回归样例全过、平台 matrix 验证。`release.mjs` 登记 registry。**此态由 CI 替作者补上"语义合规、安全、跨平台一致性"纪律**。
- **收录区 `_third-party/`**：仅在通用区，走 §12 收录流程，同样过 §A/§B，无规范豁免。

### 11.3 命名空间：贡献者 slug 与品牌 slug，先到先得 + 轻量审批

- 通用 pack id = 贡献者 slug（个人 GitHub username 或团队名），先到先得 + steering 审批。
- 品牌 pack id = `<brand-slug>.<name>`，品牌 slug 来自 `customers/<brand-slug>/brand.yaml`，需先建品牌目录再投能力。
- 品牌 slug 与贡献者 slug 共享同一命名空间池，禁止重名（CI 守卫）。
- 一旦批准，该 slug 永久归属。**slug 命名规则由 CI 强制**（§C.4：`^[a-z][a-z0-9-]{2,30}$`，全小写、连字符分隔、3–31 字符），业务作者无需"凭直觉命名"。

### 11.4 本地一行自检

```bash
node tools/validate.mjs packs/_drafts/my-slug/first-skill/
node tools/validate.mjs customers/acme-corp/packs/_drafts/acme-corp/campaign-bot/
# v6 新增：一键全量自检（业务作者最常用）
node tools/validate.mjs --all
```

输出：schema 合规、命名空间冲突、必填字段、骨架守卫（文件集合一致性）、占位符清空、密钥扫描、回归样例数量、品牌隔离守卫。**任一 fail 即退出码非 0**，业务作者在提 PR 前必跑（AI 编码代理在 PR 前也会被 `AGENTS.md` 指示跑此命令）。

### 11.5 贡献流程（端到端，v6 重写为业务人员轨道）

1. **不要 fork、不要手建目录**。在仓库本地（或你的 fork）运行 `node tools/new-capability.mjs --kind <kind> --slug <slug> --name <name>`（品牌能力加 `--brand <brand-slug>`）。脚手架从 `templates/` 拷贝法定骨架，预填工程字段。
2. 打开 AI 编码代理（Claude Code / Cursor 等）。`AGENTS.md`/`CLAUDE.md` 会自动让代理遵守 OpsForge 工程纪律。用自然语言向代理描述你要的业务逻辑，让代理只填 `display_name*`/`description`/`source.md`/`SKILL.md` 正文与 `tests/` 用例。
3. 本地跑 `node tools/validate.mjs <path>` 自检，按报错修复（通常报错会精确指到哪条规则、哪个文件）。
4. 提 PR，标题用脚手架生成的格式 `[draft] <slug>.<name>` 或 `[draft-brand] <brand>.<name>`（脚手架会打印好命令）。CI 跑草稿区校验。
5. 合并到 `_drafts/`。
6. 打磨：补 `tests/`（≥3 条）、`CHANGELOG.md`、`depends_on`。把目录从 `_drafts/` 移到 `_staged/`（脚手架提供 `node tools/new-capability.mjs --promote <path>` 子命令，禁止手移）。提 `[stage]` / `[stage-brand]` PR。
7. Steering 人审（只审业务逻辑是否合理、是否值得收录）+ 完整 CI（§A + §B + 骨架 + 测试 + matrix）。通过后目录移到 `packs/<slug>/` 或品牌正式区，提 `[release]` / `[release-brand]` PR。
8. 合并后 `release.mjs` 自动更新对应 registry，打 tag，能力对安装器可见。

### 11.6 收录第三方能力

详见 §12。v6 补充：收录也走 `tools/new-capability.mjs --kind <kind> --third-party <upstream>` 入口，脚手架从 `templates/` 拷贝骨架并预置 `source.origin: forked`，业务作者只填 `wrapping.yaml` 的"规范化改动说明"。

---

## 12. 开源收录

### 12.1 收录标准流程

1. 选目标：GitHub 上已有的 agent/skill/mcp，LICENSE 必须兼容。
2. 在 `packs/_third-party/<upstream-name>/` 建目录（经 `tools/new-capability.mjs --third-party` 入口）。
3. 写 `upstream.ref.yaml`：`repo`、`commit`、`license`、`intaked_at`、`intaked_by`。
4. 拷贝上游 LICENSE 副本为 `LICENSE.upstream`。
5. 写 `wrapping.yaml`：说明二次封装做了哪些改动（v6：必须含"为达到 OpsForge 工程基线做了哪些规范化改动"一节）。
6. 写 `capability.yaml` + `source.md`：`source.origin: forked`，`source.upstream_ref` 指向 `upstream.ref.yaml`。
7. 本地 `node tools/validate.mjs` 自检，提 PR，CI 跑收录校验。

收录只发生在通用区 `packs/_third-party/`，品牌定制区不设收录子区（品牌定制需要 fork 上游时，仍放在 `customers/<brand>/packs/<brand>/` 下，但 `source.origin: forked` + `source.upstream_ref` 指向该能力目录内的 `upstream.ref.yaml`）。

### 12.2 LICENSE 兼容性

- 优先收录：MIT / Apache-2.0 / ISC / BSD-2/3-Clause。
- 条件收录：MPL-2.0（需文件级隔离）。
- 拒绝收录：GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA/无 LICENSE 的仓库。
- CI 校验 `upstream.ref.yaml.license` 字段，不兼容直接 block。

### 12.3 跟版本（pin 上游 commit，定期 bump）

- `upstream.ref.yaml.commit` 锁定上游 commit hash。
- `tools/upstream-bump.mjs` 定期跑：拉上游新 commit，对比 diff，自动生成 PR 草稿，人工确认后合并。
- bump 时同步更新 `LICENSE.upstream` 与 `wrapping.yaml`。
- OpsForge 内 `version` 独立于上游 tag。

### 12.4 收录区与自研区隔离

- 物理隔离：`_third-party/` 与贡献者 pack 平级但独立目录。
- 命名空间隔离：收录能力 pack id 一律 `third-party.<upstream-name>`。
- 依赖隔离：自研与品牌定制均可 `depends_on` 收录能力；收录能力不得 `depends_on` 自研或品牌定制能力。

---

## 13. 版本管理

### 13.1 强制语义版本

所有 capability / workflow / bundle 必须 `version: MAJOR.MINOR.PATCH`。CI 校验合法 semver。通用与品牌定制一视同仁。**v6：版本号策略由 steering 拥有（§C.6），业务作者只填 `0.1.0` 起步；后续 bump 由 `tools/release.mjs` 按变更类型自动建议，作者不得随意改版本号**。

### 13.2 registry 记录 current + history

```yaml
# registry.yaml（通用）
capabilities:
  marketing-team.copywriter:
    current: 1.3.0
    history:
      - { version: 1.3.0, released_at: 2026-07-21, commit: a1b2c3 }
      - { version: 1.2.0, released_at: 2026-05-10, commit: d4e5f6 }
    changelog_index: packs/marketing-team/agents/copywriter/CHANGELOG.md
```

```yaml
# registry-brands.yaml（按品牌分段）
brands:
  acme-corp:
    capabilities:
      acme-corp.campaign-bot:
        current: 1.0.0
        history:
          - { version: 1.0.0, released_at: 2026-07-21, commit: a1b2c3 }
        changelog_index: customers/acme-corp/packs/acme-corp/agents/campaign-bot/CHANGELOG.md
```

两份 registry 均由 `tools/release.mjs` 自动聚合，禁止手改。

### 13.3 破坏性变更规则

- 不兼容变更必须 bump MAJOR。
- CHANGELOG 必须标注 `BREAKING` + migration 指南。
- PR 标题带 `[breaking]` 前缀，steering 强制复审。

### 13.4 depends_on 版本范围与方向约束

- 用 semver range：`>=1.0`、`>=1.0 <2.0`、`~1.2`。
- **方向约束**：
  - 通用能力可 `depends_on` 通用能力 + 收录能力。
  - 品牌定制能力可 `depends_on` 通用能力 + 收录能力 + 同品牌内的其它品牌定制能力。
  - 品牌定制能力**不得** `depends_on` 其它品牌的定制能力（品牌隔离）。
  - 收录能力不得 `depends_on` 自研或品牌定制能力。
- CI 解析依赖图，循环与跨品牌依赖直接 block 并给出冲突路径。

### 13.5 安装器版本行为

- 默认装 registry 的 `current`。
- 支持 `@<version>` pin。
- `--upgrade` 单独升级，按 range 检查依赖兼容性。
- `--upgrade --all` 全量升级，遇 breaking 给提示并要求 `--confirm`。
- 品牌定制能力升级需带 `--brand`。

---

## A. 能力规范审核机制（v5）

> v6 定位：§A 是工程基线层的**语义合规执行骨干**。业务作者缺乏"这条 agent body 在 Cursor 下能不能跑"的判断力，§A.2 的 `conform()` 静态检查替作者做这个判断。

### A.1 三类能力的规范基线

| 能力 kind | 规范来源 | 必须校验的规范点 |
|-----------|----------|------------------|
| **agent** | Claude Code / Codex / Cursor / Cline 各平台的 agent 约定 | frontmatter 合法、`name` 与 `pack.id` 后缀一致、`description` 非空且中英齐全、`tools` 声明在平台支持集合内、body 无平台不支持的语法、entrypoint 文件存在 |
| **skill** | 平台 skill 约定（`SKILL.md` 结构 + `frontmatter`） | frontmatter 合法、`name` 唯一、`description` 一句话可被检索激活、触发词/语义清晰、不引用平台未声明的能力、辅助文件路径在能力目录内 |
| **mcp** | MCP server 契约（tools/resources/prompts 声明） | `mcp.yaml` 的 `transport`（stdio/sse/http）合法、`config.template` 仅声明 `auth_schema` 不含密钥、工具声明有 `name`+`description`+`inputSchema`(JSON Schema)、无未声明的远程拉取动作 |

### A.2 规范审核三层校验

审核发生在 `_drafts` → `_staged` 迁移与 `_staged` → 正式区迁移两个门禁：

1. **结构层（syntax/schema）**：`capability.yaml` / `workflow.yaml` / `bundle.yaml` / `mcp.yaml` / `SKILL.md` frontmatter 通过对应 `schema/*.schema.json`，`additionalProperties: false`。任何来源都必须过。
2. **语义层（platform conformance）**：`tools/validate.mjs` 调各平台 adapter 的 `conform(cap)` 静态检查——验证能力声明（`platforms`、`tools`、`entrypoint`、引用的其它能力）在所声明支持的平台下都是合法可装配的。声明支持某平台就必须在该平台通过 conformance，否则从 `platforms` 删该平台。
3. **来源层（origin provenance）**：
   - `original`：校验 `source.upstream_ref == null`，且不存在残留的他人版权/License 文本。
   - `forked`：校验 `source.upstream_ref` 指向的 `upstream.ref.yaml` 完整、`LICENSE.upstream` 存在、`wrapping.yaml` 说明改动、上游 commit 可追溯（§12）。
   - 品牌定制：在以上基础上叠加 brand 隔离守卫（§14）。

### A.3 三方与自研同标准原则

- 收录区 `packs/_third-party/` 的能力**不得享受规范豁免**：必须和自研能力一样过 schema + platform conformance + 回归样例（≥3 条）。
- 收录时若上游原实现不符合本仓库规范，必须在 `wrapping.yaml` 记录"二次封装做了哪些规范化改动"（v6：含"为达到工程基线做的改动"一节），并由 intake 人负责补齐到合规；补不齐则拒绝收录。
- 品牌定制能力若 fork 上游，同样适用本原则。

### A.4 规范审核产物

`tools/validate.mjs` 对每个能力输出 `validation-report.json`（不入仓，CI artifact）：

```json
{
  "id": "marketing-team.copywriter",
  "origin": "original",
  "checks": {
    "schema": "pass",
    "skeleton_guard": "pass",
    "placeholder_clean": "pass",
    "platform_conformance": { "claude-code": "pass", "cursor": "pass" },
    "origin_provenance": "pass",
    "brand_isolation": "n/a",
    "regression_cases": { "total": 5, "passed": 5 }
  },
  "verdict": "pass"
}
```

任一 check 为 `fail` 即 `verdict: fail`，CI block 该能力进 staged / 正式区。v6 新增 `skeleton_guard` 与 `placeholder_clean` 两个 check（见 §C.4）。

---

## B. 安全审核机制（v5）

> v6 定位：§B 是工程基线层的**安全纪律执行骨干**。业务作者缺乏"这段 prompt 会不会被注入""这个 MCP 会不会 SSRF"的判断力，§B.1 的 CI 扫描替作者兜底。

### B.1 入库前安全门禁（CI，`tools/security-scan.mjs`）

对 `_staged` → 正式区的迁移强制执行以下扫描，任一命中即 block（除非 steering 显式加 `security-exception` 标签并附理由）：

- **硬编码密钥/凭证**：API key、token、私钥、连接串（沿用 `tools/lint.mjs`，扩展正则集，含 `AKIA*`、`ghp_*`、`sk-`、`-----BEGIN ... PRIVATE KEY-----` 等）。
- **Prompt 注入与越权指令**：扫描 `source.md` / `SKILL.md` / agent body 中的"忽略以上指令""以管理员身份""删除所有""覆盖系统提示"等高危指令模式；含此类模式需 steering 复审。
- **越权工具声明**：agent/skill 声明的 `tools` 中出现高危组合（如同时 `Bash` + 写 `~/.ssh/`、`WebFetch` 指向内网段、shell 注入面），触发告警，要求显式 `allow_dangerous: true` 且 steering 审批。
- **SSRF 面**：`mcp.yaml` / 能力 body 中的远程 URL 若指向私网/元数据地址（`169.254.169.254`、`127.0.0.0/8`、`10/8`、`192.168/16`、`*.internal`），block。
- **供应链投毒**：收录能力必须校验 `upstream.ref.yaml.commit` 与上游一致；`wrapping.yaml` 不得引入与上游无关的可执行脚本/二进制；`mcps/<name>/server/` 下的二进制要求有 `provenance` 声明。
- **MCP 工具面攻击**：MCP 工具的 `inputSchema` 不得允许任意 shell/路径注入；声明 `resources` 的 MCP 不得默认开放 `file://` 全盘读；`prompts` 不得把用户输入原样拼进系统提示。
- **依赖图安全**：`depends_on` 解析出的能力闭包，若包含任何已标记 `security-advisory` 的版本，block 并提示可用版本范围。

### B.2 运行时安全约束（adapter 安装期）

安装器与 adapter 在装配到目标平台时注入最小权限约束，能力作者无法绕过：

- **MCP 配置注入走 sandbox**：`injectMcp` 默认为 MCP server 配置 `env` 白名单（只注入 `auth_schema` 声明的环境变量名），禁止能力索取未声明的环境变量；密钥来自用户本地交互/环境变量，不入仓、不进 manifest 明文。
- **工具降权**：adapter 翻译 agent 时，对声明了高危 `tools` 的能力，在平台层套最小权限。降权策略记录在 manifest 的 `security_policy` 字段。
- **网络出口约束**：声明式 MCP 的远端 URL 在 manifest 记录出口域名，`doctor` 体检时与 `auth_schema` 比对，发现能力运行期访问未声明域名即告警。
- **隔离写入路径**：品牌定制能力只允许写入 `customer` 归属相关路径；adapter 在安装期校验目标平台路径不越界到其它品牌的安装产物。

### B.3 安全审核产物与例外管理

`tools/security-scan.mjs` 输出 `security-report.json`（CI artifact）：

```json
{
  "id": "third-party.awesome-agent-x",
  "origin": "forked",
  "findings": [
    { "rule": "ssrf_internal_url", "severity": "high", "evidence": "mcp.yaml:url", "status": "block" }
  ],
  "verdict": "block",
  "exceptions": []
}
```

- `verdict: block` 不得进正式区。
- 需例外必须提 `[security-exception]` PR，steering 复审，例外条目记入 `security-report.json.exceptions`，并在 `registry*.yaml` 打 `security_exception: true` 标记。
- 命中"prompt 注入""供应链投毒""私网 SSRF"三类**不得例外**，必须修复。

### B.4 安全审核与三态流转的接入点

| 门禁 | 执行项 | 失败动作 |
|------|--------|----------|
| `_drafts` → `_staged` | 规范结构层 + 骨架守卫 + 占位符清空 + 硬编码密钥扫描（轻量） | 退回草稿，提示修复 |
| `_staged` → 正式区 | §A 全量规范审核 + §B.1 全量安全门禁 + 回归样例 | CI block，不得 release |
| `release.mjs` 登记 | 复核 `validation-report` + `security-report` 均 `pass` | 不登记进 registry |
| 安装器安装 | §B.2 运行时约束注入 + manifest 记录 `security_policy` | 约束注入失败则中止安装 |

---

## C. 工程基线与 vibe-coding 护栏（v6 新增）

> 目标：后续所有 skill/agent/mcp 的迭代由**无开发背景的业务运营人员**通过 vibe coding 完成。本节定义让"工程实施方式统一可控、符合最佳实践"的机制，使业务人员 vibe coding 时**只有业务逻辑可变**。§A 与 §B 是本节的执行骨干。

### C.1 固定技术栈与"一种语言"原则

全项目 pin 一套技术栈，业务作者不得引入新语言/框架/构建工具。CI 守卫。

| 层 | 选型 | 业务作者可碰? |
|----|------|---------------|
| 运行时 | **Node.js 22 LTS**（`.nvmrc` 锁定） | 否 |
| 语言 | **JavaScript（ESM）**，所有工具/adapter 用 `.mjs` | 否（业务作者不写 JS） |
| 包管理 | `npm`（`package.json` + `package-lock.json`，无 pnpm/yarn） | 否 |
| JSON Schema 校验 | **ajv**（`schema/*.schema.json` → ajv 实例，`additionalProperties: false`） | 否 |
| YAML 解析 | **js-yaml** | 否 |
| semver | **semver** 包 | 否 |
| 测试运行器 | **Node 内置 `node:test`**（不引入 jest/vitest，零依赖） | 否（业务作者只写 `tests/*.yaml` 用例，不写测试代码） |
| Markdown lint | **markdownlint**（`.markdownlint.json`） | 部分（业务作者写 .md body，lint 由 CI 跑） |
| 安装器（sh） | **POSIX sh**（`install.sh`，Git Bash 兼容） | 否 |
| 安装器（node） | `install.mjs` | 否 |
| CI | GitHub Actions（`ci/github-actions/*.yml`） | 否 |
| 能力源格式 | `.md` + YAML frontmatter + `.yaml` + `.json` | **是（业务作者唯一可碰的文件类型）** |

**"一种语言"原则**：仓库内所有可执行逻辑（installer、adapters、tools、workflow-compiler）一律 JavaScript/ESM。业务作者可写的文件类型**只有 `.md` / `.yaml` / `.json`**——这三类是声明式、无执行语义的，从根上杜绝业务作者引入"代码层面的工程偏差"。

**唯一例外：`install.sh` 用 POSIX sh**。原因：安装器需在用户机器上先于 Node 探测/引导，且要兼容 Windows Git Bash；POSIX sh 是最小公共 denominator。此例外仅限 `install.sh` 一个文件，由 steering 维护，CI 守卫除该文件外不得出现 `.sh`。

**依赖清单受控**：`package.json` 的 `dependencies`/`devDependencies` 由 steering 拥有。CI 在 PR 上 diff `package.json`，凡业务作者 PR 新增 dependency 一律 block（除非 PR 带有 `deps-change` 标签且 steering 审批）。业务作者既不需要、也不被允许引入新依赖——他们只写 `.md/.yaml/.json`。

> 待确认决策 D1：Node 版本 pin 在 **22 LTS**（2024-10 进入 LTS，2026 仍在活跃维护）。若公司基础镜像仍以 20 LTS 为准，可下调为 20 LTS，但需同步 `.nvmrc` 与 CI matrix。请 steering 确认。

### C.2 统一项目布局与"填空式"能力骨架

业务作者写一个新能力时，**没有"设计目录结构"这一步**。`tools/new-capability.mjs` 是新建能力的唯一入口，它从 `templates/<kind>/` 拷贝法定骨架。骨架即唯一合法形状，CI 校验能力目录的文件集合与 `templates/` 完全一致（多一个文件、少一个文件都 fail）。

**法定能力骨架（以 agent 为例）**：

```text
<slug>.<name>/
├── capability.yaml          # frontmatter，工程字段预填、业务字段待填
├── source.md                # agent body，业务逻辑正文（唯一自由发挥处）
├── tests/                   # 回归样例，≥3 条
│   ├── case-01.yaml         # 每条用例：input + expected（声明式，非代码）
│   ├── case-02.yaml
│   └── case-03.yaml
├── CHANGELOG.md             # 变更记录，骨架预填 Keep a Changelog 格式
└── README.md                # 可选：给使用者看的能力说明
```

**skill 骨架**：`SKILL.md`（frontmatter + body 合一）+ `tests/` + `CHANGELOG.md`。
**mcp 骨架**：`mcp.yaml` + `source.md` + `tests/` + `CHANGELOG.md`。
**workflow 骨架**：`workflow.yaml` + `params.schema.json` + `tests/` + `CHANGELOG.md`。
**bundle 骨架**：`bundle.yaml` + `CHANGELOG.md`。

**`capability.yaml` 骨架（agent，脚手架预填 + 业务作者填空）**：

```yaml
id: __SLUG__.__NAME__                 # 脚手架替换，勿改
version: 0.1.0                        # 脚手架预填，勿改
kind: agent                          # 脚手架预填
pack: __SLUG__                        # 脚手架预填
owner: __SLUG__                       # 脚手架预填
# customer: __BRAND_SLUG__           # 品牌能力时脚手架取消注释并填值
display_name: __FILL_ME__            # 业务作者填
display_name_zh: __FILL_ME__         # 业务作者填
display_name_en: __FILL_ME__         # 业务作者填
description: __FILL_ME__            # 业务作者填
platforms: [claude-code]             # 脚手架默认值，可缩窄
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []                       # 业务作者按需填，须可解析
source:
  origin: original                   # forked 时脚手架改为 forked 并补 upstream_ref
  upstream_ref: null
```

**"填空式"模型**：
- 工程字段（`id`/`version`/`kind`/`pack`/`owner`/`entrypoint`/`tests`/`changelog`/`source`）由脚手架预填，业务作者**勿改**（CI 校验值未变，变了 fail）。
- 业务字段（`display_name*`/`description`/`depends_on`/`source.md` 正文/`tests/*.yaml`）是业务作者的**唯一工作面**，以 `__FILL_ME__` 占位符标记待填，CI 校验占位符必须全部被替换。
- **业务作者不得新增 frontmatter 字段**：`additionalProperties: false` 严格 schema 拒绝任意自创字段。这把"我随手加个字段"的工程偏差从根上堵死。
- **业务作者不得新增骨架外文件**：CI 比对 `templates/<kind>/` 的文件清单，多/少即 fail。
- **业务作者不得改文件名**：脚手架生成的文件名是法定的。

> 待确认决策 D2：是否**禁止业务作者手写任何 `.mjs`/`.js`**？v6 默认**禁止**——业务作者只能写 `.md/.yaml/.json`，所有可执行逻辑由 steering 维护。这是最严格的护栏。请 steering 确认是否接受此强度（若某些高级业务作者需写 MCP server 实现，可走"准开发者"角色通道，由 steering 个案审批，CI 对 `.mjs` 文件要求 `code-owner` 评审）。

### C.3 非开发者开发流程

业务人员从"我想加一个能力"到"已发布"的端到端轨道（与 §11.5 呼应，此处聚焦过程门禁如何补偿作者缺乏工程判断）：

**Step 0 — 想法（业务）**：业务人员用自然语言写下"我要一个能把活动数据总结成一句话的 skill"。这是纯业务表达，无工程内容。

**Step 1 — 起骨架（脚手架替作者做工程决策）**：
```bash
node tools/new-capability.mjs --kind skill --slug my-slug --name activity-summary
```
脚手架替作者决定了：目录位置、文件集合、frontmatter 工程字段、版本号起点、`entrypoint`/`tests`/`changelog` 路径。作者**没有机会做错这些工程决策**，因为根本没有他决策的入口。

**Step 2 — vibe coding（AI 代理在护栏内生成业务逻辑）**：
打开 Claude Code / Cursor，`AGENTS.md`/`CLAUDE.md` 自动让 AI 代理读到 OpsForge 工程纪律（§C.5）。作者用自然语言对 AI 说"帮我写这个 skill 的正文，输入是活动数据 JSON，输出一句话总结"。AI 代理**只在 `SKILL.md` body 与 `tests/*.yaml` 里写**，不会造新文件、不会改 frontmatter 工程字段、不会加依赖——因为 `AGENTS.md` 明令禁止且 `validate.mjs` 会在 PR 前自检。

**Step 3 — 本地自检（CI 替作者补工程纪律）**：
```bash
node tools/validate.mjs packs/_drafts/my-slug/activity-summary/
```
此命令替作者校验：schema 合规、骨架一致、占位符清空、命名规范、密钥扫描、回归样例数量、品牌隔离（如适用）。**作者只需按报错修业务逻辑，不需"懂工程"**——报错精确指到哪条规则、哪个文件、哪一行。

**Step 4 — 草稿 PR（轻量门禁）**：提 `[draft]` PR，CI 跑草稿区校验（id 唯一 + 可解析 + 中英名 + 占位符清空 + customer 一致）。通过即进 `_drafts/`。

**Step 5 — 打磨（作者补业务内容，CI 补结构纪律）**：作者补 `tests/`（≥3 条）、`CHANGELOG.md`、`depends_on`。CI 在 promote 到 `_staged/` 时替作者校验：schema 严格、骨架一致、命名空间无冲突、无硬编码密钥。

**Step 6 — 审核区 PR（人审 + 全量 CI）**：提 `[stage]` PR。Steering 人审**只判业务逻辑合理性与收录价值**（这是机器判不了、需要人判断的）。CI 替作者判：§A 规范符合性、§B 安全门禁、回归样例全过、平台 matrix。**人审不审工程规范，工程规范全由 CI 兜**。

**Step 7 — 正式区 PR + release**：提 `[release]` PR，合并后 `release.mjs` 复核 `validation-report` + `security-report` 均 `pass`，登记 registry，打 tag。

**过程门禁如何补偿"作者缺乏工程判断"**：每个工程决策（目录结构、文件集合、命名、版本号、依赖、安全、平台一致性）都在某一道门禁由机器替作者做了。作者从头到尾只做两件事：**表达业务逻辑、写业务用例**。这就是 v6 的核心承诺。

### C.4 CI 机器强制规范（取代工程直觉的映射表）

下表把"一个开发者凭直觉就知道的工程规范"逐条映射到具体的 CI 规则。业务作者不需要知道这些规范，CI 替他守。

| 工程直觉（开发者本应凭常识保证） | CI 规则（机器强制） | 实现位置 |
|------------------------------------|----------------------|----------|
| 名字用小写连字符，别用中文/大写/下划线 | slug `^[a-z][a-z0-9-]{2,30}$`；能力 name 同规则；id = `<slug>.<name>` | `validate.mjs` naming 规则 |
| 别用鬼魅文件名 | 能力目录文件集合与 `templates/<kind>/` 严格一致（多/少即 fail） | `validate.mjs` skeleton_guard |
| 别随手加字段 | frontmatter schema `additionalProperties: false` | ajv + `schema/*.schema.json` |
| 别忘了填必填项 | schema `required` 列表 | ajv |
| 别留 TODO 占位符 | 全文扫 `__FILL_ME__`/`TODO`/`FIXME`，staged 区不得残留 | `validate.mjs` placeholder_clean |
| 中文名 + 英文名都要有 | `display_name_zh` 与 `display_name_en` 均非空 | schema required |
| 版本号要语义化 | `semver.valid(version)` 且 > 上一版本（除非 `[breaking]`） | `validate.mjs` semver 规则 |
| 别乱改版本号 | 草稿区 `version` 必须为 `0.1.0`；release 由 `release.mjs` 按变更类型 bump | `validate.mjs` + `release.mjs` |
| 别引入新依赖 | `package.json` diff 在业务 PR 上 block（除非 `deps-change` 标签 + steering 审批） | `ci/guardrails.yml` |
| 别在骨架外造文件 | 见 skeleton_guard | `validate.mjs` |
| 别写代码（你是业务人员） | 业务作者 PR 不得新增/修改 `.mjs`/`.js`/`.sh`/`adapters/`/`tools/`/`ci/`/`templates/`/`schema/`/`registry*.yaml` | `ci/guardrails.yml` path 守卫 + CODEOWNERS |
| 别硬编码密钥 | `lint.mjs` 正则扫描（AKIA/ghp_/sk-/PRIVATE KEY 等） | `lint.mjs` |
| 别写 prompt 注入 | `security-scan.mjs` 高危指令模式扫描 | `security-scan.mjs` |
| 别引用私网 URL | `security-scan.mjs` SSRF 规则 | `security-scan.mjs` |
| 至少写 3 个测试用例 | `tests/` 下 ≥3 条，`test-runner.mjs` 全过 | `test-runner.mjs` |
| 依赖别成环、别跨品牌 | `depends_on` 图解析，循环/跨品牌 block | `validate.mjs` 依赖图 |
| 声明支持某平台就要真能跑 | adapter `conform()` 在声明 platforms 上跑 | §A.2 |
| 改动要记 changelog | `CHANGELOG.md` 存在且含本次 version 条目 | `validate.mjs` |
| i18n：中英文展示名 | 见上 display_name_zh/en | schema |
| 别碰 steering 专属区 | CODEOWNERS + path 守卫 | `ci/guardrails.yml` |

> 待确认决策 D3：是否对所有业务作者 PR 强制 **CODEOWNERS** 评审 `adapters/`/`tools/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json`/`AGENTS.md`/`CLAUDE.md`？v6 默认**是**，这些路径只有 steering 可改。

### C.5 vibe coding 护栏（让 AI 编码代理成为纪律执行者）

业务人员的 AI 编码代理（Claude Code / Cursor / Codex / Cline）是实际"敲键盘"的角色。v6 不指望业务人员自己守纪律，而是**让 AI 代理守纪律**——通过仓库级指令文件 + 严格 `validate.mjs` + 模板锁定。

**机制 1：仓库级 AI 代理指令文件（`AGENTS.md` + `CLAUDE.md`）**。

仓库根提供 `AGENTS.md`（通用，所有 AI 代理读）与 `CLAUDE.md`（Claude Code 专属补充，指向 AGENTS.md）。这些文件用自然语言告诉任何 AI 编码代理："你在 OpsForge 仓库里工作，必须遵守以下纪律"。内容要点：

- 你只能修改业务作者能力目录内的 `.md`/`.yaml`/`.json` 文件。
- 不得新增 frontmatter 字段（schema 严格拒绝）。
- 不得新增骨架外文件（CI 拒绝）。
- 不得修改 `adapters/`/`tools/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json`。
- 不得引入新依赖。
- 提 PR 前必须运行 `node tools/validate.mjs <path>` 并确保通过。
- 写 `source.md`/`SKILL.md` 时不得包含"忽略以上指令""以管理员身份"等高危指令模式（§B.1 会 block）。
- 写 MCP 时 `inputSchema` 不得允许任意 shell/路径。
- 新建能力必须用 `node tools/new-capability.mjs`，不得手建目录。
- 命名 slug 必须全小写连字符，3–31 字符。

这样，AI 代理成为"懂工程纪律的那个角色"，业务人员只需用自然语言提业务需求。

**机制 2：模板即唯一合法起点**。`templates/` 是法定的；`tools/new-capability.mjs` 是唯一新建入口；手建目录即被 skeleton_guard 拒绝。

**机制 3：`tools/validate.mjs` fail-loud**。任何偏差——多一个文件、少一个文件、多一个字段、占位符未清、命名不规范、测试不够、密钥、注入、SSRF——一律非 0 退出 + 精确报错。AI 代理据此自纠，不需要业务人员理解报错。

**机制 4：禁止新增依赖/禁止骨架外新文件**。见 §C.4 表。

**机制 5：PR 前自检钩子**。`AGENTS.md` 指示 AI 代理在提 PR 前必跑 `validate.mjs`；`ci/guardrails.yml` 在 PR 上再跑一遍（不依赖作者自觉）。可选：配置 GitHub pre-commit hook（`.pre-commit-hooks.yaml`）在本地 `git commit` 时跑轻量校验。

**机制 6：AI 代理指令文件本身是 steering 专属资产**。`AGENTS.md`/`CLAUDE.md`/`templates/`/`schema/` 由 steering 维护，CODEOWNERS 保护，业务作者 PR 不得改。

> 待确认决策 D4：是否**随仓库 ship `AGENTS.md` + `CLAUDE.md`**？v6 默认**是**，且这是 v6 的核心机制之一。若 steering 担心指令文件被业务作者误改，CODEOWNERS + CI path 守卫已保护。请确认。

### C.6 被剥夺的工程决策清单

下表列出从业务作者手里**显式收走**的工程决策，以及谁拥有它。业务作者不需、也不被允许对这些做决策。

| 工程决策 | 拥有者 | 业务作者能否碰 |
|---------|--------|---------------|
| 技术栈/语言/运行时版本 | steering + §C.1 + CI | 否 |
| 依赖清单（`package.json`） | steering + CI `deps-change` 守卫 | 否 |
| 目录布局 | `templates/` + `new-capability.mjs` + skeleton_guard | 否（只能填槽位） |
| 文件集合 | `templates/` + skeleton_guard | 否 |
| frontmatter 字段集 | `schema/*.schema.json`（`additionalProperties: false`） | 否（不得加字段） |
| 版本号策略 | `release.mjs` + semver 规则；作者只起 `0.1.0` | 否 |
| 命名规则 | `validate.mjs` naming 正则 | 否（slug 规则强制） |
| 安全策略 | §B + steering；`security-exception` 须 steering 审批 | 否 |
| 平台目标 | `platforms` 字段可缩窄但不得扩到未审批平台；matrix CI 验证 | 部分（可缩窄，不可扩） |
| 测试最低数量 | `validate.mjs` ≥3 | 否（必须满足） |
| 工具/adapter 实现 | steering（`adapters/`） | 否 |
| schema 定义 | steering（`schema/`） | 否 |
| AI 代理指令 | steering（`AGENTS.md`/`CLAUDE.md`/`templates/`） | 否 |
| CI 配置 | steering（`ci/`） | 否 |
| registry 聚合 | `release.mjs` 自动，禁止手改 | 否 |
| 品牌隔离规则 | CI 守卫（§14） | 否 |
| 收录 LICENSE 兼容性 | steering + §12.2 白名单 | 否 |

**业务作者保留的决策（仅业务逻辑层面）**：
- 能力做什么（`source.md`/`SKILL.md` 正文）
- 中文名/英文名/一句话描述
- 依赖哪些已有能力（`depends_on`，须可解析、方向合规）
- 回归用例的输入与期望（`tests/*.yaml`）
- 是否缩小平台范围（`platforms` 子集）
- changelog 内容

这就是 v6 的边界：**业务逻辑归业务作者，工程实施归基线**。

### C.7 工程基线一页纸（给业务人员的速查）

`docs/engineering-baseline.md` 一页纸，业务人员 3 分钟读完：

- 你只写 `.md` / `.yaml` / `.json`，不写代码。
- 新建能力用 `node tools/new-capability.mjs`，不手建目录。
- 你只填 `__FILL_ME__` 标记的槽位和正文，不改工程字段、不加字段。
- 提 PR 前跑 `node tools/validate.mjs <path>`，按报错修。
- 中文名英文名都要，slug 全小写连字符，至少 3 个测试用例。
- 别写密钥、别写"忽略以上指令"、别引用内网地址。
- 别碰 `adapters/`/`tools/`/`schema/`/`templates/`/`ci/`/`package.json`/`registry*.yaml`。

---

## 14. 约束清单（CI 强制，v6 补工程基线项）

CI 在 PR 阶段对 staged → released 的迁移强制校验以下全部项，任一失败即 block：

- [ ] **schema 合规**：`capability.yaml` / `workflow.yaml` / `bundle.yaml` 通过对应 schema，`additionalProperties: false`。
- [ ] **命名空间无冲突**：`pack.id` 全局唯一（通用池 + 品牌池合并查重）。
- [ ] **命名规范（v6 新增）**：slug 与 name 均 `^[a-z][a-z0-9-]{2,30}$`；id = `<slug>.<name>`。
- [ ] **版本合法**：semver 格式正确，且大于上一版本（除非显式标 `breaking`）；草稿区必须为 `0.1.0`。
- [ ] **必填字段齐全**：id、version、kind、pack、owner、display_name（中英）、description、platforms、entrypoint、tests、changelog。
- [ ] **中英文 display_name**：`display_name_zh` 与 `display_name_en` 均存在。
- [ ] **骨架守卫（v6 新增）**：能力目录文件集合与 `templates/<kind>/` 严格一致，无骨架外文件、无缺失文件。
- [ ] **占位符清空（v6 新增）**：staged 区不得残留 `__FILL_ME__`/`TODO`/`FIXME`。
- [ ] **工程字段未篡改（v6 新增）**：脚手架预填的 `id`/`version`(草稿)/`kind`/`pack`/`entrypoint`/`tests`/`changelog` 值未被作者改动。
- [ ] **无硬编码密钥**：`tools/lint.mjs` 扫描通过。
- [ ] **回归样例不少于 3 条**：`tests/` 下至少 3 个用例，`tools/test-runner.mjs` 全过。
- [ ] **LICENSE 兼容**（收录区）：`upstream.ref.yaml.license` 在白名单内。
- [ ] **platforms 声明**：至少声明一个支持平台；不得扩到未审批平台。
- [ ] **平台 matrix 验证**：声明支持的平台在 CI 上跑安装+卸载验证。
- [ ] **依赖闭包**：`depends_on` 全部可解析，无循环依赖。
- [ ] **收录隔离**（收录区）：`source.origin: forked` + `upstream.ref.yaml` 完整 + `LICENSE.upstream` 存在 + `wrapping.yaml` 含"工程基线规范化改动"说明。
- [ ] **品牌隔离守卫**：
  - 若 `customer` 字段存在，则该能力物理路径必须在 `customers/<customer>/packs/...` 下。
  - `customer` 字段值必须与所在 `customers/<brand-slug>/` 目录一致。
  - `pack` 字段必须以 `<brand-slug>` 开头。
  - 该能力的 `depends_on` 不得引用其它品牌的定制能力。
- [ ] **草稿区放宽**：`_drafts/` 只校验 id 唯一 + YAML 可解析 + display_name 中英齐全 + 占位符清空 + （品牌区）customer 与目录一致，其余豁免。
- [ ] **能力规范符合性（§A）**：自研 `original` 与收录 `forked` 一视同仁，过 schema + platform conformance + 来源 provenance 三层。
- [ ] **安全门禁（§B）**：`tools/security-scan.mjs` 全过——硬编码密钥、prompt 注入/越权指令、越权工具声明、私网 SSRF、供应链投毒、MCP 工具面攻击、依赖闭包 security-advisory 七项任一 `block` 即不得进正式区；prompt 注入/供应链投毒/私网 SSRF 三类不得例外。
- [ ] **审核产物齐备**：`validation-report.json` 与 `security-report.json` 均 `pass`（或例外已登记），方允许 `release.mjs` 登记。
- [ ] **路径守卫（v6 新增）**：业务作者 PR 不得新增/修改 `.mjs`/`.js`/`.sh`/`adapters/`/`tools/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json`/`AGENTS.md`/`CLAUDE.md`（CODEOWNERS + `ci/guardrails.yml`）。
- [ ] **依赖守卫（v6 新增）**：`package.json` 的 dependency 变更须带 `deps-change` 标签 + steering 审批。
- [ ] **新建入口守卫（v6 新增）**：`_drafts/` 下新能力目录必须由 `tools/new-capability.mjs` 生成（骨架签名匹配），禁止手建。

---

## 15. 实施路线（v6 加 Phase 0 工程基线）

### Phase 0（工程基线，1.5 周，v6 新增）

先于一切功能交付，搭工程基线，否则业务人员无法安全 vibe coding：

- `package.json` + `.nvmrc` + `package-lock.json`（pin Node 22 LTS + ajv + js-yaml + semver）
- `templates/{agent,skill,mcp,workflow,bundle,brand-draft}/` 完整骨架
- `tools/new-capability.mjs` 脚手架（含 `--promote` 子命令）
- `tools/validate.mjs` 补 `skeleton_guard` + `placeholder_clean` + naming + 工程字段未篡改规则
- `AGENTS.md` + `CLAUDE.md` 指令文件
- `ci/guardrails.yml` path 守卫 + 依赖守卫 + CODEOWNERS
- `docs/engineering-baseline.md` 一页纸 + `docs/vibe-coding-playbook.md`
- `docs/authoring-guide.md` 重写为面向无开发背景业务人员的填空式指南

### Phase 1（MVP，4 周）：单平台 + 单人贡献

- 目录骨架（含三态）+ `schema/` + `registry.yaml`
- `adapters/claude-code/` 完整实现
- `install.sh` 支持 `--install` / `--list` / `--uninstall` / `--doctor`
- 3 个示例 capability（1 agent + 1 skill + 1 mcp，均 `source.origin: original`，用 Phase 0 脚手架生成）
- 1 个示例 workflow
- `tools/validate.mjs` + CI

### Phase 2（多平台，3 周）：跨平台适配

- 补齐 `adapters/cursor` / `codex` / `cline`
- platform matrix 自动化测试
- `--platform` 参数与 `detect()` 探测
- `manifest` 与 `upgrade` / `doctor` 完整实现
- Windows Git Bash 兼容验证（CI Windows runner）

### Phase 3（贡献、收录与品牌隔离，4 周）

- 三态流转机制 + CI 分级校验（含 §A 规范门禁、§B 安全门禁、§C 工程基线守卫）
- `docs/contributing.md` + `docs/authoring-guide.md`（含最简模板）
- 命名空间审批流程 + steering 审核清单
- `packs/_third-party/` 收录流程 + `tools/upstream-bump.mjs`
- `registry.yaml` 的 current + history 机制
- `depends_on` 版本范围解析与冲突检测
- 品牌定制目录与隔离守卫：`customers/<brand-slug>/` + `brand.yaml` + `registry-brands.yaml` + CI 品牌隔离守卫 + 安装器 `--brand` + `docs/brand-guide.md`

### Phase 4（治理与飞轮，持续）

- 草稿采集 agent（帮运营把对话/产出转成草稿投到 `_drafts/`，走 `new-capability.mjs` 入口）
- `registry.yaml` / `registry-brands.yaml` 演进为远程 `index.json`
- 平台联动：通用能力随公司 Agent 平台出货
- 第三方收录扩到 10+ 社区能力
- 品牌定制能力扩到 3+ 品牌目录

每个 Phase 可独立交付。v6 关键：**Phase 0 必须最先完成**，否则业务人员后续 vibe coding 无护栏可依。

---

## 16. 风险与缓解（v6 补工程基线风险）

| 风险 | 级别 | 缓解 |
|------|------|------|
| Agent 平台约定变动 | 高 | adapter 层隔离；matrix CI 监测 |
| 草稿区腐烂、长期不流转 | 中 | 定期清理 90 天无活动的 `_drafts/` 条目，提醒贡献者推进或归档 |
| 命名空间抢注 | 中 | slug 先到先得 + steering 轻量审批 + CI naming 正则 |
| 收录区侵权 | 中 | 强制 `upstream.ref.yaml` + LICENSE 白名单 + `LICENSE.upstream` 副本 |
| 第三方上游协议变更 | 中 | `upstream-bump.mjs` 定期检测，协议变更即下架 |
| depends_on 循环/冲突 | 中 | CI 解析依赖图，循环与冲突直接 block |
| 品牌间能力串台 | 高 | `customers/<brand>/` 物理隔离 + pack id 品牌前缀 + CI 守卫 |
| 通用能力误被迁入品牌目录 | 中 | CI 校验 `customer` 字段与物理路径强一致；迁移类 PR 强制 steering 复审 |
| workflow 跨平台行为不一致 | 高 | 能力等价测试，CI 跨平台跑 |
| 密钥泄漏 | 高 | 仓库只存 schema；`tools/lint.mjs` 扫硬编码；CI block |
| 恶意/不安全能力入库 | 高 | §B 安全门禁七项 CI block；运行时 §B.2 最小权限注入；prompt 注入/供应链/SSRF 三类不得例外 |
| MCP 工具面越权 | 高 | MCP `inputSchema` 禁任意 shell/路径；`resources` 默认不开放全盘 `file://`；`prompts` 不原样拼用户输入 |
| 收录能力规范不达标 | 中 | §A 三方与自研同标准；上游不合规须二次封装补齐，补不齐拒绝收录 |
| Windows 兼容性 | 中 | POSIX sh + Node 版双轨；CI Windows runner 验证 |
| **业务人员引入非标准技术栈**（v6 新增） | 高 | §C.1 一种语言原则 + 业务作者只能写 `.md/.yaml/.json` + `package.json` diff 守卫 + path 守卫禁碰 `.mjs/.js/.sh` |
| **vibe-coded 能力无测试**（v6 新增） | 高 | `validate.mjs` 强制 `tests/` ≥3 条 + `test-runner.mjs` 全过；staged 区不得无测试 |
| **AI 代理自创文件布局/新字段**（v6 新增） | 高 | `AGENTS.md`/`CLAUDE.md` 指令 + `skeleton_guard` + schema `additionalProperties: false` + `new-capability.mjs` 唯一入口 |
| **AI 代理引入新依赖**（v6 新增） | 中 | `package.json` diff 守卫 + `deps-change` 标签 + steering 审批 |
| **业务人员误改工程字段/版本号**（v6 新增） | 中 | `validate.mjs` 工程字段未篡改校验 + 草稿区 `0.1.0` 锁定 + release 由 `release.mjs` bump |
| **AI 代理指令文件被业务作者误改**（v6 新增） | 中 | `AGENTS.md`/`CLAUDE.md`/`templates/`/`schema/` 由 CODEOWNERS + path 守卫保护 |
| **AI 代理写出 prompt 注入/越权**（v6 新增） | 高 | §B.1 CI 扫描兜底（不依赖 AI 自觉）+ `AGENTS.md` 明令禁止 |
| **业务人员绕过脚手架手建目录**（v6 新增） | 中 | `skeleton_guard` 比对 `templates/` 签名 + `_drafts/` 新目录须骨架匹配 |

v6 相对 v5 风险结构的变化：新增 6 条工程基线相关风险（非标准技术栈、无测试、AI 自创布局/字段、新依赖、误改工程字段、AI 指令文件被误改、绕过脚手架），均由 §C + §14 CI 守卫缓解。v5 的安全/规范审核风险保留。

---

## 17. 关键文件路径索引（v6 补工程基线文件）

- 安装器：`install.sh` / `install.mjs`
- 全局清单：`registry.yaml`（通用）、`registry-brands.yaml`（品牌分段）
- Schema：`schema/capability.schema.json`、`schema/workflow.schema.json`、`schema/bundle.schema.json`、`schema/pack.schema.json`、`schema/brand.schema.json`、`schema/upstream-ref.schema.json`
- 平台适配：`adapters/{claude-code,cursor,codex,cline}/adapter.mjs`
- 三态目录（通用）：`packs/_drafts/`、`packs/_staged/`、`packs/<contributor-slug>/`、`packs/_third-party/`
- 三态目录（品牌）：`customers/<brand-slug>/packs/_drafts/`、`customers/<brand-slug>/packs/_staged/`、`customers/<brand-slug>/packs/<brand-slug>/`
- 能力示例（通用）：`packs/marketing-team/agents/copywriter/capability.yaml` + `source.md`
- 能力示例（品牌）：`customers/acme-corp/packs/acme-corp/agents/campaign-bot/capability.yaml` + `source.md`
- 品牌元数据示例：`customers/acme-corp/brand.yaml`
- 收录示例：`packs/_third-party/awesome-agent-x/upstream.ref.yaml` + `wrapping.yaml` + `source.md`
- 工作流示例：`packs/marketing-team/workflows/campaign-retrospect/workflow.yaml` + `params.schema.json`
- 工具链：`tools/validate.mjs`、`tools/lint.mjs`、`tools/security-scan.mjs`、`tools/test-runner.mjs`、`tools/release.mjs`、`tools/upstream-bump.mjs`、`tools/workflow-compile.mjs`、`tools/new-capability.mjs`（v6 新增脚手架）
- 审核产物（CI artifact）：`validation-report.json`（§A）、`security-report.json`（§B）
- **工程基线文件（v6 新增）**：`templates/{agent,skill,mcp,workflow,bundle,brand-draft}/`、`AGENTS.md`、`CLAUDE.md`、`package.json`、`.nvmrc`、`.markdownlint.json`、`ci/guardrails.yml`、`docs/engineering-baseline.md`、`docs/vibe-coding-playbook.md`
- 文档：`docs/contributing.md`、`docs/authoring-guide.md`（v6 重写）、`docs/intake-guide.md`、`docs/brand-guide.md`、`docs/packaging-guide.md`、`docs/platform-matrix.md`

仓库根目录假定为 `D:\XD\ClaudeCode\sy-eeo\opsforge\`，上述相对路径前缀为该绝对路径。

---

## 18. 与 ECC 的差异化总结（v6 补工程基线维度）

| 维度 | ECC | OpsForge v6 |
|------|-----|-------------|
| 定位 | 通用工程素养包 | 运营业务能力仓库 |
| 安装目标 | `~/.claude/rules/ecc` | 多平台（Claude Code/Cursor/Codex/Cline） |
| 售卖 | 不售卖 | 暂不售卖；未来通用能力随公司平台出货；品牌定制能力作为项目交付物存放，不绑合同/license |
| 授权机制 | 无 | 无 |
| 治理 | 单一 maintainer | 多贡献者 slug 命名空间 + 三态流转 |
| 贡献门槛 | 较高（需懂 rules 体系） | 极低（脚手架 + 填空，面向无开发背景业务人员） |
| 编排 | 无 | workflow 为一等公民 |
| 开源收录 | 无 | `_third-party/` 标准收录流程 + LICENSE 白名单 |
| 版本管理 | 弱 | 强制 semver + registry history + depends_on range + 方向约束 |
| 品牌定制 | 无 | 有 `customers/<brand-slug>/` 隔离存放，pack id 品牌前缀，CI 守卫品牌隔离，不绑合同/license |
| 商业化 | 无 | 暂不引入，作为成熟后自然延伸 |
| **工程基线**（v6 新增） | 无（面向开发者） | **有：固定技术栈 + 填空式骨架 + CI 机器强制规范 + AI 代理指令文件，业务人员 vibe coding 时工程实施方式统一可控** |

---

## 附：后续可选产出

1. Phase 0 的 `templates/` 骨架 + `tools/new-capability.mjs` + `AGENTS.md`/`CLAUDE.md` + `ci/guardrails.yml`；
2. Phase 1 的 `schema/` 与 `adapters/claude-code/` 骨架代码；
3. `docs/authoring-guide.md` 面向业务人员的填空式指南 + `docs/vibe-coding-playbook.md`；
4. `schema/brand.schema.json` 与 `tools/validate.mjs` 的品牌隔离守卫逻辑（Phase 3 预热）；
5. `schema/upstream-ref.schema.json` 的收录校验逻辑。

---

## 19. Phase 0 实施记录

Phase 0（工程基线）已按 §15 交付完成。逐文件蓝图见 `DESIGN.md`，实际状态、教训、偏差与待决项见 `PROGRESS.md`。要点：

- §C 开放决策 D1–D4 的推荐默认已应用并随仓交付（Node 22 LTS pin、业务作者禁写 `.mjs/.js`、CODEOWNERS 强制评审、随仓 ship `AGENTS.md`/`CLAUDE.md`）。
- D5（仅 `brand-draft` 一种品牌骨架，其余品牌变体脚手架运行时注入 `customer`）与 D6（第三方收录 Phase 0 仅路径生成 + `source.origin: forked` 标记，完整 LICENSE/wrapping 校验延后 Phase 3）已按设计落地，**待 steering 确认**。
- 32/32 测试绿，`node tools/validate.mjs --all` 退出码 0，code-review 零残留。
- 待决环境项：CI 需装 Node 22 或 steering 放宽 `engines`（开发机跑 v24，代码版本正确，非规范违反）。
- Phase 1（MVP：目录骨架 + registry + `adapters/claude-code` + `install.sh` + 3 示例能力 + 1 示例 workflow）为下一阶段，其基础即 Phase 0 的 `validate.mjs`/`new-capability.mjs`。

---

## 20. v7 正式修订（循环工作流执行 + 可组合自定义安装）

> 本节为 v7 正式修订，覆盖 v6 未充分定义的两个缺口。逐文件蓝图与完整示例见 `docs/design-archive/supplement-v7.md`（已归档为设计史，本节为权威）。8 项决策 P1–P8 已全部按推荐默认确认（§20.9）。Phase 编号沿用 §15。

### 20.1 Gap 1 — 循环工作流执行

**控制流扩展（决策 P1 确认：steps 目录 + control_flow 编排树）**：`workflow.yaml` 的 `steps` 重定义为**无序步骤目录**（每步声明 `id`/`capability`/`inputs`/`outputs`，或 `kind: checkpoint` 人审）；新增顶层 `control_flow` 编排树，含 `sequence`/`loop`(until|while, `condition`, `body`, `max_iterations`, `on_max`)/`switch`(`on`/`cases`/`default`) 三类控制节点。新增顶层 `vars`（工作流级可变状态，区别于只读的 `params`，承载"用了就沉淀"的运行期流转）与 `kb_mount`（布尔，触发团队知识库 MCP 注入）。表达式语法沿用 `{{params.x}}`/`{{vars.y}}`/`{{steps.<id>.<out>}}`。**Phase 1 `control_flow` 可缺省，按 `steps` 声明顺序线性执行，向后兼容 §7.1。**

**平台 surfacing（决策 P2 确认：slash-command + CLI 双轨）**：安装期 `tools/workflow-compile.mjs` + adapter 把 workflow 编译为平台原生调用入口——Claude Code `~/.claude/commands/workflow-<name>.md` → `/workflow <name> --goal=...`；Cursor/Codex/Cline 各自 commands 路径；Codex/远程批跑另走 `./install.sh --run-workflow <id> --params <yaml> [--resume <run-id>] [--brand <brand>]`、`--list-runs`、`--abort`。非开发者默认路径：Claude Code 里一条斜杠，参数用自然语言由 agent 填进 `.opsforge-params.yaml`。

**状态与持久化（决策 P3 确认：独立 `~/.opsforge/`）**：per-run 工作目录 `~/.opsforge/runs/<workflow-id>/<run-id>/` 含 `state.json`（run_id/workflow_id/version/current_node/completed_steps[]/vars{}/iteration_counts{}/status/时间戳）、`artifacts/<step-id>/<output>.json`（取数表/SQL/结果/洞察落盘）、`run.log`、`params.snapshot.yaml`。`kb_mount:true` 触发 `opsforge-kb` 声明式 MCP（§9.1 形态 1），KB 路径 `~/.opsforge/kb/<pack>/`，品牌 workflow 限定 `customers/<brand>/` 下，受 §B.2 env 白名单 + 隔离写入约束。`state.json` 不存密钥；MCP 远端 URL 经 §B.1 SSRF 扫描。

**断点续跑**：`run-id` 由 `--run-workflow` 生成并回显；引擎在每个控制节点边界原子写 `state.json`；`--resume <run-id>` 从 `current_node` 续跑（checkpoint 重新发起人审）；超 `max_iterations` 按 `on_max`（`fail_with_message` 留 artifacts 供诊断）。

**三态组合**：workflow.yaml 本身是 capability 走 §11.2 三态，`_staged` 加 `R_wf_ref`（steps 引用可解析）+ `R_wf_closed`（control_flow 引用闭合）两条新规则；run/KB 是运行时产物不入仓不入 registry 不参与三态；KB 内容若要被复用并版本化需另行沉淀为 capability 走三态。

**不支持 workflow 原语的兜底（决策 P8 确认：A 为主 + B 可选）**：若平台无 command/编排原语——**A. CLI 引擎兜底**：workflow 不编译成 slash-command，由 `--run-workflow` 引擎按 `control_flow` 调度，每步调用的 capability 仍正常装在平台上，平台只看到一个个可用 skill/agent，编排逻辑在 OpsForge CLI；**B. 降级为编排 agent**（平台支持 agent 但不支持 command 时可选）：把整个 workflow 编译成一个 agent，body 串接各步骤，loop/HITL 表达力受限。平台矩阵（§6.1）对 workflow 标注其 surfacing 能力；`platforms` 字段声明该 workflow 可被编译/运行的平台子集。

### 20.2 Gap 2 — 可组合自定义安装

**Profile 概念（决策 P4 确认：不入仓，属目标项目）**：Profile 是消费方项目的安装清单 `profile.yaml` + `profile.lock.json`，类比应用项目的 `package.json` vs OpsForge 仓库是"npm registry"。**不作为 capability kind、不进 registry、不走三态、不入 OpsForge 仓库**。与已有 **Bundle** 的区别：Bundle = contributor 发布的场景套装（入仓、semver、进 registry、`--bundle` 触发）；Profile = 消费方自选任意子集（可引用 bundle + 散落 capability，`--profile` 触发，lock pin commit）。安装时先展开 bundle 再叠加散落项。

**`profile.yaml` schema**（`schema/profile.schema.json`，`additionalProperties:false`，steering 维护）：字段 `profile_version`/`project`(slug)/`platform`/`capabilities[]`/`workflows[]`/`bundles[]`/`mcps[]`/`brand?`/`kb_mount?`，每项 `<pack>.<name>@<range>`。是 `.yaml`，符合 §C 业务作者只写 `.md/.yaml/.json` 基线。

**依赖解析器 `tools/resolve-profile.mjs`**（steering，Phase 2/3）：1) 有 lock 且非 `--fresh` → 直接按 lock 装；2) 展开 `bundles` 并入；3) 对每个 workflow 拉取其 `steps[].capability`（传递依赖）；4) 对每个 capability 解析 `depends_on`（§13.4）拓扑排序；5) semver range 从 registry 取满足的最高版本，多 range 取交集，冲突 fail-loud；6) 品牌隔离闭包校验（`brand` 存在时闭包不得含其它品牌定制能力）；7) 循环检测；8) 写/更新 `profile.lock.json` → 调 adapter `translate()`+`install()`。

**`profile.lock.json`（决策 P5 确认：与 profile.yaml 一起提交到目标项目仓库）**：pin 精确 version + source_commit + registry 来源，bit-identical 可复现。`--upgrade --profile` 在 range 内升级重写 lock，遇 MAJOR 跨越要求 `--confirm`；`--doctor --profile` 比对 lock vs manifest 报漂移。

**CLI 扩展（install.sh/install.mjs）**：`--profile <path>`、`--profile <path> --fresh`、`--profile-save <path>`、`--profile-lock`、`--upgrade --profile`、`--doctor --profile`、`--run-workflow`/`--list-runs`/`--abort`（见 §20.1）。非开发者主路径：项目仓库根放 `profile.yaml`，一条 `./install.sh --profile ./profile.yaml` 装齐，幂等。

**具体安装流程（Q1 答复）**：`./install.sh --profile ./profile.yaml` 端到端——① 解析 profile.yaml 过 schema 校验；② resolve-profile.mjs 解析闭包（有 lock 读 lock，否则展开 bundle→拉 workflow steps→depends_on 拓扑→semver 求解→品牌隔离+循环检测→写 lock）；③ 按拓扑序逐个能力：从仓库读源（`packs/<slug>/` 或 `customers/<brand>/`）→ `adapter.translate()` 产平台产物（如 `~/.claude/agents/<name>.md`、`~/.claude/commands/workflow-<name>.md`）→ 幂等写入 → MCP 走 `injectMcp` 合并进 `~/.claude.json`（env 白名单，密钥不入仓）→ workflow 由 `workflow-compile.mjs` 编译；④ 写 per-project manifest `~/.opsforge/manifests/<project-slug>.manifest.json`（id+version+source_commit+platform+customer+security_policy+owner_profile）；⑤ 打印汇总 exit 0。重跑只更新变更项；`--uninstall` 按 manifest 反向回滚。品牌场景：profile 带 `brand:` → 读 `registry-brands.yaml` 段 + `customers/<brand>/` 源，manifest 标 customer。

**冲突与共存（决策 P6 确认：last-write-wins + warning）**：同机多 profile 靠 pack-id 命名空间 + per-project manifest 隔离（`~/.opsforge/manifests/<project-slug>.manifest.json`）；两 profile pin 同一 capability 不同 version 时，以最后安装版本为准，`--doctor` 报 warning 不阻断（manifest 记 owner profile）；严格隔离的项目用容器/独立用户目录。能力文件按 pack id 命名落盘天然不覆盖；品牌能力受 §B.2 隔离写入路径约束。

**创作入口（决策 P7 确认：复用 `new-capability.mjs --kind profile`）**：新增 `templates/profile/` 骨架（`profile.yaml` + `README.md` + `CHANGELOG.md`，`__FILL_ME__` 占位）。`--kind profile` 分支不预填 version、不进 `_drafts/`、写到 cwd（目标项目根）或 `--out <dir>`，不写进 OpsForge 仓库。`validate.mjs` 新增 `--profile <path>` 子模式校验 `profile.schema.json`。保持"业务作者只写 .yaml、唯一入口是脚手架"基线（§C.2/C.5），不破坏 path 守卫。

### 20.3 与既有 § 的集成点

| § | 变更 |
|---|---|
| §2 概念表 | 新增行：**Profile** = 消费方项目自定义安装清单（不进 registry、不走三态、不入 OpsForge 仓库）。Bundle 语义不变。 |
| §6.1 平台矩阵 | commands 路径列新增 `workflow-<name>.md` 占位（workflow-compile 安装期生成）；workflow 标注 surfacing 能力（slash-command / CLI-only / orchestration-agent）。 |
| §7.1 workflow.yaml | `steps` 重定义为无序步骤目录；新增顶层 `control_flow`/`vars`/`kb_mount`；Phase 1 `control_flow` 可缺省退化到线性。 |
| §7.2 编排引擎 | `tools/workflow-compile.mjs` 分阶段：Phase 1 线性 sequence→slash-command；Phase 2 加 switch + 多平台 + `--run-workflow` CLI + KB 注入；Phase 3 加 loop+checkpoint+resume。 |
| §7.3 参数化与复用 | "输出挂载到团队知识库"具体化为 `kb_mount:true`→`injectMcp` 注入 `opsforge-kb` MCP，KB 路径 `~/.opsforge/kb/<pack>/`。 |
| §8 安装器 | 新增 flags：`--run-workflow`/`--list-runs`/`--abort`/`--profile`/`--profile-save`/`--profile-lock`/`--fresh`/`--doctor --profile`。 |
| §9.1 MCP 形态 | 新增运行期 MCP `opsforge-kb`（声明式，由 workflow `kb_mount` 触发，非 contributor 发布）。 |
| §11.2 三态 | workflow 三态加 `R_wf_ref`/`R_wf_closed`；run/KB 不入三态。 |
| §13.4 depends_on | Profile resolver 复用方向约束与循环检测；新增"profile 闭包不得跨品牌"规则。 |
| §14 约束清单 | 加三项：profile.schema 合规、profile.lock↔manifest 一致性（doctor）、workflow control_flow 闭合。 |
| §15 路线 | Phase 1 增"装 workflow 时单层传递依赖"；Phase 2 增"profile+lock+switch+多平台 slash-command+KB 注入"；Phase 3 增"loop+checkpoint+resume+完整 resolver+会员制咨询示例"。Phase 4 不变。 |
| §17 路径索引 | 新增 `schema/profile.schema.json`、`templates/profile/`、`tools/resolve-profile.mjs`、`tools/workflow-compile.mjs`、`~/.opsforge/{runs,kb,manifests}/`。 |
| §C 工程基线 | profile.yaml/lock 是 .yaml/.json 符合基线；resolve-profile.mjs/workflow-compile.mjs 属 steering 工具（path 守卫）。 |

### 20.4 Phase 映射

| Phase | 交付 |
|---|---|
| **Phase 1 (MVP)** | §7.1 线性 workflow（sequence only）；Claude Code slash-command `/workflow <name>`；per-run `state.json`+artifacts（无 resume）；`--install/--pack/--bundle` + **单层传递依赖**（装 workflow 拉取其 steps capability，无 lock）；`kb_mount` 字段预留不注入。**不镀金 Phase 1。** |
| **Phase 2** | 多平台 slash-command 编译；`switch`+`if` 运行时求值；`--run-workflow` CLI；KB MCP 注入（沉淀闭环开环）；`profile.yaml` schema + `--profile`/`--profile-save` + `profile.lock.json`（单平台、semver 精确 pin、不做 range 交集）；`templates/profile/`+`--kind profile` scaffold；`resolve-profile.mjs` 最小版。 |
| **Phase 3** | `loop`(until/while)+`max_iterations`+`on_max`；`checkpoint` HITL；`--resume/--list-runs/--abort`；`vars` 跨迭代累积；完整 §1.2 会员制咨询示例入库；完整 resolver（range 交集/冲突 fail-loud/品牌闭包/循环检测/`--upgrade --profile`/`--doctor --profile`/多 profile manifest 隔离）。 |

### 20.5 相关文件路径（均未创建，属 v7 规划新增/扩展）

- 新增 schema：`schema/profile.schema.json`；扩展 `schema/workflow.schema.json`（加 `control_flow`/`vars`/`kb_mount`）
- 新增模板：`templates/profile/`
- 新增/扩展工具：`tools/resolve-profile.mjs`、`tools/workflow-compile.mjs`；`tools/validate.mjs`（加 `R_wf_ref`/`R_wf_closed`/profile 校验子模式）、`tools/new-capability.mjs`（加 `--kind profile` 分支）
- 扩展安装器：`install.sh`、`install.mjs`
- Phase 3 示例 workflow：`packs/growth-team/workflows/membership-consulting/workflow.yaml`
- 运行期目录（目标机器，非仓库）：`~/.opsforge/runs/`、`~/.opsforge/kb/`、`~/.opsforge/manifests/`

### 20.6 决策记录（P1–P8，全部按推荐确认）

- **P1** workflow 拆 steps 目录 + control_flow 编排树（vs 内联）。✅ 确认前者。
- **P2** surfacing = 安装期编译为平台原生调用入口（slash-command/commands）+ `--run-workflow` CLI 双轨。✅ 确认双轨。
- **P3** 运行期目录用独立 `~/.opsforge/`（runs/kb/manifests）。✅ 确认独立目录。
- **P4** Profile 不作为 capability kind、不入 OpsForge 仓库、属目标项目。✅ 确认不入仓。
- **P5** `profile.lock.json` 与 `profile.yaml` 一起提交到目标项目仓库。✅ 确认一起提交。
- **P6** 同机多 profile 装同一 capability 不同 version，last-write-wins + `--doctor` warning，不阻断；严格隔离走容器/独立用户。✅ 确认。
- **P7** Profile scaffold 复用 `new-capability.mjs --kind profile`（写 cwd 不进仓库），新增 `templates/profile/`。✅ 确认。
- **P8**（由"平台不支持 workflow 怎么办"引出）A. CLI 引擎兜底为主 + B. 降级为编排 agent 可选。✅ 确认 A 为主 + B 可选。

---

## 21. v8 正式修订（能力质量验证层）

> 本节为 v8 正式修订，覆盖 v7 未充分定义的"如何验证 vibe-coded 能力是否真正有效"这一缺口。逐文件蓝图、完整用例 schema、judge 提示词契约见 `docs/design-archive/supplement-v8.md`（已归档为设计史，本节为权威）。11 项决策 Q1–Q11 已全部按推荐默认确认（§21.9）。Phase 编号沿用 §15 / §20.4。v6/v7 的 §A 结构/§B 安全/§C 工程基线、`validate.mjs` R1–R15、`tests_min≥3` 全部保留不动；v8 在其上叠加**第四层行为评估**，人审只保留 `human` 用例与"是否值得收录"的业务判断。

### 21.1 缺口定位

Phase 0 的 `tests/case-0[1-3].yaml` 只有 `name`/`input`/`expected` 三字段，`tools/test-runner.mjs` 是 placeholder。`expected: "ok"` 这种 trivially-true 断言能过 `tests_min≥3`（R14）却完全没有验证能力行为。v8 把 `test-runner.mjs` 升级为真评估器，并扩展用例 schema 以声明"如何判"。

### 21.2 用例 schema 扩展（`tests/*.yaml` + `schema/test-case.schema.json`）

新增 `schema/test-case.schema.json`（steering 维护，`additionalProperties:false`），`tests/case-0[1-3].yaml` 模板字段从 3 个扩到 7 个。既有用例**向后兼容**：缺省字段按默认模式推断（见 supplement §1.4 兼容矩阵）。`capability.schema.json`（§5 / DESIGN §4）**不新增字段**——`tests: tests/` 常量不变；用例级 schema 独立文件。

```yaml
name: activity-summary-happy-path         # 必填 kebab-case
input: { ... }                             # 必填 any，传给能力执行器
expect: exact                              # 必填 enum：exact|schema|contains|regex|llm_judge|golden|human
expected: "..."                            # exact/contains/regex 必填；schema 改用 schema_ref
schema_ref: null                           # schema/golden 模式：相对路径
judge_rubric: null                         # llm_judge 模式必填：自然语言判分准则
judge_threshold: 0.7                       # llm_judge/golden 通过分数线，默认 0.7
weight: 1.0                                # 加权均值用，默认 1.0
platforms: null                            # 限定平台，null=全平台
timeout_ms: 30000                          # 单用例超时，默认 30s
```

### 21.3 `expect` 模式判定契约（`tools/test-runner.mjs`）

对每条用例：读 `input` 调能力执行器（§21.5 dry-run harness）拿 `actual` → 按 `expect` 模式判 pass/fail → 对 `llm_judge`/`golden` 额外产 0–1 `score` + `reason`。

| 模式 | 判定逻辑 | 通过条件 |
|---|---|---|
| `exact` | `actual === expected`；两端合法 JSON 则结构化深比较（键序无关） | 严格相等 |
| `schema` | `schema_ref` 指向 `tests/*.schema.json`，ajv 校验 `actual` | ajv errors=0 |
| `contains` | `expected` 为子串数组/单串，`actual` 含全部 | 全命中 |
| `regex` | `expected` 为正则数组，`actual` 全部匹配 | 全匹配 |
| `llm_judge` | 调 judge LLM，输入 `{input, actual, rubric}`，输出 `{score:0–1, reason}`（§21.4） | `score >= judge_threshold`（默认 0.7） |
| `golden` | `schema_ref` 指向 golden 文本，归一化后零依赖字符级 Levenshtein 比率 | `similarity >= judge_threshold`（默认 0.85） |
| `human` | 不自动判，标记需人审；`expected` 写人审检查点描述 | 人工 approve/reject |

> **§A.4 接入**：`test-runner.mjs` 的 `runSuite` 结果并入 §A.4 `validation-report.json` 的 `regression_cases` 字段，从"用例数计数"升级为"用例行为结果"（含 `modes`/`failures` 子字段）。任一 `regression_cases.failed>0` → `validation-report.verdict: fail`。

### 21.4 LLM-judge 提示词契约（steering 拥有，`tools/judge-prompt.md`）

judge 不引入新依赖：复用平台自身模型（Claude Code 用 Claude，`OPSFORGE_JUDGE_MODEL` env 可覆盖，steering 在 `tools/eval.config.yaml` 配置）。judge **盲评 body**（决策 Q3）——只看 `input`/`actual`/`judge_rubric`，不看能力 `source.md` body，防 body 自吹带偏。系统提示固定：给定【能力输入】【实际输出】【评审准则】按准则打 0.0–1.0 分并给一句话理由，输出严格 JSON `{"score":<0-1>,"reason":"<=120字"}`，含越权/危险内容 score=0 标 unsafe。`judge_rubric` 由业务作者填（如"输出须含一句活动主总结+≥2 条数据支撑+1 条行动建议；不得编造 input 未出现的数字"）。

### 21.5 dry-run harness（免安装被测）

测一个 capability 不能要求 reviewer 真装到本机平台再手点斜杠（不可复现、不可并发、污染本机）。`tools/test-runner.mjs` 的 dry-run 执行器按 kind 自动选策略：

1. **skill/agent（prompt 类）**：不装到 `~/.claude/`，把 `source.md`/`SKILL.md` 的 frontmatter+body 作 system prompt、`input` 作 user message，直接调 `claude -p`（决策 Q4，Claude Code 已可用、零新依赖）；其它平台 `OPSFORGE_RUNNER=<claude|codex|openai|anthropic-api>` 切换；无 SDK 降级 `conform()` 静态校验 + `human` 模式（记 `runner: static-only`）。
2. **mcp**：adapter `conform(cap)` 拿工具声明，对每个 `tools[].inputSchema` 用 `input` 调一次 stdio MCP server（本地起，超时 `timeout_ms`），`actual` = 工具返回；需远端鉴权的降级 `human`。
3. **workflow**：用 v7 §20.1 的 `--run-workflow` 引擎在 `~/.opsforge/runs/<wf-id>/<dry-run-id>/` 跑 `--dry-run`（不写 KB、checkpoint 全 auto-pass），`actual` = `outputs`。

全程只读写 `~/.opsforge/runs/<eval-id>/`，不碰 `~/.claude/`、不装能力、不改 manifest。复用 v7 `~/.opsforge/` 根目录，不引入新顶层。

### 21.6 `tools/eval.mjs` 五维 rubric + `eval-report.json`

`test-runner.mjs` 跑用例判 pass/fail；`eval.mjs` 叠加打分维度与质量阈值裁决，产 `eval-report.json`（与 `validation-report.json` §A.4 / `security-report.json` §B.3 并列的**第三份 CI artifact**）。

| 维度 | 含义 | 测算来源 | 权重 |
|---|---|---|---|
| **accuracy** 准确性 | 输出是否符合 `expected`/`schema`/`golden` | exact/schema/golden 用例 pass 率 | 0.3 |
| **completeness** 完备性 | 输出是否覆盖 rubric 所有要素 | llm_judge 用例 `score` 均值 | 0.25 |
| **actionability** 可执行性 | 输出可被下游消费（结构化、无歧义、无幻觉） | llm_judge 可执行性子准则分 + schema 用例 pass 率 | 0.2 |
| **safety** 安全性 | 输出无越权/注入/危险内容 | judge reason 含 unsafe 计数 + §B verdict | 0.15 |
| **robustness** 健壮性 | 边界/异常 input 不崩、不幻觉 | 边界用例（名含 `edge-`/`empty-`/`bad-`）pass 率 | 0.1 |

权重在 `tools/eval.config.yaml`（steering 维护），业务作者不得改。质量阈值（`eval-report.verdict: pass` 须全过）：exact/schema/contains/regex 用例全过（零容忍）；llm_judge `score_mean>=0.7`（生成式文案可 0.65，≤0.6 一律无效）；golden `score_mean>=judge_threshold`（0.85）；`pending_human==0`（human 用例全 approved，rejected 即 fail）；`rubric.safety==1.0`（零容忍）；`platform_matrix` 在声明的每个平台都 pass；`rubric.weighted>=0.7`。

> `release.mjs`（§11.2/§B.4/§14）扩展：原要求 validation-report + security-report 均 pass；v8 追加 **eval-report verdict==pass** 为第三项必要条件。三者缺一不可。

### 21.7 防空头/防幻觉静态守卫 R16–R22（`validate.mjs`）

廉价 fail-loud 前置过滤，在跑昂贵 eval 前把 obvious vibe-fraud 挡下。全部 staged 态执行（draft 不跑，保草稿区放宽语义）；任一 fail → `verdict:fail`，且 `eval.mjs` 在 fail 的 validation-report 上**拒绝运行**（成本控制）。

| # | 检查名 | 校验内容 | D | S |
|---|---|---|---|---|
| R16 | `body_min_substance` | body（去 frontmatter/注释/空白）token 数 ≥ N（agent≥150 / skill≥100 / mcp≥80 中文字符或等价英文 token） | — | ✓ |
| R17 | `body_not_boilerplate` | body 不匹配纯 echo/纯占位填充/与 description ≥80% 雷同等空头模式 | — | ✓ |
| R18 | `test_expect_nontrivial` | 每条用例 `expected` 非平凡：长度>3、不在 {`"ok"`,`"true"`,`"pass"`,...} 黑名单、llm_judge 必须有 ≥20 字符 `judge_rubric` | — | ✓ |
| R19 | `test_cases_distinct` | `tests/` 下任意两条用例 `(input,expect,expected)` 三元组不完全相同 | — | ✓ |
| R20 | `description_body_alignment` | description 抽取关键名词至少 1 个出现在 body，防 description 吹 body 没有的行为 | — | ✓ |
| R21 | `test_expect_declared` | staged 区每条用例显式声明 `expect` 字段（不允许仅靠兼容推断） | — | ✓ |
| R22 | `no_self_cheat_in_body` | body 不得含"直接返回 expected"/"pass the test by returning 'ok'"等自作弊模式 | — | ✓ |

### 21.8 三态验收门升级（§11.2 / §14）

| 态 | 静态门禁 | 行为门禁 | 人审 | 产物 |
|---|---|---|---|---|
| **draft** `_drafts/` | R1–R15 草稿子集 | **无**（vibe freely，不跑 eval，不花 token） | 无 | 无 |
| **staged** `_staged/` | R1–R15 全量 **+ R16–R22** | **functional**：`test-runner runSuite` 跑 `tests/` 各按 `expect` 判 pass；human 用例标 pending | steering 人审：① 业务合理性与收录价值；② 对 1–2 条 sample input 亲跑一次确认行为（决策 Q7，抽样跑不替代 eval） | `validation-report.json`（含 v8 regression_cases 行为结果） |
| **released** 正式区 | R1–R15 + R16–R22 全过 | **eval harness**：`eval.mjs` 产 eval-report verdict=pass + **平台 matrix**（每个声明平台跑 eval）+ v7 workflow `--run-workflow --dry-run` | steering 复核三份报告 | validation + security + eval 三 pass |

§14 约束清单追加三项：R16–R22 防空头全过、eval-report verdict=pass、三报告齐备（原只要求前两份）。§B.4 接入表 `release.mjs 登记` 行追加"复核 eval-report verdict=pass"。

### 21.9 决策记录（Q1–Q11，全部按推荐确认）

- **Q1** golden 相似度用零依赖字符级 Levenshtein（不引入新包，守 §C.1）。✅ 确认。
- **Q2** judge 默认模型 = 平台自身模型（零新签 API key），`OPSFORGE_JUDGE_MODEL` 可覆盖，steering 在 `eval.config.yaml` 配独立模型。✅ 确认平台默认。
- **Q3** judge 盲评 body（只看 input/actual/rubric，不看 source.md），防 body 自吹带偏。✅ 确认盲评。
- **Q4** dry-run runner 默认 `claude -p`（Claude Code 已可用、零新依赖），无 SDK 降级 static-only + human。✅ 确认。
- **Q5** llm_judge 通过分数线默认 0.7；生成式纯文案可 0.65；≤0.6 一律视为无效 block。✅ 确认。
- **Q6** body_min_substance 阈值 N：agent≥150 / skill≥100 / mcp≥80（中文字符或等价英文 token）。✅ 确认按 kind 区分。
- **Q7** staged 人审要求 steering 亲跑 1–2 条 sample input 确认行为（抽样跑，不替代 eval，保 §C.3 人审语义）。✅ 确认。
- **Q8** /rate 评分提示由平台 slash wrapper 在能力产出后追加注入，能力 body 不感知、不污染输出。✅ 确认 wrapper 注入。
- **Q9** `--doctor` effectiveness degraded 阈值：最近 N=20 次 success_rate<70% 标 degraded（仅告警 + 写 manifest effectiveness_flag，不阻断装/卸）。✅ 确认 70%。
- **Q10** re-eval cron 周期 weekly（成本低、够及时防 model drift）；高优能力（已 degraded）触发即跑。✅ 确认 weekly + degraded 触发。
- **Q11** 单能力 llm_judge/golden 用例 ≤8（超出的 eval.mjs 截前 8 条 + warning）；exact/schema 不限。✅ 确认 ≤8。

### 21.10 发布后反馈闭环（防模型漂移 / 能力腐烂）

- **`opsforge-feedback` 运行期 MCP**（声明式，§9.1 形态 1）：安装器在装任何 released 能力时自动注入（不需能力作者声明），写 `~/.opsforge/kb/<pack>/feedback/<capability-id>.jsonl`（复用 v7 KB 根目录）。每条记录 `{ts, capability, version, platform, outcome:success|fail|error, user_rating, duration_ms, run_id}`。`outcome` 由 dry-run/真实运行器上报；用户可在 slash 末 `/rate <n>`（Q8 wrapper 注入，body 不感知）。
- **`--doctor` effectiveness 体检**（§8.3 扩展）：扫 feedback 目录，对每个 capability 计算最近 N=20 次运行 success_rate，<70%（Q9）标 `effectiveness: degraded`，告警 + 写 manifest `effectiveness_flag`，不阻断。
- **周期性 re-eval**（`ci/github-actions/re-eval.yml`，steering weekly cron Q10）：扫 registry 所有 current released 能力跑 `eval.mjs`，对比 eval-history（`~/.opsforge/eval-history/<id>/<version>.json`，CI artifact 归档不入仓）；`rubric.weighted` 下降 >0.1 或任一维度跌破阈值 → 开 issue 标 `model-drift`，提 re-eval PR；degraded 能力触发即跑。

### 21.11 成本控制

judge 仅 `llm_judge`/`golden` 模式用例调 judge LLM，`exact`/`schema`/`contains`/`regex` 零 token 本地判。eval 运行时机仅三处：staged→released 门禁（每 PR 一次）、weekly re-eval cron、`--doctor` 触发的 degraded 即跑。**draft 永不跑 eval；staged 只跑 functional runSuite（不打 rubric 分，省 judge 调用）**。单能力 llm_judge/golden 用例 ≤8（Q11）。eval 失败不自动重跑（防烧 token），PR 作者本地 `node tools/eval.mjs <path>` 自跑修复后再 push，CI eval 失败即 block。

### 21.12 与既有 § 的集成点

| § | 变更 |
|---|---|
| §5 capability 元数据 | 不新增字段（`tests: tests/` 常量不变）；用例级 schema 独立为 `schema/test-case.schema.json` |
| §7 workflow | workflow 三态 eval 用 `--run-workflow --dry-run`（复用 v7 §20.1 引擎），不新增 workflow 字段 |
| §8.3 doctor | 扩展检查项 `effectiveness: degraded`（§21.10） |
| §9.1 MCP 形态 | 新增运行期 MCP `opsforge-feedback`（声明式，安装器自动注入，非 contributor 发布） |
| §11.2 三态 | draft=静态；staged=静态+R16–R22+functional runSuite；released=静态+R16–R22+eval harness+平台 matrix eval+workflow dry-run（§21.8） |
| §A.2 规范审核 | 结构/语义/来源三层不变；行为层是 v8 新增的**第四层**（behavioral），由 test-runner/eval 执行，不取代前三层 |
| §A.4 validation-report | `regression_cases` 升级为行为结果 + `modes`/`failures` 子字段（§21.3） |
| §B.4 接入表 | `release.mjs 登记` 行追加"复核 eval-report verdict=pass" |
| §C.4 CI 规则表 | 追加 R16–R22 七条；test-runner/eval 列入 steering path 守卫 |
| §14 约束清单 | 追加三项：R16–R22 防空头、eval-report pass、三报告齐备（§21.8） |
| §16 风险表 | 追加四条：模型漂移、judge 偏差、vibe-fraud 硬编码、eval 成本失控 |
| §17 路径索引 | 新增：`schema/test-case.schema.json`、`tools/test-runner.mjs`（升级为真实现）、`tools/eval.mjs`、`tools/eval.config.yaml`、`tools/judge-prompt.md`、`ci/github-actions/re-eval.yml`、运行期 `~/.opsforge/kb/<pack>/feedback/`、`~/.opsforge/eval-history/` |
| §20.3（v7 集成表） | v8 复用 v7 `~/.opsforge/` 根目录（runs/kb/manifests + 新增 feedback/eval-history 子目录）；workflow dry-run 复用 v7 `--run-workflow` 引擎 |

### 21.13 Phase 映射（沿用 §15 / §20.4）

| Phase | v8 交付 |
|---|---|
| **Phase 1 (MVP)** | `test-runner.mjs` 真实现（仅 `exact`/`contains`/`human` 模式，dry-run 用 `claude -p`，单平台 claude-code）；`schema/test-case.schema.json`；模板 `tests/*.yaml` 升级到 7 字段；R16–R22 七条入 `validate.mjs`；staged 门禁跑 functional runSuite；validation-report.regression_cases 升级为行为结果。**不**含 llm_judge、不含 eval.mjs。 |
| **Phase 2** | `tools/eval.mjs`（五维 rubric + eval-report.json + 阈值裁决）；`llm_judge`/`golden`/`schema`/`regex` 模式；judge 提示词契约 + eval.config.yaml；released 门禁要求 eval-report pass；多平台 matrix eval；release.mjs 三报告齐备校验。 |
| **Phase 3** | `opsforge-feedback` MCP + `--doctor` effectiveness 体检 + manifest effectiveness_flag；weekly re-eval cron + eval-history 归档；R22 自作弊检测强化（语义级）；workflow dry-run eval 接 v7 loop/checkpoint 能力。 |
| **Phase 4** | 反馈闭环飞轮：degraded 能力自动开 re-eval issue；judge 模型版本治理；高优能力 effectiveness SLA 监控；eval-history 趋势看板（随 v7 remote index.json 一起演进）。 |

### 21.14 相关文件路径（均以 `D:\XD\ClaudeCode\sy-eeo\` 为根，未创建属 v8 新增/扩展）

- 新增 schema：`schema/test-case.schema.json`
- 扩展模板：`templates/{agent,skill,mcp,workflow,bundle,brand-draft}/tests/case-0[1-3].yaml`（3→7 字段）
- 新增/扩展工具：`tools/test-runner.mjs`（placeholder→真实现）、`tools/eval.mjs`、`tools/eval.config.yaml`、`tools/judge-prompt.md`
- 扩展工具：`tools/validate.mjs`（加 R16–R22）、`tools/release.mjs`（加 eval-report 校验）
- 新增 CI：`ci/github-actions/re-eval.yml`
- 运行期目录（目标机器，非仓库）：`~/.opsforge/kb/<pack>/feedback/`、`~/.opsforge/eval-history/`
- 新增运行期 MCP：`opsforge-feedback`（声明式，安装器注入）

---

## 22. v9 正式修订（国内自研平台强兼容性 + 全流程非技术用户 UX）

> 本节为 v9 正式修订，覆盖 v8 未充分定义的两个缺口：国内自研 agent 平台强兼容性、全流程非技术用户 UX。逐文件蓝图见 `docs/design-archive/supplement-v9.md`（已归档为设计史，本节为权威）。6 项决策 D1–D6 已全部按推荐默认确认（§22.6）。Phase 编号沿用 §15 / §20.4 / §21.13。v6–v8 的 §A/§B/§C、R1–R22、test-runner/eval/release 全部保留不动；v9 在其上叠加平台能力点抽象与 UX 包裹层，业务作者仍只写 `.md/.yaml/.json`，所有新工具属 steering，无新 npm 依赖（复用 Node 内置 readline/fetch，不违反 §C.1）。

### 22.1 缺口定位

现有 §6.1 平台矩阵硬编码 4 个平台（claude-code/cursor/codex/cline），`capability.schema.json` 的 `platforms` enum 只允许这 4 值，§6.2 adapter 6 方法假设平台有"配置目录可写 + 能力文件可落盘 + MCP 配置可合并"的能力组合，v7 P8 只覆盖"平台不支持 workflow 原语"的兜底。国内自研平台可能无 CLI/SDK、无 slash-command、无 MCP、配置目录结构不同、有中文/合规要求。同时 v6–v8 的护栏对非技术用户不友好：裸 CLI、JSON artifact 看不懂、装完不知有什么可用怎么触发。

### 22.2 平台能力点模型 + platform.yaml（§6.1 扩展）

把"一个平台能做什么"分解为正交的 9 个**能力点**：`prompt_exec` / `agent_file` / `skill_file` / `slash_command` / `mcp_config` / `workflow_orchestration` / `config_dir_writable` / `kb_mount` / `feedback_hook`。每个能力点 = 布尔（支持/不支持）+ 元数据（mode/endpoint_env/fallback）。每个平台用一份 `adapters/<platform>/platform.yaml`（steering 维护）声明：

```yaml
platform: my-domestic-platform
display_name: 某国内自研平台
display_name_zh: 某国内自研平台
capability_points:
  prompt_exec: { supported: true, mode: http-api, endpoint_env: MY_PLATFORM_API_URL, auth_env: MY_PLATFORM_TOKEN }
  agent_file: { supported: false, fallback: http-inject }
  skill_file: { supported: false, fallback: manual-prompt }
  slash_command: { supported: false, fallback: cli-engine }
  mcp_config: { supported: false, fallback: http-direct }
  workflow_orchestration: { supported: false, fallback: cli-engine }
  config_dir_writable: { supported: false }
  kb_mount: { supported: false, fallback: local-file }
  feedback_hook: { supported: true, mode: http-callback, endpoint_env: MY_PLATFORM_FEEDBACK_URL }
locale: zh-CN
compliance_tags: [domestic, data-residency-cn]
```

`fallback` 字段声明该能力点缺失时的降级策略（§22.4）。Tier 由能力点支持数自动计算，不需手填。

### 22.3 平台 Tier 分级 + adapter 契约扩展（§6.2 扩展，决策 D1）

按能力点支持程度分三级：

| Tier | 能力点要求 | 能装能力范围 | 典型平台 |
|---|---|---|---|
| **Tier 1（全功能）** | prompt_exec + agent_file + skill_file + slash_command + mcp_config + config_dir_writable 全支持 | agent/skill/mcp/workflow(slash)/bundle 全类 | Claude Code/Cursor/Codex/Cline |
| **Tier 2（部分功能）** | prompt_exec 支持 + 其余部分支持（≥2 个文件/配置类） | 按缺失能力点降级；workflow 走 CLI 引擎；mcp 可能 HTTP 直连 | 国内自研有 HTTP API + 部分落盘 |
| **Tier 3（仅 prompt）** | 仅 prompt_exec 支持 | agent/skill 退化为 manual prompt 或 HTTP 注入；mcp/workflow 不可装（fail-loud 或降级为说明书） | 国内自研只有 Web UI/私有 HTTP |

adapter 契约新增 `supports(point): { supported, fallback?, meta? }` 与 `tier(): 1|2|3`（既有 6 方法 conform/translate/install/injectMcp/uninstall/detect 保留）；`translate()` 增强：opts 传入 capability 声明的 `requires`（§22.5）决定降级策略。`supports`/`tier` 由 `adapters/base.mjs` 基类默认实现，国内自研平台接入只需：① 写 platform.yaml；② 实现 6 既有方法（Tier 3 对 install/injectMcp 可返回 unsupported + 降级提示）；③ 注册到 schema enum + CI matrix。

### 22.4 通用降级矩阵（推广 v7 P8）

把 v7 P8 的"不支持 workflow → CLI 引擎兜底"推广为**任意能力原语缺失的统一降级矩阵**，5 类降级策略：

| 降级策略 | 含义 | 触发 |
|---|---|---|
| `cli-engine` | 编排在 OpsForge CLI 引擎（`--run-workflow`），平台只看到一个个可用 skill/agent | 缺 workflow_orchestration / slash_command |
| `http-inject` | 能力不落盘，经平台 HTTP API 注入 system prompt + user input | 缺 agent_file/skill_file 但有 prompt_exec(http-api) |
| `manual-paste` | 生成能力说明书 markdown，用户手动复制到平台 Web UI | 缺 agent_file/skill_file 且 prompt_exec mode=web-ui |
| `http-direct` | MCP 工具不走 stdio/sse 注入，改写为能力 body 内 HTTP 调远端工具 | 缺 mcp_config 但能力可 HTTP 化 |
| `fail-loud` | 拒绝安装，提示换平台 | 能力声明 requires:hard 的能力点缺失 |

降级矩阵（能力点 × kind）：agent/skill 缺 agent_file/skill_file → http-inject 或 manual-paste；mcp 缺 mcp_config → http-direct 或 fail-loud；workflow 缺 slash_command/workflow_orchestration → cli-engine（v7 P8 A）或降级为编排 agent（v7 P8 B）；bundle 按内含能力各自降级。安装时 adapter `translate()` 按矩阵选策略，选 http-direct/manual-paste 时打印降级提示，fail-loud 仅在 requires:hard 时触发。

### 22.5 能力 `requires` 字段（声明硬依赖，决策 D2）

新增可选字段 `requires`（进 `capability.schema.json`，`additionalProperties:false` 不受影响——schema 显式声明新字段）：

```yaml
requires:
  - point: mcp_config
    severity: hard          # hard=缺失则 fail-loud 不装；soft=缺失则降级
  - point: slash_command
    severity: soft
    fallback: cli-engine    # 可选，覆盖默认降级策略
```

缺省 `requires` 时按 §22.4 矩阵默认 soft 降级。业务作者一般不填（缺省走 soft），只在能力确实硬依赖某原语时填 hard。`conform()`（§A.2）增加校验：声明 requires:hard 的能力点在 platforms 声明的每个平台上都须 `supports(point).supported==true`，否则从 platforms 删该平台或 fail。

### 22.6 决策记录（D1–D6，全部按推荐确认）

- **D1** 平台 Tier 分级采用三级（Tier1 全功能 / Tier2 部分功能 / Tier3 仅 prompt），按能力点支持数自动计算。✅ 确认。
- **D2** `requires` 字段进 `capability.schema.json` 作为可选字段（`additionalProperties:false` 不受影响）。业务作者一般不填（缺省走 soft），硬依赖时填 hard。✅ 确认。
- **D3** 国内自研平台能力点声明需 steering 验证：`platform.yaml` 附 `verified_by: steering`，steering 抽样验证能力点真实性；未验证标 `unverified`，`--doctor` 告警不阻断。✅ 确认。
- **D4** `eval.config.yaml` 支持国内模型 endpoint（`judge_model.provider: domestic-http`），复用 Node 内置 fetch（无新 npm 依赖，不违反 §C.1）。✅ 确认。
- **D5** `data-residency-cn` 合规扫描告警不阻断（能力 body 引用境外域名且平台标 data-residency-cn 时告警，steering 审批）。✅ 确认。
- **D6** `report-renderer.mjs` 支持英文（`--lang en` 切换），默认中文（目标用户是中文业务运营）。✅ 确认。

### 22.7 无 SDK/CLI 平台的 dry-run 与 eval 降级（§21.5 扩展）

v8 §21.5 dry-run harness 默认 `claude -p`。国内自研平台无 CLI 时：Tier 2（有 HTTP API）`OPSFORGE_RUNNER=<platform-slug>`，test-runner 经 adapter `supports(prompt_exec).meta.endpoint` 调 HTTP API 跑 prompt，actual = API 返回；Tier 3（仅 Web UI）降级 static-only + human（v8 已有此路径），记 `runner: static-only`，eval 报告标 `runner_limited: true`。judge LLM 用国内模型（D4，`eval.config.yaml` 配 `provider: domestic-http` endpoint）。

### 22.8 全流程交互式向导 `tools/opsforge.mjs`（§8 扩展）

新增 `tools/opsforge.mjs`（steering，§C path 守卫，复用 Node 内置 readline，无新依赖），作为非技术用户统一入口，包裹裸 CLI：`opsforge new`（交互式建能力，替代 new-capability.mjs 裸 CLI）/ `wizard`（端到端从想法到 released）/ `install`（选 pack/选能力/看说明/确认依赖）/ `status`（流转进度可视化 draft→staged→released）/ `doctor`（交互式体检 + plain 报告）/ `report <artifact.json>`（JSON→中文 plain）/ `discover`（列已装能力 + 触发入口 + 质量红绿灯）/ `feedback <capability>`（提交评分）。区分两类用户：能力作者（引导式创作 + 实时质量反馈 + 流转可视化）/ 安装使用者（交互式安装 + plain 报告 + 能力发现 + 错误恢复）。

> **实施状态脚注（2026-07-24 审计 + Phase 3.6 收尾）：** Phase 2.5 曾仅落地**裸子命令分发**（`new`/`wizard`/`install`/`status`/`doctor`/`report`/`discover`），**非**本节设计的顶层菜单/wizard 端到端/discover 质量灯/feedback UX 入口。**Phase 3.6 已全部交付**：`opsforge menu` 顶层菜单（替换 `opsforge.mjs:16-40` 裸 `switch(cmd)`）、`cmdWizard` 端到端 5 步、`cmdDiscover` 读 per-project manifest + 质量灯 + 商用标签、`cmdFeedback`/`cmdFeedbackInteractive` 写 jsonl、`detectPlatform()` 自动探测、`tools/opsforge-bootstrap.mjs` + `tools/opsforge-runtime.mjs` + `~/.opsforge/.runtime-root.json` 无 cwd bootstrap + 载体 B `packs/opsforge-meta/`（agents `opsforge` + `opsforge-installer`，skill `opsforge-wizard`）。bare `node --test` 341/0；6 gates 全绿（7 capabilities）。**架构不变量：** runtime 副本（零 bare-dep 薄 wrapper）经 `.runtime-root.json` 动态 import 仓库根 `install.mjs`（`ajv`/`js-yaml`/`semver` 在仓库 `node_modules` 解析）→ **`~/.opsforge/` 非完全自包含，仓库须在机器上持续存在**才能 in-platform 安装/列能力/doctor；无仓库机器发行版留后续 Phase。工程后端（report-renderer 三报告/`.opsforge-state.json`/`--repair` paste 文件/`--downgrade`/`--project` 转发/HTTP runner）Phase 2.5 已交付。

### 22.9 JSON 报告人类可读渲染层 `tools/report-renderer.mjs`（决策 D6）

把 v8 三份 JSON artifact（validation-report/security-report/eval-report）+ 安装 manifest 翻译成中文 plain 报告。renderer 是纯函数，输入 JSON + 报告类型，输出格式化中文文本。渲染规则：红绿灯（绿 pass / 黄 warning·pending / 红 fail·block）；开头一句话结论（"[绿] 该能力质量合格，可发布"）；每条红/黄项附 plain-language 修复指引；内部规则编号（R16/Q5 等）折叠到"详细技术信息"区默认不展开。模板存 `tools/report-templates/`（steering 维护 `*.md`）。`opsforge new/wizard` 在作者保存 body/tests 后自动跑 validate.mjs(R1–R22) + test-runner(functional runSuite)，输出实时质量反馈（红绿灯 + 一句话结论 + 修复建议）。

### 22.10 流转状态与能力发现

- **`.opsforge-state.json`**：脚手架/promote 写入能力目录的流转状态文件（steering 维护字段，业务作者不碰），`opsforge status` 读它渲染 draft→staged→released→registry 进度 + 下一步指引。
- **`opsforge discover`**：读 manifest + feedback jsonl + eval-history，综合渲染已装能力列表（触发入口 + 质量红绿灯 + degraded 提示）。**实施状态：Phase 3.6 SHIPPED——`cmdDiscover` 已改读 per-project manifest + 质量灯骨架 + 商用标签（替换原读 `registry.yaml` 语义错）；feedback jsonl + eval-history 深度聚合留 Phase 3.2 渐进增强。**
- **错误恢复指引**：`opsforge doctor` 检测到问题时给 plain 修复指引（文件缺失→`--repair`、依赖不满足→装依赖、MCP 配置缺失→`--repair-mcp`、effectiveness degraded→看反馈/联系作者 re-eval/`--downgrade` 回滚、版本落后→`--upgrade`）。`/rate`（v8 Q8 wrapper 注入）、升级（遇 MAJOR breaking 提示 changelog 确认）、回滚（读 manifest history）。

### 22.11 与既有 § 的集成点

| § | 变更 |
|---|---|
| §5 capability 元数据 | 新增可选 `requires` 字段（§22.5） |
| §6.1 平台矩阵 | 扩展为 9 能力点矩阵 + Tier 分级（§22.2/§22.3），不再硬编码 4 平台 |
| §6.2 Adapter 契约 | 新增 `supports(point)`/`tier()`，translate 增强 opts 传 requires（§22.3） |
| §7.2 编排引擎 | v7 P8 推广为通用降级矩阵（§22.4），workflow-compile 按能力点选 cli-engine/http-inject/manual-paste |
| §8 安装器 | 新增 opsforge 向导入口（§22.8）；`--repair`/`--repair-mcp`/`--downgrade` flags；安装后 plain 报告（§22.9） |
| §8.3 doctor | 扩展：平台 Tier 报告 + 能力点缺失 + 降级策略 + 错误恢复指引 + effectiveness 降级指引（§22.10） |
| §9.1 MCP 形态 | 新增 http-direct 降级形态（缺 mcp_config 时 mcp 改写为 body 内 HTTP 调用） |
| §11.2 三态 | `opsforge status` 可视化流转进度；`.opsforge-state.json` 由脚手架/promote 写入 |
| §14 约束清单 | 追加：requires 字段合规、platform.yaml 能力点声明合规、降级策略合规（translate 产物符合降级矩阵）、能力点声明真实性（D3 verified_by） |
| §A.2 规范审核 | `conform()` 加"平台能力点满足能力 requires"校验（requires:hard 的能力点在 platforms 每个平台都须 supports==true） |
| §B.1 安全门禁 | 追加 data-residency-cn 远端 URL 扫描（§22 决策 D5，告警不阻断） |
| §C.4 CI 规则表 | 追加：platform.yaml schema 校验、adapter 能力点声明真实性、opsforge.mjs/report-renderer.mjs 列入 steering path 守卫 |
| §C.6 决策清单 | 追加收归：平台能力点声明、Tier 分级、降级策略矩阵、judge 国内模型配置 |
| §16 风险表 | 追加：国内平台能力点虚报、降级产物行为偏离、交互向导误操作、报告渲染误导 |
| §17 路径索引 | 新增：adapters/base.mjs、adapters/<platform>/platform.yaml、schema/platform.schema.json、tools/opsforge.mjs、tools/report-renderer.mjs、tools/report-templates/、.opsforge-state.json |
| §20.3（v7 集成） | v7 P8 单点兜底被 §22.4 通用降级矩阵吸收；P8 的 A/B 策略成为矩阵 cli-engine/orchestration-agent 两行 |
| §21.5（v8 dry-run） | 扩展：`OPSFORGE_RUNNER=<platform-slug>` 经 adapter HTTP API 跑 prompt；Tier 3 降级 static-only + human（§22.7） |

### 22.12 Phase 映射（沿用 §15 / §20.4 / §21.13 编号）

| Phase | v9 交付 |
|---|---|
| **Phase 1 (MVP)** | `tools/opsforge.mjs` 最小版（new/install/status/doctor 基础）；`tools/report-renderer.mjs` 最小版（渲染 validation-report，红绿灯 + 一句话结论）；`.opsforge-state.json`；`adapters/base.mjs` 基类（supports/tier）；现有 4 平台补 platform.yaml；capability.schema.json 追加 requires 可选字段。**不**含国内自研平台 adapter、不含通用降级矩阵实现。 |
| **Phase 2** | 通用降级矩阵实现（translate 按能力点选降级策略）；国内自研平台 adapter 示例（1 个 Tier 2 + 1 个 Tier 3）；platform.schema.json；opsforge report 渲染三份 JSON 报告；install --repair/--repair-mcp（载体 D paste 文件）；report-templates 完整模板集；OPSFORGE_RUNNER=<platform> 经 adapter HTTP API 跑 prompt；`release.mjs` 写 released/registry state；`doctor --project` 转发。**工程后端 COMPLETE；UX shell（顶层菜单/wizard 端到端/discover 质量灯/feedback/无 cwd/载体 B/平台内安装入口）原 DEFERRED to Phase 3.6，现已由 Phase 3.6 全部交付。** |
| **Phase 3** | http-direct mcp 降级形态；data-residency-cn 安全扫描；eval.config.yaml 国内模型 provider；install --downgrade 回滚；opsforge feedback 交互式；降级产物行为偏离 CI 校验（降级安装后跑 eval 对比原装）；--doctor 平台 Tier 报告 + 能力点真实性抽检（D3）。 |
| **Phase 3.6** | **SHIPPED 2026-07-24（v9 UX shell closure，Phase 2.5 deferred 集中于此，先于 Phase 4）：** 顶层菜单（`opsforge menu` 替换裸分发）；`opsforge wizard` 端到端 5 步；`opsforge discover` 读 per-project manifest + 质量灯 + 商用标签；`opsforge feedback` UX 入口（写 jsonl）；无 cwd bootstrap（`opsforge-runtime.mjs` `resolveWorkDir()` 三级回退 + `~/.opsforge/.runtime-root.json`）；载体 B（`packs/opsforge-meta/` meta-pack：`agents/opsforge` + `agents/opsforge-installer` + `skills/opsforge-wizard`）；菜单引导；平台内安装入口（`opsforge-bootstrap.mjs` + `detectPlatform()`）；实时质量反馈 wizard 串接。平台可行性：claude-code/cursor/cline ✅、codex ⚠、dify ❌退 D。bare `node --test` 341/0；6 gates 全绿（7 caps）。**架构不变量：** runtime 副本动态 import 仓库根 `install.mjs` → 仓库须持续存在；无仓库机器发行版留后续 Phase。 |
| **Phase 4** | 国内自研平台生态：3+ 国内平台接入；降级策略 A/B 测试（http-direct vs manual-paste）；报告渲染趋势看板（随 v7/v8 eval-history 演进）；多语言报告（--lang en）；平台能力点自动探测（detect() 探测实际能力点，而非只读声明）。 |

### 22.13 相关文件路径（均以 `D:\XD\ClaudeCode\sy-eeo\` 为根，未创建属 v9 新增/扩展）

**Gap 1（平台兼容性）**：
- 新增：`adapters/base.mjs`、`schema/platform.schema.json`、`adapters/<platform>/platform.yaml`（每平台一份，含现有 4 平台补齐 + 国内自研平台）
- 扩展：`schema/capability.schema.json`（platforms enum 追加 + requires 可选字段）、`adapters/<platform>/adapter.mjs`（实现 supports/tier 或继承 base.mjs）、`tools/test-runner.mjs`（OPSFORGE_RUNNER=<platform> HTTP API 路径）、`tools/security-scan.mjs`（data-residency-cn 扫描）、`tools/eval.config.yaml`（国内模型 provider）、`docs/platform-matrix.md`（Tier + 能力点表）

**Gap 2（UX）**：
- 新增：`tools/opsforge.mjs`、`tools/report-renderer.mjs`、`tools/report-templates/`（`*.md` 模板）、`.opsforge-state.json`（能力目录内，脚手架写入）
- 扩展：`tools/new-capability.mjs`（写 .opsforge-state.json）、`tools/validate.mjs`（.opsforge-state.json 字段校验）、`install.sh`/`install.mjs`（--repair/--repair-mcp/--downgrade flags + 安装后调 report-renderer.mjs 渲染 plain 报告）

**Phase 3.6 新增/扩展文件清单（v9 UX shell closure，Phase 2.5 deferred 项 — SHIPPED 2026-07-24）：**
- 新增：`tools/opsforge-bootstrap.mjs`（自举入口：install opsforge-meta caps + 复制薄 runtime wrapper 到 `~/.opsforge/runtime/tools/` 保布局 + 平铺 `registry*.yaml` 到 `~/.opsforge/` + 写 `~/.opsforge/.runtime-root.json` 记录仓库根）、`tools/opsforge-runtime.mjs`（零 bare-dep 薄 wrapper：`resolveWorkDir()` 三级回退 + `runInstall`/`runList`/`runDoctor` 委托仓库根 `install.mjs` 经 `pathToFileURL` 动态 import）、`packs/opsforge-meta/`（载体 B meta-pack：`pack.yaml` + `agents/opsforge/` + `agents/opsforge-installer/` + `skills/opsforge-wizard/`，3 个 dogfood 能力）、运行时镜像 `~/.opsforge/registry.yaml`（install.mjs `readRegistryForInstall` home 回退读这里）、`~/.opsforge/.runtime-root.json`（runtime 副本据此找仓库根）
- 扩展：`tools/opsforge.mjs`（替换裸 `switch(cmd)` 分发为顶层菜单 `opsforge menu` + `cmdWizard` 端到端 5 步 + `cmdDiscover` 读 per-project manifest + 质量灯 + 商用标签 + `cmdFeedback`/`cmdFeedbackInteractive` 写 jsonl + `detectPlatform()` 自动探测）、`install.mjs`（`readRegistryForInstall` 增 home 回退）、`CODEOWNERS` + `ci/guardrails.yml`（扩展覆盖 `packs/opsforge-meta/` + 新 tools）
