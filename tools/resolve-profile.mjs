// tools/resolve-profile.mjs — Phase 2.3: composable custom installation profiles.
// Expands bundles→workflows→depends_on topo sort→semver pin→profile.lock.json.
// No new deps; uses semver (already a controlled dep).
import semver from 'semver';
import path from 'node:path';
import { atomicWriteSync } from './paths.mjs';

/**
 * Pick the highest version from candidates matching a semver range.
 * @param {Array<{version: string}>} candidates
 * @param {string} range  semver range
 * @returns {string|null}
 */
export function pickVersion(candidates, range) {
  const matching = candidates.filter((c) => semver.satisfies(c.version, range));
  if (matching.length === 0) return null;
  matching.sort((a, b) => semver.compare(b.version, a.version));
  return matching[0].version;
}

/**
 * Topological sort (deps before dependents). graph: {id: [depId...]}.
 * Throws on cycles.
 * @param {Object} graph
 * @returns {string[]}
 */
export function topologicalSort(graph) {
  const visited = new Map(); // id → 'visiting' | 'done'
  const out = [];
  const visit = (id, stack) => {
    if (visited.get(id) === 'done') return;
    if (visited.get(id) === 'visiting') {
      throw new Error(`resolve-profile: circular dependency detected (${[...stack, id].join(' → ')})`);
    }
    visited.set(id, 'visiting');
    for (const dep of (graph[id] || [])) visit(dep, [...stack, id]);
    visited.set(id, 'done');
    out.push(id);
  };
  for (const id of Object.keys(graph)) visit(id, []);
  return out;
}

function splitIdRange(spec) {
  // spec like "foo.bar@^1.0.0" → { id: 'foo.bar', range: '^1.0.0' }
  const idx = spec.lastIndexOf('@');
  if (idx <= 0) return { id: spec, range: '*' };
  return { id: spec.slice(0, idx), range: spec.slice(idx + 1) };
}

/**
 * Resolve a profile into a lock file: expand bundles→capabilities, recursively
 * resolve depends_on, topologically sort, pin versions.
 * @param {{profile: Object, caps: Object}} args  profile = parsed profile.yaml; caps = {id: {version, depends_on[], capabilities?[]}}
 * @returns {{lock: {profile: string, resolved: Array, topological: string[]}}}
 */
export function resolveProfile({ profile, caps }) {
  const direct = new Set();
  const ranges = {}; // id → array of semver ranges (intersected at pin-check time, §3.1)
  const addRange = (id, range) => {
    if (!ranges[id]) ranges[id] = [];
    ranges[id].push(range);
  };
  const viaMap = {};
  const addSpec = (spec, via) => {
    const { id, range } = splitIdRange(spec);
    direct.add(id);
    addRange(id, range);
    if (!viaMap[id]) viaMap[id] = via;
  };

  // 1. Collect direct capabilities + workflow specs (bundles are expanders, not installed).
  for (const spec of (profile.capabilities || [])) addSpec(spec, 'direct');
  for (const spec of (profile.workflows || [])) addSpec(spec, 'direct');
  // bundles handled in step 2 (expand to their capabilities; the bundle id itself is NOT resolved).

  // 2. Expand bundles → their declared capabilities.
  for (const spec of (profile.bundles || [])) {
    const { id, range } = splitIdRange(spec);
    const cap = caps[id];
    if (!cap) throw new Error(`resolve-profile: bundle "${id}" not found in registry`);
    if (!semver.satisfies(cap.version, range)) throw new Error(`resolve-profile: bundle "${id}" version ${cap.version} does not satisfy ${range}`);
    for (const sub of (cap.capabilities || [])) {
      const sr = splitIdRange(sub);
      direct.add(sr.id);
      addRange(sr.id, sr.range);
      if (!viaMap[sr.id]) viaMap[sr.id] = 'bundle';
    }
  }

  // 3. Recursively resolve depends_on (single-layer + transitive closure).
  const resolved = {}; // id → version
  const graph = {}; // id → [depId...]
  const resolveDeps = (id, stack) => {
    if (resolved[id]) return;
    if (stack.includes(id)) throw new Error(`resolve-profile: circular dependency detected (${[...stack, id].join(' → ')})`);
    const cap = caps[id];
    if (!cap) throw new Error(`resolve-profile: capability "${id}" not found in registry (unresolvable)`);
    graph[id] = [];
    for (const depSpec of (cap.depends_on || [])) {
      const { id: depId, range: depRange } = splitIdRange(depSpec);
      graph[id].push(depId);
      addRange(depId, depRange);
      if (!viaMap[depId]) viaMap[depId] = 'dep';
      resolveDeps(depId, [...stack, id]);
    }
    resolved[id] = cap.version; // registry pin (current version)
  };

  for (const id of [...direct]) resolveDeps(id, []);

  // 4. Verify the pinned version satisfies ALL intersected ranges (§3.1 range intersection).
  for (const id of Object.keys(ranges)) {
    const v = resolved[id];
    if (!v) throw new Error(`resolve-profile: "${id}" could not be resolved`);
    for (const range of ranges[id]) {
      if (!semver.satisfies(v, range)) {
        throw new Error(`resolve-profile: "${id}" version ${v} does not satisfy ${range}`);
      }
    }
  }

  // 5. Topological sort.
  const topo = topologicalSort(graph);

  // 6. Build lock.
  const lock = {
    profile: profile.profile,
    display_name: profile.display_name || '',
    resolved: Object.keys(resolved).map((id) => ({ id, version: resolved[id], via: viaMap[id] || 'direct' })),
    topological: topo,
  };
  return { lock };
}

/** Resolve a profile.yaml file + caps registry → write profile.lock.json. */
export async function resolveProfileFile(profilePath, caps, opts = {}) {
  const yaml = (await import('js-yaml')).default;
  const fs = (await import('node:fs')).default;
  const raw = fs.readFileSync(profilePath, 'utf8');
  const profile = yaml.load(raw);
  const { lock } = resolveProfile({ profile, caps });
  const lockPath = opts.lockPath || profilePath.replace(/\.yaml$/, '.lock.json');
  atomicWriteSync(lockPath, JSON.stringify(lock, null, 2));
  return { lock, lockPath };
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/resolve-profile.mjs <profile.yaml>');
    process.exit(2);
  }
  const yaml = (await import('js-yaml')).default;
  const fs = (await import('node:fs')).default;
  const profile = yaml.load(fs.readFileSync(argv[0], 'utf8'));
  const regPath = path.join(process.cwd(), 'registry.yaml');
  let caps = {};
  if (fs.existsSync(regPath)) {
    const reg = yaml.load(fs.readFileSync(regPath, 'utf8')) || { capabilities: {} };
    for (const [id, entry] of Object.entries(reg.capabilities || {})) caps[id] = { version: entry.current, depends_on: [] };
  }
  const { lock, lockPath } = await resolveProfileFile(argv[0], caps);
  console.log(`wrote: ${lockPath} (${lock.resolved.length} capabilities)`);
  process.exit(0);
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('resolve-profile.mjs') && !process.env.NODE_TEST_CONTEXT;
if (invokedDirect) { main().catch((e) => { console.error(e.message); process.exit(1); }); }
