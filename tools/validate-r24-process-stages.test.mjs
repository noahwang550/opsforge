// tools/validate-r24-process-stages.test.mjs — methodology R24 process_stages_present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProcessStagesPresent } from './validate.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r24-')); }
function w(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test('R24 skill pass: 运行流程 ≥2 steps with markers', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\nentrypoint: source.md\n---\n## 运行流程\n\n### 步骤1 接收  数据:x  决策:y  交付工件:z\n\n### 步骤2 输出  数据:x  决策:y  交付工件:z`);
  const r = checkProcessStagesPresent({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});

test('R24 skill fail: missing 运行流程', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\nentrypoint: source.md\n---\n## 能力说明\nx`);
  const r = checkProcessStagesPresent({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});

test('R24 agent pass: 角色设定 non-empty', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: agent\n---\n## 角色设定\n测试角色`);
  const r = checkProcessStagesPresent({ dir, yaml: { kind: 'agent', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});

test('R24 mcp fail: tools empty', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: mcp\n---\n## 工具面\n- query`);
  const r = checkProcessStagesPresent({ dir, yaml: { kind: 'mcp', tools: [], entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});
