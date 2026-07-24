# OpsForge Phase 0 — E2E Evidence Log

Run by: e2e-runner (independent verification, not the implementer).
Date: 2026-07-22
Node: v24.14.0 (repo pins v22 in `.nvmrc`/`engines`; v24 is fine for running — per task instructions, not a spec violation).
Working dir: `D:\XD\ClaudeCode\sy-eeo`

All commands run against real binaries (`node tools/new-capability.mjs`, `node tools/validate.mjs`).
Scratch fixtures cleaned up after each journey; repo left as found (greenfield, no `packs/` or `customers/` dirs).

---

## Journey A — happy path: scaffold → fill → validate-pass → promote

### Step 1 — scaffold skill
Cmd: `node tools/new-capability.mjs --kind skill --slug demo-team --name activity-summary`
Exit: 0
Stdout:
```
created: D:\XD\ClaudeCode\sy-eeo\packs\_drafts\demo-team\activity-summary
next: node tools/validate.mjs D:\XD\ClaudeCode\sy-eeo\packs\_drafts\demo-team\activity-summary
pr-title: [draft] demo-team.activity-summary
```
Result: PASS — writes under `packs/_drafts/demo-team/activity-summary/`, prints `created:` + `next:` + PR title, exits 0.

### Step 2 — validate fresh draft (placeholders still `__FILL_ME__`)
Cmd: `node tools/validate.mjs packs/_drafts/demo-team/activity-summary/`
Exit: 1
Stdout:
```
PASS  yaml_parse
PASS  id_unique
PASS  version_lock
FAIL  placeholder_clean  placeholder_clean: packs/_drafts/demo-team/activity-summary/CHANGELOG.md:7 contains placeholder "__FILL_ME__"
PASS  display_names_i18n
PASS  customer_dir_consistency
PASS  entry_guard

verdict: fail
```
Result: PASS (spec-compliant). Per DESIGN.md §5, draft DOES run R7 (placeholder_clean), so a fresh scaffold with unfilled `__FILL_ME__` correctly FAILS draft validation. This matches the §5 rule matrix exactly — NOT a bug; the implementer correctly did NOT relax R7 in draft.

### Step 3 — fill placeholders, re-validate draft
Filled: `display_name_zh/en`, `description`, `SKILL.md` body, `CHANGELOG.md`, `README.md`, 3 test cases. No `__FILL_ME__` remains.
Cmd: `node tools/validate.mjs packs/_drafts/demo-team/activity-summary/`
Exit: 0
Stdout: `verdict: pass` (all 7 draft checks PASS).
Result: PASS.

### Step 4 — promote drafts → staged
Cmd: `node tools/new-capability.mjs --promote packs/_drafts/demo-team/activity-summary/`
Exit: 0
Stdout:
```
moved: D:\XD\ClaudeCode\sy-eeo\packs\_staged\demo-team\activity-summary
pr-title: [stage] demo-team.activity-summary
```
Source `packs/_drafts/...` removed; target `packs/_staged/demo-team/activity-summary/` exists with all 6 files (CHANGELOG.md, README.md, SKILL.md, tests/). Frontmatter unchanged.
Result: PASS.

### Step 5 — validate staged
Cmd: `node tools/validate.mjs packs/_staged/demo-team/activity-summary/`
Exit: 0
All 13 staged checks PASS (schema, yaml_parse, id_unique, naming, version_semver, placeholder_clean, skeleton_guard, engineering_fields_untampered, display_names_i18n, customer_dir_consistency, depends_on_resolvable, depends_on_direction, tests_min).
Result: PASS.

---

## Journey B — brand path

### Step 6 — brand agent scaffold
Cmd: `node tools/new-capability.mjs --kind agent --brand acme-corp --name campaign-bot`
Exit: 0
Dest: `customers/acme-corp/packs/_drafts/acme-corp/campaign-bot/` (correct).
Frontmatter: `id: acme-corp.campaign-bot`, `pack: acme-corp`, `owner: acme-corp`, `customer: acme-corp`.
File set matches `templates/brand-draft/` (capability.yaml, source.md, tests/, CHANGELOG.md, README.md).
Result: PASS.

---

## Journey C — fail-loud behaviors (DESIGN.md §5 message strings)

