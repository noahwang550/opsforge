# Changelog

All notable changes are documented here. Format: Keep a Changelog.

## [0.2.0] - Unreleased

- 新增模式 III 凭据文件直连：平台无连接器时，分析师在本机终端运行 `scripts/credential_setup.py` 生成 0600 凭据文件与 wrapper，能力只发脚本与 wrapper 调用命令、从不读凭据/不复述字段。
- 内置报表生成脚本 `scripts/`（generate_reports.py / credential_setup.py / test_generator.py / requirements.txt）：四件套由 Markdown 升级为 Excel/Word（含图表，openpyxl/python-docx/matplotlib），verify_outputs 自校验 + 3 次自动重发，绝不静默交付残缺。
- 同步自 GitHub 分发仓库 `noahwang550/data-quality-profiler`（MIT）最新内容。

## [0.1.0] - Unreleased

- 首次沉淀：访谈→蒸馏产出数据质量体检 skill。七步引导流程（环境摸底/全库普查/细看名单/五维体检/表关系推导/CRM 双轴业务统计/四件套产出），三条人工闸门，只读+凭据零接触两条安全红线，支持平台直连（模式 I）与手工接力（模式 II）两种执行模式。
