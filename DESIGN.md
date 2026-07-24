# OpsForge Phase 0 + Phase 1 — 逐文件技术设计

> 面向 TDD 实施者。所有路径以仓库根 `D:\XD\ClaudeCode\sy-eeo\` 为前缀（与 `CLAUDE.md`、`PLAN.md` 实际位置一致；PLAN.md §17 提到的 `opsforge/` 子目录视为后续可选下沉，Phase 0 直接在 `sy-eeo` 根落地，见 §8 开放决策 D0）。所有规则后注 PLAN.md 段落号或 §14 清单项以供追溯。

## 1. 构建顺序（TDD 友好）

按"先契约（schema/template）→ 再工具（tests-first）→ 最后 CI/文档"的顺序。每一步在前一步可独立测试的前提下进行：

1. **`package.json` + `.nvmrc` + `.markdownlint.json`** — 锁定运行时与受控依赖，使后续 `.mjs` 可 `import` ajv/js-yaml/semver。
2. **`schema/capability.schema.json`** — 能力元数据契约，是 validate.mjs 与脚手架预填的共同事实源（§5、§C.2、§14）。
3. **`templates/{agent,skill,mcp,workflow,bundle,brand-draft}/`** — 法定骨架，skeleton_guard 与 new-capability.mjs 的拷贝源（§C.2）。
4. **`tools/validate.mjs` 的测试用例（failing）** — 在实现前先写 ≥15 个失败用例（§7 测试计划）。
5. **`tools/validate.mjs` 实现** — 让测试逐条变绿（§5 规则矩阵）。
6. **`tools/new-capability.mjs` 的测试用例（failing）** — 脚手架行为契约（§7）。
7. **`tools/new-capability.mjs` 实现** — 含 `--promote`（§6 CLI 契约）。
8. **`AGENTS.md` + `CLAUDE.md` 增补对齐** — AI 代理纪律指令（§C.5）。
9. **`ci/guardrails.yml` + `CODEOWNERS`** — 路径守卫 + 依赖守卫（§C.4、§14）。
10. **`docs/engineering-baseline.md` + `docs/vibe-coding-playbook.md` + `docs/authoring-guide.md`** — 面向业务人员的文档（§C.7、§11.5）。

依赖关系：步骤 5 依赖 1+2+3；步骤 7 依赖 3+5；步骤 8/9 依赖 7；步骤 10 依赖 7+9。

## 2. 逐文件蓝图

### 2.1 `package.json`
- **用途**：受控依赖清单，业务作者无权改（§C.1、§C.4 依赖守卫）。
- **关键内容**：
  - `"name": "opsforge"`, `"private": true`, `"type": "module"`, `"version": "0.0.0"`, `"engines": { "node": ">=22.0.0 <23.0.0" }`
  - `dependencies`: `ajv`(^8)、`js-yaml`(^4)、`semver`(^7)
  - `devDependencies`: `markdownlint-cli`(^0.x)（CI 跑 markdown lint 用）
  - `scripts`: `"validate": "node tools/validate.mjs --all"`, `"new": "node tools/new-capability.mjs"`, `"test": "node --test"`, `"lint:md": "markdownlint '**/*.md'"`
- **规则**：依赖清单是 steering 资产；CI diff `package.json` 的 dependency 字段，非 `deps-change` 标签 PR 一律 block（§14 依赖守卫）。

### 2.2 `.nvmrc`
- **用途**：锁定 Node 版本（§C.1 D1）。
- **内容**：单行 `22`（或 `lts/jod`，Node 22 LTS 代号）。**推荐 `22`**。

### 2.3 `.markdownlint.json`
- **用途**：能力 `.md` body 的 lint 规则（§C.1）。
- **关键内容**：启用 MD001/MD003/MD012/MD025/MD032/MD041；关闭 MD013（行长度，因业务人员写中文长行）；`"default": true`。frontmatter 由 MD041 允许。

### 2.4 `schema/capability.schema.json`
见 §4 完整字段表。`additionalProperties: false`，`required` 列出全部必填工程+业务字段。

### 2.5 `templates/agent/`（及 6 个骨架）
见 §3 完整内容。

### 2.6 `tools/validate.mjs`
- **用途**：本地一行自检 + CI 校验，fail-loud 非零退出（§11.4、§C.4、§14）。
- **导出**：纯函数便于测试：
  - `parseCapability(dir: string): { yaml: object, rawYaml: string, path: string, state: 'draft'|'staged', kind: string }`
  - `checkSchema(cap): { name: 'schema', status: 'pass'|'fail', detail: string }`
  - `checkSkeletonGuard(cap, templateFileSet): { name:'skeleton_guard', ... }`
  - `checkPlaceholder(cap): { name:'placeholder_clean', ... }`
  - `checkNaming(cap): { name:'naming', ... }`
  - `checkEngineeringFieldsUntampered(cap): { name:'engineering_fields_untampered', ... }`
  - `checkVersionLock(cap): { name:'version_lock', ... }`
  - `checkDraftRelaxed(cap): { name:'draft_relaxed', ... }`（仅 draft 调用）
  - `validateDir(dir): { verdict:'pass'|'fail', checks: Check[] }` — 主入口，按 state 选择规则子集。
  - `validateAll(): { verdict, results: [...] }` — 扫描全部 `packs/_drafts/**`、`packs/_staged/**`、`customers/*/packs/_drafts/**`、`customers/*/packs/_staged/**`。
  - `main()` — CLI：`node tools/validate.mjs <path> | --all`，输出人类可读 + 退出码。
- **状态判定算法**：路径包含 `/_drafts/` → `draft`；包含 `/_staged/` → `staged`；包含 `/customers/<brand>/packs/_drafts/` → 品牌草稿；`/customers/<brand>/packs/_staged/` → 品牌审核。
- **规则矩阵**：见 §5。每条 check 返回精确 detail 字符串（即失败消息）。

### 2.7 `tools/new-capability.mjs`
- **用途**：新建能力的唯一合法入口（§C.2、§C.3、§11.5）。
- **导出**：
  - `scaffold({ kind, slug, name, brand, thirdParty }): { destPath, prTitle }` — 从 `templates/<kind>/` 拷贝到 `_drafts/`，替换占位符 `__SLUG__`/`__NAME__`/`__BRAND_SLUG__`。
  - `promote(srcPath): { destPath }` — `_drafts/` → `_staged/` 迁移（禁止手移，§11.5 Step 6）。
  - `matchSkeletonSignature(dir, kind): { match: boolean, expected: string[], actual: string[] }` — 供 validate.mjs 复用的签名比对。
  - `main()` — CLI 入口（§6 契约）。

### 2.8 `AGENTS.md`
- **用途**：通用 AI 编码代理工程纪律指令，所有代理读（§C.5 机制 1）。
- **关键内容**（自然语言条目，与 §C.5 列出的要点一一对应）：
  - 你在 OpsForge 仓库工作；只修改业务作者能力目录内 `.md/.yaml/.json`。
  - 不得新增 frontmatter 字段（schema `additionalProperties:false` 拒绝）。
  - 不得新增骨架外文件（skeleton_guard 拒绝）。
  - 不得修改 `adapters/`/`tools/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json`/`AGENTS.md`/`CLAUDE.md`。
  - 不得引入新依赖。
  - 提 PR 前必跑 `node tools/validate.mjs <path>` 且通过。
  - `source.md`/`SKILL.md` 不得含"忽略以上指令""以管理员身份"等高危模式（§B.1 block）。
  - MCP `inputSchema` 不得允许任意 shell/路径。
  - 新建能力必用 `node tools/new-capability.mjs`，禁手建目录。
  - slug 全小写连字符，3–31 字符，正则 `^[a-z][a-z0-9-]{2,30}$`。

### 2.9 `CLAUDE.md`（增量编辑）
- 现有 `CLAUDE.md` 已与基线对齐；Phase 0 仅需补一行交叉引用：`> 工程纪律的权威清单见 AGENTS.md；本文件为 Claude Code 专属补充，不重复 AGENTS.md 内容。` 并确认 §"AI-agent instruction files" 与 AGENTS.md 不冲突。无需重写。

### 2.10 `ci/guardrails.yml`
- **用途**：GitHub Actions 路径守卫 + 依赖守卫（§C.4、§14 路径/依赖守卫）。
- **关键 job**：
  - `path-guard`：对 PR diff 检查，若业务作者 PR 触碰以下路径则 fail：`adapters/**`、`tools/**`、`schema/**`、`templates/**`、`ci/**`、`registry*.yaml`、`package.json`、`package-lock.json`、`.nvmrc`、`AGENTS.md`、`CLAUDE.md`、`install.sh`、`install.mjs`、`*.mjs`、`*.js`、`*.sh`（§14 路径守卫）。例外：带 `steering` 标签的 PR 跳过。
  - `deps-guard`：`package.json` 的 `dependencies`/`devDependencies` 字段 diff，若变更且 PR 无 `deps-change` 标签 → fail（§C.4、§14 依赖守卫）。
  - `entry-guard`：`_drafts/` 下新增能力目录须通过 `validate.mjs` 的 skeleton 签名匹配（§14 新建入口守卫）。
  - `validate`：跑 `node tools/validate.mjs --all`。
  - `markdownlint`：跑 `npm run lint:md`。
- **失败消息模板**：`path-guard: <file> is steering-owned; business authors may not modify it. Add label 'steering' for steering PRs.`

### 2.11 `CODEOWNERS`
- **用途**：强制 steering 评审关键路径（§C.4 D3）。
- **内容**：
  ```
  *                                       @opsforge/steering
  /adapters/                              @opsforge/steering
  /tools/                                 @opsforge/steering
  /schema/                                @opsforge/steering
  /templates/                             @opsforge/steering
  /ci/                                    @opsforge/steering
  /AGENTS.md                              @opsforge/steering
  /CLAUDE.md                              @opsforge/steering
  /package.json                           @opsforge/steering
  /package-lock.json                      @opsforge/steering
  /.nvmrc                                 @opsforge/steering
  /registry*.yaml                         @opsforge/steering
  /install.sh                             @opsforge/steering
  /install.mjs                            @opsforge/steering
  ```

### 2.12 `docs/engineering-baseline.md`
- **用途**：业务人员 3 分钟速查一页纸（§C.7）。内容直接照搬 §C.7 七条。

### 2.13 `docs/vibe-coding-playbook.md`
- **用途**：业务人员 vibe coding 操作手册（§11.5、§C.3）。覆盖 Step 0–7，含"对 AI 代理说什么"的话术模板与 `validate.mjs` 报错解读示例。

### 2.14 `docs/authoring-guide.md`
- **用途**：面向无开发背景业务人员的填空式指南（§11.5、§C.3）。覆盖：用脚手架起骨架→填 `__FILL_ME__`→写 `source.md`/`SKILL.md`→写 `tests/*.yaml`→跑 validate→提 PR。不出现任何代码。

## 3. 模板骨架内容（6 种，法定文件集）

所有 frontmatter 业务字段用 `__FILL_ME__` 占位；工程字段由脚手架在 scaffold 时替换 `__SLUG__`/`__NAME__`/`__BRAND_SLUG__`。

### 3.1 `templates/agent/`
文件集：`capability.yaml`、`source.md`、`tests/case-01.yaml`、`tests/case-02.yaml`、`tests/case-03.yaml`、`CHANGELOG.md`、`README.md`。

`capability.yaml`：
```yaml
id: __SLUG__.__NAME__            # 脚手架预填，勿改
version: 0.1.0                   # 脚手架预填，勿改
kind: agent                      # 脚手架预填，勿改
pack: __SLUG__                   # 脚手架预填，勿改
owner: __SLUG__                  # 脚手架预填，勿改
# customer: __BRAND_SLUG__       # 品牌能力时脚手架取消注释并填值
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
```

`source.md`：
```markdown
---
{{frontmatter 同 capability.yaml}}
---
<!-- 业务作者在此写 agent body。不要新增 frontmatter 字段，不要改文件名，不要在骨架外造文件。 -->
__FILL_ME__
```
> 说明：agent 的 frontmatter 物理位置在 `source.md` 顶部（Claude Code agent 约定）。`capability.yaml` 作为单一事实源；若平台约定要求 frontmatter 在 `.md`，脚手架在 `source.md` 内复制同一份 frontmatter。Phase 0 两者并存，validate 以 `capability.yaml` 为准。

`tests/case-01.yaml`：
```yaml
name: __FILL_ME__
input: __FILL_ME__
expected: __FILL_ME__
```
（case-02/03 同构。）

`CHANGELOG.md`：
```markdown
# Changelog
All notable changes are documented here. Format: Keep a Changelog.
## [0.1.0] - Unreleased
- __FILL_ME__
```

`README.md`：
```markdown
# __FILL_ME__
> 一句话能力说明（业务作者填）。
```

### 3.2 `templates/skill/`
文件集：`SKILL.md`、`tests/case-01.yaml`、`tests/case-02.yaml`、`tests/case-03.yaml`、`CHANGELOG.md`、`README.md`。

`SKILL.md`（frontmatter + body 合一，§C.2）：
```markdown
---
id: __SLUG__.__NAME__
version: 0.1.0
kind: skill
pack: __SLUG__
owner: __SLUG__
# customer: __BRAND_SLUG__
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
---
<!-- 业务作者在此写 skill 正文。 -->
__FILL_ME__
```

### 3.3 `templates/mcp/`
文件集：`mcp.yaml`、`source.md`、`tests/case-01.yaml`、`tests/case-02.yaml`、`tests/case-03.yaml`、`CHANGELOG.md`、`README.md`。

`mcp.yaml`：
```yaml
id: __SLUG__.__NAME__
version: 0.1.0
kind: mcp
pack: __SLUG__
owner: __SLUG__
# customer: __BRAND_SLUG__
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
transport: stdio            # stdio | sse | http
config_template:
  auth_schema: []           # 声明需要的 env 变量名，不含密钥
tools: []                  # 每项 {name, description, inputSchema}
source:
  origin: original
  upstream_ref: null
```

### 3.4 `templates/workflow/`
文件集：`workflow.yaml`、`params.schema.json`、`tests/case-01.yaml`、`tests/case-02.yaml`、`tests/case-03.yaml`、`CHANGELOG.md`、`README.md`。

`workflow.yaml`：
```yaml
id: __SLUG__.__NAME__
version: 0.1.0
kind: workflow
pack: __SLUG__
owner: __SLUG__
# customer: __BRAND_SLUG__
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
params_schema: params.schema.json
steps:
  - id: __FILL_ME__
    capability: __FILL_ME__
    inputs: {}
    outputs: []
outputs: {}
tests: tests/
changelog: CHANGELOG.md
source:
  origin: original
  upstream_ref: null
```
`params.schema.json`：
```json
{ "$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {}, "additionalProperties": false }
```

### 3.5 `templates/bundle/`
文件集：`bundle.yaml`、`tests/case-01.yaml`、`tests/case-02.yaml`、`tests/case-03.yaml`、`CHANGELOG.md`、`README.md`。

`bundle.yaml`：
```yaml
id: __SLUG__.__NAME__
version: 0.1.0
kind: bundle
pack: __SLUG__
owner: __SLUG__
# customer: __BRAND_SLUG__
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
capabilities: []           # 列出 <pack>.<name>@<range>
workflows: []
tests: tests/
changelog: CHANGELOG.md
source:
  origin: original
  upstream_ref: null
```

### 3.6 `templates/brand-draft/`
- **用途**：品牌定制草稿骨架（§11.1、§15）。文件集与 agent 骨架一致（`capability.yaml`、`source.md`、`tests/*`、`CHANGELOG.md`、`README.md`），区别仅在 frontmatter：`customer` 行**默认取消注释**且填 `__BRAND_SLUG__`，`pack` 与 `owner` 也填 `__BRAND_SLUG__`。
`capability.yaml`：
```yaml
id: __BRAND_SLUG__.__NAME__
version: 0.1.0
kind: agent
pack: __BRAND_SLUG__
owner: __BRAND_SLUG__
customer: __BRAND_SLUG__
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
```
> 说明：`brand-draft` 实质是"agent + customer 预置"的品牌变体；脚手架对品牌能力默认选此模板。skill/mcp/workflow/bundle 的品牌版本由脚手架在对应模板上注入 `customer` 字段（Phase 0 暂只提供 brand-draft 一种品牌骨架，其余品牌变体留 Phase 3，记 D5）。

## 4. `schema/capability.schema.json` 字段表

JSON Schema draft-07，`"additionalProperties": false`。`required` 覆盖所有列出的工程+业务必填字段（`customer`、`depends_on`、`source.upstream_ref` 等可选项除外）。

| 字段 | 类型 | required | 约束 | JSON Schema 可表达? | 备注/§追溯 |
|---|---|---|---|---|---|
| `id` | string | 是 | `^[a-z][a-z0-9-]{2,30}\.[a-z][a-z0-9-]{2,30}$` | 是（pattern） | §5.1、§14 命名 |
| `version` | string | 是 | 合法 semver | 是（pattern `^\d+\.\d+\.\d+$`） | §13.1；0.1.0 锁由运行时 |
| `kind` | enum | 是 | `agent\|skill\|mcp\|workflow\|bundle` | 是 | §5 |
| `pack` | string | 是 | `^[a-z][a-z0-9-]{2,30}$` | 是 | §5.1 |
| `owner` | string | 是 | 同 pack 规则 | 是 | §5 |
| `customer` | string | 否 | 同 pack 规则；存在则触发品牌守卫 | 是（pattern） | §5.2、§14 品牌隔离 |
| `display_name` | string | 是 | 非空 | 是（minLength 1） | §5 |
| `display_name_zh` | string | 是 | 非空 | 是 | §14 i18n |
| `display_name_en` | string | 是 | 非空 | 是 | §14 i18n |
| `description` | string | 是 | 非空 | 是 | §5 |
| `platforms` | array<string> | 是 | minItems 1；items enum `claude-code\|cursor\|codex\|cline` | 是 | §14 platforms |
| `entrypoint` | string | 是 | 非空 | 是 | §5 |
| `tests` | string | 是 | 常量 `tests/` | 是（const） | §C.2 工程字段 |
| `changelog` | string | 是 | 常量 `CHANGELOG.md` | 是（const） | §C.2 |
| `depends_on` | array<string> | 否 | 每项 `<slug>.<name>@<range>` | 部分（pattern 可表达格式，方向/环由运行时） | §13.4 |
| `source` | object | 是 | 见下 | 是 | §5.4 |
| `source.origin` | enum | 是 | `original\|forked` | 是 | §5.4 |
| `source.upstream_ref` | string\|null | 否 | origin=original 时须 null | 是（若 origin=original 则 null，可用 if/then） | §A.2 |
| `transport`（mcp） | enum | 条件 required(kind=mcp) | `stdio\|sse\|http` | 是 | §A.1 |
| `config_template`（mcp） | object | 条件 | 见 mcp 子 schema | 是 | §A.1 |
| `tools`（mcp） | array | 否 | 每项 {name,description,inputSchema} | 是 | §A.1 |
| `steps`（workflow） | array | 条件 required(kind=workflow) | 见 workflow 子 schema | 是 | §7.1 |
| `params_schema`（workflow） | string | 条件 | 常量 `params.schema.json` | 是 | §7 |
| `outputs`（workflow） | object | 否 | 顶层 outputs 声明（模板默认 `{}`） | 是 | §3.4 |
| `capabilities`（bundle） | array | 条件 | 见 bundle 子 schema | 是 | §C.2 |

**JSON Schema 无法表达、须 validate.mjs 运行时校验的项**：
- 0.1.0 草稿锁（§14 版本合法：草稿区必须 0.1.0）。
- 工程字段未篡改（§14：`id`/`version`/`kind`/`pack`/`entrypoint`/`tests`/`changelog` 与脚手架预填值一致）。
- 占位符清空（`__FILL_ME__`/`TODO`/`FIXME` 全文扫描）。
- 骨架守卫（文件集合与 templates 一致）。
- 命名空间唯一性、依赖方向/环、品牌路径强一致。
- `id` 的 slug 与 name 分别匹配 pack 与 name 字段（schema 可表达但运行时更显式）。

## 5. `validate.mjs` 规则矩阵

`state` 列：`D`=draft（含品牌草稿），`S`=staged（含品牌审核）。`✓`=执行，`—`=豁免（§14 草稿区放宽）。

| # | 检查名 | 校验内容 | 通过条件 | 失败消息（精确） | D | S | §追溯 |
|---|---|---|---|---|---|---|---|
| R1 | `schema` | capability.yaml 通过 ajv + `additionalProperties:false` | ajv errors=0 | `schema: <file> failed AJV: <ajv-error-path> <ajv-message>` | — | ✓ | §14 schema 合规、§A.2 结构层 |
| R2 | `yaml_parse` | YAML 可解析 | js-yaml 不抛 | `yaml_parse: <file> is not valid YAML: <error>` | ✓ | ✓ | §14 草稿区放宽 |
| R3 | `id_unique` | id 在全仓（通用+品牌）唯一 | 无重复 | `id_unique: id "<id>" duplicated at <other-path>` | ✓ | ✓ | §14 命名空间 |
| R4 | `naming` | slug/name 均匹配 `^[a-z][a-z0-9-]{2,30}$`；id=`<pack>.<name>` | 全部匹配 | `naming: "<token>" does not match ^[a-z][a-z0-9-]{2,30}$` 或 `naming: id "<id>" != "<pack>.<name>"` | — | ✓ | §14 命名、§C.4 |
| R5 | `version_lock` | draft 区 `version` 恒为 `0.1.0` | 严格相等 | `version_lock: draft version must be 0.1.0, got "<v>"` | ✓ | — | §14 版本合法、§C.4 |
| R6 | `version_semver` | staged 区 version 合法 semver | semver.valid≠null | `version_semver: "<v>" is not valid semver` | — | ✓ | §13.1 |
| R7 | `placeholder_clean` | 全文（含 tests/*.yaml、source.md）无 `__FILL_ME__`/`TODO`/`FIXME` | 0 命中 | `placeholder_clean: <file>:<line> contains placeholder "<token>"` | ✓ | ✓ | §14 占位符、§C.4 |
| R8 | `skeleton_guard` | 能力目录相对文件集合 == `templates/<kind>/` 文件集合 | 完全相等（无多无少） | `skeleton_guard: file set mismatch; missing=[...], extra=[...]` | — | ✓ | §14 骨架守卫、§C.4 |
| R9 | `engineering_fields_untampered` | `id`/`version`(draft)/`kind`/`pack`/`entrypoint`/`tests`/`changelog`/`source.origin` 与脚手架预填值一致 | 全一致 | `engineering_fields_untampered: field "<field>" expected "<exp>" got "<got>"` | — | ✓ | §14 工程字段未篡改 |
| R10 | `display_names_i18n` | `display_name_zh`/`display_name_en` 均非空 | 非空 | `display_names_i18n: <field> is empty` | ✓ | ✓ | §14 i18n |
| R11 | `customer_dir_consistency` | 若 `customer` 存在：物理路径含 `customers/<customer>/`；`pack` 以 `<customer>` 开头 | 全成立 | `customer_dir_consistency: customer "<c>" but path "<p>" not under customers/<c>/` 或 `...: pack "<p>" must start with "<c>"` | ✓ | ✓ | §14 品牌隔离 |
| R12 | `depends_on_resolvable` | depends_on 每项 `<slug>.<name>@<range>` 可在仓内解析 | 全可解析 | `depends_on_resolvable: "<dep>" unresolvable` | — | ✓ | §14 依赖闭包 |
| R13 | `depends_on_direction` | 方向合规（通用→通用+third-party；品牌→通用+third-party+同品牌；收录→无） | 全合规 | `depends_on_direction: "<dep>" violates direction (<reason>)` | — | ✓ | §13.4 |
| R14 | `tests_min` | staged `tests/` 下 ≥3 条 `.yaml` 用例 | count≥3 | `tests_min: expected >=3 test cases, got <n>` | — | ✓ | §14 回归样例、§C.4 |
| R15 | `entry_guard` | `_drafts/` 下新目录的骨架签名与某 `templates/<kind>/` 匹配 | 匹配 | `entry_guard: "<dir>" not generated by new-capability.mjs (no template signature match)` | ✓ | — | §14 新建入口守卫 |

> 说明：draft 态执行 R2/R3/R5/R7/R10/R11/R15（与 §14 草稿区放宽一致：id 唯一+可解析+中英名+占位符清空+customer 一致，另加 R5 0.1.0 锁与 R15 入口守卫以护住"工程基线前置"语义）。staged 态执行 R1/R2/R3/R4/R6/R7/R8/R9/R10/R11/R12/R13/R14。任一 fail → `verdict:fail`，退出码 1。

## 6. `new-capability.mjs` CLI 契约

**调用形式**（§11.1、§11.5、§11.6）：
```
node tools/new-capability.mjs --kind <agent|skill|mcp|workflow|bundle> --slug <slug> --name <name>
node tools/new-capability.mjs --kind <kind> --brand <brand-slug> --name <name>
node tools/new-capability.mjs --kind <kind> --third-party <upstream-name> --slug third-party --name <name>
node tools/new-capability.mjs --promote <path>
```

**参数解析**：手写 `process.argv` 解析（不引入新依赖，§C.1）。支持 `--kind`/`--slug`/`--name`/`--brand`/`--third-party`/`--promote`。互斥规则：`--promote` 与其它互斥；`--brand` 隐含 `--slug=<brand>`；`--third-party` 隐含 `source.origin=forked` 且从 `templates/<kind>/` 拷贝并预置 `upstream_ref`。

**写入位置**：
- 通用：`packs/_drafts/<slug>/<name>/`
- 品牌：`customers/<brand>/packs/_drafts/<brand>/<name>/`
- 收录：`packs/_third-party/<name>/`（Phase 0 仅校验路径生成，不实现完整收录流程；记 D6）

**占位符替换**：拷贝模板后，遍历文件将 `__SLUG__`→slug、`__NAME__`→name、`__BRAND_SLUG__`→brand。`__FILL_ME__` 保留不动（业务作者填）。

**skeleton-signature 匹配算法**（供 R8/R15 复用）：
```
matchSkeletonSignature(dir, kind):
  actual = sorted(relative paths under dir, '/'-sep, exclude '.git')
  expected = sorted(relative paths under templates/<kind>/)
  missing = expected \ actual
  extra = actual \ expected
  return { match: missing==[] && extra==[], expected, actual, missing, extra }
```
- R15（draft 入口守卫）：对 `_drafts/` 下任意能力目录，尝试与所有 `templates/<kind>/` 比对，若无一匹配 → fail。
- new-capability.mjs 自身拷贝即天然匹配，作为正向基线。

**`--promote <path>` 语义**（§11.5 Step 6）：
- 校验 `<path>` 位于 `.../_drafts/<slug>/<name>/`（或品牌草稿路径）。
- 校验 `matchSkeletonSignature` 通过（防止 promote 前被手改破坏骨架）。
- 计算目标路径：把路径段 `_drafts` 替换为 `_staged`。
- 校验目标不存在或为空，原子 `rename`（`fs.rename`）。
- 不修改任何 frontmatter（promote 不 bump version；bump 由 release.mjs 负责，§C.6）。
- 打印后续 PR 标题：`[stage] <slug>.<name>` 或 `[stage-brand] <brand>.<name>`。
- 退出码：成功 0，失败 1 并打印 `promote: <reason>`。

**输出**：脚手架完成后打印 `created: <destPath>` 与 `next: node tools/validate.mjs <destPath>` 与 PR 标题建议。

## 7. TDD 测试计划（先写失败用例）

测试运行器：Node 内置 `node --test`（§C.1）。测试文件位置：`tools/validate.test.mjs`、`tools/new-capability.test.mjs`。每个用例在临时目录构造 fixture（用 `fs.mkdtempSync` + `os.tmpdir()`），避免污染仓库。

validate.mjs 用例（≥12）：

1. **T1 schema rejects unknown field** — 给 staged capability.yaml 加 `bogus: 1` → 期望 `schema` check fail，detail 含 `additionalProperties`。
2. **T2 schema rejects missing required** — 删 `display_name_en` → fail，detail 含 `display_name_en`。
3. **T3 skeleton_guard fails on extra file** — staged agent 目录加 `extra.md` → fail，detail 含 `extra=[extra.md]`。
4. **T4 skeleton_guard fails on missing file** — 删 `CHANGELOG.md` → fail，detail 含 `missing=[CHANGELOG.md]`。
5. **T5 placeholder_clean fails on `__FILL_ME__` in staged** — staged 的 `description: __FILL_ME__` → fail，detail 指到文件行。
6. **T6 placeholder_clean fails on TODO** — `source.md` 含 `TODO: xxx` → fail。
7. **T7 naming rejects `My_Slug`** — slug=`My_Slug` → fail，detail 含正则。
8. **T8 naming rejects uppercase name** — name=`CamelCase` → fail。
9. **T9 naming rejects id mismatch** — id=`a.b` 但 pack=`c` → fail。
10. **T10 version_lock fails when draft != 0.1.0** — draft version=`0.2.0` → fail。
11. **T11 version_semver fails on invalid staged version** — staged version=`1.0` → fail。
12. **T12 engineering_fields_untampered fails when kind changed** — 把 `kind: agent` 改 `kind: skill` → fail。
13. **T13 entry_guard fails on hand-made draft dir** — 手建 `_drafts/x/y/` 不匹配任何模板 → fail。
14. **T14 customer_dir_consistency fails when customer ≠ path** — `customer: acme` 但路径在 `customers/other/` → fail。
15. **T15 tests_min fails when <3 cases in staged** — staged 只有 2 条用例 → fail。
16. **T16 draft relaxes skeleton_guard** — draft 缺 `CHANGELOG.md` → skeleton_guard 不执行（pass verdict，仅 draft 子集）。
17. **T17 id_unique fails on duplicate** — 两个 draft 同 id → 第二个 fail。
18. **T18 --all aggregates verdict** — 混合 pass/fail 目录 → verdict=fail，列出每个失败。

new-capability.mjs 用例（≥5）：

19. **T19 scaffold creates correct file set** — `--kind skill --slug foo --name bar` → dest 含 SKILL.md/tests/CHANGELOG.md/README.md。
20. **T20 scaffold replaces `__SLUG__`/`__NAME__`** — 生成的 frontmatter `id: foo.bar`。
21. **T21 scaffold keeps `__FILL_ME__`** — `description` 仍为 `__FILL_ME__`。
22. **T22 brand scaffold writes under customers/<brand>/packs/_drafts/** — `--brand acme --name bot` → dest 在 `customers/acme/packs/_drafts/acme/bot/`，且 `customer: acme`。
23. **T23 promote moves drafts→staged** — promote 后源消失、目标存在，frontmatter 不变。
24. **T24 promote rejects hand-moved dir (skeleton mismatch)** — 手改后的 draft promote → fail。
25. **T25 third-party sets origin=forked** — `--third-party awesome` → `source.origin: forked`。

## 8. 偏差 / 开放决策

引用 PLAN.md §C 的 D1–D4 并给推荐默认：

- **D0（新增，路径根）**：PLAN.md §17 写"仓库根假定为 `D:\XD\ClaudeCode\sy-eeo\opsforge\`"，但实际 `PLAN.md`/`CLAUDE.md` 位于 `D:\XD\ClaudeCode\sy-eeo\`。**推荐**：Phase 0 以 `sy-eeo` 为仓库根落地（无 `opsforge/` 子目录），避免空层；若后续需 monorepo 多包再下沉。需 steering 确认。
- **D1（Node 版本，§C.1）**：**推荐 Node 22 LTS**（`.nvmrc`=`22`）。PLAN.md 已默认 22；与 `engines` 一致。若公司镜像仅 20，下调时同步 `.nvmrc`+CI matrix，但 Phase 0 先按 22。
- **D2（禁止业务作者写 .mjs/.js，§C.2）**：**推荐默认禁止**（最严护栏）。业务作者只能写 `.md/.yaml/.json`。`.mjs/.js` 文件一律要求 CODEOWNERS steering 评审（`ci/guardrails.yml` path 守卫已覆盖）。若需"准开发者"写 MCP server，走 steering 个案审批 + `code-owner` 评审，Phase 0 不开此通道（留 D5）。
- **D3（CODEOWNERS 强制评审关键路径，§C.4）**：**推荐默认强制**。`CODEOWNERS` 对 `adapters/`/`tools/`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package*.json`/`.nvmrc`/`AGENTS.md`/`CLAUDE.md`/`install.*` 全部指向 steering。GitHub 要求每个该类 PR 至少一位 steering 审批。
- **D4（随仓 ship AGENTS.md/CLAUDE.md，§C.5）**：**推荐默认 ship**。这是 v6 核心机制。误改风险由 CODEOWNERS + `ci/guardrails.yml` path 守卫兜底，足够。
- **D5（仅 brand-draft 一种品牌骨架，§3.6）**：Phase 0 只提供 agent 型品牌骨架；skill/mcp/workflow/bundle 的品牌变体由脚手架在对应模板注入 `customer` 字段（运行时支持），不在 templates 增实体文件。需 steering 确认是否接受。
- **D6（third-party 收录 Phase 0 范围）**：Phase 0 的 `--third-party` 仅生成目录结构与 `source.origin=forked` 标记；完整 `upstream.ref.yaml`/`LICENSE.upstream`/`wrapping.yaml` 校验留 Phase 3（§12）。需 steering 确认 Phase 0 不实现 LICENSE 白名单校验。

## 相关文件路径（均为绝对路径）

- 规范源：`D:\XD\ClaudeCode\sy-eeo\PLAN.md`、`D:\XD\ClaudeCode\sy-eeo\CLAUDE.md`
- 设计稿：`D:\XD\ClaudeCode\sy-eeo\DESIGN.md`（本文件）
- Phase 0 待实施文件清单（均以 `D:\XD\ClaudeCode\sy-eeo\` 为根）：
  - `package.json`、`.nvmrc`、`.markdownlint.json`
  - `schema/capability.schema.json`
  - `templates/agent/`、`templates/skill/`、`templates/mcp/`、`templates/workflow/`、`templates/bundle/`、`templates/brand-draft/`
  - `tools/validate.mjs`、`tools/validate.test.mjs`、`tools/new-capability.mjs`、`tools/new-capability.test.mjs`
  - `AGENTS.md`、`CLAUDE.md`（增量编辑）
  - `ci/guardrails.yml`、`CODEOWNERS`
  - `docs/engineering-baseline.md`、`docs/vibe-coding-playbook.md`、`docs/authoring-guide.md`

---

# Phase 1 增量蓝图（在 Phase 0 基线上 ADD，不重写既有节）

> 本块由 `ARCHITECTURE-DELTA.md` §6.1 授权增补。Phase 0 各节（§1–§8）保持不变；以下新增 §2.15–§2.24（§2 逐文件蓝图续）、§3.7（§3 模板续）、§5.1–§5.3（§5 规则矩阵续）、§9（数据形状，新顶层节）、§10（新增 schema，新顶层节）。所有路径以 `D:\XD\ClaudeCode\sy-eeo\` 为根。状态：Phase 1 已 SHIPPED，140/140 测试绿。规范源为 `PLAN.md` v9（§6/§7/§8/§13/§A/§B/§C/§14/§20/§21/§22）+ `PLAN-supplement-v7/v8/v9.md` + `ARCHITECTURE-DELTA.md` + `IMPLEMENTATION-PLAN.md`。

## 2.15 `adapters/base.mjs`（NEW，v9 §22.3 / §6.2）

- **用途**：所有平台适配器的基类，固化 v9 平台能力点模型（9 个正交点）+ 6 个既有适配器方法默认实现。
- **导出**：`export class BaseAdapter`
  - `loadPlatformYaml(platformDir): PlatformYaml` — 经 js-yaml 读 `adapters/<platform>/platform.yaml`，按 `platform.schema.json` 校验，失败 fail-loud 抛错；实例级 memoize。
  - `supports(point): SupportsResult` — 纯函数，查 memoized yaml，返回 `{supported, fallback?, meta?}`。`point` 取 9 点之一。
  - `tier(): 1|2|3` — 纯函数。Tier1 = `prompt_exec`+`agent_file`+`skill_file`+`slash_command`+`mcp_config`+`config_dir_writable` 全 true；Tier3 = 仅 `prompt_exec` true；否则 Tier2。
  - 默认 no-op：`conform(cap)→{ok:true,errors:[]}`、`translate(cap,opts)→[]`、`install`/`injectMcp`/`uninstall` 抛 `'unsupported on base'`（强制子类覆写）、`detect()→false`。
- **typedefs（同文件 JSDoc）**：`PlatformYaml`、`CapabilityPointDecl`、`SupportsResult`、`PlatformArtifact`、`InstallOpts`、`ConformResult`。`PlatformArtifact` 是 `translate()` 返回、`install()` 消费的内存单元（见 §9）。
- **副作用/抛错**：`loadPlatformYaml` 读 fs 且缺失/非法时 fail-loud 抛错；`supports`/`tier` 纯；`conform`/`translate` 纯（不写 fs）；`install`/`injectMcp`/`uninstall` 写平台安装目录 + manifest，Tier-3 base 上抛错强制覆写。
- **§追溯**：PLAN.md §22.3（适配器契约 + supports/tier）、§6.2（6 方法）、§22.5（`requires:hard` 检查在 `conform`，见 §5.3）。

## 2.16 `adapters/claude-code/{adapter.mjs,platform.yaml,mcp-config.template.json}`（NEW，§6.2/§22.3/§A.2）

- **用途**：claude-code 平台适配器（Phase 1 唯一适配器；cursor/codex/cline 在 Phase 2.1）。
- **`adapter.mjs` 导出**：`export class ClaudeCodeAdapter extends BaseAdapter` + `export const adapter = new ClaudeCodeAdapter()`（单例供 `install.mjs` 使用）。`platform = 'claude-code'`；继承 `loadPlatformYaml`/`supports`/`tier`（platform.yaml 声明 9 点全 true → `tier()` 返回 1）。
  - `conform(cap): ConformResult` — §A.2 语义层：frontmatter 合法（R1 不重复）、`name`==pack.id 后缀（R4 不重复）、`entrypoint` 文件存在、`tools`（mcp）在平台支持集内、§22.5 `requires:hard` 每点 `supports(point).supported===true`。
  - `translate(cap, opts): PlatformArtifact[]` — §6.1+§7.2：agent→`~/.claude/agents/<name>.md`（frontmatter + source.md body 合并）；skill→`~/.claude/skills/<name>/SKILL.md`；mcp→`mcp-config-merge` artifact（无文件，`mcpConfig` 条目）；workflow→`workflow-command` artifact（body 由 `workflow-compile.mjs` 产出，见 §2.19）。P1 无降级矩阵（全点支持，fallback 不触发）。`translate` 返回的 `targetPath` 保留字面 `~`，由 `install()` 层 `expandTilde()` 展开（§9 的 PlatformArtifact 约定）。
  - `install(artifacts, opts): Manifest` — §8 原子幂等写 `~/.claude/`，`~` 经 `resolveHome()` 展开（Windows USERPROFILE 优先），内容 hash 比较后写（§5.6 幂等）。
  - `injectMcp(mcp, opts)` — §9.2 幂等合并 `~/.claude.json` 的 `mcpServers`；env 白名单取自 `mcp.config_template.auth_schema`（§B.2）；manifest 记 `mcp_keys[]` 供 `uninstall` 反向。
  - `uninstall(capId, opts)` — 按 manifest 反向：删除匹配 id 的条目 + manifest 记录的孤立 `mcpServers` 键。
  - `detect(): boolean` — §8.4 检查 `~/.claude/` 存在且可写。
- **`platform.yaml`**：见 §9 数据形状。9 点全 `supported: true`，`locale: en-US`，`compliance_tags: []`，`verified_by: steering`。
- **`mcp-config.template.json`**：`~/.claude.json` `mcpServers` 合并骨架。
- **§追溯**：§6.2、§A.2、§22.5、§8.4、§9.2、§B.2。

## 2.17 `install.mjs` + `install.sh`（NEW，§8/§20.4 P1）

- **用途**：仓库根跨平台安装器。`install.sh`（POSIX sh，唯一 `.sh` 例外，Git Bash 兼容）是 bootstrap——探测 Node 后 `node install.mjs "$@"`。`install.mjs`（Node ESM）承担全部逻辑。
- **`install.mjs` 导出**：
  - `install(args): Promise<{installed: string[], manifest: Manifest}>` — 解析 registry → 从 `packs/<slug>/` 或 `customers/<brand>/` 读能力源 → `adapter.translate()` → 幂等 `install()` → `injectMcp()` → 写按项目 manifest。§20.4 P1 单层传递依赖：安装 workflow 时拉取 `steps[].capability` 并一并安装（registry `current`）。`source_commit` 取 `git rev-parse --short HEAD`（fallback `'unknown'`）。
  - `uninstall(args): Promise<{uninstalled: string[]}>` — 按 manifest 反向。
  - `list(args): Promise<{list: Array<{id,version,installed_at}>}>`。
  - `doctor(args): Promise<{healthy: boolean, issues: Array<{severity,check,detail,fix?}>}>` — §8.3：manifest↔文件一致性、`depends_on` 满足、MCP 配置完整、平台路径可写、版本不落后；缺失依赖记为 `deps_missing[]` 并以 `medium` issue 暴露；`expandTilde()` 规范化 manifest artifact 路径后再 `existsSync`（防 doctor 误报）。P1 不含 effectiveness 扫描（Phase 3.2）。
  - `main()` — CLI：`node install.mjs --install <id>[@version] --platform <p> [--brand <b>] [--project <p>] | --uninstall <id> | --list | --doctor`。`--install` 与 `--uninstall` 均剥 `@version` 后缀（CLI-1/CLI-2 测试覆盖）。
- **`Manifest` 形状**：见 §9（按项目 `~/.opsforge/manifests/<project-slug>.manifest.json`，字段 `manifest_version`/`project`/`platform`/`brand?`/`installer_version`/`capabilities[]{id,version,source_commit,customer?,security_policy,owner_profile,installed_at,mcp_keys,deps_missing?,effectiveness_flag?,artifacts}`）。
- **副作用/抛错**：读 fs（registry/源）、写 fs（平台目录 via adapter + manifest via `atomicWrite`）；`install` 在 registry miss / 适配器缺失 / `requires:hard` fail-loud / 路径穿越（`assertSlugSegment` 失败）时抛错；`uninstall`/`list`/`doctor` 返回结果而非抛。
- **幂等（§5.6）**：`install`/`injectMcp` 经内容 hash 比较跳过重复写；manifest 按 `id` 去重（同 id 后装替换前装）。
- **§追溯**：§8、§20.4 P1、§5.4（路径守卫 call-site）、§5.6（幂等）、§8.3（doctor）、§8.4（Windows `~`）。

## 2.18 `tools/test-runner.mjs`（NEW，§21.3/§21.5）

- **用途**：v8 行为评估的执行层——把声明式 `tests/*.yaml` 跑成 `Verdict`，产 `regression_cases` 段并入 `validation-report.json`。
- **导出**：
  - `runCase(capDir, caseYaml, opts): Promise<Verdict>` — 异步（subprocess/HTTP）。`opts.runner` ∈ `claude`（默认）/`static-only`/`<platform>`；`opts.platform`/`opsforgeHome`/`evalId`。
  - `runSuite(capDir, opts): Promise<{cases: Verdict[], summary: SuiteSummary}>`。
  - `main()` — CLI：`node tools/test-runner.mjs <capDir> | --all`。
- **P1 expect-mode 分派表**（未实现模式 stub，不抛）：
  | mode | P1 行为 | runner |
  |---|---|---|
  | `exact` | 字符串相等；两端可 JSON parse 时结构深等 | local |
  | `contains` | `expected`（string 或 string[]）所有子串命中 `actual` | local |
  | `human` | 标 `pass: "pending"`，不执行 | local |
  | `schema`/`regex`/`llm_judge`/`golden` | stub `{pass:false, reason:'unsupported-in-phase1'}` | — |
- **dry-run harness（§21.5）**：`runner:'claude'`（默认）对 skill/agent spawn `claude -p`（system prompt = frontmatter + body，user = `JSON.stringify(input)`），stdout 作 `actual`；mcp 起本地 stdio server 调首个 tool；workflow P1 stub `{pass:"pending", runner:"static-only"}`（真 `--run-workflow --dry-run` 在 Phase 2.4）。`runner:'static-only'`（`OPSFORGE_RUNNER=static-only` 或 PATH 无 `claude`）：跳过执行，每 case 返回 `{pass:"pending", runner:"static-only"}`，写入 `validation-report.json` 的 `regression_cases.runner`/`runner_limited`，`validate.mjs` 把 `pending` 视为非失败（故 CI 无模型时 greenfield seeding 仍 exit 0）。
- **副作用**：subprocess（`claude -p`）、读 fs（cap dir）；**仅在 `~/.opsforge/runs/<eval-id>/` 下写**（`state.json`/`artifacts/<step>/<out>.json`/`run.log`/`params.snapshot.yaml`），绝不触碰 `~/.claude/`，绝不安装，绝不改 manifest。P1 无网络。
- **抛错**：`runCase`/`runSuite` 测试失败时不抛（返回 `Verdict`/`SuiteSummary`）；仅不可恢复的基础设施错误（cap dir 缺、run dir 建不出）抛错。
- **集成（§21.3/§A.4）**：`validate.mjs` staged 分支调 `runSuite`，将 `SuiteSummary` 合入 `validation-report.json`（§9）；`failed>0` → `verdict:fail`。
- **§追溯**：§21.3、§21.5、§5.3（static-only 检测）。

## 2.19 `tools/workflow-compile.mjs`（NEW，§7.2/§20.4 P1）

- **用途**：把线性 workflow 编译为 claude-code slash-command artifact。
- **导出**：`compile(workflowYaml, platform): PlatformArtifact`（`kind='workflow-command'`，`targetPath='~/.claude/commands/workflow-<name>.md'`，`content` 为编译后 markdown body）；`main()` — CLI 打印解析后绝对路径。
- **P1 行为（§20.4 P1 线性）**：
  1. 若 `control_flow` 存在：遍历节点。**仅 `type:'sequence'` 合法**——`loop`/`switch`/`checkpoint` 在 schema 层经 `not` 拒绝（§10 `workflow.schema.json`），且 `compile` 抛 `Error: workflow-compile: control_flow node type "<type>" not supported in Phase 1`。
  2. 若 `control_flow` 缺省：按 `steps[]` 声明顺序派生线性序（§7.1 向后兼容）。
  3. 编译 body：markdown slash-command，指示平台 agent 依次调用 `step.capability`、输出持久化到 `~/.opsforge/runs/<workflow-id>/<run-id>/artifacts/<step-id>/<out>.json`、写每 run `state.json`。`kb_mount` 识别但 P1 不注入（编译 body 内以注释打印）。
  4. 无 `loop`/`switch`/`checkpoint`/`resume` 语义（Phase 2.4/3.1）。
- **副作用**：纯函数（无写；仅 `resolveOpsforgeHome` 用于路径构造）。
- **抛错**：`compile` 在不支持的控制流节点或不可解析 step 引用时抛错。
- **§追溯**：§7.2、§20.4 P1。

## 2.20 `tools/release.mjs`（NEW，§13.2/§B.4）

- **用途**：聚合 registry 单一事实源；staged→released 闸门（验证+安全报告必须 `pass`）。
- **导出**：
  - `release(capDir, opts): {registered: boolean, id, version, reason?}` — 读 capability.yaml 的 `version`（P1 作者拥有版本，release 登记该版本；不自动 bump）。闸门：`validation-report.json` verdict=pass AND `security-report.json` verdict=pass（或 block-with-exceptions）。P1 **不**要求 `eval-report`（Phase 2.2 加为第 3 份）。
  - `aggregateAll(opts): {registry, registryBrands}` — 扫描 `packs/<contributor>/` 与 `customers/<brand>/packs/<brand>/`，对每个 cap 调 `release()`（使 §B.4 闸门在 `--all` CI 路径上 fire），原子写 `registry.yaml` + `registry-brands.yaml`。
  - `main()` — CLI：`node tools/release.mjs <capDir> | --all`。
- **副作用**：读 fs（扫描 packs/customers + 读两份报告）；写 fs（`registry*.yaml`，`atomicWrite` 临时文件+rename）。报告从 `<capDir>/validation-report.json`/`security-report.json` 读（producer `validate.mjs`/`security-scan.mjs` `main()` 经 `atomicWriteSync` 写入 capDir）。
- **抛错**：`release` 在闸门失败时返回 `{registered:false, reason}`（不抛）；`aggregateAll` 仅在 fs 错误时抛；二者对闸门失败永不抛。
- **§追溯**：§13.2、§B.4、§C.6（版本策略——P1 作者拥有版本）。

## 2.21 `tools/security-scan.mjs`（NEW，§B.1，P1 minimal）

- **用途**：§B 安全闸门的 P1 最小子集——3 个不可豁免家族。
- **导出**：`scan(capDir): SecurityReport`；`main()` — CLI `node tools/security-scan.mjs <capDir> | --all`，写 `security-report.json` 进 capDir（`atomicWriteSync`）。
- **P1 三个不可豁免家族**（§B.3：prompt-injection / supply-chain / private-SSRF 不可豁免——supply-chain 在 Phase 3.3，其余 2 在 P1）：
  1. hardcoded secrets：`AKIA*`、`ghp_*`、`sk-`、`-----BEGIN ... PRIVATE KEY-----`、连接串。
  2. prompt injection：`忽略以上指令`/`以管理员身份`/`删除所有`/`覆盖系统提示`/`ignore previous instructions`。
  3. private-network SSRF：`169.254.169.254`、`127.0.0.0/8`、`10/8`、`192.168/16`、`*.internal`。
  全 §B（over-privileged tools、supply-chain、MCP tool-surface、dep advisories、data-residency-cn）deferred 至 Phase 3.3。
- **`id` 形状**：取自解析后的 `capability.yaml` `id`（`<pack>.<name>`），仅 parse 失败时 fallback 到 basename。
- **副作用**：仅读 fs；无写（caller 写 `security-report.json`）；无 subprocess/网络。
- **抛错**：`scan` 返回 `SecurityReport`（发现物时 `verdict:'block'`，不抛）；仅 fs 错误（capDir 缺）抛。
- **§追溯**：§B.1、§B.3。

## 2.22 `tools/opsforge.mjs`（NEW，§22.8，P1 minimal）

- **用途**：v9 非技术用户 UX 向导，包装裸 CLI。复用 `node:readline`（无新依赖）。
- **导出**：`main(argv): Promise<number>`（exit code）；`promptNew(rl): Promise<{kind,slug,name,brand?}>`；`promptInstall(rl, opts): Promise<{capId,platform,project?}>`。
- **P1 命令**：`opsforge new`（交互式 scaffold → 调 `new-capability.mjs`）、`opsforge install`（单能力交互式安装）、`opsforge status [path]`（渲染 `.opsforge-state.json` → 红绿灯进度 draft→staged→released→registry）、`opsforge doctor`（基础交互式）。`wizard`/`report`/`discover`/`feedback` 在 Phase 2/3；P1 `report` 由 `report-renderer.render()` 从 `status`/`doctor` 内联调用（渲染 validation-report）。
- **副作用**：subprocess 或直接 in-process 函数 import（`new-capability.mjs`/`install.mjs`）；读 fs（`.opsforge-state.json`）；自身不直接写（委派）。
- **抛错**：`main` 返回 exit code，永不抛（catch + 打印）；内部 helper 仅 readline 错误时抛。
- **§追溯**：§22.8。

## 2.23 `tools/report-renderer.mjs` + `tools/report-templates/`（NEW，§22.9，P1 minimal）

- **用途**：把 JSON 报告渲染成中文白话红绿灯 + 修复指引。
- **导出**：`render(reportJson, type, opts): RenderedReport`（`{text, light:'green'|'yellow'|'red', oneLiner}`）。`type` ∈ `validation-report|security-report|eval-report|manifest`；P1 仅 `validation-report` 实现，其余抛错。`opts.lang` P1 仅 `zh`（`--lang en` 在 Phase 4，D6 默认 zh）。
- **渲染规则（§22.9）**：红绿灯（绿 pass / 黄 warning·pending / 红 fail·block）、一句结论、每条红/黄项白话修复指引、内部规则 ID（R16 等）折叠进"详细技术信息"段（默认收起）。模板取自 `tools/report-templates/<type>.<lang>.md`（P1 已 ship `validation-report.zh.md`）。
- **副作用**：读 fs（模板文件）；无写；无 subprocess/网络；否则纯函数。
- **抛错**：不支持的 `type`/`lang` 组合或缺模板时抛；成功返回 `RenderedReport`。
- **§追溯**：§22.9、§22.6 D6（默认 zh）。

## 2.24 `tools/paths.mjs`（NEW，§5.1 跨切面决策落地）

- **用途**：全仓共享的路径/写文件/路径守卫 helper，单一事实源，steering 拥有，path-guarded。
- **导出**：
  - `resolveHome(): string` — `~` 在 Windows 优先 `USERPROFILE`，否则 `os.homedir()`；尊重 `OPSFORGE_HOME` env。
  - `resolveOpsforgeHome(): string` — `~/.opsforge`。
  - `atomicWrite(absDest, content)` — 写 `<dest>.tmp.<pid>` + `fsync` + `rename`（同卷原子）；幂等短路：现有内容 hash 等则跳过。
  - `atomicWriteSync(absDest, content)` — 同步变体（供 `validate.mjs`/`security-scan.mjs` `main()` 写报告用）。
  - `readJsonOrNull(p)` / `readJsonOrNullSync(p)`。
  - `assertSlugSegment(seg, label)` — 校验 `^[a-z][a-z0-9-]{2,30}$`（同时拒 `..`/`/`/前导`.`）；`assertCapId(capId)` 校验 `<pack>.<name>` 两段。
- **call-site**（非穷举）：`install.mjs`（每个 `capId`/`steps[].capability` 段/`<brand>`）、`release.mjs`（`changelog_index` 路径每段）、`workflow-compile.mjs`（`step.capability` 段）、`adapter.install`/`translate`（`<name>` 用于 `targetPath`）。
- **§追溯**：§5.1（`~` 展开 + 原子写）、§5.4（路径守卫）、§5.6（幂等，所有最终输出经 `atomicWrite`，禁 `fs.writeFileSync`）。

## 3.7 `templates/*/tests/case-0[1-3].yaml`（extend §3，3→7 字段）

文件名不变（→ R8 `skeleton_guard` 比对文件集而非内容，不受影响，PROGRESS.md Phase 0 lesson 4 已确认）。工程字段预填，业务字段留 `__FILL_ME__`：

```yaml
name: __FILL_ME__          # 业务作者填，kebab-case
input: __FILL_ME__         # 业务作者填，任意类型
expect: exact              # 工程预填
expected: __FILL_ME__      # 业务作者填（expect ∈ {exact,contains,regex} 时必填）
schema_ref: null            # 工程预填
judge_rubric: null          # 工程预填（llm_judge 在 Phase 2.2 才需）
judge_threshold: 0.7       # 工程预填
weight: 1.0                # 工程预填
```

6 个模板（`agent`/`skill`/`mcp`/`workflow`/`bundle`/`brand-draft`）的 `tests/case-0[1-3].yaml` 均升级为该 7 字段形式。schema 见 §10 `test-case.schema.json`。

## 5.1 R16–R22 + R_wf_ref + R_wf_closed（extend §5 规则矩阵）

均为 **staged-only**（draft 豁免，保 §21.8"draft 自由 vibe、不评估"）。每条 check 返回 `{name,status,detail}`。

| 规则 id | 检查名 | 通过条件 | 失败消息（精确） | §追溯 |
|---|---|---|---|---|
| R16 | `body_min_substance` | body token 数 ≥ N(kind)：agent≥150/skill≥100/mcp≥80（中文字符或等价英文 token） | `body_min_substance: <kind> body has <n> tokens, need >= <N>` | §21.7/Q6 |
| R17 | `body_not_boilerplate` | 不匹配纯 echo / 纯占位填充 / description-body ≥80% 重叠 任一模式 | `body_not_boilerplate: body is boilerplate (<pattern>)` | §21.7 |
| R18 | `test_expect_nontrivial` | 每 `expected` len>3、不在黑名单 `{"ok","true","pass","success","yes","done","ok."}`；`llm_judge` 须 `judge_rubric` ≥20 字符 | `test_expect_nontrivial: <case> expected is trivial (<v>)` | §21.7 |
| R19 | `test_cases_distinct` | 无两 case 的 `(input,expect,expected)` 全同 | `test_cases_distinct: cases <a> and <b> are identical` | §21.7 |
| R20 | `description_body_alignment` | description 抽取的 ≥1 名词出现在 body（中 2+ 连续字 / 英 ≥4 字母词） | `description_body_alignment: no description noun appears in body` | §21.7 |
| R21 | `test_expect_declared` | staged 每 case 显式声明 `expect` | `test_expect_declared: <case> missing expect` | §21.7 |
| R22 | `no_self_cheat_in_body` | body 不含"直接返回 expected"/"pass the test by returning 'ok'"/"输出测试用例的 expected 字段" 模式 | `no_self_cheat_in_body: body contains self-cheat pattern (<pattern>)` | §21.7 |
| R_wf_ref | `workflow_ref` | workflow `steps[].capability` 在仓内可解析；`outputs` 名与 `vars` 声明对齐（非 workflow kind no-op） | `workflow_ref: step <id> capability "<cap>" unresolvable` | §20.1 |
| R_wf_closed | `workflow_closed` | `control_flow` 仅引用已存在 step-id；P1 仅 `sequence` 节点（非 workflow kind no-op） | `workflow_closed: control_flow node <type> not supported in Phase 1` | §20.1 |

> `validateDir` staged 分支把 R16–R22 + R_wf_ref + R_wf_closed + `checkOpsforgeState`（§5.2）+ `platform_conformance`（§5.3）追加到 `checks[]`；draft 分支不变。

## 5.2 `.opsforge-state.json` skeleton-guard 排除 + `checkOpsforgeState`

- **排除机制**：`tools/validate.mjs` 模块级常量 `SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json']`。在 `checkSkeletonGuard`（R8）与 `checkEntryGuard`（R15）中，`actual = actual.filter(f => !SKELETON_GUARD_EXCLUSIONS.includes(f))` 后再 diff。
- **不把 `.opsforge-state.json` 加进任何 `templates/`** —— 它是 `new-capability.mjs` scaffold/promote 写入的运行时 overlay，非骨架文件。排除列表是"steering overlay 文件（业务作者未造且不可改）"的唯一事实源；未来增项（如 `.opsforge-feedback.jsonl`）进此列表，不进 templates。
- **`checkOpsforgeState(cap): Check`**：若 `.opsforge-state.json` 存在，校验 steering 字段（`state` ∈ `draft|staged|released`、与目录 `_drafts/`/`_staged/` 位置一致；`history[].ts/from/to` 未被作者篡改）。独立于 R8/R9。
- **R9 交互**：staged `version` 不在 untampered 集（作者拥有版本，release 读取；R5 仍锁 draft 为 0.1.0）——见 PROGRESS.md "Accepted deviations (Phase 1)" 第 1 条 implementer deviation。
- **§追溯**：§5.5（机制）、§22.10（state overlay）。