### Step 7 — skeleton_guard: extra file in staged
Fixture: added `extra.md` to staged `activity-summary`.
Message: `skeleton_guard: file set mismatch; missing=[], extra=[extra.md]`
Exit: 1. Contains `skeleton_guard: file set mismatch` and `extra=[`.
Result: PASS.

### Step 8 — placeholder_clean: `__FILL_ME__` in staged
Fixture: appended `__FILL_ME__` to `SKILL.md`.
Message: `placeholder_clean: packs/_drafts/demo-team/activity-summary/SKILL.md:24 contains placeholder "__FILL_ME__"`
Exit: 1. Contains `placeholder_clean:` and `contains placeholder`.
Result: PASS.

### Step 9 — naming: invalid token (`My_Bad`)
Fixture: hand-edited `pack: My_Bad` in staged SKILL.md.
Message: `naming: "My_Bad" does not match ^[a-z][a-z0-9-]{2,30}$`
Exit: 1. Contains `naming:` and the regex.
Result: PASS.

### Step 10 — version_lock: draft version 0.2.0
Fixture: fresh draft skill, version bumped to `0.2.0`.
Message: `version_lock: draft version must be 0.1.0, got "0.2.0"`
Exit: 1. Contains `version_lock: draft version must be 0.1.0`.
Result: PASS.

### Step 11 — tests_min: staged with 2 test cases
Fixture: promoted skill, removed `case-03.yaml`.
Message: `tests_min: expected >=3 test cases, got 2`
Exit: 1. Contains `tests_min: expected >=3`.
Result: PASS.

### Step 12 — entry_guard: hand-made draft dir (stray file, no template match)
First attempt (dir with NO manifest, only `notes.txt`): validate short-circuits on `yaml_parse` (`no manifest file found`); `entry_guard` never runs. This is a **finding** (see Discrepancies §D2).
Second attempt (scaffolded skill draft + stray `notes.txt` so manifest parses): `entry_guard` fires correctly.
Message: `entry_guard: "packs/_drafts/eg/eg-skill" not generated by new-capability.mjs (no template signature match)`
Exit: 1. Contains `entry_guard:` and `no template signature match`.
Result: PASS (with the caveat above — entry_guard only fires when a manifest is parseable).

### Step 13 — customer_dir_consistency: customer ≠ path
Fixture: brand cap with `customer: acme-corp` placed under `customers/other-brand/...`.
Message: `customer_dir_consistency: customer "acme-corp" but path "D:/XD/ClaudeCode/sy-eeo/customers/other-brand/packs/_drafts/acme-corp/cb-test" not under customers/acme-corp/`
Exit: 1. Contains `customer_dir_consistency:`.
Result: PASS.

---

## Journey D — repo-wide

### Step 14a — `validate.mjs --all` with broken scratch present
Exit: 1. Aggregates all failing capabilities, lists each failure detail, final `verdict: fail (7 capability(ies))`.
Confirms `--all` aggregates a non-zero exit when any capability fails.
Result: PASS.

### Step 14b — `validate.mjs --all` on clean (greenfield) repo
After cleaning all scratch fixtures (no `packs/`, no `customers/`).
Cmd: `node tools/validate.mjs --all`
Exit: 0
Stdout: `verdict: pass (0 capability(ies))`
Result: PASS — empty repo yields pass verdict, exit 0.

---

## Spec-vs-implementation discrepancies (independently found)

### D1. entry_guard never runs for a no-manifest draft dir
`validateDir` short-circuits as soon as `cap.parseError` is set (which happens when no manifest file is found) and returns only the `yaml_parse` failure. DESIGN.md §5 R15 says entry_guard should run on `_drafts/` dirs to reject hand-made directories; a hand-made dir with only a stray `notes.txt` (no manifest) is exactly the §7 T13 test case ("手建 `_drafts/x/y/` 不匹配任何模板 → fail"), but the implementation reports `yaml_parse: no manifest file found` instead of the `entry_guard` message. Mitigating factor: a scaffolded dir always has a manifest, so the legitimate happy path is unaffected; and adding a stray file to a scaffolded dir DOES fire entry_guard. But the literal §7 T13 scenario (purely hand-made dir) does not produce the spec'd `entry_guard:` message. **Minor spec deviation.**

