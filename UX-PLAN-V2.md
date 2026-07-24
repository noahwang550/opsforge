# UX-PLAN-V2.md — OpsForge 改进设计：纯业务用户 UX + OpsForge-as-capability + 安全/商用 intake 闸门

> 本文件是规划改进文档（spec/plan improvement），非实现。设计针对**完整目标计划**（PLAN.md v9 §22 + 三份 supplement + ARCHITECTURE-DELTA.md + IMPLEMENTATION-PLAN.md），非 Phase 1 已交付物。不写代码。
>
> 设计姿态（贯穿全文档）：
> 1. **纯业务用户 UX**：终端用户是非技术业务运营（v6 vibe-coding persona）。不允许出现"用户须敲 `node tools/opsforge.mjs new`"的设计；一切入口走引导式中文菜单。
> 2. **OpsForge 自身可被作为能力触发**（Req 4）：在无"仓库路径"概念的平台上，OpsForge 以 meta-skill/meta-agent/MCP 形态被安装并就地启动向导，不假设 `process.cwd()` 是仓库根。
> 3. **第三方 intake = 安全闸门（不可豁免）+ 商用可用性闸门（可确认豁免）**：先安全 hard-block，后商用 warn-confirm-tag，再 scaffold。
> 4. **工程基线不破**：ESM `.mjs`、受控依赖（`ajv`/`js-yaml`/`semver`，新依赖仅在不可避免时提出并标注 `deps-change`）、所有 schema 维持 `additionalProperties: false`、可执行件 steering 拥有、业务作者仅写 `.md/.yaml/.json`。
>
> Orchestrator 已对源码抽查核实：PLAN.md §12.2 LICENSE 白名单（MIT/Apache-2.0/ISC/BSD-2/3-Clause 优先；MPL-2.0 条件；GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA/无 LICENSE 拒绝，CI 不兼容直接 block）、§12.1 `upstream.ref.yaml` 字段、§12.3 `tools/upstream-bump.mjs`；`tools/security-scan.mjs` 3 不可豁免族（SECRET/INJECTION/SSRF_PATTERNS）与 `scan()` 位置；`tools/new-capability.mjs` intake→`packs/_third-party/` 与 `--promote` 的 `/_drafts/` 守卫；`tools/opsforge.mjs` 命令集；`release.mjs` 不写 `.opsforge-state.json`。均与设计前提一致。

---

## 1. Overview

### 1.1 五项硬需求重述

- **Req 1** — 纯业务用户、无 CLI 输入、强文本引导：首交互必须是顶层菜单（"你想做什么？1)新建能力 2)安装 3)拷第三方 4)查状态 5)诊断"），而非裸子命令 fork。每个命令路径从菜单可达，全程中文引导，内建错误恢复。
- **Req 2** — 多平台支持具体化：Cursor/Codex/Cline + 国内自研平台；9 能力点 × 5 降级策略矩阵逐平台落地；安装时选平台或 `detect()` 自动；hard `requires` 缺失 fail-loud + 中文说明；Tier 1/2/3 平台示例。
- **Req 3** — 第三方拷贝流：提交链接 → 选拷贝范围（全部/部分）→ **安全验证（强制先跑、不可豁免、命中即拒）** → **商用可用性验证（安全通过后跑，不可商用或不明 → warn + 用户显式确认 + 打 `commercial: false` 标签，穿透 release/registry/install/doctor）** → 拷贝+intake scaffold（修复 Phase-1 intake→staged 断链）。
- **Req 4** — 无"仓库路径"概念平台上的 OpsForge-as-capability bootstrap：把向导本身打包成可安装的 meta-skill/meta-agent/MCP，从 `OPSFORGE_HOME`/平台 config dir 解析工作目录而非 `process.cwd()`；按 Tier 提供菜单与答案收集机制。
- **Req 5** — docs/archive/ux-flow-clarification.md 中其余 gap 的逐条定向决策（不推到以后）。

### 1.2 设计姿态摘要

- 向导（Req 1）寄居在 Req 4 的"OpsForge-as-capability"载体上；二者同源。
- 多平台（Req 2）与 intake（Req 3）都通过向导菜单暴露，向导是统一入口。
- 安全门沿用现有 `tools/security-scan.mjs` 的 3 不可豁免族（hardcoded_secret / prompt_injection / ssrf_private_network，见 `tools/security-scan.mjs:13-37`），intake-path 上整闸门不可豁免（含未来扩展族）。
- 商用门由 §12.2 LICENSE 白名单驱动（`PLAN.md:588-593`：MIT/Apache-2.0/ISC/BSD-2/3-Clause 优先；MPL-2.0 条件；GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA/无 LICENSE 拒绝）。

---

## 2. Req 1 — 引导式向导 UX

### 2.1 寄居位置

向导逻辑由 steering 拥有的 `tools/opsforge.mjs`（ESM，复用 `node:readline`，无新依赖）承载。但其**触发入口**有三种寄居形态（见 §3）：(a) 仓库内 `node tools/opsforge.mjs`（Tier 1 仓库存在时）；(b) 平台内 `@opsforge` meta-skill/agent（Tier 1/2 有 agent_file/skill_file）；(c) `opsforge` MCP server（无文件落盘平台）；(d) manual-paste 说明书（Tier 3 Web UI）。三种形态共用同一 `tools/opsforge.mjs` 入口逻辑，仅 I/O adapter 不同。

### 2.2 顶层菜单（首交互，中文）

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

