---
id: opsforge-meta.opsforge-wizard
version: 1.0.0
kind: skill
pack: opsforge-meta
owner: steering
display_name: OpsForge Wizard
display_name_zh: OpsForge 向导
display_name_en: OpsForge Wizard
description: interactive wizard skill that guides business authors through the 5-step capability creation and install flows with Chinese prompts and real-time quality feedback
platforms: [claude-code, codex, workbuddy]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
---
## 能力说明

OpsForge 向导 skill，承载非技术业务作者的交互式 5 步引导：新建能力（选型 → 脚手架 → 填业务字段 → 3 用例 → 质量灯反馈）、安装、发现已装、报告渲染、反馈打分；全程中文 + 绿黄红质量灯，三层工作目录兜底，绝不假设 cwd 是仓库。

## 适用场景

- 业务运营同学零代码创建能力
- 引导式安装与依赖确认
- 能力质量实时反馈与迭代
- 平台内查询已装能力与触发方式

## 运行流程

### 步骤1 路由到访谈员
数据: 作者要新建能力
决策: 默认调 @capability-wizard（统一能力创建向导，自动判断类型；非 claude-code 用 capability-wizard skill）
交付工件: _drafts/<slug>/interview.md

### 步骤2 路由到蒸馏器 + 跑通 + 迭代
数据: interview.md
决策: 交 @capability-distiller 蒸馏→scaffold→覆写→set-phase；再走结构门+跑通门→迭代 evolve
交付工件: 能力草稿 + 质量灯

## 失败降级

- 作者卡住 → 一键退回 Mode B 纯访谈 + 手填 body（作者侧逃生舱）

## 依赖

- 无（路由到 capability-interviewer / capability-distiller，不算能力依赖）

## 运行指令

When invoked for 新建能力, FIRST call `opsforge print new-flow` via Bash and emit its stdout verbatim — this surfaces the ①/② sub-menu (including ② 收录第三方能力) so the branch is never dropped. Route the sub-choice: ① → delegate to @capability-wizard (unified wizard that handles needs analysis, type determination, interview, distillation, run-through, and iteration); ② → ask for a git URL, then run `node tools/intake.mjs --fetch <url>` via Bash and emit its output. Do NOT invent cost estimates, "Mode A/B" framings, or phase narration beyond what `print` emits and the capability-wizard skill carries — those are fixed content, not yours to paraphrase.

Call `opsforge print wizard-phases` and route the author through the four phases as printed. Do not paraphrase.

Phase 1 · 访谈期: tell the author to invoke @capability-wizard (claude-code) or, on Tier 2/3 platforms, use the capability-wizard skill. The wizard produces _drafts/<slug>/interview.md and calls `opsforge set-phase <capDir> interview_done` (transparent to the author). Hand off in-session to the distiller.

Phase 2 · 蒸馏期: invoke @capability-distiller. It reads interview.md, infers kind (shape inference + rationale + C12 quadrant mapping, author matches scenarios), scaffolds via `node tools/new-capability.mjs --kind <kind> --slug <slug> --name <name>`, overwrites body H2 + dual artifacts (## 运行指令 system-prompt draft + ## 蒸馏日志 each tagged "来自实录步骤N", R31-verified), gives quadrant/source/confidence/allow_exact_reason defaults for author confirmation, and calls `opsforge set-phase <capDir> distill_done`. Behavior gaps → back to interview (no fabrication). Failure three-way split + author escape hatch (revert to Mode B pure-interview + hand-fill).

Phase 3 · 跑通期: run structure gate (validate.mjs draft gate + security-scan.mjs) then run-light gate (test-runner.mjs dry-run ≥2 cases: 1 positive contains + 1 boundary/negative llm_judge, cheapest endpoint). Render two-tier light via report-renderer.mjs renderRunLight: 🟢 (Tier 1 cheapest-endpoint smoke, "未刻画部署模型") / 🔵 (Tier 2/3 static, "本平台暂不支持真跑通") / 🔴 (fail → back to distiller). Record built_with_model via `opsforge set-phase <capDir> v0.1_built --built-with-model <endpoint:version> --built-at <iso>`.

Phase 4 · 迭代期: passive evolve trigger (feedback≤2 or 3rd discover/doctor call → suggest `opsforge evolve <capId>`); regression-sink drafts a case (quadrant left as a placeholder for the distiller); distiller generates expected draft (negative/degradation → llm_judge, positive → contains); author confirms; `node tools/new-capability.mjs --promote-case <srcDir> <caseFile>` (良构 + run-pass gates); bump + rerun. Converge: 2 consecutive clean OR max_iterations:5 → set-phase iteration_converged|iteration_capped.

Also carry the legacy flows: install (5 steps: platform auto-detect, method, browse, confirm deps, confirm install), discover (per-project manifest + quality light + commercial tag), report (all 3 reports), feedback (1-5 + text → kb/<pack>/feedback/<cap-id>.jsonl). Always loop back to the top menu. Resolve working dir via three-tier fallback (OPSFORGE_WORKDIR env, opsforge-home/opsforge-workdir, cwd repo validation) — never assume cwd is a repo. Platform honesty: capability-wizard supports claude-code, codex, and workbuddy; other platforms use pure-prompt guidance plus static checks.

## 蒸馏日志

- 路由四期来自实录步骤1（访谈→蒸馏→跑通→迭代）
