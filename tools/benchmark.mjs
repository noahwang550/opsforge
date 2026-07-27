// tools/benchmark.mjs — Phase 4 P1-D: with/without-skill delta benchmark (advisory).
// Steering 拥有；guardrails.yml path-guard 已覆盖 tools/**。
// 不进 release gate（advisory only）；benchmark-report.json 由 SKELETON_GUARD_EXCLUSIONS 赦免。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run benchmark for a capability: runSuite twice (with-skill + without-skill),
 * compute delta, write benchmark-report.json. Advisory — not in release gate.
 *
 * @param {string} capDir
 * @param {{runner?: string, platform?: string, opsforgeHome?: string, configPath?: string, runSuite?: Function}} opts
 * @returns {Promise<{cap_id: string, with_skill: Object, without_skill: Object, delta: number, verdict: string}>}
 * Side effect: writes <capDir>/benchmark-report.json.
 */
export async function runBenchmark(capDir, opts = {}) {
  // runSuite is injected (test-friendly) or loaded from test-runner.mjs.
  const runSuite = opts.runSuite || (await import('./test-runner.mjs')).runSuite;
  const { parseCapability } = await import('./validate.mjs');
  const cap = parseCapability(capDir);
  const id = (cap.yaml && cap.yaml.id) || path.basename(capDir);
  // Load baseline prompt from eval.config.yaml.
  const cfgPath = opts.configPath || path.join(__dirname, 'eval.config.yaml');
  let baseline = 'You are a helpful assistant. Answer the user\'s request.';
  let minDelta = 0.1;
  try {
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg && cfg.benchmark) {
      if (typeof cfg.benchmark.baseline_prompt === 'string') baseline = cfg.benchmark.baseline_prompt;
      if (typeof cfg.benchmark.min_delta === 'number') minDelta = cfg.benchmark.min_delta;
    }
  } catch { /* defaults */ }

  // With-skill run: normal systemPrompt (entrypoint body, resolved by executeDryRun).
  const withR = await runSuite(capDir, {
    runner: opts.runner, platform: opts.platform, opsforgeHome: opts.opsforgeHome,
  });
  // Without-skill run: baseline systemPrompt replaces entrypoint body.
  const withoutR = await runSuite(capDir, {
    runner: opts.runner, platform: opts.platform, opsforgeHome: opts.opsforgeHome,
    baselineSystemPrompt: baseline,
  });

  const withOverall = (withR.summary && withR.summary.score_mean) || 0;
  const withoutOverall = (withoutR.summary && withoutR.summary.score_mean) || 0;
  const delta = Math.round((withOverall - withoutOverall) * 1000) / 1000;
  const verdict = delta >= minDelta ? 'effective' : 'neutral';
  const report = {
    cap_id: id,
    with_skill: {
      overall: withOverall,
      n: (withR.summary && withR.summary.total) || 0,
      passed: (withR.summary && withR.summary.passed) || 0,
    },
    without_skill: {
      overall: withoutOverall,
      n: (withoutR.summary && withoutR.summary.total) || 0,
      passed: (withoutR.summary && withoutR.summary.passed) || 0,
    },
    delta,
    min_delta: minDelta,
    verdict,
  };
  atomicWriteSync(path.join(capDir, 'benchmark-report.json'), JSON.stringify(report, null, 2));
  return report;
}
