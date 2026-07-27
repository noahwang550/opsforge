# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 工程纪律的权威清单见 AGENTS.md；本文件为 Claude Code 专属补充，不重复 AGENTS.md 内容。

## Current state

**Phase 1 + Phase 2 + Phase 3 + Phase 3.6 are SHIPPED; Phase 4 (governance flywheel) is next.** Phase 1 delivered single-platform (claude-code) + single-contributor end-to-end; Phase 2 added multi-platform adapters + v8 eval harness + v7 profile/lock + full workflow control-flow + v9 degradation matrix + intake orchestrator; Phase 3 closed the feedback loop + full §B security + full intake + D5/D6 safe defaults; **Phase 3.6 closed the v9 UX shell** (Phase 2.5 UX debt resolved — top-level menu / wizard end-to-end / discover reads manifest / feedback jsonl / `detectPlatform()` / no-cwd bootstrap / carrier B meta-pack / runtime copy dynamically imports repo-root `install.mjs`). The 5-agent pipeline (architect → tdd-guide → e2e-runner → code-reviewer → fix-pass) closed a 10-issue fix-spec (N1/N2/N3/N4a/N4b + F1/F2/F3/F4/F5); Phase 3.6 was then delivered by tdd-guide + e2e-runner + code-reviewer + code-simplifier. **Steering 2026-07-24 confirmed all 4 open decisions**: Tier2-min tightened in `base.mjs tier()` to §22.3 "≥2 of the other 5" (test `A1c`); D5 (runtime brand-inject) + D6 (full intake) confirmed as designed; `pickVersion` deferred to Phase 4. Bare `node --test` = **341/0**; 6 gates exit 0; `install --doctor` healthy.

