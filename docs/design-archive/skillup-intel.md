# skill-up 深度情报（fetched 2026-07-27）

> 供 Phase 4 融合方案设计用。来源：alibaba/skill-up repo raw 文件 + README。本文件是研究情报，非最终设计。

## 0. 一句话定位

skill-up = Go CLI（Apache-2.0）+ skill-upper Agent Skill（驱动 CLI 的对话式 agent）。两大支柱：声明式 eval 跨多 engine 跑 + "失败→修复→回归→重跑"演进闭环。

## 1. skill-upper Agent 8 步工作流（SKILL.md 摘要）

- **Step 0 安装校验**：`command -v skill-up && skill-up --version`；macOS/Linux curl 管道安装；**Windows 不支持**。
- **Step 0.5 配置**：`skill-up init`（`--local`/`--print`/`--force`）；优先级：内嵌默认 < user config < 项目 `.skill-up.yaml` < `--config`。
- **Step 1 定位 Skill**：找含 `SKILL.md` 的目录；若 `eval.yaml` 存在跳 Step 4；若只有 `evals.json` 走迁移；无则 Step 2。
- **Step 2 脚手架 evals**：从 `assets/eval.yaml.tmpl` + `assets/case.yaml.tmpl` 复制进 `evals/`。选型：`environment.type`（`none`/`opensandbox`）、`engine.name`（默认 `claude_code`，也支持 `qodercli`）、`judge.type`（`rule_based` 优先 > `script` > `agent_judge`）。
- **Step 3 填用例**：`skill-up list-cases` 审查，在 `cases/` 增改 yaml。
- **Step 4 校验**：`skill-up validate <path>/evals/eval.yaml`。
- **Step 5 凭据**：检查 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`QODER_PERSONAL_ACCESS_TOKEN`/`OPENSANDBOX_API_KEY`；缺失则停下问，**未经同意不写 secret 入 yaml**。
- **Step 6 运行**：`skill-up run <path>/evals/eval.yaml`；flags：`--include-case-name`/`--exclude-case-name`/`--format html`/`--auto`（Anthropic JSON）/`--iteration N`/`-v -vv`；exit 0=全过，1=有失败。
- **Step 7 解读报告**：读 `<skill-root>/<skill-name>-workspace/iteration-N/` 下 `result.json`/`benchmark.json`/`report.html`/per-case `grading.json`；汇总通过率/耗时/失败证据/benchmark delta。
- **Step 8 演进（仅按需）**：仅当用户明确要求修/迭代才进。诊断 `result.json`/`grading.json` → 修 `SKILL.md` 或支撑文件 → 补/精炼 eval 用例覆盖缺口 → **绝不弱化有效断言强行通过** → 先重跑失败用例（`--include-case-name`）再全量 → 迭代直到通过或报告阻塞。

### 失败诊断与用例修复（关键细节）

- 失败读自 per-case `grading.json`（在 `with_skill/grading.json`）+ 聚合 `result.json`。
- `grading.json` 含 assertion `text` + `evidence` 字段定位失败点。
- 修复循环**不弱化断言**——而是修 Skill 实际行为或补覆盖缺口。
- 失败用例先 `--include-case-name` 单跑，再全量重跑。

### skill-upper 目录结构

`skills/skill-upper/`：`SKILL.md` + `README.md` + `README.zh.md` + `assets/`（模板）+ `evals/`（自评用例）+ `references/`（install.md / eval-yaml.md / case-yaml.md / judge-types.md / cli.md / migrate-anthropic.md）。

## 2. eval.yaml 字段参考（schema_version: v1alpha1）

顶层 keys：`schema_version` / `environment` / `mcp` / `skills` / `engine` / `cases` / `judge` / `benchmark` / `report`。

```yaml
schema_version: v1alpha1
environment:
  type: none  # none | opensandbox | docker
mcp:
  servers:
    - name: github
      mode: real
      transport: http  # http | stdio
      config_ref: evals/fixtures/mcp/github.yaml
skills:
  - source: local_path
    path: .
engine:
  name: claude_code  # claude_code | codex | qodercli
  model:
    provider: anthropic
    name: claude-sonnet-4-6
    base_url: ""
cases:
  files: [evals/cases/a.yaml]
  defaults:
    timeout_seconds: 300
    max_turns: 12
    collect_artifacts: ["**/*.json", "report/**"]
  parallelism: 2
  retry_policy:
    max_retries: 1
    retry_on: [timeout, error]
judge:
  type: agent_judge
  model: anthropic-sonnet-4-6
  skills:
    - source: local_path
      path: evals/fixtures/judge-rubric
  criteria: ["judge-rubric scoring criteria"]
benchmark:
  enabled: false
report:
  formats: [json, html]
  artifacts: [transcript]
```

### environment.type

