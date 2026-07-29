// tools/opsforge.test.mjs — Phase 1.7: opsforge.mjs tests (OP1–OP6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { main, promptNew, promptInstall } from './opsforge.mjs';
import {
  cmdMenu, promptInstallFlow, cmdDiscover, cmdStatus, cmdFeedback, detectPlatform,
} from './opsforge.mjs';
import yaml from 'js-yaml';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-ux-'));
}

// Mock readline that returns predefined answers
function mockRl(answers) {
  const ee = new EventEmitter();
  let idx = 0;
  ee.question = (_q, cb) => {
    const a = answers[idx++] || '';
    cb(a);
  };
  ee.close = () => {};
  return ee;
}

// OP1 promptNew collects kind/slug/name
test('OP1 promptNew collects kind, slug, name', async () => {
  const rl = mockRl(['agent', 'copywriter', '', 'marketing-team']);
  const r = await promptNew(rl);
  assert.equal(r.kind, 'agent');
  assert.equal(r.name, 'copywriter');
  assert.equal(r.slug, 'marketing-team');
});

// OP2 promptNew with brand
test('OP2 promptNew with brand sets slug to brand', async () => {
  const rl = mockRl(['skill', 'bot', 'acme']);
  const r = await promptNew(rl);
  assert.equal(r.brand, 'acme');
  assert.equal(r.slug, 'acme');
});

// OP3 promptInstall collects capId and project
test('OP3 promptInstall collects capId and project', async () => {
  const rl = mockRl(['foo.bar', 'myproject']);
  const r = await promptInstall(rl, { platform: 'claude-code' });
  assert.equal(r.capId, 'foo.bar');
  assert.equal(r.project, 'myproject');
  assert.equal(r.platform, 'claude-code');
});

// OP4 main returns 2 on no args
test('OP4 main returns 2 on no args', async () => {
  const code = await main([]);
  assert.equal(code, 2);
});

// OP5 main returns 2 on unknown command
test('OP5 main returns 2 on unknown command', async () => {
  const code = await main(['bogus']);
  assert.equal(code, 2);
});

// OP6 status shows traffic-light from .opsforge-state.json
test('OP6 status shows traffic-light from .opsforge-state.json', async () => {
  const tmp = mkTmp();
  fs.writeFileSync(path.join(tmp, '.opsforge-state.json'), JSON.stringify({
    state: 'staged',
    history: [{ ts: '2026-01-01T00:00:00Z', from: 'draft', to: 'staged', pr: null }],
  }));
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    const code = await main(['status']);
    assert.equal(code, 0);
  } finally {
    process.chdir(origCwd);
  }
});

// OP7 D2: cmdDoctor forwards --project to install.doctor().
// Bug: cmdDoctor only parsed --platform, never --project, so doctor always ran
// against the 'default' project regardless of the flag.
test('OP7 cmdDoctor forwards --project to doctor', async () => {
  const origHome = process.env.OPSFORGE_HOME;
  const tmp = mkTmp();
  process.env.OPSFORGE_HOME = tmp;
  // Create ~/.claude/ so adapter.detect() passes; isolates --project behavior.
  // Without --project forwarding, doctor reads the empty 'default' manifest → healthy (code 0).
  // With forwarding, doctor reads 'myproj' manifest → missing artifact → unhealthy (code 1).
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    // Create a manifest for project 'myproj' with a missing artifact → high issue.
    // Manifests live under <OPSFORGE_HOME>/manifests/ (= tmp/.opsforge/manifests/).
    const manifestsDir = path.join(tmp, '.opsforge', 'manifests');
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.writeFileSync(path.join(manifestsDir, 'myproj.manifest.json'), JSON.stringify({
      manifest_version: '1',
      project: 'myproj',
      platform: 'claude-code',
      brand: null,
      installer_version: '0.1.0',
      capabilities: [{
        id: 'foo.bar', version: '1.0.0', source_commit: 'unknown', customer: null,
        security_policy: { env_whitelist: [], network_egress: [], tool_downgrade: null },
        owner_profile: 'myproj', installed_at: '2026-01-01T00:00:00Z',
        mcp_keys: [], effectiveness_flag: null, artifacts: [path.join(tmp, 'missing.md')],
        deps_missing: [],
      }],
    }));
    // doctor with --project myproj should surface the myproj manifest's missing artifact.
    const code = await main(['doctor', '--platform', 'claude-code', '--project', 'myproj']);
    assert.equal(code, 1, 'doctor should be unhealthy (missing artifact)');
  } finally {
    process.chdir(origCwd);
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// ---------- Phase 2.5: discover + report commands ----------

// OP8 discover lists capabilities from registry.yaml
test('OP8 discover lists capabilities from registry.yaml', async () => {
  const tmp = mkTmp();
  // Minimal registry.yaml
  fs.writeFileSync(path.join(tmp, 'registry.yaml'), [
    'capabilities:',
    '  foo.bar: { current: 1.0.0 }',
    '  foo.baz: { current: 2.0.0 }',
  ].join('\n'));
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    const code = await main(['discover']);
    assert.equal(code, 0);
  } finally {
    process.chdir(origCwd);
  }
});

// OP8b discover returns 0 with empty registry
test('OP8b discover handles empty/missing registry gracefully', async () => {
  const tmp = mkTmp();
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    const code = await main(['discover']);
    assert.equal(code, 0);
  } finally {
    process.chdir(origCwd);
  }
});