- 任何分支结束后回到此菜单（循环），不退出。
- 输入非法序号 → "没看懂这个选项，请输入 0 到 6 之间的数字。" 重问。
- 任何分支内可输 `back` 回上层、`menu` 回顶层、`0` 退出。

### 2.3 分支 1：新建能力（菜单路径 = 1）

```
--- 新建能力 ---
① 你要建哪类能力？
   1) agent（一个能自主干活的智能体）
   2) skill（一段可被复用的能力说明）
   3) mcp（一个外部工具连接器）
   4) workflow（把多个能力串成流水线）
   5) bundle（一整套场景套装）
   选 [1-5]:
② 给它起个英文名（小写字母/数字/连字符，3-30 字符，如 copywriter）:
③ 中文名（展示用，如"文案生成助手"）:
④ 归属哪个 pack？
   - 已有 pack：[列出 packs/ 下 pack.yaml 的 display_name 供选]
   - 新建 pack：输入 pack slug
⑤ 这个能力一句话做什么？（如"把活动数据总结成一句话"）
⑥ 正在生成骨架... 完成。
   骨架位置：<destPath>
⑦ 现在请用自然语言告诉你的 AI 代理要写什么业务逻辑。
   打开这个文件填正文：<body 文件路径>
   至少写 3 条测试用例：<tests 目录>
⑧ 我会自动检查质量（每次你保存后回车继续）。
   回车开始质量检查 >
```

质量检查后自动调 `tools/validate.mjs`（R1–R22）+ `tools/test-runner.mjs`（functional runSuite）并经 `tools/report-renderer.mjs` 渲染中文红绿灯反馈（见 §8 实时反馈）。

### 2.4 分支 3：拷贝第三方（见 §5 详述）

### 2.5 分支 2/5/6（安装/诊断/发现）

见 §6（install）、§8（doctor/discover/实时反馈）。

### 2.6 错误恢复引导 pattern（所有分支通用）

每条错误均输出三段：`[红/黄] 问题描述 → 可能原因 → 下一步动作（含具体命令或菜单序号）`。例：

```
[红] 骨架缺失文件 SKILL.md
可能原因：能力目录被手工改动或文件被误删。
下一步：① 输入 5 走诊断分支可自动定位；② 或重新走分支 1 重建骨架（会覆盖 _drafts/ 下同名目录，请先备份）。
```

---

## 3. Req 4 — OpsForge-as-capability bootstrap（先于 Req 2/3，是向导的载体）

### 3.1 问题定位

`docs/archive/ux-flow-clarification.md` Section A 已确认：所有 shipped 命令从 `process.cwd()` 推 `repoRoot`（`tools/opsforge.mjs:50,71,113`、`tools/new-capability.mjs:73`），无 `opsforge init`，无"当前 project"概念。云 agent 平台/部分国内平台**无仓库路径概念**，用户无法 `cd`。设计要求：OpsForge 自身被作为能力安装并就地启动向导。

### 3.2 三种寄居载体

| 载体 | 适用平台 Tier | 形态 | 触发 |
|---|---|---|---|
| **A. 仓库内 CLI** | 用户手上有仓库（含 Tier 1 全部） | `node tools/opsforge.mjs` | 终端 |
| **B. Meta-skill/agent 包** | Tier 1（有 agent_file/skill_file）+ Tier 2（可 http-inject） | `packs/opsforge-meta/skills/opsforge-wizard/` + `packs/opsforge-meta/agents/opsforge/`，自身是普通 OpsForge 能力，经同一 install 流程装入 `~/.claude/skills|agents/` | `@opsforge` 或 `@opsforge-wizard` |
| **C. opsforge MCP server** | 缺 agent_file/skill_file 但有 mcp_config（Tier 2 部分） | `packs/opsforge-meta/mcps/opsforge-mcp/`，声明 MCP 工具 `opsforge.wizard`/`opsforge.install`/`opsforge.status`/`opsforge.doctor`/`opsforge.intake` | 平台 MCP 调用 |
| **D. manual-paste 说明书** | Tier 3（仅 prompt_exec，Web UI） | adapter `translate()` 产 `paste-instructions.md`，含"把下面这段贴进你的平台对话框" | 用户手动粘贴 |

> **实施状态脚注（2026-07-24 审计）：** 载体 D 的 paste 文件**已落地**——`adapters/cline|codex|dify` 的 `translate()` 产非 null `pasteInstructions` → `install.mjs:182-196` 写 `paste/<project>/<capSlug>.md`（F4 fix）。Tier 1（claude-code/cursor）的 `pasteInstructions` 为 null 是**正确设计**（Tier 1 有 agent_file/skill_file，不需要 paste 说明书），勿改坏。**未落地的是载体 B（meta-skill/agent 包）+ 菜单引导**（见 §3.5），均 deferred to Phase 3.6。

载体 B/C/D 自身经 OpsForge install 流程装入目标平台——这是**自举**：用 Tier 1 仓库内的 `node tools/opsforge.mjs install` 把 meta-capability 装入目标平台；此后在目标平台内 `@opsforge` 即可启动向导，无需仓库 cwd。

### 3.3 无 cwd 的状态解析

向导启动时按优先级解析工作目录（**不**用 `process.cwd()`）：

