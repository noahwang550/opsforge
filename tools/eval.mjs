// tools/eval.mjs — Phase 2.2 behavioral evaluation harness (v8 §21.4).
// 5-axis rubric: accuracy / completeness / actionability / safety / robustness.
// Produces eval-report.json as the 3rd CI artifact (after validation + security).
// No new deps: judge uses built-in fetch (D4 domestic-model compatible).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { atomicWriteSync, readJsonOrNullSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'eval.config.yaml');

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return yaml.load(raw);
  } catch {
    return { axes: { accuracy: 0.3, completeness: 0.2, actionability: 0.2, safety: 0.15, robustness: 0.15 }, threshold: 0.7, runner_limited_verdict: 'pending' };
  }
}

/**
 * Pure function: compute the 5 axes from runSuite verdicts + security verdict.
 * @param {Array} verdicts  runCase results ({pass: true|false|'pending', actual?, score?, mode?})
 * @param {{securityVerdict?: 'pass'|'block'|null}} opts
 * @returns {Object} axes keyed by name → {score, n, pending?}
 */
export function computeAxes(verdicts, opts = {}) {
  const total = verdicts.length;
  const judged = verdicts.filter((v) => v.pass === true || v.pass === false);
  const passed = verdicts.filter((v) => v.pass === true).length;
  const failed = verdicts.filter((v) => v.pass === false).length;
  const pending = verdicts.filter((v) => v.pass === 'pending').length;

  // accuracy: pass rate over judged cases (0 if none judged).
  const accuracyScore = judged.length > 0 ? passed / judged.length : 0;

  // completeness: non-empty actual over total.
  const nonEmpty = verdicts.filter((v) => v.actual !== undefined && v.actual !== null && String(v.actual).trim() !== '').length;
  const completenessScore = total > 0 ? nonEmpty / total : 0;

  // actionability: mean llm_judge scores; fallback to accuracy when no judge scores.
  const judgeScores = verdicts.filter((v) => typeof v.score === 'number' && v.mode === 'llm_judge').map((v) => v.score);
  const actionabilityScore = judgeScores.length > 0 ? judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length : accuracyScore;

  // safety: from security-report (pass→1, block→0, absent→1).
  const sec = opts.securityVerdict;
  const safetyScore = sec === 'block' ? 0 : 1;

  // robustness: 1 - failed/total (penalize hard fails).
  const robustnessScore = total > 0 ? 1 - failed / total : 1;

  return {
    accuracy: { score: accuracyScore, n: judged.length, ...(judged.length === 0 ? { pending: true } : {}) },
    completeness: { score: completenessScore, n: total, ...(pending === total && total > 0 ? { pending: true } : {}) },
    actionability: { score: actionabilityScore, n: judgeScores.length, ...(judgeScores.length === 0 ? { pending: true } : {}) },
    safety: { score: safetyScore, n: total },
    robustness: { score: robustnessScore, n: total },
  };
}

/**
 * Evaluate a capability: run the suite, read security-report, compute 5 axes,
 * optionally write eval-report.json to the cap dir.
 * @param {string} capDir
 * @param {{runner?: string, opsforgeHome?: string, write?: boolean, platform?: string}} opts
 * @returns {Promise<Object>} eval-report shape
 */
export async function evaluateCap(capDir, opts = {}) {
  const config = loadConfig();
  // Lazy import to avoid circular init (test-runner imports validate; validate is independent).
  const { runSuite } = await import('./test-runner.mjs');
  const { parseCapability } = await import('./validate.mjs');
  const cap = parseCapability(capDir);
  const id = (cap.yaml && cap.yaml.id) || path.basename(capDir);

  const { summary, cases } = await runSuite(capDir, {
    runner: opts.runner,
    platform: opts.platform || 'claude-code',
    opsforgeHome: opts.opsforgeHome,
  });

  // Read security-report if present.
  const secReport = readJsonOrNullSync(path.join(capDir, 'security-report.json'));
  const securityVerdict = secReport ? secReport.verdict : null;

  const axes = computeAxes(cases, { securityVerdict });

  // Overall = weighted sum over non-pending axes with numeric scores.
  const weights = config.axes || {};
  let weightedSum = 0, weightTotal = 0;
  for (const [name, ax] of Object.entries(axes)) {
    if (typeof ax.score === 'number') {
      const w = weights[name] || 0;
      weightedSum += ax.score * w;
      weightTotal += w;
    }
  }
  const overall = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 1000) / 1000 : 0;

  // Verdict: static-only → pending (runner_limited). safety 0 → fail. overall>=threshold → pass.
  let verdict;
  const runnerLimited = summary.runner === 'static-only' || summary.runner_limited;
  if (runnerLimited) {
    verdict = config.runner_limited_verdict || 'pending';
    if (axes.safety.score === 0) verdict = 'fail'; // security block still fails even in static-only
  } else {
    verdict = (axes.safety.score > 0 && overall >= (config.threshold || 0.7)) ? 'pass' : 'fail';
  }

  const report = {
    id,
    origin: 'original',
    axes,
    overall,
    threshold: config.threshold || 0.7,
    runner: summary.runner,
    ...(runnerLimited ? { runner_limited: true } : {}),
    cases: cases.map((c) => ({ case: c.case, mode: c.mode, pass: c.pass, ...(c.reason ? { reason: c.reason } : {}), ...(typeof c.score === 'number' ? { score: c.score } : {}) })),
    verdict,
  };

  if (opts.write) {
    atomicWriteSync(path.join(capDir, 'eval-report.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

/** CLI: `node tools/eval.mjs <capDir> | --all` */
export function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/eval.mjs <capDir> | --all');
    process.exit(2);
  }
  if (argv[0] === '--all') {
    (async () => {
      const { scanCapabilities } = await import('./validate.mjs');
      const caps = scanCapabilities(process.cwd());
      let allPass = true;
      for (const cap of caps) {
        if (!cap.yaml) continue;
        const report = await evaluateCap(cap.dir, { write: true });
        const tag = report.verdict === 'pass' ? 'PASS' : (report.verdict === 'pending' ? 'PEND' : 'FAIL');
        if (tag === 'FAIL') allPass = false;
        console.log(`${tag}  ${cap.yaml.id}  (overall=${report.overall}, verdict=${report.verdict})`);
      }
      process.exit(allPass ? 0 : 1);
    })();
  } else {
    const capDir = path.resolve(argv[0]);
    (async () => {
      try {
        const report = await evaluateCap(capDir, { write: true });
        for (const c of report.cases) {
          const tag = c.pass === true ? 'PASS' : c.pass === 'pending' ? 'PEND' : 'FAIL';
          console.log(`${tag}  ${c.case}  (${c.mode})  ${c.reason || ''}`);
        }
        console.log(`\noverall: ${report.overall}  verdict: ${report.verdict}  (runner=${report.runner})`);
        process.exit(report.verdict === 'fail' ? 1 : 0);
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
    })();
  }
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('eval.mjs');
if (invokedDirect) { main(); }
