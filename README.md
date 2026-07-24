# OpsForge

> 一个运营能力仓库 + 多平台适配器 + 安装器：把 agent / skill / mcp / workflow 能力包**一次性安装进任意 AI agent 平台**（Claude Code / Cursor / Codex / Cline / Dify），之后运营人员**在平台内**用原生方式（`@agent` / `/slash` / skill / MCP）消费——日常零命令行。

[![tests](https://github.com/noahwang550/opsforge/actions/workflows/test.yml/badge.svg)](https://github.com/noahwang550/opsforge/actions/workflows/test.yml)
[![validate](https://github.com/noahwang550/opsforge/actions/workflows/validate.yml/badge.svg)](https://github.com/noahwang550/opsforge/actions/workflows/validate.yml)

## 这是什么

OpsForge 的核心约束（v6）：**所有未来的 skill/agent/mcp 迭代由无开发背景的业务运营人员通过 vibe coding 完成**。因此仓库本身把工程基线（运行时、布局、命名、测试、安全）机器强制锁死，让贡献者只动业务逻辑。

五层架构（自上而下）：
1. **Source** — 平台无关的能力源（三态：`_drafts/` → `_staged/` → 正式）
2. **Registry** — `registry.yaml` + `registry-brands.yaml`，`tools/release.mjs` 自动聚合，勿手编
3. **Adapter** — `adapters/<platform>/adapter.mjs`：`conform()` + `translate()` 成平台原生制品 + `install()`/`injectMcp()`
4. **Installer** — `install.sh`（POSIX sh bootstrap）+ `install.mjs`（Node 跨平台），per-project manifest
5. **Runtime** — 目标平台安装目录（`~/.claude/`、`.cursor/` 等）

安装后能力归化为平台原生制品：

| 能力类型 | Claude Code 落点 | 平台内用法 |
|---------|-----------------|-----------|
| agent | `~/.claude/agents/<name>.md` | `@name` 调用子代理 |
| skill | `~/.claude/skills/<name>/SKILL.md` | 自动触发 |
| workflow | `~/.claude/commands/workflow-<name>.md` | `/workflow-<name>` 斜杠命令 |
| mcp | `~/.claude.json` 的 `mcpServers` | 原生 MCP 工具 |

## 快速开始（从 GitHub 正常流程安装）

```bash
git clone https://github.com/noahwang550/opsforge.git
cd opsforge
npm install                       # Node 22 LTS（见 .nvmrc）
```

### 一次性首次设置（每台机器一次）
把 OpsForge 自身的 installer agent + wizard skill 装进你的 agent 平台：
```bash
node tools/opsforge-bootstrap.mjs --platform claude-code --project default
```
> 写入 `~/.claude/agents/` + `~/.claude/skills/` 的 `opsforge`/`opsforge-installer` agent 和 `opsforge-wizard` skill。幂等，重跑安全。**约束**：runtime 副本动态 import 仓库根 `install.mjs`，故仓库需持续存在于本机。

### 之后在 Claude Code 平台内（零命令）
- `@opsforge` 或 `@opsforge-wizard` → 6 选项中文菜单（新建/安装/我的能力/诊断/报告/反馈）
- 自然语言："帮我装营销团队包" → 引导式安装（质量灯+商用标签+依赖确认），后台装完出中文绿黄红报告
- 装完用：`@copywriter` 调子代理、`/workflow-campaign-retrospect` 斜杠命令、MCP 工具直接问数据

### 其它平台
- Cursor / Cline：同 bootstrap 模式（改 `--platform`）
- Codex：CLI 模式同上；纯 API 无终端退 manual-paste
- Dify：**做不到平台内安装**（Web 平台无可写配置目录），退 manual-paste 说明书——诚实兜底，不硬凑

## 命令速查

```bash
# 验证整套（提 PR 前必跑；绿条 = bare node --test）
node --test                              # 必须 bare，不带 glob
node tools/validate.mjs --all            # §A 结构合规 + 回归用例
node tools/security-scan.mjs --all      # §B 安全（0 findings）
node tools/eval.mjs --all                # v8 5 轴评分（pending）
node tools/release.mjs --all            # 3-report 发布门 + registry
node install.mjs --doctor --platform claude-code   # healthy 自检

# 创建能力（唯一合法方式，禁手建目录）
node tools/new-capability.mjs --kind skill --slug <slug> --name <name>

# 交互菜单 / 管理
node tools/opsforge.mjs menu
node tools/opsforge.mjs discover
node install.mjs --list | --install <pack>.<name>@<version> | --repair | --downgrade | --uninstall <id>
```

## 工程基线（非协商）

- **运行时**：Node.js 22 LTS（`.nvmrc`），ESM `.mjs`，唯一 sh 例外是 `install.sh`
- **包管理**：`npm` only（无 pnpm/yarn）
- **受控依赖**：仅 `ajv` / `js-yaml` / `semver`（+ dev `markdownlint-cli`）。加依赖需 `deps-change` PR 标签 + steering 审批
- **测试**：Node 内置 `node:test`，回归用例是声明式 `tests/*.yaml`
- **贡献者只能写 `.md` / `.yaml` / `.json`**。`.mjs`/`tools/`/`adapters/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json` 一律 steering 拥有（CODEOWNERS + `ci/guardrails.yml` 守卫）

## 平台能力点与降级（v9）

9 个正交能力点（`prompt_exec`/`agent_file`/`skill_file`/`slash_command`/`mcp_config`/`workflow_orchestration`/`config_dir_writable`/`kb_mount`/`feedback_hook`）按平台声明，自动算 Tier 1/2/3；缺能力点走 5 策略降级矩阵（`cli-engine`/`http-inject`/`manual-paste`/`http-direct`/`fail-loud`）。

| 平台 | Tier | 平台内安装 |
|------|------|-----------|
| claude-code | 1 | ✅ 可行（agent+terminal） |
| cursor | 1 | ✅ 可行 |
| cline | 1 | ✅ 可行 |
| codex | 2 | ⚠ 部分（manual-paste/http-inject 回退） |
| dify | 3 | ❌ 退 manual-paste |

## 文档导览

- [`CLAUDE.md`](CLAUDE.md) — Claude Code 专属补充指令
- [`AGENTS.md`](AGENTS.md) — 通用 AI 编码代理工程纪律（所有代理读）
- [`PLAN.md`](PLAN.md) — 权威蓝图（v9，§22）
- [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) — 落点步骤（Phase 0→4）
- [`PROGRESS.md`](PROGRESS.md) — 实际状态 + 经验教训
- [`ARCHITECTURE-DELTA.md`](ARCHITECTURE-DELTA.md) — 架构契约
- [`UX-PLAN-V2.md`](UX-PLAN-V2.md) — 非技术用户 UX 规格
- [`DESIGN.md`](DESIGN.md) — 逐文件蓝图
- [`DOCUMENT-INDEX.md`](DOCUMENT-INDEX.md) — 文档索引

## 贡献

见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。简言之：只用 `new-capability.mjs` 建能力，提 PR 前跑 `validate.mjs` + `security-scan.mjs` + bare `node --test` 全绿，不加依赖，不碰 steering 文件。

## 状态

Phase 1+2+3+3.6 SHIPPED（绿条 341/341，6 道 gate 全绿，7 个能力）。Phase 4（治理飞轮）规划中。详见 [`PROGRESS.md`](PROGRESS.md)。

## License

[Apache-2.0](LICENSE)
