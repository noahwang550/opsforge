# Implementation Plan: OpsForge Phase 1+ (v6 MVP + v7 workflow + v8 eval + v9 platform/UX)

> Produced by ecc:planner. Authoritative source: PLAN.md (v9, §20/§21/§22) + PLAN-supplement-v7/v8/v9.md + DESIGN.md + PROGRESS.md + AGENTS.md. Phase 0 is COMPLETE and green (32/32 tests, `validate.mjs --all` exits 0). This plan covers everything that remains.

## Overview

Phase 0 (engineering baseline) is complete. What remains is the four runtime layers (adapter / installer / registry / runtime) plus the v7 circular-workflow engine, the v8 behavioral-eval layer, and the v9 platform-capability-points + non-technical-user UX layer. This plan merges all four version roadmaps into a single topological build order, split into independently-mergeable sub-phases (1.1, 1.2, …). Each sub-phase lists exact files, key interfaces, dependencies, the validation gate that must pass, and the tests that must accompany it.

Repo root for all paths: `D:\XD\ClaudeCode\sy-eeo\` (per PROGRESS.md D0 — no `opsforge/` subdirectory).

## Cross-cutting principles (apply to every phase)

- **TDD order within each sub-phase**: write failing `*.test.mjs` cases first, then implement, then green. Run `node --test` (built-in runner, §C.1).
- **Steering ownership**: every `.mjs`/`.sh`/`schema/`/`templates/`/`ci/`/`registry*.yaml`/`package.json` file is steering-owned, guarded by existing `CODEOWNERS` + `ci/guardrails.yml`. No new npm dependencies (reuse Node built-in `readline`/`fetch`/`node:test`; controlled deps stay `ajv`/`js-yaml`/`semver`).
- **`additionalProperties: false`** on every new schema. **Slug regex `^[a-z][a-z0-9-]{2,30}$`** doubles as path-traversal defense (PROGRESS.md lesson 2).
- **Business authors only touch `.md`/`.yaml`/`.json`** inside capability dirs. All new tools are steering.
- **Three-state gate semantics (v8 §21.8)**: draft = static R-subset only; staged = R1–R22 + functional `runSuite`; released = + eval harness + platform matrix + workflow dry-run. Each sub-phase below states which gate it satisfies.

---

## Phase 1 (MVP — merged v6 §15 Phase 1 + v7 §20.4 P1 + v8 §21.13 P1 + v9 §22.12 P1)

**Goal**: Single-platform (claude-code) + single-contributor end-to-end: scaffold → author → validate → test → release → install → use, with linear workflow, behavioral gate (R16–R22 + functional runSuite), minimal UX wizard, and platform-capability-points base.

### Phase 1.1 — Schema & template contract extensions (TDD-first)

Lock the extended contracts before any tool implements them.

Files to create/modify:

1. `schema\workflow.schema.json` (new) — JSON Schema draft-07, `additionalProperties:false`. Fields: `id`/`version`/`kind`(const workflow)/`pack`/`owner`/`customer?`/`display_name*`/`description`/`platforms`/`params_schema`/`steps`(array of step objects: `id`,`capability`|`kind:checkpoint`,`inputs`,`outputs`)/`control_flow?`(optional in P1; if present must be array of `sequence` only — `loop`/`switch`/`checkpoint` nodes rejected at schema level via `not` until Phase 2/3)/`vars?`/`kb_mount?`(bool, default false)/`tests`/`changelog`/`source`. Per §7.1, §20.1 (P1: control_flow optional, defaults to linear steps order).
2. `schema\bundle.schema.json` (new) — `additionalProperties:false`; fields per DESIGN §3.5 (`capabilities[]`,`workflows[]`).
3. `schema\test-case.schema.json` (new, v8 §21.2) — 7-field: `name`(kebab-case,required),`input`(any,required),`expect`(enum exact|schema|contains|regex|llm_judge|golden|human,required),`expected`?,`schema_ref`?,`judge_rubric`?,`judge_threshold`(default 0.7),`weight`(default 1.0),`platforms`?,`timeout_ms`(default 30000). `additionalProperties:false`.
4. `schema\pack.schema.json`, `schema\brand.schema.json`, `schema\upstream-ref.schema.json` (new, §17) — minimal, for Phase 3 intake/brand; ship the contracts now so `validate.mjs` can reference them.
5. `schema\platform.schema.json` (new, v9) — recommended: ship in 1.1 so `platform.yaml` is formally validated from day 1. Fields: `platform`,`display_name*`,`capability_points`(object keyed by 9 point ids, each `{supported:bool, mode?, endpoint_env?, auth_env?, fallback?}`),`locale`,`compliance_tags[]`,`verified_by?`,`model_registration?`. `additionalProperties:false`.
6. `schema\capability.schema.json` (extend) — add optional `requires` field (v9 §22.5, D2): array of `{point:string, severity:hard|soft, fallback?}`. Keep `additionalProperties:false`. Do **not** extend `platforms` enum beyond the 4 existing values in Phase 1.
7. Workflow validated by its own schema via `validate.mjs` dispatch.
8. **Templates update**: `templates\{agent,skill,mcp,workflow,bundle,brand-draft}\tests\case-01.yaml` / `case-02.yaml` / `case-03.yaml` — upgrade from 3-field to 7-field skeleton (v8 §21.2). Engineering fields `expect: exact`/`judge_threshold: 0.7`/`weight: 1.0` pre-filled; business fields `name`/`input`/`expected`/`judge_rubric` stay `__FILL_ME__`. **File names unchanged** → `skeleton_guard` (R8) unaffected.

Dependencies: None (contracts first).

Risk callouts:
- **`.opsforge-state.json` vs `skeleton_guard` conflict (CRITICAL)**: v9 §22.10 writes this file into capability dirs. R8 requires exact file-set match → flags it as "extra". **Resolution**: exclude `.opsforge-state.json` (and a configurable exclusion list of steering-overlay files) from the `skeleton_guard` comparison set in `validate.mjs`. Do not add to `templates/`.
- **Template content change breaks Phase 0 tests?** Phase 0 tests assert file sets + field validation, not 7-field case content. Re-run `node --test tools/validate.test.mjs tools/new-capability.test.mjs` after template edit; expect all 32 green. Fix the test fixture, not the template.

Test strategy: New `tools\schema-contracts.test.mjs` (or fold into `validate.test.mjs`) — assert each schema rejects unknown field, accepts valid skeleton, `requires` optional, `test-case.schema` rejects trivial at runtime not schema. Gate: `validate.mjs --all` still exit 0; `node --test` green.

### Phase 1.2 — Adapter layer (claude-code + base)

Implement the claude-code adapter and the v9 adapter base class with platform-capability-points.

Files:

1. `adapters\base.mjs` (new, v9 §22.3) — exports class `BaseAdapter`:
   - `loadPlatformYaml(platformDir)` — reads `adapters/<platform>/platform.yaml` via `js-yaml`.
   - `supports(point)` → `{supported, fallback?, meta?}`.
   - `tier()` → 1|2|3 computed per §22.3 (Tier1 = prompt_exec+agent_file+skill_file+slash_command+mcp_config+config_dir_writable all true; Tier3 = only prompt_exec; else Tier2).
   - Default no-op `conform`/`translate`/`install`/`injectMcp`/`uninstall`/`detect`.
2. `adapters\claude-code\platform.yaml` (new, v9 P1) — all 9 points `supported: true` (Tier 1), `locale: en-US`, `compliance_tags: []`, `verified_by: steering`.
3. `adapters\claude-code\mcp-config.template.json` (new, §4/§9.2) — skeleton for `~/.claude.json` `mcpServers` merge.
4. `adapters\claude-code\adapter.mjs` (new, §6.2) — extends `BaseAdapter`. Exports:
   - `platform = 'claude-code'`
   - `conform(cap)` — static check: frontmatter legal, `name`==pack.id suffix, `tools` in platform-supported set, `entrypoint` file exists, body has no unsupported syntax (§A.1). v9 §A.2 check: every `requires:hard` point has `supports(point).supported===true`.
   - `translate(cap, opts)` — produce `PlatformArtifact[]`: agent → `~/.claude/agents/<name>.md`; skill → `~/.claude/skills/<name>/SKILL.md`; mcp → config-merge artifact; workflow → `~/.claude/commands/workflow-<name>.md` (delegates to `workflow-compile.mjs`).
   - `install(artifacts, opts)` — idempotent write to `~/.claude/`, expand `~` to `USERPROFILE` on Windows (§8.4), atomic temp+rename.
   - `injectMcp(mcp, opts)` — idempotent merge into `~/.claude.json` `mcpServers`; env whitelist from `mcp.yaml.config_template.auth_schema` (§B.2); no secrets in manifest.
   - `uninstall(capId, opts)` — reverse by manifest.
   - `detect()` — check `~/.claude/` exists & writable.

Dependencies: 1.1.

Test strategy: `adapters\claude-code\adapter.test.mjs` — fixture capabilities (valid/invalid frontmatter, missing entrypoint, `requires:hard` on unsupported point), assert `conform` pass/fail, `translate` produces expected artifact paths, `install` is idempotent, `injectMcp` merges without clobbering. Use temp dirs (`fs.mkdtempSync`). Gate: §A.2 conformance.

### Phase 1.3 — Behavioral gate: validate.mjs R16–R22 + test-runner.mjs + R_wf_ref/closed

Implement the v8 behavioral layer (anti-vacuous guards + functional runSuite) and v7 workflow structural rules.

Files:

1. `tools\validate.mjs` (extend) — add rules per §21.7 + v7 §20.1:
   - **R16** `body_min_substance` — body token count ≥ N (agent≥150/skill≥100/mcp≥80 zh chars or equivalent en tokens).
   - **R17** `body_not_boilerplate` — reject pure echo / pure placeholder-fill / description-body ≥80% overlap.
   - **R18** `test_expect_nontrivial` — `expected` len>3, not in `{"ok","true","pass","success","yes","done","ok."}` blacklist; `llm_judge` requires `judge_rubric` ≥20 chars.
   - **R19** `test_cases_distinct` — no two cases with identical `(input,expect,expected)`.
   - **R20** `description_body_alignment` — at least one extracted noun from `description` appears in body.
   - **R21** `test_expect_declared` — staged cases must declare `expect` explicitly.
   - **R22** `no_self_cheat_in_body` — reject "return expected"/"pass the test by returning 'ok'" patterns.
   - **R_wf_ref** — workflow `steps[].capability` resolvable + `outputs` names align with `vars` declarations.
   - **R_wf_closed** — `control_flow` references only existing step-ids (Phase 1: control_flow optional; if present, only `sequence` nodes).
   - **`.opsforge-state.json` field validation** — if present, validate steering fields unmodified by author.
   - **skeleton_guard exclusion** of `.opsforge-state.json`.
   - All R16–R22 staged-only (draft exempt).
2. `tools\test-runner.mjs` (new) — v8 §21.3/§21.5. Exports:
   - `runCase(capDir, caseYaml, {runner, judgeModel, platform})` → `{actual, verdict, score?, reason?, runner}`.
   - `runSuite(capDir, opts)` → `{cases:[...], summary:{total,passed,failed,pending,score_mean,modes:{...}}}`.
   - P1 modes only: `exact` (string eq + structured deep-eq for JSON), `contains`, `human` (mark `pending`). `schema`/`regex`/`llm_judge`/`golden` stubbed to `runner: unsupported-in-phase1`.
   - Dry-run harness: `claude -p` for skill/agent; mcp via stdio server start (local only, else `human`); workflow via `--run-workflow --dry-run`. All I/O under `~/.opsforge/runs/<eval-id>/`; never touches `~/.claude/`.
   - `OPSFORGE_RUNNER=claude` default; `static-only` fallback when `claude` not on PATH.
3. `tools\validate.test.mjs` (extend) — add T29–T40 for R16–R22 + R_wf_ref + R_wf_closed + `.opsforge-state.json` exclusion + `requires:hard` conform fail.
4. `tools\test-runner.test.mjs` (new) — fixture cap dirs with passing/failing cases; assert `exact` deep-eq, `contains` missed list, `human` pending, dry-run harness writes to `~/.opsforge/runs/` only (use `OPSFORGE_RUNNER=static-only` in CI).

Dependencies: 1.1, 1.2. Gate: §A.4 `validation-report.json` with behavioral `regression_cases`; staged gate = R1–R22 + functional `runSuite` all pass.

### Phase 1.5 — Release/registry + minimal security-scan (BUILD BEFORE 1.4 final wiring)

Auto-aggregate registry; gate staged→released with validation + security reports (eval-report deferred to Phase 2).

Files:

1. `tools\release.mjs` (new, §13.2/§B.4) — exports `release(capDir)` / `aggregateAll()`. Scans `packs/<contributor>/` and `customers/<brand>/packs/<brand>/`, builds `registry.yaml` (general) + `registry-brands.yaml` (per-brand) with `current` + `history[]` + `changelog_index`. **Gate**: require `validation-report.json` verdict=pass AND `security-report.json` verdict=pass/block-with-exceptions before registering. P1 does **not** require `eval-report`. Bumps version per §C.6.
2. `registry.yaml` + `registry-brands.yaml` (new, auto-generated, initially minimal) — never hand-edit.
3. `tools\security-scan.mjs` (new, §B.1) — P1 **minimal subset**: hardcoded secrets (AKIA*, ghp_*, sk-, `-----BEGIN ... PRIVATE KEY-----`, connection strings), prompt-injection patterns ("忽略以上指令"/"以管理员身份"/"删除所有"/"覆盖系统提示"/"ignore previous instructions"), private-network SSRF (`169.254.169.254`, `127.0.0.0/8`, `10/8`, `192.168/16`, `*.internal`). These three are non-exceptionable. Full §B deferred to Phase 3. Output `security-report.json`.
4. `tools\release.test.mjs`, `tools\security-scan.test.mjs` (new) — fixtures: clean cap passes, `sk-...` key blocks, "ignore previous instructions" blocks, registry aggregation round-trips.

Dependencies: 1.3. **Build before 1.4 final wiring** (install reads registry).

Risk: ship minimal `security-scan.mjs` (3 non-exceptionable families) in Phase 1.5; full §B in Phase 3.3.

Gate: §B.4 release gate = validation-report pass + security-report pass (2 reports in P1; 3rd `eval-report` in Phase 2).

### Phase 1.4 — Workflow compiler (linear) + installer

Compile linear workflows to Claude Code slash-commands; install capabilities with single-layer transitive deps; per-run state persistence.

Files:

1. `tools\workflow-compile.mjs` (new, §7.2/§20.4 P1) — exports `compile(workflowYaml, platform)` → `PlatformArtifact` (a `commands/workflow-<name>.md` file). Phase 1: only `sequence` (linear steps in declared order); `control_flow` ignored if absent. Compiled body: instructions for the platform agent to execute each step's capability, write per-run `state.json` + `artifacts/<step>/<out>.json` under `~/.opsforge/runs/<workflow-id>/<run-id>/`. No `loop`/`switch`/`checkpoint`/`resume` (Phase 2/3). `kb_mount` recognized but not injected in P1.
2. `install.mjs` (new, §8) — Node cross-platform installer. Exports `install({platform, capId, version?, brand?, project?})`, `uninstall(...)`, `list(...)`, `doctor(...)`. Behavior: resolve registry → read capability source from `packs/<slug>/` or `customers/<brand>/` → `adapter.translate()` → idempotent `install()` → `injectMcp()` → write manifest `~/.opsforge/manifests/<project-slug>.manifest.json` (id,version,source_commit,platform,customer?,security_policy,owner_profile). **Single-layer transitive deps** (v7 §20.4 P1): when installing a workflow, pull its `steps[].capability` and install them too (`current` from registry). Path-traversal safe (validate every id segment against slug regex).
3. `install.sh` (new, §8, POSIX sh, sole `.sh` exception) — thin bootstrap that detects Node, then `node install.mjs "$@"`. Supports `--install <id>`/`--list`/`--uninstall`/`--doctor`/`--platform`/`--brand`/`--pack`/`--bundle`. Git Bash compatible. No bashisms.
4. `tools\workflow-compile.test.mjs`, `install.test.mjs` (new) — fixture workflows + temp `~/.opsforge/` and fake `~/.claude/`; assert compiled slash-command content, idempotent install, manifest correctness, transitive dep pull.

Dependencies: 1.2, 1.3, 1.5. **Build order: 1.1 → 1.2 → 1.3 → 1.5 → 1.4**.

Gate: §8 install/`--doctor` correctness; `--doctor` checks manifest↔file consistency, `depends_on` satisfied, MCP config complete, platform path writable, version-not-behind.

### Phase 1.6 — Example capabilities + workflow (dogfood)

Prove the gate end-to-end with real examples.

Files (scaffolded via `node tools/new-capability.mjs`, never hand-made):

1. `packs\marketing-team\agents\copywriter\` (1 agent)
2. `packs\marketing-team\skills\activity-summary\` (1 skill)
3. `packs\marketing-team\mcps\bi-connector\` (1 mcp, declarative)
4. `packs\marketing-team\workflows\campaign-retrospect\` (1 linear workflow, §7.1 shape)
5. `packs\marketing-team\pack.yaml` (pack metadata)

Each must: pass R1–R22, have ≥3 `tests/*.yaml` with non-trivial `expected`, pass functional `runSuite`, pass `security-scan`, then `release.mjs` registers them in `registry.yaml`. Each gets `.opsforge-state.json` written by scaffold.

Dependencies: 1.1–1.5. Gate: end-to-end `node tools/validate.mjs --all` exit 0; `node tools/test-runner.mjs` on each exits 0; `node tools/release.mjs --all` produces registry; `./install.sh --install marketing-team.copywriter@1.0.0` succeeds on a clean temp `~/.claude/`.

### Phase 1.7 — UX layer (v9 P1 minimal)

Wrap bare CLI for non-technical authors/installers.

Files:

1. `tools\opsforge.mjs` (new, v9 §22.8) — interactive wizard, reuses Node built-in `readline`. P1 commands: `opsforge new` (interactive scaffold → calls `new-capability.mjs`), `opsforge install` (single-capability interactive), `opsforge status [<path>]` (renders `.opsforge-state.json` → traffic-light progress draft→staged→released→registry), `opsforge doctor` (basic interactive).
2. `tools\report-renderer.mjs` (new, v9 §22.9) — pure function `render(reportJson, type, {lang})` → Chinese plain-text (P1: `validation-report` only; `security-report`/`eval-report`/manifest in Phase 2). Traffic-light (绿/黄/红) + one-line verdict + fix guidance. Internal rule IDs (R16 etc.) folded into "详细技术信息".
3. `tools\report-templates\` (new dir) — `*.md` templates with placeholders (P1: `validation-report.zh.md`).
4. `.opsforge-state.json` (runtime, written by `new-capability.mjs` into each cap dir) — `{state, history:[{ts, from, to, pr}]}`. Extend `tools/new-capability.mjs` `scaffold`/`promote` to write/append this file.
5. `tools\opsforge.test.mjs`, `tools\report-renderer.test.mjs` (new) — assert render output contains expected traffic-light markers, `opsforge new` flow calls scaffold with right args (mock readline).

Dependencies: 1.3, 1.4, 1.5. Gate: non-technical-user UX: `opsforge new` → fill body → `opsforge status` shows draft→staged progress with fix guidance.

### Phase 1.8 — CI workflows

Files:

1. `ci\github-actions\validate.yml` — runs `node tools/validate.mjs --all` on PR.
2. `ci\github-actions\test.yml` — runs `node --test tools/*.test.mjs` + `node tools/test-runner.mjs --all`.
3. `ci\github-actions\release.yml` — on merge to main, runs `release.mjs`, tags.
4. Extend `ci\guardrails.yml` — add new tool files/`adapters/` to path-guard (make explicit).
5. Install Node 22 via `.nvmrc` in each workflow.

Dependencies: all of 1.1–1.7. Gate: CI green on PR.

**Phase 1 exit criteria**: `opsforge new` → author → `opsforge status` → `release.mjs` → `opsforge install` → use in Claude Code, all gates green. Three reports: validation + security (eval deferred to P2).

---

## Phase 2 (multi-platform + v7 profile + v8 eval + v9 degradation matrix)

> 设计来源（UX 细节、顶层菜单、intake 闸门、OpsForge-as-capability 载体、`commercial` 标签语义）：`UX-PLAN-V2.md`（与 docs/design-archive/supplement-v9.md §22.8 对齐）。本节文件级实现顺序以下子阶段为准。

**Goal**: Cross-platform adapters, full eval harness with LLM judge, composable profile installation, general degradation matrix, complete UX.

### Phase 2.1 — Multi-platform adapters + platform-capability-points matrix
Files: `adapters\cursor\{adapter.mjs,platform.yaml,mcp-config.template.json}`, `adapters\codex\...`, `adapters\cline\...`. Each extends `BaseAdapter`, declares its 9 points in `platform.yaml`. `conform()`/`translate()`/`install()` per §6.1. CI matrix runs `conform()` + install/uninstall on all 4. `--platform` flag + `detect()` auto-discovery. Windows Git Bash CI runner. Tests: `adapter.test.mjs` per platform. Gate: §14 platform matrix.

### Phase 2.2 — v8 eval harness (llm_judge/golden/schema/regex + eval.mjs)
Files: `tools\eval.mjs` (5-axis rubric: accuracy/completeness/actionability/safety/robustness, weights in `tools\eval.config.yaml`), `tools\judge-prompt.md` (steering-owned, Q3 blind-judge), extend `tools\test-runner.mjs` with `llm_judge`/`golden`/`schema`/`regex` modes (golden = zero-dep Levenshtein ratio, Q1), `eval-report.json` (3rd CI artifact). `release.mjs` now requires all 3 reports pass (§21.6). `eval.config.yaml` supports `OPSFORGE_JUDGE_MODEL` override. Tests: `eval.test.mjs`. Gate: §21.8 released gate = eval-report verdict=pass + platform matrix eval.

### Phase 2.3 — v7 profile + lock + resolve-profile
Files: `schema\profile.schema.json`, `templates\profile\{profile.yaml,README.md,CHANGELOG.md}`, extend `tools\new-capability.mjs` with `--kind profile` (writes to cwd, not OpsForge repo), `tools\resolve-profile.mjs` (minimal: expand bundles → workflows steps → depends_on topo → semver pin), `install.sh`/`install.mjs` flags `--profile`/`--profile-save`/`--profile-lock`/`--fresh`/`--doctor --profile`. `profile.lock.json` pin version+commit. Per-project manifest `~/.opsforge/manifests/<project>.manifest.json`. Tests: `resolve-profile.test.mjs`. Gate: §14 profile schema + lock↔manifest consistency.

### Phase 2.4 — v7 workflow: switch + multi-platform slash-command + --run-workflow CLI + KB MCP
Files: extend `tools\workflow-compile.mjs` (`switch`/`if` runtime eval), `install.sh`/`install.mjs` `--run-workflow`/`--list-runs`/`--abort`, `opsforge-kb` declarative MCP injection when `kb_mount:true` (KB path `~/.opsforge/kb/<pack>/`, brand-scoped to `customers/<brand>/`). Per-run `state.json` resume from `current_node`. Tests: `workflow-compile.test.mjs` switch cases, `--resume` round-trip. Gate: §7.2 multi-platform surfacing.

### Phase 2.5 — v9 general degradation matrix + domestic platform examples + UX (engineering backend COMPLETE; UX shell subsequently delivered by Phase 3.6)

> **2026-07-24 审计订正 + Phase 3.6 收尾：** 原声明 COMPLETE 与实际不符。工程后端已交付；UX shell（顶层菜单/wizard 端到端/discover 质量灯/feedback/no-cwd/载体 B/平台内安装入口）原 deferred to Phase 3.6，**现已由 Phase 3.6 全部交付**（见下方 Phase 3.6 块）。本节保留作为审计订正的历史记录。

**已交付（engineering backend COMPLETE）：**
- 通用降级矩阵：每个 `adapter.mjs` `translate()` 按 §22.4 矩阵（`cli-engine`/`http-inject`/`manual-paste`/`http-direct`/`fail-loud`）基于 `supports()` 选降级策略；5 adapters 全部落地。
- Tier 2/3 国内平台示例：`adapters/codex`/`cline`/`dify`（含 `data-residency-cn`）。
- `opsforge install --repair`（manual-paste 写 `paste/<project>/<slug>.md` — F4 fix；载体 D paste 文件落地：`adapters/cline|codex|dify` 非空 `pasteInstructions` → `install.mjs:182-196`；Tier 1 null 正确）。
- `opsforge report <artifact>` 渲染全部 3 报告（`report-renderer.mjs` validation + security + eval — F3 fix）+ `tools/report-templates/`。
- `OPSFORGE_RUNNER=<platform>` HTTP API runner path in `test-runner.mjs`（Tier-2/3 dry-run/eval — F2 fix）。
- `release.mjs` 成功后写 `.opsforge-state.json` `state:"released"`、`aggregateAll` 成功后写 `state:"registry"`。
- `opsforge doctor --project <name>` 转发 `--project` 给 `install.mjs doctor()`（F1 fix）。

**原未交付（deferred to Phase 3.6 — 现已由 Phase 3.6 全部交付，见下方 Phase 3.6 块）：**
- 顶层菜单（6 选项，首交互）— Phase 3.6 已落地 `opsforge menu`。
- `opsforge wizard` 端到端 — Phase 3.6 已串接 5 步。
- `opsforge discover` 质量红绿灯 — Phase 3.6 已改读 per-project manifest。
- `opsforge feedback` UX 入口 — Phase 3.6 已落地 `cmdFeedbackInteractive` 写 jsonl。
- 无 cwd 状态解析 — Phase 3.6 已落地 `opsforge-runtime.mjs` `resolveWorkDir()` 三级回退。
- 载体 B（`packs/opsforge-meta/`）— Phase 3.6 已落地 3 个 dogfood 能力。
- 平台内安装入口 — Phase 3.6 已落地 `opsforge-bootstrap.mjs` + `detectPlatform()`。
- `[黄 不可商用]` 商用标签 discover 渲染 — Phase 3.6 已落地。

**审计 5 项偏差（原 Phase 2.5 声明 vs 实际）：**
1. 顶层菜单：声明"6 选项首交互"vs 实际裸子命令分发。
2. wizard 端到端：声明"end-to-end"vs 实际仅 scaffold→status。
3. discover 质量灯：声明"列已装能力 + 质量红绿灯"vs 实际读 registry.yaml 列能力列表（无质量灯、无商用标签）。
4. 载体 B：声明"`packs/opsforge-meta/` meta-skill/agent 包"vs 实际该目录不存在。
5. 无 cwd bootstrap：声明"`OPSFORGE_WORKDIR`/`opsforge-workdir/`"vs 实际 wizard 全用 `process.cwd()`。

Tests (delivered): degradation matrix unit tests per kind×missing-point; `--project` 转发; `.opsforge-state.json` state 写入; paste-file 写入 (F4); 3-report 渲染 (F3); HTTP runner (F2). Gate: §22.4 degradation strategy compliance（工程后端部分）。**UX shell gate deferred to Phase 3.6。**

Files (delivered): `adapters/*/adapter.mjs` translate() degradation; `install.mjs` `--repair`/`--downgrade`/`--project`/paste-file; `tools/report-renderer.mjs` + `tools/report-templates/`; `tools/test-runner.mjs` HTTP runner; `tools/release.mjs` state write; `tools/opsforge.mjs` bare subcommand dispatch. **未交付 files 见 Phase 3.6。**

### Phase 2.6 — 第三方 intake 最小闸门（安全 hard-block + 商用 warn-confirm-tag）
> 设计来源：`UX-PLAN-V2.md` §5（流程总览 / fetch / 选拷贝范围 / 安全闸门 / 商用闸门 / scaffold / phasing）+ §7（schema 字段）+ §10（已决断）。

Files (all steering-owned, ESM `.mjs`, no new npm deps):
1. `tools\intake-fetch.mjs` (new) — safe fetch for third-party intake. 复用 `tools/security-scan.mjs:31-37` 的 `SSRF_PATTERNS`（169.254.169.254 / 127/8 / 10/8 / 192.168/16 / *.internal）拒私网；仅 `https://`（拒 `http://`/`file://`/`ftp://`）；Node 内置 `fetch`（无新依赖）；git 仓库走 `node:child_process` 调系统 `git clone --depth 1` 到 `~/.opsforge/intake-cache/<hash>/`，限大小（默认 50MB，`OPSFORGE_INTAKE_MAX_BYTES` 可调）；marketplace 链接先 fetch 元数据 API 拿真实仓库 URL。
2. `tools\intake-license.mjs` (new) — LICENSE 商用可用性判定。**串匹配为主**：按 §12.2 白名单（MIT/Apache-2.0/ISC/BSD-2/3-Clause 优先可商用；MPL-2.0 条件收录；GPL/AGPL/LGPL/CC-BY-NC/CC-BY-SA/无 LICENSE 拒绝）。**LLM 辅助**：仅在"无 LICENSE / 多 LICENSE / 无法识别"时走 Node 内置 `fetch` 调国内模型 endpoint（复用 §22.6 D4 `judge_model.provider: domestic-http`），给**建议但不自动决定**，最终由用户显式确认（见 UX-PLAN-V2.md §5.5）。
3. 复用 `tools/security-scan.mjs scan()`（`tools/security-scan.mjs:57-114`）跑现有 3 不可豁免族——**intake 路径上整闸门不可豁免**：所有命中族（含未来扩展族）全 block，无 confirm-anyway（见 UX-PLAN-V2.md §5.4 + §10.5）。
4. `schema\capability.schema.json` 扩展：新增可选字段 `commercial`（boolean，默认 true）、`commercial_reason`（string）。保持 `additionalProperties:false`。
5. `schema\upstream-ref.schema.json` 扩展：新增可选字段 `commercial`（boolean）、`commercial_reason`（string）、`intake_scope`（string，拷贝范围 "all" 或子路径）。
6. `tools\new-capability.mjs` 扩展 intake 路径：**修复 Phase-1 intake→staged 断链**——intake 改写到 `packs\_drafts\third-party\<name>\`（在 `_drafts/` 下新增 `third-party/` 子命名空间），使现有 `--promote` 直接迁移 `_drafts/third-party/<name>/` → `_staged/third-party/<name>/`（路径替换 `/_drafts/` → `/_staged/` 自然成立，`tools/new-capability.mjs:196`）。`packs\_third-party\` 保留为 §12 收录区（正式 released 形态）。intake scaffold 同时写 `upstream.ref.yaml`、`LICENSE.upstream`、`wrapping.yaml`、`source.origin: forked` + `source.upstream_ref`、`.opsforge-state.json` `state:"draft"`、capability manifest 的 `commercial`/`commercial_reason`。
7. `tools\release.mjs` 扩展：透传 `commercial`/`commercial_reason` 从 capability manifest 到 registry entry；release gate（§B.4）额外校验 intake 能力的 `upstream.ref.yaml` schema + LICENSE 兼容性记录 + 商用标签一致性。
8. `install.mjs` 扩展：从 registry 读 `commercial`/`commercial_reason` 写入 per-project manifest `capabilities[]`。
9. `tools\opsforge.mjs` 扩展：分支 3（拷贝第三方）串接 ①提交链接→②选拷贝范围→③安全闸门→④商用闸门→⑤intake scaffold→⑥质量反馈循环（见 UX-PLAN-V2.md §5）。

Tests: `tools\intake-fetch.test.mjs`（SSRF 拒、https-only、git clone 深度 1、size cap）、`tools\intake-license.test.mjs`（§12.2 白名单串匹配各分支 + LLM 辅助仅在不明时触发且不自动决定）、intake→`_drafts\third-party\` 后 `--promote` 可迁移、`commercial` 字段穿透 capability→upstream-ref→registry→install manifest、`commercial:false` 在 discover 显示 `[黄 不可商用]` 不降质量灯.

Gate: §12.2 LICENSE 白名单 + §B.3 三不可豁免族（intake 整闸门 block）+ §A schema 字段 + §5.6 目录修复（`_drafts\third-party\` → `--promote` 可用）. **不含** Phase 3.4 扩展安全族 / `wrapping.yaml` 强校验 / `tools\upstream-bump.mjs` / brand 区 fork 路径 / CI intake 专闸.

### Phase 2.7 — CI for Phase 2
`ci\github-actions\re-eval.yml` stub (active in Phase 3). Extend `validate.yml` matrix to all platforms. Extend `ci\guardrails.yml` path-guard to cover `tools\intake-fetch.mjs`/`tools\intake-license.mjs`.

---

## Phase 3 (v7 loop/checkpoint + v8 feedback loop + v9 compliance + intake/brand)

### Phase 3.1 — v7 loop + checkpoint + resume + full resolver
Files: extend `workflow-compile.mjs` (`loop` until/while, `max_iterations`, `on_max`, `checkpoint` HITL), `--resume`/`--list-runs`/`--abort` full, `vars` cross-iteration accumulation; full `resolve-profile.mjs` (range intersection, conflict fail-loud, brand-closure check, cycle detection, `--upgrade --profile`, multi-profile manifest isolation); `packs\growth-team\workflows\membership-consulting\workflow.yaml` full example. Gate: §20.4 P3.

### Phase 3.2 — v8 feedback closed-loop
Files: `opsforge-feedback` declarative MCP (auto-injected by installer on every released cap), writes `~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl`; extend `--doctor` effectiveness scan (last N=20, <70% → `effectiveness: degraded` flag in manifest, Q9); `ci\github-actions\re-eval.yml` weekly cron (Q10) scanning registry `current`, comparing `~/.opsforge/eval-history/<id>/<version>.json`; R22 strengthened (semantic-level self-cheat). Gate: §21.10.

### Phase 3.3 — v9 compliance + domestic model + downgrade
Files: `http-direct` mcp degradation form; `data-residency-cn` scan in `security-scan.mjs` (warn-not-block, D5); `eval.config.yaml` `judge_model.provider: domestic-http` (Node built-in fetch, D4); `install --downgrade` (read manifest history); `opsforge feedback` interactive; degradation-product behavior-deviation CI check; `--doctor` platform Tier report + capability-point truth sampling (D3 `verified_by`). Gate: §22.12 P3.

### Phase 3.4 — Third-party intake + brand isolation full
Files: complete `packs\_third-party\` intake flow (`upstream.ref.yaml`/`LICENSE.upstream`/`wrapping.yaml` validation, LICENSE whitelist §12.2), `tools\upstream-bump.mjs`; brand `customers\<brand>\` dirs + `brand.yaml` + `registry-brands.yaml` full + CI brand-isolation guards (§14); three-state graded CI (§A/§B/§C full); `docs\brand-guide.md`/`intake-guide.md`. Gate: §12 + §14 brand isolation.

### Phase 3.5 — D5/D6 brand-variant skeletons resolution
Recommended default: keep runtime-inject (D5 as designed), confirm Phase 0 scope (D6 deferred-to-Phase-3 now delivered).

### Phase 3.6 — v9 UX shell closure (Phase 2.5 deferred 集中于此) — **SHIPPED**

> **状态：SHIPPED 2026-07-24.** Phase 2.5 UX shell deferred 项（顶层菜单/wizard 端到端/discover 质量灯/feedback/no-cwd/载体 B/平台内安装入口）已全部闭合，先于 Phase 4 治理飞轮。bare `node --test` = 341/0（基线 305→+36）；6 gates 全绿（validate 7 caps / security-scan 0 findings / eval pending / release 7 caps / doctor healthy）。零新依赖。architect 已把归属从 Phase 4 改为 Phase 3.6，本轮按此交付。

**9 落点：**
1. 顶层菜单（6 选项首交互，见 UX-PLAN-V2.md §2.2）替换 `opsforge.mjs:16-40` 裸 `switch(cmd)` 分发。
2. `opsforge wizard` 端到端（scaffold→填业务字段→validate→test-runner runSuite→report→install 5 步引导 + 流转可视化），替换 `cmdWizard`（`opsforge.mjs:53-73`）的仅 scaffold→status。
3. `opsforge discover` 质量红绿灯：改读 per-project manifest（`~/.opsforge/manifests/<project>.manifest.json`）+ feedback jsonl + eval-history 综合渲染 + `[黄 不可商用]` 商用标签（不降质量灯），替换 `cmdDiscover`（`opsforge.mjs:76-100`）读 `registry.yaml`。
4. `opsforge feedback` UX 入口（交互式问 1-5 分 + 文字，写 `~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl`，复用 Phase 3.2 `opsforge-feedback` MCP）。
5. 无 cwd 状态解析：`OPSFORGE_WORKDIR` env → `resolveOpsforgeHome()/opsforge-workdir/`（首次启动写 `.opsforge-bootstrap.json` 记录来源平台/首次启动时间/载体类型）→ 载体 A 兜底 `process.cwd()`（须校验是 OpsForge 仓库，否则 fail-loud 中文提示）。
6. 载体 B（meta-skill/agent 包）：`packs/opsforge-meta/skills/opsforge-wizard/` + `packs/opsforge-meta/agents/opsforge/`，自身是普通 OpsForge 能力，经同一 install 流程装入目标平台 `~/.claude/skills|agents/`，`@opsforge`/`@opsforge-wizard` 启动。
7. 菜单引导（载体 D 的 manual-paste 说明书附带菜单引导文本，与载体 B 同期）。
8. 平台内安装入口（在目标平台内 `@opsforge` 即可启动向导，无需仓库 cwd）。
9. 实时质量反馈 wizard 串接（向导分支 1 ⑧ 每次回车触发 `validate.mjs`+`test-runner.mjs runSuite` → `report-renderer.mjs` 中文红绿灯）。

**平台可行性矩阵（opsforge wizard 自举载体 D）：** claude-code ✅ / cursor ✅ / cline ✅（`pasteInstructions` 非空）/ codex ⚠（缺 slash_command/workflow_orchestration，菜单交互降级）/ dify ❌ 退 D（仅 prompt_exec，退化为 manual-paste 说明书）。

**自举不可消除：** 载体 B/C/D 自身经 OpsForge install 流程装入目标平台——用 Tier 1 仓库内的 `node tools/opsforge.mjs install` 把 meta-capability 装入目标平台；此后在目标平台内 `@opsforge` 即可启动向导。Tier 1（claude-code/cursor）的 `pasteInstructions` 为 null 是**正确设计**（有 agent_file/skill_file 不需要 paste 说明书），勿改坏。

**U1 已接受：** 无 cwd bootstrap 的"无 `opsforge init`、无'当前 project'概念"决策（UX-PLAN-V2.md §3.1/§8 gap 表"opsforge init/load project → 不做"）已接受，Phase 3.6 维持此决策。

**Gate:** §22.8 wizard 顶层菜单 + §22.10 discover 质量灯 + §22.4 degradation strategy compliance（UX shell 部分）— **all GREEN**. Tests (delivered, 36 new): `tools/opsforge-bootstrap.test.mjs` BT1–BT7 (BT7 = CRITICAL 回归：非仓库 cwd + 动态 import 副本 + `runInstall` 制品落盘，补 e2e BT6 仅 `fs.existsSync` 漏检), `tools/opsforge-runtime.test.mjs` RT1–RT7 (`resolveWorkDir` 三级回退 + `runInstall`/`runList`/`runDoctor` 委托), `tools/install-registry.test.mjs` RF1–RF4 (`readRegistryForInstall` repo-fresh-prefers-home-fallback). 顶层菜单分支可达性; wizard 5 步端到端; discover 读 manifest + 质量灯; feedback 写 jsonl; 无 cwd bootstrap 解析; 载体 B install 后 `@opsforge` 可启动 — 全部覆盖.

Files (delivered, all steering-owned, ESM `.mjs`, no new npm deps): `tools/opsforge-bootstrap.mjs` (自举入口：install opsforge-meta caps + 复制薄 runtime wrapper 到 `~/.opsforge/runtime/tools/` 保布局 + 平铺 `registry*.yaml` 到 `~/.opsforge/` + 写 `~/.opsforge/.runtime-root.json`), `tools/opsforge-runtime.mjs` (零 bare-dep 薄 wrapper：`resolveWorkDir()` 三级回退 + `runInstall`/`runList`/`runDoctor` 委托仓库根 `install.mjs` 经 `pathToFileURL` 动态 import), `packs/opsforge-meta/` (载体 B meta-pack: `pack.yaml` + `skills/opsforge-wizard/` + `agents/opsforge/` + `agents/opsforge-installer/` — 3 个 dogfood 能力); extended `tools/opsforge.mjs` (顶层菜单 `opsforge menu` + `cmdWizard` 端到端 + `cmdDiscover` 读 manifest + `cmdFeedback`/`cmdFeedbackInteractive` + `detectPlatform()`), `install.mjs` (`readRegistryForInstall` 增 home 回退), `CODEOWNERS` + `ci/guardrails.yml` (扩展覆盖 `packs/opsforge-meta/` + 新 tools).

**关键设计取舍（架构不变量）：** runtime 副本不复制整棵依赖闭包，而是薄 wrapper（零 bare-dep）+ `~/.opsforge/.runtime-root.json` 记仓库根，运行时 `pathToFileURL` 动态 import 仓库根 `install.mjs`（`ajv`/`js-yaml`/`semver` 在仓库 `node_modules` 解析）→ **`~/.opsforge/` 非完全自包含，仓库必须在机器上持续存在**才能 in-platform 安装/列能力/doctor。dogfood/开发场景够用；"装到无仓库机器"需打包 `node_modules` 发行版（后续 Phase）。

**遗留（非本轮范围）：** 载体 C（opsforge MCP server）留 Phase 3.1（按 UX-PLAN §10 已采纳决策 #3）；`cmdDiscover` feedback jsonl + eval-history 深度聚合留 Phase 3.2 渐进增强（本轮骨架已落地）；无仓库机器发行版打包留后续 Phase.

---

## Phase 4 (governance flywheel — continuous)

- Remote `index.json` registry; degraded auto re-eval issues; judge model version governance; effectiveness SLA monitoring; eval-history trend dashboard; 3+ domestic platforms; degradation A/B testing; multi-language reports (`--lang en`); `detect()` auto-probing; draft-collection agent; 10+ community third-party capabilities; 3+ brand dirs.

---

## Risk / ambiguity callouts (with recommended defaults)

1. **`.opsforge-state.json` vs `skeleton_guard` (R8) — CRITICAL, resolve in 1.3**. Exclude `.opsforge-state.json` (and a configurable exclusion list of steering-overlay files) from `skeleton_guard`'s file-set comparison. Do not add to `templates/`. Document the exclusion in `validate.mjs`.
2. **v6 §15 vs v8/v9 phase-mapping tension**. Ship minimal `security-scan.mjs` (3 non-exceptionable families) in Phase 1.5; full §B in Phase 3.3.
3. **`platform.schema.json` phase placement**. Include in Phase 1.1 (cheap, enables validation from day 1).
4. **Node v22 vs v24**. CI installs Node 22 via `.nvmrc` (keep spec pin, don't relax `engines`).
5. **D5 (brand-variant skeletons) — pending steering**. Confirm current runtime-inject design.
6. **D6 (third-party intake Phase 0 scope) — pending steering**. Confirm Phase 0 scope; deliver full LICENSE/wrapping validation in Phase 3.4.
7. **`judge-prompt.md`/llm_judge in Phase 1?** P1 `test-runner.mjs` supports only `exact`/`contains`/`human`; stub other modes to `unsupported-in-phase1`. Phase 2.2 adds them.
8. **`--run-workflow` in Phase 1?** Phase 1 `test-runner.mjs` workflow dry-run is stubbed to `runner: static-only`; Phase 2.4 wires real `--run-workflow --dry-run`.
9. **Template content change (3→7 field cases) and existing Phase 0 tests**. Re-run full Phase 0 suite after 1.1; fix fixtures if any break. `skeleton_guard` compares file names, not content, so unaffected.
10. **`release.mjs` requiring `eval-report` in P1?** No — P1 requires only validation + security (2 reports). Phase 2.2 adds eval-report as 3rd.
11. **`requires` field and `conform()` interaction**. Implement in `conform()` in Phase 1.2.
12. **Registry seeding for `install.mjs` tests**. Build 1.5 (release.mjs + registry) before final 1.4 wiring; use hand-seeded registry fixtures for 1.4 unit tests.

## Test strategy summary (per v8 three-state upgrade)

- **Phase 1**: draft = static R-subset (R2/R3/R5/R7/R10/R11/R15, unchanged from Phase 0); staged = R1–R15 + R16–R22 + functional `runSuite` (exact/contains/human only); released = + `security-scan` (minimal) + platform matrix (claude-code only) — `eval.mjs` deferred. `validation-report.json` has behavioral `regression_cases`.
- **Phase 2**: released gate adds `eval-report.json` (5-axis rubric, llm_judge/golden/schema/regex); `release.mjs` requires all 3 reports; platform matrix across 4 platforms.
- **Phase 3**: released gate adds workflow `--run-workflow --dry-run` eval (loop/checkpoint); feedback MCP + `--doctor` effectiveness + weekly re-eval cron; `data-residency-cn` scan; full §B security.

## Success criteria (Phase 1 exit)

- [ ] `node tools/validate.mjs --all` exits 0 on a repo with 3 example capabilities + 1 workflow.
- [ ] `node --test tools/*.test.mjs` all green (Phase 0 suite still green + new cases).
- [ ] `node tools/test-runner.mjs <each example>` exits 0 (functional runSuite, exact/contains modes).
- [ ] `node tools/release.mjs --all` produces `registry.yaml` with the 4 examples registered.
- [ ] `./install.sh --platform claude-code --install marketing-team.copywriter@1.0.0` succeeds on a clean temp `~/.claude/` + writes `~/.opsforge/manifests/<project>.manifest.json`.
- [ ] `./install.sh --doctor` reports all-installed-healthy.
- [ ] `opsforge new` → author body → `opsforge status` shows traffic-light progress with fix guidance.
- [ ] `opsforge report <validation-report.json>` prints Chinese plain-text with 绿/黄/红 markers.
- [ ] `adapters\claude-code\platform.yaml` parses and `BaseAdapter.tier()` returns 1.
- [ ] No new npm dependencies added (`package.json` diff = 0 new deps).
