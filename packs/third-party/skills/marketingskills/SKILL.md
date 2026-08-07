---
id: third-party.marketingskills
version: 0.1.0
kind: skill
pack: third-party
owner: third-party
# customer: third-party
display_name: Marketing Skills for AI Agents
display_name_zh: AI 代理营销技能包
display_name_en: Marketing Skills for AI Agents
description: 面向技术营销人员与创始人的营销技能合集，让 AI 编码代理在识别到营销任务时自动套用对应框架与最佳实践，覆盖转化优化、文案、SEO、投放、分析、增长工程等场景。
platforms: [claude-code, workbuddy]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: forked
  upstream_ref: https://github.com/coreyhaines31/marketingskills
---
<!-- 业务作者在此写 skill 正文。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

本能力收录自第三方仓库 `coreyhaines31/marketingskills`（MIT 协议），是一组面向 AI 编码代理的营销技能 markdown 集合。当本能力安装到代理平台后，AI 代理在识别到营销类任务时，能自动套用其中沉淀的框架与最佳实践，让非营销背景的技术人员也能产出合规、有效的营销产出。

仓库约含 50 个技能，分布在以下类别（基于上游 README，未内化源码，细节以上游仓库为准）：

- 转化优化：落地页/表单/注册流/引导流程/弹窗/付费墙的 CRO 方法论
- 内容与文案：文案撰写与改写、冷邮件、邮件序列、社媒、配图、视频、短信
- SEO 与发现：SEO 审计、AI 搜索优化、程序化 SEO、站点结构、Schema 标记、ASO、竞品页
- 付费与分发：Google / Meta / LinkedIn 广告投放、批量广告创意生成
- 度量分析：埋点跟踪搭建、A/B 测试、归因
- 增长工程：联合营销、免费工具、推荐计划、引流诱饵、目录提交
- 策略与变现：营销点子、营销心理学、发布规划、定价、套餐、营销计划、营销闭环
- 销售与 RevOps：收入运营、销售赋能、潜客开发、冷邮件
- 留存：流失预防、社区营销
- 其他：用户调研、竞品画像、红人营销、公共关系

兼容性（上游声明）：支持 Claude Code、OpenAI Codex、Cursor、Windsurf，以及任何支持 Agent Skills 规范的代理。

## 适用场景

- 技术营销人员或创始人想让 AI 编码代理代写落地页文案、邮件序列、社媒帖、广告创意
- 需要给 AI 代理注入一整套营销框架，让它识别营销任务并自动套用最佳实践
- 非营销背景的工程师/产品经理需要快速产出合规营销产出（SEO、CRO、投放）
- 多平台代理环境（Claude Code / Cursor / Codex）需要统一的营销技能来源
- 团队想把营销方法论沉淀为可复用、可分发的代理能力资产

## 运行流程

### 步骤1 安装与挂载
数据: 上游 git 地址 `https://github.com/coreyhaines31/marketingskills`（reference scope，只存地址）
决策: 通过 `install.mjs --from-git` 在安装时拉取上游仓库到临时目录并挂载到代理配置目录
交付工件: 代理平台的 skill 目录中可见 marketingskills 技能集

### 步骤2 触发与套用
数据: 用户在代理中提出营销类任务（如「写一封冷邮件」「审计这个落地页的转化」）
决策: 代理识别任务类型，自动匹配并加载对应的营销技能 markdown
交付工件: 套用框架后的营销产出（文案、审计报告、创意草案等）

## 失败降级

- 上游仓库不可访问时，install 会失败并提示用户检查 git 地址与网络
- 某类营销任务无对应技能时，代理回退到通用能力，不强制套用不相关框架
- 协议变更（MIT 变更为非宽松协议）时，OpsForge §12.2 门会拒绝后续 install

## 依赖

- 上游仓库: https://github.com/coreyhaines31/marketingskills (commit 7868cb9, MIT)
- 代理平台需支持 skill 文件挂载点（claude-code Tier1 原生支持；Tier2/3 走 manual-paste/http-inject 降级）
- 无 npm 依赖，无 Go 二进制

## 运行指令

本能力为 reference scope 收录：仓库内只存 git 地址（见 `upstream-ref.json`），不内化源码。安装时由 `install.mjs --from-git` 按 `install_hint` 拉取上游并挂载。业务作者如需修改技能内容，应在上游仓库修改后重新 intake 更新 commit 引用，而非直接改本仓库内的副本。

## 蒸馏日志

- 2026-08-06 intake 落盘：fetchRemoteMeta 检出 license=MIT（过 §12.2 门），commit=7868cb9，scope=reference
