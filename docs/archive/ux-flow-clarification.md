# UX-FLOW-CLARIFICATION.md

> **ARCHIVED — historical artifact, not authoritative.** This was a one-shot planner clarification of the shipped-vs-spec gap and open questions. Its items were resolved in the post-e2e fix pass; see `PROGRESS.md`. For the current end-user flow and forward UX design, see `UX-PLAN-V2.md`.

> Planner clarification of the real end-user development flow a non-technical OpsForge operator experiences today (Phase 1 shipped) vs the v9 blueprint. Authoritative sources read in full: `CLAUDE.md`, `AGENTS.md`, `PROGRESS.md`, `IMPLEMENTATION-PLAN.md`, `PLAN-supplement-v9.md` §22, `docs/vibe-coding-playbook.md`, `docs/authoring-guide.md`, and the source of `tools/opsforge.mjs`, `tools/new-capability.mjs`, `install.mjs`, `install.sh`, `tools/paths.mjs`, `tools/report-renderer.mjs`.
>
> Spot-checked by the orchestrator against live source: `opsforge.mjs` command set, `promote()` `/_drafts/` guard, intake `packs/_third-party/` destination, and `release.mjs` `.opsforge-state.json` write absence — all confirmed.

## Section A — Project load / startup

**There is NO "load project" / "start project" / `opsforge init` step in the shipped Phase 1 system.** A grep across the repo for `opsforge init`, `opsforge load`, `load-project`, `init-project` returns zero matches. `install.sh` (`install.sh:1-21`) is a pure POSIX-sh Node-detector bootstrap with no project concept — it just `exec`s `install.mjs "$@"`.

What the user actually lands in:

1. **The user must `cd` into the repo root themselves** (`D:\XD\ClaudeCode\sy-eeo`). Every shipped command derives `repoRoot` from `process.cwd()`:
   - `tools/opsforge.mjs:50` `root: process.cwd()` (scaffold)
   - `tools/opsforge.mjs:71` `repoRoot: process.cwd()` (install)
   - `tools/opsforge.mjs:113` `repoRoot: process.cwd()` (doctor)
   - `tools/new-capability.mjs:73` `root = process.cwd()` (scaffold default)

   There is no validation that the cwd *is* the OpsForge repo. If the user runs `opsforge new` from the wrong directory, `scaffold` will create `_drafts/` in that arbitrary cwd. The only implicit check is that `templates/` is resolved relative to the tool's own `__dirname` (`tools/new-capability.mjs:9` `DEFAULT_TEMPLATES`), so scaffolding works from anywhere — but the resulting `_drafts/` tree will be orphaned outside the real repo.

2. **`OPSFORGE_HOME` is NOT a project-load concept.** It is an env-override for the *home* directory (`tools/paths.mjs:10-15` `resolveHome()`), used only to locate `~/.opsforge/manifests/` (the install-manifest store) and `~/.opsforge/runs/` (eval run state). It does not select or "load" a project. Setting it does not change which repo the author is working in.

3. **The "project-slug" / per-project manifest is an INSTALL-side concept, not an authoring-side one.** It is established only at install time:
   - `install.mjs:62-66` `getManifestPath(project, opsforgeHome)` writes `~/.opsforge/manifests/<project>.manifest.json`, where `project` defaults to `"default"` and is slug-validated.
   - The interactive wizard asks for it only inside `opsforge install`: `tools/opsforge.mjs:147` `const project = (await ask('project name (default: default): ')).trim() || 'default';`
   - The manifest stores `owner_profile: project` per installed capability (`install.mjs:177`).
   - It is NOT consulted by `opsforge new` / `status` / `doctor` for authoring. The authoring path has no notion of "current project".

4. **There is no "current project" the wizard tracks.** `opsforge status` (`tools/opsforge.mjs:84-106`) reads `.opsforge-state.json` from a *capability directory* path (arg or cwd), not from a project manifest. `opsforge doctor` reads the install manifest for the `"default"` project unless `--project` is passed to `install.mjs` (note: `cmdDoctor` in `opsforge.mjs:109-125` does NOT forward `--project` — it only reads `--platform`).