## 5.3 `platform_conformance` check（§22.5 / §A.2）

- `validateDir` staged 分支额外对 `cap.platforms` 中每个平台 import 平台适配器并调 `adapter.conform(cap)`。若 `ConformResult.ok===false`，每错误 push 一条 `{name:'platform_conformance', status:'fail', detail:'platform_conformance: <platform>: <error>'}`。
- **`requires:hard` 检查在 `conform`**（§22.5）：能力的 `requires[]` 中 `severity:'hard'` 的每点须 `supports(point).supported===true`，否则 fail-loud。
- P1 仅 `claude-code` 适配器存在；其他 3 个枚举值（cursor/codex/cline）`conform` 为 no-op stub 返回 `{ok:true}`（deferred 至 Phase 2.1）。
- **§追溯**：§22.5、§A.2。

## 9. Phase 1 数据形状（新顶层节；§3.1–§3.7 之 Phase 1 增量，确切 JSON）

> 编号说明：原 §8 为"偏差/开放决策"，故本节取 §9；与 `ARCHITECTURE-DELTA.md` §6.1 的"`## 8 Data shapes`"对应，仅编号顺移以避让既有 §8。

### 9.1 `PlatformArtifact`（`translate()` 返回、`install()` 消费）

```json
{
  "kind": "agent-file",                          // "agent-file"|"skill-file"|"mcp-config-merge"|"workflow-command"
  "targetPath": "~/.claude/agents/copywriter.md", // 绝对、POSIX 风格；字面 ~ 由 install() 层 expandTilde() 展开，非 translate()
  "content": "---\nid: marketing-team.copywriter\n...\n---\n<body>",
  "mcpConfig": null,                             // kind="mcp-config-merge" 时：{ "servers": { "<name>": { ... } } }
  "degradation": null,                           // P1 null（claude-code Tier 1）；Phase 2 设 "http-inject"|"manual-paste"|"http-direct"|"cli-engine"
  "pasteInstructions": null                      // manual-paste 用（Phase 2）
}
```

