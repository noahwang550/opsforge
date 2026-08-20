# Codex 兼容差距分析（E1–E6）与本 PR 解决映射

> steering 持有。证据全部来自本机（Windows 11 + Codex desktop/CLI）真实样本；
> 涉及 `~/.codex/config.toml` 的摘录均已脱敏（不含任何 token/密钥）。

## 背景

OpsForge §22.3 把平台分 Tier 1/2/3。本 PR 之前 codex adapter 为 **Tier 2**：
agent/skill/workflow 三类能力只产出 manual-paste 说明书，MCP 注入写往
`~/.codex/config.json`（JSON）——**一个 Codex 从不读取的路径与格式**。
本机实证表明 Codex 四类落点全部存在原生机制，Tier 2 判定是适配缺口而非平台限制。

## 差距证据

### E1 — agent 无落盘（原 manual-paste）

- 原行为：`translate(agent)` 产出 `kind: 'manual-paste'` artifact，paste 说明书写入
  `<opsforgeHome>/paste/<project>/<slug>.md`，Codex 内不可见。
- 实证：本机 `~/.codex/agents/` 存在 **72 个** `*.toml` sub-agent 定义
  （如 `capability-distiller.toml`、`code-reviewer.toml`），统一三字段结构：
  `name = "..."` / `description = "..."` / `developer_instructions = """<md body>"""`。
  Codex 从该目录加载 sub-agent。

### E2 — skill 无落盘（原 manual-paste）

- 原行为：同 E1，manual-paste 说明书。
- 实证：`~/.codex/skills/` 存在（内置 `.system`）；且本机 `~/.agents/skills/` 存在，
  Codex desktop 实证从该根加载 skill（`opsforge-wizard` 等，仅 `SKILL.md` 单文件目录）。

### E3 — workflow 无落盘（原 manual-paste）

- 原行为：manual-paste 说明书；`workflow-compile.mjs` 仅服务
  `workflow_orchestration.supported` 的平台（硬编码 `~/.claude/commands/`）。
- 实证：Codex 自定义斜杠命令目录为 `~/.codex/prompts/<name>.md`（`/name` 调用）。
  本机该目录尚未创建（Codex 按需自建）→ 安装时由 adapter 创建属预期行为。

### E4 — MCP 注入路径与格式双错（原 config.json）

- 原行为：`injectMcp()` 写 `~/.codex/config.json`，JSON `mcpServers` 键，
  并塞入 `_opsforge_notes` JSON 键。**Codex 只读 `~/.codex/config.toml`（TOML）**，
  旧写入对 Codex 完全不可见（死信）。
- 实证（本机 config.toml 摘录，脱敏）：
  ```toml
  [mcp_servers.bi-connector]
  command = "cmd"
  args = [
      "/c",
      "node",
      'D:\claudecode\opsforge\packs\marketing-team\mcps\bi-connector\source.md',
  ]
  env_vars = ["BI_API_KEY"]

  [mcp_servers.node_repl]
  args = []
  command = 'C:\...\node_repl.exe'

  [mcp_servers.node_repl.env]
  NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"
  ```
  要点：win32 用 `cmd /c node '<path>'` 包装；路径用 TOML literal string（单引号，
  反斜杠不转义）；`auth_schema` → `env_vars`；存在 `[mcp_servers.<name>.env]` 子表形态；
  同文件还有 `shell_environment_policy`/`model_providers` 等大量非 MCP 表——
  合并必须块级精准，其余内容逐字节保留。
  另注：本机既有 `bi-connector`/`sy-automl-mcp` 两段注入指向 `source.md`
  （非可执行 entrypoint）——正是 `opsforge-note` 注释场景的真实案例。
  本 PR **不迁移、不改动**这两段存量（零影响红线）。

### E5 — 矩阵误判 → tier 2（连锁影响 effectiveness 分母）

- 原行为：`platform.yaml` 把 `agent_file`/`skill_file`/`slash_command` 标为
  `supported: false + manual-paste` → `tier()===2` → doctor 的 effectiveness 扫描把
  codex 安装排除在 Tier-1 主分母之外。
- 实证：E1–E4 证明四类落点全部原生可达，六个 Tier-1 能力点（prompt_exec /
  agent_file / skill_file / slash_command / mcp_config / config_dir_writable）全部支持。
