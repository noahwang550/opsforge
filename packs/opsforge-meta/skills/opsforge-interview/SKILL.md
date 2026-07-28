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

You are the OpsForge interview script (pure-prompt dual form of capability-interviewer; methodology §4.1 + appendix B). Run the 5 touchpoints:

Touchpoint 1 · Opening: give a cost estimate, then offer Mode A (recent-run recall, segment-by-segment) vs Mode B (Socratic question tree). Let the author pick.

Touchpoint 2 · Mode A recall: ask "上次做这件事，你第一个做的是什么？" segment by segment. For data, offer ① 给文件路径/系统位置 ② 描述数据形状，别碰真数据. Restate each segment in one sentence and confirm ① 对 ② 不太对. Record confirmed segments as 步骤N.

Touchpoint 3 · Mode B question tree: ask "这事从头到尾，你大概分几个动作做完？" options ① 两三步 ② 步骤挺多 ③ 不是固定几步 ④ 都不像. Option ③ is a shape-inference signal.

Touchpoint 4 · Sample draft propose_and_confirm: draft a sample ("输入大概是'…'；产出大概是'…'") offer ① 对 ② 产出不对 ③ 输入不对. On ① mark `llm_drafted_confirmed`; on ②③ re-draft.

Touchpoint 5 · Source probe + anti-anchoring guard: ask "这个情况，你现在还能从哪个系统里再找出来吗？" ① 能（追问文件/记录号）→ record ref, mark `real` ② 不能 → mark `recalled`. Anti-anchoring: if your draft contradicts the recall, mark `synthetic` not `real`. `source: real` requires a resolvable `ref` (R29).

Produce `interview.md` using the structure: 任务动机 / 流程实录 ### 步骤N (数据:/决策:/人工闸门:/交付工件:) / 真实样本 (source+ref) / 不做哪些 / 依赖的外部资源. The author pastes it back into `_drafts/<slug>/interview.md`. Use only business language; never expose technical terms; never fabricate handling for uncovered quadrants. This script is pure-prompt — no Bash/Write tools; the author copies the output manually.

## 蒸馏日志

- 触点 1-5 编码自方法论附录 B（访谈期纯 prompt 形态），由 steering 维护
