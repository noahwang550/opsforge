---
id: marketing-team.bi-connector
version: 1.0.0
kind: mcp
pack: marketing-team
owner: marketing-team
display_name: BI Connector
display_name_zh: BI连接器
display_name_en: BI Connector
description: connector mcp that interfaces with business intelligence systems
platforms:
  - claude-code
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
transport: stdio
config_template:
  auth_schema:
    - BI_API_KEY
tools:
  - name: query-metrics
    description: Query marketing metrics from BI system
    inputSchema:
      type: object
      properties:
        metric:
          type: string
source:
  origin: original
  upstream_ref: null
---
## 能力说明

BI 连接器 MCP，对接商业智能系统拉取营销指标与表现数据。通过 query-metrics 工具按统一 schema 查询活动表现、人群分析与转化数据；鉴权走环境变量，含速率限制、重试退避与缓存；工具面刻意收敛以防越权，所有输入严格 schema 校验后转发。

## 适用场景

- 营销活动实时效果查询
- 人群画像与转化漏斗分析
- 自动化报表数据源接入
- 运营大屏指标拉取

## 运行指令

This MCP server connects to business intelligence systems to retrieve marketing metrics and performance data. It provides a standardized interface for querying campaign performance, audience analytics, and conversion data. The connector supports authentication via environment variables and respects rate limiting. All data is returned in JSON format with consistent schema structures. The BI connector implements proper error handling for network issues and authentication failures. It caches responses where appropriate to reduce load on upstream systems. The tool surface is intentionally minimal to prevent over-privileged access patterns. The connector also implements retry logic with exponential backoff for transient failures. It validates all inputs against strict schemas before forwarding requests to upstream systems. The MCP server exposes a clean tool interface that follows the Model Context Protocol specification. All sensitive configuration is handled through environment variables without hardcoding secrets. The connector supports connection pooling and timeout management for reliable operation under load. Logging and observability hooks are integrated for monitoring and debugging purposes. The implementation follows security best practices including input validation, output sanitization, and principle of least privilege for tool permissions. Documentation references are included for each tool and configuration option to assist integrators and maintainers working with the connector in production environments. The connector also supports health check endpoints for deployment readiness probes and operational monitoring dashboards used by site reliability engineering teams managing the marketing technology stack infrastructure.