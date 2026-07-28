// tools/validate-r29-interview-real-sample.test.mjs — methodology R29 (in promote()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkInterviewRealSample } from './new-capability.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r29-')); }
function w(dir, file, c) { fs.writeFileSync(path.join(dir, file), c); }

test('R29 no-op when interview.md absent', () => {
  const dir = mkDir();
  assert.doesNotThrow(() => checkInterviewRealSample(dir));
});

test('R29 fail: source real without ref', () => {
  const dir = mkDir();
  w(dir, 'interview.md', `# x\n## 真实样本\n- 正例  input: 真实输入 产出: 输出  source: real  ref:\n`);
  assert.throws(() => checkInterviewRealSample(dir), /real requires a resolvable ref/);
});

test('R29 fail: ref not resolvable', () => {
  const dir = mkDir();
  w(dir, 'interview.md', `# x\n## 真实样本\n- 正例  input: 真实输入 产出: 输出  source: real  ref: ??\n`);
  assert.throws(() => checkInterviewRealSample(dir), /not resolvable/);
});

test('R29 pass: ref is ID/hash format', () => {
  const dir = mkDir();
  w(dir, 'interview.md', `# x\n## 真实样本\n- 正例  input: 真实输入 产出: 输出  source: real  ref: rec-12345\n`);
  assert.doesNotThrow(() => checkInterviewRealSample(dir));
});

test('R29 pass: ref is existing file path', () => {
  const dir = mkDir();
  w(dir, 'data.csv', 'a,b\n1,2');
  w(dir, 'interview.md', `# x\n## 真实样本\n- 正例  input: 真实输入 产出: 输出  source: real  ref: data.csv\n`);
  assert.doesNotThrow(() => checkInterviewRealSample(dir));
});

test('R29 fail: input __FILL_ME__', () => {
  const dir = mkDir();
  w(dir, 'interview.md', `# x\n## 真实样本\n- 正例  input: __FILL_ME__ 产出: x  source: recalled\n`);
  assert.throws(() => checkInterviewRealSample(dir), /input empty/);
});
