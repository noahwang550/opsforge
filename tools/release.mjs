// tools/release.mjs — §13.2 / §B.4. Auto-aggregate registry from staged+released caps.
// Gate: validation-report.json verdict=pass AND security-report.json verdict=pass (P1: 2 reports).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import semver from 'semver';
import { execSync } from 'node:child_process';
import { readJsonOrNullSync, assertSlugSegment, atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MANIFEST_FILES = ['capability.yaml', 'SKILL.md', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml'];

function findManifest(dir) {
  for (const f of MANIFEST_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseManifest(manifestPath) {
  let raw = fs.readFileSync(manifestPath, 'utf8');
  if (manifestPath.endsWith('.md')) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (m) raw = m[1];
  }
  return yaml.load(raw, { filename: manifestPath });
}

/**
 * Release a single capability: registers its version in the registry.
 * @param {string} capDir
 * @param {{repoRoot?: string}} [opts]
 * @returns {{registered: boolean, id: string, version: string, reason?: string}}
 */
export function release(capDir, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const manifest = findManifest(capDir);
  if (!manifest) {
    return { registered: false, id: path.basename(capDir), version: '', reason: 'no manifest file found' };
  }
  let parsed;
  try {
    parsed = parseManifest(manifest);
  } catch (e) {
    return { registered: false, id: '', version: '', reason: `manifest parse error: ${e.message}` };
  }
  const id = parsed.id;
  const version = parsed.version;
  if (!id || !version) {
    return { registered: false, id: id || '', version: version || '', reason: 'missing id or version' };
  }
  if (!semver.valid(version)) {
    return { registered: false, id, version, reason: `invalid semver: ${version}` };
  }
  // Gate: check reports if present (P1: absent = warn but allow greenfield seeding)
  const valReport = readJsonOrNullSync(path.join(capDir, 'validation-report.json'));
  if (valReport && valReport.verdict !== 'pass') {
    return { registered: false, id, version, reason: `validation-report verdict: ${valReport.verdict}` };
  }
  const secReport = readJsonOrNullSync(path.join(capDir, 'security-report.json'));
  if (secReport && secReport.verdict !== 'pass') {
    return { registered: false, id, version, reason: `security-report verdict: ${secReport.verdict}` };
  }
  // Phase 2.2: 3-report gate — eval-report. When present, block on fail/block;
  // allow 'pass' and 'pending' (pending = static-only CI can't fully evaluate yet).
  // Absent = allow (greenfield seeding, consistent with the other two reports).
  const evalReport = readJsonOrNullSync(path.join(capDir, 'eval-report.json'));
  if (evalReport && (evalReport.verdict === 'fail' || evalReport.verdict === 'block')) {
    return { registered: false, id, version, reason: `eval-report verdict: ${evalReport.verdict}` };
  }

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { /* no git */ }

  const registryPath = path.join(repoRoot, 'registry.yaml');
  let registry = { capabilities: {} };
  if (fs.existsSync(registryPath)) {
    try { registry = yaml.load(fs.readFileSync(registryPath, 'utf8')) || { capabilities: {} }; } catch { /* fresh */ }
  }
  const changelogIndex = path.relative(repoRoot, path.join(capDir, 'CHANGELOG.md')).split(path.sep).join('/');
  const entry = registry.capabilities[id] || { current: version, history: [], changelog_index: changelogIndex };
  if (!entry.history.find((h) => h.version === version)) {
    entry.history.push({ version, released_at: new Date().toISOString().split('T')[0], commit });
  }
  entry.current = version;
  entry.changelog_index = changelogIndex;
  registry.capabilities[id] = entry;
  atomicWriteSync(registryPath, yaml.dump(registry, { lineWidth: -1 }));
  // D3: advance .opsforge-state.json to "released" so the three-state flow progresses.
  advanceOpsforgeState(capDir, 'released');
  return { registered: true, id, version };
}

/**
 * Advance a capability's .opsforge-state.json to newState (idempotent).
 * Only mutates if a state file already exists (validate/new-capability own creation)
 * and the state actually changes (no duplicate history entries on re-run).
 * D3: release() → 'released'; aggregateAll() → 'registry'.
 */
function advanceOpsforgeState(capDir, newState) {
  const statePath = path.join(capDir, '.opsforge-state.json');
  if (!fs.existsSync(statePath)) return;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch { return; /* unparseable — leave untouched */ }
  const from = state.state;
  if (from === newState) return; // idempotent: no transition, no duplicate history
  state.state = newState;
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({ ts: new Date().toISOString(), from, to: newState, pr: null });
  atomicWriteSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Scan packs/<contributor>/ and customers/<brand>/packs/<brand>/ for capabilities,
 * aggregate into registry.yaml + registry-brands.yaml.
 * P0-5: calls release() per cap so §B.4 gate fires (reports present → gate active).
 * @param {{repoRoot?: string}} [opts]
 * @returns {{registry: Object, registryBrands: Object}}
 */
export function aggregateAll(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const registry = { capabilities: {} };
  const registryBrands = { brands: {} };
  const releasedDirs = []; // D3: track successfully-released caps for state advancement

  // Collect all cap dirs (same scan as validate.mjs scanCapabilities)
  const capDirs = [];

  // Formal dirs: packs/<pack>/ (excluding _drafts/_staged/_third-party)
  const packsDir = path.join(repoRoot, 'packs');
  if (fs.existsSync(packsDir)) {
    for (const packSlug of fs.readdirSync(packsDir, { withFileTypes: true })) {
      if (!packSlug.isDirectory()) continue;
      if (['_drafts', '_staged', '_third-party'].includes(packSlug.name)) continue;
      collectCapDirs(path.join(packsDir, packSlug.name), capDirs);
    }
  }

  // Brand dirs
  const customersDir = path.join(repoRoot, 'customers');
  if (fs.existsSync(customersDir)) {
    for (const brandEnt of fs.readdirSync(customersDir, { withFileTypes: true })) {
      if (!brandEnt.isDirectory()) continue;
      assertSlugSegment(brandEnt.name, 'brand');
      const brandPacksDir = path.join(customersDir, brandEnt.name, 'packs');
      if (!fs.existsSync(brandPacksDir)) continue;
      if (!registryBrands.brands[brandEnt.name]) {
        registryBrands.brands[brandEnt.name] = { capabilities: {} };
      }
      const brandCapDirs = [];
      collectCapDirs(brandPacksDir, brandCapDirs);
      // Call release() per brand cap → gate fires
      for (const cd of brandCapDirs) {
        const r = release(cd, { repoRoot });
        if (r.registered) {
          releasedDirs.push(cd);
          const entry = readRegistryEntry(repoRoot, r.id);
          if (entry) registryBrands.brands[brandEnt.name].capabilities[r.id] = entry;
        }
      }
    }
  }

  // Call release() per general cap → §B.4 gate fires (reports present)
  for (const cd of capDirs) {
    const r = release(cd, { repoRoot });
    if (r.registered) {
      releasedDirs.push(cd);
      const entry = readRegistryEntry(repoRoot, r.id);
      if (entry) registry.capabilities[r.id] = entry;
    }
  }

  // Write aggregated registry files
  atomicWriteSync(path.join(repoRoot, 'registry.yaml'), yaml.dump(registry, { lineWidth: -1 }));
  atomicWriteSync(path.join(repoRoot, 'registry-brands.yaml'), yaml.dump(registryBrands, { lineWidth: -1 }));
  // D3: advance every successfully-released cap to "registry" (final aggregate state).
  for (const cd of releasedDirs) advanceOpsforgeState(cd, 'registry');
  return { registry, registryBrands };
}

/** Read a specific entry from the on-disk registry.yaml (written by release()). */
function readRegistryEntry(repoRoot, id) {
  const regPath = path.join(repoRoot, 'registry.yaml');
  if (!fs.existsSync(regPath)) return null;
  try {
    const reg = yaml.load(fs.readFileSync(regPath, 'utf8')) || { capabilities: {} };
    return reg.capabilities && reg.capabilities[id] ? reg.capabilities[id] : null;
  } catch { return null; }
}

/** Collect capability dirs (dirs containing a manifest file). */
function collectCapDirs(baseDir, out) {
  if (!fs.existsSync(baseDir)) return;
  for (const ent of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(baseDir, ent.name);
    if (findManifest(dir)) {
      out.push(dir);
    } else {
      for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const capDir = path.join(dir, sub.name);
        if (findManifest(capDir)) out.push(capDir);
      }
    }
  }
}

/** CLI: `node tools/release.mjs <capDir> | --all` */
export function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/release.mjs <capDir> | --all');
    process.exit(2);
  }
  if (argv[0] === '--all') {
    const { registry, registryBrands } = aggregateAll({ repoRoot: process.cwd() });
    const count = Object.keys(registry.capabilities || {}).length;
    console.log(`registry: ${count} capabilities`);
    process.exit(0);
  } else {
    const capDir = path.resolve(argv[0]);
    const r = release(capDir, { repoRoot: process.cwd() });
    if (r.registered) {
      console.log(`released: ${r.id}@${r.version}`);
      process.exit(0);
    } else {
      console.error(`not released: ${r.id} — ${r.reason}`);
      process.exit(1);
    }
  }
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('release.mjs');
if (invokedDirect) { main(); }