// OP9 report renders the 3 reports for a cap dir
test('OP9 report renders validation + eval reports for a cap dir', async () => {
  const tmp = mkTmp();
  // Create a fake cap dir with validation-report.json + eval-report.json
  fs.writeFileSync(path.join(tmp, 'validation-report.json'), JSON.stringify({
    id: 'foo.bar', verdict: 'pass', checks: { schema: 'pass', naming: 'pass' },
  }));
  fs.writeFileSync(path.join(tmp, 'eval-report.json'), JSON.stringify({
    id: 'foo.bar', verdict: 'pending', overall: 0.3,
    axes: { accuracy: { score: 0 }, completeness: { score: 0 }, actionability: { score: 0 }, safety: { score: 1 }, robustness: { score: 0 } },
  }));
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    const code = await main(['report', tmp]);
    assert.equal(code, 0);
  } finally {
    process.chdir(origCwd);
  }
});

// ---------- Phase 2.5: wizard + repair ----------

// OP10 wizard collects kind/slug/name and scaffolds a new capability
test('OP10 wizard scaffolds a new capability from interactive prompts', async () => {
  const tmp = mkTmp();
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    // Mock readline: route=② (escape hatch direct scaffold), then kind=skill, name=bot, brand=(empty), slug=foo
    const rl = mockRl(['2', 'skill', 'bot', '', 'foo']);
    const { cmdWizard } = await import('./opsforge.mjs');
    const code = await cmdWizard(rl, { root: tmp });
    assert.equal(code, 0);
    // The scaffolded draft should exist
    const draftPath = path.join(tmp, 'packs', '_drafts', 'foo', 'bot');
    assert.ok(fs.existsSync(path.join(draftPath, 'SKILL.md')), 'scaffolded SKILL.md should exist');
  } finally {
    process.chdir(origCwd);
  }
});