| type | 用途 | 备注 |
|---|---|---|
| `none` | 纯文本 I/O，无沙箱 | 冷启动最快 |
| `opensandbox` | 远程沙箱（文件/命令执行） | 需 `OPENSANDBOX_API_KEY`；base_url 经 `environment.kwargs` 或 env 配 |
| `docker` | 本地容器隔离 | 需本地 `docker` CLI + daemon；镜像预拉 |

### MCP

- `mode: real` 装真实 MCP 进 Agent；`mode: mocked` 仅 case 级 fixture 切换。
- HTTP MCP 可 inline 或 `config_ref` 指 fixture；stdio 支持 `command`/`args`。
- env 引用 `${VAR}` 或整值 `$VAR`；`required_env` 注入 Agent 环境。
- Eval 级 `mcp` 提供默认；case 级可声明自己的 `mcp.servers`（仅 `mode: mocked`）覆盖同名 server。

### engine.kwargs

string kv，agent 各取所需，未知键忽略。`bypass_sandbox`：codex=true 强制 `--dangerously-bypass-approvals-and-sandbox`；claude_code/qodercli=no-op。CLI：`--engine-kwarg key=value`（`--ek`）可重复。优先级 `--engine-kwarg` > `engine.kwargs` > 默认。

### cases

- `cases.files` 用例文件列表；`cases.defaults.timeout_seconds`（默认 300）；`max_turns`（默认 12）。
- `collect_artifacts` doublestar glob（`*` 单层，`**` 跨目录），匹配文件保留相对路径下载到 `<output-dir>/<case>/<config>/outputs/workspace/`；defaults 级与 case 级 union 去重。
- `cases.parallelism` 可被 `--parallelism N`（1–256）覆盖。
- `cases.retry_policy.max_retries` + `retry_on: [timeout, error]`。

### judge

- `judge.type: agent_judge`（eval 级默认 judge）。
- `judge.skills`：仅 `agent_judge` 有效；给 judge agent 装可复用评分 Rubric Skill，**不装进被测 run agent**；benchmark 下 with/without 都装 judge Skills。
- `judge.criteria`：评判标准字符串列表。
- Skill 文件内容不应重复进 `criteria`。

### report

- `report.formats`：`json`/`html`；`report.artifacts`：如 `transcript`。

## 3. case.yaml 字段参考（evals/cases/*.yaml）

case ID = 文件名去 `.yaml`。

### 单轮骨架

- `id` / `title` / `description`。
- `input.prompt`：发给 skill 的文本提示。
- `context`：`repo_fixture`（fixture repo 路径）/ `git`（`init`/`checkout`/`apply_diff`/`remotes[]`）/ `files`（path→content 内联建文件）。
- `constraints`：`timeout_seconds` / `max_turns`。

### expect（零成本前置门，失败则跳 judge）

- `must_contain`[] / `must_not_contain`[] / `exit_code` / `files_exist`[] / `files_not_exist`[]。
- 用途："快速过滤明显不合格输出"，省 token。

### judge.rule_based

- `success`[]（全过才 PASS）：`output_contains`（`all`/`any`/`not`）/ `exit_code` / `tool_called`（`name`+`args`）/ `files_exist` / `files_not_exist`。
- `failure`[]（任一命中立即 FAIL，先评估）：同上 matcher。
- 多轮额外：`turn_response_contains`（`turn`+`contains_any`）/ `turn_response_not_contains` / `tool_called_in_turn` / `tool_not_called_in_turn`。仅 `status=completed` 的 turn 可断言。

### judge.script

- `script_path` + `timeout_seconds`；exit 0=PASS，非零=FAIL；从 case workspace root 跑。
- env：`$EVAL_FINAL_MESSAGE` / `$EVAL_EXIT_CODE` / `$EVAL_TRANSCRIPT_PATH`。

### judge.agent_judge

- `model` / `skills`[] / `criteria`[] / `pass_threshold`（如 0.7）。
- LLM agent 按 `criteria` 评分，达 `pass_threshold` 则 PASS。
- 贵且慢；确定性条件先用 `rule_based`/`expect` 过滤。

### 多轮 input.turns

- 每轮 `role`/`content`（支持 `{{variable}}` 模板替换）。
- `post_condition`：`must_contain_any`[] + `on_fail`（`skip_remaining` 标 SKIP 或 `fail` 全 case 失败）。
- `capture`：`variable` + `pattern`（regex，推荐 `(?P<value>...)`）或 `jsonpath`（二选一）；未匹配/空推 case 入 ERROR；作用域限当前 case 执行。

### 成本对比

| 类型 | 相对成本 | 何时选 |
|---|---|---|
| expect | 0 | 永远先前置过滤 |
| rule_based | 极低 | 默认首选 |
| script | 低 | 灵活自定义逻辑 |
| agent_judge | 高 | 仅需语义理解时 |

