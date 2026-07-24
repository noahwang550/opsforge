# OpsForge 设计补遗 v7 — 循环工作流执行 与 可组合自定义安装

> **ARCHIVED — historical design rationale, not authoritative.** This supplement's file-level blueprint has been realized into code + `DESIGN.md` + `ARCHITECTURE-DELTA.md` in Phase 1. The confirmed decisions (P1–P8) are recorded in `PLAN.md` §20.9. Kept here as design-history. For the current authoritative spec, read `PLAN.md` §20.

> 本文是 PLAN.md (v6) 的设计补遗，仅覆盖两个 v6 未充分定义的缺口。不重述既有规范，只新增/扩展设计，并标注对现有 § 的影响。待 steering 决策项标记为「决策 Pn」。Phase 编号沿用 §15。所有路径绝对，以 `D:\XD\ClaudeCode\sy-eeo\` 为仓库根（per PROGRESS.md 的 D0，无 `opsforge/` 子目录）。

---

## 概述

v6 在 §7 给出了线性的 `workflow.yaml`（§7.1）与三种执行模式（§7.2），在 §8 给出了 `--install/--pack/--bundle/--brand` 安装语义，在 §2 定义了 Bundle 作为「场景套装」。但两个真实诉求未被覆盖：

1. **循环工作流**：业务任务（如会员制咨询）是一个带数据充分性判断、补数回流、人审确认的闭环，§7.1 的线性 steps 表达不了 loop/switch/HITL；§7.2 没说明运行期状态如何在步骤间流转与沉淀；也没说明业务人员如何在平台上「一条命令/斜杠」触发整个闭环。
2. **可组合自定义安装**：仓库是资源仓，不同项目要装不同子集（pack A 的 3 个 skill + pack B 的 2 个 agent + 1 个 mcp + 1 个 workflow，作为一个可复现单元版本锁定）。§8 的 `--bundle` 是 contributor 发布的预设套装，不是消费方自定义组合；没有 lock 文件、没有传递依赖解析、没有跨项目复用。

本补遗给出可落地的 schema、CLI、文件路径与 Phase 映射。

---

## Gap 1 — 循环工作流执行

### 1.1 控制流扩展（workflow.yaml schema）

§7.1 的 `steps:` 是有序线性表。v7 将其拆为两部分（**决策 P1**）：

- `steps:` — 步骤**目录**（无序声明），每步定义「做什么、输入输出契约」。每个 step 有 `id`（步骤内唯一）、`capability`（`<pack>.<name>@<range>`）或 `kind: checkpoint`（人审）。
- `control_flow:` — 步骤**编排树**（新增顶层字段），用三种控制节点表达顺序/循环/分支。

新增控制节点：

| 节点 | 字段 | 语义 | JSON-Schema 可表达? |
|---|---|---|---|
| `sequence` | `steps: [<step-id>...]` | 顺序执行 | 是（结构） |
| `loop` | `kind: until\|while`, `condition: <expr>`, `body: <控制节点或 step-id 列表>`, `max_iterations: <int\|expr>`, `on_max: fail\|continue` | until=先执行 body 再判 condition；while=先判再执行 | 结构是；condition 求值需运行时 |
| `switch` | `on: <expr>`, `cases: { value: <控制节点> }`, `default: <控制节点>` | 按表达式值分支 | 结构是；求值需运行时 |
| `checkpoint` | 作为 step `kind: checkpoint`，字段 `prompt`/`approve_to`/`on_reject`/`timeout` | HITL：引擎暂停，把 prompt 与上下文交给操作者，等确认 | 结构是；暂停/握手需运行时 |

新增顶层字段：

- `vars:` — 工作流级可变状态声明（id/type/default/enum），区别于 `params`（调用方注入、只读）。`vars` 在运行期被 step `outputs` 写入、被后续 step `inputs` 与 `control_flow.condition` 读取。这是「用了就沉淀」(§7.3) 的运行期载体。
- `kb_mount:` — 布尔，声明此 workflow 期望挂载团队知识库 MCP（见 §1.5）。

`inputs`/`outputs` 表达式语法沿用 §7.1 的 `{{...}}`：`{{params.x}}`、`{{vars.y}}`、`{{steps.<id>.<output>}}`（§7.1 已有 steps 互引；v7 加 vars 互引）。表达式求值属运行时。

### 1.2 会员制咨询闭环 workflow.yaml（完整示例）

文件：`packs/growth-team/workflows/membership-consulting/workflow.yaml`（Phase 3 示例，Phase 1 仍用 §7.1 线性示例）。

```yaml
id: growth-team.membership-consulting
version: 0.1.0
kind: workflow
pack: growth-team
owner: growth-team
display_name: 会员制咨询闭环工作流
display_name_zh: 会员制咨询闭环工作流
display_name_en: Membership Consulting Loop
description: 取数表→SQL 取数→数据充分性评估→不足则补数并回流取数→策略→数据挖掘→输出
platforms: [claude-code]
params_schema: params.schema.json
kb_mount: true
vars:
  - { id: extract_spec, type: object }
  - { id: sql_text, type: string }
  - { id: last_rows, type: object }
  - { id: sufficiency, type: string, enum: [sufficient, insufficient] }
  - { id: gaps, type: array }
  - { id: plan, type: object }
  - { id: insights, type: array }
  - { id: iteration, type: integer, default: 0 }
  - { id: max_iterations, type: integer, default: 3 }
