# OpsForge 三痛点优化 · 架构与技术规格

> 产出：architect（2026-08-06）。基于 `docs/design-archive/optimization-proposal.md`（planner 权威需求源，457 行）+ 当前代码实测（`tools/opsforge.mjs` / `tools/test-runner.mjs` / `tools/intake.mjs` / `tools/intake-fetch.mjs` / `install.mjs` / `schema/upstream-ref.schema.json` / `tools/inventory.mjs` / `tools/catalog-model.mjs` / `tools/regression-sink.mjs` / `tools/report-renderer.mjs` / 5 个 opsforge-meta agent/skill prompt）。
> 本文档与 `capability-creation-methodology-impl-plan.md` §G 的 per-tool 精确改动规格写法对齐：每个 slice 给出文件路径、函数签名、数据流、边界条件、回滚、与未提交工作的叠加点。
> 不变量守护逐条标注（§F），与 `capability-creation-methodology-impl-plan.md` 的 HARD INVARIANTS 表对齐。

## 0. 现状接口实测摘要（实现者必读）

以下行号基于当前 HEAD（未提交工作除外，已在 §E 标注叠加点）。

### 0.1 `tools/opsforge.mjs`（cmdPrint / main dispatch 现状）

- `main(argv)` line 46：`switch (cmd)` dispatch。现有分支：`menu` / `new` / `install` / `status` / `doctor` / `discover` / `report` / `feedback` / `wizard` / `evolve` / `evals-import` / `evals-export` / `benchmark` / `set-phase`。**无 `print` 分支**（P0-A 新增）。
- `cmdMenu(rl, opts)` line 127：`menu()` 是 `console.log(['...7 选项中文菜单...'].join('\n'))`，line 129-143 的字符串数组是**单一真相源**。
- `cmdNewFlow(rl, opts)` line 171：`console.log` 3 选项子菜单（line 173-177），分支 ③ 路由到 `cmdIntakeFlow`（line 179-180）。
- `cmdWizard(rl, opts)` line 271：`console.log` 2 选项路由（line 273-275）。
- `cmdIntakeFlow(rl, opts)` line 210：早退守卫 line 215-219（空 URL / 非 https / 非法 kind）+ 失败提示 line 235。
- `promptInstallFlow(rl, opts)` line 564：5 步提示 line 569-584。
- `printPushReminder()` line 203：export function。
- `cmdDiscover` line 308：空文案 line 323 / 已装文案 line 334。
- `cmdStatus` line 418：状态渲染 line 424-425。
- `cmdDoctor` line 453：健康渲染 line 460-463。
- `cmdFeedback(rl, opts)` line 510：提示 line 514-529。
- `cmdEvolve(rl, opts)` line 644：流程提示 line 666-700；`for (const i of idxs) { generateCase(...) }` line 685-696 **串行**（P2-A 并行化目标）。

### 0.2 `tools/test-runner.mjs`（runSuite / runCase / resolveClaudeBin 现状）

- `runSuite(capDir, opts)` line 816：`const tokenSink = { input: 0, output: 0 }` line 835；`for (const c of cases) { const v = await runCase(capDir, c, { ...opts, runner, platform, tokenSink }); verdicts.push(v); }` line 836-839 **串行**；`buildSummary(verdicts, runner)` line 842；`summary.token_total = tokenSink.input + tokenSink.output` line 843；`atomicWrite(runDir/results.json, ...)` line 848 **单次写入**。
- `runCase(capDir, caseYaml, opts)` line 424：签名 `{runner, platform, tokenSink, ...opts}` → 返回 verdict `{case, mode, pass, runner, reason, actual?, score?}`。`opts.tokenSink` 被 `executeClaudeDryRun` / `executeMultiTurnDryRun` 在 `proc.on('close')` 回调里**直接 mutate**（line 801-804）。
- `resolveClaudeBin()` line 50：返回 `{bin, prefix, env}` 或 `null`；Windows 直探 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`；`env.CLAUDECODE='1'`。**未提交工作**（+131 行）。
- `executeClaudeDryRun(capDir, caseYaml, opts)` line 603：**已支持 `opts.baselineSystemPrompt`**（line 620-621），P1-C 缓存的 `systemPrompt hash` 须基于这个值。
- `executeMultiTurnDryRun(capDir, caseYaml, opts)` line 681：同样读 `opts.baselineSystemPrompt`（line 686-687）。

### 0.3 `tools/intake.mjs` + `intake-fetch.mjs`（intake 现状）

- `intake(args)` line 21：args `{repoUrl, license, kind, name, owner, repoRoot?, execFile?, dest?, commercial?, commercialReason?, intakeScope?}`。流程：`fetchUpstream` (line 30) → `checkLicense` (line 35) → `scaffold` (line 41-45) → 写 `upstream-ref.json` (line 48-58)。**无 try/catch**（P0-C 补）。`intake_scope: args.intakeScope || 'vendored'` line 56（默认 vendored；reference scope schema 已支持，代码未分流）。
- `fetchUpstream(url, opts)` line 149：返回 `{dir, commit, sizeBytes}`。`execFile` 可注入（测试用）。`MAX_INTAKE_BYTES = 50MB` line 11。`dir` 在 size 超限时清理（line 160-162），但 license fail / scaffold fail 时**不清理**（P0-C 补）。
- `assertPublicUrl(url, opts)` line 83：export，**复用点**。守卫：https-only（line 84）+ shell-metachar 拒绝（line 88）+ SSRF patterns（line 91）+ DNS rebinding（line 99-118，`opts.lookup` 可注入）。返回 `void`，throw `Error`。

### 0.4 `install.mjs`（findCapabilitySource / main 现状）

- `findCapabilitySource(capId, repoRoot)` line 64：搜索 `packs/<pack>/<kind>/<name>`（line 70-73）+ `customers/<brand>/packs/<brand>/<kind>/<name>`（line 74-83）。**不查 `_drafts/third-party/` / `_staged/third-party/`**（P1-B 扩展）。
- `main()` line 644：dispatch `--install` / `--profile` / `--uninstall` / `--list` / `--doctor` / `--run-workflow` / `--list-runs` / `--abort` / `--resume`。**无 `--from-git`**（P1-B 新增）。
- `install({platform, capId, version, brand, project, dryRun, downgrade, repoRoot, opsforgeHome})` line 159：export，调 `findCapabilitySource`（line 167），找不到 throw。

### 0.5 `schema/upstream-ref.schema.json`

- `additionalProperties: false` line 7（不动）。
- `required: ["repo","commit","license","intaked_at","intaked_by","commercial","intake_scope"]` line 8。
- `properties`：repo / commit / license / intaked_at / intaked_by / commercial / commercial_reason / intake_scope (enum `["full","partial","vendored","reference"]`)。**无 `install_hint`**（P1-B 新增）。

### 0.6 `tools/inventory.mjs`（buildInventory 输出 shape）

- 每个 entry 字段（line 188-212）：`id, version, kind, pack, owner, customer, display_name_zh, display_name_en, description, detail, scenarios, scenarioTag, platformSupport, light, qualityReports, dependsOn, sourceOrigin, releasedAt, state, scope, brand, example, dir`。**无 `intakeScope`**（P1-B 加一行）。
- `sourceOrigin`（line 205）：`cap.yaml.source?.origin || 'original'`（值 `original` / `third-party`），与 `intake_scope`（`full`/`reference`）正交。

### 0.7 `tools/catalog-model.mjs`（未提交工作，叠加点）

- `publicEntry(entry, platforms)` line 69：产 `{id, version, name, ..., source, quality, ..., availability: entry.example ? 'reference-only' : 'usable', usage}`。
- `buildCatalogSnapshot(opts)` line 91：从 `buildInventory` 派生，filter `state === 'released'`。
- `sourceFor(entry)` line 18：`entry.sourceOrigin !== 'original' || entry.pack === 'third-party'` → `{key: 'third-party', label: '第三方'}`。

### 0.8 `tools/regression-sink.mjs`（generateCase 现状）

- `generateCase(feedback, failure, opts)` line 71：**同步函数**（非 async）。返回 `{destPath, name, yaml}`。`resolveNameConflict(baseName, opts.draftsDir)` line 80 处理文件名冲突。写 `case-NN.yaml` line 108。
- `cmdEvolve` line 685-696：`for (const i of idxs) { generateCase(fb, fail, { draftsDir }); }` 串行调用。**generateCase 同步**——P2-A 并行化需先把它 async 化或用 `Promise.all` 包同步写（同步写 IO 在 Promise 里仍串行，但 CPU 时间可忽略；真正收益在 distiller 的 LLM 步骤，不在 generateCase 本身）。

### 0.9 `tools/report-renderer.mjs`（已外置模板现状）

- `TEMPLATES_DIR = path.join(__dirname, 'report-templates')` line 8。
- `renderValidation(reportJson)` line 92：读 `validation-report.zh.md` line 93。
- `renderEval` / `renderSecurity` 同理读 `eval-report.zh.md` / `security-report.zh.md`。
- `renderRunLight(opts)` line 39：读 `run-light.zh.md` line 40。
- **4 处固定内容已外置**——P0-A `cmdPrint` 复用这同一 `TEMPLATES_DIR`。

### 0.10 SKELETON_GUARD_EXCLUSIONS（两处 twin）

- `tools/new-capability.mjs:24`：`['.opsforge-state.json','validation-report.json','security-report.json','eval-report.json','interview.md','upstream-ref.json']`。
- `tools/validate.mjs:37`：`['.opsforge-state.json','validation-report.json','security-report.json','eval-report.json','benchmark-report.json','interview.md','upstream-ref.json']`。
- 两处已含 `interview.md` / `upstream-ref.json`。P1-C `interview-script.md` 落 `templates/` 根（非 `templates/<kind>/`），**不改这两处 exclusion**（落 `templates/` 根的文件不参与任何 kind 的 skeleton 签名）。

### 0.11 Agent/Skill prompt 现状（5 处固定内容出口）

- `packs/opsforge-meta/agents/opsforge/source.md:50` `## 运行指令`：英文 system prompt，"present the 7-option Chinese top menu..."，**丢 ③ 第三方分支**（实测 bug）。
- `packs/opsforge-meta/agents/capability-interviewer/source.md:54-66` `## 运行指令`：5 触点内联叙述。
- `packs/opsforge-meta/agents/capability-distiller/source.md:55-67` `## 运行指令`：5 步内联叙述。
- `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md:53-63` `## 运行指令`：4 期路由内联叙述。
- `packs/opsforge-meta/skills/opsforge-interview/SKILL.md:52-64` `## 运行指令`：5 触点纯 prompt 形态（与 interviewer 同源）。

