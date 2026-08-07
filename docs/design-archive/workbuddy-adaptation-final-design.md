# OpsForge × WorkBuddy 适配 + 平台自动探测 最终设计方案

> 本方案汇总两轮 planner 结论，并合并"平台自动探测"新需求。所有结论已对照真实代码库校验。
> 当前基线：bare `node --test` 615/0，6 gates 全绿（14 capabilities），10 条硬不变量全守。

---

## 一、方案总览

把 WorkBuddy 作为 OpsForge 第 6 个平台适配器落地，同时把 `detectPlatform()` 从 `opsforge.mjs` 抽到 `tools/paths.mjs` 并接入 `install.mjs` CLI——让用户**不传 `--platform` 也能自动探测**目标平台，减少安装调改。WorkBuddy 加入探测表后自动被识别。

```
adapters/workbuddy/                 ← 新增（platform.yaml + adapter.mjs + adapter.test.mjs + README.md）
tools/paths.mjs                     ← 修改：抽入 detectPlatform + PLATFORM_DIRS 数据驱动表 + platformInstallDir/mcpConfigPathFor
install.mjs                         ← 修改：getAdapter 加 workbuddy + --platform 改可选走 detectPlatform + doctor/repair 去硬编码 + workflow 覆盖条件化
tools/opsforge.mjs                  ← 修改：detectPlatform 改 re-export paths.mjs（向后兼容）
tools/validate.mjs                  ← 修改：KNOWN_PLATFORMS 加 workbuddy + 预加载
.github/workflows/validate.yml      ← 修改：doctor-matrix 加 workbuddy
schema/platform.schema.json         ← 不动（WorkBuddy 字段全在现有 schema 内，additionalProperties:false 保留）
registry*.yaml                      ← 不动（auto-gen，与平台无关）
CODEOWNERS / guardrails.yml         ← 不动（adapters/** 已覆盖）
adapters/workbuddy/adapter.test.mjs ← 新增测试
install.cli.test.mjs                ← 修改：加自动探测 CLI spawn 测试
```

**Tier 判定**：WorkBuddy = **Tier 2**（`base.mjs:81` tier() 要求 Tier1 点 6 个全 supported；WorkBuddy agent_file=false → Tier2，与 cline/codex 同档但覆盖面更广，多 skill_file+slash_command）。

**能力映射**：agent→skill（cli-engine 降级，优于 cline 的 manual-paste）/ skill→skill 原样 / mcp→`~/.workbuddy/mcp.json` 合并 / workflow→引导式 skill（需 S5 修 install.mjs workflow 覆盖条件化）。

---

## 二、平台自动探测设计（新需求专章）

### 2.1 现状缺口（真实代码校验）

- `tools/opsforge.mjs:102-115` `detectPlatform()` 已存在，但**硬编码 5 个平台目录**，不识别 workbuddy；且在 `opsforge.mjs` 内，`install.mjs` 无法静态 import（`opsforge.mjs` 动态 `import('../install.mjs')`，反向静态 import 会成循环依赖）。
- `install.mjs` CLI `main()` 的 `--platform` 在 6 处分支（841/855/869/879/886/936）**全部默认 `'claude-code'`**，**完全不调 detectPlatform** → 用户不传 `--platform` 就硬装到 claude-code，这是"安装调改"的根因。

### 2.2 抽取 + 数据驱动设计

把 detect 逻辑抽到 `tools/paths.mjs`（install.mjs 已 import 它），新增：

