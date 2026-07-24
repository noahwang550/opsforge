# Phase 1 Fix Spec (post-e2e + post-review)

> **ARCHIVED — historical artifact, not authoritative.** All 5 e2e bugs + 2 P0 contract deviations + P1 findings were applied in full during the post-e2e fix pass; see `PROGRESS.md`. Kept here as a record of what was fixed and why. For current state, consult `PROGRESS.md` and the live source.

> Produced by ecc:code-reviewer. All 5 e2e bugs CONFIRMED + 2 P0 contract deviations + P1 findings. Writer (tdd-guide) applies in order P0 → P1 → P2, running `node --test` + `node tools/validate.mjs --all` after each P0/P1 fix. Target: e2e-runner's 9-gate matrix all GREEN.

## Verified bugs (CONFIRMED)

- **6a** `install.mjs:293` `--uninstall` branch does not strip `@version` (install branch does at :283). `uninstall()`→`assertCapId()` rejects `@`.
- **6b** `tools/workflow-compile.mjs:103` returns literal `~/.claude/commands/workflow-<name>.md`; `install.mjs:132-136` overrides adapter's expanded workflow artifact with `compile()`'s literal-`~` artifact; neither expands `~`. ARCHITECTURE-DELTA §5.1 says `~` expansion is the install layer's job. Only workflow kind affected.
- **6c** `install.mjs:252-259` `doctor()` does `fs.existsSync(artifact)` on literal-`~` path → resolves relative to CWD → false positive/negative.
- **7a** `packs/marketing-team/**` (4 dirs) lack `.opsforge-state.json` → hand-built, bypassing scaffold. Violates AGENTS.md rule 9 + IMPLEMENTATION-PLAN §1.6.
- **7b** `tools/validate.mjs main()` (839-870) + `tools/security-scan.mjs main()` (97-135) only `console.log`; never write `validation-report.json`/`security-report.json`. `release.mjs:71-77` reads them "if present" → never present → gate no-op. COMPOUND: `release.mjs aggregateAll` (141-170) calls `addCapabilityToRegistry` directly, bypassing `release()` per-cap → even if reports existed, `--all` CI path skips the §B.4 gate.

## Additional findings

### P0 — contract/security
1. **`release.mjs aggregateAll` bypasses §B.4 gate** — `addCapabilityToRegistry` registers without checking reports. Compound of 7b.
2. **`security-scan.mjs scan()` `id` wrong** — `:60` `path.basename(capDir)` → `copywriter`; contract wants `marketing-team.copywriter`.

### P1 — correctness
3. `install.mjs:161` `source_commit: 'head'` literal placeholder → use `execSync('git rev-parse --short HEAD')` (mirror `release.mjs:80-83`); fallback `'unknown'` outside a git repo.
4. `install.mjs` `--brand` not slug-validated → add `assertSlugSegment(brand,'brand')` in `install()` and in `main()` `--install` branch (AGENTS.md §5.4 call-site list includes every `<brand>`).
5. `install.mjs:180-189` transitive-dep failures silently swallowed → record `deps_missing: string[]` in manifest entry; `doctor()` surfaces as `medium` issue.
6. `adapters/claude-code/adapter.mjs:103-122` workflow translate branch is dead code (`globalThis.__opsforgeWorkflowCompile` never set; `install.mjs` overrides anyway) → delete the branch, return `[]` or throw documented error.
7. `release.mjs:32-42` duplicates `atomicWrite` (sync variant) instead of importing from `paths.mjs` (§5.1 violation; misses fsync).
8. `new-capability.mjs:241` `writeOpsforgeState` uses `fs.writeFileSync` → use shared atomic write (§5.1, crash-safe).

### P2 — style/dead-code
9. `install.mjs:324` direct-invocation check fragile → follow-up to centralize in `paths.mjs` (`isMainEntry`); no P1 change.
10. `security-scan.mjs` SSRF `\b127\.` may false-positive on `port 127` → acceptable for P1.

