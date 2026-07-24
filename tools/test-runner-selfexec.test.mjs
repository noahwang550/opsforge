// tools/test-runner-selfexec.test.mjs — N1: module must NOT self-execute under node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TR = path.resolve(__dirname, 'test-runner.mjs');

// N1: under `node --test`, NODE_TEST_CONTEXT is set, so invokedDirect must be false
// and main() must NOT run (no usage/exit-1). The module imports cleanly.
test('N1 test-runner.mjs does not self-execute under NODE_TEST_CONTEXT', () => {
  const r = spawnSync(process.execPath, ['--test', TR], {
    env: { ...process.env, NODE_TEST_CONTEXT: 'tap' }, encoding: 'utf8', timeout: 30000,
  });
  // Should NOT print the usage line that main() emits on no args.
  assert.doesNotMatch(r.stdout || '', /usage: node tools\/test-runner\.mjs/, `main() ran under --test; stdout=${r.stdout}`);
  assert.doesNotMatch(r.stderr || '', /usage: node tools\/test-runner\.mjs/, `main() ran under --test; stderr=${r.stderr}`);
});

// N1b: when run directly (no NODE_TEST_CONTEXT), main() still runs and exits 2 on no args.
test('N1b test-runner.mjs runs main() when invoked directly (no NODE_TEST_CONTEXT)', () => {
  const r = spawnSync(process.execPath, [TR], {
    env: { ...process.env }, encoding: 'utf8', timeout: 10000,
    // drop NODE_TEST_CONTEXT if inherited
  });
  delete process.env.NODE_TEST_CONTEXT;
  const r2 = spawnSync(process.execPath, [TR], { encoding: 'utf8', timeout: 10000 });
  assert.match(r2.stderr || r2.stdout || '', /usage:/, 'direct invoke should print usage');
});