### 9.2 按项目 manifest（`~/.opsforge/manifests/<project-slug>.manifest.json`）

```json
{
  "manifest_version": "1",
  "project": "default",
  "platform": "claude-code",
  "brand": null,
  "installer_version": "0.1.0",
  "capabilities": [
    { "id": "marketing-team.copywriter", "version": "1.0.0",
      "source_commit": "a1b2c3d", "customer": null,
      "security_policy": { "env_whitelist": [], "network_egress": [], "tool_downgrade": null },
      "owner_profile": "default", "installed_at": "2026-07-23T10:00:00Z",
      "mcp_keys": [], "effectiveness_flag": null,            // "degraded" 在 Phase 3.2 设；P1 null
      "deps_missing": [],                                     // 传递依赖缺失记录（P1 新增）
      "artifacts": ["~/.claude/agents/copywriter.md"] }
  ]
}
```

### 9.3 `validation-report.json`（Phase 1 shape，§A.4 + §21.3 `regression_cases`）

```json
{
  "id": "marketing-team.copywriter",
  "origin": "original",
  "checks": {
    "schema": "pass", "yaml_parse": "pass", "id_unique": "pass", "naming": "pass",
    "version_semver": "pass", "placeholder_clean": "pass", "skeleton_guard": "pass",
    "engineering_fields_untampered": "pass", "display_names_i18n": "pass",
    "customer_dir_consistency": "pass", "depends_on_resolvable": "pass",
    "depends_on_direction": "pass", "tests_min": "pass",
    "body_min_substance": "pass", "body_not_boilerplate": "pass",
    "test_expect_nontrivial": "pass", "test_cases_distinct": "pass",
    "description_body_alignment": "pass", "test_expect_declared": "pass",
    "no_self_cheat_in_body": "pass",
    "workflow_ref": "n/a", "workflow_closed": "n/a",         // 非 workflow kind 为 "n/a"
    "opsforge_state": "pass",
    "platform_conformance": { "claude-code": "pass" }
  },
  "regression_cases": {
    "total": 3, "passed": 3, "failed": 0, "pending_human": 0,
    "modes": { "exact": { "total": 2, "passed": 2 }, "contains": { "total": 1, "passed": 1 }, "human": { "total": 0, "pending": 0 } },
    "failures": []
  },
  "verdict": "pass"
}
```

