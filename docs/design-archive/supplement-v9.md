# OpsForge 设计补遗 v9 — 国内自研平台强兼容性层 与 全流程非技术用户 UX

> **ARCHIVED — historical design rationale, not authoritative.** This supplement's platform-points model + UX blueprint has been realized into `adapters/claude-code/platform.yaml` + `tools/opsforge.mjs` + `tools/report-renderer.mjs` + `DESIGN.md`. The confirmed decisions (D1–D6) are recorded in `PLAN.md` §22.6. Forward UX work lives in `UX-PLAN-V2.md`. Kept here as design-history. For the current authoritative spec, read `PLAN.md` §22.

> 本文件是 `PLAN.md` v8 的设计补遗，仅覆盖两个 v8 未充分定义的缺口。不重述既有规范，只新增/扩展设计，并标注对现有 § 的影响。待 steering 决策项标记为「决策 Dn」（v9 用 D 前缀，与 v8 的 Q1–Q11、v7 的 P1–P8 不冲突）。Phase 编号沿用 §15 / §20.4 / §21.13。所有路径绝对，以 `D:\XD\ClaudeCode\sy-eeo\` 为仓库根（依 PROGRESS.md 的 D0，无 `opsforge/` 子目录）。

---

## 概述

v6 建立工程基线，v7 定义循环工作流与可组合安装，v8 叠加行为评估层。但两个真实诉求仍未被覆盖：

1. **国内自研 agent 平台的强兼容性**：现有 §6/§8/§9 隐含假设目标平台是 Claude Code/Cursor/Codex/Cline 这类有公开 SDK/CLI、有 slash-command、有 MCP 支持、有约定配置目录的主流平台。实际落地中，agent 平台可能是国内自研平台——可能只有 HTTP API、或只有 Web UI、或只有私有协议；slash-command、skill 加载、MCP 支持程度、配置目录结构都可能不同；还可能涉及国内合规与中文化要求。现有 adapter 契约（`conform()/translate()/injectMcp()/install()/detect()`）对这类平台没有给出"最小接入路径"与"能力差异分级降级"框架。v7 的 P8 只覆盖"平台不支持 workflow"的单点兜底，需推广为"平台不支持任意能力原语"的通用降级矩阵。

2. **全流程非技术用户 UX**：v6–v8 的护栏是**工程正确**的，但**对人不对**——`node tools/new-capability.mjs --kind skill --slug xxx` / `./install.sh --install <pack>.<name>@<version>` / `--profile` 对非技术用户太硬核；v8 的 `validation-report.json`/`security-report.json`/`eval-report.json` 是 JSON artifact，非技术用户看不懂；装完能力后用户不知道有哪些可用、怎么触发、产出不对怎么办。需要系统性的 UX 层：交互式向导、plain-language 报告渲染、引导式错误恢复、能力发现与反馈入口。需区分两类用户：**能力作者（业务运营 vibe coder）**与**安装使用者（消费方项目用户）**，两者 UX 需求不同。

本补遗给出可落地的抽象层、CLI、文件路径与 Phase 映射，所有新工具属 steering 维护（§C.6 收归原则），业务作者仍只写 `.md/.yaml/.json`。

---

## Gap 1 — 国内自研平台强兼容性层

### 1.1 缺口定位

现有 §6.1 平台约定矩阵硬编码 4 个平台（`claude-code`/`cursor`/`codex`/`cline`），`capability.schema.json` 的 `platforms` 字段 enum 也只允许这 4 个值。现有 §6.2 adapter 契约 6 个方法（`conform/translate/install/injectMcp/uninstall/detect`）假设平台有"配置目录可写 + 能力文件可落盘 + MCP 配置可合并"的能力组合。现有 v7 P8 只覆盖"平台不支持 workflow 原语"的兜底，未推广到"平台不支持 slash-command / 不支持 MCP / 不支持 skill 加载"等任意原语缺失。国内自研平台可能：

- 无 CLI/SDK（不像 `claude -p`），无法跑 v8 dry-run eval；
- 无 slash-command 机制，只有 HTTP API 或 Web UI；
- 无 MCP 支持，或只支持私有协议工具；
- 配置目录结构与主流平台完全不同；
- 中文环境、国内合规（数据出境、模型备案等）。

### 1.2 平台能力点模型（Platform Capability Points）

把"一个平台能做什么"分解为正交的**能力点**（capability points），每个能力点是一个布尔（支持/不支持）+ 元数据。adapter 声明其平台对各能力点的支持级别。

| 能力点 ID | 含义 | 缺失时影响 |
|---|---|---|
| `prompt_exec` | 能执行 prompt（CLI/SDK/HTTP API/Web UI 任意其一） | 缺失则无法跑任何 prompt 类能力（agent/skill） |
| `agent_file` | 能落盘 agent 文件到约定目录并被平台加载 | 缺失则 agent 只能走 HTTP 注入或 manual paste |
| `skill_file` | 能落盘 skill 文件并被平台语义检索激活 | 缺失则 skill 退化为 manual prompt |
| `slash_command` | 能注册 slash-command / 快捷指令 | 缺失则 workflow 无法编译为 slash，走 CLI 引擎 |
| `mcp_config` | 能注入 MCP server 配置（stdio/sse/http） | 缺失则 mcp 能力无法装，或退化为 HTTP 直连 |
| `workflow_orchestration` | 平台原生支持编排（command/规则链/编排 agent） | 缺失则 workflow 走 v7 P8 CLI 引擎兜底 |
| `config_dir_writable` | 有约定可写的配置目录 | 缺失则走 HTTP API 注入或 manual paste |
| `kb_mount` | 能挂载知识库 MCP（v7 `kb_mount:true`） | 缺失则 workflow KB 降级为本地文件读写 |
| `feedback_hook` | 能在能力产出后接收反馈（slash `/rate` 或 HTTP callback） | 缺失则 v8 feedback MCP 降级为本地 jsonl |

每个能力点声明结构（在 `adapters/<platform>/platform.yaml`，steering 维护）：

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

`fallback` 字段声明该能力点缺失时的降级策略（见 §1.5 降级矩阵）。

### 1.3 平台 Tier 分级

按能力点支持程度分三级（**决策 D1**：采用三级分层，推荐是）：

| Tier | 能力点要求 | 能装的能力范围 | 典型平台 |
|---|---|---|---|
| **Tier 1（全功能）** | `prompt_exec` + `agent_file` + `skill_file` + `slash_command` + `mcp_config` + `config_dir_writable` 全支持 | agent / skill / mcp / workflow（slash surfacing）/ bundle 全类 | Claude Code / Cursor / Codex / Cline |
| **Tier 2（部分功能）** | `prompt_exec` 支持 + 其余能力点部分支持（至少 2 个文件/配置类支持） | 装能力时按缺失能力点降级；workflow 走 CLI 引擎；mcp 可能降级 HTTP 直连 | 国内自研平台有 HTTP API + 部分文件落盘 |
| **Tier 3（仅 prompt）** | 仅 `prompt_exec` 支持（HTTP API / Web UI / 私有协议），其余全不支持 | agent/skill 退化为 manual prompt 或 HTTP 注入；mcp/workflow 不可装（fail-loud 或降级为 prompt 说明书） | 国内自研平台只有 Web UI / 私有 HTTP |

Tier 由 adapter 的 `platform.yaml` 能力点声明自动计算，不需手填。`--doctor --platform <p>` 报告该平台 Tier 与缺失能力点。

### 1.4 Adapter 契约重构（§6.2 扩展）

现有 §6.2 的 6 方法保留，新增 `supports(point)` 探测方法与 `tier()` 计算：

```ts
interface Adapter {
  platform: string;
  // 既有 6 方法保留
  conform(cap): ConformResult;
  translate(cap, opts?): PlatformArtifact[];
  install(artifacts, opts): Manifest;
  injectMcp(mcp, opts): void;
  uninstall(capId, opts): void;
  detect(): boolean;
  // v9 新增
  supports(point: string): { supported: boolean, fallback?: string, meta?: object };
  tier(): 1 | 2 | 3;
  // translate 增强：opts 传入 capability 声明的 requires（§1.6），adapter 决定降级策略
}
```

`supports(point)` 读 `platform.yaml` 能力点声明返回；`tier()` 按能力点支持数计算。adapter 实现方（含国内自研平台）只需：① 写 `platform.yaml` 声明能力点；② 实现 6 个既有方法（Tier 3 平台对 `install`/`injectMcp` 可返回 `unsupported` + 降级提示）；③ `supports`/`tier` 由基类默认实现（`adapters/base.mjs` 提供，§1.7）。

### 1.5 通用降级矩阵（推广 v7 P8）

把 v7 P8 的"平台不支持 workflow → CLI 引擎兜底"推广为**任意能力原语缺失的统一降级矩阵**。降级策略分四类：

| 降级策略 ID | 含义 | 触发条件 | 谁执行 |
|---|---|---|---|
| `cli-engine` | 编排逻辑在 OpsForge CLI 引擎（`--run-workflow`），平台只看到一个个可用 skill/agent | 平台缺 `workflow_orchestration` / `slash_command` | `tools/workflow-compile.mjs` + `install.mjs --run-workflow` |
| `http-inject` | 能力不落盘，经平台 HTTP API 注入 system prompt + user input | 平台缺 `agent_file`/`skill_file` 但有 `prompt_exec` (http-api) | adapter `translate()` 产 HTTP payload artifact，`install()` 调 API |
| `manual-paste` | 生成能力说明书 markdown，用户手动复制到平台 Web UI | 平台缺 `agent_file`/`skill_file` 且 `prompt_exec` mode=web-ui | adapter `translate()` 产 `paste-instructions.md`，`install()` 打印指引 |
| `http-direct` | MCP 工具不走 stdio/sse 配置注入，改为能力 body 直接 HTTP 调远端工具 | 平台缺 `mcp_config` 但能力可改写为 HTTP 调用 | adapter `translate()` 把 mcp 工具改写为 body 内 HTTP 调用说明 |

降级矩阵（能力点 × 能力 kind）：

| 能力 kind | 缺 `agent_file`/`skill_file` | 缺 `slash_command` | 缺 `mcp_config` | 缺 `workflow_orchestration` |
|---|---|---|---|---|
| agent | http-inject 或 manual-paste | n/a | n/a | n/a |
| skill | http-inject 或 manual-paste | n/a | n/a | n/a |
| mcp | n/a | n/a | http-direct 或 fail-loud（若 mcp 工具无法 HTTP 化） | n/a |
| workflow | n/a | cli-engine（v7 P8 A） | n/a | cli-engine（v7 P8 A）或降级为编排 agent（v7 P8 B） |
| bundle | 按内含能力各自降级 | 按内含 workflow 降级 | 按内含 mcp 降级 | 按内含 workflow 降级 |

降级行为：① 安装时 adapter `translate()` 按矩阵选策略；② 选 `http-direct`/`manual-paste` 时打印降级提示；③ `fail-loud` 仅在能力声明的 `requires` 为 `hard` 时触发（见 §1.6）。

**平台 Tier 示例（每平台一份 `adapters/<platform>/platform.yaml`）**：

| 平台 | Tier | 支持点 | 缺失点 + 降级 |
|---|---|---|---|
| claude-code（已存） | 1 | 全 9 | 无降级 |
| cursor / codex / cline | 1 | 全 9 | 无降级 |
| 示例国内 Tier 2 平台 `my-domestic-http` | 2 | prompt_exec(http-api)+config_dir_writable+mcp_config | agent_file/skill_file 缺 → http-inject；slash_command 缺 → cli-engine；workflow_orchestration 缺 → cli-engine |
| 示例国内 Tier 3 平台 `my-domestic-webui` | 3 | 仅 prompt_exec(web-ui) | agent/skill → manual-paste；mcp/workflow → fail-loud（除非 requires:soft 改说明书） |

**中文 fail-loud surfacing**（hard `requires` 缺失或不可降级时）：

```
[红] 装不了：marketing-team.bi-connector 需要 mcp_config 能力点，但平台 my-domestic-webui 不支持。
可能原因：该平台只有 Web UI，无法注入 MCP 配置。
下一步：① 换平台（选 claude-code/cursor 等 Tier 1）；② 联系能力作者看是否提供 http-direct 降级版本；③ 若你是平台方，补 mcp_config 支持后重试。
```

soft 缺失 → 降级 + 中文提示：

```
[黄] 已降级安装：activity-summary 在 my-domestic-webui 上退化为 manual-paste 说明书（因缺 skill_file）。
下一步：打开 <paste-instructions.md>，把内容复制到平台 Web UI 对话框即可使用。
```

### 1.6 能力 `requires` 字段（声明硬依赖）

新增可选字段 `requires`（在 `capability.yaml`，schema `additionalProperties: false` 仍成立——`requires` 是新增 schema 字段，非作者自创）：

```yaml
requires:
  - point: mcp_config              # 需要平台支持 mcp_config 能力点
    severity: hard                 # hard=缺失则 fail-loud 不装；soft=缺失则降级
  - point: slash_command
    severity: soft
    fallback: cli-engine           # 可选，覆盖默认降级策略
