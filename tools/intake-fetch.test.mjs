// tools/intake-fetch.test.mjs — Phase 2.6 + N2/N3: third-party intake fetcher tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPublicUrl, dirSize, MAX_INTAKE_BYTES, fetchUpstream } from './intake-fetch.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-intake-')); }

// IF1 assertPublicUrl rejects non-https
test('IF1 assertPublicUrl rejects http:// (non-https)', async () => {
  await assert.rejects(() => assertPublicUrl('http://github.com/foo/bar'), /https/i);
});

// IF2 assertPublicUrl rejects private/loopback SSRF targets
test('IF2 assertPublicUrl rejects private/loopback/internal SSRF targets', async () => {
  for (const u of [
    'https://127.0.0.1/x',
    'https://169.254.169.254/',
    'https://10.0.0.1/x',
    'https://192.168.1.1/x',
    'https://host.internal/x',
  ]) {
    await assert.rejects(() => assertPublicUrl(u), /private|ssrf|internal|loopback/i, `${u} should be rejected`);
  }
});

// IF2b N3: assertPublicUrl rejects encoded-loopback IP encodings
test('IF2b assertPublicUrl rejects encoded-loopback IP encodings', async () => {
  for (const u of [
    'https://0x7f000001/x',        // hex
    'https://2130706433/x',         // decimal
    'https://0177.0.0.1/x',         // octal
    'https://[::ffff:127.0.0.1]/x',// ipv4-mapped ipv6
    'https://host.local/x',         // .local mDNS
    'https://host.corp/x',          // .corp
    'https://0.0.0.0/x',            // wildcard
    'https://[::1]/x',              // ipv6 loopback
  ]) {
    await assert.rejects(() => assertPublicUrl(u), /private|ssrf|internal|loopback|reserved/i, `${u} should be rejected`);
  }
});

// IF2c N3: assertPublicUrl rejects a public hostname that resolves to a private IP (DNS rebinding)
test('IF2c assertPublicUrl rejects public hostname resolving to private IP (mock lookup)', async () => {
  const mockLookup = async (host, opts) => [{ address: '127.0.0.1', family: 4 }, { address: '10.1.2.3', family: 4 }];
  await assert.rejects(() => assertPublicUrl('https://evil.example.com/x', { lookup: mockLookup }), /private|ssrf|loopback|resolv/i);
});

// IF2d N3: assertPublicUrl allows a public hostname resolving to a public IP (mock lookup)
test('IF2d assertPublicUrl allows public hostname → public IP (mock lookup)', async () => {
  const mockLookup = async (host, opts) => [{ address: '203.0.113.5', family: 4 }];
  await assert.doesNotThrow(() => assertPublicUrl('https://github.com/foo/bar', { lookup: mockLookup }));
});

// IF3 assertPublicUrl accepts a normal public https URL (skip DNS by injecting a public lookup)
test('IF3 assertPublicUrl accepts public https URL', async () => {
  const pubLookup = async () => [{ address: '203.0.113.5', family: 4 }];
  await assert.doesNotThrow(() => assertPublicUrl('https://github.com/foo/bar', { lookup: pubLookup }));
  await assert.doesNotThrow(() => assertPublicUrl('https://gitlab.com/foo/bar', { lookup: pubLookup }));
});

// IF4 dirSize computes bytes recursively
test('IF4 dirSize computes bytes recursively', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello'); // 5 bytes
  fs.writeFileSync(path.join(tmp, 'sub', 'b.txt'), 'world!!'); // 7 bytes
  assert.equal(dirSize(tmp), 12);
});

// IF5 fetchUpstream rejects oversized repo (>50MB cap)
test('IF5 fetchUpstream rejects oversized repo', async () => {
  const tmp = mkTmp();
  const dest = path.join(tmp, 'clone');
  // N2: execFile argv-based mock.
  const big = Buffer.alloc(MAX_INTAKE_BYTES + 1, 0);
  const mockExecFile = (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'clone') {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'big.bin'), big);
    }
    return '';
  };
  await assert.rejects(() => fetchUpstream('https://github.com/foo/bar', {
    execFile: mockExecFile, dest, maxSizeBytes: MAX_INTAKE_BYTES,
  }), /50 ?MB|size|exceeds/i);
});

