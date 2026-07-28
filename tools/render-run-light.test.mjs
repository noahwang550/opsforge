// tools/render-run-light.test.mjs — methodology §5.3 two-tier 🟢/🔵/🔴.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRunLight } from './report-renderer.mjs';

test('Tier 1 pass → 🟢 green + cheapest smoke copy', () => {
  const r = renderRunLight({ tier: 1, pass: true, capId: 'a.b' });
  assert.equal(r.light, 'green');
  assert.match(r.oneLiner, /跑通门通过/);
  assert.match(r.text, /最便宜/);
});

test('Tier 2 pass → 🔵 blue + upgrade outlet', () => {
  const r = renderRunLight({ tier: 2, pass: true, capId: 'a.b' });
  assert.equal(r.light, 'blue');
  assert.match(r.text, /本平台暂不支持真跑通/);
  assert.match(r.text, /升级出口/);
});

test('fail → 🔴 red', () => {
  const r = renderRunLight({ tier: 1, pass: false, capId: 'a.b' });
  assert.equal(r.light, 'red');
  assert.match(r.text, /三选一/);
});

test('recalled+med → 未硬验证 mark', () => {
  const r = renderRunLight({ tier: 1, pass: true, recalledMed: true });
  assert.match(r.text, /未硬验证/);
});

test('modelMismatch → 模型版本变更 mark', () => {
  const r = renderRunLight({ tier: 1, pass: true, modelMismatch: true });
  assert.match(r.text, /模型版本变更/);
});

test('token total rendered', () => {
  const r = renderRunLight({ tier: 1, pass: true, tokenTotal: 1234 });
  assert.match(r.text, /1234/);
});
