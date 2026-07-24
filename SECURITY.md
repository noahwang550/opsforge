# 安全策略

OpsForge 内置 §B 安全扫描（`tools/security-scan.mjs`），覆盖：硬编码密钥 / prompt 注入 / 私网 SSRF（含 DNS 私网段拒绝）/ 过权工具声明 / 供应链未锁版本 / MCP 工具面 / 依赖闭包告警 / 数据驻留（中国）告警。其中 **prompt 注入 / 供应链 / 私网 SSRF 三类不可例外**。

## 报告漏洞

**勿在公开 issue 提安全漏洞。** 请私下来信或在 GitHub 私密披露（Security advisories / `gh security-advisory`）。含：

- 影响范围与复现步骤
- 涉及文件/能力
- 建议修复（可选）

收到后我们将在 72 小时内确认，并在修复后公开致谢。

## 支持版本

仅最新 `main` 分支受安全维护。Phase 1+2+3+3.6 已 SHIPPED。