steps:
  - id: build_extract_spec
    capability: growth-team.extract-spec-builder@>=1.0
    inputs: { goal: "{{params.goal}}", audience: "{{params.audience}}" }
    outputs: { extract_spec: "{{vars.extract_spec}}" }
  - id: gen_sql
    capability: growth-team.sql-generator@>=1.0
    inputs: { spec: "{{vars.extract_spec}}", hints: "{{params.schema_hints}}" }
    outputs: { sql_text: "{{vars.sql_text}}" }
  - id: approve_sql
    kind: checkpoint
    prompt: "审阅取数 SQL（目标：{{params.goal}}）：\n```sql\n{{vars.sql_text}}\n```"
    approve_to: exec_sql
    on_reject: revise_sql
    outputs: { approved_at: "{{vars.sql_approved_at}}" }
  - id: revise_sql
    capability: growth-team.sql-generator@>=1.0
    inputs:
      spec: "{{vars.extract_spec}}"
      feedback: "{{checkpoint.approve_sql.feedback}}"
    outputs: { sql_text: "{{vars.sql_text}}" }
  - id: exec_sql
    capability: growth-team.sql-executor-mcp@>=1.0
    inputs: { sql: "{{vars.sql_text}}", dsn_env: "OPS_DSN" }
    outputs: { rows: "{{vars.last_rows}}" }
  - id: assess
    capability: growth-team.sufficiency-assessor@>=1.0
    inputs: { rows: "{{vars.last_rows}}", spec: "{{vars.extract_spec}}", goal: "{{params.goal}}" }
    outputs: { verdict: "{{vars.sufficiency}}", gaps: "{{vars.gaps}}" }
  - id: supplement
    capability: growth-team.data-miner@>=1.0
    inputs: { gaps: "{{vars.gaps}}", existing: "{{vars.last_rows}}" }
    outputs: { augmented: "{{vars.last_rows}}" }
  - id: strategy
    capability: growth-team.membership-strategist@>=1.0
    inputs: { rows: "{{vars.last_rows}}", goal: "{{params.goal}}" }
    outputs: { plan: "{{vars.plan}}" }
  - id: mine
    capability: growth-team.data-miner@>=1.0
    inputs: { rows: "{{vars.last_rows}}", plan: "{{vars.plan}}" }
    outputs: { insights: "{{vars.insights}}" }
control_flow:
  - type: sequence
    steps: [build_extract_spec, gen_sql]
  - type: loop
    kind: until
    condition: "{{checkpoint.approve_sql.approved}} == true"
    body: [approve_sql]
    max_iterations: 5
    on_max: fail_with_message
  - type: loop
    kind: until
    condition: "{{vars.sufficiency}} == 'sufficient'"
    body:
      - type: sequence
        steps: [exec_sql, assess]
      - type: switch
        on: "{{vars.sufficiency}}"
        cases:
          insufficient: [supplement]
          sufficient: []
    max_iterations: "{{vars.max_iterations}}"
    on_max: fail_with_message
  - type: sequence
    steps: [strategy, mine]
outputs:
  plan: "{{vars.plan}}"
  insights: "{{vars.insights}}"
  final_sql: "{{vars.sql_text}}"
  extract_spec: "{{vars.extract_spec}}"
