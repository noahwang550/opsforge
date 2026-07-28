// tools/validate-r31-distill-log.test.mjs — methodology R31 (mechanical verification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDistillLogVerifiable } from './validate.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r31-')); }
function w(dir, c) { fs.writeFileSync(path.join(dir, 'source.md'), c); }

test('R31 n/a: no 蒸馏日志 section', () => {
  const dir = mkDir();
  w(dir, `---\nid: a.b\nkind: skill\n---\n## 能力说明\nx`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'n/a');
});

test('R31 pass: log references body 运行流程 step with overlap', () => {
  const dir = mkDir();
  w(dir, `---\nid: a.b\nkind: skill\n---\n## 运行流程\n\n### 步骤1 接收数据\n数据:x\n\n### 步骤2 生成输出\n数据:y\n\n## 蒸馏日志\n\n- 接收数据来自实录步骤1\n- 生成输出来自实录步骤2`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});

test('R31 fail: log references non-existent step', () => {
  const dir = mkDir();
  w(dir, `---\nid: a.b\nkind: skill\n---\n## 运行流程\n\n### 步骤1 接收数据\n数据:x\n\n## 蒸馏日志\n\n- 处理来自实录步骤9`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /step 9 not found/);
});

test('R31 fail: zero keyword overlap', () => {
  const dir = mkDir();
  w(dir, `---\nid: a.b\nkind: skill\n---\n## 运行流程\n\n### 步骤1 alpha beta\n数据:x\n\n## 蒸馏日志\n\n- gamma delta 来自实录步骤1`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /zero keyword overlap/);
});

test('R31 pass: prefers interview.md over body 运行流程', () => {
  const dir = mkDir();
  w(dir, `---\nid: a.b\nkind: skill\n---\n## 蒸馏日志\n\n- 拉数来自实录步骤1`);
  fs.writeFileSync(path.join(dir, 'interview.md'), `# x\n## 流程实录\n\n### 步骤1 拉数\ndata: x\n`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});
test('R31 loophole: log whose only overlap is literal 步骤 chars must fail', () => {
  const dir = mkDir();
  // Step 1 content is 接收数据; log line shares ONLY the structural 步骤 word.
  w(dir, `---
id: a.b
kind: skill
---
## 运行流程

### 步骤1 接收数据
数据:x

## 蒸馏日志

- 处理步骤来自实录步骤1`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /zero keyword overlap/);
});

test('R31 pass: legitimate step-N log still passes after loophole fix', () => {
  const dir = mkDir();
  // Log shares 数据 with step content (legitimate semantic overlap), not just 步骤.
  w(dir, `---
id: a.b
kind: skill
---
## 运行流程

### 步骤1 接收数据
数据:x

## 蒸馏日志

- 处理数据来自实录步骤1`);
  const r = checkDistillLogVerifiable({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});
