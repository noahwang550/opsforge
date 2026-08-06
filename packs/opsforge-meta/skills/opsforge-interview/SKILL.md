---
id: opsforge-meta.opsforge-interview
version: 1.0.0
kind: skill
pack: opsforge-meta
owner: steering
display_name: OpsForge Interview
display_name_zh: OpsForge 访谈
display_name_en: OpsForge Interview
description: pure-prompt interview script (no platform agent-file injection) that any LLM can run to produce an interview.md operation record — the Tier 2/3 dual form of capability-interviewer
platforms: [claude-code]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
---
## 能力说明

OpsForge 访谈纯 prompt 脚本，与 capability-interviewer agent 同内容，但不依赖被注入平台的 agent 文件——作者在任意 LLM 跑一遍，产出 `interview.md` 贴回 `_drafts/<slug>/` 即可。这让 Tier 2/3 平台（dify/cline 等）也能完成访谈期。核心：认知分工倒过来（LLM 先草拟、作者确认）、数据不进会话、`source: real` 须带可验证 ref、反锚定守卫。

## 适用场景

- 非 claude-code 平台作者无法 @-invoke capability-interviewer agent
- 作者想在任意 LLM 跑一遍访谈，产出 interview.md 后交给 claude-code 侧 distiller 代跑
- 需要可移植、零依赖的访谈脚本

## 运行流程

### 步骤1 开场成本预估 + 选聊法
数据: 作者选 Mode A 或 Mode B
决策: Mode A 适合最近做过；Mode B 适合不常做/数据敏感
交付工件: 聊法选择

### 步骤2 分段复述或一问一答
数据: 文件路径/数据形状描述（不贴原值）
决策: 每段复述确认
交付工件: 流程实录 ### 步骤N

## 失败降级

- 作者拿不出真实复述 → 样本标 `synthetic` 或 `llm_drafted_confirmed`，不标 `real`

## 依赖

- 无

## 运行指令

Read `templates/interview-script.md` and execute the 5 touchpoints as scripted. Do not paraphrase the touchpoints; emit the scripted prompts verbatim. For non-technical business operators, always guide in Chinese. Produce `interview.md` using the structure in `templates/interview-record.md`. The author pastes it back into `_drafts/<slug>/interview.md`. Use only business language; never expose technical terms; never fabricate handling for uncovered quadrants. This script is pure-prompt — no Bash/Write tools; the author copies the output manually.

## 蒸馏日志

- 触点 1-5 编码自方法论附录 B（访谈期纯 prompt 形态），由 steering 维护
