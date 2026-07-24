# Architecture & Technical Contracts — Phase 1+ Delta

> Authoritative spec for `tdd-guide`. Source of truth: `PLAN.md` v9 (§6/§7/§8/§9/§13/§A/§B/§C/§14/§20/§21/§22) + `docs/design-archive/supplement-v7.md` + `docs/design-archive/supplement-v8.md` + `docs/design-archive/supplement-v9.md` + `IMPLEMENTATION-PLAN.md` + `DESIGN.md` (Phase 0 baseline, shipped). Repo root: `D:\XD\ClaudeCode\sy-eeo\` (no `opsforge/` subdirectory, per PROGRESS.md D0). Phase 0 is COMPLETE (32/32 green); this document specifies every new contract tdd-guide codes to in Phase 1 (sub-phases 1.1–1.8) and locks cross-cutting decisions so no guessing is needed.
>
> Build order is fixed: **1.1 → 1.2 → 1.3 → 1.5 → 1.4 → 1.6 → 1.7 → 1.8** (per `IMPLEMENTATION-PLAN.md` line 132; 1.5 ships before 1.4 final wiring because `install.mjs` reads the registry). Every sub-phase is TDD-first: failing `*.test.mjs` then implementation then green.

---

## 1. Module map (the new layer diagram)

```
                          ┌─────────────────────────────────────────────────────────┐
                          │             STEERING-OWNED CONTRACT LAYER                 │
                          │  schema/*.schema.json   templates/*/   platform.yaml     │
                          │  (capability / workflow / bundle / test-case / platform  │
                          │   / pack / brand / upstream-ref / profile)               │
                          └───────────────┬─────────────────────────────────────────┘
                                          │ (read by)
        ┌─────────────────────────────────┼─────────────────────────────────────┐
        │                                 │                                       │
┌───────▼─────────────────┐  ┌────────────▼──────────────┐  ┌────────────────────▼──────────┐
│  Phase 0 baseline (shipped│  │  Phase 1 new/extended tools │  │  Phase 1 adapter + installer    │
│  — not modified by P1)   │  │  (all under tools/)         │  │  (adapters/ + repo root)        │
│                          │  │                              │  │                                  │
│  tools/validate.mjs      │  │  tools/test-runner.mjs (NEW)│  │  adapters/base.mjs (NEW)        │
│   (extended: +R16..R22,  │  │  tools/workflow-compile.mjs  │  │  adapters/claude-code/          │
│    +R_wf_ref/R_wf_closed,│  │   (NEW)                      │  │   ├ adapter.mjs (NEW)            │
│    +.opsforge-state.json │  │  tools/release.mjs (NEW)     │  │   ├ platform.yaml (NEW)         │
│    exclusion + requires  │  │  tools/security-scan.mjs    │  │   └ mcp-config.template.json   │
│    conform check)        │  │   (NEW, minimal subset)     │  │  install.mjs (NEW, repo root)   │
│  tools/new-capability.mjs │  │  tools/opsforge.mjs (NEW)   │  │  install.sh (NEW, repo root,    │
│   (extended: writes      │  │  tools/report-renderer.mjs  │  │   sole .sh exception, POSIX)    │
│   .opsforge-state.json   │  │   (NEW)                      │  │                                  │
│   on scaffold/promote)   │  │  tools/report-templates/    │  │                                  │
│  tools/validate.test.mjs │  │   (NEW, validation-report    │  │                                  │
│  tools/new-capability.   │  │   .zh.md)                    │  │                                  │
│   test.mjs               │  │  tools/test-runner.test.mjs  │  │                                  │
│                          │  │  tools/release.test.mjs      │  │                                  │
│                          │  │  tools/security-scan.test.mjs│  │                                  │
│                          │  │  tools/workflow-compile.test  │  │                                  │
│                          │  │   .mjs                       │  │                                  │
│                          │  │  install.test.mjs            │  │                                  │
│                          │  │  tools/opsforge.test.mjs     │  │                                  │
│                          │  │  tools/report-renderer.test  │  │                                  │
│                          │  │   .mjs                       │  │                                  │
└──────────────────────────┘  └──────────────┬──────────────┘  └──────────────┬──────────────────┘
                                                │                                │
                                                │ calls                          │ calls
                                                ▼                                ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │                          RUNTIME / TARGET-MACHINE                              │
        │  ~/.opsforge/  (OPSFORGE_HOME override; default ~ → USERPROFILE on Windows)   │
        │   ├ runs/<workflow-id>/<run-id>/{state.json, artifacts/<step>/<out>.json,     │
        │   │  run.log, params.snapshot.yaml}                                            │
        │   ├ manifests/<project-slug>.manifest.json   (per-project install manifest)  │
        │   ├ kb/<pack>/feedback/<cap-id>.jsonl          (Phase 3; dir reserved in P1)  │
        │   └ eval-history/<id>/<version>.json           (Phase 2/3; dir reserved)     │
        │  ~/.claude/  (claude-code platform target: agents/, skills/, commands/)      │
        │  ~/.claude.json  (mcpServers merge target)                                    │
        └──────────────────────────────────────────────────────────────────────────────┘

  REGISTRY (auto-generated, never hand-edited):
   registry.yaml (general) + registry-brands.yaml (per-brand)
   ← tools/release.mjs aggregateAll() scans packs/<contributor>/ + customers/<brand>/packs/<brand>/

  CI ARTIFACTS (in-repo as build artifacts, not committed source):
   validation-report.json (§A.4, P1 shape + regression_cases)  — written by validate.mjs
   security-report.json   (§B.3, minimal 3-family subset)       — written by security-scan.mjs
   eval-report.json       (Phase 2, NOT in P1)                   — written by eval.mjs (Phase 2)

  CAPABILITY DIR STATE OVERLAY (written by new-capability.mjs, excluded from skeleton_guard):
   <cap-dir>/.opsforge-state.json  { state, history: [{ts, from, to, pr}] }