### 9.4 `security-report.json`（P1 minimal shape，§B.3）

```json
{
  "id": "marketing-team.copywriter",
  "origin": "original",
  "findings": [
    { "rule": "hardcoded_secret", "severity": "high", "evidence": "source.md:12: sk-...", "status": "block" }
  ],
  "verdict": "block",
  "exceptions": []
}
```

### 9.5 `registry.yaml` + `registry-brands.yaml` 条目（§13.2）

`registry.yaml`（auto-generated，禁手改）：
```yaml
capabilities:
  marketing-team.copywriter:
    current: 1.0.0
    history:
      - { version: 1.0.0, released_at: "2026-07-23", commit: "a1b2c3d" }
    changelog_index: packs/marketing-team/agents/copywriter/CHANGELOG.md
```
`registry-brands.yaml`（P1 空——品牌示例在 Phase 3.4）：
```yaml
brands: {}
```

### 9.6 `.opsforge-state.json`（`new-capability.mjs` 写入 cap 目录）

```json
{
  "state": "draft",                              // "draft"|"staged"|"released"
  "history": [ { "ts": "2026-07-23T10:00:00Z", "from": null, "to": "draft", "pr": "#12" } ]
}
```

### 9.7 `adapters/<platform>/platform.yaml`（§22.2，9 capability_points keyed）