```js
// tools/paths.mjs
// 平台 → 安装根目录名 的单一真相源。加新平台只加一行。
export const PLATFORM_DIRS = {
  'claude-code': '.claude',
  'cursor': '.cursor',
  'codex': '.codex',
  'cline': '.cline',
  'dify': '.dify',
  'workbuddy': '.workbuddy',   // ← 新增
};
// MCP 配置文件相对 home 的路径
export const PLATFORM_MCP_PATHS = {
  'claude-code': '.claude.json',
  'cursor': '.cursor/mcp.json',
  'codex': '.codex/config.json',
  'cline': '.cline/mcp_settings.json',
  'dify': null,                 // dify 无本地 mcp 配置
  'workbuddy': '.workbuddy/mcp.json',
};

export function platformInstallDir(platform) {
  const sub = PLATFORM_DIRS[platform];
  return sub ? path.join(resolveHome(), sub) : null;
}
export function mcpConfigPathFor(platform) {
  const sub = PLATFORM_MCP_PATHS[platform];
  return sub ? path.join(resolveHome(), sub) : null;
}

/**
 * detectPlatform(opts) — 自动探测目标平台。
 * 优先级：OPSFORGE_PLATFORM env > 已装平台首个（按 PLATFORM_DIRS 顺序）> claude-code 默认。
 * 遍历 PLATFORM_DIRS，返回首个 ~/.<dir> 存在的平台；均不中则默认 claude-code。
 * 多平台命中时按 PLATFORM_DIRS 定义顺序（Tier1 平台在前）取首个，并返回 detectedAll 供调用方提示。
 */
export function detectPlatform(opts = {}) {
  if (process.env.OPSFORGE_PLATFORM) return process.env.OPSFORGE_PLATFORM;
  const home = opts.opsforgeHome || resolveHome();
  for (const [p, sub] of Object.entries(PLATFORM_DIRS)) {
    if (fs.existsSync(path.join(home, sub))) return p;
  }
  return 'claude-code';
}
/** 返回所有已探测到的平台（多平台场景供业务话提示）。 */
export function detectAllPlatforms(opts = {}) {
  const home = opts.opsforgeHome || resolveHome();
  const out = [];
  for (const [p, sub] of Object.entries(PLATFORM_DIRS)) {
    if (fs.existsSync(path.join(home, sub))) out.push(p);
  }
  return out;
}
```

`tools/opsforge.mjs` 原有 `detectPlatform` 改为 re-export 保持向后兼容：

```js
// tools/opsforge.mjs
export { detectPlatform, detectAllPlatforms } from './paths.mjs';
```

### 2.3 install.mjs CLI 接入

`main()` 6 处分支的 `--platform` 默认值，从 `'claude-code'` 改为统一 helper：

```js
// install.mjs CLI main()
function resolvePlatform(argv, opts = {}) {
  if (argv.includes('--platform')) return argv[argv.indexOf('--platform') + 1];
  return detectPlatform(opts);   // 自动探测（含 OPSFORGE_PLATFORM env）
}
```

每个分支 `const platform = resolvePlatform(argv);`。当自动探测命中多平台时，打印业务话提示：

```
检测到多个 AI 助手平台已安装：claude-code、workbuddy。默认安装到 claude-code。
如需指定其他平台，请用 --platform <平台名>。
```

零平台时（`detectAllPlatforms()` 返回空且无 env）：

```
未检测到已安装的 AI 助手平台。请用 --platform <平台名> 指定目标平台。
可选平台：claude-code / cursor / codex / cline / dify / workbuddy
```

### 2.4 能力 platforms 路由提示

install 时，若探测到平台 X，但能力 `capability.yaml` 的 `platforms` 字段非空且不含 X：

```
本能力不支持 workbuddy 平台。支持的平台：<列表>。
```

`platforms` 为空/缺失 = 全平台（不阻断）。

### 2.5 文案守则（WC 可执行断言，守 wording-rules-need-executable-assertions）

- **WC8**：自动探测提示文案无技术词（不出现 `detectPlatform`/`PLATFORM_DIRS`/`fs` 等）。
- **WC9**：多平台提示用业务话（"检测到多个 AI 助手平台已安装"而非"detected multiple platforms"）。
- **WC10**：零平台提示引导用户（列出可选平台，不报 stack trace）。

### 2.6 不变量守卫

