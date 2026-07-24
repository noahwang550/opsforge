// tools/workflow-runner.test.mjs — Phase 2.4: per-run workflow runner state machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startWorkflow, listRuns, abortRun, resumeRun, advanceRun } from './workflow-runner.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-wfr-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function wfYaml() {
  return {
    id: 'foo.campaign', version: '1.0.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Campaign', display_name_zh: 'Campaign', display_name_en: 'Campaign',
    description: 'd',
    steps: [
      { id: 's1', capability: 'foo.aaa', inputs: {}, outputs: ['copy'] },
      { id: 's2', capability: 'foo.bbb', inputs: {}, outputs: ['review'] },
      { id: 's3', capability: 'foo.ccc', inputs: {}, outputs: ['report'] },
    ],
  };
}

// WF1 startWorkflow creates a run dir + state.json with current_node=s1, status=running
test('WF1 startWorkflow creates run + state.json', () => {
  const home = mkTmp(); setHome(home);
  const { runId, state } = startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  assert.ok(runId, 'runId should be returned');
  assert.equal(state.status, 'running');
  assert.equal(state.current_node, 's1');
  assert.equal(state.workflow_id, 'foo.campaign');
  assert.deepEqual(state.completed, []);
  const statePath = path.join(home, 'runs', 'foo.campaign', runId, 'state.json');
  assert.ok(fs.existsSync(statePath), 'state.json should be written');
});

// WF2 listRuns lists runs with status
test('WF2 listRuns lists runs', () => {
  const home = mkTmp(); setHome(home);
  startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  const runs = listRuns({ opsforgeHome: home, workflowId: 'foo.campaign' });
  assert.equal(runs.length, 2);
  assert.ok(runs[0].runId);
  assert.ok(runs[0].status);
});

// WF3 abortRun sets status=aborted
test('WF3 abortRun sets status=aborted', () => {
  const home = mkTmp(); setHome(home);
  const { runId } = startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  const state = abortRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home });
  assert.equal(state.status, 'aborted');
  const runs = listRuns({ opsforgeHome: home, workflowId: 'foo.campaign' });
  assert.equal(runs[0].status, 'aborted');
});

// WF4 resumeRun resets status=running keeping current_node
test('WF4 resumeRun resets status=running keeping current_node', () => {
  const home = mkTmp(); setHome(home);
  const { runId } = startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  abortRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home });
  const state = resumeRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home });
  assert.equal(state.status, 'running');
  assert.equal(state.current_node, 's1', 'current_node preserved on resume');
});

// WF5 advanceRun moves current_node forward and records completed
test('WF5 advanceRun moves current_node forward', () => {
  const home = mkTmp(); setHome(home);
  const { runId } = startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  const s1 = advanceRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home, output: { copy: 'draft' } });
  assert.equal(s1.current_node, 's2');
  assert.deepEqual(s1.completed, ['s1']);
  assert.deepEqual(s1.outputs.copy, 'draft');
  const s2 = advanceRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home, output: { review: 'ok' } });
  assert.equal(s2.current_node, 's3');
  assert.deepEqual(s2.completed, ['s1', 's2']);
  // advance past last step → status=completed
  const s3 = advanceRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home, output: { report: 'done' } });
  assert.equal(s3.status, 'completed');
  assert.equal(s3.current_node, null);
});

// WF6 startWorkflow respects control_flow ordering (sequence)
test('WF6 startWorkflow uses control_flow order for the node list', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfYaml();
  wf.control_flow = [{ type: 'sequence', steps: ['s2', 's1', 's3'] }];
  const { state } = startWorkflow({ workflow: wf, opsforgeHome: home });
  assert.equal(state.current_node, 's2', 'first node should be s2 per control_flow');
  assert.deepEqual(state.nodes, ['s2', 's1', 's3']);
});

// WF7 resumeRun on a completed run is a no-op (status stays completed)
test('WF7 resumeRun on completed run is a no-op', () => {
  const home = mkTmp(); setHome(home);
  const { runId } = startWorkflow({ workflow: wfYaml(), opsforgeHome: home });
  // advance through all 3 steps
  advanceRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home, output: {} });
  advanceRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home, output: {} });
  advanceRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home, output: {} });
  const state = resumeRun({ runId, workflowId: 'foo.campaign', opsforgeHome: home });
  assert.equal(state.status, 'completed', 'completed run should stay completed');
});

// ---------- F5: loop + checkpoint state machine ----------