### tdd-guide self-reported deviations — all SOUND, NO ACTION
- R9 `version` removed from untampered fields (ARCHITECTURE-DELTA §2.6 line 443 confirms staged version is author-owned; R5 still locks draft to 0.1.0).
- `scanCapabilities` formal-dir scanning (necessary for §1.6 exit criteria).
- Pack-field detection dir-structure-aware (correct for both draft/staged and formal layouts).

---

## Consolidated fix spec (apply in order)

### P0-1 — Fix `--uninstall` arg parsing (6a)
**File:** `install.mjs` lines 291-295. Strip `@version`:
```js
} else if (argv.includes('--uninstall')) {
  const idx = argv.indexOf('--uninstall');
  const capIdWithVersion = argv[idx + 1] || '';
  const capId = capIdWithVersion.split('@')[0];
  const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
  const r = await uninstall({ platform, capId });
  console.log(`uninstalled: ${r.uninstalled.join(', ')}`);
  process.exit(0);
}
```
**Test:** `install.test.mjs` IN9 — call `main()` via subprocess `node install.mjs --uninstall foo.bar@1.0.0 --platform claude-code` with `OPSFORGE_HOME=temp`; assert exit 0 + agent file removed. (The e2e-runner already added `install.cli.test.mjs` CLI-2 documenting this — make it green.)

### P0-2 — Expand `~` in workflow artifact (6b)
**File:** `install.mjs` lines 132-136 (RECOMMENDED install-layer fix per §5.1):
```js
if (capYaml.kind === 'workflow') {
  const { compile } = await import('./tools/workflow-compile.mjs');
  const wfArtifact = compile(capYaml, platform);
  if (wfArtifact.targetPath.startsWith('~/')) {
    wfArtifact.targetPath = path.join(resolveHome(), wfArtifact.targetPath.slice(2));
  }
  artifacts = [wfArtifact];
}
```
(Ensure `resolveHome` imported from `./tools/paths.mjs`.) Also fix `workflow-compile.mjs main()` to print resolved absolute path.
**Test:** `install.test.mjs` IN10 — install a workflow cap into temp `OPSFORGE_HOME`; assert command file exists at `<home>/.claude/commands/workflow-<name>.md` (NOT `./~/.claude/...`).

### P0-3 — Expand `~` in `doctor()` artifact check (6c, defensive)
**File:** `install.mjs` lines 252-259:
```js
for (const cap of manifest.capabilities) {
  for (let artifact of cap.artifacts || []) {
    if (artifact.startsWith('~/')) artifact = path.join(resolveHome(), artifact.slice(2));
    if (!fs.existsSync(artifact)) {
      issues.push({ severity: 'medium', check: 'artifact_missing', detail: `Artifact ${artifact} for ${cap.id} not found`, fix: `Reinstall ${cap.id}` });
    }
  }
}
```
**Test:** `install.test.mjs` IN11 — seed manifest with literal-`~` artifact that does NOT exist expanded; assert `doctor()` reports `healthy:false` + `artifact_missing`.

### P0-4 — Regenerate example capabilities via scaffold (7a)
Delete the 4 hand-built dirs under `packs/marketing-team/` and re-create via `node tools/new-capability.mjs` (so `.opsforge-state.json` is written), re-apply business content (capability.yaml/body/source.md), then `--promote` to staged/formal. Verify each dir contains `.opsforge-state.json` with `state: "staged"` (or "released" once registered). Re-run `validate.mjs --all` (skeleton_guard exclusion at `validate.mjs:155` already handles the file — stays exit 0).
**Test:** `tools/new-capability.test.mjs` T28 — after `scaffold({kind:'skill',slug:'foo',name:'bar',...})`, assert `fs.existsSync(path.join(destPath,'.opsforge-state.json'))`, `state==='draft'`, `history[0].to==='draft'`.