---

## A. 实现顺序总览（依赖序，非 P0/P1/P2）

| 序 | slice | 依赖 | 可并行？ |
|----|------|------|---------|
| 1 | P0-A `cmdPrint` + agent prompt 改调 CLI | 无 | ✅ 与 P0-B / P0-C / P1 全部并行 |
| 2 | P0-B `runSuite` Promise.all 并行化 | 无（叠加 resolveClaudeBin 未提交工作） | ✅ 与 P0-A / P0-C / P1 并行 |
| 3 | P0-C intake 失败回滚 | 无 | ✅ 与 P0-A / P0-B 并行 |
| 4 | P1-A `intake-remote.mjs` + `intake.mjs scope` 分流 | 依赖 P0-C（失败回滚路径要覆盖 reference scope） | P0-C 完成后启动；与 P1-B 强耦合（同 PR） |
| 5 | P1-B schema `install_hint` + `findCapabilitySource` 扩展 + `installFromGit` | 依赖 P1-A（`install_hint` 由 `intake-remote` 写入） | 与 P1-A 同 PR；与 P2-B 的 `install_hint` 文档强耦合 |
| 6 | P1-C 外置访谈脚本 + dry-run 缓存 | 无 | ✅ 与 P1-A/B 并行 |
| 7 | P2-A distill 并行化 + `cmdEvolve` 并行 | 依赖 P0-B（叠加同一 `Promise.all` 模式） | P0-B 完成后启动 |
| 8 | P2-B `--skip-dry-run` + `install_hint` 文档 + 中文 README 模板 | 依赖 P1-B（`install_hint` 字段已加） | P1-B 完成后启动 |

**建议 PR 切分**：
- PR1：P0-A + P0-B + P0-C（三痛点 P0，互不依赖，同 PR 控制冲突）。
- PR2：P1-A + P1-B（reference-scope 端到端，强耦合）。
- PR3：P1-C（外置访谈脚本 + 缓存，独立）。
- PR4：P2-A + P2-B（distill 并行 + skip-dry-run + 文档，收尾）。

---

## B. Slice 接口契约

### B.1 P0-A：`cmdPrint` 子命令 + agent prompt 改调 CLI

#### B.1.1 `cmdPrint(args, opts)` 签名

```js
/**
 * opsforge print <topic> — emit fixed-content strings verbatim to stdout.
 * Single source of truth: PRINT_TOPICS map. 既有 console.log 函数改为调同一常量，
 * 避免双源真相。
 * @param {string[]} args  argv.slice(1) after 'print'; args[0] = topic
 * @param {{out?: (s: string) => void}} opts  opts.out 默认 console.log
 * @returns {Promise<number>} 0=success, 1=unknown topic
 */
export async function cmdPrint(args, opts = {}) {
  const out = opts.out || console.log;
  const topic = args[0];
  const content = PRINT_TOPICS[topic];
  if (!content) {
    console.error(`opsforge print: unknown topic "${topic}"`);
    console.error(`available: ${Object.keys(PRINT_TOPICS).join(', ')}`);
    return 1;
  }
  out(content);
  return 0;
}
```

#### B.1.2 `PRINT_TOPICS` 常量定义

```js
/**
 * PRINT_TOPICS — 固定内容单一真相源。
 * 既有 cmdMenu/cmdNewFlow/cmdWizard 等改为读这里的字符串再 console.log，
 * 与 `print` 子命令共用同一源（避免双源真相）。
 * report-templates/*.zh.md 仍由 report-renderer.mjs 读（print 复用同一模板文件）。
 */
const PRINT_TOPICS = {
  'menu': MENU_TEXT,            // line 129-143 的 7 选项数组 join('\n')
  'new-flow': NEW_FLOW_TEXT,    // line 173-177 的 3 选项
  'wizard-routing': WIZARD_ROUTING_TEXT, // line 273-275 的 2 选项
  'install-flow': INSTALL_FLOW_TEXT,     // line 569-584 的 5 步提示
  'intake-guards': INTAKE_GUARDS_TEXT,   // line 215-219 + 235 的拒绝文案
  'push-reminder': PUSH_REMINDER_TEXT,   // line 203-205
  'discover-empty': DISCOVER_EMPTY_TEXT, // line 323
  'discover-installed': DISCOVER_INSTALLED_TEXT, // line 334
  'doctor-healthy': DOCTOR_HEALTHY_TEXT, // line 460-463
  'status-state': STATUS_STATE_TEXT,     // line 424-425
  'evolve-flow': EVOLVE_FLOW_TEXT,       // line 666-700
  'feedback-prompt': FEEDBACK_PROMPT_TEXT, // line 514-529
  'report-header': '=== {{type}} ({{verdict}}) ===', // line 366 模板
  'error-recovery': ERROR_RECOVERY_TEXT, // line 162-163 三段式
  'interview-touchpoints': INTERVIEW_TOUCHPOINTS_TEXT, // interviewer source.md line 54-66 抽取
  'distiller-steps': DISTILLER_STEPS_TEXT,             // distiller source.md line 55-67 抽取
  'wizard-phases': WIZARD_PHASES_TEXT,                 // wizard SKILL.md line 53-63 抽取
};
```

**topic 枚举（16 项）**：`menu` / `new-flow` / `wizard-routing` / `install-flow` / `intake-guards` / `push-reminder` / `discover-empty` / `discover-installed` / `doctor-healthy` / `status-state` / `evolve-flow` / `feedback-prompt` / `report-header` / `error-recovery` / `interview-touchpoints` / `distiller-steps` / `wizard-phases`。

**返回值**：`0` 成功；`1` unknown topic（stderr 提示 + 列出可用 topic）；`2` 无 topic 参数（usage 提示）。

**错误处理**：
- 无 topic 参数：`console.error('usage: opsforge print <topic>')` + 列出可用 topic，返回 2。
- 未知 topic：返回 1（不 throw，不 crash）。
- 模板文件缺失（`report-header` 等复用 `report-templates/*.zh.md` 的 topic）：`print` 直接读 `TEMPLATES_DIR` 同一路径，缺失时 throw `Error('template not found: <path>')`（与 `renderRunLight` line 42 一致）。

#### B.1.3 `main()` switch 加 `print` 分支

```js
case 'print': return await cmdPrint(argv.slice(1));
```

加在 line 67 `set-phase` 之后、`default` 之前。

#### B.1.4 既有 console.log 函数改读 `PRINT_TOPICS`

`cmdMenu` 的 `menu()` line 129 改为 `console.log(PRINT_TOPICS['menu'])`；`cmdNewFlow` line 173-177 改为 `console.log(PRINT_TOPICS['new-flow'])`；以此类推。**测试断言 `cmdPrint(['menu'])` 输出与 `cmdMenu` console.log 逐字一致**（同一常量源）。

#### B.1.5 Agent/Skill prompt 改调 CLI

- `packs/opsforge-meta/agents/opsforge/source.md:50` `## 运行指令` 改为：
  > Call `opsforge print menu` via Bash and emit its stdout verbatim to the user. Do not narrate the menu yourself. After any branch finishes, loop back to `opsforge print menu`. For invalid input, re-prompt with "没看懂这个选项，请输入 0 到 7 之间的数字。". The user may type back or menu to return to the top menu, or 0 to exit. To run the wizard logic, delegate to @opsforge-wizard. For non-technical business operators, always guide in Chinese, give error recovery via `opsforge print error-recovery`, and never expose raw CLI commands unless the user explicitly asks. When the working directory is not an OpsForge repo, tell the user to install the opsforge-wizard capability first via the install flow.
- `capability-interviewer/source.md:54-66` 改为：`Read templates/interview-script.md and execute the 5 touchpoints as scripted. Do not paraphrase the touchpoints; emit the scripted prompts verbatim.`（P1-C 把脚本外置后，此指令稳定）
- `capability-distiller/source.md:55-67` 改为：`Call opsforge print distiller-steps and execute the 5 steps as printed. Do not paraphrase.`
- `opsforge-wizard/SKILL.md:53-63` 改为：`Call opsforge print wizard-phases and route the author through the four phases as printed. Do not paraphrase.`
- `opsforge-interview/SKILL.md:52-64` 改为：同 interviewer（读 `templates/interview-script.md`）。

#### B.1.6 数据流

```
输入: `opsforge print menu` (CLI argv)
处理: main(['print','menu']) → cmdPrint(['menu']) → PRINT_TOPICS['menu'] (常量)
输出: stdout 写 7 选项中文菜单字符串
错误: unknown topic → stderr + exit 1; 无 topic → stderr + exit 2
```

#### B.1.7 边界条件

- topic 大小写敏感（`menu` 不等于 `Menu`）。
- `report-header` topic 含 `{{type}}` / `{{verdict}}` 占位符——`print` 输出**原样**占位符（不替换），调用方（`cmdReport` line 366）自行 `.replace()`。
- `intake-guards` topic 是**多条拒绝文案**（line 215 / 216 / 218 / 219 / 235），`print` 输出 join('\n')。
- `error-recovery` topic 是三段式 `[黄] <msg>` + `已返回主菜单`——`print` 输出**模板**（含 `<msg>` 占位符），调用方替换。

#### B.1.8 风险与回滚

- **风险**：agent `source.md` 改后须重新过 `validate.mjs --all`（R27 `## 运行指令` ≥80 token——`print` 调用指令文本须够长，实测改后 prompt 仍 >80 token，通过）。`PRINT_TOPICS` 常量与既有 console.log 输出**逐字一致**（测试断言字符串相等），否则 agent 行为变。
- **回滚**：删 `cmdPrint` + `main()` switch `print` 分支 + `PRINT_TOPICS` 常量；agent `source.md` revert 到自由叙述版本；既有 console.log revert 直接写字符串。`PRINT_TOPICS` 抽常量是**纯重构**，revert 零代价。

