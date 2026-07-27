# 变更记录（仓库级）

每能力另有各自 `CHANGELOG.md`。本文件记录仓库级里程碑。

## [Phase 3.6] - 2026-07-24 - OpsForge-as-capability 自举 + 业务用户 UX shell

### 新增

- `tools/opsforge-bootstrap.mjs`：一次性 bootstrap，把 installer agent + runtime 装进目标平台 config dir（幂等、路径安全）
- `tools/opsforge-runtime.mjs`：薄 wrapper，`resolveWorkDir` 三级回退 + 动态 import 仓库根 `install.mjs`
- `packs/opsforge-meta/`：3 个 dogfood 能力（`agents/opsforge`、`agents/opsforge-installer`、`skills/opsforge-wizard`），经 `new-capability.mjs` scaffold
- 平台内安装入口：`@opsforge` / `@opsforge-wizard` 触发

### 变更

- `tools/opsforge.mjs`：顶层 6 选项中文菜单 / 5 步引导安装 / `discover` 读已装 manifest + 质量灯 + 商用标签 / `status` 渲染全 3 报告 / `feedback` 写 jsonl / `detectPlatform` 自动探测
- `install.mjs`：registry 回退（仓库 fresh > home 副本）；`ENOCAPSOURCE` error code
- `ci/guardrails.yml` + `CODEOWNERS`：覆盖 `packs/opsforge-meta/`

### 修复

- 审计 5 项偏差（cmdDiscover 读 registry→manifest / cmdStatus 三报告 / cmdWizard 回主菜单 / cmdInstall 硬编码→detect / stale 注释）
- e2e CRITICAL：runtime 副本相对 import 跑不起来 → 改 `.runtime-root.json` 动态 `pathToFileURL` import 仓库根
- feedback TTY 守卫拒管道 stdin → `makeAsker` 预读队列

### 测试

- 绿条 305 → 341（+36），6 道 gate 全绿，7 caps

## [Phase 1+2+3] - 已 SHIPPED

见 [`PROGRESS.md`](PROGRESS.md)。
