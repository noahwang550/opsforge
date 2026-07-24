// tools/intake.test.mjs — Phase 3.4: end-to-end intake orchestrator tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intake } from './intake.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-intake-e2e-')); }

function mockExecFile(dest) {
  return (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'clone') {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'source.md'), '---\nid: upstream.pkg\n---\nupstream body');
      fs.writeFileSync(path.join(dest, 'LICENSE'), 'MIT License\n');
      return '';
    }
    if (cmd === 'git' && args[0] === 'rev-parse') return 'abc1234\n';
    return '';
  };
}

// IT1 intake orchestrates fetch + license + scaffold into a draft
test('IT1 intake scaffolds a third-party draft from an upstream repo', async () => {
  const tmp = mkTmp();
  const dest = path.join(tmp, 'clone');
  const r = await intake({
    repoUrl: 'https://github.com/upstream/pkg.git',
    license: 'MIT',
    kind: 'agent',
    name: 'somepkg',
    owner: 'third-party',
    repoRoot: tmp,
    execFile: mockExecFile(dest),
    dest,
  });
  assert.equal(r.allowed, true);
  assert.equal(r.commit, 'abc1234');
  // A draft should be scaffolded under packs/_drafts/third-party/somepkg/
  const draftDir = path.join(tmp, 'packs', '_drafts', 'third-party', 'somepkg');
  assert.ok(fs.existsSync(draftDir), `draft should exist at ${draftDir}`);
  // upstream-ref record written
  assert.ok(fs.existsSync(path.join(draftDir, 'upstream-ref.json')), 'upstream-ref.json should be written');
  const ref = JSON.parse(fs.readFileSync(path.join(draftDir, 'upstream-ref.json'), 'utf8'));
  assert.equal(ref.repo, 'https://github.com/upstream/pkg.git');
  assert.equal(ref.commit, 'abc1234');
  assert.equal(ref.license, 'MIT');
  assert.equal(ref.commercial, false);
  assert.equal(ref.intake_scope, 'vendored');
});

// IT2 intake blocks on a disallowed (copyleft) license
test('IT2 intake blocks on disallowed license', async () => {
  const tmp = mkTmp();
  const dest = path.join(tmp, 'clone');
  await assert.rejects(() => intake({
    repoUrl: 'https://github.com/upstream/pkg.git',
    license: 'GPL-3.0',
    kind: 'agent', name: 'somepkg', owner: 'third-party',
    repoRoot: tmp, execFile: mockExecFile(dest), dest,
  }), /GPL-3.0|blocked|not allowed/i);
  // No draft should be scaffoldd
  const draftDir = path.join(tmp, 'packs', '_drafts', 'third-party', 'somepkg');
  assert.ok(!fs.existsSync(draftDir), 'no draft should be created on license block');
});

// IT3 intake records commercial=true with a reason
test('IT3 intake records commercial license with reason', async () => {
  const tmp = mkTmp();
  const dest = path.join(tmp, 'clone');
  // MIT is allowed but we mark commercial=true with a reason
  const r = await intake({
    repoUrl: 'https://github.com/upstream/pkg.git',
    license: 'MIT',
    commercial: true,
    commercialReason: 'paid commercial license on file',
    kind: 'agent', name: 'somepkg', owner: 'third-party',
    repoRoot: tmp, execFile: mockExecFile(dest), dest,
  });
  assert.equal(r.allowed, true);
  const draftDir = path.join(tmp, 'packs', '_drafts', 'third-party', 'somepkg');
  const ref = JSON.parse(fs.readFileSync(path.join(draftDir, 'upstream-ref.json'), 'utf8'));
  assert.equal(ref.commercial, true);
  assert.equal(ref.commercial_reason, 'paid commercial license on file');
});

// IT4 intake rejects SSRF repo URL
test('IT4 intake rejects SSRF repo URL before fetching', async () => {
  const tmp = mkTmp();
  await assert.rejects(() => intake({
    repoUrl: 'https://127.0.0.1/evil',
    license: 'MIT', kind: 'agent', name: 'x', owner: 'o', repoRoot: tmp,
  }), /private|ssrf|loopback/i);
});