**Net:** Today the "startup step" is: user clones/opens the repo and `cd`s to its root. That is the entire load step. Everything else assumes the cwd is the repo. The per-project manifest at `~/.opsforge/manifests/<project-slug>.manifest.json` is a downstream install record, established when the user types a project name at the `opsforge install` prompt, not a thing loaded up front.

## Section B — The first interaction question

**The user's hypothesis ("dev-from-scratch vs copy/intake-third-party" as the first fork) is NOT correct, on either reading.**

### What the shipped wizard actually does (`tools/opsforge.mjs`)

`main()` (`tools/opsforge.mjs:16-37`) dispatches on `argv[0]`:
- No arg → `console.error('usage: opsforge <new|install|status|doctor>')` (line 19), exit 2.
- `new` / `install` / `status` / `doctor` only. Anything else → `opsforge: unknown command "<cmd>"` (line 29).

So the **real first fork is the top-level command**: `new` vs `install` vs `status` vs `doctor`. There is no menu, no "what do you want to do" prompt — the user must already know the subcommand name. This matches `PROGRESS.md:133` ("P1 commands `new`/`install`/`status`/`doctor`") and `PLAN-supplement-v9.md:377` (Phase 1 ships only those four).

Inside `opsforge new`, `promptNew` (`tools/opsforge.mjs:129-138`) asks in this order:
1. `'kind (agent/skill/mcp/workflow/bundle): '` (line 131) — defaults to `agent`.
2. `'name (e.g. copywriter): '` (line 132) — required.
3. `'brand (optional, press enter to skip): '` (line 134) — optional.
4. `'pack slug (e.g. marketing-team): '` (line 135) — only asked if no brand; required.

**The `--third-party` intake path is NOT exposed through the wizard at all.** `promptNew` has no branch for third-party intake. The intake path exists only in the bare CLI `tools/new-capability.mjs` (the `--third-party <upstream>` flag, `tools/new-capability.mjs:86-94, 132-135, 164-171`), which writes to `packs/_third-party/<name>/` with `source.origin: forked`. To use it, a user must bypass the wizard and run `node tools/new-capability.mjs --third-party <upstream> --kind ... --name ...` directly.

### What the v9 spec intended (§22.8, `PLAN-supplement-v9.md:187-202`)

The spec's intended command set is `new` / `wizard` / `install` / `status` / `doctor` / `report` / `discover` / `feedback` (`PLAN-supplement-v9.md:192-199`). The spec's `opsforge new` interactive flow (`:202`) is:
> ① 问"你要建什么能力"（agent/skill/mcp/workflow/bundle）；② 问"叫什么名字"…；③ 问"属于哪个 pack"…；④ 问"一句话描述"…；⑤ 自动调 `new-capability.mjs` 起骨架；⑥ 引导"现在用自然语言告诉你的 AI 代理要写什么业务逻辑"…

So even in the spec, the first *content* question inside `new` is "what kind of capability" — not "dev vs copy". And the spec's first *fork* is again the command itself (`new` vs `install` vs …). The "end-to-end from-idea-to-released" experience is reserved for the separate `opsforge wizard` command (`PLAN-supplement-v9.md:193`), which Phase 1 did NOT ship (deferred to Phase 2.5, `IMPLEMENTATION-PLAN.md:199`).

**Conclusion on Section B:** The "dev vs copy-third-party" fork is neither the shipped first question nor the spec-intended first question. Shipped first fork = the subcommand (`new`/`install`/`status`/`doctor`). Within `new`, shipped first question = "kind". The third-party intake branch is reachable only via the bare `new-capability.mjs` CLI, never via the wizard. The spec's richer "from idea to released" flow is the deferred `opsforge wizard` command (Phase 2.5).

## Section C — Full happy-path map (shipped Phase 1)

All commands assume the user is at `D:\XD\ClaudeCode\sy-eeo` (repo root). State transitions per AGENTS.md §12: `_drafts/` → `_staged/` → `<contributor>/` formal → `registry.yaml`.

### Branch 1 — Dev-from-scratch (the only authoring path the wizard supports)

