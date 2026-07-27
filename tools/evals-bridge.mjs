// tools/evals-bridge.mjs — Phase 4 P1-C: evals.json 双向桥接（Anthropic 标准格式）。
// 纯函数 + fs 读写（导入落 _drafts/，导出读 tests/*.yaml）。不引新依赖。
// Steering 拥有；guardrails.yml path-guard 已覆盖 tools/**。
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const COMPARATOR_MAP = {
  exact: 'equals', contains: 'contains_all', regex: 'regex', schema: 'json_schema',
  llm_judge: 'judge', golden: 'fuzzy_match', check: 'custom', human: 'manual',
};

/**
 * Map an OpsForge case yaml → evals.json case object (Anthropic shape).
 * Pure; no I/O.
 */
export function exportCase(caseYaml) {
  const out = {
    case_id: caseYaml.name,
    user_message: typeof caseYaml.input === 'string' ? caseYaml.input : JSON.stringify(caseYaml.input),
    expected_comparator: COMPARATOR_MAP[caseYaml.expect] || 'manual',
    expected_value: caseYaml.expected,
  };
  if (caseYaml.judge_rubric) out.rubric = caseYaml.judge_rubric;
  if (typeof caseYaml.judge_threshold === 'number') out.pass_threshold = caseYaml.judge_threshold;
  if (caseYaml.schema_ref) out.expected_value = { schema: caseYaml.schema_ref, value: caseYaml.expected };
  if (Array.isArray(caseYaml.pre_gates) && caseYaml.pre_gates.length) {
    out.preconditions = caseYaml.pre_gates.map((g) => ({ type: g.mode, value: g.expected }));
  }
  if (Array.isArray(caseYaml.turns) && caseYaml.turns.length) {
    out.turns = caseYaml.turns.map((t) => ({ role: t.role, content: t.content }));
  }
  // metadata.opsforge.* round-trip carrier
  out.metadata = { opsforge: { weight: caseYaml.weight, timeout_ms: caseYaml.timeout_ms, platforms: caseYaml.platforms } };
  return out;
}

/**
 * Map an evals.json case → OpsForge case yaml object.
 * Inverse of exportCase; missing fields → __FILL_ME__ (human fills).
 */
export function importCase(evalsCase) {
  const revMap = Object.fromEntries(Object.entries(COMPARATOR_MAP).map(([k, v]) => [v, k]));
  const expect = revMap[evalsCase.expected_comparator] || 'llm_judge';
  const c = {
    name: evalsCase.case_id || 'imported-case',
    // Phase 4 fix (#6): wrap untrusted external evals.json text in explicit
    // delimiters so authors treat it as untrusted data (N4b). Placeholder
    // fields (__FILL_ME__) are untouched.
    input: `${'<UNTRUSTED_IMPORT>'}${typeof evalsCase.user_message === 'string' ? evalsCase.user_message : JSON.stringify(evalsCase.user_message || '')}${'</UNTRUSTED_IMPORT>'}`,
    expect,
    expected: (evalsCase.expected_value !== undefined && evalsCase.expected_value !== null)
      ? evalsCase.expected_value : '__FILL_ME__',
    schema_ref: null,
    judge_rubric: evalsCase.rubric || '__FILL_ME__',
    judge_threshold: typeof evalsCase.pass_threshold === 'number' ? evalsCase.pass_threshold : 0.7,
    weight: 1.0,
  };
  if (evalsCase.metadata && evalsCase.metadata.opsforge) {
    const m = evalsCase.metadata.opsforge;
    if (typeof m.weight === 'number') c.weight = m.weight;
    if (typeof m.timeout_ms === 'number') c.timeout_ms = m.timeout_ms;
    if (Array.isArray(m.platforms)) c.platforms = m.platforms;
  }
  return c;
}

/**
 * Export: read <capDir>/tests/*.yaml → evals.json object.
 * @param {string} capDir
 * @returns {{schema_version: string, cases: Array}}  evals.json shape
 */
export function exportToEvalsJson(capDir) {
  const testsDir = path.join(capDir, 'tests');
  const cases = [];
  if (fs.existsSync(testsDir)) {
    for (const f of fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).sort()) {
      try {
        const parsed = yaml.load(fs.readFileSync(path.join(testsDir, f), 'utf8'), { filename: f });
        if (parsed) cases.push(exportCase(parsed));
      } catch { /* skip */ }
    }
  }
  return { schema_version: 'v1alpha1', cases };
}

/**
 * Import: evals.json → tests/case-NN.yaml drafts in <draftsDir>/tests/.
 * Missing expected/rubric → __FILL_ME__ (R7 + R18 enforce human fill on promote).
 *
 * @param {Object|Array} evalsJson  parsed evals.json (object with .cases or bare array)
 * @param {{draftsDir: string, startNum?: number}} opts
 * @returns {{written: string[], skipped: number}}
 */
export function importFromEvalsJson(evalsJson, opts) {
  if (!opts || !opts.draftsDir) throw new Error('importFromEvalsJson: opts.draftsDir required');
  const testsDir = path.join(opts.draftsDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  const start = opts.startNum || (fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).length + 1 : 1);
  const written = [];
  let skipped = 0;
  const items = Array.isArray(evalsJson) ? evalsJson : (evalsJson.cases || []);
  items.forEach((ec, i) => {
    try {
      const c = importCase(ec);
      const num = String(start + i).padStart(2, '0');
      const dest = path.join(testsDir, `case-${num}.yaml`);
      fs.writeFileSync(dest, yaml.dump(c, { lineWidth: 120 }));
      written.push(dest);
    } catch { skipped++; }
  });
  return { written, skipped };
}
