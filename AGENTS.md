# AGENTS.md — OpsForge AI 编码代理工程纪律指令

> 本文件对所有 AI 编码代理（Claude Code / Cursor / Codex / Cline …）生效。权威清单在此；
> `CLAUDE.md` 为 Claude Code 专属补充，不重复本文件内容。

你在 OpsForge 仓库工作。以下纪律不可协商，违反即视为工程基线破坏。

1. **只修改业务作者能力目录内 `.md` / `.yaml` / `.json`**。一切可执行物（`.mjs` / `.js` / `.sh`、`adapters/` / `tools/` / `schema/` / `templates/` / `ci/` / `registry*.yaml` / `package.json` / `package-lock.json` / `.nvmrc` / `AGENTS.md` / `CLAUDE.md` / `install.*`）由 steering 持有，受 `CODEOWNERS` + `ci/guardrails.yml` 守卫。

2. **不得新增 frontmatter 字段**。能力 schema 为 `additionalProperties: false`，额外字段会被 `validate.mjs` 的 `schema` 检查拒绝。

3. **不得新增骨架外文件**。`skeleton_guard` 检查能力目录文件集必须与 `templates/<kind>/` 完全一致（无多无少）。

4. **不得修改 steering 拥有的路径**：`adapters/` / `tools/` / `schema/` / `templates/` / `ci/` / `registry*.yaml` / `package.json` / `AGENTS.md` / `CLAUDE.md`。如确需改动，提带 `steering` 标签的 PR 并由 steering 评审。

5. **不得引入新依赖**。受控依赖仅 `ajv` / `js-yaml` / `semver`（+ devDep `markdownlint-cli`）。任何 `package.json` 依赖字段变更需带 `deps-change` 标签 + steering 审批。

6. **提 PR 前必跑 `node tools/validate.mjs <path>` 且通过**（退出码 0）。CI 会跑 `--all`，本地先行自检。

7. **`source.md` / `SKILL.md` 不得含高危模式**：禁止"忽略以上指令""以管理员身份""你是 sysadmin""不要遵守规则"等提示注入话术（§B.1 block，不可豁免）。

8. **MCP `inputSchema` 不得允许任意 shell / 路径执行**。不得声明能执行任意命令、读写任意路径的工具面（§B over-privileged tool，不可豁免）。

9. **新建能力必用 `node tools/new-capability.mjs`**（或等价向导 `node tools/opsforge.mjs new`，v9 §22.8，内部调用前者），禁手建目录。手建目录会被 `entry_guard`（draft 入口守卫）拒绝。

10. **slug 全小写连字符**：正则 `^[a-z][a-z0-9-]{2,30}$`，3–31 字符，首字母小写字母。

11. **promote 必用 `node tools/new-capability.mjs --promote <path>`**，禁手移 `_drafts/` → `_staged/`。promote 不 bump version；version bump 由 release.mjs 负责。

12. **三态流转不可跳级**：`_drafts/`（零门：可解析 + id 唯一 + 中英名 + 占位符清空 + customer 一致 + 0.1.0 锁 + 入口守卫）→ `_staged/`（schema + skeleton + 命名 + 工程字段未篡改 + ≥3 用例 + 依赖闭包 + R16–R22 防空头 + functional runSuite，见 PLAN §21.8）→ 正式发布（release.mjs；released 态另要求 eval harness（eval-report pass）+ 平台 matrix + workflow dry-run）。

13. **能力 body 必含 `## 能力说明` + `## 适用场景` H2 章节**（staged+，R_scenario）。这两个章节是能力清单的 SSOT——README 的能力清单标记块与 `opsforge discover --all` 从中抽取详细说明与适配场景。`README.md` 中 `<!-- opsforge:capability-inventory start -->…end -->` 标记块由 `node tools/inventory.mjs --readme` 自动生成，**禁止手编**；CI `--check-readme` 漂移门控会挡。改了能力后跑 `--readme` 刷新。

14. **品牌隔离**：品牌能力在 `customers/<brand>/packs/`，带 `customer` 字段，`pack` 以品牌 slug 开头，`depends_on` 不得引用其他品牌。通用能力不得依赖品牌能力。

15. **占位符必须清空**：`__FILL_ME__` / `TODO` / `FIXME` 在 staged 全文扫描，0 命中。draft 阶段也清空（§14 草稿区放宽仍执行 R7）。

16. **工程字段勿改**：`id` / `version` / `kind` / `pack` / `entrypoint` / `tests` / `changelog` / `source.origin` 由脚手架预填；`engineering_fields_untampered` 校验与预填值一致。

如不确定，跑 `node tools/validate.mjs <path>`，报错消息即权威指引。