```

缺省 `requires` 时按 §1.5 矩阵默认 `soft` 降级。`severity: hard` 的能力点缺失时安装器 fail-loud 并提示"该能力需要平台支持 <point>，当前平台 <platform> 不支持，请换平台或选降级版本"。**决策 D2**：`requires` 字段是否进 `capability.schema.json`？推荐**是**，作为可选字段（`additionalProperties: false` 不受影响，因 schema 显式声明）。业务作者一般不填（缺省走 soft），只在能力确实硬依赖某原语时填。

### 1.7 国内自研平台最小接入路径

国内自研平台方接入 OpsForge 的最小步骤：

1. **建 adapter 目录**：`adapters/<platform-slug>/`（`platform-slug` 遵循命名规则 `^[a-z][a-z0-9-]{2,30}$`），属 steering 维护（CODEOWNERS + path 守卫）。
2. **写 `platform.yaml`**：声明 9 个能力点的支持级别 + fallback 策略 + locale + compliance_tags（§1.2）。
3. **实现 `adapter.mjs`**：继承 `adapters/base.mjs` 基类，实现 6 个既有方法（Tier 3 平台对 `install`/`injectMcp` 可返回 unsupported + 降级提示）；`supports`/`tier` 由基类默认实现。
4. **注册到 schema enum**：`capability.schema.json` 的 `platforms` 字段 enum 追加 `<platform-slug>`（§1.9 集成）。
5. **CI matrix 追加**：`ci/github-actions/validate.yml` 的平台 matrix 追加该平台（若平台无 CLI，matrix 只跑 `conform()` 静态校验 + `supports()` 探测，不跑 dry-run eval）。
6. **文档**：`docs/platform-matrix.md` 追加该平台行（Tier + 能力点 + 降级策略）。

**决策 D3**：国内自研平台 adapter 是否需要平台方提交"能力点声明真实性证明"？推荐**是**——平台方需在 `platform.yaml` 附 `verified_by: steering` 字段，steering 抽样验证能力点声明真实性（防平台方虚报支持）。未验证的平台在 `--doctor` 时标 `unverified`，告警不阻断。

### 1.8 无 SDK/CLI 平台的 dry-run 与 eval 降级（v8 兼容）

v8 §21.5 dry-run harness 默认用 `claude -p`。国内自研平台无 CLI 时：

- **Tier 2（有 HTTP API）**：`OPSFORGE_RUNNER=<platform-slug>`，`tools/test-runner.mjs` 经 adapter 的 `supports(prompt_exec).meta.endpoint` 调 HTTP API 跑 prompt，`actual` = API 返回。
- **Tier 3（仅 Web UI）**：降级 `static-only` + `human` 模式（v8 §21.5 已有此降级路径），记录 `runner: static-only`，eval 报告标 `runner_limited: true`。
- **judge LLM**：国内平台 judge 可用国内模型（`OPSFORGE_JUDGE_MODEL` env 覆盖，steering 在 `eval.config.yaml` 配国内模型 endpoint）。**决策 D4**：是否在 `eval.config.yaml` 支持国内模型 endpoint？推荐**是**，作为 `judge_model` 的 `provider: domestic-http` 选项，需 steering 审批（属新依赖配置，不是新 npm 依赖——复用 Node 内置 fetch）。

### 1.9 合规与中文化考虑（steering 决策点）

不在技术层展开法律合规，但标注决策点：

- **数据出境**：国内平台的能力 body / MCP 远端 URL 若涉及数据出境，`platform.yaml` 的 `compliance_tags` 含 `data-residency-cn` 时，`tools/security-scan.mjs`（§B.1）追加扫描：能力 body 引用的远端 URL 若指向境外域名且 `compliance_tags` 含 `data-residency-cn`，告警（不阻断，steering 审批）。**决策 D5**：是否阻断？推荐**告警不阻断**，合规属业务层判断。
- **模型备案**：国内平台若用未备案模型，steering 在 `platform.yaml` 标 `model_registration: pending`，`--doctor` 告警。
- **中文化**：`platform.yaml` 的 `locale: zh-CN` 时，adapter `translate()` 产出的能力说明用中文（`display_name_zh` 优先）；v9 Gap 2 的报告渲染层默认中文。

---

## Gap 2 — 全流程非技术用户 UX 强化

### 2.1 缺口定位

v6–v8 的护栏对非技术用户不友好：
- **开发侧**：`node tools/new-capability.mjs --kind skill --slug xxx` 是裸 CLI，无交互式引导；body 写到什么程度算够、测试用例怎么写、staged→released 进度到哪，无可视化。
- **安装侧**：`./install.sh --install <pack>.<name>@<version>` / `--profile` 对非技术用户太硬核；错误时只有 exit code + stderr，无 plain-language 指引。
- **验证侧**：v8 三份 JSON 报告（validation/security/eval）非技术用户看不懂。
- **应用侧**：装完后不知道有哪些能力可用、怎么触发、产出不对怎么办、怎么 `/rate`、怎么升级/回滚。

需区分两类用户：
- **能力作者（业务运营 vibe coder）**：UX 需求 = 引导式创作 + 实时质量反馈 + 流转可视化。
- **安装使用者（消费方项目用户）**：UX 需求 = 交互式安装 + plain 报告 + 能力发现 + 错误恢复。

### 2.2 交互式向导 `opsforge` 命令（替代裸 CLI）

新增 `tools/opsforge.mjs`（steering 维护，§C path 守卫），作为非技术用户的统一入口。它不是新依赖（复用 Node 内置 readline），而是 `new-capability.mjs` / `install.mjs` / `validate.mjs` / `eval.mjs` 的交互式 wrapper。

**首交互 = 顶层中文菜单（6 选项，强制替代裸子命令 fork）**：

```
========================================
  OpsForge 能力工坊
