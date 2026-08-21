---
id: third-party.diagram-design
version: 0.1.0
kind: skill
pack: third-party
owner: third-party
# customer: third-party
display_name: Diagram Design
display_name_zh: 编辑风图表设计
display_name_en: Diagram Design
description: 把数据、流程、结构画成编辑风图表与视觉插画（38 种图型，自包含 HTML + SVG）（第三方收录自 cathrynlavery/diagram-design，MIT 许可）
platforms: [claude-code]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: forked
  upstream_ref: https://github.com/cathrynlavery/diagram-design
---
<!-- 业务作者在此写 skill 正文。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

第三方收录的图表设计能力（来源：cathrynlavery/diagram-design，MIT 许可）。把数据、流程、结构画成编辑风格的视觉图，覆盖 9 大类 38 种图型：线稿图、13 种数据图表（柱状/折线/饼图/散点/热力图等）、流程图、层级图、对比图、地图（点位/路线/区域）、仪表盘、信息图、卡片海报、清单、时间轴、四象限、金字塔、2.5D 插画等。输出为单个自包含 HTML 文件（内联 SVG），双击即可用浏览器打开；风格统一干净：无阴影、无渐变、编辑排版。用户提出「画图 / 图表 / 流程图 / 信息图 / 可视化」类需求时适用。

## 适用场景

- 把流程、架构、思路画成图：流程图、层级图、对比图、关系图
- 数据可视化汇报：柱状、折线、饼图、散点、热力图等 13 种图表
- 内容与汇报配图：信息图、卡片海报、清单、时间轴
- 地图类示意：点位分布、路线、区域图

## 运行流程

### 步骤1 识别图型
数据: 用户的画图需求（可附数据、文字稿或参考内容）
决策: 对照 38 种图型选择最贴切的一种（上游 references/ 目录有每种图型的规格说明）
交付工件: 选定的图型

### 步骤2 生成图文件
数据: 选定的图型 + 用户提供的内容
决策: 按该图型的规格生成单个自包含 HTML 文件（内联 SVG，无阴影、无渐变）
交付工件: 一个可直接用浏览器打开的 .html 图文件

## 失败降级

- 需求模糊、图型不确定 → 先向用户确认用途和读者，再选最接近的图型并说明取舍
- 数据或内容不足以成图 → 列出缺失信息向用户索要，不编造内容

## 依赖

- 无外部服务依赖（纯生成 HTML + SVG 文件）；本能力为 reference 方式收录，安装时从上游仓库拉取（github.com/cathrynlavery/diagram-design，锁定版本 5538b35）

## 运行指令

1. 先听清楚用户要画什么：主题、数据、读者和用途（周报 / 对外汇报 / 文章配图）。只说"画个图"而内容不明时，按"失败降级"追问，不要编造主题。
2. 对照上游 38 种图型选定最合适的一种（数据图表、流程/层级/对比、地图、仪表盘、信息图、时间轴、四象限、2.5D 插画等，规格见上游 references/ 目录）。
3. 按该图型规格生成单个自包含 HTML 文件：内联 SVG、嵌入样式（除 Google Fonts 外无外部依赖）、无阴影、无渐变，任何现代浏览器可直接打开。
4. 交付并说明：告知文件位置、选用的图型及理由；数据有缺失或做过取舍时如实标注，绝不编造数据。

## 蒸馏日志

- 2026-08-21 第三方收录自 cathrynlavery/diagram-design @5538b35（MIT 许可），按上游官方说明（README + skills/diagram-design/SKILL.md）整理 38 种图型清单、生成自包含 HTML 的运行流程与不编造数据的失败降级路径（来自实录步骤1）