1. `OPSFORGE_WORKDIR` env（显式覆盖，steering/CI 用）。
2. 平台 config dir：`resolveOpsforgeHome()`（`tools/paths.mjs` 已有）下 `opsforge-workdir/`——向导首次启动时创建并写入 `opsforge-workdir/.opsforge-bootstrap.json` 记录来源平台、首次启动时间、载体类型。
3. 兜底：若以上都无，且载体是 A（CLI），才回落到 `process.cwd()` 并校验是 OpsForge 仓库（存在 `templates/`+`schema/`+`tools/`）；否则 fail-loud 中文提示"当前目录不是 OpsForge 仓库，请在菜单里选 6 安装 opsforge-wizard 能力来引导你"。

所有相对路径（`_drafts/`/`_staged/`/`packs/`）一律相对解析到的工作目录。`install.mjs` 的 manifest 路径继续走 `~/.opsforge/manifests/<project>.manifest.json`（`install.mjs:62-66`），与工作目录解耦。

### 3.4 每层交互机制

| Tier | 菜单呈现 | 答案收集 |
|---|---|---|
| Tier 1（prompt_exec+agent_file+skill_file+slash_command+mcp_config+config_dir_writable 全支持） | 平台原生 prompt/slash；`@opsforge-wizard` skill 内即为向导菜单文本 | 平台原生对话回复；向导用 readline（CLI 载体 A）或读 user message（载体 B） |
| Tier 2（HTTP API） | 经 `supports(prompt_exec).meta.endpoint` 调 HTTP API 发菜单文本 | HTTP API 返回的 user input；向导循环调 API |
| Tier 3（Web UI/私有 HTTP） | `translate()` 产 manual-paste 说明书，用户复制到 Web UI | 用户把平台输出贴回向导 stdin（CLI 载体）或回贴 MCP 工具参数 |

### 3.5 Phase 归属

- 载体 A 已 shipped（Phase 1）。
- 载体 D（manual-paste 说明书）的 paste 文件机制 = **Phase 2.5 工程后端已交付**（`adapters/cline|codex|dify` 非空 `pasteInstructions` → `install.mjs:182-196` 写 `paste/<project>/<capSlug>.md`；Tier 1 null 正确）。
- 载体 B（meta-skill/agent 包）+ 菜单引导 + 无 cwd bootstrap + 顶层菜单 + 5 步安装引导 + discover 质量灯 + feedback UX 入口 + 平台内安装入口 = **Phase 3.6 SHIPPED**（Phase 2.5 UX shell deferred 集中于此；architect 已把归属从 Phase 4 改为 Phase 3.6；2026-07-24 全部交付，bare `node --test` 341/0，6 gates 全绿）。
- 载体 C（opsforge MCP server）= **Phase 3.1**（MCP 形态需要 v7 loop/checkpoint 之后的 MCP 注入稳定层；亦可提前到 2.5 若 steering 批准）。

---

## 4. Req 2 — 多平台 + 降级矩阵

### 4.1 9 能力点 × 5 降级策略矩阵（逐 kind，来源 `docs/design-archive/supplement-v9.md` §1.5 / PLAN.md §22.4）

降级策略：`cli-engine` / `http-inject` / `manual-paste` / `http-direct` / `fail-loud`。

| 能力 kind | 缺 agent_file/skill_file | 缺 slash_command | 缺 mcp_config | 缺 workflow_orchestration |
|---|---|---|---|---|
| agent | http-inject（有 http-api）/ manual-paste（仅 web-ui） | n/a | n/a | n/a |
| skill | http-inject / manual-paste | n/a | n/a | n/a |
| mcp | n/a | n/a | http-direct（可 HTTP 化）/ fail-loud（不可化且 requires:hard） | n/a |
| workflow | n/a | cli-engine | n/a | cli-engine（v7 P8 A）或降级为编排 agent（P8 B） |
| bundle | 内含能力各自降级 | 按内含 workflow | 按内含 mcp | 按内含 workflow |

### 4.2 平台 Tier 示例（每平台一份 `adapters/<platform>/platform.yaml`）

| 平台 | Tier | 支持点 | 缺失点 + 降级 |
|---|---|---|---|
| claude-code（已存） | 1 | 全 9 | 无降级 |
| cursor | 1 | 全 9（slash_command 经 cursor rules 等价） | 无降级 |
| codex | 1 | 全 9 | 无降级 |
| cline | 1 | 全 9 | 无降级 |
| 示例国内 Tier 2 平台 `my-domestic-http` | 2 | prompt_exec(http-api)+config_dir_writable+mcp_config | agent_file/skill_file 缺 → http-inject；slash_command 缺 → cli-engine；workflow_orchestration 缺 → cli-engine |
| 示例国内 Tier 3 平台 `my-domestic-webui` | 3 | 仅 prompt_exec(web-ui) | agent/skill → manual-paste；mcp/workflow → fail-loud（除非 requires:soft 改说明书） |

### 4.3 安装平台选择 UX（与 §6 install 合并）

```
--- 安装能力 ---
① 选目标平台：
   [自动检测] 当前平台：claude-code（Tier 1，全功能）
   1) claude-code   2) cursor   3) codex   4) cline
   5) my-domestic-http（Tier 2）  6) my-domestic-webui（Tier 3）
   选 [1-6] 或回车用自动检测:
```

#### 4.3.1 平台可行性矩阵（opsforge wizard 自举载体 D，2026-07-24 审计）

