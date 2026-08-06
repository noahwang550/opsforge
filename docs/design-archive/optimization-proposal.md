# OpsForge 三痛点优化方案

> 产出：optimization planner（2026-08-06）。基于 repo 权威源实测（`tools/opsforge.mjs` / `tools/test-runner.mjs` / `tools/intake*.mjs` / `schema/upstream-ref.schema.json` / `tools/inventory.mjs` / `install.mjs` / `tools/report-renderer.mjs` / 4 个 opsforge-meta agent source.md）+ 两份参考设计文档写法对齐（`phase4-skillup-fusion-plan.md` §6 risk/rollback + §7 MVP slice ordering；`capability-creation-methodology-impl-plan.md` §G per-tool 精确改动规格 + §J risk callouts）。
> 本方案与 Phase 4 已交付三刀（skill-up 融合 / capability-creation 方法论 / 主菜单补第三方收录入口）正交：不回退任何已落地 R-rule / schema 字段 / agent prompt；只在工程层补三个优化点。

## 0. 背景与目标

OpsForge Phase 1–4 已交付完整 v9 命令面 + 5-agent 流水线 + 三报告 release gate + 496 测试绿。三痛点来自实际 dogfood 与第三方收录场景：

1. **固定内容被 LLM 自由叙述漂移** — `@opsforge` agent 从 `source.md` prompt 重新叙述菜单时丢掉了 ③ 第三方分支；代码本身（`cmdMenu` 7 选项、`cmdNewFlow` 3 选项）是硬编码 console.log，不是缺陷。根因是 prompt drift。
2. **流水线 ~80min 太慢** — `runSuite()` 串行 for-loop 跑 cases，每个 `runCase` spawn `claude -p`（30s+），3 cases 串行 = 90s；整条访谈→蒸馏→跑通→迭代链路叠加 ~80min。
3. **第三方收录克隆整个 repo 太重** — `fetchUpstream()` git-clone 整个 repo + 50MB 上限；很多上游只索引用，不需要克隆本地；语言限制也过严。

**目标**：把三痛点分别收敛——固定内容走 CLI `print` emit、runSuite 并行化、intake 支持 reference-scope 只存 git 地址不 clone——同时**守住 10 条硬不变量**与**不与已有未提交工作冲突**。

## 1. 三痛点详述

### Pain 1：固定内容去 AI 化

**现状实测**：
- `tools/opsforge.mjs:129-143` `cmdMenu` 的 `menu()` 是硬编码 7 选项中文字符串数组（`1) 新建一个能力` … `7) 浏览仓库全部能力` `0) 退出`），确定性无 LLM 参与。
- `tools/opsforge.mjs:173-177` `cmdNewFlow` 打印 3 选项子菜单（`① 调出 @capability-interviewer` `② 直接脚手架` `③ 收录第三方能力`），也是硬编码 `console.log`。
- `packs/opsforge-meta/agents/opsforge/source.md:50` `## 运行指令` 是一段英文 system prompt，让 LLM "present the 7-option Chinese top menu"——LLM 从这段 prompt 重新叙述菜单时**丢掉了 ③ 第三方分支**（实测：source.md line 50 只列 `1) 新建一个能力 2) 安装已有能力 3) 我的能力 4) 诊断问题 5) 查看能力报告 6) 反馈 7) 浏览仓库全部能力 0) 退出`，把 `cmdNewFlow` 的 ③ 整个子菜单完全省略——agent 根本不知道有第三方收录入口）。
- 同样 `capability-interviewer/source.md:54-66` 的 5 触点、`capability-distiller/source.md:55-67` 的 5 步、`opsforge-wizard/SKILL.md:53-63` 的 4 期路由，都是 prompt 内联叙述固定流程，LLM 重新生成时有漂移风险。

**根因**：不是代码缺陷，是**固定内容出口分散在 prompt 里被 LLM 自由叙述**。`cmdMenu` 已经是确定性 console.log，问题在于 agent 的 `source.md` 重新叙述这份菜单时丢了分支。

**修复方向**：新增 `opsforge print <topic>` 子命令直接 emit 固定内容（菜单/提示词/向导步骤文本/intake 守卫/report-renderer 模板）；更新 agent `source.md` 让它调用 CLI 或打印精确文本，而非自由叙述。

### Pain 2：流水线提速 ~80min→~45min

