---
id: third-party.sy-automl-mcp
version: 0.1.0
kind: mcp
pack: third-party
owner: third-party
# customer: third-party
display_name: AutoML 建模连接器
display_name_zh: AutoML 建模连接器
display_name_en: AutoML MCP Connector
description: AutoGluon 自动建模 MCP 服务 — 数据加载、训练、预测、评估、模型管理全流程
platforms: [claude-code]
entrypoint: source.md
tests: tests/
changelog: CHANGELOG.md
transport: stdio
config_template:
  auth_schema: []
tools:
  - name: load_dataset
    description: 加载数据集（CSV 等表格数据）为 dataset_id，供后续训练 / 预测引用
    inputSchema:
      type: object
      properties:
        dataset_id:
          type: string
  - name: train_tabular
    description: 提交表格自动建模训练任务（后台异步执行），返回 task_id
    inputSchema:
      type: object
      properties:
        dataset_id:
          type: string
        target:
          type: string
  - name: predict_tabular
    description: 用已训练的表格模型对新数据做预测
    inputSchema:
      type: object
      properties:
        model_id:
          type: string
        dataset_id:
          type: string
  - name: get_task_status
    description: 查询后台训练任务进度与状态
    inputSchema:
      type: object
      properties:
        task_id:
          type: string
source:
  origin: forked
  upstream_ref: https://github.com/noahwang550/sy-automl-mcp
---
<!-- 业务作者在此写 mcp 说明 body。 -->
<!-- 能力清单与 opsforge discover --all 从下方两个 H2 章节抽取说明与场景，务必填写。 -->
## 能力说明

把开源 AutoML 引擎 AutoGluon 封装成标准 MCP 服务：业务侧不用写模型代码，给出表格 / 时间序列 / 多模态数据，即可完成数据加载 → 自动训练 → 预测 → 评估 → 模型管理全流程。训练在后台任务中执行，可随时查询进度与取消。上游仓库：https://github.com/noahwang550/sy-automl-mcp（Apache-2.0，vendored 收录）。

## 适用场景

- 业务运营有一张 CSV 表格，想快速得到一个可用的预测模型（如销量预测、流失预测）。
- 时间序列预测：按周 / 月预测指标走势，不需要自己调参。
- 模型生命周期管理：查看模型排行榜、特征重要性、评估指标，按需加载或删除模型。

## 工具面

- 数据：load_dataset / validate_dataset（加载并校验数据集）。
- 表格建模：train_tabular / predict_tabular / leaderboard_tabular / feature_importance_tabular / fit_summary_tabular / evaluate_tabular。
- 时间序列：train_timeseries / predict_timeseries / leaderboard_timeseries / evaluate_timeseries / fit_summary_timeseries。
- 多模态：train_multimodal / predict_multimodal / evaluate_multimodal。
- 模型管理：list_models / model_info / load_model / delete_model。
- 后台任务：get_task_status / get_task_result / cancel_task / list_tasks。

## 数据契约

- 输入：表格数据（CSV 等）、目标列名、可选训练参数；多模态场景的图片路径须位于服务端 artifacts 目录内。
- 输出：统一 {success, data, error} 信封；训练类调用返回 task_id，轮询 get_task_status 获取进度与结果。

## 异常处理

- 所有工具异常均收敛为统一错误信封，不回显内部堆栈；任务过期 / 不存在会明确返回 "Task expired or not found"。
- 训练任务为后台异步执行，客户端断连不影响任务；可 cancel_task 主动取消。

## 依赖

- Docker 运行环境（AutoGluon 官方仅支持 Linux/macOS；Windows 宿主经 Docker Desktop 运行）。
- 预构建镜像：ghcr.io/noahwang550/sy-automl-mcp:tabular（CPU 即可）/ :full（含时序 + 多模态，建议 GPU）。

## 运行指令

前提：本机装好 Docker（Windows 用 Docker Desktop），因为 AutoGluon 引擎只支持 Linux/macOS，原生 Windows 直跑不稳定。

1. 拉取并启动服务（CPU 即可，表格建模档）：

   docker run -i --rm -v "$PWD/artifacts:/app/artifacts" ghcr.io/noahwang550/sy-automl-mcp:tabular

2. 需要时间序列或多模态能力时改用 :full 镜像（建议 GPU）：

   docker run --gpus all -i --rm -v "$PWD/artifacts:/app/artifacts" ghcr.io/noahwang550/sy-automl-mcp:full

3. 默认走 stdio 接入平台（无需鉴权）；改用 HTTP 方式时设置 MCP_TRANSPORT=http 与 MCP_API_TOKEN 做 Bearer 鉴权。

4. 数据与模型产物都落在挂载的 artifacts 目录里；Windows Git Bash 下若路径被自动转换，加 MSYS_NO_PATHCONV=1 前缀。

## 蒸馏日志

- 收录时依据上游 README 与 server.py 工具清单整理：24 个工具分 6 组（数据 / 表格 / 时序 / 多模态 / 模型管理 / 后台任务），HTTP 传输支持 Bearer token 鉴权（MCP_API_TOKEN），stdio 默认无鉴权。
