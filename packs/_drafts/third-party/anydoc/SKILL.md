---
id: third-party.anydoc
version: 0.1.0
kind: skill
pack: third-party
owner: third-party
# customer: third-party
display_name: AnyDoc 文档转 Markdown
display_name_zh: AnyDoc 文档转 Markdown
display_name_en: AnyDoc Document to Markdown
description: 把 Word / PowerPoint / Excel / OpenDocument / RTF / EPUB / CSV / PDF 转成干净的 Markdown（第三方收录自 firecrawl/anydoc，MIT 许可）
platforms: [claude-code]
entrypoint: SKILL.md
tests: tests/
changelog: CHANGELOG.md
depends_on: []
source:
  origin: forked
  upstream_ref: https://github.com/firecrawl/anydoc
---
<!-- 业务作者在此写 skill 正文。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

AnyDoc 把常见办公文档（Word、PowerPoint、Excel、OpenDocument、RTF、EPUB、CSV、PDF）转换成结构干净、适合 AI 阅读的 Markdown。底层为第三方收录的 firecrawl/anydoc（Rust 内核，含 Node.js / Python 绑定，MIT 许可）。

## 适用场景

- 把收到的 Word 方案、Excel 报表、PDF 报告转成 Markdown，交给 AI 做摘要、翻译或二次加工
- 批量把 EPUB 电子书、RTF 旧文档整理成统一的 Markdown 知识库
- 内容流水线里作为“文档 → Markdown”的前置清洗步骤

## 运行流程

### 步骤1 识别并转换文档
数据: 用户提供的原始文档（Word / PPT / Excel / ODT / RTF / EPUB / CSV / PDF）
决策: 按文件格式选择 anydoc 对应解析器；不在支持清单内的格式直接进入失败降级
交付工件: 干净的 Markdown 文本

### 步骤2 校验并交付
数据: 步骤1 产出的 Markdown
决策: 检查输出非空、标题与表格结构完整可读；异常时按失败降级提示
交付工件: 保存为 .md 文件或直接在对话中返回的 Markdown

## 失败降级

- 格式不支持或文件损坏：明确告知支持的格式清单（Word / PPT / Excel / ODT / RTF / EPUB / CSV / PDF），请用户另存为支持格式后重试
- 扫描件 / 图片型 PDF：说明需要 OCR，本技能不直接承诺识别效果
- 转换结果为空或乱码：提示检查文件是否加密或损坏，必要时请用户提供原文节选

## 依赖

- anydoc 运行时（第三方收录自 firecrawl/anydoc，Rust 内核 + Node.js / Python 绑定，MIT 许可）

## 运行指令

接收用户提供的文档（路径或上传文件），用 anydoc 转成 Markdown，检查输出质量后交付 .md 结果；不支持的格式按“失败降级”处理。

## 蒸馏日志

- 2026-08-20 第三方收录自 firecrawl/anydoc @7df4b2e（MIT 许可），按上游功能描述整理填写（来自实录步骤1）