## 4. CI Action（action.yml）

- Docker container action（`using: docker`），image `ghcr.io/alibaba/skill-up-runner@sha256:f90aa1a3...`（预装 skill-up + 4 engine CLI）。
- 11 inputs：`engine`（claude_code/codex/qodercli/qwen_code）/`model`/`provider`/`api-key`/`base-url`/`open-sandbox-api-key`/`skill-target`/`skill-up-version`（默认 0.7.0）/`skill-up-command`（默认 `skill-up run`）/`parallelism`/`agent-install-command`。
- 2 outputs：`exit-code`（0=全过）/`report-dir`。
- 需 Linux runner + model secrets。

## 5. 与 OpsForge v8 的关键对照点（planner 已有初评，此处补深度）

| skill-up 概念 | OpsForge v8 对应 / 差异 |
|---|---|
| `eval.yaml`（schema_version v1alpha1）| 我们无 eval.yaml；用 `tests/*.yaml` + `schema/test-case.schema.json`（7 字段 additionalProperties:false）。case 无 `environment`/`mcp`/`engine`/`cases.defaults` 概念——这些在我们里是 adapter 层 + `eval.config.yaml`。 |
| `expect` 零成本前置门 | 我们无独立"前置门"层；`exact`/`contains`/`regex` expect 模式即低成本断言，但无"expect 失败跳 judge"的两段优化。 |
| `rule_based`（success+failure matcher） | 我们 `exact`/`contains`/`regex`/`schema`/`golden` 覆盖；无 `tool_called`/`files_exist` 类结构化断言。 |
| `script`（外部脚本打分） | 我们**无且不应有**——违反"贡献者只写 .md/.yaml/.json"纪律。 |
| `agent_judge`（criteria + pass_threshold） | 我们 `llm_judge` + `judge-prompt.md`（5-axis rubric + 反注入）；我们更强在多轴+安全 axis，弱在无 `pass_threshold` 数值阈值（用 overall 加权裁决替代）。 |
| 多轮 turns + capture + post_condition | 我们 test-case schema 无多轮/捕获/模板替换——**这是 skill-up 独有能力，可考虑吸收**。 |
| `environment: opensandbox/docker` | 我们无沙箱执行环境——Tier-2/3 经 adapter HTTP endpoint，不跑真实 sandbox。 |
| benchmark（with/without skill 对照） | 我们无 benchmark 对照——`eval.mjs` 只评 skill 本身，不评"装 vs 不装"delta。**可考虑吸收**。 |
| skill-upper 8 步 agent | 我们有 `opsforge` agent + `opsforge-wizard` skill，但无"评测→诊断→补回归用例→重跑"自动闭环——**这是 Phase 4 核心缺口**。 |
| `skill-up import evals.json`（Anthropic 标准） | 我们无 evals.json 桥接——**生态对接面，Slice 2**。 |
| CI Docker action + model secrets | 我们 `.github/workflows/` 零 secret static-only——**不兼容**。 |
| 工作区 `<skill>-workspace/iteration-N/` | 我们 `~/.opsforge/runs/<eval-id>/results.json` + `~/.opsforge/eval-history/`——双轨分裂风险。 |
| `--iteration N` 语义（0 追加，N 跑 N 轮） | 我们无 iteration 概念。 |

## 6. 上一轮 planner 初评结论（供深化参考，不要照搬）

- 不引入 skill-up Go 二进制（违反 §C.1 一种语言 + AGENTS.md #5 不引新依赖 + guardrails.yml path-guard）。
- 推荐方案 A（内化回归闭环思想）+ D（evals.json 桥接），落 Phase 4。
- skill-up 真正补强：(1) 失败→自动沉淀回归用例闭环；(2) 多 engine eval 横跑；(3) Anthropic evals.json 兼容。
- MVP 切片：Slice 1 `regression-sink.mjs` + `opsforge evolve`；Slice 2 `export-evals.mjs`；Slice 3 多 engine eval（不引 skill-up）。
- 关键约束：草稿必须经 `--promote` 人工 gate；自动沉淀"用例骨架"不沉淀"断言"（保留 R18 反空洞）。

## 7. 本轮深化要求（planner 必须超越初评）

- 基于上面的 schema 细节（eval.yaml/case.yaml/3 judge/多轮 capture/benchmark）重新评估：哪些 skill-up 概念**之前漏了**值得吸收？（多轮 turns+capture？benchmark with/without delta？expect 两段门？`tool_called`/`files_exist` 结构化断言？）
- 对每个候选吸收点：给出**落点文件 + schema 改动 + 是否破 additionalProperties:false + 对三态/R16-R22/release gate 的影响 + 对非技术贡献者的影响**。
- 产出详细方案文档，供 architect 直接据以设计。