| 平台 | Tier | wizard 自举可行性 | 说明 |
|---|---|---|---|
| claude-code | 1 | ✅ | 全 9 点，载体 A/B/C 均可，D 无需（`pasteInstructions` null 正确） |
| cursor | 1 | ✅ | 全 9 点，同 claude-code |
| cline | 2 | ✅ | `pasteInstructions` 非空 → 载体 D paste 文件落地（`install.mjs:182-196`） |
| codex | 2 | ⚠ | 缺 `slash_command`/`workflow_orchestration` → 载体 D paste 可用但菜单交互降级，需 http-inject 补 |
| dify | 3 | ❌ 退 D | 仅 `prompt_exec`，无 agent_file/skill_file/mcp_config → 退化为 manual-paste 说明书（`http-direct`/`fail-loud`） |

### 4.4 "装不了"中文 surfacing

当能力声明 `requires` 含 hard 且目标平台缺该点 → fail-loud 中文：

```
[红] 装不了：marketing-team.bi-connector 需要 mcp_config 能力点，但平台 my-domestic-webui 不支持。
可能原因：该平台只有 Web UI，无法注入 MCP 配置。
下一步：① 换平台（菜单序号 X 选 claude-code/cursor 等 Tier 1）；② 联系能力作者看是否提供 http-direct 降级版本；③ 若你是平台方，补 mcp_config 支持后重试。
```

soft 缺失 → 降级 + 中文提示：

```
[黄] 已降级安装：activity-summary 在 my-domestic-webui 上退化为 manual-paste 说明书（因缺 skill_file）。
下一步：打开 <paste-instructions.md>，把内容复制到平台 Web UI 对话框即可使用。
```

### 4.5 Phase 归属

- claude-code 已存（Phase 1）。
- cursor/codex/cline adapter + `platform.yaml` = **Phase 2.1**（IMPLEMENTATION-PLAN.md:187）。
- 通用降级矩阵 `translate()` 选策略 = **Phase 2.5**（IMPLEMENTATION-PLAN.md:199）。
- Tier 2/3 国内平台示例 = **Phase 2.5**（1 Tier 2 + 1 Tier 3）。
- `--doctor` 平台 Tier 报告 + 能力点真实性抽检（D3）= **Phase 3.3**（IMPLEMENTATION-PLAN.md:215）。

---

## 5. Req 3 — 第三方 intake（安全 + 商用闸门，中心件）

### 5.1 流程总览

```
菜单 3 → ① 提交链接 → ② 选拷贝范围 → ③ 安全闸门（强制、不可豁免）→ ④ 商用可用性闸门 → ⑤ intake scaffold → ⑥ 引导填业务字段 → 走分支 1 的质量反馈循环
```

### 5.2 ① 提交链接

```
--- 拷贝第三方能力 ---
① 贴上游链接（GitHub 仓库 / raw 文件 URL / marketplace 链接）:
   >
```

**安全 fetch**：复用现有 SSRF 守卫（`tools/security-scan.mjs:31-37` 的 `SSRF_PATTERNS`）。新增 `tools/intake-fetch.mjs`（steering 拥有，Phase 2.6）：
- 解析 URL，命中 SSRF 私网 pattern（169.254.169.254 / 127/8 / 10/8 / 192.168/16 / *.internal）→ 直接拒，中文："这个链接指向内网地址，OpsForge 不允许拉取内网内容。"
- 仅允许 `https://`（拒 `http://`、`file://`、`ftp://`）。
- 走 Node 内置 `fetch`（无新依赖）。git 仓库走 `node:child_process` 调系统 `git clone --depth 1` 到临时目录（`~/.opsforge/intake-cache/<hash>/`），限大小（默认 50MB，`OPSFORGE_INTAKE_MAX_BYTES` 可调）。
- marketplace 链接：先 fetch 其元数据 API 拿真实仓库 URL，再走 git/raw 路径。

### 5.3 ② 选拷贝范围

```
② 拷贝范围：
   1) 全部（整个上游仓库/文件）
   2) 部分——只拷指定子路径或文件
   选 [1-2]:
（若选 2）输入子路径（相对仓库根，如 skills/code-reviewer/ 或 src/foo.py）:
```

部分拷贝的实现：fetch 全量到 cache 后，按子路径筛选文件集，仅筛出的文件进入 intake scaffold。若子路径不含可识别 capability manifest（`capability.yaml`/`SKILL.md`/`mcp.yaml`/`workflow.yaml`/`bundle.yaml`），向导提示"这个子路径里没找到能力定义文件，OpsForge 不知道这是哪类能力，请选整个仓库或指定含 manifest 的子路径。"

### 5.4 ③ 安全闸门（强制、不可豁免、先跑）

对 fetch 下来的内容跑 `tools/security-scan.mjs scan()`（`tools/security-scan.mjs:57-114`）。**intake-path 上的安全闸门整体不可豁免**——即所有命中族（含未来 Phase 3.3 扩展族）都 block，不提供"confirm to proceed anyway"。这与现有 §B.3 "prompt injection / supply chain / private SSRF 三类不可豁免"（`tools/security-scan.mjs` 注释 + ARCHITECTURE-DELTA.md §2.7）一致并外推到整闸门。

```
③ 安全检查中...
[红] 拒绝拷贝：发现 2 项安全问题（不可豁免）：
  - hardcoded_secret: src/config.py:12: AKIA...  AWS access key
  - prompt_injection: SKILL.md:30: 忽略以上指令  ignore previous instructions (zh)
为什么拒绝：OpsForge 不允许引入含硬编码密钥或提示注入的内容，这两类无法通过"确认"豁免。
下一步：① 换一个干净的上游；② 联系上游作者清理后再来；③ 若上游误报，到 steering 提 issue。
```

安全通过 → 进 ④。

### 5.5 ④ 商用可用性闸门（安全通过后跑）