1. **Baseline self-check (recommended, not enforced).** `node tools/validate.mjs --all` → expect `verdict: pass` (`docs/vibe-coding-playbook.md:9-13` Step 0).
2. **Launch the wizard's new-capability flow.** `node tools/opsforge.mjs new` → `promptNew` asks kind/name/brand-or-slug (`tools/opsforge.mjs:40-58, 129-138`).
   - *State transition:* none yet — the questions just populate an `opts` object.
3. **Scaffold.** The wizard calls `scaffold({...})` from `new-capability.mjs` (`tools/opsforge.mjs:44-52`). `scaffold` copies `templates/<kind>/` into `packs/_drafts/<slug>/<name>/` (or `customers/<brand>/packs/_drafts/<brand>/<name>/` for brand, `tools/new-capability.mjs:95-116`), pre-fills engineering fields, marks business fields `__FILL_ME__`, and **writes `.opsforge-state.json` with `state: "draft"`** (`tools/new-capability.mjs:137, 226-244`).
   - *State transition:* (none) → **`_drafts/` (draft)**. `.opsforge-state.json.history[0] = {from: null, to: "draft"}`.
   - Wizard prints: `created: <destPath>` + `next: fill the business fields, then run \`opsforge status <destPath>\`` (`tools/opsforge.mjs:53-54`).
4. **Author business content** (no OpsForge command — done in an AI agent or editor). Per `docs/authoring-guide.md`: fill every `__FILL_ME__` in the manifest (`SKILL.md` for skill, `capability.yaml` for agent, etc.), write the body, fill `tests/case-01..03.yaml` (≥3 cases). The recommended vibe-coding prompt is at `docs/vibe-coding-playbook.md:28`.
5. **Self-validate (draft gate).** `node tools/validate.mjs <destPath>` (`docs/authoring-guide.md:73`). Draft gate = R-subset. Note: a fresh scaffold **will fail** `placeholder_clean` (R7) until `__FILL_ME__` slots are filled — this is intended progressive discipline (`docs/authoring-guide.md:76`, `PROGRESS.md:68`).
   - *State transition:* none — still `_drafts/`.
   - Optional visibility: `node tools/opsforge.mjs status <destPath>` reads `.opsforge-state.json` and prints traffic-light 红 (draft) + history + any `validation-report.json` if present (`tools/opsforge.mjs:84-106`).