========================================
你想做什么？请输入序号：
  1) 新建一个能力（从零开始写）
  2) 安装已有能力到我的平台
  3) 拷贝一个第三方能力（给链接）
  4) 查看我能力的流转进度 / 体检报告
  5) 诊断问题（已装的能力出毛病了）
  6) 列出已装能力 + 触发方式
  0) 退出
----------------------------------------
请选择 [0-6]:
```

任何分支结束后回顶层菜单（循环），不退出。非法序号重问。分支内可输 `back`/`menu`/`0`。详细分支见 UX-PLAN-V2.md §2.2–§2.6。

子命令（向后兼容，仍可直达）：

```
opsforge new                     # 交互式新建能力（替代 new-capability.mjs 裸 CLI）
opsforge wizard                  # 端到端引导：从想法到 released 的全流程
opsforge install                 # 交互式安装（选 pack/选能力/看说明/确认依赖）
opsforge status [<path>]         # 可视化流转进度（draft→staged→released）
opsforge doctor [--project <name>]  # 交互式体检 + plain 报告（转发 --project 给 install.mjs doctor()）
opsforge report <artifact.json>  # 把 JSON artifact 翻译成中文 plain 报告
opsforge discover                # 列已装能力 + 触发入口 + 质量红绿灯 + [黄 不可商用] 商用标签（不降质量灯）
opsforge feedback <capability>   # 提交反馈/评分
```

**OpsForge-as-capability 三载体**（解决无"仓库路径"概念平台上的向导触发问题，详见 UX-PLAN-V2.md §3）：

| 载体 | 适用 Tier | 形态 | 触发 |
|---|---|---|---|
| A. 仓库内 CLI | Tier 1 仓库存在 | `node tools/opsforge.mjs` | 终端 |
| B. Meta-skill/agent 包 | Tier 1/2（有 agent_file/skill_file 或可 http-inject） | `packs/opsforge-meta/skills/opsforge-wizard/` + `packs/opsforge-meta/agents/opsforge/`，自身是普通 OpsForge 能力经同一 install 流程装入平台 | `@opsforge` / `@opsforge-wizard` |
| C. opsforge MCP server | Tier 2 部分（缺 agent_file/skill_file 但有 mcp_config） | `packs/opsforge-meta/mcps/opsforge-mcp/`，声明 MCP 工具 `opsforge.wizard`/`install`/`status`/`doctor`/`intake` | 平台 MCP 调用 |
| D. manual-paste 说明书 | Tier 3（仅 prompt_exec，Web UI） | adapter `translate()` 产 `paste-instructions.md` | 用户手动粘贴 |

载体 B/C/D 自身经 OpsForge install 流程装入目标平台（自举）：用 Tier 1 仓库内 `node tools/opsforge.mjs install` 把 meta-capability 装入目标平台；此后在目标平台内 `@opsforge` 即可启动向导，无需仓库 cwd。**实施状态（2026-07-24 审计）：载体 A = Phase 1 shipped；载体 D paste 文件机制 = Phase 2.5 shipped（`adapters/cline|codex|dify` 非空 `pasteInstructions` → `install.mjs:182-196` 写 `paste/<project>/<capSlug>.md`；Tier 1 claude-code/cursor null 正确，勿改坏）；载体 B（meta-skill/agent 包 `packs/opsforge-meta/`）= Phase 3.6（该目录当前不存在）；载体 D 的菜单引导文本随载体 B 在 Phase 3.6 落地；载体 C = Phase 3.1**（不提前，依赖 v7 loop/checkpoint 之后的 MCP 注入稳定层）。原声明"载体 A/B/D = Phase 2.5"中的载体 B + 菜单引导部分实际 deferred to Phase 3.6（architect 已把归属从 Phase 4 改为 Phase 3.6）。

**无 cwd 的状态解析**（向导启动时按优先级，**不**用 `process.cwd()` 作权威）：① `OPSFORGE_WORKDIR` env（显式覆盖，steering/CI 用）；② 平台 config dir：`resolveOpsforgeHome()`（`tools/paths.mjs` 已有）下 `opsforge-workdir/`——向导首次启动时创建并写 `.opsforge-bootstrap.json`（记录来源平台、首次启动时间、载体类型）；③ 兜底：仅载体 A 才回落到 `process.cwd()` 并校验是 OpsForge 仓库（存在 `templates/`+`schema/`+`tools/`），否则 fail-loud 中文"当前目录不是 OpsForge 仓库，请在菜单里选 6 安装 opsforge-wizard 能力来引导你"。所有相对路径（`_drafts/`/`_staged/`/`packs/`）一律相对解析到的工作目录；install.mjs 的 manifest 路径继续走 `~/.opsforge/manifests/<project>.manifest.json`，与工作目录解耦。

`opsforge new` 交互流：① 问"你要建什么能力"（agent/skill/mcp/workflow/bundle）；② 问"叫什么名字"（中英文 display_name）；③ 问"属于哪个 pack"（列出已有 pack 或新建）；④ 问"一句话描述这个能力做什么"；⑤ 自动调 `new-capability.mjs` 起骨架；⑥ 引导"现在用自然语言告诉你的 AI 代理要写什么业务逻辑" + 打开 body 文件位置；⑦ 引导"至少写 3 个测试用例" + 打开 tests 目录；⑧ 跑 `validate.mjs` 实时反馈（§2.3）。

### 2.3 实时质量反馈（写完 body 立刻知道过没过）

`opsforge new` / `opsforge wizard` 在作者保存 body/tests 后自动跑 `validate.mjs`（R1–R22）+ `test-runner.mjs`（functional runSuite），输出 plain-language 反馈：

```
质量反馈：activity-summary
─────────────────────────
[绿] 骨架完整            R1  通过
[绿] 占位符已清空        R7  通过
[黄] body 实质内容偏少   R16 body 100 字 < skill 阈值 100，请补充业务逻辑
[红] 测试用例平凡        R18 case-02 的 expected="ok" 太平凡，请写真期望
[绿] 无密钥/注入         §B  通过
─────────────────────────
一句话结论：2 项需修复。请补充 body 内容（建议描述输入→处理→输出的完整流程），
并重写 case-02 的 expected 为具体的期望输出。
```

反馈格式由 `tools/report-renderer.mjs`（§2.5）渲染，红绿灯 + 一句话结论 + 修复建议。

### 2.4 流转可视化 `opsforge status`

```
能力流转进度：my-slug.activity-summary
─────────────────────────────────────
[✓] draft    草稿区        2026-07-21 合并   PR #12
[→] staged   审核区        当前态           待补 tests + CHANGELOG
[ ] released 正式区        未到达
[ ] registry 已发布        未到达
─────────────────────────────────────
下一步：补 tests/（≥3 条）+ CHANGELOG.md，然后跑 `opsforge wizard --promote` 提交 stage PR。
```

读 `.opsforge-state.json`（脚手架/promote 时写入能力目录的流转状态文件，steering 维护字段，业务作者不碰）。

### 2.5 JSON 报告人类可读渲染层 `tools/report-renderer.mjs`

把 v8 的三份 JSON artifact（`validation-report.json`/`security-report.json`/`eval-report.json`）+ 安装 manifest 翻译成中文 plain 报告。renderer 是纯函数，输入 JSON + 报告类型，输出格式化中文文本（console 或 markdown）。

渲染规则：
- **红绿灯**：每条 check/finding 标 绿（pass）/黄（warning/pending）/红（fail/block）。
- **一句话结论**：报告开头 "[绿] 该能力质量合格，可发布" 或 "[红] 该能力有 2 项严重问题，需修复后重新评估"。
- **修复建议**：每条红/黄项附 plain-language 修复指引（如 "body 内容偏少，建议补充：输入是什么→怎么处理→输出什么"）。
- **不暴露内部规则编号**给非技术用户（R16/Q5 等编号折叠到"详细技术信息"折叠区，默认不展开）。

渲染模板存 `tools/report-templates/`（steering 维护，`*.md` 模板 + 占位符替换）。**决策 D6**：renderer 是否支持英文？推荐**是**，`--lang en` 切换，但默认中文（因目标用户是中文业务运营）。

### 2.6 交互式安装向导 `opsforge install`

非技术用户安装路径：

```
opsforge install
─────────────────────────
1. 选择平台：[claude-code] [cursor] [my-domestic-platform] ...
2. 选择安装方式：
   [ ] 从 pack 安装（选一个 pack，装其中全部/部分能力）
   [ ] 从 bundle 安装（选一个场景套装）
   [ ] 从 profile 安装（选一个 profile.yaml）
   [ ] 单个能力安装（输入 <pack>.<name>）