新增 `tools/intake-license.mjs`（steering，Phase 2.6），按 §12.2 白名单判定：

| LICENSE | 判定 | 行为 |
|---|---|---|
| MIT / Apache-2.0 / ISC / BSD-2/3-Clause | 可商用 | 不打标签，直接进 ⑤ |
| MPL-2.0 | 条件收录（需文件级隔离） | warn + 用户确认 → 打 `commercial: true` + `commercial_reason: "MPL-2.0 文件级隔离"` |
| GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA | 拒绝收录（§12.2） | warn：copyleft/NC 与典型商用场景冲突 → 用户**显式确认**接受非商用限制 → 打 `commercial: false` + `commercial_reason: "GPL 系/NC 协议限制商用"` |
| 无 LICENSE / 无法识别 | 不明 | warn → 用户显式确认 → 打 `commercial: false` + `commercial_reason: "LICENSE 不明"` |
| 用户声明"仅内部使用、不商用" | 主动选 | 打 `commercial: false` + `commercial_reason: "用户声明非商用"` |

LICENSE 识别策略（已决断，见 §10.1）：**串匹配为主 + LLM 辅助**——`tools/intake-license.mjs` 先按 §12.2 白名单做规则串匹配（权威判定）；仅在"无 LICENSE / 多 LICENSE / 无法识别"时调 LLM 给**建议但不自动决定**，最终仍由用户显式确认。LLM 调用走 Node 内置 `fetch` 调国内模型 endpoint（复用 v9 §22.6 D4 的 `judge_model.provider: domestic-http` 配置），**不引入新 npm 依赖**。

```
④ 商用可用性检查...
[黄] 这个上游是 GPL-3.0，商用受限。
说明：GPL 系协议要求衍生作品也开源，与你公司商用场景可能冲突。
你确定要拷贝并标记为"不可商用"吗？输入 yes 确认 / no 取消:
> yes
已标记 commercial: false（商用: 不可商用）。后续安装时会一直提示。
```

### 5.6 ⑤ intake scaffold（修复 Phase-1 断链）

**Phase-1 gap（`docs/archive/ux-flow-clarification.md` Section C Branch 2 + Section E Q3）：** intake 写到 `packs/_third-party/<name>/`（`tools/new-capability.mjs:89`），而 `--promote` 要求路径含 `/_drafts/`（`tools/new-capability.mjs:180-182`），故 intake 目录无法 promote。

**改进决策：** intake 改写到 `packs/_drafts/third-party/<name>/`（在 `_drafts/` 下新增 `third-party/` 子命名空间），使现有 `--promote` 直接迁移 `_drafts/third-party/<name>/` → `_staged/third-party/<name>/`（路径替换 `/_drafts/` → `/_staged/` 自然成立，`tools/new-capability.mjs:196`）。`packs/_third-party/` 目录保留为 §12 收录区（正式 released 形态，由 release 后的物理迁移或 release.mjs 直接扫描 `_staged/third-party/` → `packs/_third-party/` 建立映射）。

intake scaffold 同时：
- 写 `upstream.ref.yaml`（schema 已存 `schema/upstream-ref.schema.json`，`additionalProperties:false`，字段 repo/commit/license/intaked_at/intaked_by）。**新增可选字段** `commercial`、`commercial_reason`、`intake_scope`（见 §7）。
- 拷上游 LICENSE 副本为 `LICENSE.upstream`（§12.1 step 4）。
- 写 `wrapping.yaml`（§12.1 step 5，说明二次封装改动 + 拷贝范围）。
- 置 `source.origin: forked` + `source.upstream_ref`（复用 `setOriginForked`，`tools/new-capability.mjs:164-171`）。
- 写 `.opsforge-state.json` `state: "draft"`（复用 `writeOpsforgeState`）。
- **商用标签写入 capability manifest**（`capability.yaml`/`SKILL.md`/etc.）的新可选字段 `commercial` + `commercial_reason`（见 §7）。

### 5.7 ⑥ 后续

走分支 1 的 ⑥⑦⑧ 质量反馈循环。staged gate 跑全 §A + §B + runSuite；release gate（`release.mjs` §B.4）额外校验 intake 能力的 `upstream.ref.yaml` schema + LICENSE 兼容性记录 + 商用标签一致性（见 §7）。

### 5.8 phasing（最小 Phase-2 intake 闸门 vs 完整 Phase-3）

- **Phase 2.6（最小 intake 闸门）**：fetch（SSRF 守卫复用）+ 现有 3 不可豁免安全族（`tools/security-scan.mjs` 已有）+ LICENSE 串匹配（§12.2 白名单）+ `commercial` 字段 scaffold + intake→`_drafts/third-party/` 目录修复 + `--promote` 兼容。**不**含 Phase 3.3 的扩展安全族（over-privileged tools / supply-chain / MCP tool-surface / dep advisories / data-residency-cn）。
- **Phase 3.4（完整 intake）**：完整 §B 安全族 + `wrapping.yaml` 强校验 + `tools/upstream-bump.mjs` + brand 区 fork 路径 + CI intake 专闸。对齐 IMPLEMENTATION-PLAN.md:217。

---

## 6. Req 2+5 合并 — 交互式安装 5 步

