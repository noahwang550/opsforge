// tools/workflow-runner.mjs — Phase 2.4: per-run workflow execution state machine.
// Consumes the per-run state.json the compiler emits instructions for. Supports
// --run-workflow / --list-runs / --abort / --resume. No new deps; node:fs + paths.
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteSync, readJsonOrNullSync, resolveOpsforgeHome } from './paths.mjs';

/**
 * Compute the ordered node list from a workflow yaml (control_flow or steps).
 * Phase 2.4 + F5: sequence/switch/if/until/while/checkpoint all flatten to a linear
 * node list (loop bodies appear once; the runner handles iteration via the loop map).
 */
function orderedNodes(workflow) {
  const steps = workflow.steps || [];
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const cf = workflow.control_flow;
  if (!cf || !Array.isArray(cf) || cf.length === 0) return steps.map((s) => s.id);
  const out = [];
  const pushIds = (ids) => { for (const sid of ids) { if (stepMap.has(sid) && !out.includes(sid)) out.push(sid); } };
  for (const node of cf) {
    const t = node.type || 'sequence';
    if (t === 'sequence') pushIds(node.steps || []);
    else if (t === 'switch') {
      for (const c of (node.cases || [])) pushIds(c.steps || []);
      if (node.default && node.default.steps) pushIds(node.default.steps);
    } else if (t === 'if') {
      if (node.then && node.then.steps) pushIds(node.then.steps);
      if (node.else && node.else.steps) pushIds(node.else.steps);
    } else if (t === 'until' || t === 'while' || t === 'checkpoint') {
      // F5: loop/checkpoint body steps must NOT be silently dropped.
      pushIds(node.steps || []);
    }
  }
  // Fallback: if control_flow yielded nothing, use declaration order.
  return out.length > 0 ? out : steps.map((s) => s.id);
}

/**
 * F5: Build a control_flow boundary map from the workflow yaml.
 * Returns { loops: [{nodeIdx, type, max_iterations, on_max, body_first, body_last}],
 *          checkpoints: Set<stepId>, checkpointByFirst: Map<firstStepId, nodeIdx> }.
 * nodeIdx is the index into the control_flow array.
 */
function buildBoundaryMap(workflow) {
  const cf = workflow.control_flow || [];
  const steps = workflow.steps || [];
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const loops = [];
  const checkpoints = new Set();
  const checkpointByFirst = new Map();
  cf.forEach((node, idx) => {
    const t = node.type || 'sequence';
    const body = node.steps || [];
    if (t === 'until' || t === 'while') {
      const first = body[0];
      const last = body[body.length - 1];
      if (first && last) loops.push({
        nodeIdx: idx, type: t,
        max_iterations: node.max_iterations || 10, on_max: node.on_max || 'halt',
        body_first: first, body_last: last,
      });
    } else if (t === 'checkpoint') {
      for (const sid of body) checkpoints.add(sid);
      if (body[0]) checkpointByFirst.set(body[0], idx);
    }
  });
  return { loops, checkpoints, checkpointByFirst };
}

function runDir(opsforgeHome, workflowId, runId) {
  return path.join(opsforgeHome || resolveOpsforgeHome(), 'runs', workflowId, runId);
}

function readState(opsforgeHome, workflowId, runId) {
  return readJsonOrNullSync(path.join(runDir(opsforgeHome, workflowId, runId), 'state.json'));
}

function writeState(opsforgeHome, workflowId, runId, state) {
  atomicWriteSync(path.join(runDir(opsforgeHome, workflowId, runId), 'state.json'), JSON.stringify(state, null, 2));
}

/**
 * Start a workflow run: create the run dir + initial state.json.
 * @param {{workflow: Object, opsforgeHome?: string, runId?: string}} args
 * @returns {{runId: string, state: Object}}
 */