3. 浏览能力：
   - marketing-team.copywriter  文案生成助手  v1.3.0  [绿 质量 pass]
     描述：把活动数据总结成一句话
     依赖：marketing-team.tone-ll@>=1.0
   - ...
4. 确认依赖：将同时安装 2 个依赖能力（列出）
5. 确认安装：[Y/n]
6. 安装中...（进度）
7. 安装完成：plain 报告（红绿灯 + 装了什么 + 怎么触发）
```

安装后 plain 报告示例：

```
安装完成：3 个能力已装入 Claude Code
─────────────────────────────────────
[绿] marketing-team.copywriter  v1.3.0   触发：@copywriter
[绿] marketing-team.tone-ll      v1.0.0   触发：@tone-ll
[黄] growth-team.data-miner     v0.1.0   质量 degraded（近期成功率 65%），可正常使用但建议关注产出
─────────────────────────────────────
怎么用：在 Claude Code 里输入 @copywriter 或直接描述任务。
有问题？跑 `opsforge doctor` 体检，或 `opsforge feedback <capability>` 反馈。
```

### 2.7 能力发现入口 `opsforge discover`

```
opsforge discover
─────────────────────────────────────
已装入 Claude Code 的能力（5 个）：
─────────────────────────────────────
@copywriter          文案生成助手     v1.3.0  [绿]  触发：@copywriter
@tone-ll             语气校准         v1.0.0  [绿]  触发：@tone-ll
/workflow retro      活动复盘工作流   v2.1.0  [绿]  触发：/workflow retro
@data-miner          数据挖掘         v0.1.0  [黄]  质量 degraded  触发：@data-miner
bi-connector MCP     BI 连接器        v1.2.0  [绿]  MCP 工具
─────────────────────────────────────
[黄] data-miner 近期成功率 65%，建议跑 `opsforge doctor` 看详情，或 `opsforge feedback data-miner` 反馈。
```

读 manifest + feedback jsonl + eval-history，综合渲染。

> **实施状态（2026-07-24 审计）：** 当前 `cmdDiscover`（`tools/opsforge.mjs:76-100`）读 `registry.yaml`（语义错——registry 是仓库级发布清单，discover 应读 per-project manifest `~/.opsforge/manifests/<project>.manifest.json`），且无质量红绿灯、无 `[黄 不可商用]` 商用标签、无 feedback/eval-history 综合。**Deferred to Phase 3.6 修。**

### 2.8 错误恢复指引

`opsforge doctor` 检测到问题时，不只报问题，还给出 plain-language 修复指引：

| 问题 | 指引 |
|---|---|
| 某 capability 文件缺失 | "能力 <name> 的文件缺失，可能是被误删。跑 `opsforge install --repair <name>` 重新安装。" |
| 依赖不满足 | "能力 <name> 依赖 <dep>@>=1.0，当前未装。跑 `opsforge install <dep>` 安装依赖。" |
| MCP 配置缺失 | "能力 <name> 的 MCP 配置缺失。跑 `opsforge install --repair-mcp <name>` 重新注入。" |
| effectiveness degraded | "能力 <name> 近期成功率 65%，低于阈值 70%。可能原因：模型升级导致 body 失效。建议：① 跑 `opsforge feedback <name>` 看用户反馈；② 联系能力作者 re-eval；③ 或 `opsforge install --downgrade <name>` 回滚上一版本。" |
| 版本落后 | "能力 <name> 当前 v1.2.0，registry 有 v1.3.0。跑 `opsforge install --upgrade <name>` 升级。" |

### 2.9 `/rate`、反馈、升级/回滚的用户侧体验

- **`/rate`**：v8 Q8 确认由 slash wrapper 注入。`opsforge discover` 列出能力时提示"用完后可 `/rate 1-5` 评分"。`opsforge feedback <capability>` 交互式问"这个能力好用吗？1-5 分 + 文字反馈"，写 feedback jsonl。
- **升级**：`opsforge install --upgrade <name>` 或 `opsforge install --upgrade --all`，遇 breaking（MAJOR 跨越）提示"新版本 v2.0.0 有破坏性变更：<changelog BREAKING 摘要>，确认升级？[Y/n]"。
- **回滚**：`opsforge install --downgrade <name>` 回滚到上一版本（读 manifest history）。

---

## 2.10 第三方 intake 流程（安全 hard-block + 商用 warn-confirm-tag）

> 设计来源：`UX-PLAN-V2.md` §5（流程总览 / fetch / 选拷贝范围 / 安全闸门 / 商用闸门 / scaffold / phasing）+ §7（schema 字段）+ §10（已决断）。Phase 归属：最小闸门 = **Phase 2.6**；完整 intake = Phase 3.4。

### 2.10.1 流程总览

```
顶层菜单 3 → ① 提交链接 → ② 选拷贝范围 → ③ 安全闸门（强制、不可豁免、先跑）→ ④ 商用可用性闸门 → ⑤ intake scaffold → ⑥ 引导填业务字段 → 走 §2.3 质量反馈循环
```

### 2.10.2 安全闸门（intake 整闸门不可豁免）

对 fetch 下来的内容跑 `tools/security-scan.mjs scan()`。**intake-path 上的安全闸门整体不可豁免**——即所有命中族（现有 3 不可豁免族 hardcoded_secret / prompt_injection / ssrf_private_network，加未来 Phase 3.4 扩展族）都 block，不提供"confirm to proceed anyway"。Phase 3.4 扩展族**默认也全 block**，少数可由 steering 豁免（留 steering 决，但文档记为"默认全 block"）。命中即中文 fail-loud 拒绝（"OpsForge 不允许引入含硬编码密钥或提示注入的内容，这两类无法通过确认豁免"）。

### 2.10.3 商用可用性闸门（安全通过后跑，warn + 用户显式确认 + `commercial:false` 标签）

新增 `tools/intake-license.mjs`（steering，Phase 2.6），按 §12.2 白名单判定：

| LICENSE | 判定 | 行为 |
|---|---|---|
| MIT / Apache-2.0 / ISC / BSD-2/3-Clause | 可商用 | 不打标签，直接进 ⑤ |
| MPL-2.0 | 条件收录（文件级隔离） | warn + 用户确认 → `commercial: true` + `commercial_reason: "MPL-2.0 文件级隔离"` |
| GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA | 拒绝收录（§12.2） | warn：copyleft/NC 与商用冲突 → 用户显式确认接受非商用限制 → `commercial: false` + `commercial_reason: "GPL 系/NC 协议限制商用"` |
| 无 LICENSE / 无法识别 | 不明 | warn → 用户显式确认 → `commercial: false` + `commercial_reason: "LICENSE 不明"` |
| 用户声明"仅内部使用、不商用" | 主动选 | `commercial: false` + `commercial_reason: "用户声明非商用"` |

**LICENSE 识别策略（已决断）**：串匹配为主（§12.2 白名单为权威判定），仅在"无 LICENSE / 多 LICENSE / 无法识别"时调 LLM 给**建议但不自动决定**，最终仍由用户显式确认。LLM 调用走 Node 内置 `fetch` 调国内模型 endpoint（复用 §22.6 D4 `judge_model.provider: domestic-http`），**不引入新 npm 依赖**。

### 2.10.4 intake scaffold（修复 Phase-1 intake→staged 断链）

intake 改写到 `packs/_drafts/third-party/<name>/`（在 `_drafts/` 下新增 `third-party/` 子命名空间），使现有 `--promote` 直接迁移 `_drafts/third-party/<name>/` → `_staged/third-party/<name>/`（路径替换 `/_drafts/` → `/_staged/` 自然成立）。`packs/_third-party/` 保留为 §12 收录区（正式 released 形态）。intake scaffold 同时写 `upstream.ref.yaml`（schema 已存 `schema/upstream-ref.schema.json`，`additionalProperties:false`）、拷 `LICENSE.upstream`、写 `wrapping.yaml`、置 `source.origin: forked` + `source.upstream_ref`、写 `.opsforge-state.json` `state:"draft"`、写 capability manifest 的 `commercial`/`commercial_reason`。

### 2.10.5 schema 字段变更（全部维持 `additionalProperties:false`）

| 文件 | 新增可选字段 | 类型 | 说明 | Phase |
|---|---|---|---|---|
| `schema/capability.schema.json` | `commercial` | boolean | 默认 true；intake 时可设 false | 2.6 |
| `schema/capability.schema.json` | `commercial_reason` | string | 商用受限原因 | 2.6 |
| `schema/upstream-ref.schema.json` | `commercial` | boolean | 镜像 capability 字段 | 2.6 |
| `schema/upstream-ref.schema.json` | `commercial_reason` | string | 同上 | 2.6 |
| `schema/upstream-ref.schema.json` | `intake_scope` | string | 拷贝范围（"all" 或子路径） | 2.6 |
| install manifest（`install.mjs`） | capabilities[].`commercial` / `commercial_reason` | boolean/string | 镜像到安装记录 | 2.6 |
| `registry.yaml` entry（`release.mjs`） | `commercial` | boolean | 穿透到 registry | 2.6 |

`release.mjs` 透传：从 capability manifest 读 `commercial`/`commercial_reason` 写入 registry entry。`install.mjs` 从 registry 读，写入 per-project manifest。`opsforge doctor`/`status`/`discover` 渲染时显示 `[黄 不可商用]` 或 `[绿 可商用]`——**`commercial:false` 不降质量灯**（质量与商用独立维度）。

**无新 npm 依赖**：fetch 用 Node 内置，LICENSE 识别用串匹配 + LLM 辅助（复用 D4 provider），`ajv`/`js-yaml`/`semver` 三依赖不变。

### 2.10.6 安全 fetch（`tools/intake-fetch.mjs`，steering，Phase 2.6）

复用 `tools/security-scan.mjs` 的 `SSRF_PATTERNS`（169.254.169.254 / 127/8 / 10/8 / 192.168/16 / *.internal）拒私网；仅 `https://`（拒 `http://`/`file://`/`ftp://`）；Node 内置 `fetch`（无新依赖）；git 仓库走 `node:child_process` 调系统 `git clone --depth 1` 到 `~/.opsforge/intake-cache/<hash>/`，限大小（默认 50MB，`OPSFORGE_INTAKE_MAX_BYTES` 可调）；marketplace 链接先 fetch 元数据 API 拿真实仓库 URL。