```
--- 安装能力 ---
① 选平台（见 §4.3）
② 选安装方式：
   1) 从 pack 安装（选一个 pack，装其中全部/部分）
   2) 从 bundle 安装（选一个场景套装）
   3) 从 profile 安装（选一个 profile.yaml）   [Phase 2.3]
   4) 单个能力安装（输入 <pack>.<name>）
   选 [1-4]:
③ 浏览能力（列 registry current + 质量灯 + 商用标签）：
   marketing-team.copywriter  文案生成助手  v1.3.0  [绿]  可商用  触发 @copywriter
   third-party.code-reviewer  代码审查（GPL-3.0）  v0.2.0  [绿]  [黄 不可商用]  触发 @code-reviewer
④ 确认依赖：将同时安装 2 个依赖能力（列出）
⑤ 确认安装：[Y/n]
⑥ 安装中...（进度）
⑦ 安装完成：plain 报告（红绿灯 + 装了什么 + 触发方式 + 商用提示）
```

- `--repair` / `--repair-mcp` = **Phase 2.5**（IMPLEMENTATION-PLAN.md:199）。
- `--upgrade` = **Phase 3.3**（IMPLEMENTATION-PLAN.md:215，与 effectiveness feedback 同期）。
- `--downgrade` = **Phase 3.3**（读 manifest history）。
- profile/bundle 安装 = **Phase 2.3**。

---

## 7. Schema / 字段变更

全部维持 `additionalProperties: false`（schema 显式声明新字段，非作者自创）。

| 文件 | 新增可选字段 | 类型 | 说明 | Phase |
|---|---|---|---|---|
| `schema/capability.schema.json` | `commercial` | boolean | 默认 true；intake 时可设 false | 2.6 |
| `schema/capability.schema.json` | `commercial_reason` | string | 商用受限原因（中文/英文） | 2.6 |
| `schema/capability.schema.json` | `requires` | array | 已在 v9 §22.5 确认（Phase 1 已加） | 1（已存） |
| `schema/upstream-ref.schema.json` | `commercial` | boolean | 镜像 capability 字段，intake 时填 | 2.6 |
| `schema/upstream-ref.schema.json` | `commercial_reason` | string | 同上 | 2.6 |
| `schema/upstream-ref.schema.json` | `intake_scope` | string | 拷贝范围（"all" 或子路径） | 2.6 |
| install manifest（`install.mjs` Manifest type） | capabilities[].`commercial` | boolean | 镜像到安装记录 | 2.6 |
| install manifest | capabilities[].`commercial_reason` | string | 同上 | 2.6 |
| `registry.yaml` entry（`release.mjs`） | `commercial` | boolean | 穿透到 registry | 2.6 |

`release.mjs` 透传：从 capability manifest 读 `commercial`/`commercial_reason` 写入 registry entry（不丢字段）。`install.mjs` 从 registry 读，写入 per-project manifest。`opsforge doctor`/`status`/`discover` 渲染时显示 `[黄 不可商用]` 或 `[绿 可商用]`。

**无新 npm 依赖**：fetch 用 Node 内置，LICENSE 识别用串匹配（§10 open decision）。`ajv`/`js-yaml`/`semver` 三依赖不变。

---

## 8. Req 5 — Gap-by-gap 定向决策表