export function startWorkflow({ workflow, opsforgeHome, runId }) {
  const wfId = workflow.id || 'unknown.workflow';
  runId = runId || `run-${Date.now()}-${process.pid}`;
  const nodes = orderedNodes(workflow);
  const boundary = buildBoundaryMap(workflow);
  const state = {
    workflow_id: wfId,
    run_id: runId,
    status: 'running',
    current_node: nodes.length > 0 ? nodes[0] : null,
    nodes,
    completed: [],
    outputs: {},
    loops: boundary.loops.map((l) => ({ ...l, iteration: 0 })),
    checkpoints: [...boundary.checkpoints],
    checkpoint_seen: [],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  writeState(opsforgeHome, wfId, runId, state);
  return { runId, state };
}

/** List all runs (optionally for one workflow) with their status. */
export function listRuns({ opsforgeHome, workflowId }) {
  const home = opsforgeHome || resolveOpsforgeHome();
  const runsRoot = workflowId ? path.join(home, 'runs', workflowId) : path.join(home, 'runs');
  const out = [];
  if (!fs.existsSync(runsRoot)) return out;
  const wfs = workflowId ? [workflowId] : fs.readdirSync(runsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const wf of wfs) {
    const wfDir = path.join(home, 'runs', wf);
    if (!fs.existsSync(wfDir)) continue;
    for (const ent of fs.readdirSync(wfDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const st = readJsonOrNullSync(path.join(wfDir, ent.name, 'state.json'));
      if (st) out.push({ runId: ent.name, workflowId: wf, status: st.status, current_node: st.current_node, updated_at: st.updated_at });
    }
  }
  out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return out;
}

/** Abort a running run. */
export function abortRun({ runId, workflowId, opsforgeHome }) {
  const state = readState(opsforgeHome, workflowId, runId);
  if (!state) throw new Error(`workflow-runner: run ${runId} not found for ${workflowId}`);
  if (state.status === 'completed') return state; // no-op on completed
  state.status = 'aborted';
  state.updated_at = new Date().toISOString();
  writeState(opsforgeHome, workflowId, runId, state);
  return state;
}

/** Resume an aborted/paused run — keep current_node, set status=running.
 *  F5: resume from paused sets running without re-pausing (checkpoint_seen already
 *  records the pause, so the next advance won't re-pause). */
export function resumeRun({ runId, workflowId, opsforgeHome }) {
  const state = readState(opsforgeHome, workflowId, runId);
  if (!state) throw new Error(`workflow-runner: run ${runId} not found for ${workflowId}`);
  if (state.status === 'completed') return state; // no-op on completed
  state.status = 'running';
  state.updated_at = new Date().toISOString();
  writeState(opsforgeHome, workflowId, runId, state);
  return state;
}

/**
 * F5: find the loop (if any) whose body_last === cur (the just-completed node).
 * Returns the loop descriptor or null.
 */
function loopEndingAt(state, cur) {
  if (!state.loops) return null;
  return state.loops.find((l) => l.body_last === cur) || null;
}

/** F5: is the given step id the first body step of an unseen checkpoint? */
function unseenCheckpointAt(state, stepId) {
  if (!state.checkpoints || !state.checkpoints.includes(stepId)) return false;
  if (!state.checkpoint_seen) state.checkpoint_seen = [];
  return !state.checkpoint_seen.includes(stepId);
}

/**
 * Advance a run: mark current_node completed, merge output, move to next node.
 * F5: loop iteration (until/while) + checkpoint pause handling.
 * When past the last node, set status=completed + current_node=null.
 */
export function advanceRun({ runId, workflowId, opsforgeHome, output }) {
  const state = readState(opsforgeHome, workflowId, runId);
  if (!state) throw new Error(`workflow-runner: run ${runId} not found for ${workflowId}`);
  if (state.status === 'completed') return state;
  const cur = state.current_node;
  // F5: if cur is the first body step of an unseen checkpoint, PAUSE before marking
  // completed. Handles the initial node being a checkpoint (WF12) and re-entry.
  if (cur !== null && cur !== undefined && unseenCheckpointAt(state, cur)) {
    state.status = 'paused';
    if (!state.checkpoint_seen.includes(cur)) state.checkpoint_seen.push(cur);
    state.updated_at = new Date().toISOString();
    writeState(opsforgeHome, workflowId, runId, state);
    return state;
  }
  if (cur !== null && cur !== undefined) {
    if (!state.completed.includes(cur)) state.completed.push(cur);
    if (output && typeof output === 'object') Object.assign(state.outputs, output);
  }

  // Helper: arrive at a node — set current_node; if it's an unseen checkpoint
  // first-body, pause (F5 arrival-time pause, WF11).
  const arriveAt = (nextNode) => {
    if (nextNode === null) { state.status = 'completed'; state.current_node = null; return; }
    state.current_node = nextNode;
    if (unseenCheckpointAt(state, nextNode)) {
      state.status = 'paused';
      if (!state.checkpoint_seen.includes(nextNode)) state.checkpoint_seen.push(nextNode);
    }
  };

  // (a) F5: loop termination — if cur is the last step of a loop body, decide iteration.
  const loop = loopEndingAt(state, cur);
  if (loop) {
    const exit = output && output.loopExit === true;
    if (exit) {
      const idx = state.nodes.indexOf(cur);
      const nextIdx = idx + 1;
      arriveAt(nextIdx >= state.nodes.length ? null : state.nodes[nextIdx]);
    } else if (loop.iteration + 1 < loop.max_iterations) {
      loop.iteration = loop.iteration + 1;
      state.current_node = loop.body_first;
      // loop body_first is not a checkpoint (it's a loop body); status stays running
      state.status = state.status === 'paused' ? 'running' : state.status;
    } else {
      if (loop.on_max === 'abort') state.status = 'aborted';
      else { state.status = 'completed'; state.current_node = null; }
    }
    state.iteration = loop.iteration;
    state.updated_at = new Date().toISOString();
    writeState(opsforgeHome, workflowId, runId, state);
    return state;
  }
  const idx = state.nodes.indexOf(cur);
  const nextIdx = idx + 1;
  arriveAt(nextIdx >= state.nodes.length ? null : state.nodes[nextIdx]);
  state.updated_at = new Date().toISOString();
  writeState(opsforgeHome, workflowId, runId, state);
  return state;
}

export async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/workflow-runner.mjs --run-workflow <wf.yaml> | --list-runs [wfId] | --abort <runId> <wfId> | --resume <runId> <wfId>');
    process.exit(2);
  }
  const opsforgeHome = resolveOpsforgeHome();
  try {
    if (argv.includes('--run-workflow')) {
      const yaml = (await import('js-yaml')).default;
      const wfPath = path.resolve(argv[argv.indexOf('--run-workflow') + 1]);
      const wf = yaml.load(fs.readFileSync(wfPath, 'utf8'));
      const { runId, state } = startWorkflow({ workflow: wf, opsforgeHome });
      console.log(`started: ${wf.id}/${runId} (current=${state.current_node}, status=${state.status})`);
      process.exit(0);
    } else if (argv.includes('--list-runs')) {
      const wfId = argv[argv.indexOf('--list-runs') + 1];
      const runs = listRuns({ opsforgeHome, workflowId: wfId });
      for (const r of runs) console.log(`${r.status}\t${r.workflowId}/${r.runId}\tcurrent=${r.current_node}`);
      process.exit(0);
    } else if (argv.includes('--abort')) {
      const runId = argv[argv.indexOf('--abort') + 1];
      const wfId = argv[argv.indexOf('--abort') + 2];
      const state = abortRun({ runId, workflowId: wfId, opsforgeHome });
      console.log(`aborted: ${wfId}/${runId} (status=${state.status})`);
      process.exit(0);
    } else if (argv.includes('--resume')) {
      const runId = argv[argv.indexOf('--resume') + 1];
      const wfId = argv[argv.indexOf('--resume') + 2];
      const state = resumeRun({ runId, workflowId: wfId, opsforgeHome });
      console.log(`resumed: ${wfId}/${runId} (status=${state.status}, current=${state.current_node})`);
      process.exit(0);
    } else {
      console.error('workflow-runner: unknown subcommand');
      process.exit(2);
    }
  } catch (e) {
    console.error(`workflow-runner: ${e.message}`);
    process.exit(1);
  }
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('workflow-runner.mjs') && !process.env.NODE_TEST_CONTEXT;
if (invokedDirect) { main().catch((e) => { console.error(e); process.exit(1); }); }