---

## 3. 新增/扩展的文件与工具

均以 `D:\XD\ClaudeCode\sy-eeo\` 为根。括号标注 Phase。

**Gap 1（平台兼容性）**：
- `adapters/base.mjs`（新增，P2）—— adapter 基类，提供 `supports()`/`tier()` 默认实现 + 能力点声明加载
- `adapters/<platform>/platform.yaml`（新增，P2）—— 平台能力点声明文件（每个平台一份，含现有 4 平台补齐）
- `schema/platform.schema.json`（新增，P2）—— platform.yaml 的 schema，`additionalProperties: false`
- `schema/capability.schema.json`（扩展，P2）—— `platforms` enum 追加 `<platform-slug>`；新增可选 `requires` 字段
- `docs/platform-matrix.md`（扩展，P2）—— 追加国内自研平台行 + Tier 分级说明
- `adapters/base.mjs` 的 `supports()`/`tier()`（新增，P2）
- `tools/security-scan.mjs`（扩展，P3）—— 追加 `data-residency-cn` 远端 URL 扫描
- `tools/test-runner.mjs`（扩展，P2）—— `OPSFORGE_RUNNER=<platform-slug>` 经 adapter HTTP API 跑 prompt
- `tools/eval.config.yaml`（扩展，P3）—— `judge_model.provider: domestic-http` 选项

**Gap 2（UX）**：
- `tools/opsforge.mjs`（新增，P1 起最小版）—— 交互式向导入口
- `tools/report-renderer.mjs`（新增，P1 起最小版）—— JSON→中文 plain 报告渲染器
- `tools/report-templates/`（新增，P1）—— 渲染模板（`*.md`，steering 维护）
- `.opsforge-state.json`（新增，P1）—— 能力目录流转状态文件（脚手架/promote 写入）

---

## 4. 与既有 § 的集成表

| § | 变更 |
|---|---|
| §5 capability 元数据 | 新增可选字段 `requires`（§1.6，声明能力对平台能力点的硬/软依赖） |
| §6.1 平台矩阵 | 扩展为能力点矩阵（§1.2），每平台声明 9 能力点 + Tier 分级（§1.3）；不再硬编码 4 平台 |
| §6.2 Adapter 契约 | 新增 `supports(point)` / `tier()` 方法（§1.4）；`translate()` 增强 opts 传入 `requires` 决定降级策略 |
| §7.2 编排引擎 | v7 P8 的"CLI 引擎兜底"推广为通用降级矩阵（§1.5），`workflow-compile.mjs` 按平台能力点选 `cli-engine`/`http-inject`/`manual-paste` 策略 |
| §8 安装器 | 新增 `opsforge` 交互式向导入口（§2.2）；`--repair`/`--repair-mcp`/`--downgrade` flags；安装后 plain 报告（§2.6） |
| §8.3 doctor | 扩展：平台 Tier 报告 + 能力点缺失 + 降级策略 + 错误恢复指引（§2.8）；`effectiveness` 降级指引（§2.8） |
| §9.1 MCP 形态 | 新增 `http-direct` 降级形态（平台缺 `mcp_config` 时，mcp 工具改写为 body 内 HTTP 调用） |
| §11.2 三态 | `opsforge status` 可视化流转进度（§2.4）；`.opsforge-state.json` 由脚手架/promote 写入 |
| §14 约束清单 | 追加：`requires` 字段合规（schema）、platform.yaml 能力点声明合规、降级策略合规（adapter `translate()` 产出的降级产物须符合降级矩阵） |
| §A.2 规范审核 | `conform()` 增加"平台能力点满足能力 `requires`"校验：声明 `requires: hard` 的能力点在 `platforms` 声明的每个平台上都须 `supports(point).supported==true`，否则从 `platforms` 删该平台或 fail |
| §B.1 安全门禁 | 追加 `data-residency-cn` 远端 URL 扫描（§1.9 D5） |
| §C.4 CI 规则表 | 追加：platform.yaml schema 校验、adapter 能力点声明真实性（D3 verified_by）、`opsforge.mjs`/`report-renderer.mjs` 列入 steering path 守卫 |
| §C.6 决策清单 | 追加收归：平台能力点声明、Tier 分级、降级策略矩阵、judge 国内模型配置 |
| §15 路线 | 见 §5 Phase 映射 |
| §16 风险表 | 追加：国内平台能力点虚报、降级产物行为偏离、交互向导误操作、报告渲染误导 |
| §17 路径索引 | 新增：`adapters/base.mjs`、`adapters/<platform>/platform.yaml`、`schema/platform.schema.json`、`tools/opsforge.mjs`、`tools/report-renderer.mjs`、`tools/report-templates/`、`.opsforge-state.json` |
| §20.3（v7 集成） | v7 P8 的"不支持 workflow 兜底"被 v9 §1.5 通用降级矩阵吸收；P8 的 A/B 策略成为矩阵中 `cli-engine`/`orchestration-agent` 两行 |
| §21.5（v8 dry-run） | 扩展：`OPSFORGE_RUNNER=<platform-slug>` 经 adapter HTTP API 跑 prompt（§1.8）；Tier 3 降级 static-only + human |

---

## 5. Phase 映射（沿用 §15 / §20.4 / §21.13 编号）

| Phase | v9 交付 |
|---|---|
| **Phase 1 (MVP)** | `tools/opsforge.mjs` 最小版（`opsforge new` 交互式建能力 + `opsforge install` 单能力 + `opsforge status` + `opsforge doctor` 基础）；`tools/report-renderer.mjs` 最小版（渲染 validation-report，红绿灯 + 一句话结论）；`.opsforge-state.json`；`adapters/base.mjs` 基类（`supports`/`tier`）；现有 4 平台补 `platform.yaml`；`capability.schema.json` 追加 `requires` 可选字段。**不**含国内自研平台 adapter、不含通用降级矩阵实现。 |
| **Phase 2** | 通用降级矩阵实现（`translate()` 按能力点选降级策略）；国内自研平台 adapter 示例（1 个 Tier 2 + 1 个 Tier 3）；`platform.schema.json`；`opsforge report <artifact>` 渲染三份 JSON 报告；`opsforge install --repair/--repair-mcp`（载体 D paste 文件）；`report-templates/` 完整模板集；`OPSFORGE_RUNNER=<platform>` 经 adapter HTTP API 跑 prompt；`release.mjs` 写 released/registry state；`doctor --project` 转发。**PARTIAL — 工程后端 COMPLETE；UX shell（顶层菜单/`opsforge wizard` 端到端/`opsforge discover` 能力发现质量灯/`opsforge feedback`/无 cwd/载体 B/平台内安装入口）DEFERRED to Phase 3.6。** |
| **Phase 3** | `http-direct` mcp 降级形态；`data-residency-cn` 安全扫描；`eval.config.yaml` 国内模型 provider；`opsforge install --downgrade` 回滚；`opsforge feedback` 交互式；降级产物行为偏离的 CI 校验（降级安装后跑 eval 对比原装）；`--doctor` 平台 Tier 报告 + 能力点真实性抽检（D3）。 |
| **Phase 3.6** | **v9 UX shell closure（Phase 2.5 deferred 集中于此，先于 Phase 4）：** 顶层菜单；`opsforge wizard` 端到端 5 步；`opsforge discover` 读 per-project manifest + 质量灯 + 商用标签；`opsforge feedback` UX 入口；无 cwd bootstrap（`opsforge-workdir/.opsforge-bootstrap.json`）；载体 B（`packs/opsforge-meta/`）；菜单引导；平台内安装入口；实时质量反馈 wizard 串接。平台可行性：claude-code/cursor/cline ✅、codex ⚠、dify ❌退 D。 |
| **Phase 4** | 国内自研平台生态：3+ 国内平台接入；降级策略 A/B 测试（`http-direct` vs `manual-paste` 哪个用户体验更好）；报告渲染趋势看板（随 v7/v8 eval-history 演进）；多语言报告（`--lang en`）；平台能力点自动探测（`detect()` 探测平台实际能力点，而非只读声明）。 |

---

## 6. 决策清单（D1–D6，待 steering 确认）

- **D1** 平台 Tier 分级：采用三级（Tier1 全功能 / Tier2 部分功能 / Tier3 仅 prompt）。推荐**是**，因国内自研平台能力差异大，三级分层既给 Tier 1 平台零降级开销，又给 Tier 3 平台最小接入路径。备选：两级（全/降级），但粒度不足以指导降级策略选择。影响：§1.3 Tier 定义、adapter `tier()` 实现。
- **D2** `requires` 字段是否进 `capability.schema.json`？推荐**是**，作为可选字段（`additionalProperties: false` 不受影响）。业务作者一般不填（缺省走 soft 降级），只在能力硬依赖某原语时填。备选：不进 schema，改由 adapter `conform()` 推断，但推断不可靠且作者无法显式声明硬依赖。影响：§1.6、§5 schema、§A.2 conform 校验。
- **D3** 国内自研平台能力点声明是否需 steering 验证？推荐**是**——`platform.yaml` 附 `verified_by: steering`，steering 抽样验证能力点真实性。未验证标 `unverified`，`--doctor` 告警不阻断。备选：不验证，信任平台方声明，但有虚报风险（平台方声称支持 `mcp_config` 实际不支持，装时才崩）。影响：§1.7、§C.4 CI 规则。
- **D4** `eval.config.yaml` 是否支持国内模型 endpoint？推荐**是**，作为 `judge_model.provider: domestic-http` 选项，复用 Node 内置 fetch（无新 npm 依赖，不违反 §C.1）。备选：不支持，judge 只用 Claude/Anthropic API，但国内平台用户跑不了 judge。影响：§1.8、v8 §21.4 judge 契约。
- **D5** `data-residency-cn` 合规扫描是阻断还是告警？推荐**告警不阻断**，合规属业务层判断（§10 商业化方向同口径：技术层不背合规的锅）。备选：阻断，但可能误伤合法能力。影响：§1.9、§B.1 安全门禁。
- **D6** `report-renderer.mjs` 是否支持英文？推荐**是**，`--lang en` 切换，默认中文。备选：仅中文，但限制国际化场景。影响：§2.5、`report-templates/`。

---

## 7. 相关文件路径（均以 `D:\XD\ClaudeCode\sy-eeo\` 为根，未创建属 v9 新增/扩展）

**Gap 1**：
- 新增：`adapters/base.mjs`、`schema/platform.schema.json`、`adapters/<platform>/platform.yaml`（每平台一份，含现有 4 平台补齐 + 国内自研平台）
- 扩展：`schema/capability.schema.json`（`platforms` enum 追加 + `requires` 可选字段）、`adapters/<platform>/adapter.mjs`（实现 `supports`/`tier` 或继承 base.mjs）、`tools/test-runner.mjs`（`OPSFORGE_RUNNER=<platform>` HTTP API 路径）、`tools/security-scan.mjs`（`data-residency-cn` 扫描）、`tools/eval.config.yaml`（国内模型 provider）、`docs/platform-matrix.md`（Tier + 能力点表）

**Gap 2**：
- 新增：`tools/opsforge.mjs`、`tools/report-renderer.mjs`、`tools/report-templates/`（`*.md` 模板）
- 新增（能力目录内，脚手架写入）：`.opsforge-state.json`
- 扩展：`tools/new-capability.mjs`（写 `.opsforge-state.json`）、`tools/validate.mjs`（`.opsforge-state.json` 字段校验）、`install.sh`/`install.mjs`（`--repair`/`--repair-mcp`/`--downgrade` flags + 安装后调 `report-renderer.mjs` 渲染 plain 报告）

**规范源**：`D:\XD\ClaudeCode\sy-eeo\PLAN.md`（§5/§6/§7.2/§8/§9.1/§11.2/§14/§A.2/§B.1/§C.4/§C.6/§15/§16/§17/§20.3/§21.5）

---

## 核心承诺收尾

v6 把工程规范从人审下放到 CI；v7 把循环执行与组合安装定义清楚；v8 把能力有效性从人审下放到 eval；**v9 把"平台差异"与"用户差异"两块补齐**：① 把 v7 P8 的单点兜底推广为 9 能力点 × 5 降级策略的通用降级矩阵 + 3 级 Tier 分层，使国内自研平台以"一个 platform.yaml + thin adapter"最小路径接入，能力差异自动降级而不崩；② 把 v8 的 JSON artifact 与裸 CLI 用 `opsforge` 交互式向导 + `report-renderer.mjs` 中文 plain 报告层包裹，使非技术用户从"想法→能力→安装→使用→反馈"全链路有引导、有反馈、有错误恢复。业务作者仍只写 `.md/.yaml/.json`，所有新工具（`opsforge.mjs`/`report-renderer.mjs`/`base.mjs`/`platform.yaml` schema）属 steering，§C 工程基线不破；无新 npm 依赖（复用 Node 内置 readline/fetch），不违反 §C.1 一种语言/受控依赖原则。