---

### B.2 P0-B：`runSuite` Promise.all 并行化

#### B.2.1 新 `runSuite` 签名（不变，内部改并行）

```js
/**
 * @param {string} capDir
 * @param {{runner?: string, platform?: string, opsforgeHome?: string,
 *          concurrency?: number, refresh?: boolean, skipDryRun?: boolean,
 *          cacheKey?: string}} opts
 * @returns {Promise<{cases: Verdict[], summary: SuiteSummary}>}
 */
export async function runSuite(capDir, opts = {}) {
  // ... 读 cases 不变 (line 822-831)
  const runner = opts.runner || (isStaticOnly() ? 'static-only' : 'claude');
  const platform = opts.platform || 'claude-code';
  const opsforgeHome = opts.opsforgeHome || resolveOpsforgeHome();

  const concurrency = opts.concurrency
    || Number(process.env.OPSFORGE_RUNNER_CONCURRENCY)
    || cases.length; // 默认全并发；env=1 回退串行

  const verdicts = await runCasesConcurrent(capDir, cases, {
    ...opts, runner, platform, concurrency,
  });

  const tokenSink = { input: 0, output: 0 }; // 聚合后填
  // runCasesConcurrent 返回 {verdicts, sinks}，sinks 求和填入 tokenSink
  // ... buildSummary + atomicWrite 不变 (line 842-848)
}
```

#### B.2.2 `runCase` 返回值变化（tokenSink 独立化）

**旧**（line 836-839）：
```js
const tokenSink = { input: 0, output: 0 };
for (const c of cases) {
  const v = await runCase(capDir, c, { ...opts, runner, platform, tokenSink });
  verdicts.push(v);
}
```
`tokenSink` 被所有 case 共享 mutate（竞态隐患）。

**新**：
```js
/**
 * 并发执行 cases，每个 case 拿独立 tokenSink，Promise.all 后求和聚合。
 * @param {string} capDir
 * @param {Object[]} cases
 * @param {{runner: string, platform: string, concurrency: number}} opts
 * @returns {Promise<{verdicts: Verdict[], tokenSink: {input: number, output: number}}>}
 */
async function runCasesConcurrent(capDir, cases, opts) {
  const { concurrency } = opts;
  const sinks = cases.map(() => ({ input: 0, output: 0 }));
  // 分批并发：concurrency=N 一批，避免一次 spawn 20 个 claude.exe
  const verdicts = new Array(cases.length);
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((c, j) =>
      runCase(capDir, c, { ...opts, tokenSink: sinks[i + j] })
    ));
    for (let j = 0; j < batchResults.length; j++) verdicts[i + j] = batchResults[j];
  }
  const tokenSink = { input: 0, output: 0 };
  for (const s of sinks) { tokenSink.input += s.input; tokenSink.output += s.output; }
  return { verdicts, tokenSink };
}
```

**关键不变量**：
- `verdicts` 数组顺序与 `cases` 顺序一致（`Promise.all` 保持输入顺序 + 分批索引对齐）。
- `buildSummary(verdicts, runner)` 不变——`summary.token_total` 用聚合后的 `tokenSink`。
- `results.json` 仍单次 `atomicWrite`（`Promise.all` 完成后）。
- `executeClaudeDryRun` / `executeMultiTurnDryRun` 的 `opts.tokenSink` mutate 契约不变（line 801-804），但每个 case 拿独立 sink，无竞态。

#### B.2.3 数据流

```
输入: cases[] (yaml 测试用例)
处理:
  1. 为每个 case 分配独立 tokenSink
  2. 分批 Promise.all(concurrency=N) 调 runCase
  3. 每 case 内部 executeClaudeDryRun spawn claude.exe，CLAUDECODE=1 env 避免嵌套挂起
  4. Promise.all 完成后 sinks 求和 → tokenSink
  5. buildSummary + atomicWrite results.json（单次）
输出: {cases: verdicts, summary} （顺序与输入一致）
```

#### B.2.4 边界条件

- `concurrency=1`：等价串行（`OPSFORGE_RUNNER_CONCURRENCY=1` 回退）。
- `cases.length=0`：`Promise.all([])` 返回 `[]`，`tokenSink` 全 0，`buildSummary` 处理 `total=0`。
- `cases.length=1`：`Promise.all` 单元素数组，无并发收益但无退化。
- `runCase` reject（spawn ENOENT / timeout）：`Promise.all` 整批 reject → `runSuite` throw（与串行行为一致：串行时 throw 也会冒泡）。**可选增强**：`await Promise.allSettled(...)` 把 rejected 的转 `{pass:false, reason:'execution error: <e.message>'}`，避免单 case 失败拖垮整批。**建议用 `allSettled`**（更稳）。
- 多 `claude.exe` 并发可能触发 API rate limit——`CLAUDECODE=1` env 已避免嵌套挂起，但 API 层 rate limit 不在代码层控制；缓解：默认 `concurrency=cases.length`（≤3 时安全），高并发场景用户设 `OPSFORGE_RUNNER_CONCURRENCY=2`。

#### B.2.5 风险与回滚

- **风险**：并发 spawn 多个 `claude.exe` 在低配机器 OOM 或 API rate limit。缓解：`concurrency` 可调 + `allSettled` 不拖垮整批。
- **回滚**：revert `runCasesConcurrent` 回 `for` 循环；`tokenSink` 恢复共享。测试断言并发 + 串行结果一致（同 input 同 expected）。

---

### B.3 P0-C：intake 失败回滚

#### B.3.1 `intake(args)` 加 try/catch

```js
export async function intake(args) {
  const { repoUrl, license, kind, name, owner } = args;
  const repoRoot = args.repoRoot || process.cwd();
  // ... 参数校验不变 (line 24-26)

  let cloneDir = null;      // fetchUpstream 返回的临时 clone 目录
  let draftPath = null;     // scaffold 产出的 _drafts/third-party/<name>/
  try {
    // 1. Fetch upstream
    const fetched = await fetchUpstream(repoUrl, { execFile: args.execFile, dest: args.dest });
    cloneDir = fetched.dir;
    const commit = fetched.commit;
    const sizeBytes = fetched.sizeBytes;

    // 2. Check license
    const lic = await checkLicense(license, args);
    if (!lic.allowed) throw new Error(`intake: license "${license}" not allowed — ${lic.reason}`);

    // 3. Scaffold
    const { scaffold } = await import('./new-capability.mjs');
    const result = scaffold({ kind, slug: 'third-party', name, thirdParty: repoUrl,
      root: repoRoot, templatesDir: DEFAULT_TEMPLATES });
    draftPath = result.destPath;

    // 4. Write upstream-ref.json
    const ref = { /* ... 不变 ... */ };
    atomicWriteSync(path.join(draftPath, 'upstream-ref.json'), JSON.stringify(ref, null, 2));

    return { allowed: true, commit, draftPath, sizeBytes };
  } catch (e) {
    // 失败回滚：清理 clone 临时目录 + 半成品 draft（除非 --keep-on-fail）
    if (!args.keepOnFail) {
      if (cloneDir) try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      if (draftPath) try { fs.rmSync(draftPath, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    throw e; // 重新 throw，让 cmdIntakeFlow / CLI 报错
  }
}
```

#### B.3.2 数据流

```
输入: intake({repoUrl, license, kind, name, owner, ...})
处理:
  1. fetchUpstream → cloneDir (临时 .opsforge-intake/intake-<ts>/)
  2. checkLicense → throw if not allowed
  3. scaffold → draftPath (_drafts/third-party/<kind>/<name>/)
  4. write upstream-ref.json
  catch: 任一步失败 → 清理 cloneDir + draftPath
输出: {allowed, commit, draftPath, sizeBytes} 或 throw
```

#### B.3.3 边界条件

- `fetchUpstream` 内部已在 size 超限时清理 cloneDir（line 160-162）——`intake` catch 块的 `rmSync(cloneDir)` 是**幂等**的（`fs.rmSync({force:true})` 对不存在的目录不报错）。
- `scaffold` 失败时 `draftPath` 仍为 `null`，catch 块跳过 draft 清理。
- `keepOnFail=true`（`--keep-on-fail` 旗标）：不清理，供调试。CLI 默认不传此旗标。
- license fail：`cloneDir` 已创建（fetch 成功）但 license 不通过 → catch 清理 cloneDir（避免 50MB clone 残留）。draftPath 未创建（scaffold 未执行）。

#### B.3.4 风险与回滚

- **风险**：清理 `_drafts/third-party/<name>/` 时若作者已手动填了字段会丢。但 intake 失败时半成品不可用（license 不通过），清理是对的。`--keep-on-fail` 旗标供调试。
- **回滚**：revert try/catch；半成品残留由作者手动删。

---

### B.4 P1-A：`tools/intake-remote.mjs`（API LICENSE fetch，不 clone）

#### B.4.1 `fetchRemoteMeta(url, opts)` 签名

```js
/**
 * Fetch upstream metadata via API (no clone). GitHub: /repos/<o>/<r>/license
 * + /repos/<o>/<r>/commits/HEAD. 非 GitHub: git ls-remote (argv, no shell).
 * 复用 assertPublicUrl 全套 SSRF 守卫。
 * @param {string} url  https public git URL
 * @param {{fetch?: Function, execFile?: Function, lookup?: Function,
 *          githubToken?: string}} opts
 *   opts.fetch 可注入（测试）；opts.githubToken 透传 Authorization header 避免 rate limit。
 * @returns {Promise<{repo: string, commit: string, license: string,
 *                     sizeBytes: null, intakeScope: 'reference'}>}
 * @throws {Error} URL 不合法 / SSRF / API 失败 / ls-remote 失败
 */
export async function fetchRemoteMeta(url, opts = {}) {
  await assertPublicUrl(url, { lookup: opts.lookup }); // 复用 SSRF 守卫
  const gh = parseGitHubUrl(url); // {owner, repo} 或 null
  if (gh) {
    return await fetchGitHubMeta(gh, url, opts);
  }
  return await fetchViaLsRemote(url, opts);
}
```

