// tools/validate-r24b-degradation.test.mjs — methodology R24b degradation_present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDegradationPresent } from './validate.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r24b-')); }
function w(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test('R24b skill fail: missing 失败降级', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\n---\n## 能力说明\nx`);
  const r = checkDegradationPresent({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});

test('R24b skill pass: 失败降级 ≥1 item', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\n---\n## 失败降级\n- 数据源不可用时返回空报告`);
  const r = checkDegradationPresent({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});

test('R24b agent fail: 边界 empty', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: agent\n---\n## 边界\n`);
  const r = checkDegradationPresent({ dir, yaml: { kind: 'agent', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});

test('R24b mcp pass: 异常处理 non-empty', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: mcp\n---\n## 异常处理\n- 网络错误重试`);
  const r = checkDegradationPresent({ dir, yaml: { kind: 'mcp', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});