// IF6 fetchUpstream uses git clone --depth 1 (argv form) and returns commit + dir
test('IF6 fetchUpstream uses git clone --depth 1 via execFile argv', async () => {
  const tmp = mkTmp();
  const dest = path.join(tmp, 'clone');
  const calls = [];
  const mockExecFile = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts && opts.cwd });
    if (cmd === 'git' && args[0] === 'clone') {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'README.md'), 'hi');
      return '';
    }
    if (cmd === 'git' && args[0] === 'rev-parse') return 'abc1234\n';
    return '';
  };
  const r = await fetchUpstream('https://github.com/foo/bar', { execFile: mockExecFile, dest });
  const clone = calls.find((c) => c.cmd === 'git' && c.args[0] === 'clone');
  assert.ok(clone, 'a git clone execFile call should have been issued');
  assert.deepEqual(clone.args.slice(0, 4), ['clone', '--depth', '1', 'https://github.com/foo/bar'], `argv should be ['clone','--depth','1',url]; got: ${JSON.stringify(clone.args)}`);
  assert.equal(clone.args[4], dest, 'dest should be the last argv element (index 4)');
  assert.equal(r.commit, 'abc1234');
  assert.equal(r.dir, dest);
  assert.ok(r.sizeBytes > 0);
});

// IF7 fetchUpstream rejects SSRF at call time
test('IF7 fetchUpstream rejects SSRF url before cloning', async () => {
  await assert.rejects(() => fetchUpstream('https://127.0.0.1/x', {}), /private|ssrf|loopback/i);
});

// ---------- N2: command injection ----------

// IF_inj1 assertPublicUrl rejects shell metacharacters in the URL pre-clone
test('IF_inj1 assertPublicUrl rejects shell metacharacters', async () => {
  for (const u of [
    'https://github.com/foo/bar;touch /tmp/opsforge-marker',
    'https://github.com/foo/bar|cat /etc/passwd',
    'https://github.com/foo/bar&whoami',
    'https://github.com/foo/bar`whoami`',
    'https://github.com/foo/bar$(whoami)',
    'https://github.com/foo/bar\nrm -rf /',
  ]) {
    await assert.rejects(() => assertPublicUrl(u), /metachar|shell|injection/i, `${u} should be rejected`);
  }
});

// IF_inj2 fetchUpstream uses execFile (no shell) — a URL with a shell operator is
// rejected pre-clone by assertPublicUrl, so no clone ever executes (no marker created).
test('IF_inj2 fetchUpstream rejects shell-metachar URL before clone (no execFile call)', async () => {
  const tmp = mkTmp();
  const dest = path.join(tmp, 'clone');
  let execFileCalled = false;
  const mockExecFile = (cmd, args, opts) => {
    execFileCalled = true;
    return '';
  };
  await assert.rejects(() => fetchUpstream('https://github.com/foo/bar;touch marker', { execFile: mockExecFile, dest }), /metachar|shell|injection/i);
  assert.equal(execFileCalled, false, 'execFile must NOT be called — URL rejected pre-clone');
});

// ---------- P1-A: fetchRemoteMeta (reference scope, API LICENSE fetch, no clone) ----------

// IF_R1 fetchRemoteMeta reuses assertPublicUrl SSRF guard (rejects private/loopback).
test('IF_R1 fetchRemoteMeta rejects SSRF private URL before any API call', async () => {
  const { fetchRemoteMeta } = await import('./intake-remote.mjs');
  let fetchCalled = false;
  const mockFetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(() => fetchRemoteMeta('https://127.0.0.1/evil', { fetch: mockFetch }), /private|ssrf|loopback/i);
  assert.equal(fetchCalled, false, 'fetch must NOT be called — URL rejected by SSRF guard');
});