```

`params.schema.json` 声明 `goal`/`audience`/`schema_hints`/`ops_dsn`。`OPS_DSN` 走 §B.2 env 白名单（mcp 的 `auth_schema` 声明），密钥不入仓。

### 1.3 JSON-Schema 可表达 vs 运行时引擎

| 项 | 归属 | 实现位置 |
|---|---|---|
| `steps`/`control_flow`/`vars` 结构合法性、字段集、`additionalProperties:false` | JSON-Schema（`schema/workflow.schema.json` 扩展） | `tools/validate.mjs` R1 |
| step `id` 唯一、`capability` 引用格式、`outputs` 名与 `vars` 声明一致 | 运行时（语义层） | `tools/validate.mjs` 新增 R_wf_ref 规则 |
| `control_flow` 引用的 step-id 全部存在于 `steps` | 运行时（图闭合） | `tools/validate.mjs` 新增 R_wf_closed |
| `{{...}}` 表达式语法、condition 求值、循环计数、checkpoint 暂停/握手 | 运行时引擎 | `tools/workflow-compile.mjs` Phase 2/3 |
| 平台 surfacing 产物生成（slash-command/commands） | 运行时引擎 | `tools/workflow-compile.mjs` + 各 adapter |

**Phase 1 只实现 `sequence` + 线性 steps（即 §7.1 原貌），`control_flow` 字段可选、缺省即按 `steps` 顺序。** 循环/switch/checkpoint 的运行时求值在 Phase 3。

### 1.4 平台 surfacing（如何触发）

**决策 P2**：workflow 在安装期由 `tools/workflow-compile.mjs` + adapter 编译为「平台原生的一等调用入口」，业务人员一条斜杠/命令触发，参数经 flags 或 `.opsforge-params.yaml` 注入。映射到 §6.1：

| 平台 | surfacing 形态 | 触发方式 |
|---|---|---|
| Claude Code | `~/.claude/commands/workflow-<name>.md`（含 frontmatter + 编译后的编排 body） | `/workflow membership-consulting --goal=... --audience=...` |
| Cursor | `.cursor/commands/workflow-<name>.mdc` | `/workflow membership-consulting` |
| Codex | `~/.codex/commands/workflow-<name>.md` + 一个薄 CLI wrapper 调 `install.mjs --run-workflow` | `codex run workflow membership-consulting ...` 或后台 `./install.sh --run-workflow ...` |
| Cline | `.cline/commands/workflow-<name>.md` | Cline 命令面板 |

补一条 CLI（所有平台通用，Codex/远程批跑主路径）：

```
./install.sh --run-workflow <pack>.<name>[@<ver>] --params <path|inline-json> [--resume <run-id>] [--brand <brand>]
./install.sh --list-runs <workflow-id>
./install.sh --abort <run-id>
```

非开发者默认路径：Claude Code 里 `/workflow membership-consulting`，参数用自然语言由 agent 填进 `.opsforge-params.yaml`。Phase 1 仅交付 Claude Code slash-command + 线性工作流。

### 1.5 状态与持久化（「用了就沉淀」闭环）

**决策 P3**：引入 per-run 工作目录与团队知识库 MCP mount，均受 §B.2 运行时安全约束。

- **Per-run 工作目录**：`~/.opsforge/runs/<workflow-id>/<run-id>/`
  - `state.json` — `{run_id, workflow_id, version, current_node, completed_steps[], vars{}, iteration_counts{}, status, started_at, updated_at}`
  - `artifacts/<step-id>/<output-name>.json` — 每个 step 产出物（取数表、SQL、查询结果、挖掘洞察）落盘，step 间互引可读 `{{artifacts.<step>.<out>}}` 或经 `vars`
  - `run.log` — 引擎事件流
  - `params.snapshot.yaml` — 本次入参快照
- **团队知识库 MCP**（§9.1 形态 1 声明式 MCP，`kb_mount: true` 触发）：server URL 指向 `~/.opsforge/kb/<pack>/`（或团队远端），安装时 `injectMcp` 注入 `opsforge-kb` server，权限按 §B.2 env 白名单 + 隔离写入路径（品牌 workflow 的 KB 路径限定 `customers/<brand>/` 下）。workflow 的 `mine_insights`/`strategy` 步骤可写 KB，下次 `build_extract_spec` 可读 KB 历史 spec —— 即 §7.3「沉淀」闭环。

安全对齐：`state.json` 不存密钥；MCP 远端 URL 经 §B.1 SSRF 扫描；KB 写入路径在 manifest `security_policy` 记录。

### 1.6 重入与恢复

- `run-id` = uuid，由 `--run-workflow` 生成并回显。
- 引擎在每个控制节点边界写 `state.json`（原子写 + fsync）。
- `--resume <run-id>`：读 `state.json`，从 `current_node` 续跑；checkpoint 类节点重新发起人审请求。
- `--list-runs <workflow-id>`：列最近 N 个 run 及状态。
- `--abort <run-id>`：标记 status=aborted，释放任何等待中的 checkpoint。
- 超过 `max_iterations` 的 loop 按 `on_max` 行为：`fail_with_message` 写 `state.status=failed` 并把已产出 artifacts 留存供诊断。

### 1.7 与三态能力生命周期的组合

- workflow.yaml 本身是 capability，走 §11.2 三态：`_drafts`（只校验结构 + steps 引用可解析）→ `_staged`（加 R_wf_ref/R_wf_closed + checkpoint prompt 无注入模式）→ 正式区（加 §A 平台 conformance：编译产物在声明 platforms 上可生成）。**Phase 1 的 §7.1 线性 workflow 即此流程的最小子集。**
- run（`state.json`/artifacts）是运行时产物，不入仓、不入 registry，不参与三态。
- KB 中的「沉淀」内容若要被其它 workflow 复用并版本化，需另行沉淀为 capability（经 `new-capability.mjs` 入库走三态），不直接把 KB 当 registry。

### 1.8 Gap 1 → Phase 映射

| Phase | 交付 |
|---|---|
| **Phase 1 (MVP)** | §7.1 线性 workflow（sequence only，无 loop/switch/checkpoint）；Claude Code slash-command `/workflow <name>`；per-run `state.json` + artifacts 落盘（无 resume）；`kb_mount` 字段预留但不注入。**不镀金 Phase 1。** |
| **Phase 2** | 多平台 slash-command 编译（cursor/codex/cline）；`switch` + `if` 运行时求值；`--run-workflow` CLI；KB MCP 注入（沉淀闭环开环）。 |
| **Phase 3** | `loop`(until/while) + `max_iterations` + `on_max`；`checkpoint` HITL 握手；`--resume/--list-runs/--abort`；`vars` 跨迭代累积；完整 §1.2 会员制咨询示例入库。 |

---

## Gap 2 — 可组合自定义安装

### 2.1 Profile 概念

引入 **Profile**：消费方（项目）自定义的安装清单，声明「这个项目要装哪些能力原子（含 workflow/bundle/mcp），各 pin 到什么 semver range」，配合 lock 文件保证可复现。

**决策 P4**：Profile **不是** capability kind，不进 registry、不走三态、不版本化在 OpsForge 仓库内。它是**目标项目仓库内**的安装清单（类比 `package.json` 之于应用项目，vs OpsForge 仓库是「npm registry」）。理由：Profile 的所有者与生命周期属于消费方项目，而非 OpsForge 贡献者；若强行纳入 capability kind 会污染三态语义并要求消费方走 OpsForge 的 PR 流程。Profile 仍由 `tools/new-capability.mjs --kind profile`（或独立 `tools/profile.mjs`，见 §2.8）scaffold 出骨架，但骨架放在**目标项目**而非 OpsForge 仓库。

### 2.2 Profile 与 Bundle 的区别

| 维度 | Bundle（§2 已有） | Profile（v7 新增） |
|---|---|---|
| 所有者 | OpsForge contributor（发布方） | 消费方项目 |
| 位置 | OpsForge 仓库 `packs/<slug>/bundles/` 或 `bundles/` | 目标项目根 `profile.yaml` + `profile.lock.json` |
| 版本化 | 是，semver，进 registry | 否（lock 文件 pin commit） |
| 内容 | 场景套装（contributor 选定） | 任意子集（消费方自选，可引用 bundle + 散落 capability） |
| 触发 | `--bundle <bundle-id>` | `--profile <path>` |

一个 Profile 可引用一个或多个 Bundle（`bundles: [growth-starter@>=1.0]`），并叠加额外散落 capability。安装时先展开 bundle，再叠加散落项。

### 2.3 profile.yaml schema

新文件：`schema/profile.schema.json`（JSON Schema draft-07，`additionalProperties:false`，steering 维护）。

```yaml
# 目标项目根的 profile.yaml
profile_version: 1                  # profile schema 版本
project: my-growth-stack            # 消费方项目 slug（命名规则同 pack）
platform: claude-code               # 目标平台（可被 CLI --platform 覆盖）
capabilities:
  - growth-team.sql-generator@>=1.0
  - growth-team.membership-strategist@>=1.0
  - third-party.bi-connector@>=1.2 <2.0
