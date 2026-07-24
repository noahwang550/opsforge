# OpsForge 能力编写指南（无开发背景也能上手）

> 填空式指南。跟着做，不需要写一行代码。

## 一、起骨架

打开终端（Claude Code / Cursor 终端），在仓库根目录运行：

```bash
node tools/new-capability.mjs --kind skill --slug myteam --name greeting
```

> 非技术用户也可以用向导式入口（v9 §22.8），效果一样，会调上面这个命令：
> `node tools/opsforge.mjs new`

会生成 `packs/_drafts/myteam/greeting/`，里面是这些文件：

- `SKILL.md`（skill 的正文 + frontmatter）
- `tests/case-01.yaml`、`case-02.yaml`、`case-03.yaml`（回归用例）
- `CHANGELOG.md`、`README.md`

> agent / mcp / workflow / bundle 文件集略有不同，脚手架自动生成对的。

## 二、填 `__FILL_ME__`

打开 `SKILL.md`，你会看到形如：

```yaml
---
id: myteam.greeting
version: 0.1.0
kind: skill
pack: myteam
owner: myteam
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
...
---
__FILL_ME__
```

把每一个 `__FILL_ME__` 替换成你的真实内容。例如：

- `display_name_zh: 欢迎语`
- `display_name_en: Greeting`
- `description: 根据会员等级生成欢迎话术`
- 正文 `__FILL_ME__`：写这个 skill 要做什么、怎么判断、输出什么。

> 注意：`id` / `version` / `kind` / `pack` / `owner` / `entrypoint` / `tests` / `changelog` / `source` 这些工程字段**不要改**，脚手架已经填好，改了会报 `engineering_fields_untampered` 错误。

## 三、写回归用例

打开 `tests/case-01.yaml`。脚手架已经预填好**工程字段**（`expect` / `schema_ref` / `judge_rubric` / `judge_threshold` / `weight`），你只需要填**业务字段** `name` / `input` / `expected`：

```yaml
name: __FILL_ME__        # 业务字段：用例名
input: __FILL_ME__       # 业务字段：输入
expect: exact            # 工程字段：期望模式，勿改。支持 exact/contains/human/schema/regex/llm_judge/golden（Phase 2.2 起全部 7 模式可用；业务作者默认填 exact）
expected: __FILL_ME__    # 业务字段：期望输出
schema_ref: null         # 工程字段：schema 模式引用，勿改
judge_rubric: null       # 工程字段：llm_judge 评分准则，勿改
judge_threshold: 0.7     # 工程字段：通过阈值，勿改
weight: 1.0              # 工程字段：用例权重，勿改
```

填成，例如（`exact` 模式做字符串相等比较）：

```yaml
name: 普通会员
input: { level: normal }
expect: exact
expected: 欢迎来到 OpsForge！
schema_ref: null
judge_rubric: null
judge_threshold: 0.7
weight: 1.0
```

至少写 3 条（`case-01/02/03`）。staged 要求 ≥3 条，少了报 `tests_min`。

> **v8 行为门禁会检查用例（staged 阶段，PLAN §21.7）：**
> - `test_expect_declared`（R21）：每条用例必须显式声明 `expect`（脚手架已填，别删）。
> - `test_expect_nontrivial`（R18）：`expected` 长度 >3，且不得是 `"ok"` / `"true"` / `"pass"` / `"success"` 等空话；`llm_judge` 模式要求 `judge_rubric` ≥20 字符。
> - `test_cases_distinct`（R19）：任意两条用例的 `(input, expect, expected)` 组合不能完全相同。
>
> Phase 2.2 起 `tools/test-runner.mjs` 全部 7 个 expect 模式可用（exact/contains/human/schema/regex/llm_judge/golden）。`tools/eval.mjs` 的 5 轴评分（accuracy/completeness/actionability/safety/robustness）会写 `eval-report.json`，作为 §B.4 release 门的第 3 份报告（与 validation-report + security-report 一起，Phase 2.2 起）。CI 也会跑 `node tools/eval.mjs --all`，退出码 0 才放行。

## 四、跑校验

```bash
node tools/validate.mjs packs/_drafts/myteam/greeting
```

> **重要：刚起完骨架直接跑校验会 fail，这是设计如此，不是 bug。** 草稿区也执行 `placeholder_clean`（§5 R7），而脚手架预填的 `__FILL_ME__` 还没被替换，所以新鲜骨架必然在 `placeholder_clean` 上 fail。这叫**渐进式纪律**——逼你把占位符填完草稿门禁才放行。先把上一节的 `__FILL_ME__` 全部填成真实内容（包括 `tests/case-*.yaml`、`CHANGELOG.md`、`README.md` 里的占位符），再跑校验。

填完后再跑：有 fail 就按报错信息修，每个规则名都对应上面某一步。staged 阶段常见的 v8 行为门禁规则名（PLAN §21.7）：

- `body_min_substance` / `body_not_boilerplate`（R16/R17）：能力正文（`SKILL.md`/`source.md`）太短或空话套话，补实质内容。
- `test_expect_nontrivial` / `test_cases_distinct` / `test_expect_declared`（R18/R19/R21）：见上一节用例要求。
- `description_body_alignment`（R20）：描述里提到的名词没在正文出现，补关联内容。
- `no_self_cheat_in_body`（R22）：正文不得写"直接返回 expected 字段""输出 ok 就算通过"之类自欺欺人的话术。

看到 `verdict: pass` 就 OK。

## 五、提 PR 前再确认

- 没有 `__FILL_ME__` / `TODO` / `FIXME` 残留。
- 没有多建或少建文件。
- `node tools/validate.mjs <你的路径>` 退出码 0。

## 六、promote

草稿写完，进 staged：

```bash
node tools/new-capability.mjs --promote packs/_drafts/myteam/greeting
```

然后提 PR，标题 `[stage] myteam.greeting`。

## 常见问题

- **我可以加个新字段吗？** 不可以。schema `additionalProperties: false` 会拒绝。需要新字段找 steering。
- **我可以加个辅助脚本吗？** 不可以。`.mjs` / `.js` / `.sh` 是 steering 拥有的。
- **我能力依赖另一个能力？** 在 `depends_on` 写 `<pack>.<name>@<semver范围>`，如 `core.utils@^1.0.0`。方向受限：通用只能依赖通用 + 第三方；品牌只能依赖通用 + 第三方 + 同品牌。
- **版本号怎么升？** 草稿区固定 `0.1.0`。发布由 `release.mjs` 处理，你不用管。