- **Adapter layer** — `adapters/base.mjs` (`BaseAdapter` with `supports`/`tier`/`loadPlatformYaml`) + **5 platform children**: `adapters/claude-code/` (Tier 1, all 9 points) and `adapters/cursor/` (Tier 1), `adapters/codex/` + `adapters/cline/` (Tier 2, `manual-paste`/`http-inject` fallbacks), `adapters/dify/` (Tier 3 domestic, `data-residency-cn`, `http-direct`/`fail-loud`). v9 9-points × 5-strategy degradation matrix (`cli-engine`/`http-inject`/`manual-paste`/`http-direct`/`fail-loud`) fully populated.
- **Installer layer** — `install.sh` (POSIX sh bootstrap) + `install.mjs` (Node, cross-platform). Exports `install`/`uninstall`/`list`/`doctor`/`main`; per-project manifest at `~/.opsforge/manifests/<project-slug>.manifest.json`; `OPSFORGE_HOME` override; idempotent atomic writes; path-traversal guard. **Phase 2.3**: `--profile`/`--profile-save`/`--profile-lock`/`--fresh` (last-write-wins multi-profile, resolved by `tools/resolve-profile.mjs` → `profile.lock.json`). **Phase 2.5/3.3**: `--repair` (manual-paste writes `paste/<project>/<slug>.md`), `--downgrade` (drop a cap to the highest Tier its current platform supports). `--uninstall --project <slug>` now forwards and cleans the right manifest.
- **Registry layer** — `tools/release.mjs` (`release`/`aggregateAll`/`main`) auto-aggregates `registry.yaml` + `registry-brands.yaml`; §B.4 release gate now fires with **3 reports** per cap (validation + security + eval must all be `pass`/`pending`; `aggregateAll` calls `release()` per cap).
- **v8 behavioral gate** — `tools/validate.mjs` extended with R16–R22 + R_wf_ref/R_wf_closed + `checkOpsforgeState` + `.opsforge-state.json` exclusion + `requires:hard` conform hook. `tools/test-runner.mjs` ships **all 7 expect modes** (`exact`/`contains`/`human`/`schema`/`regex`/`llm_judge`/`golden`); `static-only` runner detection for greenfield CI seeding.
- **v8 eval harness** — `tools/eval.mjs` (5-axis rubric: accuracy/completeness/actionability/safety/robustness) → `eval-report.json` per cap; `tools/judge-prompt.md` system prompt (untrusted-data delimiters + anti-injection clause + rationale truncation — N4b fix); `tools/eval.config.yaml` (model endpoint via Node built-in fetch, no new dep; domestic model endpoint supported). `tools/test-runner.mjs` also gained an HTTP-API runner (`OPSFORGE_RUNNER=<platform>`) for Tier-2/3 dry-run/eval.
- **Full §B security-scan** — `tools/security-scan.mjs` ships **all §B families**: hardcoded secrets / prompt-injection / private-network SSRF (with `dns.lookup` private-range rejection — N3 fix, catches hex/decimal/octal/v4-mapped-v6/.local/.corp + DNS rebinding) / over-privileged tools / supply-chain unpinned / MCP tool-surface / dependency-closure advisories / data-residency-cn (warn-not-block).
- **v9 UX layer** — `tools/opsforge.mjs` ships the **full v9 command surface**: top-level menu (`opsforge menu` — 6-option first interaction replacing the bare `switch(cmd)` dispatch), `cmdWizard` end-to-end (scaffold→fill→validate→test→report→install), `cmdDiscover` reads the per-project manifest + feedback jsonl + eval-history (no longer `registry.yaml`), `cmdFeedback`/`cmdFeedbackInteractive` (1-5 score + text → `~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl`), `detectPlatform()` (auto-detect target platform, no hard-coded `claude-code`). Landed: `tools/report-renderer.mjs` renders **all 3 reports** (`validation-report.json` + `security-report.json` + `eval-report.json`) into Chinese traffic-light 绿/黄/红 + fix guidance (security-report rendering — F3 fix) + `tools/report-templates/`; `.opsforge-state.json` flow state; carrier D `.paste` file (`adapters/cline|codex|dify` non-null `pasteInstructions` → `install.mjs:182-196`; Tier 1 null by design); `--repair`/`--downgrade`/`--project` flags. **Phase 3.6 self-bootstrap (carrier B)**: `tools/opsforge-bootstrap.mjs` (installs `opsforge-meta.*` caps into the platform config dir + copies the thin runtime wrapper to `~/.opsforge/runtime/tools/` + flattens `registry*.yaml` to `~/.opsforge/` + writes `~/.opsforge/.runtime-root.json`), `tools/opsforge-runtime.mjs` (零 bare-dep thin wrapper: `resolveWorkDir()` 3-level fallback env>cwd-repo>home/workdir>home-first-bootstrap + delegates `install()`/`list()`/`doctor()` to the repo-root `install.mjs` via `pathToFileURL` dynamic import driven by `.runtime-root.json`). **Architecture invariant:** the `~/.opsforge/` runtime copy is NOT fully self-contained — it dynamically imports `install.mjs` from the repo root (so `ajv`/`js-yaml`/`semver` resolve from the repo `node_modules`) → **the OpsForge repo must remain present on the machine** for in-platform install/list/doctor. Sufficient for dogfood/development; "install onto a repo-less machine" needs a bundled `node_modules` release (later Phase). `tools/workflow-compile.mjs` compiles `sequence` + `switch`/`if`/`loop`/`until`/`while`/`checkpoint` to slash-commands (loop has `max_iterations` + `on_max=abort|halt`; checkpoint renders HITL pause). `tools/workflow-runner.mjs` is a real state machine: `--run-workflow`/`--list-runs`/`--abort`/`--resume`, per-run `<run-id>/state.json` (F5 fix: full state machine replaces the compiler-lie). `tools/paths.mjs` is the shared helpers module.
- **Intake orchestrator** — `tools/intake.mjs` ties `tools/intake-fetch.mjs` (git-clone via **`execFileSync` argv form + shell-metachar rejection** — N2 RCE fix) + `tools/intake-license.mjs` (LICENSE detection + LLM-assist with untrusted-data delimiters — N4a fix) + `new-capability.mjs --third-party`; intake lands in `_drafts/third-party/`. `schema/upstream-ref.schema.json` extended with `commercial`/`commercial_reason`/`intake_scope` (additionalProperties:false preserved). Phase 3.4 full intake adds wrapping validation + brand-fork paths + CI intake gate; brand isolation hardening enforced by CI (path↔customer↔pack↔depends_on consistency).
- **4 dogfood capabilities** in `packs/marketing-team/` (agent `copywriter`, skill `activity-summary`, mcp `bi-connector`, workflow `campaign-retrospect`), all scaffolded via `new-capability.mjs` (each carries `.opsforge-state.json`), passing R1–R22 + runSuite + security-scan + eval + release.
- **Phase 3.6 opsforge-meta self-bootstrap (carrier B)** — 3 self-hosted dogfood capabilities in `packs/opsforge-meta/`: agent `opsforge` (top-level menu entry), agent `opsforge-installer` (in-platform install entry), skill `opsforge-wizard` (wizard body); all scaffolded via `new-capability.mjs`, passing R1–R22 + runSuite + security-scan + eval + release.
- **CI workflows** — `.github/workflows/{validate,test,release,guardrails}.yml` on PR (5-platform matrix; Node 22 via `.nvmrc`); `.github/workflows/re-eval.yml` weekly cron (re-eval + effectiveness<70% degraded); `guardrails.yml` path-guard covers `adapters/*/` + all tools (skips `steering`-labeled PRs); markdownlint scoped to contributor-facing docs (see `.markdownlintignore`); `CODEOWNERS` extended to `packs/opsforge-meta/` + Phase 3.6 tools.

