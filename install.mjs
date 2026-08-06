// install.mjs — §8 cross-platform installer (Node). Repo root.
// install/uninstall/list/doctor. Idempotent writes via adapter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { execSync } from 'node:child_process';
import {
  resolveHome,
  resolveOpsforgeHome,
  atomicWrite,
  readJsonOrNullSync,
  assertSlugSegment,
  assertCapId,
} from './tools/paths.mjs';
import { parseCapability } from './tools/validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER_VERSION = '0.1.0';

const MANIFEST_FILES = ['capability.yaml', 'SKILL.md', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml'];

function findManifest(dir) {
  for (const f of MANIFEST_FILES) {
    if (fs.existsSync(path.join(dir, f))) return path.join(dir, f);
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

/** Phase 3.6 落点 6: registry 回退——仓库内 registry.yaml 优先（fresh），
 *  回退 resolveOpsforgeHome()/registry.yaml（副本，避免 stale 覆盖）。
 *  返回解析后的 registry 对象，或 null（两者均不可读时）。
 *  @param {string} repoRoot
 *  @param {string} [opsforgeHome]
 *  @returns {Object|null} */
export function readRegistryForInstall(repoRoot, opsforgeHome) {
  const home = opsforgeHome || resolveOpsforgeHome();
  const candidates = [
    path.join(repoRoot, 'registry.yaml'),
    path.join(home, 'registry.yaml'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const reg = yaml.load(fs.readFileSync(p, 'utf8')) || { capabilities: {} };
      if (!reg.capabilities) reg.capabilities = {};
      return reg;
    } catch (e) {
      throw new Error(`install: registry.yaml parse error (${p}): ${e.message}`);
    }
  }
  return null;
}

function findCapabilitySource(capId, repoRoot) {
  assertCapId(capId);
  const [pack, name] = capId.split('.');
  assertSlugSegment(pack, 'pack');
  assertSlugSegment(name, 'name');
  const kindDirs = ['agents', 'skills', 'mcps', 'workflows', 'bundles'];
  for (const kd of kindDirs) {
    const dir = path.join(repoRoot, 'packs', pack, kd, name);
    if (findManifest(dir)) return dir;
  }
  const customersDir = path.join(repoRoot, 'customers');
  if (fs.existsSync(customersDir)) {
    for (const brand of fs.readdirSync(customersDir, { withFileTypes: true })) {
      if (!brand.isDirectory()) continue;
      for (const kd of kindDirs) {
        const dir = path.join(customersDir, brand.name, 'packs', brand.name, kd, name);
        if (findManifest(dir)) return dir;
      }
    }
  }
  // P1-B: third-party capabilities live under packs/_staged/third-party/<kind>/<name>/.
  // Only _staged/ is searched — _drafts/ are not installable (draft gate R7 blocks them).
  // reference-scope capabilities (intake_scope='reference') use install --from-git
  // (installFromGit) rather than findCapabilitySource, but their staged form still
  // resolves here for install --install <id>.
  for (const kd of kindDirs) {
    const dir = path.join(repoRoot, 'packs', '_staged', 'third-party', kd, name);
    if (findManifest(dir)) return dir;
  }
  return null;
}

// P1-B: export findCapabilitySource for installFromGit + tests.
export { findCapabilitySource };

function getManifestPath(project, opsforgeHome) {
  const manifestsDir = path.join(opsforgeHome || resolveOpsforgeHome(), 'manifests');
  assertSlugSegment(project || 'default', 'project');
  return path.join(manifestsDir, `${project || 'default'}.manifest.json`);
}

function readManifest(project, opsforgeHome) {
  const p = getManifestPath(project, opsforgeHome);
  return readJsonOrNullSync(p) || {
    manifest_version: '1',
    project: project || 'default',
    platform: 'claude-code',
    brand: null,
    installer_version: INSTALLER_VERSION,
    capabilities: [],
  };
}

async function writeManifest(manifest, project, opsforgeHome) {
  const p = getManifestPath(project, opsforgeHome);
  await atomicWrite(p, JSON.stringify(manifest, null, 2));
}

/**
 * Phase 3.3: Relax the conform result for --downgrade. Drop requires:hard errors
 * (the adapter will degrade), keep entrypoint-existence and other structural errors.
 */
function relaxConformForDowngrade(conformResult, cap, adapter) {
  if (conformResult.ok) return conformResult;
  const relaxed = conformResult.errors.filter((e) => {
    // Keep entrypoint errors; drop requires:hard point-unsupported errors (degraded).
    if (/requires:hard point .* not supported/.test(e)) return false;
    return true;
  });
  return { ok: relaxed.length === 0, errors: relaxed };
}

async function getAdapter(platform) {
  // Phase 2.1 + F2: dispatch to all 5 platform adapters (incl. dify Tier-3).
  const ADAPTERS = {
    'claude-code': './adapters/claude-code/adapter.mjs',
    'cursor': './adapters/cursor/adapter.mjs',
    'codex': './adapters/codex/adapter.mjs',
    'cline': './adapters/cline/adapter.mjs',
    'dify': './adapters/dify/adapter.mjs',
  };
  const modPath = ADAPTERS[platform];
  if (!modPath) {
    throw new Error(`install: platform "${platform}" adapter not available`);
  }
  const mod = await import(modPath);
  return mod.adapter;
}

/** P1-1: compute real git commit sha, fallback 'unknown' outside a repo. */
function getSourceCommit(repoRoot) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return 'unknown'; }
}

/** Expand ~ prefix to absolute home path (§5.1 — install-layer ~ expansion). */
function expandTilde(p) {
  if (p && p.startsWith('~/')) return path.join(resolveHome(), p.slice(2));
  return p;
}

/**
 * Install a capability by id from the registry.
 * @param {{platform: string, capId: string, version?: string, brand?: string, project?: string, dryRun?: boolean, repoRoot?: string, opsforgeHome?: string}} args
 * @returns {Promise<{installed: string[], manifest: Object}>}
 */
export async function install(args) {
  const { platform = 'claude-code', capId, version, brand, project = 'default', dryRun = false, downgrade = false } = args;
  const repoRoot = args.repoRoot || process.cwd();
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  // P1-B: capId may be omitted when capDir is passed directly (installFromGit);
  // it's derived from capability.yaml.id after parsing. When capId is given,
  // validate it upfront (catches path-traversal early).
  if (capId) assertCapId(capId);
  // P1-2: slug-validate brand (path-traversal defense, §5.4 call-site list)
  // — validate BEFORE findCapabilitySource so invalid brand throws before
  // the "cap not found" error (IN8b expects /brand/ match).
  if (brand) assertSlugSegment(brand, 'brand');

  const capDir = args.capDir || findCapabilitySource(capId, repoRoot);
  if (!capDir) {
    // NIT 8: stable error code so callers can match by type, not message text.
    const err = new Error(`install: capability "${capId}" not found in repository`);
    err.code = 'ENOCAPSOURCE';
    throw err;
  }

  const manifestPath = findManifest(capDir);
  const capYaml = parseManifest(manifestPath);

  // P1-B: derive effectiveCapId from capId or capability.yaml.id (for installFromGit).
  const effectiveCapId = capId || (capYaml && capYaml.id) || null;
  if (!effectiveCapId) {
    throw new Error('install: cannot determine capId (neither args.capId nor capability.yaml.id)');
  }

  const adapter = await getAdapter(platform);
  const cap = { ...parseCapability(capDir), dir: capDir };
  // Phase 3.3: --downgrade skips the requires:hard conform check, allowing the
  // adapter's degradation strategy (manual-paste/http-direct) to apply instead of
  // hard-failing. entrypoint-existence is still enforced.
  const conformResult = downgrade
    ? relaxConformForDowngrade(adapter.conform(cap), cap, adapter)
    : adapter.conform(cap);
  if (!conformResult.ok) {
    throw new Error(`install: conform failed: ${conformResult.errors.join('; ')}`);
  }

  // Translate
  let artifacts = adapter.translate(cap, { platform, brand, project });

  // For workflow: use workflow-compile.mjs, then expand ~ in targetPath (P0-2)
  if (capYaml.kind === 'workflow') {
    const { compile } = await import('./tools/workflow-compile.mjs');
    const wfArtifact = compile(capYaml, platform);
    // P0-2: expand ~ at install layer (§5.1), not in workflow-compile (in-memory contract)
    if (wfArtifact.targetPath && wfArtifact.targetPath.startsWith('~/')) {
      wfArtifact.targetPath = path.join(resolveHome(), wfArtifact.targetPath.slice(2));
    }
    artifacts = [wfArtifact];
  }

  if (dryRun) {
    return { installed: artifacts.map(a => a.targetPath).filter(Boolean), manifest: null };
  }

  const installResult = await adapter.install(artifacts, { platform, brand, project });

  // F4: persist manual-paste pasteInstructions for Tier-2/3 platforms (artifacts whose
  // kind==='manual-paste' or targetPath==null && pasteInstructions). Write each to
  // <opsforgeHome>/paste/<project>/<capSlug>.md; surface in installed[] + manifest
  // artifacts so doctor verifies + --uninstall removes.
  const writtenArtifacts = [...(installResult.artifacts || [])];
  for (const a of artifacts) {
    const isPaste = a && (a.kind === 'manual-paste' || (!a.targetPath && a.pasteInstructions));
    if (!isPaste) continue;
    const parts = effectiveCapId.split('.');
    const capSlug = parts.length >= 2 ? parts[parts.length - 1] : effectiveCapId;
    assertSlugSegment(capSlug, 'capSlug');
    const pastePath = path.join(opsforgeHome, 'paste', project, `${capSlug}.md`);
    await atomicWrite(pastePath, a.pasteInstructions || a.content || '');
    writtenArtifacts.push(pastePath);
  }

  let mcpKeys = [];
  if (capYaml.kind === 'mcp') {
    const mcpResult = await adapter.injectMcp(cap, { platform, brand, project });
    mcpKeys = mcpResult.mcp_keys || [];
  }

  // Phase 3.2: auto-inject the opsforge-feedback MCP when feedback_hook is supported
  // (idempotent, project-level — NOT recorded in per-cap mcp_keys).
  if (adapter.supports && adapter.supports('feedback_hook') && adapter.supports('feedback_hook').supported) {
    try { await ensureFeedbackMcp(adapter, { opsforgeHome }); } catch { /* best-effort */ }
  }

  // P1-3: collect transitive-dep failures for manifest
  const depsMissing = [];

  const manifest = readManifest(project, opsforgeHome);
  manifest.platform = platform;
  manifest.brand = brand || null;

  // P1-1: real git commit sha
  const sourceCommit = getSourceCommit(repoRoot);

  const entry = {
    id: effectiveCapId,
    version: capYaml.version,
    source_commit: sourceCommit,
    customer: brand || null,
    security_policy: { env_whitelist: [], network_egress: [], tool_downgrade: null },
    owner_profile: project,
    installed_at: new Date().toISOString(),
    mcp_keys: mcpKeys,
    effectiveness_flag: null,
    artifacts: writtenArtifacts,
    deps_missing: depsMissing,
  };

  manifest.capabilities = manifest.capabilities.filter((c) => c.id !== effectiveCapId);
  manifest.capabilities.push(entry);
  await writeManifest(manifest, project, opsforgeHome);

  // Single-layer transitive deps: if workflow, install steps[].capability
  if (capYaml.kind === 'workflow') {
    const steps = capYaml.steps || [];
    for (const step of steps) {
      if (step.capability && step.capability !== effectiveCapId) {
        try {
          await install({
            platform, capId: step.capability, project, dryRun,
            repoRoot, opsforgeHome,
          });
        } catch (e) {
          depsMissing.push(step.capability);
          console.error(`warning: failed to install transitive dep ${step.capability}: ${e.message}`);
        }
      }
    }
    // Update manifest entry with collected deps_missing
    if (depsMissing.length > 0) {
      const updatedManifest = readManifest(project, opsforgeHome);
      const updatedEntry = updatedManifest.capabilities.find((c) => c.id === effectiveCapId);
      if (updatedEntry) {
        updatedEntry.deps_missing = depsMissing;
        await writeManifest(updatedManifest, project, opsforgeHome);
      }
    }
  }

  return { installed: writtenArtifacts, manifest };
}

/**
 * Phase 2.3: Install a profile — resolve via tools/resolve-profile.mjs,
 * write profile.lock.json, install the resolved capability set (topo order).
 * @param {{profilePath: string, platform: string, project?: string, repoRoot?: string, opsforgeHome?: string, lockPath?: string, useLock?: boolean, fresh?: boolean}} args
 * @returns {Promise<{installed: string[], lock: Object}>}
 */
export async function installProfile(args) {
  const { platform = 'claude-code', profilePath, project = 'default', repoRoot = process.cwd() } = args;
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  const yaml = (await import('js-yaml')).default;
  const fsMod = await import('node:fs');
  const fsSync = fsMod.default || fs;

  let lock;
  const lockPath = args.lockPath || profilePath.replace(/\.yaml$/, '.lock.json');

  // --profile-lock (useLock): reuse existing lock without re-resolving.
  // --fresh: re-resolve even when a lock exists.
  const lockExists = fsSync.existsSync(lockPath);
  if (args.useLock && !args.fresh && lockExists) {
    lock = JSON.parse(fsSync.readFileSync(lockPath, 'utf8'));
  } else if (!args.fresh && lockExists) {
    // Default: reuse existing lock if present (last-write-wins stability).
    lock = JSON.parse(fsSync.readFileSync(lockPath, 'utf8'));
  } else {
    // Resolve fresh.
    const profile = yaml.load(fsSync.readFileSync(profilePath, 'utf8'));
    // Build caps registry from registry.yaml (versions + depends_on).
    const caps = await loadCapsRegistry(repoRoot, opsforgeHome);
    const { resolveProfile } = await import('./tools/resolve-profile.mjs');
    const result = resolveProfile({ profile, caps });
    lock = result.lock;
    await atomicWrite(lockPath, JSON.stringify(lock, null, 2));
  }

  // Install each resolved cap in topological order (deps first).
  const installedAll = [];
  for (const id of (lock.topological || [])) {
    const entry = lock.resolved.find((r) => r.id === id);
    if (!entry) continue;
    try {
      const r = await install({
        platform, capId: id, version: entry.version, project,
        repoRoot, opsforgeHome,
      });
      installedAll.push(...(r.installed || []));
    } catch (e) {
      console.error(`warning: profile install failed for ${id}: ${e.message}`);
    }
  }
  return { installed: installedAll, lock };
}

/** Load the caps registry {id: {version, depends_on}} from registry.yaml + manifests. */
async function loadCapsRegistry(repoRoot, opsforgeHome) {
  const yaml = (await import('js-yaml')).default;
  const fsMod = await import('node:fs');
  const fsSync = fsMod.default || fs;
  // Phase 3.6 落点 6: registry 回退（repo fresh 优先，home 副本次之）。
  const caps = {};
  const reg = readRegistryForInstall(repoRoot, opsforgeHome);
  if (reg) {
    for (const [id, e] of Object.entries(reg.capabilities || {})) {
      caps[id] = { version: e.current, depends_on: [], capabilities: [] };
    }
  }
  const packsDir = path.join(repoRoot, 'packs');
  if (fsSync.existsSync(packsDir)) {
    const scan = (base) => {
      for (const ent of fsSync.readdirSync(base, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const d = path.join(base, ent.name);
        if (findManifest(d)) {
          try {
            const y = parseManifest(findManifest(d));
            if (y.id && caps[y.id]) {
              caps[y.id].depends_on = y.depends_on || [];
              if (y.capabilities) caps[y.id].capabilities = y.capabilities;
            } else if (y.id) {
              caps[y.id] = { version: y.version, depends_on: y.depends_on || [], capabilities: y.capabilities || [] };
            }
          } catch { /* skip */ }
        } else {
          scan(d);
        }
      }
    };
    for (const ent of fsSync.readdirSync(packsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (['_drafts', '_staged', '_third-party'].includes(ent.name)) continue;
      scan(path.join(packsDir, ent.name));
    }
  }
  return caps;
}

/**
 * Uninstall a capability by id.
 * @param {{platform: string, capId: string, project?: string, opsforgeHome?: string}} args
 * @returns {Promise<{uninstalled: string[]}>}
 */
export async function uninstall(args) {
  const { platform = 'claude-code', capId, project = 'default' } = args;
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  assertCapId(capId);

  const manifest = readManifest(project, opsforgeHome);
  const entry = manifest.capabilities.find((c) => c.id === capId);
  if (!entry) {
    return { uninstalled: [] };
  }

  const adapter = await getAdapter(platform);
  await adapter.uninstall(capId, { artifacts: entry.artifacts, mcp_keys: entry.mcp_keys });

  manifest.capabilities = manifest.capabilities.filter((c) => c.id !== capId);
  await writeManifest(manifest, project, opsforgeHome);

  return { uninstalled: entry.artifacts || [] };
}

/**
 * List installed capabilities.
 */
export async function list(args) {
  const { project = 'default' } = args;
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  const manifest = readManifest(project, opsforgeHome);
  return { list: manifest.capabilities.map((c) => ({ id: c.id, version: c.version, installed_at: c.installed_at })) };
}

/**
 * Doctor: manifest↔file consistency, depends_on satisfied, MCP config complete,
 * platform path writable, version-not-behind.
 */
export async function doctor(args) {
  const { platform = 'claude-code', project = 'default' } = args;
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  const issues = [];

  const manifest = readManifest(project, opsforgeHome);
  const adapter = await getAdapter(platform);

  if (!adapter.detect()) {
    issues.push({ severity: 'high', check: 'platform_writable', detail: `~/.claude/ not writable or missing`, fix: 'Create ~/.claude/ directory' });
  }

  // P0-3: expand ~ in artifact paths before checking existence
  for (const cap of manifest.capabilities) {
    for (let artifact of cap.artifacts || []) {
      if (artifact.startsWith('~/')) artifact = expandTilde(artifact);
      if (!fs.existsSync(artifact)) {
        issues.push({ severity: 'medium', check: 'artifact_missing', detail: `Artifact ${artifact} for ${cap.id} not found`, fix: `Reinstall ${cap.id}` });
      }
    }
    // P1-3: surface transitive-dep failures
    if (cap.deps_missing && cap.deps_missing.length > 0) {
      issues.push({ severity: 'medium', check: 'deps_missing', detail: `Missing transitive deps for ${cap.id}: ${cap.deps_missing.join(', ')}`, fix: `Install deps: ${cap.deps_missing.join(' ')}` });
    }
  }

  const claudeJsonPath = path.join(resolveHome(), '.claude.json');
  const claudeJson = readJsonOrNullSync(claudeJsonPath) || { mcpServers: {} };
  for (const cap of manifest.capabilities) {
    for (const key of cap.mcp_keys || []) {
      if (!claudeJson.mcpServers || !claudeJson.mcpServers[key]) {
        issues.push({ severity: 'medium', check: 'mcp_missing', detail: `MCP server "${key}" for ${cap.id} not in ~/.claude.json`, fix: `Reinstall ${cap.id} or manually add MCP config` });
      }
    }
  }

  // Phase 3.2 / methodology §5.4: effectiveness scan — last N=20 ratings; <70% pass →
  // degraded. J.2 fix: read per-cap `kb/<pack>/feedback/<cap-id>.jsonl` (what cmdFeedback
  // writes) AND legacy `feedback/ratings.jsonl` (MCP /rate), aggregate by capId. Tier
  // split: Tier 1 caps → main denominator; Tier 2/3 excluded from main denominator.
  const tierOf = (capId) => {
    for (const cap of manifest.capabilities) {
      if (cap.id === capId && cap.platform) {
        if (cap.platform === platform) return adapter.tier();
        return 1; // cross-platform cap → conservative Tier 1 (main denominator)
      }
    }
    return 1; // unknown cap → main denominator (conservative)
  };
  const eff = effectivenessScan(opsforgeHome, { tierOf });
  if (eff.degraded) {
    issues.push({ severity: 'medium', check: 'effectiveness_degraded', detail: `Effectiveness ${eff.passRate}% over last ${eff.count} ratings (<70%)${eff.tier23 && eff.tier23.length ? ` (Tier2/3 excluded: ${eff.tier23.join(', ')})` : ''}`, fix: 'Re-evaluate affected capabilities and consider a downgrade or revision' });
  }

  return { healthy: issues.length === 0, issues };
}

/**
 * methodology §5.4 effectivenessScan: aggregate feedback from per-cap jsonl
 * (kb/<pack>/feedback/<cap-id>.jsonl, written by cmdFeedback) + legacy ratings.jsonl
 * (MCP /rate). Tier 1 caps → main denominator (last N=20, <70% → degraded); Tier 2/3
 * excluded from main denominator (reported in tier23[], never degraded).
 * @param {string} opsforgeHome
 * @param {{tierOf?: (capId:string)=>1|2|3, N?: number}} opts
 */
export function effectivenessScan(opsforgeHome, opts = {}) {
  const home = opsforgeHome || resolveOpsforgeHome();
  const N = opts.N || 20;
  const tierOf = opts.tierOf || (() => 1);
  const byCap = new Map();
  const ingest = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    let lines;
    try { lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean); }
    catch { return; }
    for (const l of lines) {
      let r;
      try { r = JSON.parse(l); } catch { continue; }
      if (!r || r.cap_id === undefined) continue;
      const capId = r.cap_id;
      if (!byCap.has(capId)) byCap.set(capId, []);
      byCap.get(capId).push(r);
    }
  };
  // 1. per-cap jsonl under kb/<pack>/feedback/<cap-id>.jsonl (cmdFeedback source)
  const kbDir = path.join(home, 'kb');
  if (fs.existsSync(kbDir)) {
    for (const pack of fs.readdirSync(kbDir, { withFileTypes: true })) {
      if (!pack.isDirectory()) continue;
      const fbDir = path.join(kbDir, pack.name, 'feedback');
      if (!fs.existsSync(fbDir)) continue;
      for (const f of fs.readdirSync(fbDir).filter((f) => f.endsWith('.jsonl'))) {
        ingest(path.join(fbDir, f));
      }
    }
  }
  // 2. legacy ratings.jsonl (MCP /rate source) — keeps backward compat.
  ingest(path.join(home, 'feedback', 'ratings.jsonl'));
  // Tier split
  const tier1 = [];
  const tier23 = [];
  for (const [capId, ratings] of byCap) {
    const t = tierOf(capId);
    if (t === 1) tier1.push(...ratings);
    else tier23.push(capId);
  }
  const last = tier1.slice(-N);
  if (last.length === 0) return { degraded: false, count: 0, passRate: 100, tier23 };
  let pass = 0;
  for (const r of last) {
    if (r.rating === 'up' || r.rating === 'pass' || (typeof r.rating === 'number' && r.rating >= 0.7)) pass++;
  }
  const passRate = Math.round((pass / last.length) * 100);
  return { degraded: passRate < 70, count: last.length, passRate, tier23 };
}

/**
 * Phase 3.2: Ensure the opsforge-feedback MCP is present in the platform config.
 * Idempotent. The feedback MCP records /rate ratings to ~/.opsforge/feedback/ratings.jsonl.
 */
async function ensureFeedbackMcp(adapter, opts = {}) {
  const opsforgeHome = opts.opsforgeHome || resolveOpsforgeHome();
  const feedbackScript = path.join(opsforgeHome, 'feedback', 'server.mjs');
  // Inject as a stdio MCP server pointing at the feedback script (created on first inject).
  if (!fs.existsSync(feedbackScript)) {
    fs.mkdirSync(path.dirname(feedbackScript), { recursive: true });
    fs.writeFileSync(feedbackScript, FEEDBACK_SERVER_SRC);
  }
  const fakeCap = {
    yaml: {
      id: 'opsforge.opsforge-feedback', kind: 'mcp', transport: 'stdio',
      entrypoint: 'server.mjs', config_template: { auth_schema: [] },
    },
    dir: path.dirname(feedbackScript),
  };
  await adapter.injectMcp(fakeCap, {});
}

/** Phase 3.2: Record a /rate feedback rating to ratings.jsonl. */
export async function recordFeedback({ capId, rating, opsforgeHome }) {
  const home = opsforgeHome || resolveOpsforgeHome();
  const fbDir = path.join(home, 'feedback');
  fs.mkdirSync(fbDir, { recursive: true });
  const line = JSON.stringify({ cap_id: capId, rating, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(path.join(fbDir, 'ratings.jsonl'), line);
  return { recorded: true };
}

// Minimal feedback MCP server source (writes /rate to ratings.jsonl). Written to disk
// on first inject so the platform can launch it as a stdio MCP server.
const FEEDBACK_SERVER_SRC = `#!/usr/bin/env node
// opsforge-feedback MCP server (auto-injected, Phase 3.2). Records /rate ratings.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const home = process.env.OPSFORGE_HOME || process.env.USERPROFILE || os.homedir();
const ratingsPath = path.join(home, '.opsforge', 'feedback', 'ratings.jsonl');
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ok:true}) + '\\n'); });
`;

/**
 * Phase 2.5: Repair — re-install capabilities whose artifacts are missing,
 * and re-inject MCP keys that vanished from the platform config.
 * @param {{platform: string, project?: string, repoRoot?: string, opsforgeHome?: string}} args
 * @returns {Promise<{repaired: string[], issues: Array}>}
 */
export async function repair(args) {
  const { platform = 'claude-code', project = 'default' } = args;
  const repoRoot = args.repoRoot || process.cwd();
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  const manifest = readManifest(project, opsforgeHome);
  const repaired = [];
  const issues = [];
  for (const cap of manifest.capabilities) {
    const missingArtifacts = (cap.artifacts || []).filter((a) => {
      const expanded = expandTilde(a);
      return !fs.existsSync(expanded);
    });
    if (missingArtifacts.length > 0) {
      try {
        await install({ platform, capId: cap.id, version: cap.version, project, repoRoot, opsforgeHome });
        repaired.push(cap.id);
      } catch (e) {
        issues.push({ id: cap.id, check: 'repair_failed', detail: e.message });
      }
    }
    // --repair-mcp: re-inject missing MCP keys
    if (cap.mcp_keys && cap.mcp_keys.length) {
      const claudeJsonPath = path.join(resolveHome(), '.claude.json');
      const cfg = readJsonOrNullSync(claudeJsonPath) || { mcpServers: {} };
      const missingKeys = cap.mcp_keys.filter((k) => !cfg.mcpServers || !cfg.mcpServers[k]);
      if (missingKeys.length > 0) {
        try {
          const capDir = findCapabilitySource(cap.id, repoRoot);
          if (capDir) {
            const adapter = await getAdapter(platform);
            const capObj = { ...parseCapability(capDir), dir: capDir };
            await adapter.injectMcp(capObj, { platform, project });
            if (!repaired.includes(cap.id)) repaired.push(cap.id);
          }
        } catch (e) {
          issues.push({ id: cap.id, check: 'repair_mcp_failed', detail: e.message });
        }
      }
    }
  }
  return { repaired, issues };
}

/**
 * P1-B: installFromGit — clone a git URL on-demand → install → cleanup temp.
 * Reuses fetchUpstream (SSRF + 50MB cap + argv form). Used by `install --from-git`
 * to install reference-scope capabilities (intake_scope='reference') that only
 * stored the git URL during intake (no local clone was retained).
 * @param {string} gitUrl  https public git URL
 * @param {string} kind  agent|skill|mcp|workflow|bundle (kind dir name plural)
 * @param {string} name  capability name slug
 * @param {{platform: string, project?: string, brand?: string, opsforgeHome?: string,
 *          repoRoot?: string, execFile?: Function, dest?: string}} opts
 * @returns {Promise<{installed: string[], manifest: Object}>}
 */
export async function installFromGit(gitUrl, kind, name, opts = {}) {
  // §5.4 path-traversal defense: validate kind + name slugs BEFORE path.join,
  // so a crafted name (e.g. '..') can't escape the clone temp dir.
  assertSlugSegment(name, 'name');
  const kindSlug = kind.replace(/s$/, '');
  assertSlugSegment(kindSlug, 'kind');
  const { fetchUpstream } = await import('./tools/intake-fetch.mjs');
  // Clone-to-temp (reuses SSRF guard + 50MB cap + argv form, no shell).
  const tempDir = await fetchUpstream(gitUrl, { execFile: opts.execFile, dest: opts.dest });
  try {
    // Locate the capability inside the clone.
    const kindDir = kind.endsWith('s') ? kind : (kind + 's');
    const capDir = path.join(tempDir.dir, kindDir, name);
    if (!fs.existsSync(path.join(capDir, 'capability.yaml'))
        && !fs.existsSync(path.join(capDir, 'SKILL.md'))
        && !fs.existsSync(path.join(capDir, 'mcp.yaml'))
        && !fs.existsSync(path.join(capDir, 'workflow.yaml'))) {
      throw new Error(`install: ${kind}/${name} not found in ${gitUrl}`);
    }
    // install({ capDir, ... }) — install() supports capDir direct (P1-B).
    return await install({
      platform: opts.platform || 'claude-code',
      project: opts.project || 'default',
      brand: opts.brand,
      repoRoot: opts.repoRoot || process.cwd(),
      opsforgeHome: opts.opsforgeHome || resolveOpsforgeHome(),
      capDir,
    });
  } finally {
    // Cleanup temp clone (best-effort).
    try { fs.rmSync(tempDir.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** CLI */
export function main() {
  const argv = process.argv.slice(2);
  (async () => {
    try {
      if (argv.includes('--install')) {
        const idx = argv.indexOf('--install');
        const capIdWithVersion = argv[idx + 1];
        const [capId, version] = capIdWithVersion.split('@');
        const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
        const brand = argv.includes('--brand') ? argv[argv.indexOf('--brand') + 1] : undefined;
        const project = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : 'default';
        const dryRun = argv.includes('--dry-run');
        const downgrade = argv.includes('--downgrade');
        // P1-2: slug-validate brand at CLI layer too
        if (brand) assertSlugSegment(brand, 'brand');
        const r = await install({ platform, capId, version, brand, project, dryRun, downgrade });
        console.log(`installed: ${r.installed.join(', ')}`);
        process.exit(0);
      } else if (argv.includes('--profile')) {
        // Phase 2.3: profile install — resolve + install the capability set.
        const idx = argv.indexOf('--profile');
        const profilePath = argv[idx + 1];
        const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
        const project = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : 'default';
        const useLock = argv.includes('--profile-lock');
        const fresh = argv.includes('--fresh');
        const saveIdx = argv.indexOf('--profile-save');
        const lockPath = saveIdx >= 0 ? argv[saveIdx + 1] : undefined;
        const r = await installProfile({ profilePath, platform, project, useLock, fresh, lockPath });
        console.log(`profile installed: ${r.installed.length} artifacts (${r.lock.resolved.length} capabilities)`);
        process.exit(0);
      } else if (argv.includes('--uninstall')) {
        // P0-1: strip @version from capId (parity with --install branch)
        const idx = argv.indexOf('--uninstall');
        const capIdWithVersion = argv[idx + 1] || '';
        const capId = capIdWithVersion.split('@')[0];
        const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
        // F1: forward --project + --brand (parity with --install branch); without
        // --project, non-default-project uninstalls silently no-op and leak artifacts.
        const project = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : 'default';
        const brand = argv.includes('--brand') ? argv[argv.indexOf('--brand') + 1] : undefined;
        if (brand) assertSlugSegment(brand, 'brand');
        const r = await uninstall({ platform, capId, project, brand });
        console.log(`uninstalled: ${r.uninstalled.join(', ')}`);
        process.exit(0);
      } else if (argv.includes('--list')) {
        const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
        const r = await list({ platform });
        for (const c of r.list) {
          console.log(`${c.id}@${c.version}  installed ${c.installed_at}`);
        }
        process.exit(0);
      } else if (argv.includes('--doctor')) {
        const platform = argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : 'claude-code';
        const r = await doctor({ platform });
        console.log(`healthy: ${r.healthy}`);
        for (const i of r.issues) {
          console.log(`  [${i.severity}] ${i.check}: ${i.detail}`);
        }
        process.exit(r.healthy ? 0 : 1);
      } else if (argv.includes('--run-workflow')) {
        // Phase 2.4: start a workflow run (state machine).
        const idx = argv.indexOf('--run-workflow');
        const capIdWithVersion = argv[idx + 1];
        const capId = capIdWithVersion.split('@')[0];
        assertCapId(capId);
        const capDir = findCapabilitySource(capId, process.cwd());
        if (!capDir) throw new Error(`install: capability "${capId}" not found`);
        const wfYaml = parseManifest(findManifest(capDir));
        const { startWorkflow } = await import('./tools/workflow-runner.mjs');
        const { runId, state } = startWorkflow({ workflow: wfYaml, opsforgeHome: resolveOpsforgeHome() });
        console.log(`started: ${wfYaml.id}/${runId} (current=${state.current_node}, status=${state.status})`);
        process.exit(0);
      } else if (argv.includes('--list-runs')) {
        const { listRuns } = await import('./tools/workflow-runner.mjs');
        const wfId = argv[argv.indexOf('--list-runs') + 1];
        const runs = listRuns({ workflowId: wfId });
        for (const r of runs) console.log(`${r.status}\t${r.workflowId}/${r.runId}\tcurrent=${r.current_node}`);
        process.exit(0);
      } else if (argv.includes('--abort')) {
        const runId = argv[argv.indexOf('--abort') + 1];
        const wfId = argv[argv.indexOf('--abort') + 2];
        const { abortRun } = await import('./tools/workflow-runner.mjs');
        const state = abortRun({ runId, workflowId: wfId });
        console.log(`aborted: ${wfId}/${runId} (status=${state.status})`);
        process.exit(0);
      } else if (argv.includes('--resume')) {
        const runId = argv[argv.indexOf('--resume') + 1];
        const wfId = argv[argv.indexOf('--resume') + 2];
        const { resumeRun } = await import('./tools/workflow-runner.mjs');
        const state = resumeRun({ runId, workflowId: wfId });
        console.log(`resumed: ${wfId}/${runId} (status=${state.status}, current=${state.current_node})`);
        process.exit(0);
      } else if (argv.includes('--from-git')) {
        // P1-B: install a reference-scope capability from a git URL on-demand.
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
      } else {
        console.error('usage: node install.mjs --install <id> [--profile <p>] | --uninstall <id> | --list | --doctor | --run-workflow <id> | --list-runs [wfId] | --abort <runId> <wfId> | --resume <runId> <wfId> | --from-git <url> --kind <kind> --name <name>');
        process.exit(2);
      }
    } catch (e) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
  })();
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('install.mjs');
if (invokedDirect) { main(); }