- 零新依赖：只读 `fs.existsSync`，无网络无 spawn。
- Windows argv：无 spawn 调用。
- SSRF：不涉（无 fetch）。
- test-cli-argv-path：必须有 CLI spawn 测试覆盖"不传 --platform 的自动探测"路径。
- eval static-only / 不 live spawn claude：自动探测单测用 `OPSFORGE_HOME=<tmp>` fixture，不调 claude。

---

## 三、草案纠偏清单（11 处，精简）

| # | 草案 | 真实代码 | 正确做法 |
|---|------|---------|---------|
| 1 | Tier 1 | base.mjs:81 Tier1 要 6 点全 supported | **Tier 2** |
| 2 | `model_registration: optional` | 5 个现有 yaml 全没设 | 删 |
| 3 | `compliance_tags: []` | 国产平台应触发 data-residency-cn | `[data-residency-cn]` |
| 4 | 测试断言 tier=1 | 同 #1 | tier=2 |
| 5 | `test/adapters/workbuddy.test.mjs` | 约定 `adapters/<p>/adapter.test.mjs` | 改路径 |
| 6 | 自制 `_workbuddyDir()` | paths.mjs `resolveHome()` 支持 OPSFORGE_HOME 隔离 | 用 resolveHome |
| 7 | mcp case `mcpConfig:null` | cline 返真实 `{servers:{}}` | mcpConfig=null（install.mjs 不消费 translate 的 mcpConfig 死字段；跨平台同源死字段见 code-reviewer 观察 A，独立 PR 处理） |
| 8 | 自建 `_buildWorkflowSkill` | install.mjs:337 无条件用 workflow-compile 覆盖 | workflow case `return []` + S5 条件化 |
| 9 | MCP source.md 是 WorkBuddy 独有问题 | 全平台共有 | 照抄同侪，P2 横切 |
| 10 | `_findRepoRoot` | install 层已传 cap.dir | 删 |
| 11 | doctor 只改路径 | 路径+文案双重硬编码 | 集中 `platformInstallDir/mcpConfigPathFor` |

---

## 四、分 Slice 实施步骤（绿到绿）

### S1：platform.yaml（P0）

**文件**：新建 `adapters/workbuddy/platform.yaml`

```yaml
platform: workbuddy
display_name: WorkBuddy
display_name_zh: WorkBuddy
capability_points:
  prompt_exec:
    supported: true
    mode: cli
  agent_file:
    supported: false
    fallback: cli-engine
  skill_file:
    supported: true
  slash_command:
    supported: true
  mcp_config:
    supported: true
  workflow_orchestration:
    supported: false
    fallback: cli-engine
  config_dir_writable:
    supported: true
  kb_mount:
    supported: false
    fallback: manual-paste
  feedback_hook:
    supported: false
    fallback: manual-paste
locale: zh-CN
compliance_tags: [data-residency-cn]
verified_by: steering
```

**验收**：`node -e` ajv 校验 yaml 过 platform.schema.json。**预期测试数**：615。

### S2：paths.mjs 抽入 detectPlatform + PLATFORM_DIRS（P0，新需求核心）

**文件**：修改 `tools/paths.mjs`（加 PLATFORM_DIRS/PLATFORM_MCP_PATHS/platformInstallDir/mcpConfigPathFor/detectPlatform/detectAllPlatforms）；修改 `tools/opsforge.mjs`（detectPlatform 改 re-export）。

**测试切片**（新 `tools/paths.platform.test.mjs` 或加到现有 paths 测试，+6）：
- PD1 PLATFORM_DIRS 含 workbuddy
- PD2 detectPlatform 单平台命中返回该平台
- PD3 detectPlatform 多平台命中返回首个（按表顺序）
- PD4 detectPlatform 零平台返回 claude-code 默认
- PD5 OPSFORGE_PLATFORM env 优先于目录探测
- PD6 platformInstallDir/mcpConfigPathFor 返回正确路径

**预期测试数**：615 → **621**。

### S3：install.mjs getAdapter + doctor/repair 去硬编码 + --platform 自动探测（P0）