- 影响面说明：tier 2→1 只影响**未来** codex 安装的 effectiveness 分母
  （install.mjs doctor effectiveness 段）；当前无任何 codex manifest，存量零影响。

### E6 — install.mjs 的 JSON 假设在 codex 上失效

- 原行为：doctor S3 与 `--repair-mcp` 用 `readJsonOrNullSync()` 读 codex MCP 配置。
  对 TOML 文本 JSON 解析返回 null → doctor 把**全部** mcp key 误报 `mcp_missing`；
  repair 把**全部** key 误判缺失并重注入。
- 实证：paths.mjs `PLATFORM_MCP_PATHS['codex']` 原指向 `.codex/config.json`，
  与真实路径 `.codex/config.toml` 不符。

## 本 PR 逐项解决映射

| 差距 | 解决 | 代码锚点 | 测试锚点 |
|------|------|----------|----------|
| E1 | agent → `~/.codex/agents/<slug>.toml`（frontmatter 剥离 + TOML 转义：`\`→`\\`、`"""`→`\"""`、控制字符剔除） | `adapters/codex/adapter.mjs` `toCodexAgentToml` | CX5 / CX5b / CX7 |
| E2 | skill → `~/.codex/skills/<name>/`（SKILL.md + scripts/；tests/CHANGELOG/README 不复制）；`~/.agents/skills/` **存在才**镜像（只探测不创建） | `translate` skill 分支 + `install` skill-dir 分支 | CX13 |
| E3 | workflow → `~/.codex/prompts/workflow-<name>.md`（由 workflow.yaml 确定性合成，`/workflow-<name>` 可调用） | `renderCodexWorkflowPrompt` | CX14 / CX14b |
| E4 | mcp → `~/.codex/config.toml` 块级 upsert/delete：win32 `cmd /c` 包装；literal 路径；`env_vars`；非可执行 entrypoint → 块上方 `# opsforge-note:` 注释（替代旧 `_opsforge_notes` JSON 键）；吞并 `.env` 子表与旧 note；其余内容字节级保留；幂等；非 stdio fail-loud | `renderMcpServerBlockToml` / `upsertMcpServerBlock` / `deleteMcpServerBlock` / `injectMcp` | CX8 / CX10 / CX15a–f / CX16 / CX16b / RP1 |
| E5 | `platform.yaml` 三点升 `supported: true` → `tier()===1`；`workflow_orchestration`/`kb_mount`/`feedback_hook` 保持 `false + manual-paste`（诚实兜底） | `adapters/codex/platform.yaml` | CX1 / CX2 / CX4（DG1 改 dify 复测降级路径） |
| E6 | `paths.mjs`：`PLATFORM_MCP_PATHS['codex']` → `.codex/config.toml`，新增 `PLATFORM_MCP_FORMATS` + `mcpConfigFormatFor()`；`install.mjs`：`hasTomlMcpServerHeader()` + doctor S3 / repair 两处 format 门控（非 codex 路径行为逐字节不变） | `tools/paths.mjs` / `install.mjs` | PD6 / S3-codex×2（install.test.mjs）/ RP1（install.platform.test.mjs） |

## 明确不做（零影响红线）

- 不碰 `packs/` 14 个能力（install 无 platforms 成员门，功能不受影响；声明补全留作后续 steering 决策——补声明会触发 14 能力重发版）。
- 不动其他 5 平台 adapter / `schema/` / `templates/` / `registry*.yaml`。
- 零新依赖（TOML 合并为手写块级算法，非完整解析器；边界由 CX15 fixture 固化。
  若后续偏好 TOML 库，走 `deps-change` 标签另行审批）。
- 不追查、不迁移本机 config.toml 既有三段注入（bi-connector / sy-automl-mcp / opsforge-feedback）。

## 验收

- 单测：`node --test` bare 全绿（净增 CX 系列 + PD6 扩展 + S3-codex + RP1）。
- 零影响：`git diff --exit-code packs/ schema/ templates/ registry.yaml registry-brands.yaml
  adapters/claude-code adapters/cursor adapters/cline adapters/dify adapters/workbuddy` 无输出。
- e2e：`.e2e/e2e-evidence.md` Journey E（Steps 15a–15f）：临时 OPSFORGE_HOME 下
  四类能力 install → 四落点断言 → doctor 0 issue → uninstall → 无残留 + config.toml 还原。