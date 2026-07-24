# OpsForge 文档索引

> 一页纸地图：你想做 X，就读 Y。本索引是入口，各文档自身的 header 标注其角色（权威 / 已归档）。
> 维护规则：一次性文档（fix-spec / clarification）一旦被 `PROGRESS.md` 记录为已解决，即移入 `docs/archive/`。

## 权威文档（active，按用途）

| 你想…… | 读这个 | 角色 |
|---|---|---|
| 看整体规范 / 某一 § 的设计 | `PLAN.md` | 顶层主规范 v9，含 §20/§21/§22 摘要 |
| 看文件级工程蓝图 | `DESIGN.md` | 逐文件工程设计 |
| 看 Phase 1+ 接口契约 / schema delta | `ARCHITECTURE-DELTA.md` | 工程契约（§6 待折叠进 DESIGN，未完成前为权威） |
| 看构建顺序 / Phase 切分 | `IMPLEMENTATION-PLAN.md` | 构建计划，Phase 2 + 3 + 3.6 已交付，Phase 4 待启动 |
| 看实际交付了什么 / 偏差 | `PROGRESS.md` | 活跃状态追踪（"实际 vs 规范"唯一记录点，含 Phase 3.6 SHIPPED 条目 + Lessons learned g–k） |
| 看前瞻 UX 设计（Phase 2+） | `UX-PLAN-V2.md` | 前向 UX 提案 |
| 给 AI coding agent 立工程红线 | `AGENTS.md` | 通用 agent 指令（steering-owned） |
| Claude Code 专属补充 | `CLAUDE.md` | 指向 AGENTS.md + 当前状态摘要 |

## 非技术运营者入口

| 你想…… | 读这个 |
|---|---|
| vibe coding 怎么做 | `docs/vibe-coding-playbook.md` |
| 写一个新能力（agent/skill/mcp/workflow） | `docs/authoring-guide.md` |
| 工程基线为什么是这样 | `docs/engineering-baseline.md` |

## 已归档（历史，非权威）

| 文件 | 原角色 | 归档原因 |
|---|---|---|
| `docs/design-archive/supplement-v7.md` | v7 设计补遗（循环工作流+可组合安装） | Phase 1 已落地；决策 P1–P8 见 `PLAN.md` §20.9 |
| `docs/design-archive/supplement-v8.md` | v8 设计补遗（行为评估层） | 已落地进 test-runner/eval；决策 Q1–Q11 见 §21.9 |
| `docs/design-archive/supplement-v9.md` | v9 设计补遗（国内平台+UX） | Phase 2.5 工程后端 + Phase 3.6 UX shell 均已落地进 adapter/opsforge/opsforge-bootstrap/opsforge-runtime/packs/opsforge-meta；决策 D1–D6 见 §22.6 |
| `docs/archive/fix-spec-phase1.md` | Phase 1 post-e2e 修复清单 | 全部已应用，见 `PROGRESS.md` |
| `docs/archive/ux-flow-clarification.md` | 一次性流程澄清 | gaps 已在 post-e2e 解决；当前流程见 `UX-PLAN-V2.md` |

> 归档件仅供"当时为什么这么设计"的历史查阅。任何当前决策以权威文档为准。