**文件**：修改 `install.mjs`（getAdapter 加 workbuddy；6 处 `--platform` 默认改 `resolvePlatform(argv)` 调 detectPlatform；doctor/repair 用 `platformInstallDir/mcpConfigPathFor`；多平台/零平台业务话提示）。

**测试切片**（+5）：
- DP1 doctor workbuddy healthy when ~/.workbuddy 存在
- DP2 doctor workbuddy platform_writable issue when ~/.workbuddy 缺失
- DP3 doctor workbuddy mcp_missing when mcp.json 缺 key
- AP1 install 不传 --platform 时自动探测到平台（OPSFORGE_HOME fixture 造 ~/.workbuddy/）
- AP2 install 多平台时打印业务话提示（WC9 断言）

**预期测试数**：621 → **626**。

### S4：adapter.mjs + adapter.test.mjs + README.md（P0）

**文件**：新建 `adapters/workbuddy/{adapter.mjs,adapter.test.mjs,README.md}`。

**关键决策**：用 `resolveHome`；translate 返回形状对齐 cline；mcp case `mcpConfig=null`（install.mjs 不消费 translate 的 mcpConfig 死字段；跨平台同源死字段见 code-reviewer 观察 A，独立 PR 处理）；workflow case `return []`；删 `_findRepoRoot`；injectMcp 照抄同侪 entrypoint=source.md；skill 落 `~/.workbuddy/skills/opsforge-<name>/SKILL.md`；MCP key `opsforge-<name>`；conform 继承 BaseAdapter 默认（requires:hard agent_file 走 --downgrade）。

**测试切片**（+13，WB1-WB13）：
- WB1 tier()=2 / WB2 supports() 能力点 / WB3 conform 通过无 requires:hard / WB4 conform fail requires:hard / WB5 translate agent→skill-file / WB6 translate skill→skill / WB7 translate mcp→mcp-config-merge mcpConfig=null / WB8 translate workflow→[] / WB9 install 写 skill 跳 mcp-config-merge / WB10 injectMcp 合并 mcp.json / WB11 uninstall 删 skill+mcp key / WB12 detect / WB13 agent SKILL.md 有 WorkBuddy frontmatter

**预期测试数**：626 → **639**。

### S5：validate.mjs KNOWN_PLATFORMS + 预加载（P0）

**文件**：修改 `tools/validate.mjs`（KNOWN_PLATFORMS Set 加 workbuddy；预加载块加 workbuddy try import）。

**测试**（+1）：VP1 `validate --all` 仍全绿（14 cap platform_conformance 不报 workbuddy unknown）。

**预期测试数**：639 → **640**。

### S6：install.mjs workflow 覆盖条件化（P1）

**文件**：修改 `install.mjs:337`（`if (kind==='workflow' && adapter.supports('workflow_orchestration').supported)` 才走 compile()，否则用 adapter.translate 返回）；修改 `adapters/workbuddy/adapter.mjs` workflow case 恢复 `_buildWorkflowSkill` 落引导式 skill。

**测试**（+2）：WF1 install workflow→workbuddy 落引导式 skill / WF2 install workflow→cline 走 manual-paste 回归。

**预期测试数**：640 → **642**。

### S7：CLI argv spawn 测试（P0，守 test-cli-argv-path）

**文件**：修改 `install.cli.test.mjs`。

**测试**（+2）：CLI1 `node install.mjs --install <cap> --platform workbuddy --dry-run` exit 0 / CLI2 `node install.mjs --doctor --platform workbuddy` exit 0 或 healthy。

**预期测试数**：642 → **644**。

### S8：CI matrix + README + WC 断言（P1）

**文件**：修改 `.github/workflows/validate.yml`（matrix 加 workbuddy）；补 `adapters/workbuddy/README.md`；加 WC8-WC10 文案断言到 `tools/opsforge-wording.test.mjs`。

**预期测试数**：644 → **647**（WC +3）。

### S9：废弃临时脚本（P2）

**文件**：删除 `opsforge-to-workbuddy.mjs`（先 grep 确认存在与引用）；归档设计文档。