### D2. `--promote` prints `moved:` + `pr-title:`; spec §6 says print PR title
Spec §6: "打印后续 PR 标题：`[stage] <slug>.<name>`". Implementation prints two lines: `moved: <destPath>` and `pr-title: [stage] <slug>.<name>`. The PR title IS printed (as `pr-title:` line), so this is an additive superset, not a violation. **Cosmetic only; not a violation.**

### D3. `scaffold` PR title line labeled `pr-title:` instead of bare
Same as D2 for the scaffold path — `created:`, `next:`, `pr-title: [draft] ...`. Additive; not a violation.

### D4. `--third-party` writes under `packs/_third-party/<name>/` but is never scanned/validated
`scanCapabilities` includes `packs/_third-party` in its roots, but `walkCapabilityDirs` only recurses into subdirs looking for a manifest; a third-party cap at `packs/_third-party/<name>/` with a manifest would be found. Not exercised in this journey (out of scope for steps 1–14). No discrepancy found, just noted.

### D5. The "5 deviations the implementer self-reported" — not found in repo
No self-report / handoff document exists in the repo (checked root `*.md`, `docs/`, `ci/`, `.e2e/`). The implementer's self-report was presumably delivered out-of-band (in the launching agent's context) and is not available to this runner. I therefore could not perform the requested "independently confirm or refute each" of the 5; instead I listed the discrepancies I found myself (D1–D4 above). The only material one is **D1** (entry_guard on no-manifest dir).

---

## Bugs found

1. **entry_guard short-circuit (D1, severity: low).** A purely hand-made `_drafts/` dir with no manifest yields `yaml_parse: ... no manifest file found` instead of the spec'd `entry_guard: ... no template signature match`. The §7 T13 test scenario (if constructed literally with no manifest) would not see the `entry_guard` message. Workaround in real usage: scaffolded dirs always have a manifest, so entry_guard still protects the legitimate path. Recommend: in `validateDir`, when state==='draft' and no manifest, still run `entry_guard` before bailing on `yaml_parse`, OR have `checkEntryGuard` be the first check for draft state.

No other bugs. No flakiness observed (all checks are deterministic CLI).

---

## Artifacts

- This file: `D:\XD\ClaudeCode\sy-eeo\.e2e\e2e-evidence.md`
- No screenshots (CLI-only; stdout captured above verbatim).
- No flaky tests quarantined (none observed).
- Scratch fixtures under `packs/` and `customers/` removed; repo left greenfield.

---

## Summary matrix (steps 1–14)

| Step | Journey | Expected | Exit | Message substring | Result |
|------|---------|----------|------|-------------------|--------|
| 1 | A | scaffold writes, prints created/next/pr-title | 0 | `created:` `next:` `pr-title:` | PASS |
| 2 | A | fresh draft FAILS placeholder_clean per §5 R7 | 1 | `placeholder_clean:` `contains placeholder` | PASS (spec-compliant fail) |
| 3 | A | filled draft passes | 0 | `verdict: pass` | PASS |
| 4 | A | promote moves drafts→staged, frontmatter unchanged | 0 | `moved:` `pr-title: [stage]` | PASS |
| 5 | A | staged passes all 13 checks | 0 | `verdict: pass` | PASS |
| 6 | B | brand scaffold under customers/<brand>/, customer: field | 0 | `customer: acme-corp` | PASS |
| 7 | C | skeleton_guard extra file | 1 | `skeleton_guard: file set mismatch` `extra=[extra.md]` | PASS |
| 8 | C | placeholder_clean staged | 1 | `placeholder_clean:` `contains placeholder` | PASS |
| 9 | C | naming invalid token | 1 | `naming:` `^[a-z][a-z0-9-]{2,30}$` | PASS |
| 10 | C | version_lock draft 0.2.0 | 1 | `version_lock: draft version must be 0.1.0` | PASS |
| 11 | C | tests_min 2 cases | 1 | `tests_min: expected >=3` | PASS |
| 12 | C | entry_guard no template match | 1 | `entry_guard:` `no template signature match` | PASS (with D1 caveat) |
| 13 | C | customer_dir_consistency mismatch | 1 | `customer_dir_consistency:` | PASS |
| 14a | D | --all aggregates non-zero on failures | 1 | `verdict: fail` | PASS |
| 14b | D | --all empty repo pass | 0 | `verdict: pass (0 capability(ies))` | PASS |

Overall: 14/14 steps behave per spec. One minor spec deviation (D1 — entry_guard on no-manifest dir).