workflows:
  - growth-team.membership-consulting@>=0.1     # 装它会传递拉取其 steps 的 capability
bundles:
  - growth-team.growth-starter@>=1.0            # 展开后并入 capabilities 列表
mcps:
  - growth-team.sql-executor-mcp@>=1.0
brand: acme-corp                    # 可选：若此 profile 装品牌定制能力
kb_mount: true                      # 可选：注入团队 KB MCP
```

`profile.yaml` 是 .yaml，业务作者可手写或由 scaffold 生成（§2.8），符合 §C「业务作者只写 .md/.yaml/.json」基线。

### 2.4 依赖解析器

新工具：`tools/resolve-profile.mjs`（steering 维护，Phase 2/3）。安装 `--profile` 时调用。算法：

1. 读 `profile.lock.json`（若存在且 `--fresh` 未指定）→ 直接按 lock 装。
2. 否则展开 `bundles` → 并入 `capabilities`/`workflows`/`mcps`。
3. 对每个 workflow，解析其 `steps[].capability` 与 `vars`/`control_flow` 引用的 capability，加入待装集（传递依赖）。
4. 对每个 capability，解析其 `depends_on`（§13.4），拓扑排序加入。
5. semver range 求解：从 registry（通用 + `--brand` 段）取 `current`，取满足所有 range 的最高版本；多 range 取交集，冲突即 fail-loud（`resolve: conflict on <id>: <rangeA> ∩ <rangeB> = ∅`）。
6. **品牌隔离**（§13.4 方向约束）：`brand:` 字段存在时，解析闭包不得包含其它品牌的定制能力；通用能力可引用；品牌能力可引用通用 + 同品牌 + third-party。违反即 block 并给冲突路径。
7. **循环检测**：depends_on 图成环即 block（沿用 §13.4 CI 规则）。
8. 输出解析闭包 → 写/更新 `profile.lock.json` → 调 adapter `translate()`+`install()`。

### 2.5 profile.lock.json

新文件类型（目标项目内）：`profile.lock.json`，类比 `package-lock.json`。

```json
{
  "profile_version": 1,
  "locked_at": "2026-07-23T10:00:00Z",
  "installer_version": "0.1.0",
  "platform": "claude-code",
  "brand": "acme-corp",
  "entries": [
    {
      "id": "growth-team.membership-consulting",
      "version": "0.1.0",
      "source_commit": "a1b2c3d",
      "registry": "registry.yaml",
      "kind": "workflow",
      "deps": ["growth-team.sql-generator@1.0.0", "growth-team.membership-strategist@1.0.0", "..."]
    }
  ]
}
```

- **可复现性**：lock pin 精确 version + source commit；`--profile` 读 lock 时按 commit 取源，bit-identical 重装。
- **提交位置**：目标项目仓库（非 OpsForge 仓库）。**决策 P5**：确认 lock 与 profile.yaml 一起提交到目标项目。
- **升级**：`--upgrade --profile` 在 range 约束内升级，重写 lock；遇 breaking（MAJOR 跨越）要求 `--confirm`。
- **漂移检测**：`--doctor --profile` 比对 lock 与目标平台 manifest，报漂移项。

### 2.6 CLI 扩展（install.sh / install.mjs）

```
./install.sh --profile <path-to-profile.yaml>            # 按 profile 装（读 lock 或解析+写 lock）
./install.sh --profile <path> --fresh                    # 忽略 lock，重新解析
./install.sh --profile-save <path>                       # 把当前已装集合快照为 profile.yaml
./install.sh --profile-lock                              # 仅生成/更新 lock 不实装
./install.sh --upgrade --profile [<path>]                # 在 range 内升级
./install.sh --doctor --profile [<path>]                # 比对 lock vs manifest
./install.sh --run-workflow <id> --params <yaml>        # 见 §1.4
```

非开发者主路径：项目仓库根放 `profile.yaml`，一条 `./install.sh --profile ./profile.yaml` 装齐所有能力 + workflow + MCP，幂等。Phase 1 不交付 `--profile`。

### 2.7 冲突与共存（多 profile / 多项目同机）

同一机器多个项目（各自 profile）并存：

- **命名空间隔离**：pack id 即命名空间（`<pack>.<name>`），跨 profile 不会撞名。
- **Manifest 隔离**：每个平台目标目录的 `.opsforge-manifest.json` 改为按 profile 分文件：`~/.opsforge/manifests/<project-slug>.manifest.json`，install/uninstall/doctor 按 `--profile` 的 project slug 路由。
- **安装产物共存**：能力文件（agents/skills/commands）按 pack id 命名落盘，天然不覆盖；品牌能力受 §B.2 隔离写入路径约束。
- **冲突场景**：两 profile 装同一 capability 不同版本 → lock 各自 pin，但平台目标目录只能有一份当前版本。**决策 P6**：同机多 profile 若 pin 同一 capability 不同 version，`--doctor` 报 warning，以最后安装的版本为准（manifest 记录 owner profile），不阻断；要求严格隔离的项目用容器/独立用户目录。

### 2.8 创作入口

**决策 P7**：Profile 的 scaffold 走 `tools/new-capability.mjs --kind profile`，但**目标路径默认是 cwd（目标项目根），不写进 OpsForge 仓库**。新增骨架 `templates/profile/`：

```text
templates/profile/
├── profile.yaml          # __FILL_ME__ 占位
├── README.md
└── CHANGELOG.md
```

`profile.yaml` 骨架：

```yaml
profile_version: 1
project: __FILL_ME__
platform: __FILL_ME__
capabilities: []            # __FILL_ME__
workflows: []
bundles: []
mcps: []
# brand: __BRAND_SLUG__
# kb_mount: false
```

`new-capability.mjs` 的 `--kind profile` 分支：不预填 `version`（profile 无版本），不进 `_drafts/`，写到 cwd 或 `--out <dir>`。validate.mjs 新增 `--profile <path>` 子模式校验 profile.schema.json。这保持「业务作者只写 .yaml、唯一入口是脚手架」基线（§C.2/C.5），不破坏 path 守卫（profile.yaml 在目标项目，不在 OpsForge 仓库）。

### 2.9 Gap 2 → Phase 映射

| Phase | 交付 |
|---|---|
| **Phase 1 (MVP)** | `--install <id>` + `--pack` + `--bundle`（PLAN §8 已列）；**直接依赖解析**（装 workflow 时拉取其 `steps[].capability`，单层，无 lock）。这是 Phase 1 能装通 §7.1 示例 workflow 的必要前提。 |
| **Phase 2** | `profile.yaml` schema + `--profile` + `--profile-save` + `profile.lock.json`（单平台、单 contributor 命名空间、semver 精确 pin，不做 range 交集）；`templates/profile/` + `--kind profile` scaffold；`tools/resolve-profile.mjs` 最小版。 |
| **Phase 3** | 完整 resolver：semver range 交集、冲突 fail-loud、品牌隔离闭包校验、循环检测、`--upgrade --profile`、`--doctor --profile`、多 profile manifest 隔离。 |

---

## 与现有 PLAN.md 的集成点

| § | 变更 |
|---|---|
| §2 概念表 | 新增行：**Profile** = 消费方项目的自定义安装清单（不进 registry、不走三态、不入 OpsForge 仓库）。Bundle 语义不变。 |
| §6.1 平台矩阵 | commands 路径列新增 `workflow-<name>.md` 占位（由 workflow-compile 在安装期生成）。 |
| §7.1 workflow.yaml | `steps` 重定义为「步骤目录」（不再隐含执行顺序）；新增顶层 `control_flow`/`vars`/`kb_mount`。Phase 1 `control_flow` 可缺省（按 `steps` 声明顺序线性执行，保持向后兼容）。 |
| §7.2 编排引擎 | 明确 `tools/workflow-compile.mjs` 两阶段：Phase 1 编译线性 sequence→slash-command；Phase 2 加 switch；Phase 3 加 loop+checkpoint+resume。 |
| §7.3 参数化与复用 | 「输出挂载到团队知识库」具体化为 `kb_mount:true` → `injectMcp` 注入 `opsforge-kb` MCP（§9.1 形态 1），KB 路径 `~/.opsforge/kb/<pack>/`。 |
| §8 安装器 | 新增 flags：`--run-workflow`、`--list-runs`、`--abort`、`--profile`、`--profile-save`、`--profile-lock`、`--fresh`、`--doctor --profile`。 |
| §9.1 MCP 形态 | 新增一种运行期 MCP：`opsforge-kb`（声明式，由 workflow `kb_mount` 触发，非 contributor 发布）。 |
| §11.2 三态 | workflow 三态校验加 R_wf_ref（steps 引用可解析）/ R_wf_closed（control_flow 引用闭合）两条规则。run/KB 不入三态。 |
| §13.4 depends_on | Profile resolver 复用方向约束与循环检测；新增「profile 闭包不得跨品牌」规则。 |
| §14 约束清单 | 加三项：profile.schema 合规、profile.lock 与 manifest 一致性（doctor）、workflow control_flow 闭合。 |
| §15 路线 | Phase 1 增「装 workflow 时单层传递依赖」；Phase 2 增「profile + lock + switch + 多平台 slash-command + KB 注入」；Phase 3 增「loop + checkpoint + resume + 完整 resolver + 会员制咨询示例」。Phase 4 不变。 |
| §17 路径索引 | 新增：`schema/profile.schema.json`、`templates/profile/`、`tools/resolve-profile.mjs`、`tools/workflow-compile.mjs`（扩展）、`~/.opsforge/runs/`、`~/.opsforge/kb/`、`~/.opsforge/manifests/`。 |
| §C 工程基线 | profile.yaml/lock 是 .yaml/.json，符合「业务作者只写 .md/.yaml/.json」；resolve-profile.mjs/workflow-compile.mjs 属 steering 工具（path 守卫）。 |

---

## 待决策清单

- **决策 P1**：workflow 拆 `steps` 目录 + `control_flow` 编排树（推荐）vs 内联控制构造。推荐前者，因循环/嵌套用树表达更清晰，且 Phase 1 可令 `control_flow` 缺省退化到 §7.1 线性。
- **决策 P2**：workflow surfacing = 安装期编译为平台原生调用入口（slash-command / commands）+ `--run-workflow` CLI 双轨。推荐「是」，让非开发者一条斜杠触发。
- **决策 P3**：per-run 工作目录 `~/.opsforge/runs/` 与 KB `~/.opsforge/kb/` 的路径约定。需 steering 确认是否用 `~/.opsforge/` 还是并入各平台目录（如 `~/.claude/opsforge/`）。推荐独立 `~/.opsforge/` 便于跨平台。
- **决策 P4**：Profile 不作为 capability kind、不入 OpsForge 仓库、走目标项目。推荐「是」，避免污染三态。
- **决策 P5**：`profile.lock.json` 与 `profile.yaml` 一起提交到目标项目仓库。推荐「是」。
- **决策 P6**：同机多 profile 装同一 capability 不同 version，以最后安装版本为准 + doctor warning，不阻断。推荐「是」（严格隔离走容器/独立用户）。
- **决策 P7**：Profile scaffold 走 `new-capability.mjs --kind profile`（写 cwd，不进 OpsForge 仓库），新增 `templates/profile/`。推荐「是」，保持单一新建入口的基线一致性。

---

## 相关文件路径（绝对，均未创建，属本补遗规划的新增/扩展产物）

- 新增 schema：`D:\XD\ClaudeCode\sy-eeo\schema\profile.schema.json`；扩展 `D:\XD\ClaudeCode\sy-eeo\schema\workflow.schema.json`（加 `control_flow`/`vars`/`kb_mount`）
- 新增模板：`D:\XD\ClaudeCode\sy-eeo\templates\profile\`
- 新增/扩展工具：`D:\XD\ClaudeCode\sy-eeo\tools\resolve-profile.mjs`、`D:\XD\ClaudeCode\sy-eeo\tools\workflow-compile.mjs`；`D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs`（加 R_wf_ref / R_wf_closed / profile 校验子模式）、`D:\XD\ClaudeCode\sy-eeo\tools\new-capability.mjs`（加 `--kind profile` 分支）
- 扩展安装器：`D:\XD\ClaudeCode\sy-eeo\install.sh`、`D:\XD\ClaudeCode\sy-eeo\install.mjs`
- Phase 3 示例 workflow：`D:\XD\ClaudeCode\sy-eeo\packs\growth-team\workflows\membership-consulting\workflow.yaml`
- 运行期目录（目标机器，非仓库）：`~/.opsforge/runs/`、`~/.opsforge/kb/`、`~/.opsforge/manifests/`