**预期测试数**：647。

---

## 五、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| S6 改 workflow 覆盖影响 cline/codex/dify | 中 | S6 先 grep 现有测试是否硬断言 ~/.claude/commands/workflow-；有则一并更新；退路：S6 只对 workbuddy 生效 |
| 草案 Tier 误判渗透文案 | 低 | S1/S4/S8 文案全改 Tier 2，WB1 断言 |
| MCP entrypoint=source.md 不可执行 | 中 | 照抄同侪，P2 横切，README 注明示例性 |
| opsforge.mjs re-export 破坏现有调用 | 低 | re-export 保持 `detectPlatform` 签名不变，现有调用点零改动 |
| 自动探测在 CI 无任何平台目录 | 无 | CI 显式传 `--platform`，detect 路径不触发 |
| PLATFORM_DIRS 漏平台 | 低 | 单一真相源，加平台只加一行 |

---

## 六、检查清单

**P0**：S1 platform.yaml / S2 paths.mjs detectPlatform 抽取+6 测试 / S3 install.mjs --platform 自动探测+5 测试 / S4 adapter.mjs+13 测试 / S5 validate.mjs+1 / S7 CLI spawn+2 / 6 gates 全绿 / 10 条硬不变量全守。

**P1**：S6 workflow 覆盖条件化+2 / S8 CI matrix+README+WC3。

**P2**：S9 废弃临时脚本 / MCP entrypoint 横切 / 逐 cap 加 platforms:workbuddy / --profile 批量验证。

---

## 七、预期 bare `node --test` 曲线

| slice | 新增 | 累计 | 6 gates |
|-------|------|------|---------|
| 基线 | — | 615 | 全绿 |
| S1 | 0 | 615 | 全绿 |
| S2 | +6 | 621 | 全绿 |
| S3 | +5 | 626 | 全绿 |
| S4 | +13 | 639 | 全绿 |
| S5 | +1 | 640 | 全绿 |
| S6 (P1) | +2 | 642 | 全绿 |
| S7 | +2 | 644 | 全绿 |
| S8 (P1) | +3 | 647 | 全绿 |
| S9 (P2) | 0 | 647 | 全绿 |

**终态**：647/0 bare `node --test`，6 gates 全绿，14 capabilities 不变，第 6 个平台适配器 workbuddy（Tier 2）原生落地 + 平台自动探测让 `node install.mjs --install <cap>` 不传 `--platform` 也能自动装对平台。

---

## 八、相关文件绝对路径

- 草案：`D:\XD\ClaudeCode\sy-eeo\workbuddy-adaptation.md`
- 真实校验代码：
  - `adapters/base.mjs`（tier() line 81-93）
  - `adapters/{claude-code,cline,codex,dify}/adapter.mjs` + `platform.yaml`
  - `schema/platform.schema.json`（additionalProperties:false）
  - `install.mjs`（getAdapter line 242-257、install line 277、doctor 574-628、repair 743-784、workflow 覆盖 337-345、CLI main 833-950、--platform 默认 841/855/869/879/886/936）
  - `tools/opsforge.mjs`（detectPlatform line 102-115、调用点 449/658/712/827）
  - `tools/paths.mjs`（resolveHome line 12、atomicWrite 58、readJsonOrNullSync 80、assertSlugSegment 106）
  - `tools/validate.mjs`（KNOWN_PLATFORMS、预加载、platform_conformance）
  - `tools/workflow-compile.mjs`（compile 硬编码 ~/.claude/commands/）
  - `.github/workflows/validate.yml`（doctor-matrix）
  - `CODEOWNERS`（line 4 /adapters/）
- 新建：
  - `adapters/workbuddy/platform.yaml`
  - `adapters/workbuddy/adapter.mjs`
  - `adapters/workbuddy/adapter.test.mjs`
  - `adapters/workbuddy/README.md`

---

*设计文档版本: 1.0 final | 产出方式: planner 两轮校验 + 主会话综合 autodetect 真实代码*
