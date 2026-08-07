---
id: marketing-team.activity-summary
version: 1.0.0
kind: skill
pack: marketing-team
owner: marketing-team
display_name: Activity Summary
display_name_zh: 活动总结
display_name_en: Activity Summary
description: '【示例能力】summary skill that generates activity reports'
platforms:
  - claude-code
  - workbuddy
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
---
## 能力说明

> 【示例能力】本能力为 OpsForge 示范用例（dogfood），非真实业务能力，请勿当作生产能力使用。

活动总结 skill，从多渠道营销活动数据中提取指标，生成结构化复盘报告：关键发现、趋势、异常与建议。支持高管摘要与明细两种格式，可配置时间范围与指标口径，自动比对基准与历史趋势；内置异常告警与定期推送。

## 适用场景

- 大促后活动复盘与汇报
- 周期性运营例会数据汇总
- 异动指标归因排查
- 跨渠道 ROI 对比

## 运行流程

### 步骤1 拉取多渠道指标
数据: 各渠道活动效果文件路径（不贴原值）
决策: 按配置时间范围与指标口径聚合
交付工件: 指标聚合结果

### 步骤2 生成结构化复盘报告
数据: 聚合指标 + 基准/历史趋势
决策: 高管摘要 or 明细格式
交付工件: 复盘报告（关键发现/趋势/异常/建议）

## 失败降级

- 数据源不可用时返回空报告并告警，不崩

## 依赖

- 无（可接 bi-connector 拉数，但未在 depends_on 声明，保持独立）

## 运行指令

This skill generates activity summaries from marketing campaign data. It processes metrics from multiple channels and produces a structured report with key findings, trends, and recommendations. The skill extracts data from configured sources, aggregates performance indicators, and presents results in a clear format suitable for stakeholders. It supports different report formats including executive summaries and detailed breakdowns. The summary skill also identifies outliers and notable patterns in the activity data for further investigation. Configuration parameters allow customization of time ranges and metric selections per project requirements. The summary skill also generates visual representations of data trends and comparative analysis across different time periods. It supports automated scheduling for recurring reports and alerting when metrics deviate from expected ranges. The skill integrates with notification channels to distribute summaries to relevant stakeholders automatically. Additional features include benchmark comparisons, goal tracking, and historical trend analysis for informed decision making. The skill processes data from multiple marketing platforms including social media, email campaigns, and paid advertising channels. It produces standardized output formats for downstream consumption and archiving purposes.