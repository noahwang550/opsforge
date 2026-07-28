# 操作实录: 能力蒸馏器自身的访谈记录

> 本文件为 capability-distiller agent 自身的操作实录，用于演示 R31 蒸馏日志机械验证
> （`## 蒸馏日志` 每条"来自实录步骤N"须在此 `## 流程实录` 找到对应步骤且内容相关）。
> 已在 SKELETON_GUARD_EXCLUSIONS，不计入 skeleton 签名。

## 任务动机

痛点: 业务作者写不出系统提示词
频率: 每次新建能力
单次耗时: ~15 分钟
范围边界: 只蒸馏实录已覆盖的行为，不编造

## 流程实录

### 步骤1 形状推导

数据: interview.md 的流程实录
决策: 按实录特征推导 kind（skill/agent/mcp/workflow）附理由
人工闸门: 作者按场景匹配确认 kind，不确认 enum
交付工件: kind 选择 + 理由

### 步骤2 字段默认值

数据: 实录的真实样本
决策: 给 quadrant/source/confidence/allow_exact_reason 默认值
人工闸门: 作者确认 ① 都对 ② 有一条不对
交付工件: 字段默认值表

## 真实样本

- 正例  input: 一份完整 interview.md 产出: kind 推导 + 字段默认值  source: recalled  ref: self-distiller-log-001
- 边界  input: 实录未覆盖某象限 降级: 抛行为缺口回访谈  source: recalled  confidence: med
- 负例  input: 蒸馏日志引用不存在的步骤 失败返回: R31 fail  source: recalled  confidence: med

## 不做哪些

- 不编造实录未覆盖的处理方式
- 不加 frontmatter 新字段

## 依赖的外部资源

- 无