#### B.4.2 返回 shape

```js
{
  repo: url,                              // 原 git URL（写入 upstream-ref.repo）
  commit: '<short sha>',                  // GitHub API /repos/.../commits/HEAD 或 git ls-remote HEAD
  license: 'MIT' | 'Apache-2.0' | 'UNKNOWN', // GitHub API license.spdx_id；非 GitHub 用 'UNKNOWN'（作者手填）
  sizeBytes: null,                         // reference scope 不 clone
  intakeScope: 'reference',
}
```

#### B.4.3 SSRF 守卫复用点

`fetchRemoteMeta` 第一行 `await assertPublicUrl(url, { lookup: opts.lookup })`（intake-fetch.mjs line 83 export）。**全套守卫保留**：https-only（line 84）+ shell-metachar 拒绝（line 88）+ SSRF patterns（line 91）+ DNS rebinding（line 99-118）。reference-scope 只存 URL 不 clone，但仍过 SSRF 门。

#### B.4.4 GitHub URL 解析

```js
function parseGitHubUrl(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}
```

#### B.4.5 `fetchGitHubMeta` 实现

```js
async function fetchGitHubMeta(gh, url, opts) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (opts.githubToken || process.env.OPSFORGE_GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${opts.githubToken || process.env.OPSFORGE_GITHUB_TOKEN}`;
  }
  const base = `https://api.github.com/repos/${gh.owner}/${gh.repo}`;
  // 并发查 license + commit
  const [licResp, commitResp] = await Promise.all([
    fetchImpl(`${base}/license`, { headers }),
    fetchImpl(`${base}/commits/HEAD`, { headers }),
  ]);
  let license = 'UNKNOWN';
  if (licResp.ok) {
    const data = await licResp.json();
    license = (data.license && data.license.spdx_id) || 'UNKNOWN';
  }
  let commit = 'unknown';
  if (commitResp.ok) {
    const data = await commitResp.json();
    commit = (data.sha || '').slice(0, 7) || 'unknown';
  }
  return { repo: url, commit, license, sizeBytes: null, intakeScope: 'reference' };
}
```

#### B.4.6 `fetchViaLsRemote` 实现（非 GitHub 回退）

```js
async function fetchViaLsRemote(url, opts) {
  const execFile = opts.execFile
    || ((cmd, args, o) => execFileSync(cmd, args, { encoding: 'utf8', ...o }));
  // argv 形式，无 shell——N2 RCE 守卫保留
  let out;
  try {
    out = execFile('git', ['ls-remote', url, 'HEAD'], { stdio: ['pipe','pipe','pipe'] });
  } catch (e) {
    throw new Error(`intake-remote: git ls-remote failed for ${url}: ${e.message}`);
  }
  // 输出格式: <sha>\tHEAD
  const commit = (out.split('\t')[0] || '').slice(0, 7) || 'unknown';
  return { repo: url, commit, license: 'UNKNOWN', sizeBytes: null, intakeScope: 'reference' };
}
```

#### B.4.7 `intake.mjs` 加 `opts.scope` 分流

```js
export async function intake(args) {
  // ... 参数校验不变
  const scope = args.scope || 'full'; // 'full' | 'reference'
  let fetchResult;
  if (scope === 'reference') {
    fetchResult = await fetchRemoteMeta(repoUrl, {
      fetch: args.fetch, execFile: args.execFile, lookup: args.lookup,
      githubToken: args.githubToken,
    });
  } else {
    fetchResult = await fetchUpstream(repoUrl, { execFile: args.execFile, dest: args.dest });
    // fetchResult = {dir, commit, sizeBytes} — 与 reference shape 不同
  }
  // ... license check + scaffold 不变
  const ref = {
    repo: repoUrl,
    commit: fetchResult.commit,
    license: lic.spdx || license,
    intaked_at: new Date().toISOString(),
    intaked_by: owner || 'unknown',
    commercial: !!args.commercial,
    // ...
    intake_scope: scope,
    ...(scope === 'reference' ? { install_hint: `${repoUrl};${kind};${name}` } : {}),
  };
  // reference scope: 不 clone，无 dir 需清理；full scope: cloneDir 须清理
  // ...
}
```

#### B.4.8 `cmdIntakeFlow` 加 scope 问

```js
// cmdIntakeFlow (opsforge.mjs:210) 加：
const scopeCh = (await ask('收录方式 ① 完整克隆（vendored，克隆到本地）② 只存 git 地址（reference，不克隆，安装时拉取）（回车=②）: ')).trim() || '2';
const scope = scopeCh === '1' ? 'full' : 'reference';
// intake 调用加 scope：
const r = await intake({ repoUrl, license, kind, name, owner, repoRoot: workDir, scope });
```

#### B.4.9 边界条件

- GitHub API 404（仓库不存在）：`licResp.ok` / `commitResp.ok` false → `license='UNKNOWN'` / `commit='unknown'`，**不 throw**（让 `checkLicense` 把关 license；commit 'unknown' 进 upstream-ref）。
- GitHub API rate limit（403）：`fetchImpl` 不 throw（返回 403 resp）→ `license='UNKNOWN'`。**可选**：403 时 throw 提示用户设 `OPSFORGE_GITHUB_TOKEN`。
- 非 GitHub URL（gitlab / bitbucket / 自建）：`parseGitHubUrl` 返回 `null` → `fetchViaLsRemote`。`ls-remote` 失败 throw。
- `fetch` 全局不可用（Node < 18）：`fetchImpl` undefined → throw `fetch unavailable`。Node 22 LTS 默认有 fetch（§C.1 pinned baseline）。

#### B.4.10 风险与回滚

- **风险**：GitHub API rate limit（未认证 60 req/h）。缓解：`OPSFORGE_GITHUB_TOKEN` env 透传。`install_hint` 字段格式须稳定（`<git>;<kind>;<name>[;<subpath>]`，分号分隔，`install.mjs --from-git` 解析）。
- **回滚**：删 `intake-remote.mjs`；`intake.mjs intake()` revert 只走 `fetchUpstream`；`cmdIntakeFlow` 删 scope 问。`schema/upstream-ref.schema.json` 的 `install_hint` 字段保留无碍（可选字段）。

---

### B.5 P1-B：schema `install_hint` + `findCapabilitySource` 扩展 + `installFromGit`

#### B.5.1 `schema/upstream-ref.schema.json` 加 `install_hint` 字段

```jsonc
"properties": {
  // ... 既有字段不动 ...
  "install_hint": { "type": ["string", "null"] }
}
```
- `additionalProperties: false`（line 7）不动。
- `required` 不加（可选字段）。
- `install_hint` 格式：`<git>;<kind>;<name>[;<subpath>]`（分号分隔；`<subpath>` 可选，默认空）。

#### B.5.2 `install.mjs findCapabilitySource` 扩展搜索

```js
function findCapabilitySource(capId, repoRoot) {
  // ... 既有 kindDirs 循环 (line 70-73) + customersDir 循环 (line 74-83) 不变 ...

  // P1-B: 加查 _drafts/third-party/ + _staged/third-party/
  for (const draftsRoot of ['_drafts', '_staged']) {
    for (const kd of kindDirs) {
      const thirdPartyDir = path.join(repoRoot, 'packs', draftsRoot, 'third-party', kd, name);
      if (findManifest(thirdPartyDir)) return thirdPartyDir;
    }
  }
  return null;
}
```

**注意**：`_drafts/` / `_staged/` 在 `packs/` 下（与既有 `packs/<pack>/<kind>/<name>` 同根），不是 repo root。

#### B.5.3 `installFromGit(gitUrl, kind, name, opts)` 签名

```js
/**
 * Install a capability from a git URL on-demand: clone-to-temp → install → cleanup.
 * 复用 fetchUpstream（SSRF + 50MB 上限 + argv form）。
 * @param {string} gitUrl  https public git URL
 * @param {string} kind  agent|skill|mcp|workflow|bundle
 * @param {string} name  capability name slug
 * @param {{platform: string, project?: string, brand?: string, opsforgeHome?: string,
 *          repoRoot?: string, execFile?: Function, dest?: string}} opts
 * @returns {Promise<{installed: string[], manifest: Object}>}
 */
