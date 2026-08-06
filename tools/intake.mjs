// tools/intake.mjs — Phase 3.4: end-to-end third-party intake orchestrator.
// Orchestrates intake-fetch (clone) + intake-license (check) + new-capability
// (scaffold a third-party draft) + writes an upstream-ref record (§12.1).
// P0-C: try/catch cleanup — on any failure, remove the clone temp dir +
// draft half-product (unless --keep-on-fail). No new deps; built-in fetch +
// injectable exec for tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchUpstream } from './intake-fetch.mjs';
import { checkLicense } from './intake-license.mjs';
import { atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES = path.resolve(__dirname, '..', 'templates');

/**
 * Run the full intake: fetch upstream → check license → scaffold a third-party
 * draft → write the upstream-ref record.
 * P0-C: on any step failure, clean up the clone temp dir + draft half-product
 * (unless args.keepOnFail is set, which preserves them for debugging).
 * @param {{repoUrl: string, license: string, kind: string, name: string, owner: string, repoRoot?: string, execFile?: Function, dest?: string, commercial?: boolean, commercialReason?: string, intakeScope?: string, scope?: string, keepOnFail?: boolean, fetch?: Function, lookup?: Function, githubToken?: string}} args
 * @returns {Promise<{allowed: boolean, commit: string, draftPath: string, sizeBytes?: number}>}
 */
export async function intake(args) {
  const { repoUrl, license, kind, name, owner } = args;
  const repoRoot = args.repoRoot || process.cwd();
  if (!repoUrl) throw new Error('intake: repoUrl is required');
  if (!license) throw new Error('intake: license is required');
  if (!name) throw new Error('intake: --name is required');

  let cloneDir = null;      // fetchUpstream temp dir (vendored scope only)
  let draftPath = null;     // scaffold product _drafts/third-party/<name>/
  try {
    // 1. Fetch upstream metadata.
    //    P1-A: reference scope uses fetchRemoteMeta (API, no clone);
    //    vendored/full scope uses fetchUpstream (clone, 50MB cap).
    const scope = args.scope || 'full';
    let commit;
    let sizeBytes = null;
    if (scope === 'reference') {
      const { fetchRemoteMeta } = await import('./intake-remote.mjs');
      const meta = await fetchRemoteMeta(repoUrl, {
        fetch: args.fetch, execFile: args.execFile, lookup: args.lookup,
        githubToken: args.githubToken,
      });
      commit = meta.commit;
      // reference scope doesn't clone, so no cloneDir to clean up.
      // license comes from meta or args; checkLicense still runs.
      const lic = await checkLicense(meta.license || license, args);
      if (!lic.allowed) {
        throw new Error(`intake: license "${meta.license || license}" not allowed — ${lic.reason}`);
      }

      // 3. Scaffold a third-party draft.
      const { scaffold } = await import('./new-capability.mjs');
      const { destPath } = scaffold({
        kind, slug: 'third-party', name, thirdParty: repoUrl,
        root: repoRoot, templatesDir: DEFAULT_TEMPLATES,
      });
      draftPath = destPath;

      // 4. Write the upstream-ref record (§12.1, Phase 2.6 schema).
      const ref = {
        repo: repoUrl,
        commit,
        license: lic.spdx || meta.license || license,
        intaked_at: new Date().toISOString(),
        intaked_by: owner || 'unknown',
        commercial: !!args.commercial,
        ...(args.commercial && args.commercialReason ? { commercial_reason: args.commercialReason } : (args.commercial ? { commercial_reason: 'commercial use declared' } : {})),
        intake_scope: scope,
        install_hint: `${repoUrl};${kind};${name}`,
      };
      atomicWriteSync(path.join(destPath, 'upstream-ref.json'), JSON.stringify(ref, null, 2));

      return { allowed: true, commit, draftPath: destPath, sizeBytes: null };
    }

    // vendored / full scope: clone the upstream.
    const fetched = await fetchUpstream(repoUrl, {
      execFile: args.execFile, dest: args.dest,
    });
    cloneDir = fetched.dir;
    commit = fetched.commit;
    sizeBytes = fetched.sizeBytes;

    // 2. Check license against §12.2 allow-list (+ LLM assist for unknown).
    const lic = await checkLicense(license, args);
    if (!lic.allowed) {
      throw new Error(`intake: license "${license}" not allowed — ${lic.reason}`);
    }

    // 3. Scaffold a third-party draft via new-capability.mjs.
    const { scaffold } = await import('./new-capability.mjs');
    const { destPath } = scaffold({
      kind, slug: 'third-party', name, thirdParty: repoUrl,
      root: repoRoot, templatesDir: DEFAULT_TEMPLATES,
    });
    draftPath = destPath;

    // 4. Write the upstream-ref record (§12.1, Phase 2.6 schema).
    const ref = {
      repo: repoUrl,
      commit,
      license: lic.spdx || license,
      intaked_at: new Date().toISOString(),
      intaked_by: owner || 'unknown',
      commercial: !!args.commercial,
      ...(args.commercial && args.commercialReason ? { commercial_reason: args.commercialReason } : (args.commercial ? { commercial_reason: 'commercial use declared' } : {})),
      intake_scope: args.intakeScope || 'vendored',
    };
    atomicWriteSync(path.join(destPath, 'upstream-ref.json'), JSON.stringify(ref, null, 2));

    return { allowed: true, commit, draftPath: destPath, sizeBytes };
  } catch (e) {
    // P0-C: failure rollback — clean up the clone temp dir + draft half-product
    // (unless --keep-on-fail is set for debugging).
    if (!args.keepOnFail) {
      if (cloneDir) {
        try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
      if (draftPath) {
        try { fs.rmSync(draftPath, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }
    throw e; // re-throw — let CLI / caller report the error
  }
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/intake.mjs --repo <https-url> --license <SPDX> --kind <kind> --name <name> [--owner <o>] [--commercial --commercial-reason <txt>]');
    process.exit(2);
  }
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  try {
    const r = await intake({
      repoUrl: args.repo, license: args.license, kind: args.kind || 'agent',
      name: args.name, owner: args.owner,
      commercial: args.commercial === true, commercialReason: args['commercial-reason'],
      repoRoot: process.cwd(),
    });
    console.log(`intaked: ${r.draftPath} @${r.commit} (${r.sizeBytes} bytes)`);
    process.exit(0);
  } catch (e) {
    console.error(`intake failed: ${e.message}`);
    process.exit(1);
  }
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('intake.mjs');
if (invokedDirect) { main().catch((e) => { console.error(e); process.exit(1); }); }
