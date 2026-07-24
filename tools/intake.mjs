// tools/intake.mjs — Phase 3.4: end-to-end third-party intake orchestrator.
// Orchestrates intake-fetch (clone) + intake-license (check) + new-capability
// (scaffold a third-party draft) + writes an upstream-ref record (§12.1).
// No new deps; built-in fetch + injectable exec for tests.
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
 * @param {{repoUrl: string, license: string, kind: string, name: string, owner: string, repoRoot?: string, execFile?: Function, dest?: string, commercial?: boolean, commercialReason?: string, intakeScope?: string}} args
 * @returns {Promise<{allowed: boolean, commit: string, draftPath: string}>}
 */
export async function intake(args) {
  const { repoUrl, license, kind, name, owner } = args;
  const repoRoot = args.repoRoot || process.cwd();
  if (!repoUrl) throw new Error('intake: repoUrl is required');
  if (!license) throw new Error('intake: license is required');
  if (!name) throw new Error('intake: --name is required');

  // 1. Fetch upstream (https-only, SSRF + shell-metachar reject, git clone --depth 1, 50MB cap).
  // N2: execFile argv form (no shell).
  const { dir, commit, sizeBytes } = await fetchUpstream(repoUrl, {
    execFile: args.execFile, dest: args.dest,
  });

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
