// tools/test-multi-engine.test.mjs — Phase 4 Slice 3a (P2-A multi-engine dispatch) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { executeCliDryRun, _setSpawn, executeClaudeDryRun } from './test-runner.mjs';

function makeFakeSpawn(listeners, stdoutLines, exitCode = 0) {
  return (bin, args, opts) => {
    const proc = {
      stdin: { write() { return true; }, end() {} },
      stdout: { on: (ev, fn) => ev === 'data' && listeners.stdout.push(fn) },
      stderr: { on: (ev, fn) => ev === 'data' && listeners.stderr.push(fn) },
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      kill() {},
    };
    queueMicrotask(() => {
      for (const line of stdoutLines) {
        listeners.stdout.forEach((fn) => fn(Buffer.from(line)));
      }
      listeners.close.forEach((fn) => fn(exitCode));
    });
    return proc;
  };
}

test('ME0: executeClaudeDryRun is exported (renamed from executeDryRun, kept alias)', async () => {
  assert.equal(typeof executeClaudeDryRun, 'function');
});

test('ME1: executeCliDryRun platform=claude-code → calls executeClaudeDryRun path', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'me1-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.me\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  const listeners = { stdout: [], stderr: [], close: [] };
  _setSpawn(makeFakeSpawn(listeners, ['claude-result-line']));
  try {
    const actual = await executeCliDryRun('claude-code', tmp, { input: 'q' }, {});
    assert.equal(actual, 'claude-result-line');
  } finally {
    _setSpawn(null);
  }
});

test('ME2: executeCliDryRun platform=cursor → spawns cursor argv', async () => {
  const listeners = { stdout: [], stderr: [], close: [] };
  let seenBin = null;
  const fakeSpawn = (bin, args, opts) => {
    seenBin = bin;
    const proc = {
      stdin: { write() { return true; }, end() {} },
      stdout: { on: (ev, fn) => ev === 'data' && listeners.stdout.push(fn) },
      stderr: { on: (ev, fn) => ev === 'data' && listeners.stderr.push(fn) },
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      kill() {},
    };
    queueMicrotask(() => {
      listeners.stdout.forEach((fn) => fn(Buffer.from('cursor-output')));
      listeners.close.forEach((fn) => fn(0));
    });
    return proc;
  };
  _setSpawn(fakeSpawn);
  try {
    const actual = await executeCliDryRun('cursor', '/tmp/cap', { input: 'q' }, {});
    assert.equal(seenBin, 'cursor');
    assert.equal(actual, 'cursor-output');
  } finally {
    _setSpawn(null);
  }
});

test('ME3: executeCliDryRun platform=dify → calls executeHttpDryRun', async () => {
  // dify path uses HTTP; we test that it errors with "fetch unavailable" or
  // "url required" rather than spawning a CLI. Mock is irrelevant here.
  _setSpawn(() => { throw new Error('should not spawn for dify'); });
  try {
    await assert.rejects(
      () => executeCliDryRun('dify', '/tmp/cap', { input: 'q' }, {}),
      (e) => /fetch unavailable|url required|http runner/.test(e.message),
    );
  } finally {
    _setSpawn(null);
  }
});

test('ME4: executeCliDryRun unknown platform → throws', async () => {
  await assert.rejects(
    () => executeCliDryRun('unsupported', '/tmp/cap', { input: 'q' }, {}),
    (e) => /unsupported platform runner/.test(e.message),
  );
});

test('ME5: spawn error (CLI not available) → rejects with "not available"', async () => {
  const listeners = { stdout: [], stderr: [], close: [], error: [] };
  const fakeSpawn = (bin, args, opts) => {
    const proc = {
      stdin: { write() { return true; }, end() {} },
      stdout: { on() {} },
      stderr: { on() {} },
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      kill() {},
    };
    queueMicrotask(() => listeners.error.forEach((fn) => fn(new Error('ENOENT'))));
    return proc;
  };
  _setSpawn(fakeSpawn);
  try {
    await assert.rejects(
      () => executeCliDryRun('cursor', '/tmp/cap', { input: 'q' }, {}),
      (e) => /not available|ENOENT/.test(e.message),
    );
  } finally {
    _setSpawn(null);
  }
});
