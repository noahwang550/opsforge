// tools/resolve-profile.test.mjs — Phase 2.3: composable profile resolver tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, topologicalSort, pickVersion } from './resolve-profile.mjs';

// caps registry fixture: id → { version, depends_on: [id@range], capabilities?: [id] (for bundles) }
function capsFixture() {
  return {
    'foo.bar': { version: '1.2.0', depends_on: ['foo.baz@^1.0.0'] },
    'foo.baz': { version: '1.0.5', depends_on: [] },
    'foo.qux': { version: '2.0.0', depends_on: ['foo.bar@^1.0.0'] },
    'foo.bundle-x': { version: '1.0.0', depends_on: [], capabilities: ['foo.bar@^1.0.0', 'foo.baz@^1.0.0'] },
    'foo.bad': { version: '1.0.0', depends_on: ['foo.missing@^1.0.0'] }, // unresolvable dep
    'foo.cyc1': { version: '1.0.0', depends_on: ['foo.cyc2@^1.0.0'] },
    'foo.cyc2': { version: '1.0.0', depends_on: ['foo.cyc1@^1.0.0'] },
  };
}

// RP1 resolveProfile resolves a direct capability + its transitive dep
test('RP1 resolveProfile resolves direct cap + transitive deps', () => {
  const caps = capsFixture();
  const profile = { profile: 'demo', display_name: 'Demo', display_name_zh: '演示', capabilities: ['foo.bar@^1.0.0'] };
  const { lock } = resolveProfile({ profile, caps });
  const ids = lock.resolved.map((r) => r.id).sort();
  assert.deepEqual(ids, ['foo.bar', 'foo.baz']);
  // baz must come before bar (topo order — bar depends on baz)
  const topo = lock.topological;
  assert.ok(topo.indexOf('foo.baz') < topo.indexOf('foo.bar'), `baz before bar; got ${topo}`);
});

// RP2 resolveProfile expands a bundle into its capabilities
test('RP2 resolveProfile expands bundle capabilities', () => {
  const caps = capsFixture();
  const profile = { profile: 'demo', display_name: 'Demo', display_name_zh: '演示', bundles: ['foo.bundle-x@^1.0.0'] };
  const { lock } = resolveProfile({ profile, caps });
  const ids = lock.resolved.map((r) => r.id).sort();
  assert.deepEqual(ids, ['foo.bar', 'foo.baz']);
});

// RP3 resolveProfile merges direct + bundle + transitive (dedup)
test('RP3 resolveProfile dedups across direct + bundle + deps', () => {
  const caps = capsFixture();
  const profile = {
    profile: 'demo', display_name: 'Demo', display_name_zh: '演示',
    capabilities: ['foo.bar@^1.0.0'], bundles: ['foo.bundle-x@^1.0.0'],
  };
  const { lock } = resolveProfile({ profile, caps });
  const counts = {};
  for (const r of lock.resolved) counts[r.id] = (counts[r.id] || 0) + 1;
  for (const id of Object.keys(counts)) assert.equal(counts[id], 1, `${id} should appear once`);
});

// RP4 pickVersion picks the highest version matching a semver range
test('RP4 pickVersion picks highest matching version', () => {
  const candidates = [{ version: '1.0.0' }, { version: '1.2.0' }, { version: '1.1.0' }];
  assert.equal(pickVersion(candidates, '^1.0.0'), '1.2.0');
  assert.equal(pickVersion(candidates, '~1.0.0'), '1.0.0'); // ~1.0.0 = >=1.0.0 <1.1.0
  assert.equal(pickVersion(candidates, '^2.0.0'), null); // no match
});

// RP5 resolveProfile fails on unresolvable dependency
test('RP5 resolveProfile fails on unresolvable dep', () => {
  const caps = capsFixture();
  const profile = { profile: 'demo', display_name: 'Demo', display_name_zh: '演示', capabilities: ['foo.bad@^1.0.0'] };
  assert.throws(() => resolveProfile({ profile, caps }), /unresolvable|missing|foo.missing/i);
});

// RP6 resolveProfile detects circular dependencies
test('RP6 resolveProfile detects circular deps', () => {
  const caps = capsFixture();
  const profile = { profile: 'demo', display_name: 'Demo', display_name_zh: '演示', capabilities: ['foo.cyc1@^1.0.0'] };
  assert.throws(() => resolveProfile({ profile, caps }), /circular|cycle/i);
});

// RP7 resolveProfile produces a lock with profile name + resolved versions
test('RP7 resolveProfile lock has profile + resolved versions', () => {
  const caps = capsFixture();
  const profile = { profile: 'demo', display_name: 'Demo', display_name_zh: '演示', capabilities: ['foo.bar@^1.0.0'] };
  const { lock } = resolveProfile({ profile, caps });
  assert.equal(lock.profile, 'demo');
  const bar = lock.resolved.find((r) => r.id === 'foo.bar');
  assert.equal(bar.version, '1.2.0');
  const baz = lock.resolved.find((r) => r.id === 'foo.baz');
  assert.equal(baz.version, '1.0.5');
});

// RP8 topologicalSort orders deps before dependents
test('RP8 topologicalSort orders dependencies first', () => {
  const graph = { a: ['b'], b: ['c'], c: [] }; // a depends on b depends on c
  const order = topologicalSort(graph);
  assert.ok(order.indexOf('c') < order.indexOf('b'));
  assert.ok(order.indexOf('b') < order.indexOf('a'));
});

// RP9 Phase 3.1: range intersection — two dependents require overlapping ranges of the same dep.
// foo.bar needs foo.baz@^1.0.0, foo.qux needs foo.baz@>=1.0.5 <2.0.0 → must satisfy BOTH (intersect).
test('RP9 resolveProfile intersects overlapping dep ranges', () => {
  const caps = {
    'foo.bar': { version: '1.2.0', depends_on: ['foo.baz@^1.0.0'] },
    'foo.qux': { version: '1.0.0', depends_on: ['foo.baz@>=1.0.5 <2.0.0'] },
    'foo.baz': { version: '1.0.5', depends_on: [] },
  };
  const profile = { profile: 'demo', display_name: 'D', display_name_zh: 'D', capabilities: ['foo.bar@^1.0.0', 'foo.qux@^1.0.0'] };
  const { lock } = resolveProfile({ profile, caps });
  const ids = lock.resolved.map((r) => r.id).sort();
  assert.deepEqual(ids, ['foo.bar', 'foo.baz', 'foo.qux']);
  // baz 1.0.5 satisfies both ^1.0.0 and >=1.0.5 <2.0.0
  const baz = lock.resolved.find((r) => r.id === 'foo.baz');
  assert.equal(baz.version, '1.0.5');
});

// RP10 Phase 3.1: range intersection fails when ranges are disjoint (unsatisfiable)
test('RP10 resolveProfile fails on disjoint dep ranges', () => {
  const caps = {
    'foo.bar': { version: '1.0.0', depends_on: ['foo.baz@^1.0.0'] },
    'foo.qux': { version: '1.0.0', depends_on: ['foo.baz@^2.0.0'] },
    'foo.baz': { version: '1.0.5', depends_on: [] }, // satisfies ^1.0.0 but not ^2.0.0
  };
  const profile = { profile: 'demo', display_name: 'D', display_name_zh: 'D', capabilities: ['foo.bar@^1.0.0', 'foo.qux@^1.0.0'] };
  assert.throws(() => resolveProfile({ profile, caps }), /does not satisfy|unresolvable|foo.baz/i);
});
