---
id: third-party.member-recall
version: 0.1.0
kind: skill
pack: third-party
owner: third-party
# customer: third-party
display_name: Member Recall
display_name_zh: 会员召回
display_name_en: Member Recall
description: 生产级交互式 CRM 会员召回能力，引导运营团队完成严谨的分阶段召回生产任务（初始化→动机洞察→品牌调性确认→联网调研→文案创生→策略匹配→产出交付）。LLM 直接承担动机洞察与文案创生（无需外部 API Key），确定性处理（CSV 读写、数据画像、敏感词检测、启发式匹配、A/B 拆分）由上游 scripts/data_utils.py 承担，全程用户审核确认，无模拟无假设。
platforms: [claude-code]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: forked
  upstream_ref: https://github.com/noahwang550/member-recall
---
<!-- 业务作者在此写 skill 正文。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

本能力收录自第三方仓库 `noahwang550/member-recall`（MIT 协议），是一个生产级交互式 CRM 会员召回技能。安装到代理平台后，引导运营团队按阶段完成会员召回生产任务，每步都可执行、无模拟无假设。

分工原则：LLM 直接承担动机洞察、文案创生等需要语言能力的环节（无需外部 API Key）；确定性处理（CSV 读写、数据画像、敏感词检测、启发式人群匹配、A/B 拆分）由上游仓库 `scripts/data_utils.py` 承担，能力通过调用该脚本完成。上游仓库还含 `references/`（动机/文案/调研三份引导手册）与 `evals/evals.json` 评测集，安装时随上游仓库一同落地。

安装方式：本能力在 opsforge 中只登记 git 地址（reference 形态），通过 `install --from-git https://github.com/noahwang550/member-recall` 拉取上游仓库完整内容（含 SKILL.md、references/、scripts/、evals/）后使用。

## 适用场景

- 沉睡会员激活 / 流失会员挽回，需要一套可执行的生产级召回流程
- CRM 运营团队要做会员召回但缺乏方法论，需要分阶段引导
- 需要数据驱动的动机洞察 + 多风格文案创生 + A/B 测试人群包的完整链路
- 需要敏感词检测与合规审核的文案生产
- 需要启发式冷启动匹配策略（无历史效果数据时）

## 运行流程

### 步骤0 初始化
数据: 读取会员数据文件（CSV），确认列结构与召回目标（沉睡定义、时间窗、目标人群量级）
决策: 校验数据可达性与字段完备性；缺失关键字段（如手机号/会员ID/最后活跃时间）则提示补齐后再跑
交付工件: 初始化摘要（数据行数、字段、目标人群规模、本次召回设定）

### 步骤1 动机洞察
数据: 基于会员行为与属性数据生成动机初稿（分群 + 各群召回动机假设）
决策: 数据驱动生成、用户审核确认；不替业务方拍板动机
交付工件: 动机洞察初稿（分群、各群动机假设、支撑数据）

### 步骤1.5 品牌调性确认
数据: 询问/确认品牌调性（语气、禁忌、主张），作为文案创生的约束
决策: 调性一旦确认贯穿后续所有文案
交付工件: 品牌调性卡片

### 步骤1.7 联网调研
数据: 用 WebSearch 调研品牌、行业、竞品、合规要求，补充召回文案的事实与边界
决策: 调研结果用户确认后再进入文案创生
交付工件: 调研摘要（行业话术、竞品动作、合规红线）

### 步骤2 文案创生
数据: 按动机 × 调性 × 调研，生成多风格召回文案（每群多版）
决策: 用户挑选并审核；内置敏感词检测，命中则改写或弃用
交付工件: 审核通过的文案集合（按人群分组）

### 步骤3 策略匹配
数据: 启发式冷启动匹配——把文案与人群做匹配（无历史效果数据时用规则，有则用效果数据优化）
决策: 匹配结果可调；产出 A/B 测试人群包（AI 组个性化文案 vs 对照组通用文案）
交付工件: A/B 测试人群包 + 文案分配表

### 步骤4 产出交付
数据: 汇总产出（人群包、文案、配置），生成可投递的最终产物
决策: 全程可执行、无假设；交付前最终确认
交付工件: 召回生产交付包（人群包 + 文案 + 投递配置）

## 失败降级

- 数据文件缺失关键字段：提示补齐后重跑，不强行推断
- `scripts/data_utils.py` 执行失败（如缺 openpyxl/pandas 依赖）：提示安装依赖后重试，或降级为纯 LLM 引导（跳过确定性处理，人工接力）
- WebSearch 不可用：跳过联网调研，提示文案可能缺事实支撑，由用户补充
- 敏感词检测命中：改写或弃用该文案，不直接产出

## 依赖

- 上游仓库 `scripts/data_utils.py`：CSV 读写、数据画像、敏感词检测、启发式匹配、A/B 拆分（确定性处理）
- Python 3.9+（运行 data_utils.py）
- WebSearch（步骤1.7 联网调研）

## 运行指令

安装本能力（拉取上游仓库完整内容）：

```
node install.mjs --from-git https://github.com/noahwang550/member-recall
```

或经 opsforge 菜单「收录第三方能力」收录后，按上游仓库 `skills/member-recall/SKILL.md` 的分步流程执行。安装完成后，在代理平台对话中描述召回目标（如"沉睡会员激活"），能力将引导依次完成初始化、动机洞察、品牌调性确认、联网调研、文案创生、策略匹配与产出交付。确定性处理（CSV 读写、数据画像、敏感词检测、A/B 拆分）通过调用上游 `scripts/data_utils.py` 完成，需本机 Python 3.9+ 与相关依赖。

## 蒸馏日志

- 7 阶段流程来自上游仓库 README 与 SKILL.md 描述（步骤0/1/1.5/1.7/2/3/4）
- LLM/确定性分工来自上游 README「Claude 直接承担…Python 承担…」设计陈述