```

> **Phase 3.6 additions to the above diagram (SHIPPED 2026-07-24):**
> - **模块图（tools 层）新增：** `tools/opsforge-bootstrap.mjs`（自举入口：install opsforge-meta caps + 复制薄 runtime wrapper 到 `~/.opsforge/runtime/tools/` 保布局 + 平铺 `registry*.yaml` 到 `~/.opsforge/` + 写 `~/.opsforge/.runtime-root.json`）、`tools/opsforge-runtime.mjs`（零 bare-dep 薄 wrapper：`resolveWorkDir()` 三级回退 + `runInstall`/`runList`/`runDoctor` 委托仓库根 `install.mjs` 经 `pathToFileURL` 动态 import）；`packs/opsforge-meta/`（载体 B meta-pack：`pack.yaml` + `agents/opsforge/` + `agents/opsforge-installer/` + `skills/opsforge-wizard/`，3 个 dogfood 能力）。
> - **RUNTIME 层（`~/.opsforge/`）新增：** `~/.opsforge/registry.yaml` + `~/.opsforge/registry-brands.yaml`（平铺镜像，`install.mjs readRegistryForInstall` home 回退读这里——Phase 3.6 修复 `cmdDiscover` 读 `registry.yaml` 语义错，改读 per-project manifest）、`~/.opsforge/runtime/tools/opsforge-runtime.mjs` + `~/.opsforge/runtime/tools/paths.mjs`（保布局复制的薄 wrapper）、`~/.opsforge/.runtime-root.json`（记录仓库根，runtime 副本据此 `pathToFileURL` 动态 import 仓库根 `install.mjs`）。
> - **架构不变量（关键）：** `~/.opsforge/` runtime 副本**非完全自包含**——薄 wrapper（零 bare-dep 顶层 import，仅 `node:` 内建 + `./paths.mjs`）经 `.runtime-root.json` 动态 import 仓库根 `install.mjs`，`ajv`/`js-yaml`/`semver` 在仓库 `node_modules` 解析成立。**仓库必须在机器上持续存在**才能 in-platform 安装/列能力/doctor；dogfood/开发场景够用；"装到无仓库机器"需打包 `node_modules` 发行版（后续 Phase）。
> - **背景：** Phase 2.5 工程后端 COMPLETE；UX shell（顶层菜单/wizard 端到端/discover 质量灯/feedback/no-cwd/载体 B/平台内安装入口）原 DEFERRED to Phase 3.6，**现已全部交付**（architect 已把归属从 Phase 4 改为 Phase 3.6）。载体 D paste 文件已落地（`adapters/cline|codex|dify` 非空 `pasteInstructions` → `install.mjs:182-196`；Tier 1 null 正确）——勿改坏。

**File-ownership rules tdd-guide must respect:**

| Module | Owns files |
|---|---|
| `schema/*.schema.json` | new: `workflow`, `bundle`, `test-case`, `platform`, `pack`, `brand`, `upstream-ref`; extend `capability` (`requires`) |
| `templates/` | extend each `*/tests/case-0[1-3].yaml` (3→7 fields); new `templates/profile/` is **Phase 2** (do NOT ship in P1) |
| `adapters/base.mjs` | NEW base class |
| `adapters/claude-code/{adapter.mjs,platform.yaml,mcp-config.template.json}` | NEW |
| `tools/{validate,test-runner,workflow-compile,release,security-scan,opsforge,report-renderer}.mjs` | NEW/extended |
| `install.sh` + `install.mjs` (repo root) | NEW |
| `tools/report-templates/validation-report.zh.md` | NEW (P1 only renders validation-report) |
| `ci/github-actions/{validate,test,release}.yml` | NEW; extend `ci/guardrails.yml` path-guard list |
| `tools/opsforge-bootstrap.mjs` + `tools/opsforge-runtime.mjs` (Phase 3.6 SHIPPED) | NEW (steering-owned; 自举入口 + 零 bare-dep 薄 wrapper：`resolveWorkDir()` 三级回退 + `runInstall`/`runList`/`runDoctor` 委托仓库根 `install.mjs` 经 `pathToFileURL` 动态 import driven by `~/.opsforge/.runtime-root.json`) |
| `packs/opsforge-meta/` (Phase 3.6 SHIPPED, 载体 B) | NEW (steering-owned; meta-pack: `pack.yaml` + `agents/opsforge/` + `agents/opsforge-installer/` + `skills/opsforge-wizard/`，3 个自身是普通 OpsForge 能力经同一 install 流程装入目标平台) |

---

## 2. Concrete interfaces (JS ESM, export-by-name)

All modules are `.mjs` ESM. No new npm deps — reuse `ajv`/`js-yaml`/`semver` and Node built-ins (`node:fs`/`node:path`/`node:os`/`node:child_process`/`node:readline`/`node:test`/global `fetch`). Every module that builds paths from ids MUST call `assertSlugSegment()` (§5) on each segment first.

### 2.1 `adapters/base.mjs` — NEW (§22.3 / §6.2)

```js
/**
 * @typedef {Object} CapabilityPointDecl
 * @property {boolean} supported
 * @property {string} [mode]        // "http-api" | "web-ui" | "stdio" | "http-callback" ...
 * @property {string} [endpoint_env]
 * @property {string} [auth_env]
 * @property {string} [fallback]    // one of 5 strategies, §22.4
 * @property {Object} [meta]        // raw merged map for adapter-specific extras
 *
 * @typedef {Object} SupportsResult
 * @property {boolean} supported
 * @property {string} [fallback]
 * @property {Object} [meta]
 *
 * @typedef {Object} PlatformYaml
 * @property {string} platform
 * @property {string} display_name
 * @property {string} display_name_zh
 * @property {Object<string, CapabilityPointDecl>} capability_points  // keyed by 9 point ids
 * @property {string} locale          // "en-US" | "zh-CN" ...
 * @property {string[]} compliance_tags  // e.g. ["domestic","data-residency-cn"]
 * @property {string} [verified_by]    // "steering" | "unverified"
 * @property {string} [model_registration]  // "pending" | "verified"
 *
 * @typedef {Object} ConformResult
 * @property {boolean} ok
 * @property {string[]} errors   // plain-language failure strings, includes §22.5 requires:hard check
 *
 * @typedef {Object} PlatformArtifact   // the in-memory unit translate() returns, install() consumes
 * @property {string} kind              // "agent-file" | "skill-file" | "mcp-config-merge" | "workflow-command"
 * @property {string} targetPath        // absolute, under platform install dir (e.g. ~/.claude/agents/<name>.md); POSIX-style
 * @property {string} content           // file content (for write kinds)
 * @property {Object} [mcpConfig]      // for mcp-config-merge: the mcpServers entry to merge
 * @property {string} [degradation]     // set when a fallback strategy was used: "http-inject"|"manual-paste"|"http-direct"|"cli-engine"
 * @property {string} [pasteInstructions] // for manual-paste: markdown the user copies
 *
 * @typedef {Object} InstallOpts
 * @property {string} platform
 * @property {string} [brand]
 * @property {string} [project]         // project slug for per-project manifest routing
 * @property {Object} [requires]        // capability's `requires` field (§22.5), used by translate to pick fallback
 * @property {boolean} [dryRun]
 */

export class BaseAdapter {
  /** @type {string} */ platform;

  /** Loads adapters/<platform>/platform.yaml via js-yaml. Memoized per instance.
   *  @param {string} platformDir  absolute adapter dir
   *  @returns {PlatformYaml}
   *  @throws {Error} if platform.yaml missing or fails platform.schema.json (ajv) */
  loadPlatformYaml(platformDir) {}

  /** @param {string} point  one of the 9 capability-point ids
   *  @returns {SupportsResult} */
  supports(point) {}

  /** Tier computed per §22.3:
   *  Tier1 = prompt_exec+agent_file+skill_file+slash_command+mcp_config+config_dir_writable all true
   *  Tier3 = only prompt_exec true
   *  else Tier2.
   *  @returns {1|2|3} */
  tier() {}

  // The 6 existing methods default to no-op / unsupported; subclasses override.
  /** @param {Object} cap  parsed capability.yaml */
  conform(cap) { return { ok: true, errors: [] }; }
  /** @param {Object} cap
   *  @param {InstallOpts} opts
   *  @returns {PlatformArtifact[]} */
  translate(cap, opts) { return []; }
  /** @param {PlatformArtifact[]} artifacts
   *  @param {InstallOpts} opts
   *  @returns {Manifest}  writes files + returns manifest entry (see install.mjs) */
  install(artifacts, opts) { throw new Error('install: unsupported on base'); }
  /** @param {Object} mcp  parsed mcp.yaml
   *  @param {InstallOpts} opts */
  injectMcp(mcp, opts) { throw new Error('injectMcp: unsupported on base'); }
  /** @param {string} capId  <pack>.<name>
   *  @param {InstallOpts} opts */
  uninstall(capId, opts) { throw new Error('uninstall: unsupported on base'); }
  /** @returns {boolean}  platform install dir exists & writable */
  detect() { return false; }
}
```

**Side effects:** `loadPlatformYaml` reads fs. `supports`/`tier` are pure (read memoized yaml). `conform`/`translate` are pure (no fs writes). `install`/`injectMcp`/`uninstall` write to platform install dir + manifest. `detect` stats the platform dir.

**Throws vs returns:** `loadPlatformYaml` throws on missing/invalid yaml (fail-loud, unrecoverable). All other methods **return error objects / unsupported results** rather than throwing — except `install`/`injectMcp`/`uninstall` on a Tier-3 base, which throw `'unsupported on base'` to force subclass override (fail-loud, per §22.3 "Tier 3 platforms may return unsupported + degradation hint").

**Implements:** PLAN.md §22.3 (adapter contract + supports/tier), §6.2 (existing 6 methods), §22.5 (requires:hard check lives in `conform`, see §2.2).

### 2.2 `adapters/claude-code/adapter.mjs` — NEW (§6.2, §22.3, §A.2)

```js
import { BaseAdapter } from '../base.mjs';
export class ClaudeCodeAdapter extends BaseAdapter {
  platform = 'claude-code';
  // loadPlatformYaml inherited; reads adapters/claude-code/platform.yaml
  // supports()/tier() inherited — platform.yaml declares all 9 points supported:true → tier() returns 1

  /** §A.2 semantic-layer conform:
   *  - frontmatter legal (already R1, not duplicated here)
   *  - name == pack.id suffix (already R4)
   *  - entrypoint file exists
   *  - tools (mcp) in platform-supported set
   *  - body has no unsupported syntax (P1: no check beyond schema; defer)
   *  - §A.2 v9: every requires:hard point has supports(point).supported===true
   *  @param {Object} cap
   *  @returns {ConformResult} */
  conform(cap) {}

  /** §6.1 + §7.2 translate:
   *   agent → agent-file artifact at ~/.claude/agents/<name>.md  (frontmatter + source.md body merged)
   *   skill → skill-file artifact at ~/.claude/skills/<name>/SKILL.md
   *   mcp   → mcp-config-merge artifact (no file; mcpConfig entry)
   *   workflow → workflow-command artifact at ~/.claude/commands/workflow-<name>.md
   *              (body produced by workflow-compile.mjs; adapter calls it)
   *  P1: no degradation matrix (all points supported, fallback never triggers).
   *  @param {Object} cap
   *  @param {InstallOpts} opts
   *  @returns {PlatformArtifact[]} */
  translate(cap, opts) {}

  /** §8 atomic idempotent write to ~/.claude/. Expands ~ via resolveHome() (§5).
   *  Idempotency: content-hash compare before write (§5.6).
   *  @returns {Manifest} */
  install(artifacts, opts) {}

  /** §9.2 idempotent merge into ~/.claude.json mcpServers.
   *  env whitelist from mcp.config_template.auth_schema (§B.2).
   *  No secrets in manifest. Idempotent by content-hash compare. */
  injectMcp(mcp, opts) {}

  /** Reverse-by-manifest: remove entries whose id matches, plus any
   *  orphaned mcpServers keys recorded in the manifest's mcp_keys[]. */
  uninstall(capId, opts) {}