// OP11 install --repair re-installs missing artifacts
test('OP11 install --repair re-installs missing artifacts', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // Build a repo with one agent
  const capDir = path.join(tmp, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here.');
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(capDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  const { install, repair } = await import('../install.mjs');
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const agentPath = path.join(home, '.claude', 'agents', 'bar.md');
  assert.ok(fs.existsSync(agentPath));
  // Delete the artifact to simulate breakage
  fs.unlinkSync(agentPath);
  // Repair should re-install it
  const r = await repair({ platform: 'claude-code', project: 'default', repoRoot: tmp, opsforgeHome: home });
  assert.ok(r.repaired.includes('foo.bar'), 'should report foo.bar repaired');
  assert.ok(fs.existsSync(agentPath), 'artifact should be re-created');
});

// ---------- Phase 3.6: top menu + install flow + discover manifest + feedback ----------

// OP12 cmdMenu: option 1 (new) reachable, then 0 exits. Mock: choose 1, then 0.
test('OP12 cmdMenu option 1 reachable then 0 exits', async () => {
  const rl = mockRl(['1', '0']);
  const code = await cmdMenu(rl, { nonInteractive: true });
  assert.equal(code, 0);
});

// OP13 cmdMenu: invalid choice re-prompts (does not exit), then 0.
test('OP13 cmdMenu invalid choice re-prompts', async () => {
  const rl = mockRl(['9', 'bogus', '0']);
  const code = await cmdMenu(rl, { nonInteractive: true });
  assert.equal(code, 0);
});

// OP14 cmdMenu: 'menu' returns to top, '0' exits.
test('OP14 cmdMenu menu keyword returns to top then 0 exits', async () => {
  const rl = mockRl(['menu', '0']);
  const code = await cmdMenu(rl, { nonInteractive: true });
  assert.equal(code, 0);
});

// OP14b cmdMenu: option 1 → ③ 收录第三方能力 — intake flow reachable.
// Mock: choose 1, then 3, then a non-https URL hits the early-exit guard (no network).
test('OP14b cmdMenu option 1 → 3 intake flow reachable (non-https guard)', async () => {
  const rl = mockRl(['1', '3', 'not-a-url', '0']);
  const code = await cmdMenu(rl, { nonInteractive: true });
  assert.equal(code, 0);
});

// OP14c cmdIntakeFlow: https guard rejects non-https URLs before any network call.
test('OP14c cmdIntakeFlow rejects non-https git URL', async () => {
  const rl = mockRl(['ssh://git@github.com/foo/bar.git']);
  const { cmdIntakeFlow } = await import('./opsforge.mjs');
  const code = await cmdIntakeFlow(rl, {});
  assert.equal(code, 1);
});

// OP14d cmdIntakeFlow: empty repo URL cancels early.
test('OP14d cmdIntakeFlow cancels on empty repo URL', async () => {
  const rl = mockRl(['']);
  const { cmdIntakeFlow } = await import('./opsforge.mjs');
  const code = await cmdIntakeFlow(rl, {});
  assert.equal(code, 1);
});

// OP14e cmdIntakeFlow: invalid kind rejected.
test('OP14e cmdIntakeFlow rejects invalid kind', async () => {
  const rl = mockRl(['https://github.com/foo/bar.git', 'bogus-kind']);
  const { cmdIntakeFlow } = await import('./opsforge.mjs');
  const code = await cmdIntakeFlow(rl, {});
  assert.equal(code, 1);
});

// OP15 promptInstallFlow: 5 steps — platform/method/browse/deps/confirm.
test('OP15 promptInstallFlow collects 5-step install input', async () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  // mock: platform (enter=auto), method=4 (single cap), capId=foo.bar, deps confirm=Y, install confirm=Y
  const rl = mockRl(['', '4', 'foo.bar', 'Y', 'Y']);
  try {
    const r = await promptInstallFlow(rl, { opsforgeHome: home, workDir: tmp });
    assert.equal(r.platform, 'claude-code', 'auto-detected platform');
    assert.equal(r.capId, 'foo.bar');
    assert.equal(r.confirm, true);
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// OP16 cmdDiscover: reads per-project manifest (NOT registry), renders quality + commercial + trigger.
test('OP16 cmdDiscover reads manifest and renders quality + commercial + trigger', async () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  const manifestsDir = path.join(home, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, 'default.manifest.json'), JSON.stringify({
    manifest_version: '1', project: 'default', platform: 'claude-code', brand: null,
    installer_version: '0.1.0',
    capabilities: [
      { id: 'marketing-team.copywriter', version: '1.0.0', installed_at: '2026-01-01T00:00:00Z', commercial: true, effectiveness_flag: null, mcp_keys: [], artifacts: [], deps_missing: [] },
      { id: 'third-party.code-reviewer', version: '0.2.0', installed_at: '2026-01-01T00:00:00Z', commercial: false, effectiveness_flag: 'degraded', mcp_keys: [], artifacts: [], deps_missing: [] },
    ],
  }));
  try {
    const code = await cmdDiscover({ project: 'default', opsforgeHome: home });
    assert.equal(code, 0);
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// OP16b cmdDiscover: empty/missing manifest → graceful 0.
test('OP16b cmdDiscover handles empty manifest gracefully', async () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const code = await cmdDiscover({ project: 'default', opsforgeHome: home });
    assert.equal(code, 0);
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// OP17 cmdFeedback: writes jsonl with rating + text to ~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl.
test('OP17 cmdFeedback writes jsonl with rating and text', async () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  // mock: capId=foo.bar, rating=5, text=great
  const rl = mockRl(['foo.bar', '5', 'great']);
  try {
    const code = await cmdFeedback(rl, { opsforgeHome: home });
    assert.equal(code, 0);
    const fbPath = path.join(home, 'kb', 'foo', 'feedback', 'foo.bar.jsonl');
    assert.ok(fs.existsSync(fbPath), 'feedback jsonl should exist');
    const lines = fs.readFileSync(fbPath, 'utf8').trim().split(/\r?\n/);
    const rec = JSON.parse(lines[lines.length - 1]);
    assert.equal(rec.cap_id, 'foo.bar');
    assert.equal(rec.rating, 5);
    assert.equal(rec.text, 'great');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// OP18 cmdStatus: renders all 3 reports (validation + security + eval).
test('OP18 cmdStatus renders all 3 reports', async () => {
  const tmp = mkTmp();
  fs.writeFileSync(path.join(tmp, '.opsforge-state.json'), JSON.stringify({ state: 'staged', history: [] }));
  fs.writeFileSync(path.join(tmp, 'validation-report.json'), JSON.stringify({ id: 'foo.bar', verdict: 'pass', checks: { schema: 'pass' } }));
  fs.writeFileSync(path.join(tmp, 'security-report.json'), JSON.stringify({ id: 'foo.bar', verdict: 'pass', findings: [] }));
  fs.writeFileSync(path.join(tmp, 'eval-report.json'), JSON.stringify({ id: 'foo.bar', verdict: 'pending', overall: 0.3, axes: { accuracy: { score: 0 } } }));
  const code = await cmdStatus([tmp]);
  assert.equal(code, 0);
});

// OP19 detectPlatform: lazy resolve — OPSFORGE_HOME set AFTER import still wins.
// MAJOR 2: previously used a module-level const computed at import → OP19 空转 (passed
// only because the dev machine's real ~/.claude existed). Now resolves lazily.
test('OP19 detectPlatform lazily honors OPSFORGE_HOME set after import', () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  // only .claude exists in tmp home → claude-code (for the RIGHT reason, not dev-machine)
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  try {
    const p = detectPlatform({ opsforgeHome: home });
    assert.equal(p, 'claude-code');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// OP19b detectPlatform returns cursor when only .cursor exists (proves it reads home, not hardcoded).
test('OP19b detectPlatform returns cursor when only .cursor exists', () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  try {
    const p = detectPlatform({ opsforgeHome: home });
    assert.equal(p, 'cursor');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// OP20 backward compat: bare 'install' subcommand still dispatches (non-TTY → 2, not hang).
test('OP20 bare install subcommand dispatches (non-TTY guard)', async () => {
  // node:test runner is non-TTY → cmdInstallSubcommand guards against hang → returns 2.
  const code = await main(['install']);
  assert.equal(code, 2);
});

// OP21 feedback piped stdin + positional capId (MAJOR 1): `echo "5\n文案" | opsforge feedback <capId>`
// writes jsonl without TTY. Spawned as a child process to get a real piped stdin.
test('OP21 feedback piped stdin with positional capId writes jsonl', async () => {
  const home = mkTmp();
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const scriptPath = fileURLToPath(import.meta.url).replace(/opsforge\.test\.mjs$/, 'opsforge.mjs');
  const r = spawnSync(process.execPath, [scriptPath, 'feedback', 'foo.bar'], {
    input: '5\n很棒\n',
    env: { ...process.env, OPSFORGE_HOME: home },
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(r.status, 0, `feedback should exit 0; stderr: ${r.stderr || ''}`);
  // CLI uses resolveOpsforgeHome() = OPSFORGE_HOME/.opsforge → jsonl lands under home/.opsforge/kb/
  const fbPath = path.join(home, '.opsforge', 'kb', 'foo', 'feedback', 'foo.bar.jsonl');
  assert.ok(fs.existsSync(fbPath), 'feedback jsonl should exist');
  const lines = fs.readFileSync(fbPath, 'utf8').trim().split(/\r?\n/);
  const rec = JSON.parse(lines[lines.length - 1]);
  assert.equal(rec.cap_id, 'foo.bar');
  assert.equal(rec.rating, 5);
  assert.equal(rec.text, '很棒');
});

// OP22 feedback non-TTY without positional capId fail-loud (no hang).
test('OP22 feedback non-TTY without capId returns 2 (no hang)', async () => {
  const home = mkTmp();
  const code = await main(['feedback']); // node:test stdin is non-TTY, no capId
  assert.equal(code, 2);
});
