# 操作实录: <工作名>

> 本模板由 `templates/interview-record.md` 提供，落 `_drafts/<slug>/interview.md`（已在
> SKELETON_GUARD_EXCLUSIONS，不计入 skeleton 签名）。由 capability-interviewer
> （LLM 填框架+草稿、作者审核确认 propose_and_confirm）产出，供 capability-distiller
> 蒸馏。数据不进会话：涉真实数据一律给文件路径/生成测试数据/规避 PII 的 schema，不贴原值。

## 任务动机

痛点: __FILL_ME__
频率: __FILL_ME__
单次耗时: __FILL_ME__
范围边界: __FILL_ME__

## 流程实录

### 步骤1 <动作>
数据: <文件路径/测试数据生成方式/规避PII的schema，不贴原值>
决策: __FILL_ME__
人工闸门: __FILL_ME__
交付工件: __FILL_ME__

### 步骤2 <动作>
数据: __FILL_ME__
决策: __FILL_ME__
交付工件: __FILL_ME__

## 真实样本

> interviewer 先草拟，作者确认（propose_and_confirm）。`source: real` 须带可解析 `ref`
> （文件路径/记录 ID/hash），R29 在 promote 时校验；`llm_drafted_confirmed` 隔离 LLM 草拟
> 样本，不进 staged 正例；`recalled` 须标 `confidence`。

- 正例  input: <草稿> 产出: <草稿>  source: real|llm_drafted_confirmed|recalled|synthetic  ref: <可验证工件路径/ID，real 必填>
- 边界  input: <草稿> 降级/产出: ...  source: real|recalled  confidence: high|med|low
- 负例  input: <草稿> 失败返回: ...  source: real|recalled  confidence: high|med|low

## 不做哪些

- __FILL_ME__

## 依赖的外部资源

> 数据源/MCP/前置能力 capId（形如 `<pack>.<name>@<version>`）。

- __FILL_ME__