6. **Promote draft → staged.** `node tools/new-capability.mjs --promote <destPath>` (`tools/new-capability.mjs:177-208`, `docs/vibe-coding-playbook.md:67`). Enforces skeleton-signature match, `fs.renameSync` `_drafts/` → `_staged/`, bumps `.opsforge-state.json` to `state: "staged"` with `from: "draft"`.
   - *State transition:* **`_drafts/` → `_staged/` (staged)**.
   - Note: the wizard has NO promote subcommand — the user must drop to the bare `new-capability.mjs` CLI for this step. (Spec's `opsforge wizard --promote` is deferred, `PLAN-supplement-v9.md:233`.)
7. **Staged gate (full §A + §B + functional runSuite).** `node tools/validate.mjs <stagedPath>` (R1–R22, `PROGRESS.md:129`) → writes `validation-report.json`. `node tools/security-scan.mjs <stagedPath>` → writes `security-report.json`. `node tools/test-runner.mjs <stagedPath>` → functional runSuite, P1 modes `exact`/`contains`/`human` (`PROGRESS.md:129`, `IMPLEMENTATION-PLAN.md:96`).
   - *State transition:* none — still `_staged/`, now carrying the two pass reports.
8. **Open a PR.** PR title `[stage] <slug>.<name>` (or `[stage-brand]` for brand, `tools/new-capability.mjs:294-302`). CI runs `validate`/`test`/`release` workflows (`ci/github-actions/{validate,test,release}.yml`).
9. **Release (staged → released/registry).** On merge, `node tools/release.mjs --all` scans `packs/<contributor>/` (formal) and `customers/<brand>/packs/<brand>/`, calls `release()` per cap (§B.4 gate: requires `validation-report.json` verdict=pass AND `security-report.json` verdict=pass; eval-report NOT required in P1, `PROGRESS.md:130`, `IMPLEMENTATION-PLAN.md:110, 119`). Bumps version, writes `registry.yaml` + `registry-brands.yaml` (auto-aggregated, never hand-edited).
   - *State transition:* **`_staged/` → `<contributor>/` formal + `registry.yaml` entry (released)**. (The physical move from `_staged/` to the formal `packs/<pack>/<kind>/<name>/` layout is not performed by a shipped tool in the e2e flow — `release.mjs` reads from `packs/<contributor>/`; the contributor/formal layout is established when the staged cap is merged into the canonical `packs/` tree. `findCapabilitySource` in `install.mjs:39-60` resolves `packs/<pack>/<kind>/<name>/`.)
   - Note: `release.mjs` does NOT currently update `.opsforge-state.json` to `released` — that spec transition (`opsforge status` showing "released") is not wired by `release()` today; `.opsforge-state.json` is only written by `scaffold` and `promote`.
10. **Install into target platform.** `node tools/opsforge.mjs install` → `promptInstall` asks `capId` + `project name (default: default)` (`tools/opsforge.mjs:62-81, 143-149`). Or bare CLI: `./install.sh --install <pack>.<name>@<version> --platform claude-code --project <slug>` (`install.mjs:297-313`). `install()` resolves the capability source via `findCapabilitySource`, runs `adapter.conform()`, `adapter.translate()` (or `workflow-compile.mjs` for workflows), `adapter.install()` (idempotent atomic write to `~/.claude/`), `adapter.injectMcp()` for mcp, writes/updates `~/.opsforge/manifests/<project>.manifest.json`, and pulls single-layer transitive deps for workflows (`install.mjs:111-216`).
    - *State transition:* (none for the source tree) → install manifest records the install; artifacts land in `~/.claude/agents|skills|commands/`.
11. **Use in Claude Code.** Trigger `@<name>` for agents/skills, `/workflow-<name>` for workflows, MCP tools surface automatically.
12. **Verify / troubleshoot.** `node tools/opsforge.mjs doctor` → `doctor()` checks manifest↔file consistency, deps_missing, MCP config, platform path (`install.mjs:257-294`, `tools/opsforge.mjs:109-125`). `node tools/opsforge.mjs status <capPath>` re-renders the state traffic-light.

### Branch 2 — Third-party intake (NOT wizard-reachable; bare CLI only)

This branch is reachable ONLY via the bare `new-capability.mjs` CLI — the `opsforge` wizard exposes no intake entry point.

1. **(Same baseline + cwd assumptions as Branch 1.)**
2. **Scaffold as intake.** `node tools/new-capability.mjs --third-party <upstream-ref> --kind <kind> --name <name> [--slug <slug>]` (`tools/new-capability.mjs:86-94, 267-292`). Produces `packs/_third-party/<name>/` (NOT under `_drafts/`), sets `source.origin: forked` + `upstream_ref: <upstream>` via `setOriginForked` (`tools/new-capability.mjs:132-135, 164-171`), and writes `.opsforge-state.json` `state: "draft"`. PR title `[intake] third-party/<name>` (`tools/new-capability.mjs:94`).
   - *State transition:* (none) → `packs/_third-party/<name>/` (draft-equivalent, but physically outside `_drafts/`).
   - **Phase 1 scope limit (D6, `PROGRESS.md:118`, `IMPLEMENTATION-PLAN.md:238`):** the intake path generates path + `source.origin: forked` + `upstream_ref` ONLY. Full LICENSE/wrapping validation + the intake gate are **deferred to Phase 3.4**. `schema/upstream-ref.schema.json` ships as a contract but is not enforced by an intake gate.
3. **Author / wrap content.** Same as Branch 1 step 4 — fill `__FILL_ME__`, write body, write tests.
4. **Validate.** `node tools/validate.mjs packs/_third-party/<name>`.
5. **Promote.** `--promote` requires the path to contain `/_drafts/` (`tools/new-capability.mjs:180-182`) — but intake writes to `packs/_third-party/`, NOT `/_drafts/`. **This means the shipped `--promote` command will REJECT an intake directory** ("promote: path ... is not under .../_drafts/"). There is no shipped promote path from `packs/_third-party/` to staged. This is a real gap — see Section D.
6. **(Staged gate, release, install)** — same as Branch 1 steps 7–11, but only reachable if the intake dir were first relocated into `_staged/` (which AGENTS.md §11 forbids doing by hand). In practice, the third-party intake happy path is **not completable end-to-end in Phase 1**.

## Section D — Spec-vs-shipped gap table

v9 UX features the supplement describes but Phase 1 did NOT ship. Phase mapping per `IMPLEMENTATION-PLAN.md:182-202` and `PLAN-supplement-v9.md:375-380`.

| v9 spec feature (citation) | Shipped in P1? | Deferred to | Evidence |
|---|---|---|---|
| `opsforge wizard` end-to-end idea→released guide (`PLAN-supplement-v9.md:193, 202`) | No | Phase 2.5 (`IMPLEMENTATION-PLAN.md:199`) | `opsforge.mjs` has no `wizard` cmd; `main()` switch covers `new`/`install`/`status`/`doctor` only (`tools/opsforge.mjs:23-32`) |
| `opsforge discover` capability listing + triggers + quality lights (`:196, 287-301`) | No | Phase 2.5 | no `discover` branch in `opsforge.mjs` |
| `opsforge report <artifact>` rendering all 3 JSON reports (`:197`) | Partial | Phase 2.5 | `report-renderer.mjs` P1 renders `validation-report` only; `security-report`/`eval-report`/`manifest` throw (`tools/report-renderer.mjs:17-24`); no `report` command in `opsforge.mjs` |
| `opsforge feedback <capability>` (`:199, 317-321`) | No | Phase 3.3 (`IMPLEMENTATION-PLAN.md:215`) | no `feedback` branch in `opsforge.mjs` |
| Real-time quality feedback after authoring body/tests (`:206-221`) | No | Phase 2.5 | `opsforge new` does not auto-run `validate.mjs`/`test-runner.mjs` after scaffold; it just prints "next: fill the business fields" (`tools/opsforge.mjs:53-54`) |
| `opsforge status` four-stage visual (draft→staged→released→registry) (`:223-233`) | Partial | Phase 2.5 | shipped `status` reads `.opsforge-state.json` (state + history) and renders traffic-light, but `release.mjs` does NOT write `.opsforge-state.json` to `released` — so the "released" light never fires from the release path; "registry" stage not visualized (`tools/opsforge.mjs:84-106`) |
| `opsforge install` interactive 5-step (platform→method→browse→deps→confirm) (`:250-272`) | Partial | Phase 2.5 (browse/deps UI); Phase 2.3 (profile/bundle methods) | shipped `promptInstall` asks only capId + project name, hard-codes platform `claude-code` (`tools/opsforge.mjs:143-149`); no browse/deps/confirmation UI |
| `opsforge install --repair` / `--repair-mcp` (`:311-313`) | No | Phase 2.5 (`IMPLEMENTATION-PLAN.md:199`) | `install.mjs main()` has no `--repair` flag (`install.mjs:297-347`) |
| `opsforge install --upgrade` / `--downgrade` (`:315, 321`) | No | Phase 3.3 (`IMPLEMENTATION-PLAN.md:215`) | not in `install.mjs main()` |
| General degradation matrix (9 points × 5 strategies) (`:§1.5`) | No | Phase 2.5 (`IMPLEMENTATION-PLAN.md:199`) | claude-code adapter is all-9-points-supported (Tier 1); matrix unimplemented |
| Tier-2 / Tier-3 domestic platform adapters (`:§1.7`) | No | Phase 2.5 | only `adapters/claude-code/` exists (`PROGRESS.md:128`) |
| `--project` forwarded to `opsforge doctor` | No (bug-sized gap) | — | `cmdDoctor` only reads `--platform`, never `--project` (`tools/opsforge.mjs:109-125`); `doctor()` defaults project to `"default"` (`install.mjs:258`) |
| Third-party intake full (LICENSE/wrapping gate, promote path) | Partial | Phase 3.4 (`IMPLEMENTATION-PLAN.md:217`, D6 `PROGRESS.md:118`) | intake scaffolds path + `source.origin` only; `--promote` rejects `packs/_third-party/` (not under `_drafts/`); full intake gate deferred |
| `--lang en` report rendering (`:§2.5 D6`) | No | Phase 4 (`PLAN-supplement-v9.md:380`) | `report-renderer.mjs` throws on non-`zh` (`tools/report-renderer.mjs:22-24`) |
| `eval-report.json` 3rd CI artifact | No | Phase 2.2 (`IMPLEMENTATION-PLAN.md:189`) | `release.mjs` requires 2 reports only in P1 (`PROGRESS.md:130`) |

## Section E — Open questions for the user

1. **Is "load project" even a desired UX?** Today the system is project-agnostic for authoring (cwd = repo) and project-scoped only for install manifests (a free-text `--project` name). Do you want a real `opsforge init`/`opsforge use <project>` step that (a) validates cwd is an OpsForge repo, (b) sets a "current project" the wizard remembers, and (c) scopes `status`/`doctor` to that project? Or should the wizard stay project-agnostic and the per-project manifest remain a downstream install record only? The spec does not describe an `init` command; this is a design decision, not a spec gap.

2. **Should the third-party intake branch be exposed in the wizard?** The shipped `opsforge new` has no intake fork, and the bare `--third-party` CLI path is broken end-to-end (promote rejects `packs/_third-party/`). Do you want (a) intake added to `opsforge new` as the user hypothesized (a first fork "dev vs copy-third-party"), (b) intake deferred entirely to Phase 3.4 with a clear "not available" message in the wizard, or (c) intake kept as a steering-only bare-CLI path not surfaced to business operators?

3. **Where should the third-party intake dir live so promote can move it?** `--promote` requires `/_drafts/` in the path (`tools/new-capability.mjs:180-182`). Intake writes to `packs/_third-party/`. Should intake write to `packs/_drafts/third-party/<name>/` instead (so promote works), or should `--promote` learn a second intake→staged transition? This is a real bug-blocking-gap, not just a deferred feature.

4. **Should `release.mjs` update `.opsforge-state.json` to `released`?** The spec's `opsforge status` four-stage visual (`PLAN-supplement-v9.md:223-233`) depends on the released transition being written. Today only `scaffold` and `promote` write the state file. Without a-side write, the "released" and "registry" lights in `opsforge status` are unreachable. Is this a Phase 1.7 gap to backfill, or explicitly deferred to Phase 2.5 with the `wizard` flow?

5. **Should `opsforge doctor` accept `--project`?** `cmdDoctor` ignores it (`tools/opsforge.mjs:109-125`), so `doctor` always inspects the `"default"` project manifest. Is that intended, or a P1 gap?

6. **Is the bare-subcommand first fork acceptable for non-technical users?** The shipped wizard requires the user to already know `new`/`install`/`status`/`doctor` — there is no top-level menu. The spec defers the end-to-end `wizard` menu to Phase 2.5. Do you want a minimal top-level menu ("what do you want to do? 1) create 2) install 3) check status 4) diagnose") backfilled into Phase 1, or is the bare-subcommand UX acceptable until Phase 2.5?

---

## Summary

The key finding: **there is no "load project" step and no "dev vs copy-third-party" first fork in either the shipped or spec-intended UX.** Today the user just `cd`s to the repo root (cwd is the implicit project; `OPSFORGE_HOME` is a home-dir override, not a project selector; the per-project manifest is a downstream install record keyed by a free-text `--project` name). The real first fork is the bare subcommand (`new`/`install`/`status`/`doctor`), and within `new` the first question is "kind of capability". The third-party intake path exists only in the bare `new-capability.mjs` CLI (not in the wizard) and is **not completable end-to-end in Phase 1** because `--promote` rejects `packs/_third-party/` paths. The spec's richer `wizard`/`discover`/`report`/`feedback` UX and the general degradation matrix are all deferred to Phase 2.5 / Phase 3.3-3.4 per `IMPLEMENTATION-PLAN.md`.
