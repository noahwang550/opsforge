// tools/workflow-compile.test.mjs — Phase 1.4: workflow-compile.mjs tests (WC1–WC6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './workflow-compile.mjs';

// WC1 compile produces correct artifact for linear workflow
test('WC1 compile produces workflow-command artifact', () => {
  const wf = {
    id: 'foo.campaign', version: '0.1.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Campaign', display_name_zh: 'Campaign', display_name_en: 'Campaign',
    description: 'A campaign workflow',
    steps: [
      { id: 'step-a', capability: 'foo.copywriter', inputs: { topic: 'x' }, outputs: ['copy'] },
      { id: 'step-b', capability: 'foo.reviewer', inputs: {}, outputs: ['review'] },
    ],
  };
  const a = compile(wf, 'claude-code');
  assert.equal(a.kind, 'workflow-command');
  assert.ok(a.targetPath.includes('commands/workflow-campaign.md'), a.targetPath);
  assert.ok(a.content.includes('Step 1'));
  assert.ok(a.content.includes('foo.copywriter'));
  assert.ok(a.content.includes('Step 2'));
  assert.ok(a.content.includes('foo.reviewer'));
});

// WC2 compile throws on non-sequence control_flow
test('WC2 compile throws on non-sequence control_flow', () => {
  const wf = {
    id: 'foo.workflow', steps: [{ id: 's1', capability: 'foo.bar', inputs: {}, outputs: [] }],
    control_flow: [{ type: 'loop', steps: ['s1'] }],
  };
  assert.throws(() => compile(wf, 'claude-code'), /loop.*not supported/i);
});

// WC3 compile uses steps order when no control_flow
test('WC3 compile uses steps declaration order when no control_flow', () => {
  const wf = {
    id: 'foo.workflow', display_name: 'WF',
    steps: [
      { id: 'alpha', capability: 'foo.aaa', inputs: {}, outputs: [] },
      { id: 'beta', capability: 'foo.bbb', inputs: {}, outputs: [] },
    ],
  };
  const a = compile(wf, 'claude-code');
  const alphaPos = a.content.indexOf('alpha');
  const betaPos = a.content.indexOf('beta');
  assert.ok(alphaPos < betaPos, 'alpha should come before beta');
});

// WC4 compile throws on unresolvable step reference in control_flow
test('WC4 compile throws on unresolvable step reference', () => {
  const wf = {
    id: 'foo.workflow',
    steps: [{ id: 's1', capability: 'foo.bar', inputs: {}, outputs: [] }],
    control_flow: [{ type: 'sequence', steps: ['nonexistent-step'] }],
  };
  assert.throws(() => compile(wf, 'claude-code'), /unknown step/);
});

// WC5 compiled body contains per-run state instructions
test('WC5 compiled body contains per-run state instructions', () => {
  const wf = {
    id: 'foo.workflow', display_name: 'WF',
    steps: [{ id: 's1', capability: 'foo.bar', inputs: {}, outputs: ['result'] }],
  };
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('state.json'), 'should mention state.json');
  assert.ok(a.content.includes('artifacts'), 'should mention artifacts');
});

// WC6 compiled body recognizes kb_mount (comment, not injected)
test('WC6 compiled body recognizes kb_mount as comment', () => {
  const wf = {
    id: 'foo.workflow', display_name: 'WF',
    steps: [{ id: 's1', capability: 'foo.bar', inputs: {}, outputs: [] }],
    kb_mount: true,
  };
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('kb_mount'), 'should mention kb_mount');
  assert.ok(a.content.includes('<!--'), 'should be a comment');
});

// ---------- Phase 2.4: switch / if control_flow ----------

function wfWith(steps, controlFlow) {
  return {
    id: 'foo.workflow', display_name: 'WF', version: '0.1.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    vars: [{ name: 'mode' }, { name: 'flag' }],
    steps, control_flow: controlFlow,
  };
}

const STEPS = [
  { id: 'a', capability: 'foo.aaa', inputs: {}, outputs: [] },
  { id: 'b', capability: 'foo.bbb', inputs: {}, outputs: [] },
  { id: 'c', capability: 'foo.ccc', inputs: {}, outputs: [] },
];