```yaml
platform: claude-code
display_name: Claude Code
display_name_zh: Claude Code
capability_points:
  prompt_exec:           { supported: true, mode: cli }   # claude -p
  agent_file:            { supported: true }
  skill_file:            { supported: true }
  slash_command:        { supported: true }
  mcp_config:           { supported: true }
  workflow_orchestration:{ supported: true }
  config_dir_writable:  { supported: true }
  kb_mount:             { supported: true }                # 预留；注入在 Phase 2.4
  feedback_hook:        { supported: true }                # 预留；MCP 在 Phase 3.2
locale: en-US
compliance_tags: []
verified_by: steering
```

P1 仅 ship `adapters/claude-code/platform.yaml`；cursor/codex/cline 的 `platform.yaml` 在 Phase 2.1。

## 10. Phase 1 新增 schema（新顶层节；均 `additionalProperties: false`）

### 10.1 `schema/test-case.schema.json`（NEW，§21.2）
- 顶层 properties：`name`（`^[a-z][a-z0-9-]{2,30}$`）、`input`（any，required）、`expect`（enum `exact|schema|contains|regex|llm_judge|golden|human`，required）、`expected`（any，optional——`expect`∈{exact,contains,regex} 时必填）、`schema_ref`（string|null，default null）、`judge_rubric`（string|null，default null）、`judge_threshold`（number，default 0.7，0–1）、`weight`（number，default 1.0，>0）、`platforms`（array|null，default null）、`timeout_ms`（integer，default 30000）。
- `required: ["name","input","expect"]`；`additionalProperties: false`。
- 条件约束（运行时 R18 执行而非 schema）：`expect:llm_judge` 时 `judge_rubric` 须 ≥20 字符（schema 保持 permissive 允许 null default）。

