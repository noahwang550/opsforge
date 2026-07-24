# OpsForge 工程基线速查（一页纸）

> 面向业务运营人员。3 分钟读完，知道边界在哪、红线在哪。完整规范见 `PLAN.md` / `DESIGN.md` / `ARCHITECTURE-DELTA.md` / `IMPLEMENTATION-PLAN.md`。

## 七条铁律

1. **你是业务作者，不是工程师**。你只写 `.md` / `.yaml` / `.json`。`.mjs` / `.js` / `.sh`、`tools/`、`schema/`、`templates/`、`ci/`、`package.json`、`registry*.yaml` 一律不要碰——它们由 steering 拥有，PR 会被 `ci/guardrails.yml` 挡下。

2. **新建能力唯一入口**：`node tools/new-capability.mjs --kind <kind> --slug <slug> --name <name>`（或等价的向导 `node tools/opsforge.mjs new`，v9 §22.8）。绝不手建目录——`entry_guard` 会拒绝任何与 `templates/<kind>/` 签名不匹配的 `_drafts/` 目录。脚手架生成的 `.opsforge-state.json` 是 steering overlay，勿手改/手删。

3. **slug 规则**：全小写字母 + 数字 + 连字符，3–31 字符，正则 `^[a-z][a-z0-9-]{2,30}$`，首字符必须是字母。

4. **占位符必须清空**：脚手架预填的 `__FILL_ME__` 全部替换成真实内容；不得出现 `TODO` / `FIXME`。`placeholder_clean` 全文扫描，0 命中才过。

5. **工程字段勿改**：`id` / `version` / `kind` / `pack` / `entrypoint` / `tests` / `changelog` / `source.origin` 由脚手架预填，`engineering_fields_untampered` 校验与预填值一致；改了就 fail。

6. **提 PR 前自检**：`node tools/validate.mjs <你的能力路径>`，退出码 0 才提。CI 会跑 `--all` 全仓校验 + markdown lint。

7. **三态流转**：`_drafts/`（草稿，零门）→ `_staged/`（审核：schema + skeleton + 命名 + 工程字段未篡改 + ≥3 用例 + R16–R22 防空头 + functional runSuite，见 PLAN §21.8）→ 正式发布（+ eval harness（eval-report `pass`/`pending`，Phase 2.2 已落地）+ 平台 matrix + workflow dry-run）。promote 必用 `node tools/new-capability.mjs --promote <path>`，禁手移。

## 受控依赖（只有这三个）

`ajv`（JSON Schema）、`js-yaml`（YAML）、`semver`（版本号）+ devDep `markdownlint-cli`。新增依赖需 `deps-change` 标签 + steering 审批。

## 运行时

Node.js 22 LTS（见 `.nvmrc`）。ESM `.mjs`。`npm` only。测试用 Node 内置 `node --test`。

## 报错解读

`validate.mjs` 的每条失败消息形如 `<规则名>: <原因>`，规则名即权威指引，对照本文件相应铁律修正即可。