function wfWithLoop() {
  return {
    id: 'foo.loop', version: '1.0.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Loop', display_name_zh: 'Loop', display_name_en: 'Loop',
    description: 'd',
    vars: [{ name: 'done' }, { name: 'flag' }],
    steps: [
      { id: 'a', capability: 'foo.aaa', inputs: {}, outputs: [] },
      { id: 'b', capability: 'foo.bbb', inputs: {}, outputs: [] },
      { id: 'c', capability: 'foo.ccc', inputs: {}, outputs: [] },
    ],
  };
}

// WF8 orderedNodes includes until/while/checkpoint body steps (no silent drop)
test('WF8 orderedNodes includes until/while/checkpoint body steps', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfWithLoop();
  wf.control_flow = [
    { type: 'until', condition: 'done', steps: ['a', 'b'], max_iterations: 3, on_max: 'abort' },
    { type: 'checkpoint', steps: ['c'] },
  ];
  const { state } = startWorkflow({ workflow: wf, opsforgeHome: home });
  assert.ok(state.nodes.includes('a'), 'a should be in nodes');
  assert.ok(state.nodes.includes('b'), 'b should be in nodes');
  assert.ok(state.nodes.includes('c'), 'c should be in nodes (checkpoint body)');
});

// WF9 until loop iterates until loopExit=true
test('WF9 until loop iterates until loopExit=true', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfWithLoop();
  wf.control_flow = [{ type: 'until', condition: 'done', steps: ['a', 'b'], max_iterations: 5, on_max: 'abort' }];
  const { runId } = startWorkflow({ workflow: wf, opsforgeHome: home });
  // iteration 1: a→b, at b (last of loop body) without loopExit → loop again
  let s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  assert.equal(s.current_node, 'b');
  s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} }); // at b, no exit → loop
  assert.equal(s.current_node, 'a', 'should loop back to a (iteration 2)');
  assert.ok(s.iteration >= 1, 'iteration should increment');
  // advance to b again, then exit
  s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  assert.equal(s.current_node, 'b');
  s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: { loopExit: true } });
  assert.equal(s.status, 'completed', 'should complete after loopExit');
});

// WF10 while on_max=abort sets aborted at cap
test('WF10 while on_max=abort sets aborted at cap', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfWithLoop();
  wf.control_flow = [{ type: 'while', condition: 'hasMore', steps: ['a'], max_iterations: 2, on_max: 'abort' }];
  const { runId } = startWorkflow({ workflow: wf, opsforgeHome: home });
  // iter1: a (no exit) → loop
  advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} }); // a→ loop (iter1)
  advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} }); // a → loop (iter2, at cap)
  const s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} }); // exceeds cap
  assert.equal(s.status, 'aborted', 'on_max=abort should abort at cap');
});

// WF10b while on_max=halt sets completed at cap
test('WF10b while on_max=halt sets completed at cap', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfWithLoop();
  wf.control_flow = [{ type: 'while', condition: 'hasMore', steps: ['a'], max_iterations: 2, on_max: 'halt' }];
  const { runId } = startWorkflow({ workflow: wf, opsforgeHome: home });
  advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  const s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  assert.equal(s.status, 'completed', 'on_max=halt should complete at cap');
});

// WF11 checkpoint sets paused, resume continues, then completes
test('WF11 checkpoint pauses then resume completes', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfWithLoop();
  wf.control_flow = [
    { type: 'sequence', steps: ['a'] },
    { type: 'checkpoint', steps: ['b'] },
  ];
  const { runId } = startWorkflow({ workflow: wf, opsforgeHome: home });
  let s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} }); // a done
  // next node is b (checkpoint body) → should pause
  assert.equal(s.status, 'paused', 'should pause at checkpoint');
  assert.equal(s.current_node, 'b', 'current_node should be at checkpoint body b');
  // resume → running
  s = resumeRun({ runId, workflowId: 'foo.loop', opsforgeHome: home });
  assert.equal(s.status, 'running');
  // advance b → completed
  s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  assert.equal(s.status, 'completed');
});

// WF12 resume from paused reaches running, not re-paused
test('WF12 resume from paused does not re-pause', () => {
  const home = mkTmp(); setHome(home);
  const wf = wfWithLoop();
  wf.control_flow = [{ type: 'checkpoint', steps: ['a'] }];
  const { runId } = startWorkflow({ workflow: wf, opsforgeHome: home });
  // first advance: a is checkpoint body → pause
  let s = advanceRun({ runId, workflowId: 'foo.loop', opsforgeHome: home, output: {} });
  assert.equal(s.status, 'paused');
  s = resumeRun({ runId, workflowId: 'foo.loop', opsforgeHome: home });
  assert.equal(s.status, 'running', 'resume should set running, not re-pause');
});