| Gap（docs/archive/ux-flow-clarification.md 来源） | 设计决策 | Phase |
|---|---|---|
| `opsforge status` 四灯（D 表行 "four-stage visual"） | `release.mjs release()` 成功后写 `.opsforge-state.json` `state:"released"` + history；`aggregateAll` 成功后写 `state:"registry"`。修复 `release.mjs` 不写 state 的 gap（Section E Q4）。 | **2.5**（与 wizard 同期，因 status 是 wizard 子步骤） |
| `opsforge doctor --project` 不转发（D 表行；`tools/opsforge.mjs:109-125` 忽略 `--project`） | `cmdDoctor` 转发 `--project` 给 `install.mjs doctor()`（已支持 `project?`，`install.mjs:258`）。同时向导分支 5 问"project name (default: default)"。 | **2.5**（小修，可与 wizard 同期；亦可作 1.7 patch 提前） |
| `opsforge report` 渲染全部 3 报告（D 表行） | `report-renderer.mjs` 加 `security-report`/`eval-report`/`manifest` 类型 + 对应 `tools/report-templates/*.zh.md`。P1 已 throw（`tools/report-renderer.mjs:17-24`），Phase 2.5 实现。 | **2.5**（IMPLEMENTATION-PLAN.md:199） |
| `opsforge discover` 列表 + 质量灯（D 表行） | 读 manifest + feedback jsonl + eval-history 综合渲染（§22.10）。`commercial: false` 显示 `[黄 不可商用]` 标签但**不降质量灯**（质量与商用独立维度，见 §10.6）。**实施状态：Phase 3.6 已交付——`cmdDiscover` 改读 per-project manifest + 质量灯骨架 + 商用标签；feedback jsonl + eval-history 深度聚合留 Phase 3.2 渐进增强。** | **3.6 SHIPPED**（原 2.5 deferred） |
| `opsforge install` 交互 5 步（D 表行） | 见 §6，与 Req 2 平台选择合并。 | browse/deps UI **2.5**；profile/bundle 方式 **2.3** |
| `opsforge install --repair`/`--repair-mcp`（D 表行） | `install.mjs main()` 加 flag；repair = 重跑 translate+install 对单 cap；repair-mcp = 只重跑 injectMcp。 | **2.5**（IMPLEMENTATION-PLAN.md:199） |
| `--upgrade`/`--downgrade`（D 表行） | upgrade 读 registry current 比对 manifest，遇 MAJOR breaking 中文提示 changelog 确认；downgrade 读 manifest history 回滚上一版。 | **3.3**（IMPLEMENTATION-PLAN.md:215） |
| `opsforge feedback`（D 表行） | 交互式问 1-5 分 + 文字，写 `~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl`。需 `opsforge-feedback` MCP（Phase 3.2）。 | **3.3**（与 effectiveness 同期） |
| 实时质量反馈（body/tests 后自动 validate+test-runner）（D 表行） | 向导分支 1 ⑧ 每次回车触发 `validate.mjs`+`test-runner.mjs runSuite` → `report-renderer.mjs` 中文红绿灯。 | **2.5**（与 wizard 同期） — 注：`validate`/`runSuite`/`report-renderer` 工程后端 2.5 交付，wizard 分支串接 Phase 3.6 SHIPPED |
| `--lang en` 报告渲染（D 表行） | `report-renderer.mjs` 加 en 模板 + lang 选项。D6 已确认默认 zh。 | **4**（docs/design-archive/supplement-v9.md:380） |
| 顶层菜单（D 表行 + Section E Q6） | 见 §2.2，本改进计划的强制首交互。**实施状态：Phase 3.6 SHIPPED——`opsforge menu` 6 选项首交互替换裸 `switch(cmd)` 分发。** | **3.6 SHIPPED**（原 2.5 deferred） |
| `opsforge wizard` 端到端（D 表行） | 即 §2 顶层菜单 + 各分支的串接 + 流转可视化引导。**实施状态：Phase 3.6 SHIPPED——`cmdWizard` 串接 scaffold→填字段→validate→test→report→install 5 步。** | **3.6 SHIPPED**（原 2.5 deferred）（IMPLEMENTATION-PLAN.md:199） |
| `eval-report.json` 第 3 CI artifact（D 表行） | `eval.mjs` + `release.mjs` 要求 3 报告全 pass。 | **2.2**（IMPLEMENTATION-PLAN.md:189） |
| 通用降级矩阵 + Tier 2/3 国内平台 adapter（D 表行） | 见 §4。 | **2.5**（IMPLEMENTATION-PLAN.md:199） |
| 第三方 intake 完整（D 表行 + Section E Q2/Q3） | 见 §5；intake→`_drafts/third-party/` 修复 promote 断链；安全+商用闸门。 | 最小 **2.6**；完整 **3.4** |
| `opsforge init`/load project（Section E Q1） | **不做**。保持 authoring project-agnostic（cwd 或工作目录 = 隐式 project）；per-project manifest 仍是下游 install 记录。向导不引入"当前 project"概念，避免新增状态。 | 不实现 |
| intake 第一 fork 是否"dev vs copy"（Section E Q2） | **不在顶层做 dev/copy fork**。顶层菜单是 6 选项（§2.2），dev=1、copy=3，并列。避免强制先答 dev/copy。 | — |
| intake 目录位置（Section E Q3） | `packs/_drafts/third-party/<name>/`（见 §5.6），让现有 `--promote` 直接工作。 | **2.6** |
| `release.mjs` 写 released/registry state（Section E Q4） | 见本表首行。 | **2.5** |
| `opsforge doctor --project`（Section E Q5） | 见本表第 2 行。 | **2.5**（或 1.7 patch） |
| 裸子命令首 fork（Section E Q6） | 见顶层菜单（§2.2），本改进计划强制替换。 | **2.5** |

---

## 9. Phase 映射（与 IMPLEMENTATION-PLAN.md 对齐）

| Phase | 本改进项 |
|---|---|
| **2.1** | cursor/codex/cline adapter + platform.yaml（IMPLEMENTATION-PLAN.md:187） |
| **2.2** | `eval-report.json` 第 3 artifact + `release.mjs` 要求 3 报告（IMPLEMENTATION-PLAN.md:189） |
| **2.3** | profile/lock/resolve-profile + install profile/bundle 方式（IMPLEMENTATION-PLAN.md:192） |
| **2.4** | workflow switch + `--run-workflow` + KB MCP（IMPLEMENTATION-PLAN.md:195） |
| **2.5** | **PARTIAL — 工程后端 COMPLETE：** 通用降级矩阵 + Tier 2/3 国内平台示例 + `--repair`/`--repair-mcp`（F4 paste 文件，载体 D 落地）+ 实时质量反馈（validate+runSuite）+ `release.mjs` 写 released/registry state + `doctor --project` 转发（F1）+ `report` 渲染全部 3 报告（F3）+ HTTP runner（F2）（IMPLEMENTATION-PLAN.md:199） |
| **3.6** | **SHIPPED 2026-07-24（UX shell 闭合，Phase 2.5 deferred 集中于此）：** 顶层菜单（`opsforge menu`）+ `opsforge wizard` 端到端（scaffold→填字段→validate→test→report→install 5 步）+ `opsforge discover` 读 per-project manifest + 质量灯 + `[黄 不可商用]` 标签 + `opsforge feedback` UX 入口（写 jsonl）+ 无 cwd bootstrap（`opsforge-runtime.mjs` `resolveWorkDir()` 三级回退 + `~/.opsforge/.runtime-root.json`）+ 载体 B（`packs/opsforge-meta/` meta-pack：`agents/opsforge` + `agents/opsforge-installer` + `skills/opsforge-wizard`）+ 菜单引导 + 平台内安装入口（`opsforge-bootstrap.mjs` + `detectPlatform()`）+ 实时质量反馈 wizard 串接。bare `node --test` 341/0；6 gates 全绿。**架构不变量：** runtime 副本动态 import 仓库根 `install.mjs`（经 `.runtime-root.json`）→ 仓库须持续存在才能 in-platform 安装；无仓库机器发行版留后续 Phase。 |
| **2.6** | 最小 intake 闸门：fetch（SSRF 复用）+ 3 安全族 + LICENSE 串匹配 + `commercial` 字段 + intake→`_drafts/third-party/` 目录修复 + `tools/intake-fetch.mjs`/`tools/intake-license.mjs`（新 steering 工具） |
| **3.1** | 载体 C（opsforge MCP server）（可提前到 2.5 若 steering 批准） |
| **3.2** | `opsforge-feedback` MCP + `--doctor` effectiveness + 周度 re-eval cron（IMPLEMENTATION-PLAN.md:212） |
| **3.3** | `--upgrade`/`--downgrade` + `opsforge feedback` 交互 + `http-direct` mcp 降级 + `data-residency-cn` 扫描 + 国内模型 judge provider + 平台 Tier 报告 + 能力点真实性抽检（D3）（IMPLEMENTATION-PLAN.md:215） |
| **3.4** | 完整 intake：扩展 §B 安全族（over-privileged tools/supply-chain/MCP tool-surface/dep advisories）+ `wrapping.yaml` 强校验 + `tools/upstream-bump.mjs` + brand 区 fork 路径 + CI intake 专闸（IMPLEMENTATION-PLAN.md:217） |
| **4** | `--lang en` 报告渲染 + `detect()` 自动探测能力点 + 3+ 国内平台 + 降级 A/B + 趋势看板（IMPLEMENTATION-PLAN.md:227） |

