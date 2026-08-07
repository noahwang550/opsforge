# WorkBuddy Adapter (Tier 2)

OpsForge 第 6 个平台适配器，支持 WorkBuddy AI 助手平台。

## 能力点 (9 点)

| 能力点 | 支持 | 降级策略 | 说明 |
|--------|------|---------|------|
| prompt_exec | ✅ | — | 核心 LLM 对话执行 (cli 模式) |
| agent_file | ❌ | cli-engine | WorkBuddy 无独立 agent 文件，agent 适配为 skill |
| skill_file | ✅ | — | `~/.workbuddy/skills/<name>/SKILL.md` |
| slash_command | ✅ | — | Skill 可通过 `/skill-name` 手动触发 |
| mcp_config | ✅ | — | `~/.workbuddy/mcp.json` 中的 mcpServers |
| workflow_orchestration | ❌ | cli-engine | 工作流降级为引导式 skill |
| config_dir_writable | ✅ | — | `~/.workbuddy/` 可读写 |
| kb_mount | ❌ | manual-paste | 无知识库挂载，产 paste 文件供手动粘贴 |
| feedback_hook | ❌ | manual-paste | 无原生反馈钩子，产 paste 文件 |

**Tier 判定**：Tier 2（prompt_exec + skill_file + slash_command + mcp_config + config_dir_writable = 5/6 Tier1 点支持；agent_file + workflow_orchestration 不支持）。与 cline/codex 同档但覆盖面更广。

## 能力映射

| OpsForge kind | WorkBuddy 载体 | 安装位置 | 触发方式 |
|--------------|---------------|---------|---------|
| agent | skill | `~/.workbuddy/skills/opsforge-<name>/SKILL.md` | 自动触发 / `/opsforge-<name>` |
| skill | skill | `~/.workbuddy/skills/opsforge-<name>/SKILL.md` | 自动触发 / `/opsforge-<name>` |
| mcp | mcp.json | `~/.workbuddy/mcp.json` → mcpServers | 连接器管理信任后自动可用 |
| workflow | skill (引导式) | `~/.workbuddy/skills/opsforge-<name>/SKILL.md` | 自动触发 / `/opsforge-<name>` |

agent 自动降级为 skill（cli-engine），无需 manual-paste，体验优于 cline/codex。所有能力统一加 `opsforge-` 前缀避免与 WorkBuddy 原生 skill 冲突。

## SKILL.md frontmatter 规范

WorkBuddy skill 使用 `summary` / `description` / `read_when` frontmatter（非 claude-code 的 `name`/`source`）：

```yaml
---
summary: "能力一句话描述"
description: "能力详细说明"
read_when:
  - "触发条件1"
  - "OpsForge 能力: <cap-id>"
---
```

## 安装命令

```bash
# 安装单个能力（自动探测平台，无需 --platform）
node install.mjs --install marketing-team.copywriter

# 显式指定 workbuddy 平台
node install.mjs --install marketing-team.copywriter --platform workbuddy

# dry-run 预览
node install.mjs --install marketing-team.copywriter --platform workbuddy --dry-run

# 降级安装（跳过 requires:hard 检查）
node install.mjs --install opsforge-meta.opsforge --platform workbuddy --downgrade
```

## 平台自动探测

不传 `--platform` 时，OpsForge 自动探测目标平台（按 `PLATFORM_DIRS` 顺序遍历已安装平台目录）。WorkBuddy 加入探测表后，`~/.workbuddy/` 存在即自动识别。

- 多平台已安装时，默认安装到首个探测到的平台，并提示用 `--platform` 指定其他平台。
- 未检测到任何平台时，列出可选平台引导用户指定。

## 安装后

- **重启 WorkBuddy 会话**：Skill 文件需重启会话后生效。
- **MCP 需手动信任**：MCP server 写入 `~/.workbuddy/mcp.json` 后，需在 WorkBuddy 连接器管理页面点击"信任"后工具才可用。
- **--downgrade**：能力声明 `requires: [{point: agent_file, severity: hard}]` 时，workbuddy 不支持 agent_file，需用 `--downgrade` 跳过 conform 检查（cli-engine 降级生效）。

## MCP entrypoint 说明

当前仓库中的 MCP 能力 entrypoint 是 `source.md`（接口描述文档），不是可执行 server 代码。安装后 MCP 配置的 `command: node` + `args: [source.md]` 无法真正运行。生产使用需在能力目录中实现真实 server 代码并更新 entrypoint。