  /** §8.4: check ~/.claude/ exists & writable. */
  detect() {}
}
export const adapter = new ClaudeCodeAdapter(); // singleton instance for install.mjs
```

**Side effects:** `conform` reads fs (entrypoint existence). `translate` is pure (calls `workflow-compile.mjs` for workflow kind — that module is pure). `install`/`injectMcp`/`uninstall` write fs + manifest. `detect` stats.

**Throws vs returns:** `conform` returns `ConformResult` (never throws on conform failure; throws only on fs errors). `translate` throws only if `workflow-compile.compile` throws (propagate). `install`/`injectMcp`/`uninstall` throw on fs/manifest write failure (fail-loud, unrecoverable).

**Implements:** §6.2, §A.2, §22.5 (requires:hard check in conform), §8.4 (Windows ~ expansion), §9.2 (mcp injection), §B.2 (env whitelist).

### 2.3 `tools/validate.mjs` — EXTEND (add R16–R22 + R_wf_ref + R_wf_closed + `.opsforge-state.json` exclusion + `requires` conform hook)

Existing exports (`parseCapability`, `checkSchema`, `checkSkeletonGuard`, `checkPlaceholder`, `checkNaming`, `checkEngineeringFieldsUntampered`, `checkVersionLock`, `checkDraftRelaxed`, `validateDir`, `validateAll`, `main`, plus `setRepoRoot`/`setTemplatesDir`/`setSchemaPath` test hooks) remain. **New exports:**

```js
// ── §21.7 anti-vacuous guards (staged-only) ────────────────────────────────
/** R16 body_min_substance. kind-specific thresholds per §21.7/Q6:
 *  agent≥150 / skill≥100 / mcp≥80 (Chinese chars OR equivalent English tokens). */
export function checkBodyMinSubstance(cap) { /* → Check */ }
/** R17 body_not_boilerplate. Patterns: pure-echo, pure placeholder-fill,
 *  body-vs-description ≥80% overlap. */
export function checkBodyNotBoilerplate(cap) { /* → Check */ }
/** R18 test_expect_nontrivial. expected len>3, not in blacklist
 *  {"ok","true","pass","success","yes","done","ok."}, llm_judge requires
 *  judge_rubric ≥20 chars. */
export function checkTestExpectNontrivial(cap) { /* → Check */ }
/** R19 test_cases_distinct. No two cases with identical (input, expect, expected). */
export function checkTestCasesDistinct(cap) { /* → Check */ }
/** R20 description_body_alignment. ≥1 noun from description appears in body
 *  (noun extraction: Chinese 2+ contiguous chars / English ≥4-letter words). */
export function checkDescriptionBodyAlignment(cap) { /* → Check */ }
/** R21 test_expect_declared. Staged cases must declare `expect` explicitly. */
export function checkTestExpectDeclared(cap) { /* → Check */ }
/** R22 no_self_cheat_in_body. Reject "直接返回 expected" / "pass the test by
 *  returning 'ok'" / "输出测试用例的 expected 字段" patterns. */
export function checkNoSelfCheatInBody(cap) { /* → Check */ }

// ── v7 §20.1 workflow structural rules (staged-only) ──────────────────────
/** R_wf_ref: workflow steps[].capability resolvable + outputs names align
 *  with vars declarations. No-op for non-workflow kinds. */
export function checkWorkflowRef(cap, allCaps) { /* → Check */ }
/** R_wf_closed: control_flow references only existing step-ids.
 *  Phase 1: if control_flow present, only `sequence` nodes allowed
 *  (loop/switch/checkpoint rejected at schema level via `not`).
 *  No-op for non-workflow kinds. */
export function checkWorkflowClosed(cap) { /* → Check */ }

// ── v9 §22.10 .opsforge-state.json field validation ────────────────────────
/** If .opsforge-state.json present in cap dir: validate steering fields
 *  (state, history[].ts/from/to) unmodified by author — author may not
 *  tamper with state history. Returns Check. */
export function checkOpsforgeState(cap) { /* → Check */ }
```

**Rule matrix (state column: D=draft, S=staged; ✓=runs, —=exempt):**

| Rule id | Check name | Pass/fail predicate | Staged-only? | § cite |
|---|---|---|---|---|
| R16 | `body_min_substance` | body token count ≥ N(kind) | yes (S) | §21.7 |
| R17 | `body_not_boilerplate` | not matching any boilerplate pattern | yes | §21.7 |
| R18 | `test_expect_nontrivial` | every `expected` non-trivial; llm_judge rubric ≥20 chars | yes | §21.7 |
| R19 | `test_cases_distinct` | no two cases identical on `(input, expect, expected)` | yes | §21.7 |
| R20 | `description_body_alignment` | ≥1 description noun appears in body | yes | §21.7 |
| R21 | `test_expect_declared` | every staged case declares `expect` | yes | §21.7 |
| R22 | `no_self_cheat_in_body` | body contains no self-cheat pattern | yes | §21.7 |
| R_wf_ref | `workflow_ref` | all `steps[].capability` resolvable in repo; `outputs` names align with `vars` | yes | §20.1 |
| R_wf_closed | `workflow_closed` | `control_flow` references only existing step-ids; P1: only `sequence` nodes | yes | §20.1 |

**`validateDir` change:** staged branch appends R16–R22 + R_wf_ref + R_wf_closed + `checkOpsforgeState` to `checks[]`. Draft branch unchanged (R16–R22 do NOT run in draft — preserves §21.8 "draft vibes freely, no eval").

**`.opsforge-state.json` skeleton_guard exclusion (CRITICAL, §5.5):** add a module-level constant `SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json']` in `validate.mjs`. In `checkSkeletonGuard` and `checkEntryGuard`, filter `actual = actual.filter(f => !SKELETON_GUARD_EXCLUSIONS.includes(f))` before the diff. **Do NOT add `.opsforge-state.json` to any `templates/` directory** — it is a runtime overlay, not part of the legal skeleton.

**`requires` conform hook (§22.5 / §A.2):** `validateDir` staged branch additionally imports the platform adapter for each platform in `cap.platforms` and calls `adapter.conform(cap)`. If `ConformResult.ok === false`, push a Check `{ name: 'platform_conformance', status: 'fail', detail: 'platform_conformance: <platform>: <error>' }` per error. P1: only `claude-code` adapter exists; for other 3 enum values, `conform` is a no-op stub returning `{ok:true}` (deferred to Phase 2.1).

**Side effects:** fs reads (already present + new body/case reads). No fs writes. No subprocess. No network.

**Throws vs returns:** every `check*` returns a `Check` object `{ name, status, detail }` — never throws on rule failure (returns `status: 'fail'`). Throws only on unrecoverable fs errors.

### 2.4 `tools/test-runner.mjs` — NEW (§21.3 / §21.5)

```js
/**
 * @typedef {Object} Verdict   // per-case result
 * @property {string} case        case name
 * @property {string} mode        one of 7 expect modes
 * @property {boolean|string} pass  true | false | "pending" (human) | "approved" | "rejected"
 * @property {number} [score]      0–1, for llm_judge/golden
 * @property {string} [reason]     judge reason or failure list
 * @property {string} [missed]    contains-mode missed substrings
 * @property {string} [unmatched]  regex-mode unmatched patterns
 * @property {string} [actual]     the actual output (string; JSON-serialized if structured)
 * @property {string} runner       "claude" | "static-only" | "<platform-slug>"
 *
 * @typedef {Object} SuiteSummary
 * @property {number} total
 * @property {number} passed
 * @property {number} failed
 * @property {number} pending
 * @property {number} score_mean    // 0 if no scored modes
 * @property {Object<string, {total, passed, score_mean?}>} modes  // keyed by mode
 * @property {Verdict[]} failures
 *
 * @typedef {Object} RunCaseOpts
 * @property {string} runner           "claude" (default) | "static-only" | "<platform>"
 * @property {string} [judgeModel]      deferred to Phase 2
 * @property {string} platform          "claude-code" default
 * @property {string} [opsforgeHome]    default resolveOpsforgeHome()
 * @property {number} [evalId]          defaults to uuid for run dir
 */

/**
 * @param {string} capDir   absolute capability dir
 * @param {Object} caseYaml parsed tests/*.yaml (already 7-field)
 * @param {RunCaseOpts} opts
 * @returns {Promise<Verdict>}  // runCase is async (subprocess/HTTP) */
export async function runCase(capDir, caseYaml, opts) {}

/**
 * @param {string} capDir
 * @param {{runner?: string, platform?: string, opsforgeHome?: string}} opts
 * @returns {Promise<{cases: Verdict[], summary: SuiteSummary}>} */
export async function runSuite(capDir, opts = {}) {}

/** CLI entry: `node tools/test-runner.mjs <capDir> [--all]` */
export function main() {}
```