**现状实测**：
- `tools/test-runner.mjs:836` `runSuite()` 串行 for-loop：`for (const c of cases) { const v = await runCase(...); verdicts.push(v); }`。每个 `runCase` 内部 spawn `claude -p`（30s+），3 cases 串行 = 90s；改 `Promise.all` 并发 → ~30s（3x）。
- `tokenSink` 累加器（line 835 `{input:0, output:0}`）经 `opts` spread 跨 case 共享——并行化需原子聚合（`Promise.all` 返回各自 sink 后求和，避免竞态）。
- `results.json` 在全部 case 完成后单次写入（line 848 `atomicWrite`）——并行化不影响。
- `tools/test-runner.mjs:50-64` `resolveClaudeBin()`（未提交工作）已修复 Windows spawn ENOENT：直探 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`，并设 `CLAUDECODE=1` env 避免嵌套会话挂起。**并行化要与此修复叠加而非冲突**——`runCase` 已通过 `opts.tokenSink` 传 sink，并发时每个 case 拿独立 sink，最后 sum 即可。
- 其他提速杠杆：dry-run 缓存（相同 cap+case 不重跑）、外置访谈脚本（`capability-interviewer` 的 5 触点脚本从 prompt 内联改为读 `templates/interview-script.md` 文件）、步骤合并（访谈→蒸馏同会话交接，少一次 spawn）、`--skip-dry-run` 旗标、distill 阶段并行化（多 case 草稿并发生成）。

### Pain 3：第三方收录只存 git 地址不克隆

**现状实测**：
- `tools/intake-fetch.mjs:11` `MAX_INTAKE_BYTES = 50 * 1024 * 1024`（50MB 上限）；`fetchUpstream()` line 149 用 `execFileSync('git', ['clone','--depth',1,url,dest])` 克隆整个 repo 到 `.opsforge-intake/intake-<ts>/`，再 `dirSize()` 算体积。
- `tools/intake-license.mjs:39` `checkLicense()` 走 SPDX 白名单 + LLM-assist，依赖 license 字符串——**不依赖 repo 内容**，可以 API 查。
- `tools/intake.mjs:21` `intake()` 编排：fetch → license → scaffold → write upstream-ref。
- `schema/upstream-ref.schema.json` 已支持 `intake_scope: reference` enum（line 18-20：`["full","partial","vendored","reference"]`），但 `intake.mjs:56` 默认 `vendored`，未走 `reference`。
- `install.mjs:64` `findCapabilitySource(capId, repoRoot)` 只查 `packs/<pack>/<kind>/<name>` + `customers/<brand>/packs/<brand>/<kind>/<name>`——**不查 `_drafts/third-party/`**，reference-scope 的能力安装时无源可找。
- SSRF 守卫（`assertPublicUrl` line 83）全套保留：https-only、shell-metachar 拒绝、私网段拒绝、DNS rebinding 拒绝——**reference-scope 仍须过这套守卫**，只是不 clone。

**修复方向**：收录时只存 git 地址 + 中文名称与作用 + 元数据（`intake_scope: reference`），**不克隆整个 repo**；安装时按需从 git 地址拉取。去掉 50MB 体积上限和语言限制；只保留安全/license 硬门。

## 2. 硬不变量清单（10 条，实现者逐条守住）

| # | 不变量 | 守护点 | 本方案触点 |
|---|------|--------|-----------|
| 1 | 零新 npm 依赖（仅 ajv/js-yaml/semver） | `package.json` + `.github/workflows/guardrails.yml` deps-guard | P0 `print` 用 Node 内置 fs/path；P1 `intake-remote` 用 Node 内置 fetch；P2 无新依赖 |
| 2 | 所有 schema `additionalProperties: false` | `schema/*.schema.json` | P1 `upstream-ref.schema.json` 加 `install_hint` 字段，`additionalProperties:false` 保留 |
| 3 | `registry*.yaml` 由 `tools/release.mjs` auto-gen | 不手编 registry | 本方案不动 release.mjs 聚合逻辑 |
| 4 | skeleton_guard（文件集必须匹配 `templates/<kind>/`） | `new-capability.mjs:20` + `validate.mjs:32` 两处 `SKELETON_GUARD_EXCLUSIONS` | P1 `interview-script.md` 落 `templates/` 根（非 `templates/<kind>/`），不计入签名——若需落 `<kind>/` 须两处加 exclusion |
| 5 | R16–R22 + R24–R31 不弱化 | `validate.mjs` staged+ checks | 本方案不改任何 R-rule；P0 `print` 不触 validate；P1 `intake-remote` 不触 validate |
| 6 | §C.1 pinned baseline（Node 22 LTS、ESM .mjs、npm only、install.sh 唯一 sh） | `.nvmrc` + `package.json` + CI matrix | 本方案全 .mjs；无新 sh；无新语言 |
| 7 | 不引 Go 二进制 | 无 `go.mod` / 无 `go run` | 本方案零 Go |
| 8 | SSRF 守卫保留（private-network 拒绝、dns.lookup 私网段、hex/decimal/octal/v4-mapped-v6/.local/.corp + DNS rebinding 全保留） | `tools/intake-fetch.mjs:83` `assertPublicUrl` + `tools/security-scan.mjs` | P1 `intake-remote.mjs` 复用 `assertPublicUrl`；reference-scope 只存 URL 不 clone，但仍过 SSRF 门 |
| 9 | Windows 兼容 | 所有路径 `path.join`；spawn argv 形式；多轮 stream-json stdin 用 Buffer | P0 `print` 纯字符串 emit；P1 `intake-remote` 用 fetch（无 spawn）；P2 无新 spawn |
| 10 | release gate 三报告逻辑（validation+security+eval 须 pass/pending）不动 | `release.mjs aggregateAll` | 本方案不动 release.mjs gate 逻辑 |

## 3. P0/P1/P2 分阶段

每项含：文件级改动目标 / 改动描述 / 预期收益 / 风险与回滚。

### P0-A：`opsforge print` 子命令 + agent prompt 改调 CLI

**文件级改动目标**：
- `tools/opsforge.mjs`（新增 `cmdPrint` + `main()` switch 加 `print` 分支）
- `packs/opsforge-meta/agents/opsforge/source.md`（`## 运行指令` 改为"调用 `opsforge print menu` / `opsforge print new-flow` / `opsforge print install-flow` / `opsforge print intake-guard` / `opsforge print push-reminder`"）
- `packs/opsforge-meta/agents/capability-interviewer/source.md`（触点脚本改为"调用 `opsforge print interview-touchpoints`"）
- `packs/opsforge-meta/agents/capability-distiller/source.md`（步骤改为"调用 `opsforge print distiller-steps`"）
- `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md`（4 期路由改为"调用 `opsforge print wizard-phases`"）
- `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`（同 interviewer，纯 prompt 形态）
- `tools/opsforge.test.mjs`（+测试：`print <topic>` 输出与 `cmdMenu`/`cmdNewFlow` console.log 字符串逐字一致）

**改动描述**：
1. `tools/opsforge.mjs` 新增 `cmdPrint(args)`：读 `args[0]` topic，从 `PRINT_TOPICS` map emit 固定字符串到 stdout。topic 清单：
   - `menu` → `cmdMenu` 的 7 选项中文菜单（复用 line 129-143 的字符串数组）
   - `new-flow` → `cmdNewFlow` 的 3 选项子菜单（line 173-177）
   - `wizard-routing` → `cmdWizard` 的 2 选项路由（line 273-275）
   - `install-flow` → `promptInstallFlow` 的 5 步提示（line 569-584）
   - `intake-guard` → `cmdIntakeFlow` 的拒绝文案（line 215-219 + 235）
   - `push-reminder` → `printPushReminder`（line 204）
   - `discover-empty` / `discover-installed` → `cmdDiscover` 的空/已装文案（line 323/334）
   - `doctor-health` → `cmdDoctor` 的渲染模板（line 460-463）
   - `status-state` → `cmdStatus` 的状态渲染（line 424-425）
   - `evolve-flow` → `cmdEvolve` 的流程提示（line 666-700）
   - `feedback-flow` → `cmdFeedback` 的提示（line 514-529）
   - `interview-touchpoints` → interviewer 5 触点（从 source.md line 54-66 抽取）
   - `distiller-steps` → distiller 5 步（从 source.md line 55-67 抽取）
   - `wizard-phases` → wizard 4 期路由（从 SKILL.md line 53-63 抽取）
2. `main()` switch（line 54）加 `case 'print': return cmdPrint(argv.slice(1));`。
3. `cmdMenu`/`cmdNewFlow`/`cmdWizard` 等既有函数改为**调 `cmdPrint` 的同一字符串源**（抽常量到 `PRINT_TOPICS`，console.log 与 `print` 子命令共用），避免双源真相。
4. agent `source.md` `## 运行指令` 从"present the 7-option Chinese top menu..."改为"call `opsforge print menu` and emit its stdout verbatim; do not narrate the menu yourself"。interviewer/distiller 同理改"call `opsforge print interview-touchpoints` / `opsforge print distiller-steps`"。
5. `opsforge-wizard` SKILL.md `## 运行指令` 改为"call `opsforge print wizard-phases`"。

**预期收益**：消除 prompt drift——agent 不再自由叙述固定内容，而是调 CLI emit 精确文本；`cmdMenu` ③ 第三方分支不再丢失；interviewer 5 触点 / distiller 5 步 / wizard 4 期路由全部对齐代码源。

**风险与回滚**：
- **风险**：agent `source.md` 改后须重新过 `validate.mjs --all`（R16-R22 + R24-R31 不动，但 body 内容变，须确认 `## 运行指令` H2 仍 ≥80 token R27；`print` 调用指令文本够长即可）。`print` 子命令输出须与既有 console.log **逐字一致**（测试断言字符串相等），否则 agent 行为变。
- **回滚**：删 `cmdPrint` + `main()` switch `print` 分支 + `PRINT_TOPICS` 常量；agent `source.md` revert 到自由叙述版本。既有 console.log 不受影响（`cmdMenu` 等仍直接 console.log）。

### P0-B：`runSuite` Promise.all 并行化

**文件级改动目标**：
- `tools/test-runner.mjs`（`runSuite` line 816-851 改 `for` 为 `Promise.all`；`tokenSink` 改为每 case 独立 sink 后求和）
- `tools/test-runner.test.mjs`（+测试：mock `runCase` 返回延迟，断言并发 < 串行 1/2 时间；`tokenSink` 求和正确）

**改动描述**：
1. `runSuite` line 836-839 改：
   ```js
   // 旧：串行
   for (const c of cases) {
     const v = await runCase(capDir, c, { ...opts, runner, platform, tokenSink });
     verdicts.push(v);
   }
   // 新：并行，每 case 独立 sink
   const sinks = cases.map(() => ({ input: 0, output: 0 }));
   const verdicts = await Promise.all(cases.map((c, i) =>
     runCase(capDir, c, { ...opts, runner, platform, tokenSink: sinks[i] })
   ));
   for (const s of sinks) { tokenSink.input += s.input; tokenSink.output += s.output; }
   ```
2. `tokenSink` 仍作为 `opts.tokenSink` 传入（保持 `executeMultiTurnDryRun` line 801-804 的 sink 写入契约），但每个 case 拿独立 sink，最后 sum——避免并发竞态。
3. `results.json`（line 848）仍在全部 case 完成后单次 `atomicWrite`——`Promise.all` 完成即写，不变。
4. `resolveClaudeBin()`（未提交工作）已修复 Windows spawn——**并行化叠加此修复**：每个并发 `runCase` 内部 `executeClaudeDryRun` 调 `resolveClaudeBin()` 得同一 exe 路径，spawn 多个 `claude.exe` 进程（OS 多进程调度，无共享状态冲突）。
5. `buildSummary`（line 853）不变——`verdicts` 数组顺序与 `cases` 顺序一致（`Promise.all` 保持输入顺序）。

**预期收益**：3 cases 串行 90s → 并行 ~30s（3x）；整条访谈→蒸馏→跑通→迭代链路 ~80min → ~45min（含访谈 30min + 蒸馏 10min + 跑通 5min + 迭代 0min，跑通省 60s）。

**风险与回滚**：
- **风险**：并发 spawn 多个 `claude.exe` 在低配机器可能 OOM 或 rate limit；`CLAUDECODE=1` env 已避免嵌套会话挂起，但多进程可能触发 API rate limit。缓解：加 `opts.concurrency` 默认 `cases.length`，可设 `OPSFORGE_RUNNER_CONCURRENCY=1` 回退串行。
- **回滚**：revert `Promise.all` 回 `for` 循环；`tokenSink` 恢复共享。测试断言并发 + 串行结果一致。

### P0-C：intake 失败回滚（守已写草稿不留半成品）

**文件级改动目标**：
- `tools/intake.mjs`（`intake()` line 21 加 try/catch：fetch 失败/license fail/scaffold fail 时清理 `.opsforge-intake/intake-<ts>/` 临时目录 + 已 scaffold 的 `_drafts/third-party/<name>/` 半成品）

**改动描述**：
1. `intake()` line 30-60 包 try/catch：catch 块清理 `dir`（fetchUpstream 返回的临时 clone 目录）+ `destPath`（scaffold 产出的 `_drafts/third-party/<name>/`，若已写）。
2. `intake-fetch.mjs fetchUpstream` 已在 size 超限时清理（line 160-162），但 license fail / scaffold fail 时不清理——本项补全。
3. 不改 `intake-license.mjs`（纯查询无副作用）。

**预期收益**：intake 失败不留半成品 `_drafts/third-party/<name>/`（会被 draft gate R7 placeholder 挡，但残留目录污染 `scanCapabilities`）；`cmdIntakeFlow` 失败提示更干净。

**风险与回滚**：
- **风险**：清理 `_drafts/third-party/<name>/` 时若作者已手动填了字段会丢——但 intake 失败时半成品不可用（license 不通过），清理是对的。加 `--keep-on-fail` 旗标供调试。
- **回滚**：revert try/catch；半成品残留由作者手动删。

### P1-A：`tools/intake-remote.mjs`（API LICENSE fetch，不 clone）

**文件级改动目标**：
- 新增 `tools/intake-remote.mjs`（export `fetchRemoteMeta(url, opts)` → `{repo, commit, license, sizeBytes:null, intakeScope:'reference'}`；复用 `intake-fetch.mjs assertPublicUrl` SSRF 守卫；用 Node 内置 fetch 查 GitHub API `/repos/<owner>/<repo>/license` + `/repos/<owner>/<repo>/commits/HEAD` 取 commit sha；非 GitHub 回退到 `git ls-remote` 单次调用取 sha，不 clone）
- `tools/intake.mjs`（`intake()` 加 `opts.scope='full'|'reference'`；`reference` 时调 `fetchRemoteMeta` 而非 `fetchUpstream`；`upstream-ref.json` 写 `intake_scope: 'reference'` + `install_hint` 字段）
- `tools/intake.test.mjs`（+测试：reference-scope 不 clone、`intake_scope='reference'`、`install_hint` 填实）
- `tools/intake-fetch.test.mjs`（+测试：`fetchRemoteMeta` mock fetch 返回 license + sha；非 GitHub 回退 `git ls-remote`）

**改动描述**：
1. `intake-remote.mjs fetchRemoteMeta(url, opts)`：
   - 调 `assertPublicUrl(url, opts)` 复用 SSRF 守卫（https-only、shell-metachar 拒绝、私网段拒绝、DNS rebinding 拒绝）。
   - GitHub URL：用 Node 内置 `fetch` 查 `https://api.github.com/repos/<owner>/<repo>/license` 取 `license.spdx_id` + `/repos/<owner>/<repo>/commits/HEAD` 取 `sha`（short sha）。
   - 非 GitHub：回退 `execFileSync('git', ['ls-remote', url, 'HEAD'])` 取 sha（argv 形式，无 shell——N2 RCE 守卫保留）；license 从 `--license` 参数取（作者手填，后续 `checkLicense` 把关）。
   - 不 clone，不算 `dirSize`，`sizeBytes=null`。
2. `intake.mjs intake()` 加 `opts.scope` 参数：`'full'`（默认，现有行为）调 `fetchUpstream`；`'reference'` 调 `fetchRemoteMeta`。
3. `upstream-ref.json` line 48-57：`reference` scope 时写 `intake_scope: 'reference'` + `install_hint: '<git 地址>;<kind>;<name>'`（供 `install --from-git` 取地址）。
4. `cmdIntakeFlow`（opsforge.mjs:210）加问"收录方式 ① 完整克隆（vendored）② 只存 git 地址（reference）"，默认 ②（更轻）。

**预期收益**：reference-scope 收录 0 克隆（省 50MB + clone 时间）；GitHub 仓库走 API 查 license + sha；非 GitHub 走 `ls-remote`（单次，不 clone）；50MB 上限和语言限制对 reference-scope 不适用（不 clone）。vendored scope 保留 50MB 上限（克隆场景仍需）。

**风险与回滚**：
- **风险**：GitHub API 有 rate limit（未认证 60 req/h）；`fetchRemoteMeta` 失败回退 `ls-remote`。`install_hint` 字段格式须稳定（分号分隔，`install.mjs --from-git` 解析）。
- **回滚**：删 `intake-remote.mjs`；`intake.mjs intake()` revert 只走 `fetchUpstream`；`cmdIntakeFlow` 删 scope 问。`schema/upstream-ref.schema.json` 的 `install_hint` 字段保留无碍（可选字段）。

### P1-B：intake reference-scope + `install.mjs --from-git`

**文件级改动目标**：
- `schema/upstream-ref.schema.json`（加 `install_hint` 字段，`additionalProperties:false` 保留）
- `install.mjs`（`findCapabilitySource` 加查 `_drafts/third-party/` + `_staged/third-party/`；新增 `installFromGit(gitUrl, kind, name, opts)` 按需 clone-to-temp + install + cleanup）
- `install.mjs` `main()` 加 `--from-git <url>` 分支
- `tools/install-registry.test.mjs`（+测试：`findCapabilitySource` 查 `_drafts/third-party/`；`installFromGit` mock clone + install + cleanup）

**改动描述**：
1. `schema/upstream-ref.schema.json` `properties` 加：
   ```json
   "install_hint": { "type": ["string", "null"] }
   ```
   `additionalProperties: false`（line 7）不动。`required` 不加（可选字段）。
2. `install.mjs findCapabilitySource`（line 64-85）在 `kindDirs` 循环后 + `customersDir` 循环前，加查 `_drafts/third-party/` + `_staged/third-party/`：
   ```js
   for (const draftsRoot of ['_drafts', '_staged']) {
     const thirdPartyDir = path.join(repoRoot, 'packs', draftsRoot, 'third-party', kd, name);
     if (findManifest(thirdPartyDir)) return thirdPartyDir;
   }
   ```
3. `install.mjs` 新增 `installFromGit(gitUrl, kind, name, opts)`：
   - 调 `intake-fetch.mjs fetchUpstream(gitUrl, { dest: <temp> })` clone 到 temp（过 SSRF 守卫 + 50MB 上限——clone 场景仍保留）。
   - 在 temp 内找 `<kind>/<name>/capability.yaml`（或 `source.md` / `SKILL.md`）。
   - 调既有 `install({ capDir: <temp>/<kind>/<name>, ... })` 装到目标平台。
   - cleanup temp。
4. `main()` line 644 加 `--from-git <url>` 分支：解析 `--from-git` + `--kind` + `--name` → 调 `installFromGit`。

**预期收益**：reference-scope 能力（`intake_scope: 'reference'`）安装时按需 clone-to-temp + install + cleanup，不在 repo 留 50MB 克隆体；`findCapabilitySource` 也能找 `_drafts/third-party/`（修记忆 #41 指出的 gap）。

**风险与回滚**：
- **风险**：`installFromGit` clone 时仍过 50MB 上限——大 repo 装不了（但 reference-scope 本就为轻量收录，大 repo 走 vendored scope）。`install_hint` 格式不稳会解析失败——加 schema 校验。
- **回滚**：`schema/upstream-ref.schema.json` 删 `install_hint`；`install.mjs findCapabilitySource` revert；`installFromGit` 删；`main() --from-git` 删。reference-scope 能力不可安装（但仍在 registry，可后续补）。

### P1-C：外置访谈脚本 + dry-run 缓存

**文件级改动目标**：
- 新增 `templates/interview-script.md`（interviewer 5 触点的完整脚本，从 `source.md` line 54-66 抽取 + 扩展，落 `templates/` 根不计入 skeleton 签名）
- `packs/opsforge-meta/agents/capability-interviewer/source.md`（`## 运行指令` 改为"读 `templates/interview-script.md` 并按脚本执行"，不再内联 5 触点）
- `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`（同 source.md，纯 prompt 形态读同一脚本文件）
- `tools/test-runner.mjs`（`executeClaudeDryRun` 加 `opts.cacheKey`：`<capDir>:<caseYaml.name>:<systemPrompt hash>`；命中缓存且 `opts.useCache` → 直接返回缓存 actual；`opts.useCache` 由 `runSuite` 传 `!opts.refresh`）
- `tools/test-runner.mjs` `runSuite` 加 `opts.refresh` 旗标（默认 false=用缓存；`--refresh` 或 `OPSFORGE_RUNNER_REFRESH=1` 强制重跑）
- `tools/test-runner.test.mjs`（+测试：缓存命中不 spawn；`--refresh` 强制 spawn）

**改动描述**：
1. `templates/interview-script.md` 落 `templates/` 根（与 `interview-record.md` 同位），内容是 interviewer 5 触点的完整脚本（从 source.md 抽取 + 扩展，含成本预估文案、Mode A/B 分支、propose_and_confirm 模板、反锚定守卫触发文案）。
2. `capability-interviewer/source.md` `## 运行指令` 改为"Read `templates/interview-script.md` and execute the 5 touchpoints as scripted. Do not paraphrase the touchpoints; emit the scripted prompts verbatim."——agent 读文件而非内联叙述。
3. `opsforge-interview/SKILL.md` 同样改为读 `templates/interview-script.md`（纯 prompt 形态：作者把脚本贴到任意 LLM）。
4. `executeClaudeDryRun` 加缓存层：`opts.cacheKey` 命中时直接返回缓存 actual（`~/.opsforge/runs/<cacheKey>.json`）；`opts.useCache` 默认 true，`runSuite` 传 `!opts.refresh`。
5. `runSuite` 加 `opts.refresh`（默认 false）；`--refresh` CLI flag 或 `OPSFORGE_RUNNER_REFRESH=1` env 强制重跑。

**预期收益**：外置访谈脚本——修改脚本不需改 agent source.md（少一次 validate + release gate 往返）；dry-run 缓存——相同 cap+case 不重跑（dev 迭代时省 90s/次）。

**风险与回滚**：
- **风险**：`templates/interview-script.md` 落 `templates/` 根，**若误落 `templates/agent/` 会破 skeleton 签名**（J.1 风险模式）——必须落 `templates/` 根。缓存 key 须含 `systemPrompt` hash，否则改 body 后缓存失效不对——用 Node 内置 `crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0,16)`（零新依赖）。
- **回滚**：删 `templates/interview-script.md`；source.md revert 内联 5 触点；`executeClaudeDryRun` 删缓存层；`runSuite` 删 `opts.refresh`。

### P2-A：distill 并行化 + opsforge gate one-shot

**文件级改动目标**：
- `tools/regression-sink.mjs`（`generateCase` 多 case 并发：`Promise.all(failures.map(f => generateCase(f)))`）
- `packs/opsforge-meta/agents/capability-distiller/source.md`（步骤 ③ Write 覆写多 H2 改为一次 Write 全 body；步骤 ④ 多 case 默认值改为一次 propose_and_confirm 全部）
- `tools/opsforge.mjs` `cmdEvolve`（多选沉淀改为一次 `Promise.all` 生成全部草稿）

**改动描述**：
1. `regression-sink.mjs generateCase` 改为可并发：`Promise.all(items.map(it => generateCase(it.fb, it.fail, { draftsDir })))`——每 case 独立写 `tests/case-NN.yaml`，无共享状态。
2. `capability-distiller/source.md` 步骤 ③ 改为"Write the full body in one call (all H2 sections)"——少多次 Write 往返。
3. `cmdEvolve`（opsforge.mjs:685-696）改 `for` 为 `Promise.all`——并发生成草稿。

**预期收益**：distill 阶段 5 case 并发 ~10s（原 50s 串行）；evolve 沉淀 3 条草稿 ~3s（原 9s 串行）。

**风险与回滚**：
- **风险**：`generateCase` 并发写 `tests/case-NN.yaml` 文件名冲突——已用 `slugify(text/case 前 30 字符) + 冲突加 -2/-3`（regression-sink.mjs 既有逻辑），并发时仍可能 race——加 `Promise.all` 前先预分配文件名。
- **回滚**：revert `Promise.all` 回 `for`；distiller source.md revert 多次 Write。

### P2-B：`--skip-dry-run` + upstream-ref `install_hint` + 中文 README 模板

**文件级改动目标**：
- `tools/test-runner.mjs`（`runSuite` 加 `opts.skipDryRun` 旗标：true 时只跑 `pre_gates` + static compare，不 spawn `claude -p`）
- `tools/opsforge.mjs` `cmdStatus`/`cmdReport`（跑通门后调 `renderRunLight` 渲染两档灯——已部分落地，补 `--skip-dry-run` 旗标透传）
- `schema/upstream-ref.schema.json`（`install_hint` 字段已在 P1-B 加，P2 补 `install_hint` 格式文档：`<git>;<kind>;<name>[;<subpath>]`）
- 新增 `templates/readme-template.zh.md`（中文 README 模板，供 `new-capability.mjs --third-party` 生成 `README.md` 时用）

**改动描述**：
1. `runSuite` line 817 加 `opts.skipDryRun`：true 时 `runCase` 不调 `executeClaudeDryRun`，只跑 `pre_gates` + `compareForMode`（若 `opts.actual` 未注入则 `pass:'pending'`，等同 static-only）。
2. `cmdStatus`/`cmdReport` 跑通门后调 `renderRunLight`（已部分落地 in report-renderer.mjs:39-90）——补 `--skip-dry-run` 旗标透传到 `runSuite`。
3. `install_hint` 格式文档：`<git>;<kind>;<name>[;<subpath>]`（分号分隔，`install.mjs --from-git` 解析）。
4. `templates/readme-template.zh.md`：中文 README 模板（`## 能力说明` / `## 适用场景` / `## 安装` / `## 使用` / `## 依赖`），供 `new-capability.mjs --third-party` 生成 `README.md` 时用。

**预期收益**：`--skip-dry-run` 在 CI 静态-only 场景省 90s（不 spawn）；`install_hint` 格式稳定；中文 README 模板让第三方收录有中文文档。

**风险与回滚**：
- **风险**：`--skip-dry-run` 误用会漏跑真例——默认 false，仅 `--skip-dry-run` flag 或 `OPSFORGE_SKIP_DRY_RUN=1` env 触发。
- **回滚**：`runSuite` 删 `opts.skipDryRun`；`templates/readme-template.zh.md` 删。

## 4. 与已有未提交工作的叠加关系

### 4.1 `web/catalog/`（公共目录前端）+ `tools/catalog-model.mjs` + `catalog-server.mjs`

**现状**：`web/catalog/{app.js,index.html,styles.css}` + `tools/catalog-model.mjs`（`buildCatalogSnapshot` + `catalogSummary`）+ `tools/catalog-server.mjs`（零依赖 HTTP server，`createCatalogHandler` + `startCatalogServer`）已落地未提交。`catalog-model.mjs` 从 `buildInventory` 派生 public catalog snapshot（`publicEntry` line 69 过滤敏感字段）。

**叠加关系**：
- P0-A `opsforge print` 不触 catalog（catalog 是 HTTP server，不是 CLI emit）。
- P1 `intake-remote` reference-scope 产出的 `upstream-ref.json` + `install_hint` 会进 `buildInventory` → `buildCatalogSnapshot` → catalog 前端展示。reference-scope 能力在 catalog 显示"只存 git 地址，安装时拉取"标签（`install_hint` 非空即标）。
- P2 中文 README 模板让第三方收录能力在 catalog 有中文摘要——`catalog-model.mjs publicEntry` 已读 `display_name_zh` / `description`，模板填实后 catalog 展示更友好。

**保护而非冲突**：本方案不动 `catalog-model.mjs` / `catalog-server.mjs` / `web/catalog/`；`intake-remote` 的 `install_hint` 字段是 `buildInventory` 既有 `sourceOrigin` 字段（未提交工作已加 line 205）的自然扩展，不冲突。

### 4.2 `tools/inventory.mjs` 增强（+17 行）

**现状**：未提交工作给 `buildInventory` 加了 `qualityReports` / `dependsOn` / `sourceOrigin` / `releasedAt` 字段（line 203-206），喂给 catalog。

**叠加关系**：
- P1 `intake-remote` reference-scope 能力的 `intake_scope: 'reference'` 会进 `buildInventory` 的 `sourceOrigin`（`cap.yaml.source.origin`——但 `origin` 是 `original`/`third-party`，`intake_scope` 是 `full`/`reference`，两者正交）。`buildInventory` 须加 `intakeScope` 字段（从 `upstream-ref.json` 读，若存在）——本方案 P1-B 补这一行（`intakeScope: readJsonOrNullSync(path.join(cap.dir, 'upstream-ref.json'))?.intake_scope || null`）。
- catalog 前端可据 `intakeScope==='reference'` 显示"只存 git 地址"标签。

**保护而非冲突**：本方案只在 `buildInventory` 加一行 `intakeScope` 字段，不动既有 +17 行增强。

### 4.3 `tools/test-runner.mjs` Windows-safe `resolveClaudeBin()`（+131 行）

**现状**：未提交工作已修复 Windows spawn ENOENT：`resolveClaudeBin()`（line 50-64）直探 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`，并设 `CLAUDECODE=1` env 避免嵌套会话挂起。`_judgeViaClaudeCli`（line 302-336）也用同一 `resolveClaudeBin()`。

**叠加关系**：
- P0-B `runSuite` Promise.all 并行化**叠加**此修复：每个并发 `runCase` 内部 `executeClaudeDryRun` 调 `resolveClaudeBin()` 得同一 exe 路径，spawn 多个 `claude.exe` 进程——`CLAUDECODE=1` env 已避免嵌套会话挂起，多进程安全。
- P1-C dry-run 缓存的 `cacheKey` 含 `systemPrompt` hash——`resolveClaudeBin()` 不影响缓存（缓存命中不 spawn）。
- P2-A `--skip-dry-run` 时不 spawn——`resolveClaudeBin()` 不调，无影响。

**保护而非冲突**：本方案 P0-B 明确"并行化与此修复叠加而非冲突"——`resolveClaudeBin()` 是 spawn 层修复，并行化是 runSuite 层优化，两者正交。

### 4.4 `packs/_staged/data-team/data-quality-profiler/`（新能力"数据库数据质量体检"）

**现状**：已 staged 未提交，是 data-team 包第一个能力。

**叠加关系**：
- P0-A `opsforge print` 不触此能力（它是业务能力，不是 opsforge-meta）。
- P0-B `runSuite` 并行化会加速此能力的跑通门（3 cases 90s → 30s）。
- P1 `intake-remote` 不触此能力（非 third-party）。
- P2 中文 README 模板可给此能力 README 提供中文结构（但此能力已 staged，README 已存在，不强制改）。

**保护而非冲突**：本方案不动 `packs/_staged/data-team/`。

## 5. 固定内容出口清单（遍历全项目识别）

以下是从 `tools/opsforge.mjs` + `tools/report-renderer.mjs` + `packs/opsforge-meta/` 遍历识别的所有"固定内容、确定性逻辑关系"出口，统一走 `opsforge print` emit：

### 5.1 `tools/opsforge.mjs` 内（13 处）

| # | 出口 | 行号 | 内容 | print topic |
|---|------|------|------|-------------|
| 1 | `cmdMenu` menu() | 129-143 | 7 选项中文菜单 | `menu` |
| 2 | `cmdNewFlow` 子菜单 | 173-177 | 3 选项（① interviewer ② scaffold ③ intake） | `new-flow` |
| 3 | `cmdWizard` 路由 | 273-275 | 2 选项（① interviewer ② scaffold） | `wizard-routing` |
| 4 | `promptInstallFlow` 5 步 | 569-584 | 安装引导 5 步提示 | `install-flow` |
| 5 | `cmdIntakeFlow` 守卫 | 215-219, 235 | intake 拒绝文案 + 失败提示 | `intake-guard` |
| 6 | `printPushReminder` | 203-205 | 推送提醒 | `push-reminder` |
| 7 | `cmdDiscover` 空/已装 | 323, 331, 334 | discover 文案 | `discover-empty` / `discover-installed` |
| 8 | `cmdDoctor` 健康 | 460-463 | doctor 渲染 | `doctor-health` |
| 9 | `cmdStatus` 状态 | 424-425 | status 渲染 | `status-state` |
| 10 | `cmdEvolve` 流程 | 666-700 | evolve 流程提示 | `evolve-flow` |
| 11 | `cmdFeedback` 提示 | 514-529 | feedback 提示 | `feedback-flow` |
| 12 | `cmdReport` 报告头 | 366 | `=== <type> (<verdict>) ===` | （复用 report-renderer） |
| 13 | 错误恢复三段式 | 162-163 | `[黄] <msg>` + `已返回主菜单` | （复用 `error-recovery`） |

### 5.2 `tools/report-renderer.mjs` 内（4 处）

| # | 出口 | 行号 | 内容 | print topic |
|---|------|------|------|-------------|
| 14 | `renderValidation` | 92-151 | validation 报告模板（绿黄红 + checks + fix） | （复用 `report-templates/validation-report.zh.md`） |
| 15 | `renderEval` | 154-213 | eval 报告模板（5 轴 + fix） | （复用 `report-templates/eval-report.zh.md`） |
| 16 | `renderSecurity` | 216-258 | security 报告模板（findings + fix） | （复用 `report-templates/security-report.zh.md`） |
| 17 | `renderRunLight` | 39-90 | 跑通门两档灯（🟢/🔵/🔴 + notes） | （复用 `report-templates/run-light.zh.md`） |

### 5.3 `packs/opsforge-meta/` 内（5 处 agent/skill prompt）

| # | 出口 | 文件 | 行号 | 内容 | print topic |
|---|------|------|------|------|-------------|
| 18 | `opsforge` source.md `## 运行指令` | agents/opsforge/source.md | 50 | 7 选项菜单英文 system prompt | `menu`（agent 改调 print） |
| 19 | `capability-interviewer` source.md `## 运行指令` | agents/capability-interviewer/source.md | 54-66 | 5 触点脚本 | `interview-touchpoints` |
| 20 | `capability-distiller` source.md `## 运行指令` | agents/capability-distiller/source.md | 55-67 | 5 步脚本 | `distiller-steps` |
| 21 | `opsforge-wizard` SKILL.md `## 运行指令` | skills/opsforge-wizard/SKILL.md | 53-63 | 4 期路由 | `wizard-phases` |
| 22 | `opsforge-interview` SKILL.md `## 运行指令` | skills/opsforge-interview/SKILL.md | 52-64 | 5 触点纯 prompt | `interview-touchpoints`（同 #19） |

**总计 22 处固定内容出口**，全部走 `opsforge print <topic>` emit。`report-renderer.mjs` 的 4 处已用 `report-templates/*.zh.md` 文件 + 占位符替换（line 82-88 / 143-148 / 205-210 / 250-255），是早期"固定内容外置"实践——`print` 子命令复用同一模板文件。

## 6. 验收标准

### P0 验收

- `opsforge print menu` 输出与 `cmdMenu` console.log **逐字一致**（测试断言字符串相等）。
- `opsforge print new-flow` / `intake-guard` / `push-reminder` 同理。
- `@opsforge` agent 重新叙述菜单时**不丢 ③ 第三方分支**（手动 E2E：`opsforge menu` → 1 → 选 ③ → 进入 `cmdIntakeFlow`）。
- `runSuite` 3 cases 并行时间 < 串行时间 1/2（mock `runCase` 延迟 100ms，断言并行 < 60ms）。
- `tokenSink` 并行求和正确（3 cases 各 10 input + 5 output → 总 30 input + 15 output）。
- `intake` 失败时 `.opsforge-intake/intake-<ts>/` + `_drafts/third-party/<name>/` 清理（测试断言目录不存在）。
- bare `node --test` +N（P0-A +5 print 测试 + P0-B +2 并行测试 + P0-C +2 回滚测试 = +9）；`validate.mjs --all` exit 0；`release.mjs --all` exit 0。
- 6 gates 全绿不变。

### P1 验收

- `intake-remote.mjs fetchRemoteMeta` GitHub URL 返回 `{license, commit, sizeBytes:null, intakeScope:'reference'}`（mock fetch）。
- `intake --scope reference` 产出的 `upstream-ref.json` 含 `intake_scope: 'reference'` + `install_hint` 字段。
- `install.mjs findCapabilitySource` 查 `_drafts/third-party/` + `_staged/third-party/`（测试构造 `_drafts/third-party/agent/foo/` 断言找到）。
- `install --from-git <url> --kind <kind> --name <name>` clone-to-temp + install + cleanup（mock clone + 断言 temp 清理）。
- `templates/interview-script.md` 存在；`capability-interviewer/source.md` `## 运行指令` 改为"读 `templates/interview-script.md`"。
- dry-run 缓存命中不 spawn（mock `executeClaudeDryRun` 计数 0 次；`--refresh` 强制 spawn 1 次）。
- `schema/upstream-ref.schema.json` 加 `install_hint` 字段，`additionalProperties:false` 保留（ajv 测试）。
- bare `node --test` +M（P1-A +4 + P1-B +3 + P1-C +3 = +10）；`validate.mjs --all` exit 0；`security-scan.mjs --all` exit 0（新 `intake-remote.mjs` 须过 §B）；`release.mjs --all` exit 0。

### P2 验收

- `regression-sink.mjs generateCase` 并发 5 case 无文件名冲突（测试 5 case 并发生成，断言 5 个不同文件名）。
- `cmdEvolve` 并发生成草稿（测试 3 条并发，断言 3 个文件）。
- `runSuite --skip-dry-run` 不 spawn `claude -p`（mock spawn 计数 0；`pre_gates` 仍跑）。
- `install_hint` 格式文档化（`<git>;<kind>;<name>[;<subpath>]`）。
- `templates/readme-template.zh.md` 存在；`new-capability.mjs --third-party` 生成 `README.md` 用此模板。
- bare `node --test` +K（P2-A +3 + P2-B +3 = +6）。

### 总验收

- bare `node --test` 496 → ~521（P0 +9 + P1 +10 + P2 +6 = +25）。
- 6 gates 全绿：`validate.mjs --all` exit 0（10 capabilities）+ `security-scan.mjs --all` exit 0 + `eval.mjs --all` exit 0 + `release.mjs --all` exit 0 + `install.mjs --doctor` healthy + `inventory.mjs --check-readme` exit 0。
- 零新 npm 依赖（`package.json` 不动）。
- `additionalProperties: false` 全保留（`upstream-ref.schema.json` 加 `install_hint` 后仍 `false`）。
- `registry*.yaml` auto-gen 不手编。
- R16–R22 + R24–R31 不弱化（本方案不动 R-rule）。
- SSRF 守卫保留（`intake-remote.mjs` 复用 `assertPublicUrl`）。
- Windows 兼容（`print` 纯字符串；`runSuite Promise.all` 叠加 `resolveClaudeBin`；`intake-remote` 用 fetch 无 spawn）。
- 与已有未提交工作叠加：`web/catalog/` / `catalog-model.mjs` / `catalog-server.mjs` / `inventory.mjs +17 行` / `test-runner.mjs resolveClaudeBin +131 行` / `packs/_staged/data-team/` 全部保护不冲突。

## 7. 风险总览与回滚

| 项 | 主要风险 | 回滚成本 |
|---|---------|---------|
| P0-A `print` | agent source.md 改后 R27 `## 运行指令` <80 token | 低（revert source.md + 删 `cmdPrint`） |
| P0-B 并行化 | 多 spawn `claude.exe` OOM / rate limit | 低（加 `OPSFORGE_RUNNER_CONCURRENCY=1` 回退串行） |
| P0-C 回滚 | 清理误删作者已填字段 | 低（加 `--keep-on-fail` 旗标） |
| P1-A `intake-remote` | GitHub API rate limit | 中（删 `intake-remote.mjs` + revert `intake.mjs scope`） |
| P1-B `--from-git` | `install_hint` 格式不稳 | 中（删 `installFromGit` + schema revert） |
| P1-C 外置脚本 | `templates/interview-script.md` 误落 `templates/agent/` | 低（落 `templates/` 根） |
| P2-A distill 并行 | `generateCase` 文件名 race | 低（预分配文件名） |
| P2-B `--skip-dry-run` | 误用漏跑真例 | 低（默认 false） |

## 8. 不变量逐条确认（10/10）

1. **零新 npm 依赖** — P0 `print` 用 Node 内置 `fs`/`path`；P1 `intake-remote` 用 Node 内置 `fetch` + 复用 `intake-fetch.mjs` 的 `execFileSync`（既有）；P1-C 缓存用 Node 内置 `crypto`；P2 无新依赖。`package.json` 不动。✅
2. **`additionalProperties: false` 全保留** — `schema/upstream-ref.schema.json` 加 `install_hint` 字段后 `additionalProperties: false`（line 7）不动；ajv 测试断言。✅
3. **`registry*.yaml` auto-gen** — 本方案不动 `release.mjs` 聚合逻辑；reference-scope 能力进 registry 走正常 `release.mjs --all` 流程。✅
4. **skeleton_guard** — `templates/interview-script.md` 落 `templates/` 根（非 `templates/<kind>/`），不计入签名；`templates/readme-template.zh.md` 同理。不改 `SKELETON_GUARD_EXCLUSIONS`。✅
5. **R16–R22 + R24–R31 不弱化** — 本方案不动 `validate.mjs` 任何 R-rule；P0-A agent source.md 改 `## 运行指令` 内容，R27（≥80 token）仍生效——`print` 调用指令文本够长即可。✅
6. **§C.1 pinned baseline** — 全 `.mjs` ESM；无新 sh；无新语言；Node 22 LTS（`.nvmrc` 不动）；npm only。✅
7. **不引 Go 二进制** — 本方案零 Go；`intake-remote.mjs` 用 Node 内置 fetch + `git ls-remote`（既有 git CLI，非 Go）。✅
8. **SSRF 守卫保留** — `intake-remote.mjs fetchRemoteMeta` 复用 `intake-fetch.mjs assertPublicUrl`（https-only、shell-metachar 拒绝、私网段拒绝、DNS rebinding 拒绝全套）；reference-scope 只存 URL 不 clone，但仍过 SSRF 门。`security-scan.mjs` 不动。✅
9. **Windows 兼容** — `print` 纯字符串 emit；`runSuite Promise.all` 叠加 `resolveClaudeBin()` Windows 修复（直探 `claude.exe` + `CLAUDECODE=1` env）；`intake-remote` 用 fetch（无 spawn）；`installFromGit` 用 `execFileSync` argv 形式（无 shell，N2 RCE 守卫保留）。✅
10. **release gate 三报告逻辑不动** — 本方案不动 `release.mjs aggregateAll` gate 逻辑；reference-scope 能力过正常 validation+security+eval 三报告。✅

---

**关键文件路径清单（实现者按此索引）**：

- `tools/opsforge.mjs`（P0-A `cmdPrint` + `PRINT_TOPICS` + `main()` switch `print` 分支；P0-C `cmdIntakeFlow` scope 问）
- `packs/opsforge-meta/agents/opsforge/source.md`（P0-A `## 运行指令` 改调 `opsforge print menu`）
- `packs/opsforge-meta/agents/capability-interviewer/source.md`（P0-A + P1-C 改读 `templates/interview-script.md`）
- `packs/opsforge-meta/agents/capability-distiller/source.md`（P0-A `## 运行指令` 改调 `opsforge print distiller-steps`；P2-A 步骤 ③ one-shot Write）
- `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md`（P0-A 改调 `opsforge print wizard-phases`）
- `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`（P0-A + P1-C 改读 `templates/interview-script.md`）
- `tools/test-runner.mjs`（P0-B `runSuite Promise.all` + `tokenSink` 独立后求和；P1-C `executeClaudeDryRun` 缓存层 + `opts.cacheKey`；P2-B `opts.skipDryRun`）
- `tools/intake.mjs`（P0-C try/catch 清理；P1-A `opts.scope` 分流；P1-B `install_hint` 写入）
- `tools/intake-fetch.mjs`（P1-A `assertPublicUrl` 复用；`fetchUpstream` 保留 vendored scope）
- `tools/intake-remote.mjs`（P1-A 新增）
- `schema/upstream-ref.schema.json`（P1-B 加 `install_hint` 字段，`additionalProperties:false` 保留）
- `install.mjs`（P1-B `findCapabilitySource` 加查 `_drafts/_staged/third-party/` + `installFromGit` + `main() --from-git`）
- `tools/inventory.mjs`（P1-B 加 `intakeScope` 字段，不动既有 +17 行）
- `templates/interview-script.md`（P1-C 新增，落 `templates/` 根）
- `templates/readme-template.zh.md`（P2-B 新增）
- `tools/regression-sink.mjs`（P2-A `generateCase` 并发）
- `tools/opsforge.mjs cmdEvolve`（P2-A 并发）
- `tools/report-renderer.mjs`（不改——已有 `report-templates/*.zh.md` 外置）
- 测试：`tools/opsforge.test.mjs`（+5 print）/ `tools/test-runner.test.mjs`（+2 并行 +3 缓存 +2 skip-dry-run）/ `tools/intake.test.mjs`（+4 reference-scope）/ `tools/intake-fetch.test.mjs`（+2 fetchRemoteMeta）/ `tools/install-registry.test.mjs`（+3 findCapabilitySource + installFromGit）/ `tools/regression-sink-quadrant.test.mjs`（+3 并发）