// WC7 compile renders switch control_flow with cases + default
test('WC7 compile renders switch control_flow', () => {
  const wf = wfWith(STEPS, [{
    type: 'switch', on: 'mode',
    cases: [{ when: 'fast', steps: ['a'] }, { when: 'full', steps: ['b', 'c'] }],
    default: { steps: ['a', 'c'] },
  }]);
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('switch'), 'should mention switch');
  assert.ok(a.content.includes('mode'), 'should mention the switch variable');
  assert.ok(a.content.includes('fast'), 'should mention case fast');
  assert.ok(a.content.includes('full'), 'should mention case full');
  assert.ok(a.content.includes('default'), 'should mention default');
  assert.ok(a.content.includes('foo.aaa'), 'should include step a capability');
});

// WC8 compile renders if control_flow with then/else
test('WC8 compile renders if control_flow', () => {
  const wf = wfWith(STEPS, [{
    type: 'if', condition: 'flag',
    then: { steps: ['a', 'b'] },
    else: { steps: ['c'] },
  }]);
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('if'), 'should mention if');
  assert.ok(a.content.includes('flag'), 'should mention the condition variable');
  assert.ok(a.content.includes('then'), 'should mention then');
  assert.ok(a.content.includes('else'), 'should mention else');
  assert.ok(a.content.includes('foo.bbb'));
});

// WC9 switch throws on unknown step reference
test('WC9 switch throws on unknown step reference', () => {
  const wf = wfWith(STEPS, [{
    type: 'switch', on: 'mode',
    cases: [{ when: 'x', steps: ['nonexistent'] }],
    default: { steps: ['a'] },
  }]);
  assert.throws(() => compile(wf, 'claude-code'), /unknown step/i);
});

// WC10 if throws on unknown step reference
test('WC10 if throws on unknown step reference', () => {
  const wf = wfWith(STEPS, [{
    type: 'if', condition: 'flag',
    then: { steps: ['ghost'] },
    else: { steps: ['c'] },
  }]);
  assert.throws(() => compile(wf, 'claude-code'), /unknown step/i);
});

// WC11 loop is still rejected (only sequence/switch/if supported)
test('WC11 loop control_flow still rejected', () => {
  const wf = wfWith(STEPS, [{ type: 'loop', steps: ['a'] }]);
  assert.throws(() => compile(wf, 'claude-code'), /loop.*not supported/i);
});

// ---------- Phase 3.1: until/while loop + checkpoint ----------

// WC12 until loop renders with max_iterations + on_max guard
test('WC12 until loop renders with iteration guard', () => {
  const wf = wfWith(STEPS, [{
    type: 'until', condition: 'done',
    steps: ['a', 'b'],
    max_iterations: 5,
    on_max: 'abort',
  }]);
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('until'), 'should mention until');
  assert.ok(a.content.includes('done'), 'should mention condition var');
  assert.ok(a.content.includes('max_iterations'), 'should mention max_iterations');
  assert.ok(a.content.includes('5'), 'should mention the iteration cap');
  assert.ok(a.content.includes('abort'), 'should mention on_max strategy');
  assert.ok(a.content.includes('foo.aaa'), 'should include step a');
});

// WC13 while loop renders
test('WC13 while loop renders', () => {
  const wf = wfWith(STEPS, [{
    type: 'while', condition: 'hasMore',
    steps: ['c'],
    max_iterations: 10,
    on_max: 'halt',
  }]);
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('while'));
  assert.ok(a.content.includes('hasMore'));
  assert.ok(a.content.includes('10'));
});

// WC14 checkpoint renders a HITL pause marker
test('WC14 checkpoint renders HITL pause', () => {
  const wf = wfWith(STEPS, [{
    type: 'checkpoint',
    steps: ['a'],
  }]);
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.toLowerCase().includes('checkpoint'), 'should mention checkpoint');
  assert.ok(a.content.toLowerCase().includes('human') || a.content.includes('人工'), 'should mention human review');
});

// WC15 until throws on unknown step reference
test('WC15 until throws on unknown step', () => {
  const wf = wfWith(STEPS, [{
    type: 'until', condition: 'x', steps: ['ghost'], max_iterations: 3, on_max: 'abort',
  }]);
  assert.throws(() => compile(wf, 'claude-code'), /unknown step/i);
});

// WC16 until without max_iterations defaults + warns
test('WC16 until without max_iterations defaults to a cap', () => {
  const wf = wfWith(STEPS, [{
    type: 'until', condition: 'x', steps: ['a'], on_max: 'halt',
  }]);
  const a = compile(wf, 'claude-code');
  assert.ok(a.content.includes('max_iterations'), 'should still include a max_iterations guard');
});