### 10.2 `schema/platform.schema.json`（NEW，§22.2）
- 顶层 properties：`platform`（`^[a-z][a-z0-9-]{2,30}$`，required）、`display_name`/`display_name_zh`（string，required）、`capability_points`（object，keyed by 恰 9 点 id；每值为对象含 `supported: boolean` required，可选 `mode`/`endpoint_env`/`auth_env`/`fallback`/`meta`；required）、`locale`（required）、`compliance_tags`（array of strings，required）、`verified_by?`/`model_registration?`。
- `required: ["platform","display_name","display_name_zh","capability_points","locale","compliance_tags"]`；`additionalProperties: false`。`capability_points` 值对象亦 `additionalProperties: false`。

### 10.3 `schema/workflow.schema.json`（NEW，§7.1/§20.1 P1）
- 顶层 properties：`id`/`version`/`kind`（const workflow）/`pack`/`owner`/`customer?`/`display_name*`/`description`/`platforms`/`params_schema`（const `params.schema.json`）/`steps`（array，每项 `id`/`capability`/`inputs`/`outputs`，required）/`control_flow?`（optional，array；P1 用 `not` 禁 `loop`/`switch`/`checkpoint`，仅 `sequence`）/`vars?`/`kb_mount?`（bool，default false）/`tests`/`changelog`/`source`/`outputs`（default `{}`）。
- `required: ["id","version","kind","pack","owner","display_name","display_name_zh","display_name_en","description","platforms","params_schema","steps","tests","changelog","source"]`；`additionalProperties: false`。

