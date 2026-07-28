---
id: __SLUG__.__NAME__
version: 0.1.0
kind: mcp
pack: __SLUG__
owner: __SLUG__
# customer: __BRAND_SLUG__
display_name: __FILL_ME__
display_name_zh: __FILL_ME__
display_name_en: __FILL_ME__
description: __FILL_ME__
platforms: [claude-code]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
transport: stdio
config_template:
  auth_schema: []
tools: []
source:
  origin: original
  upstream_ref: null
---
<!-- 业务作者在此写 mcp 说明 body。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

__FILL_ME__

## 适用场景

- __FILL_ME__

## 工具面

- __FILL_ME__

## 数据契约

- __FILL_ME__

## 异常处理

- __FILL_ME__

## 依赖

- __FILL_ME__

## 运行指令

__FILL_ME__

## 蒸馏日志

- __FILL_ME__ 来自实录步骤1