// IF_R2 fetchRemoteMeta GitHub URL returns {repo, commit, license, sizeBytes:null, intakeScope:'reference'}.
test('IF_R2 fetchRemoteMeta GitHub URL returns license + commit via API (mocked)', async () => {
  const { fetchRemoteMeta } = await import('./intake-remote.mjs');
  const mockFetch = async (url) => {
    if (url.endsWith('/license')) {
      return { ok: true, json: async () => ({ license: { spdx_id: 'MIT' } }) };
    }
    if (url.endsWith('/commits/HEAD')) {
      return { ok: true, json: async () => ({ sha: 'abcdef1234567890' }) };
    }
    return { ok: false, status: 404 };
  };
  const meta = await fetchRemoteMeta('https://github.com/foo/bar.git', { fetch: mockFetch });
  assert.equal(meta.repo, 'https://github.com/foo/bar.git');
  assert.equal(meta.license, 'MIT');
  assert.equal(meta.commit, 'abcdef1'); // short sha (first 7 chars)
  assert.equal(meta.sizeBytes, null);
  assert.equal(meta.intakeScope, 'reference');
});

// IF_R3 fetchRemoteMeta non-GitHub URL falls back to git ls-remote (argv form, no shell).
test('IF_R3 fetchRemoteMeta non-GitHub URL falls back to git ls-remote', async () => {
  const { fetchRemoteMeta } = await import('./intake-remote.mjs');
  let execFileCalled = false;
  const mockExecFile = (cmd, args) => {
    execFileCalled = true;
    assert.equal(cmd, 'git', 'should call git, not a shell');
    assert.deepEqual(args, ['ls-remote', 'https://gitlab.com/foo/bar.git', 'HEAD'], 'argv form, no shell');
    return 'deadbeef12345678\tHEAD\n';
  };
  const meta = await fetchRemoteMeta('https://gitlab.com/foo/bar.git', { execFile: mockExecFile });
  assert.equal(meta.repo, 'https://gitlab.com/foo/bar.git');
  assert.equal(meta.commit, 'deadbee');
  assert.equal(meta.license, 'UNKNOWN'); // non-GitHub: author fills license
  assert.equal(meta.sizeBytes, null);
  assert.equal(meta.intakeScope, 'reference');
  assert.equal(execFileCalled, true, 'execFile should be called for non-GitHub');
});

// IF_R4 fetchRemoteMeta GitHub API 404 (repo not found) returns UNKNOWN license + unknown commit.
test('IF_R4 fetchRemoteMeta GitHub API 404 returns UNKNOWN + unknown', async () => {
  const { fetchRemoteMeta } = await import('./intake-remote.mjs');
  const mockFetch = async () => ({ ok: false, status: 404 });
  const meta = await fetchRemoteMeta('https://github.com/nonexistent/repo.git', { fetch: mockFetch });
  assert.equal(meta.license, 'UNKNOWN');
  assert.equal(meta.commit, 'unknown');
  assert.equal(meta.intakeScope, 'reference');
});

// IF_R5 fetchRemoteMeta CLI path via intake() reference scope.
test('IF_R5 intake scope=reference produces upstream-ref with install_hint', async () => {
  const { intake } = await import('./intake.mjs');
  const tmp = mkTmp();
  const mockFetch = async (url) => {
    if (url.endsWith('/license')) return { ok: true, json: async () => ({ license: { spdx_id: 'MIT' } }) };
    if (url.endsWith('/commits/HEAD')) return { ok: true, json: async () => ({ sha: 'abcdef1234567890' }) };
    return { ok: false, status: 404 };
  };
  const r = await intake({
    repoUrl: 'https://github.com/upstream/rep.git',
    license: 'MIT',
    kind: 'agent', name: 'refpkg', owner: 'third-party',
    repoRoot: tmp, scope: 'reference', fetch: mockFetch,
  });
  assert.equal(r.allowed, true);
  assert.equal(r.commit, 'abcdef1');
  assert.equal(r.sizeBytes, null);
  const draftDir = path.join(tmp, 'packs', '_drafts', 'third-party', 'refpkg');
  const ref = JSON.parse(fs.readFileSync(path.join(draftDir, 'upstream-ref.json'), 'utf8'));
  assert.equal(ref.intake_scope, 'reference');
  assert.equal(ref.install_hint, 'https://github.com/upstream/rep.git;agent;refpkg');
  assert.equal(ref.repo, 'https://github.com/upstream/rep.git');
});
