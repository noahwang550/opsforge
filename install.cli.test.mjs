// install.cli.test.mjs — REGRESSION TEST for e2e coverage gap (Gate 6).
//
// Context: Added by the e2e test runner during Phase 1 verification. The
// existing install.test.mjs (IN1–IN8) calls install/uninstall/list/doctor
// as in-process functions with a BARE capId (e.g. 'foo.bar'). It never
// exercises install.mjs `main()` argv parsing, where --install splits off
// an `@version` suffix but --uninstall does NOT. This test exercises the
// CLI surface (spawn `node install.mjs ...`) so the gap is covered.
//
// Marked `test.failing` to document a KNOWN BUG for the code-reviewer:
//   --uninstall marketing-team.copywriter@1.0.0
//   → error: path-guard: capId "marketing-team.copywriter@1.0.0" invalid
// Root cause: install.mjs main() line ~293 passes the raw `@version` arg
// to uninstall(), which calls assertCapId() and rejects `@`.
// Fix hint: strip `@version` in the --uninstall branch the same way the
// --install branch does (line ~283: `const [capId, version] = ...split('@')`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname);
const INSTALL_MJS = path.join(REPO_ROOT, 'install.mjs');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cli-'));
}

function mkRepo(tmp) {
  const capDir = path.join(tmp, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nThis is the agent body content for testing.');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(capDir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-${i}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  return tmp;
}

function runCli(args, { env, cwd }) {
  const r = spawnSync(process.execPath, [INSTALL_MJS, ...args], {
    env: { ...process.env, ...env },
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// CLI-1 install via --install <id@version> succeeds (parity baseline).
test('CLI-1 install --install foo.bar@1.0.0 succeeds', () => {
  const tmp = mkRepo(mkTmp());
  const home = mkTmp();
  const r = runCli(['--platform', 'claude-code', '--install', 'foo.bar@1.0.0'], {
    env: { OPSFORGE_HOME: home },
    cwd: tmp,
  });
  assert.equal(r.code, 0, `install exit ${r.code}, stderr=${r.stderr}`);
  assert.match(r.stdout, /installed:/);
});

// CLI-2 uninstall via --uninstall <id@version> must succeed — currently FAILS.
// This test documents the bug: it asserts success, but the bug makes it fail.
// When the bug is fixed (strip @version in the --uninstall branch), it goes green.
test('CLI-2 uninstall --uninstall foo.bar@1.0.0 succeeds (parity with --install)', () => {
  const tmp = mkRepo(mkTmp());
  const home = mkTmp();
  // install first
  const ri = runCli(['--platform', 'claude-code', '--install', 'foo.bar@1.0.0'], {
    env: { OPSFORGE_HOME: home }, cwd: tmp,
  });
  assert.equal(ri.code, 0, `install exit ${ri.code}, stderr=${ri.stderr}`);
  // uninstall with @version — should succeed like install does
  const ru = runCli(['--uninstall', 'foo.bar@1.0.0'], {
    env: { OPSFORGE_HOME: home }, cwd: tmp,
  });
  assert.equal(ru.code, 0, `uninstall exit ${ru.code}, stderr=${ru.stderr}`);
  assert.doesNotMatch(ru.stderr, /path-guard/i, 'uninstall must not reject the @version suffix');
});

// ---------- F1: --uninstall forwards --project ----------

// CLI-3 F1: --uninstall --project <p> cleans the non-default manifest + removes artifacts
test('CLI-3 --uninstall forwards --project (non-default manifest cleaned)', () => {
  const tmp = mkRepo(mkTmp());
  const home = mkTmp();
  // install into project 'myproj'
  const ri = runCli(['--platform', 'claude-code', '--install', 'foo.bar@1.0.0', '--project', 'myproj'], {
    env: { OPSFORGE_HOME: home }, cwd: tmp,
  });
  assert.equal(ri.code, 0, `install exit ${ri.code}, stderr=${ri.stderr}`);
  const agentPath = path.join(home, '.claude', 'agents', 'bar.md');
  assert.ok(fs.existsSync(agentPath), 'agent artifact should exist');
  // CLI uses resolveOpsforgeHome() = <OPSFORGE_HOME>/.opsforge
  const manifestPath = path.join(home, '.opsforge', 'manifests', 'myproj.manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'myproj manifest should exist');
  // uninstall with --project myproj → must clean myproj manifest + remove artifact
  const ru = runCli(['--uninstall', 'foo.bar@1.0.0', '--project', 'myproj'], {
    env: { OPSFORGE_HOME: home }, cwd: tmp,
  });
  assert.equal(ru.code, 0, `uninstall exit ${ru.code}, stderr=${ru.stderr}`);
  assert.ok(!fs.existsSync(agentPath), 'agent artifact should be removed');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(!m.capabilities.find((c) => c.id === 'foo.bar'), 'foo.bar should be removed from myproj manifest');
});

// CLI-4 F1: --uninstall without --project defaults to 'default' (parity)
test('CLI-4 --uninstall without --project defaults to default', () => {
  const tmp = mkRepo(mkTmp());
  const home = mkTmp();
  runCli(['--platform', 'claude-code', '--install', 'foo.bar@1.0.0'], {
    env: { OPSFORGE_HOME: home }, cwd: tmp,
  });
  const agentPath = path.join(home, '.claude', 'agents', 'bar.md');
  assert.ok(fs.existsSync(agentPath));
  // no --project → default manifest
  const ru = runCli(['--uninstall', 'foo.bar@1.0.0'], {
    env: { OPSFORGE_HOME: home }, cwd: tmp,
  });
  assert.equal(ru.code, 0, `uninstall exit ${ru.code}, stderr=${ru.stderr}`);
  assert.ok(!fs.existsSync(agentPath), 'agent artifact should be removed (default project)');
});
