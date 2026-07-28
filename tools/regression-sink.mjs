// tools/regression-sink.mjs — Phase 4 P0-B: 失败/反馈 → tests/case-NN.yaml 草稿生成器。
// 纯函数 + 副作用仅 fs.mkdirSync/fs.writeFileSync（落 _drafts/）。不自动 promote。
// Steering 拥有；guardrails.yml path-guard 已覆盖 tools/**。
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { assertCapId } from './paths.mjs';

const NAME_RE = /^[a-z][a-z0-9-]{2,30}$/;

/**
 * CJK-tolerant slugify: lowercases ASCII, strips non-[a-z0-9-].
 * CJK or empty: derive stable ascii slug via djb2 hash → "c<base36>".
 * Zero new deps (no pinyin). Result always matches NAME_RE.
 * @param {string} text
 * @returns {string} slug matching ^[a-z][a-z0-9-]{2,30}$ (truncated to 30 chars)
 */
export function slugify(text) {
  const src = String(text || '').trim().toLowerCase();
  const ascii = src.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii && NAME_RE.test(ascii.slice(0, 30))) {
    return ascii.slice(0, 30);
  }
  // CJK or empty or starts with digit: derive stable ascii slug via djb2 hash → "c<base36>".
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  const slug = 'c' + h.toString(36);
  // Pad to satisfy {2,30} (slug is 'c' + ≥2 chars).
  return slug.padEnd(3, '0').slice(0, 30);
}

/**
 * Resolve name conflicts by appending -2, -3, ... until no existing case file
 * at <draftsDir>/tests/case-<NN>.yaml has this name in its `name:` field.
 * @param {string} baseName  initial slug
 * @param {string} draftsDir absolute _drafts/<pack>/<name>/ path
 * @returns {string} unique name matching NAME_RE
 */
export function resolveNameConflict(baseName, draftsDir) {
  const testsDir = path.join(draftsDir, 'tests');
  const existing = new Set();
  if (fs.existsSync(testsDir)) {
    for (const f of fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml'))) {
      try {
        const parsed = yaml.load(fs.readFileSync(path.join(testsDir, f), 'utf8'));
        if (parsed && parsed.name) existing.add(parsed.name);
      } catch { /* skip */ }
    }
  }
  let name = baseName;
  let i = 2;
  while (existing.has(name)) {
    const suffix = `-${i}`;
    name = (baseName.slice(0, 30 - suffix.length) + suffix);
    if (!NAME_RE.test(name)) name = baseName.slice(0, 27) + suffix;
    i++;
  }
  return name;
}

/**
 * Generate a tests/case-NN.yaml draft from a feedback entry or eval failure.
 * ALWAYS leaves expected / judge_rubric as __FILL_ME__ (R7 + R18 enforce human fill).
 *
 * @param {{cap_id: string, rating?: number, text?: string}|null} feedback   feedback jsonl entry (rating<=3 used)
 * @param {{cap_id: string, case?: string, mode?: string, reason?: string, actual?: string}|null} failure  failures.jsonl entry
 * @param {{draftsDir: string, caseNum?: number}} opts  draftsDir = absolute _drafts/<pack>/<name>/
 * @returns {{destPath: string, name: string, yaml: string}} written draft
 * @throws if neither feedback nor failure provides usable text
 */