Status: **341/341 tests green** (bare `node --test` — 0 fail, 0 cancelled, 0 skipped; baseline 305 → +36 via Phase 3.6), `node tools/validate.mjs --all` exits 0 (7 capabilities, `verdict: pass`), `node tools/security-scan.mjs --all` exits 0 (0 findings), `node tools/eval.mjs --all` exits 0 (7 capabilities, `verdict: pending` at overall=0.3 — no live-model run on dogfood caps; harness wired and non-blocking), `node tools/release.mjs --all` exits 0 (3-report gate, registry produced with 7 capabilities), `node install.mjs --doctor --platform claude-code` reports `healthy: true`. See `PROGRESS.md` for the living status, Phase 2+3+3.6 accepted deviations, lessons learned, and pending steering decisions (D5/D6 confirmed; Tier2-min `base.mjs tier()` shipped; `pickVersion` wiring deferred to Phase 4). The five-layer architecture, three-state flow, brand isolation, and validation gates below are all implemented and guarded.

## What OpsForge is

A monorepo of reusable operations capabilities (agents / skills / MCPs / workflows / bundles) that can be installed into any agent platform (Claude Code / Cursor / Codex / Cline) via a cross-platform adapter layer. The defining v6 constraint: **all future skill/agent/mcp iteration will be done by business operators with no development background, via vibe coding**. Therefore the repository itself must fix the engineering baseline so contributors vary only business logic — engineering implementation (stack, layout, naming, testing, security) is machine-enforced and not theirs to deviate from.

## Pinned engineering baseline (non-negotiable)

Per PLAN.md §C. These are locked from the start; do not deviate when implementing:

- **Runtime**: Node.js 22 LTS (`.nvmrc`), ESM `.mjs` for all tools/adapters/installer. No other language except the single POSIX-sh `install.sh` (Git Bash compatible).
- **Package manager**: `npm` only (`package.json` + `package-lock.json`). No pnpm/yarn.
- **Controlled dependencies**: `ajv` (JSON Schema, `additionalProperties: false`), `js-yaml`, `semver`. Adding a dependency requires a `deps-change` PR label + steering approval; CI diffs `package.json`.
- **Tests**: Node's built-in `node:test` — no jest/vitest. Regression cases are declarative `tests/*.yaml`, not code.
- **Contributors may only author `.md` / `.yaml` / `.json`**. Everything executable (`.mjs`/`.js`/`.sh`, `adapters/`, `tools/`, `schema/`, `templates/`, `ci/`, `registry*.yaml`, `package.json`, `AGENTS.md`, `CLAUDE.md`) is steering-owned, guarded by CODEOWNERS + `ci/guardrails.yml` path checks.

## Core commands (Phase 0 + Phase 1 + Phase 2 + Phase 3 tools shipped)

