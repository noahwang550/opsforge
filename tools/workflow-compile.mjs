// tools/workflow-compile.mjs — §7.2 / §20.4. Phase 3.1: sequence + switch + if + until/while + checkpoint.
// The bare `loop` type is rejected (use `until`/`while` with explicit max_iterations).
import path from 'node:path';
import { assertSlugSegment } from './paths.mjs';

const SUPPORTED_CF_TYPES = new Set(['sequence', 'switch', 'if', 'until', 'while', 'checkpoint']);
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Validate that every step-id in `ids` exists in stepMap; throw on first unknown.
 */
function assertStepsExist(ids, stepMap, label) {
  for (const sid of ids) {
    if (!stepMap.has(sid)) throw new Error(`workflow-compile: ${label} references unknown step "${sid}"`);
  }
}

/**
 * @param {Object} workflowYaml  parsed workflow.yaml
 * @param {string} platform      target platform slug
 * @returns {{kind: string, targetPath: string, content: string}}
 *   a workflow-command artifact
 * @throws {Error} on: unsupported control_flow node type; step.capability unresolvable
 *   in workflow.yaml's own steps[]; platform unsupported
 */
export function compile(workflowYaml, platform) {
  if (!workflowYaml) throw new Error('workflow-compile: workflowYaml is required');
  if (!platform) throw new Error('workflow-compile: platform is required');

  const wfId = workflowYaml.id || 'unknown.workflow';
  const parts = wfId.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 1] : 'workflow';
  assertSlugSegment(name, 'workflow-name');

  const steps = workflowYaml.steps || [];
  if (steps.length === 0) throw new Error('workflow-compile: workflow has no steps');
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  const cf = workflowYaml.control_flow;
  const hasCf = cf && Array.isArray(cf) && cf.length > 0;

  // Validate control_flow node types + references up front.
  if (hasCf) {
    for (const node of cf) {
      const t = node.type || 'sequence';
      if (!SUPPORTED_CF_TYPES.has(t)) {
        throw new Error(`workflow-compile: control_flow node type "${t}" not supported`);
      }
      if (t === 'sequence') {
        assertStepsExist(node.steps || [], stepMap, 'sequence');
      } else if (t === 'switch') {
        for (const c of (node.cases || [])) assertStepsExist(c.steps || [], stepMap, `switch case "${c.when}"`);
        if (node.default && node.default.steps) assertStepsExist(node.default.steps, stepMap, 'switch default');
      } else if (t === 'if') {
        if (node.then && node.then.steps) assertStepsExist(node.then.steps, stepMap, 'if then');
        if (node.else && node.else.steps) assertStepsExist(node.else.steps, stepMap, 'if else');
      } else if (t === 'until' || t === 'while') {
        assertStepsExist(node.steps || [], stepMap, `${t} loop`);
      } else if (t === 'checkpoint') {
        assertStepsExist(node.steps || [], stepMap, 'checkpoint');
      }
    }
  }

  // Build compiled slash-command markdown body
  const displayName = workflowYaml.display_name || name;
  const description = workflowYaml.description || displayName;
  const wfPack = workflowYaml.pack || 'unknown';

  const renderStep = (step, idx, prefix) => {
    const lines = [];
    lines.push(`${prefix}### Step ${idx}: ${step.id}`);
    lines.push('');
    lines.push(`Invoke capability \`${step.capability}\`.`);
    if (step.inputs && Object.keys(step.inputs).length > 0) {
      lines.push('');
      lines.push('Inputs:');
      for (const [k, v] of Object.entries(step.inputs)) lines.push(`- ${k}: ${JSON.stringify(v)}`);
    }
    if (step.outputs && step.outputs.length > 0) {
      lines.push('');
      lines.push('Expected outputs:');
      for (const out of step.outputs) lines.push(`- ${out}`);
    }
    lines.push('');
    return lines.join('\n');
  };

  const lines = [];
  lines.push('---');
  lines.push(`description: ${description}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Workflow: ${displayName}`);
  lines.push('');
  lines.push(`Execute the following steps. After each step, persist outputs to \`~/.opsforge/runs/${wfId}/<run-id>/artifacts/<step-id>/\`.`);
  lines.push('');

  if (hasCf) {
    let stepCounter = 1;
    for (const node of cf) {
      const t = node.type || 'sequence';
      if (t === 'sequence') {
        for (const sid of (node.steps || [])) {
          lines.push(renderStep(stepMap.get(sid), stepCounter++, '## '));
        }
      } else if (t === 'switch') {
        lines.push(`## Branch: switch on \`${node.on}\``);
        lines.push('');
        for (const c of (node.cases || [])) {
          lines.push(`### Case \`${c.when}\``);
          lines.push('');
          for (const sid of (c.steps || [])) {
            lines.push(renderStep(stepMap.get(sid), stepCounter++, ''));
          }
        }
        if (node.default && node.default.steps) {
          lines.push(`### default`);
          lines.push('');
          for (const sid of node.default.steps) {
            lines.push(renderStep(stepMap.get(sid), stepCounter++, ''));
          }
        }
        lines.push('');
      } else if (t === 'if') {
        lines.push(`## Branch: if \`${node.condition}\``);
        lines.push('');
        lines.push(`### then`);
        lines.push('');
        for (const sid of ((node.then && node.then.steps) || [])) {
          lines.push(renderStep(stepMap.get(sid), stepCounter++, ''));
        }
        lines.push(`### else`);
        lines.push('');
        for (const sid of ((node.else && node.else.steps) || [])) {
          lines.push(renderStep(stepMap.get(sid), stepCounter++, ''));
        }
        lines.push('');
      } else if (t === 'until' || t === 'while') {
        const maxIter = node.max_iterations || DEFAULT_MAX_ITERATIONS;
        const onMax = node.on_max || 'halt';
        lines.push(`## Loop: ${t} \`${node.condition}\` (max_iterations: ${maxIter}, on_max: ${onMax})`);
        lines.push('');
        lines.push(`Repeat the following steps ${t} \`${node.condition}\` is satisfied. ` +
          `Do not exceed ${maxIter} iterations; on reaching the cap, ${onMax} (halt = stop, abort = fail the run).`);
        lines.push('');
        for (const sid of (node.steps || [])) {
          lines.push(renderStep(stepMap.get(sid), stepCounter++, ''));
        }
        lines.push('');
      } else if (t === 'checkpoint') {
        lines.push(`## Checkpoint (human-in-the-loop)`);
        lines.push('');
        lines.push(`Pause here for human review/approval before proceeding. ` +
          `The runner sets status=paused; resume with \`--resume\` once approved.`);
        lines.push('');
        for (const sid of (node.steps || [])) {
          lines.push(renderStep(stepMap.get(sid), stepCounter++, ''));
        }
        lines.push('');
      }
    }
  } else {
    // No control_flow: linear order from steps[] declaration
    for (let i = 0; i < steps.length; i++) {
      lines.push(renderStep(steps[i], i + 1, '## '));
    }
  }

  // kb_mount: recognized but not injected (P1 comment; full MCP injection Phase 3.1)
  if (workflowYaml.kb_mount) {
    lines.push('<!-- kb_mount: recognized but not injected in Phase 1 -->');
    lines.push('');
  }

  // Per-run state instructions
  lines.push('## Per-run state');
  lines.push('');
  lines.push(`Write \`~/.opsforge/runs/${wfId}/<run-id>/state.json\` with the current step and accumulated outputs after each step completes.`);
  lines.push('');

  const targetPath = `~/.claude/commands/workflow-${name}.md`;
  const content = lines.join('\n');

  return { kind: 'workflow-command', targetPath, content };
}

/** CLI: `node tools/workflow-compile.mjs <workflow.yaml> [--platform <p>]` */
export function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/workflow-compile.mjs <workflow.yaml> [--platform <p>]');
    process.exit(2);
  }
  (async () => {
    const fs = await import('node:fs');
    const yaml = await import('js-yaml');
    const wfPath = path.resolve(argv[0]);
    let platform = 'claude-code';
    const platIdx = argv.indexOf('--platform');
    if (platIdx >= 0 && argv[platIdx + 1]) platform = argv[platIdx + 1];

    try {
      const raw = fs.readFileSync(wfPath, 'utf8');
      const wf = yaml.load(raw, { filename: wfPath });
      const artifact = compile(wf, platform);
      console.log(`targetPath: ${artifact.targetPath}`);
      console.log(`---\n${artifact.content}`);
      process.exit(0);
    } catch (e) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
  })();
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('workflow-compile.mjs');
if (invokedDirect) { main(); }