---

## 10. 已决断（adopted）

用户已指示"按推荐的来"。以下 6 项开放决策全部按本计划推荐方案采纳，逐条记录如下（rationale → 已采纳）。

1. **商用可用性检查 = 串匹配为主 + LLM 辅助**（已采纳）：LICENSE 用 §12.2 白名单串匹配为权威判定；仅在"无 LICENSE / 多 LICENSE / 无法识别"时调 LLM 给**建议但不自动决定**，最终仍由用户显式确认。LLM 调用走 Node 内置 `fetch` 调国内模型 endpoint，复用 v9 §22.6 D4 的 `judge_model.provider: domestic-http` provider 配置，**不引入新 npm 依赖**（不违反 §C.1）。
2. **canonical LICENSE 白名单 = §12.2 现有清单**（已采纳）：MIT/Apache-2.0/ISC/BSD-2/3-Clause 优先；MPL-2.0 条件收录；GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA/无 LICENSE 拒绝。**不引 SPDX 全表**，避免过度工程，且与 §12.2 收录政策一致。
3. **载体 C（opsforge MCP server）留在 Phase 3.1**（已采纳）：不提前到 2.5；Phase 2.5 用载体 B（meta-skill/agent）+ 载体 D（manual-paste）覆盖多数场景。载体 C 与 v7 loop/checkpoint 之后的 MCP 注入稳定层同期。
4. **不做 `opsforge init`/load project**（已采纳）：保持 authoring project-agnostic。cwd 或工作目录即隐式 project；per-project manifest 仍是下游 install 记录。向导不引入"当前 project"概念，避免新增状态。
5. **Phase 2.6 最小 intake 闸门 = 整闸门不可豁免**（已采纳）：现有 3 不可豁免安全族（hardcoded_secret / prompt_injection / ssrf_private_network）在 intake 路径上整闸门 block，无 confirm-anyway。Phase 3.4 扩展族（over-privileged tools / supply-chain / MCP tool-surface / dep advisories / data-residency-cn）**默认也全 block**，少数可由 steering 豁免（留 steering 决，但文档记为"默认全 block"）。
6. **`commercial: false` 在 discover 显示 `[黄 不可商用]` 但不降质量灯**（已采纳）：质量与商用是两个独立维度。`commercial: false` 仅触发商用提示标签，不影响质量红绿灯（绿/黄/红）颜色。

---

## 收尾

关键设计决策：(1) 顶层中文菜单替代裸子命令，向导逻辑统一在 `tools/opsforge.mjs`，寄居于"OpsForge-as-capability"三载体（CLI/meta-skill-agent/manual-paste，MCP 留 Phase 3.1），从 `OPSFORGE_HOME`/平台 config dir 解析工作目录而非 `process.cwd()`，修复无仓库路径平台的可触发性；(2) 多平台用 9 能力点 × 5 降级策略矩阵 + Tier 1/2/3 逐平台 `platform.yaml`，hard `requires` 缺失 fail-loud + 中文 surfacing；(3) 第三方 intake = fetch（SSRF 复用）→ 安全闸门（复用 `tools/security-scan.mjs` 3 不可豁免族，整闸门不可豁免、命中即拒）→ 商用闸门（§12.2 LICENSE 白名单，不可商用 warn + 用户显式确认 + `commercial: false` 标签穿透 capability manifest/upstream-ref/registry/install manifest/doctor/discover）→ scaffold 到 `packs/_drafts/third-party/`（修复 Phase-1 intake→staged 断链，让现有 `--promote` 直接工作）；(4) 全部新字段显式进 schema、`additionalProperties: false` 不破、无新 npm 依赖（fetch/串匹配复用 Node 内置）；(5) Phase 2.5 集中交付 wizard/menu/discover/report/repair/实时反馈/降级矩阵/载体 B+D，Phase 2.6 交付最小 intake 闸门，Phase 3.x 交付完整 §B 安全族/upgrade/feedback/MCP 载体/`--lang en`。
