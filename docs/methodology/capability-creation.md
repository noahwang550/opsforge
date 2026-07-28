# 能力新建方法论（贡献者文档）

> 本文是业务作者面向的能力新建指南，对应 `docs/design-archive/capability-creation-methodology.md`（FINAL v1）。
> 工程机制对作者全隐藏；本文把机制翻译成业务语言。R26 软检查关键词集合从本文 C12 表派生。

OpsForge 把"建好一个能力"从"往空模板填字"变成"LLM 引导式沉淀 + 作者审稿"。核心转变：**LLM 先生成草稿、作者只勾选确认**（propose_and_confirm）；"建好"由真实输入跑通定义；成熟度由真实使用证据背书。

## 五期流水线

1. **访谈期**（`@capability-interviewer` 或纯 prompt 脚本 `opsforge-interview`）
   - 开场给成本预估：访谈约 1 小时、蒸馏约 15 分钟、跑通约几块钱、以后每次补一条几分钟。
   - 聊法一·最近一次复述（Mode A，适合"最近做过、能回忆"）；聊法二·一问一答（Mode B，适合"不常做、数据敏感、长流程"）。
   - 数据不进会话：涉真实数据给文件路径/生成测试数据/规避 PII 的 schema，不贴原值。
   - 反锚定守卫：先让作者自由复述，再出草稿；草稿对不上复述 → 标 `synthetic` 不标 `real`。
   - interviewer 先生成样本草稿，作者确认；`source: real` 须带可验证硬事实工件引用（文件路径/记录 ID/hash），否则标 `recalled`。
   - 产出 `_drafts/<slug>/interview.md`；`opsforge set-phase <capDir> interview_done`（对作者透明）。

2. **蒸馏期**（`@capability-distiller`，claude-code 侧）
   - 形状推导（附理由 + 下表 C12 业务语言例对，作者按场景匹配确认 kind）。
   - Bash `node tools/new-capability.mjs --kind <kind> --slug <slug> --name <name>`；Write 覆写业务字段 + 双工件（`## 运行指令` 系统提示词草稿 + `## 蒸馏日志` 每条"来自实录步骤N"机械验证）。
   - distiller 给 quadrant/source/confidence/allow_exact_reason 默认值作者确认；行为缺口回访谈不编造。
   - `opsforge set-phase <capDir> distill_done`。

3. **跑通期**（CLI 接驳）
   - 结构门：`validate.mjs` draft gate + `security-scan.mjs`。
   - 跑通门：`test-runner.mjs` dry-run ≥2 case（1 positive contains + 1 boundary/negative llm_judge），最便宜 endpoint。
   - 质量灯两档：🟢 Tier 1 真跑通（cheapest endpoint 烟雾，未刻画部署模型）；🔵 Tier 2/3 静态等效（本平台暂不支持真跑通，能力本身没问题 + 升级出口）。
   - 记 `built_with_model`；`opsforge set-phase <capDir> v0.1_built --built-with-model <endpoint:version> --built-at <iso>`。

4. **迭代期**（人 paced + 被动触发）
   - 再拿 2 真例跑；崩了 → evolve 被动触发（feedback≤2 或第 3 次 discover/doctor 调用自动提示）→ `regression-sink` 起草 case（`quadrant: __FILL_ME__`）。
   - distiller 生成 expected 草稿（negative/degradation → llm_judge；positive → contains）→ 作者确认 → `node tools/new-capability.mjs --promote-case <srcDir> <caseFile>`（良构 + run-pass 两道门）→ bump + 重跑。
   - 收敛：连续 2 干净 OR `max_iterations:5` → `set-phase iteration_converged|iteration_capped`。

## kind 形状推导（C12）

实录特征 → 推导 kind + 关键工件：

| 实录特征 | 推导 kind | 关键工件 |
|---------|----------|---------|
| ≥2 有序步骤 + 工件交接，无分叉/无人工闸门 | skill | `## 运行流程` + `## 运行指令` |
| ≥2 有序步骤 + 分叉/人工闸门/循环 | workflow | `workflow.yaml` steps(capId 引用) + checkpoint + vars |
| 持续角色 + 工具使用，无固定序列 | agent | `## 角色设定` + `## 工具集` + `## 边界` |
| 暴露操作/接数据 | mcp | `## 工具面` + `## 数据契约` + `## 异常处理` |

推导附理由，作者可否决改轻。workflow `step.capability` 必须引用已 staged+ 能力（R30）；内联新 prompt 的 workflow 视为反模式。

## 四象限业务语言对照表（C12）

作者说的情况 → 四象限映射。distiller 给象限默认值时附此例对，作者按场景匹配确认（非确认 enum）。R26 软检查关键词集合从本表派生：

| 作者说的（业务语言） | 象限 | source 允许 | expect 默认 | R26 关键词 |
|--------------------|------|------------|------------|-----------|
| 一切顺利、正常走完、成功 | positive | real / recalled（recalled 须 high|med） | contains | 正常、顺利、成功、positive |
| 数据有点特殊但还是要正常处理、极端、边界 | boundary | real / recalled | contains | 边界、极端、特殊、boundary |
| 不该做的直接挡回去、拒绝、非法、失败返回 | negative | real / recalled | llm_judge | 拒绝、不该、非法、负例、失败返回、negative |
| 上游挂了/数据源拿不到要降级不崩、兜底 | degradation | real / recalled | llm_judge | 降级、兜底、上游挂、degradation |

- staged 正例 `source` 必须 ∈ {real, recalled}（recalled 须 high|med）；`synthetic`/`llm_drafted_confirmed` 正例不进 staged（R26）。
- positive 禁 `exact`（除非带 `allow_exact_reason`）；negative/degradation 强制 `llm_judge`/`regex`（R28）。

## source / ref 规则

- `real`：可验证硬事实工件引用（文件路径/记录 ID/hash），R29 在 promote 时校验 ref 可解析（文件存在 OR ID/hash 格式 `^[a-zA-Z0-9_:-]{4,}$`）。
- `recalled`：作者凭回忆，无工件引用；须标 `confidence`（high/med/low），staged 正例 recalled 须 high|med。
- `llm_drafted_confirmed`：LLM 草拟、作者确认的样本，与 real 隔离，不进 staged 正例。
- `synthetic`：完全合成，只盖结构章，不进 staged 正例。

## 平台诚实分层

- **claude-code**：完整流水线可达（访谈→蒸馏→跑通🟢）。
- **Tier 2/3**（cursor/codex/cline/dify）：访谈员纯 prompt 脚本任意 LLM 可跑；蒸馏需 claude-code 侧代跑或作者手贴；跑通门 🔵 静态（HTTP/spawn runner 不发能力 body）。文档明写"完整流水线仅 claude-code 可用"。🔵 + 人工签字等价 🟢。

## 成本预估

- 访谈期 ~1 小时；蒸馏期 ~15 分钟；跑通门 ≥2 case + 最便宜 endpoint（约几块钱）；迭代期每次补一条几分钟。
- 跑通门 🟢 文案明示"cheapest endpoint 烟雾通过，未刻画部署模型行为"；staged 升级门票 = +1 次部署代表性模型跑。

## 升级门票（三态）

- draft = 结构绿 + 1 真例跑通（Tier 2/3 = 🔵 + 人工签字）。
- staged = 3 真例三象限皆真实（正例 source:real 或 recalled+med）+ 1 次部署代表性模型跑 + R16–R31 全绿 + security 绿；recalled+med 样本看板标"未硬验证"。
- formal = N 轮干净 + eval harness ≥阈值 + 平台矩阵。
