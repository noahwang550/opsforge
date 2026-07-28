// tools/validate-r30-workflow-graduated.test.mjs — methodology R30 (extends checkWorkflowRef).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkflowRef } from './validate.mjs';

const wf = (steps) => ({ dir: '/x', yaml: { kind: 'workflow', steps } });

test('R30 pass: step references staged cap', () => {
  const allCaps = [{ yaml: { id: 'foo.bar' }, state: 'staged' }];
  const r = checkWorkflowRef(wf([{ id: 's1', capability: 'foo.bar' }]), allCaps);
  assert.equal(r.status, 'pass');
});

test('R30 pass: step references released cap', () => {
  const allCaps = [{ yaml: { id: 'foo.bar' }, state: 'released' }];
  const r = checkWorkflowRef(wf([{ id: 's1', capability: 'foo.bar' }]), allCaps);
  assert.equal(r.status, 'pass');
});

test('R30 fail: step references draft cap', () => {
  const allCaps = [{ yaml: { id: 'foo.bar' }, state: 'draft' }];
  const r = checkWorkflowRef(wf([{ id: 's1', capability: 'foo.bar' }]), allCaps);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /non-graduated/);
});

test('R30 fail: step references unresolvable cap', () => {
  const r = checkWorkflowRef(wf([{ id: 's1', capability: 'no.such' }, { id: 's2', capability: 'foo.bar' }]), [{ yaml: { id: 'foo.bar' }, state: 'staged' }]);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /not resolvable/);
});