export function generateCase(feedback, failure, opts) {
  if (!opts || !opts.draftsDir) throw new Error('generateCase: opts.draftsDir required');
  const capId = (feedback && feedback.cap_id) || (failure && failure.cap_id);
  assertCapId(capId);
  const text = (feedback && feedback.text && feedback.text.trim())
    || (failure && failure.actual && String(failure.actual).slice(0, 200))
    || '';
  if (!text) throw new Error('generateCase: no usable text in feedback or failure');
  const baseName = slugify(text.slice(0, 30));
  const name = resolveNameConflict(baseName, opts.draftsDir);
  // expect heuristic: failure with contains-mode reason → contains; else llm_judge.
  const reasonStr = String((failure && failure.reason) || '');
  const expect = /contains|substring|missing substr/i.test(reasonStr) ? 'contains' : 'llm_judge';
  // Phase 4 fix (#6): wrap untrusted feedback/failure text in explicit
  // delimiters so authors reading the draft treat it as untrusted data (N4b).
  // Delimiters only wrap the filled `input`; __FILL_ME__ placeholders untouched.
  const UNTRUSTED_OPEN = feedback ? '<UNTRUSTED_FEEDBACK>' : '<UNTRUSTED_IMPORT>';
  const UNTRUSTED_CLOSE = feedback ? '</UNTRUSTED_FEEDBACK>' : '</UNTRUSTED_IMPORT>';
  const caseYaml = {
    name,
    input: `${UNTRUSTED_OPEN}${text.slice(0, 200)}${UNTRUSTED_CLOSE}`,
    expect,
    expected: '__FILL_ME__',
    schema_ref: null,
    judge_rubric: '__FILL_ME__',
    judge_threshold: 0.7,
    weight: 1.0,
    // methodology P1-8: regression drafts carry a quadrant placeholder; distiller
    // overwrites it during iteration (R7 blocks __FILL_ME__ at staged+).
    quadrant: '__FILL_ME__',
  };
  const testsDir = path.join(opts.draftsDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  const existing = fs.existsSync(testsDir)
    ? fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).length
    : 0;
  const num = String(existing + 1).padStart(2, '0');
  const destPath = path.join(testsDir, `case-${num}.yaml`);
  fs.writeFileSync(destPath, yaml.dump(caseYaml, { lineWidth: 120 }));
  return { destPath, name, yaml: yaml.dump(caseYaml) };
}

/**
 * Read feedback jsonl + failures.jsonl for a capId, return "to-sink" entries.
 * feedbacks filtered to rating<=3 (low-quality signal). failures all included.
 * Phase 4 P2-B: when opts.includeIterations is true, also read all
 * iteration-N subdirs' failures.jsonl and dedupe by case name (latest wins).
 * @param {string} capId
 * @param {{opsforgeHome?: string, includeIterations?: boolean}} opts
 * @returns {Promise<{feedbacks: Array, failures: Array}>}
 */
export async function collectSources(capId, opts = {}) {
  assertCapId(capId);
  const { resolveOpsforgeHome, resolveFailuresJsonl, resolveEvalHistoryDir } = await import('./paths.mjs');
  const home = opts.opsforgeHome || resolveOpsforgeHome();
  const pack = capId.split('.')[0];
  const fbPath = path.join(home, 'kb', pack, 'feedback', `${capId}.jsonl`);
  const feedbacks = [];
  if (fs.existsSync(fbPath)) {
    for (const line of fs.readFileSync(fbPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.rating === 'number' && e.rating <= 3) feedbacks.push(e);
      } catch { /* skip */ }
    }
  }
  const failures = [];
  const seenCase = new Set();
  const pushFailures = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const f = JSON.parse(line);
        if (!f || !f.case) continue;
        // Dedupe by case name; first occurrence (latest dir) wins.
        if (seenCase.has(f.case)) continue;
        seenCase.add(f.case);
        failures.push(f);
      } catch { /* skip */ }
    }
  };
  // Latest first (so iteration dedupe prefers latest).
  pushFailures(resolveFailuresJsonl(capId));
  if (opts.includeIterations) {
    const baseDir = resolveEvalHistoryDir(capId);
    if (fs.existsSync(baseDir)) {
      const iterDirs = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^iteration-\d+$/.test(d.name))
        .map((d) => d.name)
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
      for (const d of iterDirs) {
        pushFailures(path.join(baseDir, d, 'failures.jsonl'));
      }
    }
  }
  return { feedbacks, failures };
}