```bash
# Scaffold a new capability — the ONLY legal way to create one (never hand-make dirs)
node tools/new-capability.mjs --kind skill --slug <slug> --name <name>
node tools/new-capability.mjs --kind agent --brand <brand-slug> --name <name>     # brand-customized
node tools/new-capability.mjs --kind <kind> --third-party <upstream>             # intake (orchestrated by tools/intake.mjs)
node tools/new-capability.mjs --promote <path>                                    # drafts→staged (never hand-move)

# Local self-check — run before any PR; any deviation fails loud (non-zero exit)
node tools/validate.mjs <capability-path>
node tools/validate.mjs --all

# v8 eval harness (Phase 2.2) — 5-axis rubric, writes eval-report.json per cap
node tools/eval.mjs <capability-path>
node tools/eval.mjs --all

# Behavioral test runner (Phase 2.2) — all 7 expect modes: exact/contains/human/schema/regex/llm_judge/golden
node tools/test-runner.mjs <capability-path>            # static-only in CI (no model)
OPSFORGE_RUNNER=<platform> node tools/test-runner.mjs <capability-path>   # HTTP-API runner for Tier-2/3

# Workflow (Phase 2.4 / 3.1) — full control-flow: sequence/switch/if/loop/until/while/checkpoint
node tools/workflow-compile.mjs <capability-path>      # compile to slash-commands
node tools/workflow-runner.mjs --run-workflow <id>     # start a run (writes <run-id>/state.json)
node tools/workflow-runner.mjs --list-runs
node tools/workflow-runner.mjs --abort <run-id>
node tools/workflow-runner.mjs --resume <run-id>       # resume from checkpoint-paused

# Profile (Phase 2.3) — composable custom installation
node tools/resolve-profile.mjs --profile <profile.yaml>           # resolve → profile.lock.json

# Intake (Phase 2.6 / 3.4) — third-party capability intake
node tools/intake.mjs --fetch <upstream>      # git-clone (execFileSync argv form) + LICENSE detect + new-capability --third-party

# Installer
./install.sh --install <pack>.<name>@<version>
./install.sh --platform <claude-code|cursor|codex|cline|dify> --pack <pack>
./install.sh --brand <brand-slug> --install <brand>.<name>
./install.sh --profile <profile.yaml> [--profile-save <path>] [--profile-lock <path>] [--fresh]
./install.sh --list [--brand <brand-slug>] | --upgrade <id> | --uninstall <id> [--project <slug>] | --doctor [--brand <brand-slug>] | --repair | --downgrade
```

Single-test invocation runs via `node --test` (Node built-in runner) over a capability's `tests/*.yaml` driven by `tools/test-runner.mjs`. The green-bar is bare `node --test` (no glob) — a targeted-glob green can hide a red bare run (Phase-2 lesson c).

## Architecture (big picture — spans multiple PLAN.md sections)

Five layers, top to bottom:

1. **Source layer** — platform-agnostic capability sources in three states, per contributor namespace.
2. **Registry layer** — `registry.yaml` (general) and `registry-brands.yaml` (per-brand) are the single source of truth for what's released. Both are auto-aggregated by `tools/release.mjs`; never hand-edit.
3. **Adapter layer** (`adapters/<platform>/adapter.mjs`) — `conform()` static check + `translate()` to platform artifacts + `injectMcp()` + `install()`/`uninstall()`/`detect()`. Adapters are platform-aware but **customer-field-agnostic**. Steering-owned.
4. **Installer layer** — `install.sh` (POSIX sh, bootstrap/Windows-Git-Bash) + `install.mjs` (Node, cross-platform). Writes a per-project manifest at `~/.opsforge/manifests/<project-slug>.manifest.json` per install (id, version, commit, platform, `customer` if brand, `security_policy`, `artifacts`, `mcp_keys`).
5. **Runtime layer** — target platform install dirs (`~/.claude/`, `.cursor/`, etc.).

### Three-state flow (PLAN.md §11.2) — reinterpreted in v6 as progressive engineering discipline

`_drafts/` (zero gate: id unique + parseable + zh/en names + `__FILL_ME__` cleared + customer/dir consistency) → `_staged/` (CI adds schema + skeleton guard + naming + placeholder-clean + secret scan + ≥3 tests) → `<contributor-slug>/` formal (full §A conformance + §B security + platform matrix) → registry by `release.mjs`. Each transition is a process gate that compensates for the author's lack of engineering judgment.

### Brand isolation (PLAN.md §5.2, §14)

Brand-customized capabilities live under `customers/<brand-slug>/packs/<brand-slug>/`, carry a `customer` field, and use pack id `<brand-slug>.<name>`. CI guards: physical path must match `customer`, `pack` must start with brand slug, and `depends_on` may not reference other brands' capabilities. General capabilities may not depend on brand capabilities. No contract/license/SLA fields in the repo — those are business-layer concerns.

