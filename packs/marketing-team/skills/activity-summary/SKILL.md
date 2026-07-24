---
id: marketing-team.activity-summary
version: 1.0.0
kind: skill
pack: marketing-team
owner: marketing-team
display_name: Activity Summary
display_name_zh: 活动总结
display_name_en: Activity Summary
description: summary skill that generates activity reports
platforms:
  - claude-code
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: original
  upstream_ref: null
---
This skill generates activity summaries from marketing campaign data. It processes metrics from multiple channels and produces a structured report with key findings, trends, and recommendations. The skill extracts data from configured sources, aggregates performance indicators, and presents results in a clear format suitable for stakeholders. It supports different report formats including executive summaries and detailed breakdowns. The summary skill also identifies outliers and notable patterns in the activity data for further investigation. Configuration parameters allow customization of time ranges and metric selections per project requirements. The summary skill also generates visual representations of data trends and comparative analysis across different time periods. It supports automated scheduling for recurring reports and alerting when metrics deviate from expected ranges. The skill integrates with notification channels to distribute summaries to relevant stakeholders automatically. Additional features include benchmark comparisons, goal tracking, and historical trend analysis for informed decision making. The skill processes data from multiple marketing platforms including social media, email campaigns, and paid advertising channels. It produces standardized output formats for downstream consumption and archiving purposes.