**P1 expect-mode dispatch table** (modes not in P1 are stubbed, not implemented — see risk callout #7 in `IMPLEMENTATION-PLAN.md`):

| Mode | P1 behavior | Runner |
|---|---|---|
| `exact` | string equality OR structured deep-eq if both parse as JSON | local (no model) |
| `contains` | `expected` (string or string[]) all substrings present in `actual` | local |
| `human` | mark `pass: "pending"`, no execution | local |
| `schema` | **stub**: return `{pass: false, reason: 'unsupported-in-phase1'}` | — |
| `regex` | **stub**: `{pass: false, reason: 'unsupported-in-phase1'}` | — |
| `llm_judge` | **stub**: `{pass: false, reason: 'unsupported-in-phase1'}` | — |
| `golden` | **stub**: `{pass: false, reason: 'unsupported-in-phase1'}` | — |

**Dry-run harness (§21.5):**

- `runner: "claude"` (default): for skill/agent, spawn `claude -p` with system prompt = frontmatter + body of `SKILL.md`/`source.md`, user message = `JSON.stringify(input)`. Capture stdout as `actual`. For mcp: spawn stdio MCP server locally, call the first tool in `mcp.tools[]` with `input`, capture response. For workflow: **P1 stub** — return `{pass: "pending", runner: "static-only"}` (real `--run-workflow --dry-run` is Phase 2.4).
- `runner: "static-only"` (env `OPSFORGE_RUNNER=static-only`, or when `claude` not on PATH): skip execution, return `{pass: "pending", runner: "static-only"}` for every case. Writes to report `runner: "static-only"` so CI knows no model was called (§5.3).
- `runner: "<platform-slug>"`: P1 has only `claude-code`; other platform HTTP-API paths are Phase 2.5.

**Side effects:** subprocess (`claude -p` via `node:child_process.spawn`), fs reads (cap dir), fs writes **only** under `~/.opsforge/runs/<eval-id>/` (per §21.5 — never touches `~/.claude/`, never installs, never mutates manifest). No network in P1 (HTTP API runner is Phase 2).

**Throws vs returns:** `runCase`/`runSuite` **never throw on test failure** — they return `Verdict`/`SuiteSummary`. They throw only on unrecoverable infra errors (e.g. cap dir missing, can't create run dir).

**`regression_cases` integration (§21.3 / §A.4):** `validate.mjs` staged gate calls `runSuite` (when `OPSFORGE_RUNNER !== 'static-only'` and `claude` on PATH) OR uses the stub results, and merges `SuiteSummary` into `validation-report.json` per §3 shape. `failed > 0` → `verdict: fail`.

### 2.5 `tools/workflow-compile.mjs` — NEW (§7.2 / §20.4 P1)

```js
/**
 * @param {Object} workflowYaml  parsed workflow.yaml
 * @param {string} platform      target platform slug
 * @returns {PlatformArtifact}  a workflow-command artifact
 *   (kind="workflow-command", targetPath="~/.claude/commands/workflow-<name>.md",
 *    content=<compiled markdown body>)
 * @throws {Error} on: unsupported control_flow node type (P1: only `sequence`);
 *   step.capability unresolvable in workflow.yaml's own steps[]; platform unsupported
 */
export function compile(workflowYaml, platform) {}
```

**P1 behavior (§20.4 P1 "linear only"):**

1. If `workflowYaml.control_flow` is present: iterate nodes. **Only `type: "sequence"` allowed** — `loop`/`switch`/`checkpoint` cause schema-level rejection (§4 `workflow.schema.json` uses `not` to forbid them in P1) AND `compile` throws `Error: workflow-compile: control_flow node type "<type>" not supported in Phase 1`.
2. If `control_flow` absent: derive linear order from `steps[]` declaration order (§7.1 backward-compat).
3. Compiled body: a markdown slash-command body instructing the platform agent to, for each step in order: invoke `step.capability`, persist outputs to `~/.opsforge/runs/<workflow-id>/<run-id>/artifacts/<step-id>/<output>.json`, and write per-run `state.json` (§3 shape). `kb_mount` recognized but **not injected** in P1 (printed as comment in compiled body).
4. No `loop`/`switch`/`checkpoint`/`resume` semantics — those are Phase 2.4/3.1.

**Side effects:** none (pure). fs reads via `resolveOpsforgeHome` for path construction only (no writes). No subprocess.

**Throws vs returns:** `compile` throws on unsupported control-flow node or unresolvable step reference. Returns `PlatformArtifact` on success.

### 2.6 `tools/release.mjs` — NEW (§13.2 / §B.4)

```js
/**
 * @typedef {Object} RegistryEntry
 * @property {string} current          semver
 * @property {Array<{version: string, released_at: string, commit: string}>} history
 * @property {string} changelog_index   repo-relative path to CHANGELOG.md
 *
 * @typedef {Object} RegistryYaml
 * @property {Object<string, RegistryEntry>} capabilities
 *
 * @typedef {Object} RegistryBrandsYaml
 * @property {Object<string, { capabilities: Object<string, RegistryEntry> }>} brands
 */

/**
 * Release a single capability: bumps version per §C.6 (P1: read version from
 * capability.yaml, do NOT auto-bump — author sets staged version; release
 * registers that version). Gate: require validation-report.json verdict=pass
 * AND security-report.json verdict=pass (or block-with-exceptions).
 * P1 does NOT require eval-report (deferred to Phase 2.2).
 * @param {string} capDir
 * @param {{repoRoot?: string}} [opts]
 * @returns {{registered: boolean, id: string, version: string, reason?: string}}
 * @throws {Error} on fs / unrecoverable errors only */
export function release(capDir, opts = {}) {}

/**
 * Scan packs/<contributor>/ and customers/<brand>/packs/<brand>/ for released
 * capabilities, aggregate into registry.yaml + registry-brands.yaml.
 * @param {{repoRoot?: string}} [opts]
 * @returns {{registry: RegistryYaml, registryBrands: RegistryBrandsYaml}}
 *   Also writes both files (atomic temp+rename). */
export function aggregateAll(opts = {}) {}

/** CLI: `node tools/release.mjs <capDir> | --all` */
export function main() {}
```

**Side effects:** fs reads (scan packs/customers), fs writes (registry.yaml + registry-brands.yaml, atomic temp+rename per §5.6). Reads `validation-report.json` + `security-report.json` artifacts from cap dir or CI artifact location (P1: read from `<capDir>/validation-report.json` if present, else skip the gate with a warning — CI is responsible for producing them; the gate is "if present, must be pass; if absent, warn but allow on `--all` for greenfield seeding").

**Throws vs returns:** `release` returns `{registered: false, reason}` on gate failure (does NOT throw). `aggregateAll` throws only on fs errors. Both: never throw on gate failures (return result).

**Implements:** §13.2 (registry current+history), §B.4 (release gate), §C.6 (version strategy — P1: author-owned version, release reads it).

### 2.7 `tools/security-scan.mjs` — NEW (§B.1, P1 minimal subset)

```js
/**
 * @typedef {Object} SecurityFinding
 * @property {string} rule        "hardcoded_secret" | "prompt_injection" | "ssrf_private_network"
 * @property {string} severity    "high" | "medium" | "low"
 * @property {string} evidence    "<file>:<line>: <matched-text>"
 * @property {string} status      "block"   // all 3 P1 families are non-exceptionable → always "block"
 *
 * @typedef {Object} SecurityReport
 * @property {string} id
 * @property {string} origin      "original" | "forked"
 * @property {SecurityFinding[]} findings
 * @property {string} verdict     "pass" | "block"
 * @property {Object[]} exceptions   // [] in P1 — all 3 families are non-exceptionable
 */

/**
 * @param {string} capDir
 * @returns {SecurityReport}
 *   P1 scans exactly 3 non-exceptionable families (per IMPLEMENTATION-PLAN.md §1.5):
 *     1. hardcoded secrets: AKIA*, ghp_*, sk-, -----BEGIN ... PRIVATE KEY-----, connection strings
 *     2. prompt injection: "忽略以上指令"/"以管理员身份"/"删除所有"/"覆盖系统提示"/"ignore previous instructions"
 *     3. private-network SSRF: 169.254.169.254, 127.0.0.0/8, 10/8, 192.168/16, *.internal
 *   Full §B (over-privileged tools, supply-chain, MCP tool-surface, dep advisories,
 *   data-residency-cn) deferred to Phase 3.3. */
export function scan(capDir) {}

/** CLI: `node tools/security-scan.mjs <capDir> | --all` */
export function main() {}
```

**Side effects:** fs reads only. No writes (caller writes `security-report.json`). No subprocess/network.

**Throws vs returns:** `scan` returns `SecurityReport` (never throws on findings — returns `verdict: "block"`). Throws only on fs errors (missing capDir).

**Implements:** §B.1 (3 non-exceptionable families), §B.3 (report shape — P1 minimal: no `exceptions` content, all 3 families non-exceptionable per §B.3 "prompt injection / supply chain / private SSRF three classes may not be excepted" — supply-chain is Phase 3, the other 2 are P1).

### 2.8 `install.mjs` (repo root) — NEW (§8, §20.4 P1)

```js
/**
 * @typedef {Object} Manifest
 * @property {string} project           project slug
 * @property {string} platform
 * @property {string} [brand]
 * @property {Array<{
 *   id: string, version: string, source_commit: string,
 *   customer?: string, security_policy: Object, owner_profile: string,
 *   installed_at: string, mcp_keys: string[], effectiveness_flag?: "degraded",
 *   artifacts: string[]   // absolute paths written
 * }>} capabilities
 * @property {string} installer_version
 * @property {string} manifest_version  "1"
 *
 * @typedef {Object} InstallArgs
 * @property {string} platform
 * @property {string} capId             "<pack>.<name>"
 * @property {string} [version]         defaults to registry current
 * @property {string} [brand]
 * @property {string} [project]         defaults to "default"
 * @property {boolean} [dryRun]
 */

/**
 * Resolve registry → read capability source from packs/<slug>/ or
 * customers/<brand>/ → adapter.translate() → idempotent install() →
 * injectMcp() → write per-project manifest.
 * §20.4 P1 single-layer transitive deps: when installing a workflow, pull
 * its steps[].capability and install them too (registry current).
 * @param {InstallArgs} args
 * @returns {Promise<{installed: string[], manifest: Manifest}>}
 * @throws {Error} on: capId not in registry; platform adapter missing;
 *   requires:hard point unsupported (fail-loud per §22.5); path-traversal
 *   (assertSlugSegment fails on any id segment). */
export async function install(args) {}

/** @param {{platform, capId, project?, brand?}} args
 *  @returns {Promise<{uninstalled: string[]}>} */
export async function uninstall(args) {}

/** @param {{platform, project?, brand?}} args
 *  @returns {Promise<{list: Array<{id, version, installed_at}>}>} */
export async function list(args) {}

/** §8.3 doctor: manifest↔file consistency, depends_on satisfied, MCP config
 *  complete, platform path writable, version-not-behind.
 *  P1 does NOT include effectiveness scan (Phase 3.2).
 *  @param {{platform, project?, brand?}} args
 *  @returns {Promise<{healthy: boolean, issues: Array<{severity, check, detail, fix?}>}>} */
export async function doctor(args) {}

/** CLI: `node install.mjs --install <id> --platform <p> [--brand <b>] ...` */
export function main() {}
```

**Side effects:** fs reads (registry, capability source), fs writes (platform install dir via adapter.install, manifest via atomic temp+rename), subprocess (none in P1; `--run-workflow` is Phase 2.4).

**Throws vs returns:** `install` throws on unrecoverable errors (registry miss, adapter missing, requires:hard fail-loud, traversal). `uninstall`/`list`/`doctor` return results; `doctor` returns `{healthy: false, issues}` rather than throwing on check failures.

**Idempotency (§5.6):** `install` and `injectMcp` are idempotent via content-hash compare before write — see §5.6.

### 2.9 `tools/opsforge.mjs` — NEW (§22.8, P1 minimal)

```js
/**
 * P1 commands (each is an async function; opsforge.mjs main() dispatches):
 *   opsforge new        interactive scaffold → calls new-capability.mjs scaffold
 *   opsforge install    interactive single-capability install
 *   opsforge status [path]   render .opsforge-state.json → traffic-light progress
 *   opsforge doctor     basic interactive doctor
 * Uses node:readline (no new deps, §C.1).
 *
 * @param {string[]} argv
 * @returns {Promise<number>}  exit code */
export async function main(argv) {}

// Internal helpers (exported for test mocking):
/** @param {readline.Interface} rl  mocked readline
 *  @returns {Promise<{kind, slug, name, brand?}>} */
export async function promptNew(rl) {}

/** @param {readline.Interface} rl
 *  @param {{platform: string}} opts
 *  @returns {Promise<{capId, platform, project?}>} */
export async function promptInstall(rl, opts) {}
```

**P1 scope:** `new`/`install`/`status`/`doctor` only. `wizard`/`report`/`discover`/`feedback` are Phase 2/3. `opsforge report <artifact>` is replaced in P1 by direct `report-renderer.render()` invocation from `opsforge status`/`doctor` (which render validation-report inline).

**Phase 演进状态（2026-07-24 审计 + Phase 3.6 收尾）：** Phase 2.5 后 `opsforge.mjs` 扩展为裸子命令分发（`new`/`wizard`/`install`/`status`/`doctor`/`report`/`discover`），工程后端 COMPLETE。原 UX shell deferred to Phase 3.6 的 5 项偏差**已由 Phase 3.6 全部修复**（architect 已把归属从 Phase 4 改为 Phase 3.6）：(1) 顶层菜单——`opsforge menu` 6 选项首交互，替换裸 `switch(cmd)` 分发；(2) wizard 端到端——`cmdWizard` 串接 scaffold→填字段→validate→test→report→install 5 步；(3) discover 质量灯——`cmdDiscover` 改读 per-project manifest + 质量灯 + 商用标签（feedback jsonl + eval-history 深度聚合留 Phase 3.2）；(4) 载体 B——`packs/opsforge-meta/` 已落地（`pack.yaml` + `agents/opsforge/` + `agents/opsforge-installer/` + `skills/opsforge-wizard/`）；(5) 无 cwd bootstrap——`opsforge-runtime.mjs` `resolveWorkDir()` 三级回退（env > cwd 仓库 > home/workdir > home 首建写 `.opsforge-bootstrap.json`）+ `~/.opsforge/.runtime-root.json`。载体 D paste 文件**已落地**（`adapters/cline|codex|dify` 非空 `pasteInstructions` → `install.mjs:182-196`；Tier 1 null 正确，勿改坏）。Phase 3.6 新增 `tools/opsforge-bootstrap.mjs`/`tools/opsforge-runtime.mjs`/`packs/opsforge-meta/`，扩展 `install.mjs`（`readRegistryForInstall` home 回退）+ `CODEOWNERS`/`ci/guardrails.yml`。**架构不变量：** runtime 副本动态 import 仓库根 `install.mjs` → 仓库须持续存在。bare `node --test` 341/0；6 gates 全绿（7 caps）。

**Side effects:** subprocess (calls `new-capability.mjs`/`install.mjs` via `node:child_process.spawn` OR direct in-process function imports — tdd-guide: prefer direct imports to keep tests seam-able). fs reads (`.opsforge-state.json`). fs writes none directly (delegates).

**Throws vs returns:** `main` returns exit code; never throws (catches and prints). Internal helpers throw on readline errors only.

### 2.10 `tools/report-renderer.mjs` — NEW (§22.9, P1 minimal)

```js
/**
 * @typedef {Object} RenderedReport
 * @property {string} text           formatted Chinese plain-text (or English if --lang en)
 * @property {"green"|"yellow"|"red"} light   top-level traffic light
 * @property {string} oneLiner       one-sentence conclusion
 *
 * @param {Object} reportJson     parsed validation-report.json (P1 only)
 * @param {"validation-report"|"security-report"|"eval-report"|"manifest"} type
 *   P1: only "validation-report" implemented; others throw.
 * @param {{lang?: "zh"|"en"}} opts
 * @returns {RenderedReport}
 *   Renders per §22.9: 红绿灯 (绿 pass / 黄 warning·pending / 红 fail·block),
 *   one-sentence conclusion, plain-language fix guidance per red/yellow item,
 *   internal rule IDs (R16 etc.) folded into "详细技术信息" section (default collapsed).
 *   Template loaded from tools/report-templates/<type>.<lang>.md. */
export function render(reportJson, type, opts = {}) {}
```

**P1 scope:** only `validation-report` type + `zh` lang. `security-report`/`eval-report`/`manifest` are Phase 2. `--lang en` is Phase 4 (D6 default zh, §22.6).

**Side effects:** fs read (template file under `tools/report-templates/`). No writes. No subprocess/network. Pure function otherwise.

**Throws vs returns:** `render` throws on unsupported `type`/`lang` combo or missing template. Returns `RenderedReport` on success.

**Implements:** §22.9 (renderer rules), §22.6 D6 (default zh).

---

## 3. Data shapes (exact JSON)

### 3.1 `PlatformArtifact` (translate() returns, install() consumes)

```json
{
  "kind": "agent-file",            // "agent-file" | "skill-file" | "mcp-config-merge" | "workflow-command"
  "targetPath": "~/.claude/agents/copywriter.md",  // absolute, POSIX-style, ~ expanded by install() not translate()
  "content": "---\nid: marketing-team.copywriter\n...\n---\n<body>",
  "mcpConfig": null,               // for kind="mcp-config-merge": { "servers": { "<name>": { ... } } }
  "degradation": null,             // null in P1 (claude-code is Tier 1); Phase 2 sets "http-inject"|"manual-paste"|"http-direct"|"cli-engine"
  "pasteInstructions": null        // Phase 2.5 已落地：Tier 2/3 adapters (cline/codex/dify) translate() 产非 null → install.mjs:182-196 写 paste/<project>/<capSlug>.md（F4 fix）；Tier 1 (claude-code/cursor) 永远 null 正确（有 agent_file/skill_file 不需 paste 说明书）。UX 菜单引导随载体 B 在 Phase 3.6 SHIPPED。
}
```

### 3.2 `.opsforge-manifest.json` / per-project manifest (`~/.opsforge/manifests/<project-slug>.manifest.json`)

```json
{
  "manifest_version": "1",
  "project": "default",
  "platform": "claude-code",
  "brand": null,
  "installer_version": "0.1.0",
  "capabilities": [
    {
      "id": "marketing-team.copywriter",
      "version": "1.0.0",
      "source_commit": "a1b2c3d",
      "customer": null,
      "security_policy": {
        "env_whitelist": [],
        "network_egress": [],
        "tool_downgrade": null
      },
      "owner_profile": "default",
      "installed_at": "2026-07-23T10:00:00Z",
      "mcp_keys": [],
      "effectiveness_flag": null,     // "degraded" set in Phase 3.2; null in P1
      "artifacts": [
        "~/.claude/agents/copywriter.md"
      ]
    }
  ]
}
```

> Note: the file is named `<project-slug>.manifest.json` (per-project isolation, §20.2 P6). The legacy `.opsforge-manifest.json` single-file shape from §6.3 is subsumed by this per-project file. `install.mjs` writes via atomic temp+rename (§5.6).

### 3.3 `validation-report.json` (Phase 1 shape, §A.4 + §21.3 `regression_cases`)

```json
{
  "id": "marketing-team.copywriter",
  "origin": "original",
  "checks": {
    "schema": "pass",
    "yaml_parse": "pass",
    "id_unique": "pass",
    "naming": "pass",
    "version_semver": "pass",
    "placeholder_clean": "pass",
    "skeleton_guard": "pass",
    "engineering_fields_untampered": "pass",
    "display_names_i18n": "pass",
    "customer_dir_consistency": "pass",
    "depends_on_resolvable": "pass",
    "depends_on_direction": "pass",
    "tests_min": "pass",
    "body_min_substance": "pass",
    "body_not_boilerplate": "pass",
    "test_expect_nontrivial": "pass",
    "test_cases_distinct": "pass",
    "description_body_alignment": "pass",
    "test_expect_declared": "pass",
    "no_self_cheat_in_body": "pass",
    "workflow_ref": "n/a",          // "n/a" for non-workflow kinds
    "workflow_closed": "n/a",
    "opsforge_state": "pass",
    "platform_conformance": { "claude-code": "pass" }
  },
  "regression_cases": {
    "total": 3,
    "passed": 3,
    "failed": 0,
    "pending_human": 0,
    "modes": {
      "exact": { "total": 2, "passed": 2 },
      "contains": { "total": 1, "passed": 1 },
      "human": { "total": 0, "pending": 0 }
    },
    "failures": []
  },
  "verdict": "pass"
}
```

### 3.4 `security-report.json` (P1 minimal shape, §B.3)

```json
{
  "id": "marketing-team.copywriter",
  "origin": "original",
  "findings": [
    { "rule": "hardcoded_secret", "severity": "high", "evidence": "source.md:12: sk-...", "status": "block" }
  ],
  "verdict": "block",
  "exceptions": []
}
```

### 3.5 `registry.yaml` + `registry-brands.yaml` entry shape (§13.2)

`registry.yaml`:
```yaml
capabilities:
  marketing-team.copywriter:
    current: 1.0.0
    history:
      - { version: 1.0.0, released_at: "2026-07-23", commit: "a1b2c3d" }
    changelog_index: packs/marketing-team/agents/copywriter/CHANGELOG.md
  marketing-team.activity-summary:
    current: 1.0.0
    history:
      - { version: 1.0.0, released_at: "2026-07-23", commit: "a1b2c3d" }
    changelog_index: packs/marketing-team/skills/activity-summary/CHANGELOG.md
```

`registry-brands.yaml` (P1 may be empty/minimal — no brand examples ship until Phase 3.4):
```yaml
brands: {}
```

### 3.6 `.opsforge-state.json` (written into cap dirs by `new-capability.mjs`)

```json
{
  "state": "draft",                // "draft" | "staged" | "released"
  "history": [
    { "ts": "2026-07-23T10:00:00Z", "from": null, "to": "draft", "pr": "#12" }
  ]
}
```

### 3.7 `adapters/<platform>/platform.yaml` shape (§22.2, 9 capability_points keyed)

```yaml
platform: claude-code
display_name: Claude Code
display_name_zh: Claude Code
capability_points:
  prompt_exec:        { supported: true, mode: cli }     # claude -p
  agent_file:         { supported: true }
  skill_file:         { supported: true }
  slash_command:      { supported: true }
  mcp_config:         { supported: true }
  workflow_orchestration: { supported: true }
  config_dir_writable: { supported: true }
  kb_mount:           { supported: true }                # reserved; injection in Phase 2.4
  feedback_hook:      { supported: true }               # reserved; MCP in Phase 3.2
locale: en-US
compliance_tags: []
verified_by: steering
```

For P1, `adapters/claude-code/platform.yaml` declares all 9 points `supported: true` (Tier 1). The other 3 existing platform enums (cursor/codex/cline) get **stub** `platform.yaml` files in P1 only if needed by `platform.schema.json` validation — but `IMPLEMENTATION-PLAN.md` Phase 1 scope is single-platform, so cursor/codex/cline platform.yaml is **Phase 2.1**. P1 ships only `adapters/claude-code/platform.yaml`.

---

## 4. Schema deltas (all `additionalProperties: false`)

### 4.1 `schema/test-case.schema.json` — NEW (§21.2)

- **top-level properties:** `name` (string, pattern `^[a-z][a-z0-9-]{2,30}$`), `input` (any, required), `expect` (enum `exact|schema|contains|regex|llm_judge|golden|human`, required), `expected` (any, optional — required when `expect` ∈ {exact, contains, regex}), `schema_ref` (string|null, default null), `judge_rubric` (string|null, default null), `judge_threshold` (number, default 0.7, 0–1), `weight` (number, default 1.0, >0), `platforms` (array|null, default null), `timeout_ms` (integer, default 30000)
- **required:** `["name", "input", "expect"]`
- **additionalProperties:** `false`
- **conditional:** if `expect: llm_judge` then `judge_rubric` required and minLength 20 (enforced at runtime by R18, not schema — schema stays permissive on `judge_rubric` to allow null default).

### 4.2 `schema/platform.schema.json` — NEW (§22.2)

- **top-level properties:** `platform` (string, pattern `^[a-z][a-z0-9-]{2,30}$`, required), `display_name` (string, required), `display_name_zh` (string, required), `capability_points` (object keyed by exactly the 9 point ids: `prompt_exec`/`agent_file`/`skill_file`/`slash_command`/`mcp_config`/`workflow_orchestration`/`config_dir_writable`/`kb_mount`/`feedback_hook`; each value is an object with `supported: boolean` required, optional `mode`/`endpoint_env`/`auth_env`/`fallback`/`meta`; required), `locale` (string, required), `compliance_tags` (array of strings, required), `verified_by` (string, optional), `model_registration` (string, optional)
- **required:** `["platform", "display_name", "display_name_zh", "capability_points", "locale", "compliance_tags"]`
- **additionalProperties:** `false`
- **capability_points value-objects:** also `additionalProperties: false`, properties `supported`/`mode`/`endpoint_env`/`auth_env`/`fallback`/`meta`.

### 4.3 `schema/capability.schema.json` — EXTEND (§22.5)

- Add optional top-level `requires` field:
  ```json
  "requires": {
    "type": "array",
    "items": {
      "type": "object",
      "additionalProperties": false,
      "required": ["point", "severity"],
      "properties": {
        "point": { "type": "string", "enum": ["prompt_exec","agent_file","skill_file","slash_command","mcp_config","workflow_orchestration","config_dir_writable","kb_mount","feedback_hook"] },
        "severity": { "type": "string", "enum": ["hard", "soft"] },
        "fallback": { "type": "string", "enum": ["cli-engine", "http-inject", "manual-paste", "http-direct", "fail-loud"] }
      }
    }
  }
  ```
- Do **NOT** extend `platforms` enum beyond the existing 4 values (`claude-code`/`cursor`/`codex`/`cline`) in P1 — domestic platform enum extension is Phase 2.5+ (per `IMPLEMENTATION-PLAN.md` §1.1 item 6).
- `additionalProperties: false` preserved (the `requires` field is explicitly declared, so it does not violate the schema's closed-world guarantee).

### 4.4 `schema/workflow.schema.json` — NEW (§7.1, §20.1 P1)

- **top-level properties:** `id`, `version`, `kind` (const `workflow`), `pack`, `owner`, `customer?`, `display_name`, `display_name_zh`, `display_name_en`, `description`, `platforms`, `params_schema` (const `params.schema.json`), `steps` (array of step objects: `id`/`capability`/`inputs`/`outputs`, required), `control_flow?` (optional; if present, array of nodes; P1 uses JSON Schema `not` to forbid `loop`/`switch`/`checkpoint` node types — only `sequence` allowed), `vars?` (optional array of var decls), `kb_mount?` (boolean, default false), `tests` (const `tests/`), `changelog` (const `CHANGELOG.md`), `source` (same shape as capability.schema), `outputs` (object, default `{}`)
- **required:** `["id", "version", "kind", "pack", "owner", "display_name", "display_name_zh", "display_name_en", "description", "platforms", "params_schema", "steps", "tests", "changelog", "source"]`
- **additionalProperties:** `false`
- **P1 control_flow restriction** (via `not`): `control_flow` items may only have `type: "sequence"`; items with `type: "loop"|"switch"|"checkpoint"` rejected at schema level.

### 4.5 `schema/bundle.schema.json` — NEW (§3.5)

- **top-level properties:** `id`, `version`, `kind` (const `bundle`), `pack`, `owner`, `customer?`, `display_name*`, `description`, `platforms`, `capabilities` (array of `<pack>.<name>@<range>` strings, required), `workflows` (array of strings), `tests`, `changelog`, `source`
- **required:** `["id", "version", "kind", "pack", "owner", "display_name", "display_name_zh", "display_name_en", "description", "platforms", "capabilities", "tests", "changelog", "source"]`
- **additionalProperties:** `false`

### 4.6 `schema/pack.schema.json`, `schema/brand.schema.json`, `schema/upstream-ref.schema.json` — NEW (§17, minimal, P1 ships contracts only)

- `pack.schema.json`: `pack` (string slug), `display_name`, `display_name_zh`, `display_name_en`, `owner`, `created_at`. `additionalProperties: false`. Required: all 5.
- `brand.schema.json`: per §5.3 — `brand_slug`, `display_name`, `display_name_zh`, `created_at`, `contact`, `notes`. `additionalProperties: false`. Required: first 5.
- `upstream-ref.schema.json`: per §12.1 — `repo`, `commit`, `license`, `intaked_at`, `intaked_by`. `additionalProperties: false`. Required: all 5.

> These 3 are shipped in 1.1 so `validate.mjs` can reference them, but full intake/brand flows are Phase 3.4. P1 implements only the schema files + ajv wiring.

### 4.7 Templates delta (§1.1 item 8)

`templates/{agent,skill,mcp,workflow,bundle,brand-draft}/tests/case-0[1-3].yaml` upgraded from 3 fields to 7 fields. **File names unchanged** (so R8 `skeleton_guard` file-set comparison is unaffected — PROGRESS.md lesson 4 confirmed templates are source of truth for file set). Engineering fields `expect: exact`/`judge_threshold: 0.7`/`weight: 1.0` pre-filled; business fields `name`/`input`/`expected`/`judge_rubric` stay `__FILL_ME__`. Example new `case-01.yaml`:
```yaml
name: __FILL_ME__
input: __FILL_ME__
expect: exact
expected: __FILL_ME__
schema_ref: null
judge_rubric: null
judge_threshold: 0.7
weight: 1.0
```

---

## 5. Cross-cutting decisions (locked — tdd-guide must not deviate)

### 5.1 `~` expansion on Windows + atomic writes (§8.4)

**Home resolution helper** (single source of truth; all modules import from a shared `tools/paths.mjs` — NEW small helper module, steering-owned, path-guarded):

```js
// tools/paths.mjs
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** Resolve ~ to USERPROFILE on Windows, HOME elsewhere. Honors OPSFORGE_HOME env.
 *  @returns {string} absolute home dir */
export function resolveHome() {
  if (process.env.OPSFORGE_HOME) return path.resolve(process.env.OPSFORGE_HOME);
  return process.env.USERPROFILE || os.homedir();  // USERPROFILE first on Windows
}

/** Resolve ~/.opsforge root. */
export function resolveOpsforgeHome() {
  return path.join(resolveHome(), '.opsforge');
}

/** Atomic write: write to <dest>.tmp.<pid> then rename. fsync the temp before rename.
 *  Idempotent short-circuit: if existing file's content hash === new content, skip write.
 *  @param {string} absDest  absolute target path
 *  @param {string|Buffer} content */
export async function atomicWrite(absDest, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(absDest)) {
    const existing = fs.readFileSync(absDest);
    if (existing.length === buf.length && existing.equals(buf)) return; // idempotent no-op
  }
  await fs.promises.mkdir(path.dirname(absDest), { recursive: true });
  const tmp = `${absDest}.tmp.${process.pid}`;
  const fh = await fs.promises.open(tmp, 'w');
  await fh.writeFile(buf);
  await fh.sync();   // fsync before rename for crash safety
  await fh.close();
  await fs.promises.rename(tmp, absDest);  // atomic on same volume
}

/** Read JSON if exists else return null. */
export async function readJsonOrNull(p) {
  try { return JSON.parse(await fs.promises.readFile(p, 'utf8')); }
  catch { return null; }
}
```

All fs writes by `install.mjs`/`adapter.install`/`adapter.injectMcp`/`release.mjs`/`test-runner.mjs` (run files) MUST go through `atomicWrite`. **No `fs.writeFileSync` for final outputs.**

### 5.2 `OPSFORGE_HOME` env override + directory layout

- Default: `~/.opsforge/` (via `resolveOpsforgeHome()`).
- Env override: `OPSFORGE_HOME` (absolute path; if relative, resolve against `process.cwd()`).
- Layout under it (created lazily by first writer):
  - `runs/<workflow-id>/<run-id>/{state.json, artifacts/<step-id>/<output>.json, run.log, params.snapshot.yaml}` — workflow dry-run + real runs (P1: only dry-run stub writes here).
  - `manifests/<project-slug>.manifest.json` — per-project install manifest (§3.2).
  - `kb/` — reserved (Phase 2.4/3.2 writes here).
  - `eval-history/` — reserved (Phase 2.2/3 writes here).

### 5.3 `static-only` runner mode detection (so CI never calls a real model)

- Detection: `process.env.OPSFORGE_RUNNER === 'static-only'` OR `claude` not found on PATH (via `child_process.spawn('claude', ['--version'])` with try/catch, 3s timeout).
- When `static-only`: `runCase` returns `{pass: "pending", runner: "static-only"}` for every case; `runSuite` returns `summary.runner: "static-only"` and writes to `validation-report.json`:
  ```json
  "regression_cases": {
    "total": 3, "passed": 0, "failed": 0, "pending_human": 3,
    "modes": { "exact": {"total": 2, "passed": 0, "pending": 2}, ... },
    "runner": "static-only",
    "runner_limited": true
  }
  ```
- `validate.mjs` treats `runner: "static-only"` cases as **not failures** (they are `pending`, not `failed`) — so CI greenfield seeding passes without a model. This is the mechanism that lets `validate.mjs --all` exit 0 on a repo with example capabilities even when `claude` is unavailable (per `IMPLEMENTATION-PLAN.md` success criteria).
- CI workflows set `OPSFORGE_RUNNER=static-only` explicitly (§7, ci/test.yml).

### 5.4 Path-traversal guard — single `assertSlugSegment()` helper

Lives in `tools/paths.mjs` (same module as §5.1):

```js
const SLUG_RE = /^[a-z][a-z0-9-]{2,30}$/;
const CAP_ID_RE = /^[a-z][a-z0-9-]{2,30}\.[a-z][a-z0-9-]{2,30}$/;

/** @param {string} seg  @param {string} label  @returns {string} seg
 *  @throws {Error} if seg fails SLUG_RE (also rejects '..', '/', leading '.') */
export function assertSlugSegment(seg, label = 'segment') {
  if (typeof seg !== 'string' || !SLUG_RE.test(seg)) {
    throw new Error(`path-guard: ${label} "${seg}" does not match ^[a-z][a-z0-9-]{2,30}$`);
  }
  return seg;
}

/** Splits "<pack>.<name>" and asserts both halves. */
export function assertCapId(capId) {
  if (!CAP_ID_RE.test(capId)) throw new Error(`path-guard: capId "${capId}" invalid`);
  return capId;
}
```

**Call sites (non-exhaustive — tdd-guide must apply at EVERY id segment from registry/manifest/workflow steps):**
- `install.mjs`: every `capId` from `--install`/registry lookup, every `steps[].capability` segment, every `<brand>` value.
- `release.mjs`: every `id` segment when building `changelog_index` paths.
- `workflow-compile.mjs`: every `step.capability` `<pack>.<name>` segment when constructing artifact paths.
- `adapter.install`/`adapter.translate`: every `<name>` used in `targetPath`.
- `new-capability.mjs` already has `validateSlug` (Phase 0, PROGRESS.md lesson 2) — keep it; do not duplicate the logic, optionally refactor to import `assertSlugSegment` (low priority, not required for P1).

### 5.5 `.opsforge-state.json` skeleton-guard exclusion

- **Mechanism:** module-level constant in `tools/validate.mjs`:
  ```js
  const SKELETON_GUARD_EXCLUSIONS = ['.opsforge-state.json'];
  ```
- **Where R8 (`checkSkeletonGuard`) checks it:** filter `actual` file list before the set-diff:
  ```js
  const actual = walkFiles(cap.dir).filter(f => !SKELETON_GUARD_EXCLUSIONS.includes(f));
  ```
- **Where R15 (`checkEntryGuard`) checks it:** same filter applied to `actual` before the subset-match.
- **Do NOT add `.opsforge-state.json` to `templates/`** — it is a runtime overlay written by `new-capability.mjs` scaffold/promote, not a skeleton file. The exclusion list is the single source of truth for "steering overlay files that business authors did not create and cannot edit"; future additions (e.g. `.opsforge-feedback.jsonl` if it ever lands in-cap-dir) go in this list, not in templates.
- **R9 (`engineering_fields_untampered`) interaction:** `checkOpsforgeState` (new, §2.3) validates that if `.opsforge-state.json` exists, its `state`/`history` fields were not author-tampered (the `state` value must be one of `draft|staged|released` and consistent with the directory's `_drafts/`/`_staged/` location). This is a separate Check, not part of R8.

### 5.6 Idempotency contract for `install()` and `injectMcp()`

- **`install()` idempotency:** for each `PlatformArtifact` with `kind` ∈ {`agent-file`, `skill-file`, `workflow-command`}: compute `sha256(content)` (or use `Buffer.equals` per `atomicWrite`), compare to existing file at `targetPath`. If equal, skip write and record `artifacts: [...]` in manifest with a `reused: true` flag (optional). If not equal, overwrite via `atomicWrite`. **Running `install` twice with the same capability source must produce zero file diff on the second run.**
- **`injectMcp()` idempotency:** read `~/.claude.json`, compute the would-be merged `mcpServers` object. If the existing `mcpServers[<name>]` is deep-equal to the new entry (structural compare, key-order-independent), skip write. Else `atomicWrite` the full merged JSON. The manifest records `mcp_keys: ["<name>"]` for `uninstall` to reverse.
- **Manifest idempotency:** `install` reads the per-project manifest, dedupes `capabilities[]` by `id` (later install of same id replaces the earlier entry — version bump), writes via `atomicWrite`.

---

## 6. DESIGN.md + PROGRESS.md doc deltas

### 6.1 DESIGN.md — ADD these sections (do NOT rewrite existing Phase 0 sections)

| New section heading | One-line summary |
|---|---|
| `## 3.7 templates/*/tests/case-0[1-3].yaml` (extend §3) | 7-field test-case skeleton; engineering fields pre-filled, business fields `__FILL_ME__`. |
| `## 2.15 adapters/base.mjs` | BaseAdapter class with `supports`/`tier`/`loadPlatformYaml` + 6 no-op default methods; `PlatformYaml`/`PlatformArtifact`/`InstallOpts` typedefs. |
| `## 2.16 adapters/claude-code/{adapter.mjs,platform.yaml,mcp-config.template.json}` | Claude-code adapter: conform/translate/install/injectMcp/uninstall/detect; platform.yaml declares all 9 points Tier 1. |
| `## 2.17 install.mjs + install.sh` | Repo-root cross-platform installer; `install`/`uninstall`/`list`/`doctor` exports; `Manifest` shape; atomic + idempotent writes; `OPSFORGE_HOME` layout. |
| `## 2.18 tools/test-runner.mjs` | `runCase`/`runSuite` + `Verdict`/`SuiteSummary`; P1 modes `exact`/`contains`/`human` only; `static-only` detection; dry-run harness writes only under `~/.opsforge/runs/`. |
| `## 2.19 tools/workflow-compile.mjs` | `compile(workflowYaml, platform)` → `PlatformArtifact`; P1 linear `sequence` only; `loop`/`switch`/`checkpoint` rejected at schema + runtime. |
| `## 2.20 tools/release.mjs` | `release`/`aggregateAll`; gate = validation-report + security-report pass (P1: 2 reports, eval-report deferred); writes registry.yaml + registry-brands.yaml atomically. |
| `## 2.21 tools/security-scan.mjs` | `scan(capDir)` → `SecurityReport`; P1 minimal 3 non-exceptionable families (secrets / prompt-injection / private-SSRF); full §B deferred to Phase 3.3. |
| `## 2.22 tools/opsforge.mjs` | Interactive wizard; P1 commands `new`/`install`/`status`/`doctor`; uses `node:readline`; delegates to existing tools. |
| `## 2.23 tools/report-renderer.mjs + tools/report-templates/` | `render(reportJson, type, opts)` → `RenderedReport`; P1 renders `validation-report` only; zh default; traffic-light + fix guidance. |
| `## 2.24 tools/paths.mjs` | Shared helpers: `resolveHome`/`resolveOpsforgeHome`/`atomicWrite`/`assertSlugSegment`/`assertCapId`/`readJsonOrNull`. |
| `## 5.1 R16–R22 + R_wf_ref + R_wf_closed` (extend §5 rule matrix) | 7 anti-vacuous guards + 2 workflow structural rules; all staged-only; precise fail messages. |
| `## 5.2 .opsforge-state.json exclusion + checkOpsforgeState` | `SKELETON_GUARD_EXCLUSIONS` constant; `checkOpsforgeState` validates steering fields unmodified. |
| `## 5.3 platform_conformance check` | `validateDir` staged branch calls `adapter.conform(cap)` per platform in `cap.platforms`; `requires:hard` check lives in `conform`. |
| `## 8 Data shapes` (new top-level section) | `PlatformArtifact`, per-project manifest, `validation-report.json` (P1 shape with `regression_cases`), `security-report.json`, `registry*.yaml`, `.opsforge-state.json`, `platform.yaml` — exact JSON. |
| `## 9 Schemas` (new top-level section) | `test-case.schema.json` / `platform.schema.json` / `workflow.schema.json` / `bundle.schema.json` / `pack`/`brand`/`upstream-ref`; `capability.schema.json` `requires` extension. |

### 6.2 PROGRESS.md status updates (doc-updater applies at pipeline close)

- Phase 1.1 (schema/template contracts) → **in progress** → **complete** (32 existing tests still green + new `tools/schema-contracts.test.mjs` or folded cases green).
- Phase 1.2 (adapter base + claude-code) → **in progress** → **complete** (`adapters/claude-code/adapter.test.mjs` green; `BaseAdapter.tier()` returns 1).
- Phase 1.3 (R16–R22 + test-runner + R_wf_*) → **in progress** → **complete** (T29–T40 green; `tools/test-runner.test.mjs` green; `static-only` mode verified).
- Phase 1.5 (release + minimal security-scan) → **in progress** → **complete** (built before 1.4 final wiring; registry round-trip test green; 3 security families block).
- Phase 1.4 (workflow-compile + installer) → **in progress** → **complete** (linear workflow compiles to slash-command; `install`/`uninstall`/`doctor` idempotent; transitive deps single-layer).
- Phase 1.6 (example capabilities dogfood) → **in progress** → **complete** (3 caps + 1 workflow pass R1–R22 + runSuite + security-scan + release; `validate --all` exit 0).
- Phase 1.7 (UX minimal) → **in progress** → **complete** (`opsforge new`/`status`/`doctor` flows; `report-renderer` zh traffic-light).
- Phase 1.8 (CI workflows) → **in progress** → **complete** (validate.yml/test.yml/release.yml green on PR; guardrails.yml extended).

**New accepted deviations** (none expected beyond the planner's risk callouts; if tdd-guide hits one, document here with rationale and steering-confirmation-needed flag):
- `.opsforge-state.json` skeleton-guard exclusion — **accepted by design** (per `IMPLEMENTATION-PLAN.md` risk callout #1; mechanism in §5.5).
- P1 `test-runner.mjs` stubs 4 of 7 expect modes — **accepted by design** (per risk callout #7; Phase 2.2 implements them).
- P1 `release.mjs` requires 2 reports not 3 — **accepted by design** (per risk callout #10; Phase 2.2 adds eval-report).
- P1 `workflow-compile` is linear-only — **accepted by design** (per risk callout #8; Phase 2.4/3.1 add switch/loop/checkpoint).
- P1 ships only `adapters/claude-code/platform.yaml`; cursor/codex/cline platform.yaml deferred to Phase 2.1 — **accepted by design** (per `IMPLEMENTATION-PLAN.md` Phase 1 single-platform scope).

---

## 7. Open architecture questions for the user

After reading all of `IMPLEMENTATION-PLAN.md`, `DESIGN.md`, `PLAN.md` (§6/§7/§8/§13/§A/§B/§C/§14/§20/§21/§22), and all three supplements, **no items are genuinely undecidable**. Every ambiguous point has a stated default in either the planner's risk callouts or the v7/v8/v9 decision records (P1–P8, Q1–Q11, D1–D6 all confirmed). The defaults tdd-guide should code to:

1. **`.opsforge-state.json` vs R8** — default per §5.5 here (exclusion list). Locked.
2. **v6 §15 vs v8/v9 phase mapping for `security-scan.mjs`** — default: P1 ships 3 non-exceptionable families; full §B in Phase 3.3. Locked.
3. **`platform.schema.json` phase placement** — default: ship in 1.1. Locked.
4. **Node v22 vs v24** — default: `.nvmrc` pins 22, CI installs 22, `engines` unchanged. Locked (PROGRESS.md open item is CI-only, not architecture).
5. **D5 brand-variant skeletons** — default: runtime-inject `customer` (Phase 0 shipped this; PROGRESS.md confirms). Locked.
6. **D6 third-party intake Phase 0 scope** — default: path-gen + `source.origin: forked` only; full validation Phase 3.4. Locked.
7. **`judge-prompt.md`/`llm_judge` in Phase 1?** — default: no; P1 `test-runner.mjs` supports only `exact`/`contains`/`human`; other modes stub to `unsupported-in-phase1`. Locked.
8. **`--run-workflow` in Phase 1?** — default: no; P1 `test-runner.mjs` workflow dry-run stubbed to `static-only`; real `--run-workflow --dry-run` in Phase 2.4. Locked.
9. **Template content change (3→7 field cases) breaks Phase 0 tests?** — default: re-run full Phase 0 suite after 1.1; fix fixtures not templates; R8 compares file names not content. Locked.
10. **`release.mjs` requiring `eval-report` in P1?** — default: no; P1 requires only validation + security (2 reports); Phase 2.2 adds eval-report as 3rd. Locked.
11. **`requires` field and `conform()` interaction** — default: implement in `conform()` in Phase 1.2 (§2.2). Locked.
12. **Registry seeding for `install.mjs` tests** — default: build 1.5 before final 1.4 wiring; use hand-seeded registry fixtures for 1.4 unit tests. Locked.

**Relevant file paths (absolute):**
- `D:\XD\ClaudeCode\sy-eeo\IMPLEMENTATION-PLAN.md` — planner's full plan (primary input)
- `D:\XD\ClaudeCode\sy-eeo\DESIGN.md` — Phase 0 file-by-file blueprint (extended by §6.1 above)
- `D:\XD\ClaudeCode\sy-eeo\PLAN.md` — v9 spec (§6/§7/§8/§13/§A/§B/§C/§14/§20/§21/§22)
- `D:\XD\ClaudeCode\sy-eeo\docs\design-archive\supplement-v7.md` — workflow + profile
- `D:\XD\ClaudeCode\sy-eeo\docs\design-archive\supplement-v8.md` — behavioral eval layer
- `D:\XD\ClaudeCode\sy-eeo\docs\design-archive\supplement-v9.md` — platform-points + UX
- `D:\XD\ClaudeCode\sy-eeo\schema\capability.schema.json` — extended (§4.3 `requires`)
- `D:\XD\ClaudeCode\sy-eeo\tools\validate.mjs` — extended (§2.3 R16–R22 + R_wf_* + exclusion + conform hook)
- `D:\XD\ClaudeCode\sy-eeo\tools\new-capability.mjs` — extended (writes `.opsforge-state.json` on scaffold/promote)
- `D:\XD\ClaudeCode\sy-eeo\templates\skill\tests\case-01.yaml` — current 3-field form, upgraded to 7-field per §4.7
- `D:\XD\ClaudeCode\sy-eeo\PROGRESS.md` — living status; §6.2 updates apply here

No open questions for the user. tdd-guide may proceed.
agentId: afd6bf6aabaceea44 (use SendMessage with to: 'afd6bf6aabaceea44', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 133116
tool_uses: 15
duration_ms: 513319</usage>