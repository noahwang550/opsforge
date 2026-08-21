---
id: third-party.ppt-master
version: 0.1.0
kind: skill
pack: third-party
owner: third-party
# customer: third-party
display_name: PPT Master
display_name_zh: PPT 大师
display_name_en: PPT Master
description: 把 PDF、Word、网页等资料变成本机原生可编辑的 PPT：图表表格可继续编辑，支持套用公司模板、页间转场与动画、演讲备注合成旁白（第三方收录自 hugohe3/ppt-master，MIT 许可）
platforms: [claude-code]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: forked
  upstream_ref: https://github.com/hugohe3/ppt-master
---
<!-- 业务作者在此写 skill 正文。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

第三方收录的 AI 演示文稿生成能力（来源：hugohe3/ppt-master，MIT 许可）。用户在对话框里说「用这份 PDF 做一份 PPT」，它就在本机生成并导出原生可编辑的 .pptx 文件——每个形状、图表、表格、文本框都是 PowerPoint 原生对象，打开后可继续编辑，而不是图片拼出来的幻灯片。输入材料可以是 PDF、DOCX、网页等原始资料。核心能力：原生页间转场；入场、强调、路径、退出四类动画（默认关闭，按需开启）；演讲者备注可合成音频旁白乃至视频；图表表格作为带数据的原生对象导出；可套用用户自己的 PPT 模板（提炼品牌、风格与版式）；也能把新内容填进已有 .pptx 并保留其设计。使用前提：本机安装 Python（生成脚本基于 python-pptx 库）和有 Agent 能力的 AI 工具；数据不出本地（除与 AI 模型的对话）。工具免费开源，唯一成本是用户自己的 AI 模型用量。

## 适用场景

- 把 PDF 报告、Word 方案、网页资料变成能上台讲的 PPT：自动提炼重点、规划分页大纲
- 套用公司既有 PPT 模板批量出新 deck：提炼品牌配色、字体与版式，保持风格统一
- 给成品 PPT 锦上添花：加页间转场、元素动画，或把演讲者备注合成音频旁白乃至视频
- 把新内容填进已有的 .pptx 文件，同时完整保留原有设计

## 运行流程

### 步骤1 明确需求并规划大纲
数据: 用户的 PPT 需求与原始资料（PDF、DOCX、网页等），以及模板、动画、旁白等偏好
决策: 确认读者、场合、页数与风格方向；信息不全时先追问（见「失败降级」），再据此规划演示大纲
交付工件: 与用户确认过的演示大纲

### 步骤2 生成并导出原生 PPTX
数据: 确认后的大纲与原始资料（可选：用户的公司模板文件）
决策: 由 AI 按上游工作流驱动本机 Python（python-pptx）生成：图表表格为可编辑原生对象，转场与动画按需开启，演讲备注可合成旁白
交付工件: 一个原生可编辑的 .pptx 文件（及可选的旁白音频或视频）

## 失败降级

- 需求模糊、材料缺失 → 先确认读者、场合、页数和内容方向再动手，不编造主题和内容
- 本机缺 Python 或 python-pptx 库 → 明确告知用户需要先安装 Python 及 python-pptx（见上游 requirements.txt），不静默失败、不假装已生成

## 依赖

- 生成环节依赖本机 Python + python-pptx 库（上游 requirements.txt）
- 本能力为 reference 方式收录，安装时从上游仓库拉取（github.com/hugohe3/ppt-master，锁定版本 fb6e5ac）

## 运行指令

1. 先听清楚用户要什么：原始资料（PDF、DOCX、网页）、读者是谁、什么场合讲、大概多少页，以及是否要套公司模板、加动画或旁白。只说「帮我做个 PPT」而不给任何材料时，按「失败降级」追问，不要编造主题。
2. 规划演示大纲：从原始资料提炼重点、安排分页逻辑，先与用户确认大纲与风格方向，确认后再进入生成。
3. 驱动上游工作流在本机生成 PPTX：基于 python-pptx 生成原生可编辑对象（形状、图表、表格、文本）；需要套模板时先提炼其品牌与版式；转场与动画默认关闭、用户要求时再开启；演讲者备注可进一步合成音频旁白或视频。
4. 交付并说明：告知 .pptx 文件位置、页数与内容结构，提醒所有对象均可在 PowerPoint 中继续编辑；素材有缺失或做过取舍时如实标注，绝不编造内容。

## 蒸馏日志

- 2026-08-21 第三方收录自 hugohe3/ppt-master @fb6e5ac（MIT 许可），按上游官方说明（README_CN.md + skills/ppt-master/SKILL.md）整理原生可编辑 PPTX 生成流程、模板套用与转场动画及旁白等增强能力，以及需求模糊先确认、缺 Python 明确报装的失败降级路径（来自实录步骤1）
