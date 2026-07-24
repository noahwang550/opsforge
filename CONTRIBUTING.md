# 贡献指南

感谢贡献 OpsForge！本仓库的核心约束：**工程基线机器强制，业务逻辑可变**。请遵守：

## 谁能写什么

- **业务作者**：只能写 `.md` / `.yaml` / `.json`（能力 body、tests、capability.yaml 业务字段）
- **steering**：`.mjs`/`.js`/`.sh`、`tools/`/`adapters/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json`/`AGENTS.md`/`CLAUDE.md`（CODEOWNERS + `ci/guardrails.yml` 守卫，业务作者 PR 改这些会被挡）

## 新建能力（唯一合法方式）

```bash
node tools/new-capability.mjs --kind <agent|skill|mcp|workflow> --slug <slug> --name <名称>
```

绝不手建目录——`entry_guard` 会拒绝任何与 `templates/<kind>/` 签名不匹配的 `_drafts/` 目录。脚手架标记 `__FILL_ME__` 的槽位填业务字段即可。

## 三态流转

`_drafts/`（零门）→ `_staged/`（CI 加 schema + skeleton + 命名 + ≥3 tests + R16–R22）→ 正式发布（+ eval + 平台 matrix）。promote 必用 `node tools/new-capability.mjs --promote <path>`，禁手移。

## 提 PR 前（本地自检，全绿才提）

```bash
node --test                       # 绿条，必须 bare 不带 glob
node tools/validate.mjs --all     # §A 结构合规 + 回归
node tools/security-scan.mjs --all  # §B 安全（0 findings）
```

## 硬约束

- **不加依赖**：仅 `ajv`/`js-yaml`/`semver`。新增需 `deps-change` PR 标签 + steering 审批。
- **不改 schema**：`additionalProperties: false` 不破，不加字段。
- **不手编 registry**：`registry*.yaml` 由 `tools/release.mjs` 自动聚合。
- **slug 规则**：`^[a-z][a-z0-9-]{2,30}$`，首字符字母，全小写。
- **行尾**：仓库用 LF（`.gitattributes` 强制），勿引入 CRLF。

## 分支与提交

- 默认分支 `main`。功能开发开分支 `feat/<slug>` 或 `fix/<slug>`。
- 提交信息用约定式（`feat:`/`fix:`/`docs:`/`chore:`）。
- PR 需 CI 全绿（validate + test + security-scan + release gate）。

## 安全漏洞披露

见 [`SECURITY.md`](SECURITY.md)。勿在公开 issue 提敏感信息。

## 行为准则

参与即同意尊重所有贡献者。骚扰/歧视零容忍。