export async function installFromGit(gitUrl, kind, name, opts) {
  const { fetchUpstream } = await import('./tools/intake-fetch.mjs');
  const tempDir = await fetchUpstream(gitUrl, { execFile: opts.execFile });
  try {
    const capDir = path.join(tempDir.dir, kind, name);
    if (!fs.existsSync(path.join(capDir, 'capability.yaml'))) {
      throw new Error(`install: ${kind}/${name} not found in ${gitUrl}`);
    }
    const { install } = await import('./install.mjs');
    // install({ capDir, platform, project, repoRoot, opsforgeHome }) — 既有签名
    return await install({
      ...opts,
      capDir, // install.mjs 支持 capDir 直传（须扩展 install() 签名）
    });
  } finally {
    try { fs.rmSync(tempDir.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
```

**install.mjs install() 签名扩展**：现有 `install({platform, capId, ...})` 用 `findCapabilitySource` 找 `capDir`。`installFromGit` 已知 `capDir`，须让 `install()` 支持直传 `capDir`：

```js
export async function install(args) {
  // ... 既有 ...
  const capDir = args.capDir || findCapabilitySource(capId, repoRoot);
  // ... 后续不变 ...
}
```

#### B.5.4 `install.mjs main()` 加 `--from-git` 分支

```js
} else if (argv.includes('--from-git')) {
  const idx = argv.indexOf('--from-git');
  const gitUrl = argv[idx + 1];
  const kind = argv.includes('--kind') ? argv[argv.indexOf('--kind') + 1] : 'agent';
  const name = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : '';
  if (!gitUrl || !name) {
    console.error('usage: node install.mjs --from-git <url> --kind <kind> --name <name> [--platform <p>] [--project <p>]');
    process.exit(2);
  }
  const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
  const project = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : 'default';
  const r = await installFromGit(gitUrl, kind, name, { platform, project });
  console.log(`installed from git: ${r.installed.join(', ')}`);
  process.exit(0);
}
```

#### B.5.5 `inventory.mjs buildInventory` 加 `intakeScope` 字段

```js
// inventory.mjs line 203-206 附近加一行：
const upstreamRef = readJsonOrNullSync(path.join(cap.dir, 'upstream-ref.json'));
// ... 既有 qualityReports/dependsOn/sourceOrigin/releasedAt ...
intakeScope: upstreamRef?.intake_scope || null,
installHint: upstreamRef?.install_hint || null,
```

**不动既有 +17 行增强**（`qualityReports` / `dependsOn` / `sourceOrigin` / `releasedAt`）。

#### B.5.6 数据流

```
intake --scope reference → upstream-ref.json {intake_scope:'reference', install_hint:'<git>;<kind>;<name>'}
                                            ↓
registry.yaml (release.mjs auto-gen, 不动)
                                            ↓
install --from-git <url> --kind <kind> --name <name>
  → installFromGit → fetchUpstream(clone-to-temp) → install(capDir) → cleanup temp
                                            ↓
install --install <capId> (既有路径) → findCapabilitySource 扩展查 _drafts/_staged/third-party/
```

#### B.5.7 边界条件

- `install_hint` 字段缺失（vendored scope 能力）：`findCapabilitySource` 正常找到 `packs/third-party/<kind>/<name>/`；`installFromGit` 不调。
- `install_hint` 格式错误（缺分号）：`installFromGit` 解析时 throw `install_hint format invalid`。
- `installFromGit` clone 时仍过 50MB 上限——大 repo 装不了（reference-scope 本就为轻量收录，大 repo 走 vendored scope）。
- `_drafts/third-party/` 能力未过 release gate（draft 状态）：`findCapabilitySource` 找到但 `install` 时 adapter conform 会挡（draft 缺报告）。**建议**：`findCapabilitySource` 扩展只查 `_staged/third-party/`，不查 `_drafts/`（draft 不可装）。

#### B.5.8 风险与回滚

- **风险**：`install_hint` 格式不稳会解析失败——加 schema 校验（ajv 测试断言 `install_hint` 接受 `<git>;<kind>;<name>` 与 `<git>;<kind>;<name>;<subpath>`）。
- **回滚**：`schema/upstream-ref.schema.json` 删 `install_hint`；`install.mjs findCapabilitySource` revert；`installFromGit` 删；`main() --from-git` 删；`inventory.mjs intakeScope/installHint` 删。

---

### B.6 P1-C：外置访谈脚本 + dry-run 缓存

#### B.6.1 `templates/interview-script.md` 新增

落 `templates/` 根（与 `interview-record.md` 同位，不计入任何 kind skeleton 签名——`SKELETON_GUARD_EXCLUSIONS` 不需改）。

内容：interviewer 5 触点的完整脚本（从 `capability-interviewer/source.md:54-66` 抽取 + 扩展，含成本预估文案、Mode A/B 分支、propose_and_confirm 模板、反锚定守卫触发文案）。

#### B.6.2 `capability-interviewer/source.md` + `opsforge-interview/SKILL.md` 改读文件

```md
## 运行指令

Read `templates/interview-script.md` and execute the 5 touchpoints as scripted.
Do not paraphrase the touchpoints; emit the scripted prompts verbatim.
For non-technical business operators, always guide in Chinese.
Produce `_drafts/<slug>/interview.md` using `templates/interview-record.md`.
End by calling `opsforge set-phase <capDir> interview_done` via Bash (transparent to the author).
Hand off in-session to @capability-distiller. Never fabricate handling for uncovered quadrants.
```

`opsforge-interview/SKILL.md` 同理（纯 prompt 形态：作者把脚本贴到任意 LLM）。

#### B.6.3 `executeClaudeDryRun` 加 dry-run 缓存

```js
import crypto from 'node:crypto';
import { atomicWrite, resolveOpsforgeHome } from './paths.mjs';

/**
 * Compute cache key: <capDir>:<caseName>:<systemPrompt hash>
 * @returns {string} sha256-based 16-char key, or null if no systemPrompt
 */
function computeCacheKey(capDir, caseYaml, systemPrompt) {
  if (!systemPrompt) return null;
  const raw = `${path.resolve(capDir)}:${caseYaml.name || ''}:${systemPrompt}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export async function executeClaudeDryRun(capDir, caseYaml, opts) {
  // ... 既有 systemPrompt 解析 (line 619-627) ...

  // P1-C: 缓存命中且 useCache=true → 直接返回缓存 actual
  const cacheKey = opts.cacheKey || computeCacheKey(capDir, caseYaml, systemPrompt);
  const useCache = opts.useCache !== false; // 默认 true
  if (useCache && cacheKey && !opts.refresh) {
    const cached = readCacheOrNull(cacheKey, opts.opsforgeHome);
    if (cached !== null) return cached;
  }

  // ... 既有 spawn claude -p (line 629-656) ...

  // 命中后写缓存
  if (cacheKey && !opts.refresh) {
    writeCache(cacheKey, stdout.trim(), opts.opsforgeHome);
  }
  return stdout.trim();
}

function readCacheOrNull(cacheKey, opsforgeHome) {
  const p = path.join(opsforgeHome || resolveOpsforgeHome(), 'runs', 'cache', `${cacheKey}.json`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).actual || null; }
  catch { return null; }
}

function writeCache(cacheKey, actual, opsforgeHome) {
  const p = path.join(opsforgeHome || resolveOpsforgeHome(), 'runs', 'cache', `${cacheKey}.json`);
  atomicWrite(p, JSON.stringify({ actual, ts: new Date().toISOString() }, null, 2));
}
```

#### B.6.4 `runSuite` 加 `opts.refresh` 旗标

```js
export async function runSuite(capDir, opts = {}) {
  // ... 既有 ...
  const refresh = opts.refresh || process.env.OPSFORGE_RUNNER_REFRESH === '1';
  // runCase 传 refresh + useCache
  const verdicts = await runCasesConcurrent(capDir, cases, {
    ...opts, runner, platform, concurrency,
    refresh, useCache: !refresh, cacheKey: opts.cacheKey,
  });
  // ... 既有 ...
}
```

**CLI flag**：`node tools/test-runner.mjs <capDir> --refresh` 强制重跑。

#### B.6.5 数据流

```
输入: runSuite({refresh: false})
处理:
  1. 每 case computeCacheKey(capDir, caseYaml, systemPrompt)
  2. 缓存命中 → readCacheOrNull → 直接返回 actual（不 spawn）
  3. 缓存未命中 → spawn claude -p → writeCache
  4. --refresh 强制跳过缓存读，但仍写缓存（更新缓存）
输出: verdicts（缓存命中与未命中结果一致）
```

#### B.6.6 边界条件

- `systemPrompt` 为空（capability 无 entrypoint）：`cacheKey=null`，不缓存，每次 spawn。
- `cacheKey` 含 `systemPrompt` hash——改 body 后 hash 变，缓存自动失效（正确行为）。
- `--refresh`：跳过缓存读，但**仍写缓存**（更新缓存为新版本）。
- 缓存文件 `~/.opsforge/runs/cache/<key>.json`：JSON `{actual, ts}`。`ts` 供手动检查。

#### B.6.7 风险与回滚

- **风险**：`templates/interview-script.md` 误落 `templates/agent/` 会破 skeleton 签名（J.1 风险模式）——必须落 `templates/` 根。缓存 key 须含 `systemPrompt` hash，否则改 body 后缓存不失效——用 `crypto.createHash('sha256')`（零新依赖）。
- **回滚**：删 `templates/interview-script.md`；source.md revert 内联 5 触点；`executeClaudeDryRun` 删缓存层；`runSuite` 删 `opts.refresh`。

---

### B.7 P2-A：distill 并行化 + `cmdEvolve` 并行

#### B.7.1 `generateCase` async 化 + `cmdEvolve` 并行

`generateCase` 当前**同步函数**（line 71）。P2-A 改为 async（return Promise）：

```js
export async function generateCase(feedback, failure, opts) {
  // ... 既有同步逻辑不变 ...
  // 唯一变化：函数签名加 async（return Promise<{destPath, name, yaml}>）
}
```

`cmdEvolve` line 685-696 改并行：

```js
// 旧：for (const i of idxs) { generateCase(...) }
// 新：Promise.all
const results = await Promise.all(idxs.map(async (i) => {
  const it = items[i];
  try {
    const fb = it.kind === 'feedback' ? it.src : null;
    const fail = it.kind === 'failure' ? it.failure : null;
    const r = await generateCase(fb, fail, { draftsDir });
    return { ok: true, destPath: r.destPath, caseName: r.name };
  } catch (e) {
    return { ok: false, idx: i, error: e.message };
  }
}));
for (const r of results) {
  if (r.ok) { console.log(`  绿 已生成 ${r.destPath} (name=${r.caseName})`); written++; }
  else { console.log(`  [红] 跳过 #${r.idx + 1}: ${r.error}`); }
}
```

#### B.7.2 文件名 race 守护

`generateCase` 内部 `resolveNameConflict(baseName, opts.draftsDir)` line 80 检查文件冲突——并发时多 case 可能同时检查同一 `baseName` 都认为不冲突，然后同时写同一文件。**缓解**：`Promise.all` 前先**预分配文件名**：

```js
// cmdEvolve 在 Promise.all 前预分配 caseNum：
const startNum = (fs.existsSync(path.join(draftsDir, 'tests')) 
  ? fs.readdirSync(path.join(draftsDir, 'tests')).filter(f => f.endsWith('.yaml')).length 
  : 0) + 1;
const results = await Promise.all(idxs.map(async (i, j) => {
  const it = items[i];
  const fb = it.kind === 'feedback' ? it.src : null;
  const fail = it.kind === 'failure' ? it.failure : null;
  return generateCase(fb, fail, { draftsDir, caseNum: startNum + j });
}));
```

`generateCase` 加 `opts.caseNum` 参数（若提供则用，否则自增）：

```js
const num = opts.caseNum
  || (fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter(f => f.endsWith('.yaml')).length + 1 : 1);
const numStr = String(num).padStart(2, '0');
const destPath = path.join(testsDir, `case-${numStr}.yaml`);
```

#### B.7.3 distiller `source.md` step ③ one-shot Write

`packs/opsforge-meta/agents/capability-distiller/source.md` step ③（line 61）改为：

> Step ③ · Overwrite business fields + dual artifacts: Write the full body in **one** call (all H2 sections: 能力说明/适用场景/运行流程/失败降级/依赖/运行指令/蒸馏日志). Do NOT write H2 sections one-by-one.

#### B.7.4 风险与回滚

- **风险**：`generateCase` 并发写 `case-NN.yaml` 文件名 race——预分配 `caseNum` 缓解。
- **回滚**：revert `Promise.all` 回 `for`；`generateCase` revert 同步签名；distiller source.md revert 多次 Write。

---

### B.8 P2-B：`--skip-dry-run` + `install_hint` 文档 + 中文 README 模板

#### B.8.1 `runSuite` 加 `opts.skipDryRun` 旗标

```js
export async function runSuite(capDir, opts = {}) {
  // ... 既有 ...
  const skipDryRun = opts.skipDryRun || process.env.OPSFORGE_SKIP_DRY_RUN === '1';
  // runCasesConcurrent 传 skipDryRun
  const verdicts = await runCasesConcurrent(capDir, cases, {
    ...opts, runner: skipDryRun ? 'static-only' : runner,
    platform, concurrency, skipDryRun,
  });
  // ... 既有 ...
}
```

`runCase` 内部 `runner === 'static-only'` 已处理（line 477-485：`pass: 'pending'`，不 spawn）。`skipDryRun` 强制走 static-only 路径。

#### B.8.2 `install_hint` 格式文档

`install_hint` 格式：`<git>;<kind>;<name>[;<subpath>]`
- `<git>`：https git URL
- `<kind>`：agent / skill / mcp / workflow / bundle
- `<name>`：capability name slug
- `<subpath>`（可选）：repo 内子路径（默认 repo 根 `<kind>/<name>/`）

文档落 `docs/methodology/intake.md`（或扩展既有 intake 文档）。

#### B.8.3 `templates/readme-template.zh.md` 新增

落 `templates/` 根（不计入 skeleton 签名）。内容：

```md
# {{display_name_zh}}

> {{description}}

## 能力说明

{{detail}}

## 适用场景

{{scenarios}}

## 安装

```bash
opsforge install {{capId}}
```

## 使用

{{usage}}

## 依赖

{{dependencies}}
```

`new-capability.mjs --third-party` 生成 `README.md` 时用此模板（`--third-party` 现有逻辑写 `upstream-ref.json`，扩展写 `README.md`）。

#### B.8.4 风险与回滚

- **风险**：`--skip-dry-run` 误用会漏跑真例——默认 false，仅 `--skip-dry-run` flag 或 `OPSFORGE_SKIP_DRY_RUN=1` env 触发。
- **回滚**：`runSuite` 删 `opts.skipDryRun`；`templates/readme-template.zh.md` 删。

---

## C. 文件布局（新增/修改清单）

### C.1 新增文件（4 个）

| 文件 | 职责 | slice |
|------|------|------|
| `tools/intake-remote.mjs` | `fetchRemoteMeta(url, opts)` API LICENSE fetch（不 clone） | P1-A |
| `templates/interview-script.md` | 外置访谈 5 触点脚本 | P1-C |
| `templates/readme-template.zh.md` | 中文 README 模板 | P2-B |
| `docs/methodology/intake.md`（或扩展现有） | `install_hint` 格式文档 | P2-B |

### C.2 修改文件（14 个）

| 文件 | 改动 | slice |
|------|------|------|
| `tools/opsforge.mjs` | +`cmdPrint` +`PRINT_TOPICS` +`main()` switch `print` 分支；`cmdMenu`/`cmdNewFlow`/`cmdWizard` 等改读 `PRINT_TOPICS`；`cmdIntakeFlow` 加 scope 问；`cmdEvolve` 改 `Promise.all` | P0-A / P1-A / P2-A |
| `packs/opsforge-meta/agents/opsforge/source.md` | `## 运行指令` 改调 `opsforge print menu` | P0-A |
| `packs/opsforge-meta/agents/capability-interviewer/source.md` | `## 运行指令` 改读 `templates/interview-script.md` | P0-A / P1-C |
| `packs/opsforge-meta/agents/capability-distiller/source.md` | `## 运行指令` 改调 `opsforge print distiller-steps`；step ③ one-shot Write | P0-A / P2-A |
| `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md` | `## 运行指令` 改调 `opsforge print wizard-phases` | P0-A |
| `packs/opsforge-meta/skills/opsforge-interview/SKILL.md` | `## 运行指令` 改读 `templates/interview-script.md` | P0-A / P1-C |
| `tools/test-runner.mjs` | `runSuite` `Promise.all` 并行 + `tokenSink` 独立后求和；`executeClaudeDryRun` 缓存层 + `opts.cacheKey` + `opts.refresh`；`runSuite` `opts.skipDryRun` | P0-B / P1-C / P2-B |
| `tools/intake.mjs` | `intake()` try/catch 清理；`opts.scope` 分流；`install_hint` 写入 | P0-C / P1-A / P1-B |
| `install.mjs` | `findCapabilitySource` 加查 `_staged/third-party/`；`installFromGit` + `main() --from-git`；`install()` 支持 `capDir` 直传 | P1-B |
| `schema/upstream-ref.schema.json` | 加 `install_hint` 字段，`additionalProperties:false` 保留 | P1-B |
| `tools/inventory.mjs` | `buildInventory` 加 `intakeScope` + `installHint` 字段 | P1-B |
| `tools/regression-sink.mjs` | `generateCase` async + `opts.caseNum` 预分配 | P2-A |
| `tools/report-renderer.mjs` | **不改**（已有 `report-templates/*.zh.md` 外置，`print` 复用） | - |
| `tools/new-capability.mjs` | `--third-party` 扩展写 `README.md`（用 `readme-template.zh.md`） | P2-B |

### C.3 测试文件（新增/修改）

| 文件 | 新增测试 | slice |
|------|---------|------|
| `tools/opsforge.test.mjs` | +5 `print <topic>` 输出与 `cmdMenu`/`cmdNewFlow` console.log 逐字一致 | P0-A |
| `tools/test-runner.test.mjs` | +2 并行（mock `runCase` 延迟 100ms，断言并行 < 60ms；`tokenSink` 求和）+3 缓存（命中不 spawn；`--refresh` 强制 spawn）+2 `skip-dry-run` | P0-B / P1-C / P2-B |
| `tools/intake.test.mjs` | +4 reference-scope（不 clone、`intake_scope='reference'`、`install_hint` 填实）+2 失败回滚（`.opsforge-intake/` + `_drafts/third-party/` 清理） | P0-C / P1-A |
| `tools/intake-fetch.test.mjs` | +2 `fetchRemoteMeta`（mock fetch 返回 license + sha；非 GitHub 回退 `ls-remote`） | P1-A |
| `tools/install-registry.test.mjs` | +3 `findCapabilitySource` 查 `_staged/third-party/`；`installFromGit` mock clone + install + cleanup | P1-B |
| `tools/regression-sink-quadrant.test.mjs` | +3 并发 5 case 无文件名冲突 | P2-A |

**预计 bare `node --test` 496 → ~521**（+9 P0 + +10 P1 + +6 P2 = +25）。

---

## D. 边界条件与错误处理（per-slice 汇总）

| slice | 失败模式 | 处理 |
|------|---------|------|
| P0-A `print` | 未知 topic | exit 1 + stderr 列出可用 |
| P0-A `print` | 无 topic 参数 | exit 2 + usage |
| P0-A agent prompt | R27 `<80 token` | 改后 prompt 仍 >80 token（实测通过）；若不足加 `print` 调用指令文本补长 |
| P0-B 并行 | `runCase` reject | `Promise.allSettled` 转 `{pass:false, reason:'execution error'}` 不拖垮整批 |
| P0-B 并行 | API rate limit | `concurrency` 可调；`OPSFORGE_RUNNER_CONCURRENCY=1` 回退串行 |
| P0-C 回滚 | `scaffold` 已写 draft 后失败 | `--keep-on-fail` 旗标保留；默认清理 |
| P1-A `fetchRemoteMeta` | GitHub API 404 | `license='UNKNOWN'` / `commit='unknown'`，不 throw |
| P1-A `fetchRemoteMeta` | GitHub API rate limit 403 | `license='UNKNOWN'`；可选 throw 提示设 `OPSFORGE_GITHUB_TOKEN` |
| P1-A `fetchRemoteMeta` | 非 GitHub `ls-remote` 失败 | throw |
| P1-B `installFromGit` | `install_hint` 格式错误 | throw `install_hint format invalid` |
| P1-B `installFromGit` | 50MB 上限 | throw（reference-scope 本就为轻量，大 repo 走 vendored） |
| P1-B `findCapabilitySource` | `_drafts/third-party/` draft 状态 | 只查 `_staged/third-party/`（draft 不可装） |
| P1-C 缓存 | `systemPrompt` 为空 | `cacheKey=null`，不缓存 |
| P1-C 缓存 | body 改后 hash 变 | 缓存自动失效（正确行为） |
| P2-A 并行 | 文件名 race | 预分配 `caseNum` |
| P2-B `--skip-dry-run` | 误用漏跑真例 | 默认 false；仅 flag/env 触发 |

---

## E. 与已有未提交工作的叠加点（逐项确认叠加而非冲突）

### E.1 `web/catalog/` + `tools/catalog-model.mjs` + `catalog-server.mjs`（catalog 栈）

- **现状**：`web/catalog/{app.js,index.html,styles.css}` + `tools/catalog-model.mjs`（`buildCatalogSnapshot` + `publicEntry` + `catalogSummary`）+ `tools/catalog-server.mjs`（零依赖 HTTP server）已落地未提交。`catalog-model.mjs publicEntry` line 69 从 `buildInventory` 派生 public catalog snapshot。
- **叠加点**：
  - P0-A `cmdPrint` **不触 catalog**（catalog 是 HTTP server，`print` 是 CLI emit，正交）。
  - P1-A/B reference-scope 产出的 `upstream-ref.json` `install_hint` 会进 `buildInventory` → `buildCatalogSnapshot` → catalog 前端。reference-scope 能力在 catalog 显示"只存 git 地址，安装时拉取"标签（`installHint` 非空即标）。
  - P2-B 中文 README 模板让第三方收录能力在 catalog 有中文摘要——`publicEntry` 已读 `display_name_zh` / `description`，模板填实后 catalog 展示更友好。
- **保护而非冲突**：本方案不动 `catalog-model.mjs` / `catalog-server.mjs` / `web/catalog/`；P1-B 在 `buildInventory` 加的 `intakeScope` + `installHint` 字段是 `catalog-model.mjs publicEntry` 的**新可选输入**（`publicEntry` line 69 不读 `intakeScope`/`installHint`，除非 catalog 前端主动加标签——那是 catalog 的后续工作，本方案不强求）。

### E.2 `tools/inventory.mjs` 增强（+17 行：`qualityReports` / `dependsOn` / `sourceOrigin` / `releasedAt`）

- **现状**：未提交工作给 `buildInventory` 加了 4 字段（line 203-206），喂给 catalog。
- **叠加点**：
  - P1-B 在 `buildInventory` 加 `intakeScope` + `installHint` 两行（从 `upstream-ref.json` 读）。
  - `intake_scope`（`full`/`reference`）与 `sourceOrigin`（`original`/`third-party`）正交——前者描述收录方式，后者描述来源类型。
- **保护而非冲突**：本方案只在 `buildInventory` 加两行 `intakeScope` + `installHint`，**不动既有 +17 行增强**。两行在 `sourceOrigin` line 205 之后插入。

### E.3 `tools/test-runner.mjs` Windows-safe `resolveClaudeBin()`（+131 行）

- **现状**：未提交工作已修复 Windows spawn ENOENT：`resolveClaudeBin()` line 50-64 直探 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`，`env.CLAUDECODE='1'` 避免嵌套会话挂起。`_judgeViaClaudeCli` 也用同一 `resolveClaudeBin()`。
- **叠加点**：
  - P0-B `runSuite` `Promise.all` 并行化**叠加**此修复：每个并发 `runCase` 内部 `executeClaudeDryRun` 调 `resolveClaudeBin()` 得同一 exe 路径，spawn 多个 `claude.exe` 进程——`CLAUDECODE=1` env 已避免嵌套挂起，多进程安全。
  - P1-C dry-run 缓存的 `cacheKey` 含 `systemPrompt` hash——`resolveClaudeBin()` 不影响缓存（缓存命中不 spawn）。
  - P2-B `--skip-dry-run` 时不 spawn——`resolveClaudeBin()` 不调，无影响。
- **保护而非冲突**：P0-B 明确"并行化与此修复叠加而非冲突"——`resolveClaudeBin()` 是 spawn 层修复，并行化是 `runSuite` 层优化，两者正交。`runCase` / `executeClaudeDryRun` / `executeMultiTurnDryRun` 签名不变，`resolveClaudeBin()` 调用点不变。

### E.4 `packs/_staged/data-team/data-quality-profiler/`（新能力）

- **现状**：已 staged 未提交，是 data-team 包第一个能力。
- **叠加点**：
  - P0-A `cmdPrint` 不触此能力（业务能力，不是 opsforge-meta）。
  - P0-B `runSuite` 并行化会**加速此能力的跑通门**（3 cases 90s → 30s）——叠加收益。
  - P1 `intake-remote` 不触此能力（非 third-party）。
  - P2-B 中文 README 模板可给此能力 README 提供中文结构（但此能力已 staged，README 已存在，不强制改）。
- **保护而非冲突**：本方案不动 `packs/_staged/data-team/`。P1-B `findCapabilitySource` 扩展只加查 `_staged/third-party/`，不查 `_staged/data-team/`（`data-team` 已在 `packs/<pack>/<kind>/<name>` 既有搜索路径内，line 70-73）。

---

## F. 10 条硬不变量逐条守护说明

### F.1 零新 npm 依赖（仅 ajv/js-yaml/semver）

- P0-A `cmdPrint` 用 Node 内置 `fs`/`path`（读模板文件）+ 字符串常量。
- P0-B `runSuite` 用 `Promise.all`（Node 内置）。
- P0-C `intake` try/catch 用 `fs.rmSync`（Node 内置）。
- P1-A `intake-remote` 用 Node 内置 `fetch` + 复用 `intake-fetch.mjs` 的 `execFileSync`（既有）。
- P1-B `installFromGit` 复用 `fetchUpstream`（既有 `execFileSync`）。
- P1-C 缓存用 Node 内置 `crypto.createHash('sha256')`（零新依赖）。
- P2-A `generateCase` async 化用 `Promise.all`（Node 内置）。
- P2-B `--skip-dry-run` + 模板用 `fs`（Node 内置）。
- **守护点**：`package.json` 不动；`.github/workflows/guardrails.yml` deps-guard 不动。✅

### F.2 所有 schema `additionalProperties: false`

- `schema/upstream-ref.schema.json` 加 `install_hint` 字段（P1-B），`additionalProperties: false`（line 7）不动。
- **守护点**：ajv 测试断言加 `install_hint` 后 `additionalProperties: false` 仍拒绝未知字段。✅

### F.3 `registry*.yaml` 由 `tools/release.mjs` auto-gen

- 本方案不动 `release.mjs` 聚合逻辑。
- reference-scope 能力进 registry 走正常 `release.mjs --all` 流程（`release()` per cap 不分流 scope）。
- **守护点**：`registry.yaml` / `registry-brands.yaml` 仍 auto-gen，不手编。✅

### F.4 skeleton_guard（文件集必须匹配 `templates/<kind>/`）

- P1-C `templates/interview-script.md` 落 `templates/` 根（与 `interview-record.md` 同位，**非** `templates/<kind>/`），不计入任何 kind skeleton 签名。
- P2-B `templates/readme-template.zh.md` 同理落 `templates/` 根。
- **不改 `SKELETON_GUARD_EXCLUSIONS` 两处**（`new-capability.mjs:24` + `validate.mjs:37`）——`templates/` 根文件不参与 `templates/<kind>/` 签名比对。
- **守护点**：`walkFiles(cap.dir)` 只比 `cap.dir` 内文件，`templates/` 根文件不在 `cap.dir` 内。✅

### F.5 R16–R22 + R24–R31 不弱化

- 本方案不动 `validate.mjs` 任何 R-rule。
- P0-A agent `source.md` 改 `## 运行指令` 内容，R27（`## 运行指令` ≥80 token）仍生效——`print` 调用指令文本够长即可（实测改后 prompt >80 token）。
- **守护点**：`validate.mjs` 不动；`staged+` checks 不弱化。✅

### F.6 §C.1 pinned baseline（Node 22 LTS、ESM .mjs、npm only、install.sh 唯一 sh）

- 全 `.mjs` ESM（`intake-remote.mjs` 新增也是 .mjs）。
- 无新 sh（`install.sh` 不动）。
- 无新语言（零 Go，零 Rust）。
- Node 22 LTS（`.nvmrc` 不动）；npm only（`package.json` 不动）。
- **守护点**：CI matrix 不动；`.nvmrc` 不动。✅

### F.7 不引 Go 二进制

- 本方案零 Go。
- `intake-remote.mjs` 用 Node 内置 `fetch` + `git ls-remote`（既有 git CLI，非 Go）。
- **守护点**：无 `go.mod` / 无 `go run`。✅

### F.8 SSRF 守卫保留

- `intake-remote.mjs fetchRemoteMeta` 复用 `intake-fetch.mjs assertPublicUrl`（https-only、shell-metachar 拒绝、私网段拒绝、DNS rebinding 拒绝全套）。
- reference-scope 只存 URL 不 clone，但仍过 SSRF 门。
- `installFromGit` clone-to-temp 时复用 `fetchUpstream`（同样过 `assertPublicUrl` + 50MB 上限）。
- `security-scan.mjs` 不动。
- **守护点**：`assertPublicUrl` line 83 export 不动；`SSRF_HOST_PATTERNS` / `SSRF_ENCODED_PATTERNS` / `isPrivateIp` 不动。✅

### F.9 Windows 兼容

- P0-A `print` 纯字符串 emit（无 spawn，无路径）。
- P0-B `runSuite Promise.all` 叠加 `resolveClaudeBin()` Windows 修复（直探 `claude.exe` + `CLAUDECODE=1` env）；`execFileSync` argv 形式（无 shell）。
- P0-C `fs.rmSync({recursive:true, force:true})` Windows 兼容（Node 16+ 支持）。
- P1-A `intake-remote` 用 `fetch`（无 spawn）；非 GitHub `git ls-remote` 用 `execFileSync` argv 形式（无 shell，N2 RCE 守卫保留）。
- P1-B `installFromGit` 用 `fetchUpstream` 的 `execFileSync` argv 形式（无 shell）。
- P1-C 缓存 `crypto.createHash` Windows 兼容；`atomicWrite` 跨平台。
- P2-A `generateCase` `fs.writeFileSync` Windows 兼容。
- **守护点**：所有路径 `path.join`；所有 spawn argv 形式；`resolveClaudeBin()` Windows 直探。✅

### F.10 release gate 三报告逻辑不动

- 本方案不动 `release.mjs aggregateAll` gate 逻辑。
- reference-scope 能力过正常 validation+security+eval 三报告（`release()` per cap 不分流 scope）。
- **守护点**：`release.mjs` 不动；三报告 `pass`/`pending` gate 不变。✅

---

## G. 风险与回滚总览

| slice | 主要风险 | 回滚成本 |
|------|---------|---------|
| P0-A `print` | agent source.md 改后 R27 `<80 token` | 低（revert source.md + 删 `cmdPrint` + `PRINT_TOPICS`） |
| P0-B 并行化 | 多 spawn `claude.exe` OOM / rate limit | 低（`OPSFORGE_RUNNER_CONCURRENCY=1` 回退串行） |
| P0-C 回滚 | 清理误删作者已填字段 | 低（`--keep-on-fail` 旗标） |
| P1-A `intake-remote` | GitHub API rate limit | 中（删 `intake-remote.mjs` + revert `intake.mjs scope`） |
| P1-B `--from-git` | `install_hint` 格式不稳 | 中（删 `installFromGit` + schema revert） |
| P1-C 外置脚本 | `templates/interview-script.md` 误落 `templates/agent/` | 低（落 `templates/` 根） |
| P2-A distill 并行 | `generateCase` 文件名 race | 低（预分配 `caseNum`） |
| P2-B `--skip-dry-run` | 误用漏跑真例 | 低（默认 false） |

---

## H. 实现顺序建议（可并行性）

### H.1 PR1：P0-A + P0-B + P0-C（三痛点 P0，互不依赖）

- P0-A `cmdPrint` / P0-B `runSuite Promise.all` / P0-C intake 回滚：**三 slice 互不依赖**，同 PR 控制冲突。
- P0-A 触 `opsforge.mjs` + 5 个 agent/skill prompt；P0-B 触 `test-runner.mjs`；P0-C 触 `intake.mjs`——**文件无重叠**，可同 PR。
- +9 测试（P0-A +5 / P0-B +2 / P0-C +2）。

### H.2 PR2：P1-A + P1-B（reference-scope 端到端，强耦合）

- P1-A `intake-remote.mjs` + `intake.mjs scope` 分流；P1-B schema `install_hint` + `findCapabilitySource` + `installFromGit`。
- P1-A 写 `install_hint`，P1-B 读 `install_hint`——**必须同 PR**（否则 reference-scope 能力装不了）。
- 依赖 P0-C（`intake()` try/catch 要覆盖 reference scope 失败路径）。
- +10 测试（P1-A +4 / P1-B +3 / P1-C +3 独立）。

### H.3 PR3：P1-C（外置访谈脚本 + 缓存，独立）

- P1-C 触 `templates/interview-script.md` + `capability-interviewer/source.md` + `opsforge-interview/SKILL.md` + `test-runner.mjs` 缓存层。
- 与 P1-A/B **可并行**（文件无重叠：P1-A 触 `intake-remote.mjs` / `intake.mjs` / `install.mjs`；P1-C 触 `templates/` + `test-runner.mjs`）。
- +3 测试。

### H.4 PR4：P2-A + P2-B（distill 并行 + skip-dry-run + 文档，收尾）

- P2-A 触 `regression-sink.mjs` + `cmdEvolve` + distiller source.md；P2-B 触 `test-runner.mjs` `skipDryRun` + `templates/readme-template.zh.md`。
- P2-A 依赖 P0-B（叠加同一 `Promise.all` 模式）。
- P2-B 依赖 P1-B（`install_hint` 字段已加）。
- +6 测试（P2-A +3 / P2-B +3）。

### H.5 可并行性矩阵

| slice 对 | 文件重叠 | 可并行？ |
|----------|---------|---------|
| P0-A ↔ P0-B | 无（opsforge.mjs ↔ test-runner.mjs） | ✅ |
| P0-A ↔ P0-C | 无（opsforge.mjs ↔ intake.mjs） | ✅ |
| P0-B ↔ P0-C | 无（test-runner.mjs ↔ intake.mjs） | ✅ |
| P1-A ↔ P1-B | 强耦合（install_hint 写读） | ❌ 同 PR |
| P1-A ↔ P1-C | 无（intake-remote.mjs ↔ templates/test-runner.mjs） | ✅ |
| P1-B ↔ P1-C | 无（install.mjs/schema ↔ templates/test-runner.mjs） | ✅ |
| P2-A ↔ P2-B | 无（regression-sink.mjs ↔ test-runner.mjs/templates） | ✅ |
| P0-B ↔ P2-A | 模式叠加（Promise.all） | ❌ P2-A 依赖 P0-B |
| P1-B ↔ P2-B | 强耦合（install_hint 文档） | ❌ P2-B 依赖 P1-B |

---

## I. 总验收标准

- `bare node --test` 496 → ~521（P0 +9 + P1 +10 + P2 +6 = +25）。
- 6 gates 全绿：`validate.mjs --all` exit 0（10 capabilities）+ `security-scan.mjs --all` exit 0 + `eval.mjs --all` exit 0 + `release.mjs --all` exit 0 + `install.mjs --doctor` healthy + `inventory.mjs --check-readme` exit 0。
- 零新 npm 依赖（`package.json` 不动）。
- `additionalProperties: false` 全保留（`upstream-ref.schema.json` 加 `install_hint` 后仍 `false`）。
- `registry*.yaml` auto-gen 不手编。
- R16–R22 + R24–R31 不弱化（本方案不动 R-rule）。
- SSRF 守卫保留（`intake-remote.mjs` 复用 `assertPublicUrl`）。
- Windows 兼容（`print` 纯字符串；`runSuite Promise.all` 叠加 `resolveClaudeBin`；`intake-remote` 用 fetch 无 spawn）。
- 与已有未提交工作叠加：`web/catalog/` / `catalog-model.mjs` / `catalog-server.mjs` / `inventory.mjs +17 行` / `test-runner.mjs resolveClaudeBin +131 行` / `packs/_staged/data-team/` 全部保护不冲突。

---

## J. 关键文件路径清单（实现者按此索引）

### J.1 P0-A `cmdPrint`

- `tools/opsforge.mjs`（+`cmdPrint` +`PRINT_TOPICS` +`main()` switch `print` 分支；`cmdMenu`/`cmdNewFlow`/`cmdWizard`/`cmdIntakeFlow`/`promptInstallFlow`/`printPushReminder`/`cmdDiscover`/`cmdStatus`/`cmdDoctor`/`cmdFeedback`/`cmdEvolve` 改读 `PRINT_TOPICS`）
- `packs/opsforge-meta/agents/opsforge/source.md`（`## 运行指令` 改调 `opsforge print menu`）
- `packs/opsforge-meta/agents/capability-interviewer/source.md`（`## 运行指令` 改读 `templates/interview-script.md`——与 P1-C 同步）
- `packs/opsforge-meta/agents/capability-distiller/source.md`（`## 运行指令` 改调 `opsforge print distiller-steps`）
- `packs/opsforge-meta/skills/opsforge-wizard/SKILL.md`（`## 运行指令` 改调 `opsforge print wizard-phases`）
- `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`（`## 运行指令` 改读 `templates/interview-script.md`——与 P1-C 同步）
- `tools/opsforge.test.mjs`（+5 `print <topic>` 输出逐字一致断言）

### J.2 P0-B `runSuite` 并行

- `tools/test-runner.mjs`（`runSuite` line 816 `Promise.all` + `runCasesConcurrent` + `tokenSink` 独立后求和；`runCase` line 424 签名不变）
- `tools/test-runner.test.mjs`（+2 并行延迟 + tokenSink 求和）

### J.3 P0-C intake 回滚

- `tools/intake.mjs`（`intake()` line 21 try/catch + 清理 `cloneDir` + `draftPath` + `--keep-on-fail` 旗标）
- `tools/intake.test.mjs`（+2 失败回滚断言）

### J.4 P1-A `intake-remote`

- `tools/intake-remote.mjs`（新增；`fetchRemoteMeta` + `parseGitHubUrl` + `fetchGitHubMeta` + `fetchViaLsRemote`）
- `tools/intake.mjs`（`intake()` 加 `opts.scope` 分流；reference 时调 `fetchRemoteMeta`；`upstream-ref.json` 写 `install_hint`）
- `tools/opsforge.mjs`（`cmdIntakeFlow` 加 scope 问）
- `tools/intake-fetch.test.mjs`（+2 `fetchRemoteMeta` mock）

### J.5 P1-B `--from-git` + schema

- `schema/upstream-ref.schema.json`（加 `install_hint` 字段）
- `install.mjs`（`findCapabilitySource` 加查 `_staged/third-party/`；`installFromGit`；`install()` 支持 `capDir` 直传；`main() --from-git`）
- `tools/inventory.mjs`（`buildInventory` 加 `intakeScope` + `installHint` 两行）
- `tools/install-registry.test.mjs`（+3 `findCapabilitySource` + `installFromGit`）

### J.6 P1-C 外置脚本 + 缓存

- `templates/interview-script.md`（新增，落 `templates/` 根）
- `packs/opsforge-meta/agents/capability-interviewer/source.md`（`## 运行指令` 改读文件）
- `packs/opsforge-meta/skills/opsforge-interview/SKILL.md`（同上）
- `tools/test-runner.mjs`（`executeClaudeDryRun` line 603 缓存层 + `computeCacheKey` + `readCacheOrNull` / `writeCache`；`runSuite` `opts.refresh`）
- `tools/test-runner.test.mjs`（+3 缓存命中 + `--refresh`）

### J.7 P2-A distill 并行

- `tools/regression-sink.mjs`（`generateCase` line 71 async + `opts.caseNum`）
- `tools/opsforge.mjs`（`cmdEvolve` line 685 `Promise.all` + 预分配 `caseNum`）
- `packs/opsforge-meta/agents/capability-distiller/source.md`（step ③ one-shot Write）
- `tools/regression-sink-quadrant.test.mjs`（+3 并发无冲突）

### J.8 P2-B `--skip-dry-run` + 文档 + README 模板

- `tools/test-runner.mjs`（`runSuite` `opts.skipDryRun`）
- `templates/readme-template.zh.md`（新增，落 `templates/` 根）
- `tools/new-capability.mjs`（`--third-party` 扩展写 `README.md`）
- `docs/methodology/intake.md`（`install_hint` 格式文档）
- `tools/test-runner.test.mjs`（+2 `skip-dry-run`）

---

**架构规格结束。实现者按 §H 实现顺序 + §J 文件路径清单执行。**