### 10.4 `schema/bundle.schema.json`（NEW，§3.5）
- 顶层 properties：`id`/`version`/`kind`（const bundle）/`pack`/`owner`/`customer?`/`display_name*`/`description`/`platforms`/`capabilities`（array of `<pack>.<name>@<range>`，required）/`workflows`/`tests`/`changelog`/`source`。
- `required: ["id","version","kind","pack","owner","display_name","display_name_zh","display_name_en","description","platforms","capabilities","tests","changelog","source"]`；`additionalProperties: false`。

### 10.5 `schema/pack.schema.json`、`schema/brand.schema.json`、`schema/upstream-ref.schema.json`（NEW，§17 minimal，P1 仅契约）
- `pack.schema.json`：`pack`/`display_name`/`display_name_zh`/`display_name_en`/`owner`/`created_at`。`additionalProperties: false`。全 5 required。
- `brand.schema.json`：`brand_slug`/`display_name`/`display_name_zh`/`created_at`/`contact`/`notes`。`additionalProperties: false`。前 5 required。
- `upstream-ref.schema.json`：`repo`/`commit`/`license`/`intaked_at`/`intaked_by`。`additionalProperties: false`。全 5 required。
- 三者在 1.1 ship 以便 `validate.mjs` 可引用；完整 intake/brand 流程在 Phase 3.4。P1 仅实现 schema 文件 + ajv wiring。

