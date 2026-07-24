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
This MCP server connects to business intelligence systems to retrieve marketing metrics and performance data. It provides a standardized interface for querying campaign performance, audience analytics, and conversion data. The connector supports authentication via environment variables and respects rate limiting. All data is returned in JSON format with consistent schema structures. The BI connector implements proper error handling for network issues and authentication failures. It caches responses where appropriate to reduce load on upstream systems. The tool surface is intentionally minimal to prevent over-privileged access patterns. The connector also implements retry logic with exponential backoff for transient failures. It validates all inputs against strict schemas before forwarding requests to upstream systems. The MCP server exposes a clean tool interface that follows the Model Context Protocol specification. All sensitive configuration is handled through environment variables without hardcoding secrets. The connector supports connection pooling and timeout management for reliable operation under load. Logging and observability hooks are integrated for monitoring and debugging purposes. The implementation follows security best practices including input validation, output sanitization, and principle of least privilege for tool permissions. Documentation references are included for each tool and configuration option to assist integrators and maintainers working with the connector in production environments. The connector also supports health check endpoints for deployment readiness probes and operational monitoring dashboards used by site reliability engineering teams managing the marketing technology stack infrastructure.