### Capability addressing

Every atom is globally addressable as `<pack>.<name>@<version>`. Slug/name regex `^[a-z][a-z0-9-]{2,30}$`. Forced semver. `depends_on` uses semver ranges with directional constraints (general→general+third-party; brand→general+third-party+same-brand; third-party→nothing).

## Validation gates (PLAN.md §A/§B/§C/§14)

- **§A conformance** (structural / platform-conformance / origin-provenance) — `tools/validate.mjs` calls each adapter's `conform()`.
- **§B security** (`tools/security-scan.mjs`) — hardcoded secrets, prompt injection / over-privileged instructions, over-privileged tool declarations, private-network SSRF, supply-chain poisoning, MCP tool-surface attacks, dependency-closure advisories. Prompt-injection / supply-chain / private-SSRF findings are **non-exceptionable**.
- **§C engineering baseline** — `skeleton_guard` (file set must match `templates/<kind>/` exactly), `placeholder_clean` (no `__FILL_ME__`/`TODO`/`FIXME` in staged), engineering-field-untampered check, naming regex, no new dependencies, path guards.

Outputs: `validation-report.json` (§A) and `security-report.json` (§B) as CI artifacts; both must be `pass` before `release.mjs` registers.

## Scaffolding contract (PLAN.md §C.2) — the load-bearing mechanism

`tools/new-capability.mjs` copies the legal skeleton from `templates/<kind>/` into `_drafts/`, pre-fills engineering fields (`id`/`version: 0.1.0`/`kind`/`pack`/`owner`/`entrypoint`/`tests`/`changelog`/`source`), and marks business fields with `__FILL_ME__`. Schema is `additionalProperties: false` so ad-hoc fields are rejected. Contributors fill only business fields + body (`source.md`/`SKILL.md`) + declarative test cases. Hand-made directories are rejected by skeleton-signature matching.

## AI-agent instruction files

`AGENTS.md` (universal, all coding agents) and `CLAUDE.md` (this file, Claude-Code-specific, points to AGENTS.md) make any AI coding agent an enforcer of the engineering baseline: only edit business-author files, no new fields/files/dependencies, run `validate.mjs` before PR, no injection/SSRF/secret patterns. These files plus `templates/` and `schema/` are steering-owned (CODEOWNERS-protected).

## When implementing