### 10.6 `schema/capability.schema.json` — EXTEND（§22.5）
- 新增可选顶层 `requires` 字段：
  ```json
  "requires": {
    "type": "array",
    "items": {
      "type": "object", "additionalProperties": false,
      "required": ["point", "severity"],
      "properties": {
        "point": { "type": "string", "enum": ["prompt_exec","agent_file","skill_file","slash_command","mcp_config","workflow_orchestration","config_dir_writable","kb_mount","feedback_hook"] },
        "severity": { "type": "string", "enum": ["hard", "soft"] },
        "fallback": { "type": "string", "enum": ["cli-engine", "http-inject", "manual-paste", "http-direct", "fail-loud"] }
      }
    }
  }
  ```
- P1 **不**扩展 `platforms` 枚举（仍 `claude-code|cursor|codex|cline`）；国产平台枚举扩展在 Phase 2.5+。
- `additionalProperties: false` 保留（`requires` 显式声明，不破坏闭世界）。

## 相关文件路径（Phase 1 增量，均为绝对路径）

- 规范增量源：`D:\XD\ClaudeCode\sy-eeo\ARCHITECTURE-DELTA.md`、`D:\XD\ClaudeCode\sy-eeo\IMPLEMENTATION-PLAN.md`、`D:\XD\ClaudeCode\sy-eeo\docs\archive\fix-spec-phase1.md`
- Phase 1 已实施文件（均以 `D:\XD\ClaudeCode\sy-eeo\` 为根）：
  - schema：`schema/{test-case,platform,workflow,bundle,pack,brand,upstream-ref}.schema.json`（new）、`schema/capability.schema.json`（extend `requires`）
  - 适配器：`adapters/base.mjs`、`adapters/claude-code/{adapter.mjs,platform.yaml,mcp-config.template.json,adapter.test.mjs}`
  - 工具：`tools/validate.mjs`（extend）、`tools/new-capability.mjs`（extend，写 `.opsforge-state.json`）、`tools/test-runner.mjs`、`tools/workflow-compile.mjs`、`tools/release.mjs`、`tools/security-scan.mjs`、`tools/opsforge.mjs`、`tools/report-renderer.mjs`、`tools/paths.mjs`、`tools/report-templates/validation-report.zh.md`
  - 测试：`tools/{validate,new-capability,test-runner,workflow-compile,release,security-scan,opsforge,report-renderer,schema-contracts}.test.mjs`、`install.test.mjs`、`install.cli.test.mjs`
  - 安装器：`install.mjs`、`install.sh`（仓库根）
  - CI：`ci/github-actions/{validate,test,release}.yml`（new）、`ci/guardrails.yml`（extend path-guard 列表）
  - dogfood：`packs/marketing-team/{pack.yaml,agents/copywriter/,skills/activity-summary/,mcps/bi-connector/,workflows/campaign-retrospect/}`
  - 状态/报告产物：`<cap-dir>/.opsforge-state.json`、`<cap-dir>/validation-report.json`、`<cap-dir>/security-report.json`、`registry.yaml`、`registry-brands.yaml`（后两者 auto-generated）