### P0-5 — Write report JSON artifacts + gate `--all` (7b + finding #1 + #2)
**Files:** `tools/validate.mjs`, `tools/security-scan.mjs`, `tools/release.mjs`, `tools/paths.mjs`
1. `paths.mjs`: add `atomicWriteSync(file, data)` export (mirror `atomicWrite` but sync: `fs.writeFileSync` to temp + `fs.renameSync` + `fsyncSync`).
2. `validate.mjs main()`: after computing the report, write `validation-report.json` per cap dir (shape §3.3: `{id, origin:'original', checks:{...}, regression_cases, verdict}`):
   ```js
   const { atomicWriteSync } = await import('./paths.mjs');
   atomicWriteSync(path.join(dir, 'validation-report.json'), JSON.stringify(report, null, 2));
   ```
   For `--all`, write one report per cap dir (so `release(capDir)` can read it).
3. `security-scan.mjs main()`: after `scan(capDir)`, write `security-report.json` into capDir via `atomicWriteSync`.
4. `security-scan.mjs scan()`: fix `id` — derive from parsed capability (capability.yaml `id`), fall back to basename only if parse fails.
5. `release.mjs aggregateAll()`: make it call `release(capDir,{repoRoot})` per cap so the §B.4 gate fires; keep the "if reports absent, warn but allow" greenfield rule (§2.6 line 460) — the fix is that reports ARE now present so the gate fires. Replace the body that calls `addCapabilityToRegistry` directly.
**Tests:** `validate.test.mjs` T41 — run `main()` subprocess on fixture; assert `validation-report.json` exists + verdict matches. `security-scan.test.mjs` SS4 — after `main()` subprocess, assert `security-report.json` written with correct `id` (`<pack>.<name>`). `release.test.mjs` RL4 — seed fixture with `validation-report.json` verdict `fail`; run `aggregateAll`; assert cap NOT registered.

### P1-1 — `source_commit` real sha (finding #3)
**File:** `install.mjs:161`. `import { execSync } from 'node:child_process'`; compute `source_commit` (fallback `'unknown'`).
**Test:** extend IN2 — assert `source_commit !== 'head'` and matches `/^[0-9a-f]{7,}$/` inside repo (or `'unknown'` outside).

### P1-2 — Slug-validate `--brand` (finding #4)
**File:** `install.mjs`. In `install()` after destructuring `brand`: `if (brand) assertSlugSegment(brand,'brand');`. Also in `main()` `--install` branch before `install()`.
**Test:** extend IN8 — `--brand '../etc'` → `assert.rejects(/brand/)`.

### P1-3 — Record transitive-dep failures in manifest (finding #5)
**File:** `install.mjs:176-191`. Collect `depsMissing[]`; add `deps_missing: depsMissing` to manifest entry; `doctor()` surfaces `cap.deps_missing?.length` as `medium` issue.
**Test:** `install.test.mjs` IN12 — workflow install where a step capId is nonexistent; assert manifest entry `deps_missing:['<id>']` + `doctor()` `healthy:false`.

### P1-4 — Delete dead workflow translate branch (finding #6)
**File:** `adapters/claude-code/adapter.mjs:103-122`. Delete the `case 'workflow':` body; return `[]` (or throw documented `Error`).
**Test:** extend `adapter.test.mjs` — `translate({kind:'workflow',...})` returns `[]` (or throws documented error).

### P1-5 — Shared atomicWrite in release.mjs + new-capability.mjs (findings #7,#8)
**Files:** `tools/release.mjs:32-42` (replace local `atomicWriteSync` with import), `tools/new-capability.mjs:241` (`fs.writeFileSync` → `atomicWriteSync`).
**Test:** no new; existing covers the path.

### P2-1 — direct-invocation fragility (finding #9)
No P1 code change; follow-up to centralize `isMainEntry` in `paths.mjs`.

---

## Done criteria
- All P0 + P1 fixes applied.
- `node --test` (all `**/*.test.mjs`) green, including new IN9–IN12, T28, T41, SS4, RL4, and the e2e-runner's `install.cli.test.mjs` CLI-2 now green.
- `node tools/validate.mjs --all` exit 0 (4 caps, reports now written).
- `node tools/security-scan.mjs --all` exit 0 (reports written, `id` correct).
- `node tools/release.mjs --all` → registry; `validation-report.json`+`security-report.json` present per cap; gate fires on a `fail` fixture (RL4).
- Re-run e2e-runner's 9-gate matrix → all GREEN.