- Phase 0 baseline is complete; Phase 1 (MVP) + Phase 2 (multi-platform + eval harness + profile + degradation matrix + intake) + Phase 3 (circular workflow state machine + feedback closed-loop + full §B security + full intake + D5/D6 safe defaults) + **Phase 3.6 (v9 UX shell closure: top-level menu / wizard end-to-end / discover reads manifest / feedback jsonl / `detectPlatform()` / no-cwd bootstrap / carrier B `opsforge-meta` meta-pack / runtime copy dynamically importing repo-root `install.mjs`)** are all shipped — 5 adapters (claude-code/cursor/codex/cline/dify), 3-report release gate, 7 test-runner expect modes, full control-flow workflow-runner, full §B security-scan, `--profile`/`--downgrade`/`--repair`/`--project` flags. **Architecture invariant:** the `~/.opsforge/` runtime copy dynamically imports `install.mjs` from the repo root → the OpsForge repo must remain present on the machine for in-platform install/list/doctor (sufficient for dogfood/development; a repo-less-machine bundled release is a later Phase). Phase 4 (governance flywheel) is next; follow PLAN.md §15/§22.12 phase order.
- PLAN.md is now **v7** (see §20): it adds circular-workflow execution (`control_flow`/`vars`/`kb_mount`, per-run state + resume, slash-command + `--run-workflow` CLI, KB MCP) and composable custom installation (`profile.yaml` + `profile.lock.json` + `tools/resolve-profile.mjs`, `--profile` flags, last-write-wins multi-profile). Full blueprint: `docs/design-archive/supplement-v7.md`（已归档，历史设计依据；当前权威见 PLAN.md §20）. 8 design decisions P1–P8 are all confirmed (§20.6).
- PLAN.md is now **v8** (see §21): it adds a **behavioral evaluation layer** (the 4th gate after §A/§B/§C) — `tools/test-runner.mjs` upgraded to a real evaluator (7-field `tests/*.yaml` schema + 7 `expect` modes exact/schema/contains/regex/llm_judge/golden/human + dry-run harness via `claude -p`), `tools/eval.mjs` 5-axis rubric (accuracy/completeness/actionability/safety/robustness) → `eval-report.json` as a 3rd CI artifact, `validate.mjs` R16–R22 anti-vacuous guards (body_min_substance/body_not_boilerplate/test_expect_nontrivial/test_cases_distinct/description_body_alignment/test_expect_declared/no_self_cheat_in_body), three-state upgrade (draft=static only; staged=+functional runSuite+R16-R22; released=+eval harness+platform matrix+workflow dry-run), `release.mjs` requires validation+security+eval reports all pass, post-release feedback (`opsforge-feedback` MCP + `--doctor` effectiveness<70% degraded + weekly re-eval cron + eval-history). 11 decisions Q1–Q11 are all confirmed (§21.9). Full blueprint: `docs/design-archive/supplement-v8.md`（已归档，历史设计依据；当前权威见 PLAN.md §21）.
- PLAN.md is now **v9** (see §22): it adds **domestic self-developed platform compatibility** + **non-technical-user UX**. Platform capability-points model: 9 orthogonal points (`prompt_exec`/`agent_file`/`skill_file`/`slash_command`/`mcp_config`/`workflow_orchestration`/`config_dir_writable`/`kb_mount`/`feedback_hook`) declared per-platform in `adapters/<platform>/platform.yaml`; Tier 1/2/3 auto-computed; adapter contract gains `supports(point)`/`tier()`; the v7 P8 single-point fallback is generalized into a 9-points × 5-strategy degradation matrix (`cli-engine`/`http-inject`/`manual-paste`/`http-direct`/`fail-loud`); new optional `requires` field (hard/soft) declares hard platform deps; no-SDK/no-CLI platforms degrade dry-run/eval (Tier2 via adapter HTTP API, Tier3 static-only+human); judge supports domestic model endpoint (Node built-in fetch, no new dep); `data-residency-cn` compliance scan (warn-not-block). **UX (Phase 3.6 SHIPPED):** `tools/opsforge.mjs` ships the full v9 command surface — top-level menu (`opsforge menu`) / `wizard` end-to-end / `discover` reads per-project manifest + 质量灯 / `feedback` writes jsonl / `detectPlatform()` / no-cwd bootstrap (`tools/opsforge-bootstrap.mjs` + `tools/opsforge-runtime.mjs` + `~/.opsforge/.runtime-root.json`); carrier B `packs/opsforge-meta/` meta-pack (agents `opsforge` + `opsforge-installer`, skill `opsforge-wizard`). `tools/report-renderer.mjs` renders the 3 JSON reports into Chinese plain-language traffic-light reports + fix guidance; `.opsforge-state.json` flow state; carrier D paste file landed (Tier 2/3 non-null `pasteInstructions`); error-recovery guidance + `/rate`/upgrade/rollback. **Dynamic capability inventory (Phase 3.6 收尾):** `tools/inventory.mjs` derives the capability inventory from `registry.yaml` + `registry-brands.yaml` + each capability body's `## 能力说明` / `## 适用场景` H2 sections (R_scenario rule in `validate.mjs` enforces them at staged+) → two outlets: a README marked block (`<!-- opsforge:capability-inventory start/end -->`, regenerated by `node tools/inventory.mjs --readme`, CI `--check-readme` drift gate) and `opsforge discover --all` (global in-repo overview, Chinese grouped cards + 质量灯 + per-platform Tier; menu option 7). 6 decisions D1–D6 are all confirmed (§22.6). Full blueprint: `docs/design-archive/supplement-v9.md`（已归档，历史设计依据；当前权威见 PLAN.md §22）.
- Every executable file is `.mjs` ESM; `install.sh` is the sole sh exception.
- Keep `additionalProperties: false` on all capability schemas.
- `registry*.yaml` must stay auto-generated by `tools/release.mjs`.
- Prefer the existing skills/agents listed in the session (ecc:* reviewers, skill-creator, mcp-builder) where a task matches their purpose rather than improvising tooling.
