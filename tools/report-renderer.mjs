// tools/report-renderer.mjs — §22.9 P1 minimal. Renders validation-report.json
// to Chinese plain-text with traffic-light (绿/黄/红) + fix guidance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, 'report-templates');

/**
 * @param {Object} reportJson  parsed validation-report.json
 * @param {"validation-report"|"security-report"|"eval-report"|"manifest"} type
 *   P1: "validation-report"; Phase 2.2 adds "eval-report"; others throw.
 * @param {{lang?: "zh"|"en"}} opts
 * @returns {{text: string, light: "green"|"yellow"|"red", oneLiner: string}}
 */
export function render(reportJson, type, opts = {}) {
  const lang = opts.lang || 'zh';
  if (lang !== 'zh') {
    throw new Error(`report-renderer: lang "${lang}" not supported (only zh)`);
  }
  if (type === 'validation-report') return renderValidation(reportJson);
  if (type === 'eval-report') return renderEval(reportJson);
  if (type === 'security-report') return renderSecurity(reportJson);
  throw new Error(`report-renderer: type "${type}" not supported (only validation-report, eval-report, security-report)`);
}

function renderValidation(reportJson) {
  const templatePath = path.join(TEMPLATES_DIR, `validation-report.zh.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`report-renderer: template not found: ${templatePath}`);
  }
  let template = fs.readFileSync(templatePath, 'utf8');

  // Determine traffic light
  const verdict = reportJson.verdict || 'fail';
  const checks = reportJson.checks || {};
  const hasPending = Object.values(checks).some((v) => v === 'pending' || v === 'n/a');
  const light = verdict === 'pass' && !hasPending ? '绿' : (verdict === 'pass' && hasPending ? '黄' : '红');
  const lightColor = light === '绿' ? 'green' : (light === '黄' ? 'yellow' : 'red');

  // One-liner
  const totalChecks = Object.keys(checks).length;
  const failedChecks = Object.values(checks).filter((v) => v === 'fail').length;
  const passedChecks = Object.values(checks).filter((v) => v === 'pass').length;
  const oneLiner = verdict === 'pass'
    ? `所有 ${totalChecks} 项检查通过（${passedChecks} 通过）`
    : `${failedChecks} 项检查失败，共 ${totalChecks} 项`;

  // Checks detail
  const checksLines = [];
  for (const [name, status] of Object.entries(checks)) {
    const icon = status === 'pass' ? '✓' : (status === 'fail' ? '✗' : '○');
    checksLines.push(`- ${icon} ${name}: ${status}`);
  }
  const checksText = checksLines.join('\n') || '（无检查项）';

  // Fix guidance
  const fixes = [];
  for (const [name, status] of Object.entries(checks)) {
    if (status === 'fail') {
      fixes.push(`- **${name}**: 请修复此项检查后重新提交`);
    } else if (status === 'pending') {
      fixes.push(`- **${name}**: 等待人工审核`);
    }
  }
  const fixGuidance = fixes.length > 0 ? `## 修复指引\n\n${fixes.join('\n')}` : '';

  // Technical details
  const techLines = [];
  techLines.push(`verdict: ${verdict}`);
  techLines.push(`checks: ${JSON.stringify(checks, null, 2)}`);
  if (reportJson.regression_cases) {
    techLines.push(`regression_cases: ${JSON.stringify(reportJson.regression_cases)}`);
  }
  const techText = techLines.join('\n');

  // Fill template
  const text = template
    .replace('{{LIGHT}}', `**${light}**`)
    .replace('{{ONE_LINER}}', oneLiner)
    .replace('{{CHECKS}}', checksText)
    .replace('{{FIX_GUIDANCE}}', fixGuidance)
    .replace('{{TECHNICAL_DETAILS}}', techText);

  return { text, light: lightColor, oneLiner };
}

// ---------- Phase 2.2: eval-report rendering ----------
function renderEval(reportJson) {
  const templatePath = path.join(TEMPLATES_DIR, `eval-report.zh.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`report-renderer: template not found: ${templatePath}`);
  }
  const template = fs.readFileSync(templatePath, 'utf8');

  const verdict = reportJson.verdict || 'fail';
  const overall = reportJson.overall;
  const axes = reportJson.axes || {};
  const runnerLimited = reportJson.runner_limited;

  const light = verdict === 'pass' ? '绿' : (verdict === 'pending' ? '黄' : '红');
  const lightColor = light === '绿' ? 'green' : (light === '黄' ? 'yellow' : 'red');

  const oneLiner = verdict === 'pass'
    ? `行为评估通过（总分 ${overall}）`
    : (verdict === 'pending'
      ? `行为评估待定（runner 受限，总分 ${overall}）`
      : `行为评估未通过（总分 ${overall}）`);

  const AXIS_LABELS = {
    accuracy: '准确性', completeness: '完整性', actionability: '可执行性',
    safety: '安全性', robustness: '鲁棒性',
  };
  const axesLines = [];
  for (const [name, label] of Object.entries(AXIS_LABELS)) {
    const ax = axes[name];
    if (!ax) continue;
    const icon = ax.pending ? '○' : (ax.score >= 0.7 ? '✓' : '✗');
    const pen = ax.pending ? '（待定）' : '';
    axesLines.push(`- ${icon} ${label} (${name}): ${ax.score}${pen}`);
  }
  const axesText = axesLines.join('\n') || '（无评估轴）';

  const fixes = [];
  if (axes.safety && axes.safety.score === 0) {
    fixes.push('- **安全性**: 安全扫描未通过，请先修复 security-report 中的阻断项');
  }
  if (!runnerLimited && overall < (reportJson.threshold || 0.7)) {
    fixes.push(`- **总分**: ${overall} 低于阈值 ${reportJson.threshold || 0.7}，请改进能力输出质量`);
  }
  const fixGuidance = fixes.length > 0 ? `## 修复指引\n\n${fixes.join('\n')}` : '';

  const techLines = [];
  techLines.push(`verdict: ${verdict}`);
  techLines.push(`overall: ${overall}`);
  techLines.push(`runner: ${reportJson.runner || 'unknown'}${runnerLimited ? ' (limited)' : ''}`);
  techLines.push(`axes: ${JSON.stringify(axes)}`);
  const techText = techLines.join('\n');

  const text = template
    .replace('{{LIGHT}}', `**${light}**`)
    .replace('{{ONE_LINER}}', oneLiner)
    .replace('{{AXES}}', axesText)
    .replace('{{FIX_GUIDANCE}}', fixGuidance)
    .replace('{{TECHNICAL_DETAILS}}', techText);

  return { text, light: lightColor, oneLiner };
}

// ---------- F3: security-report rendering ----------
function renderSecurity(reportJson) {
  const templatePath = path.join(TEMPLATES_DIR, `security-report.zh.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`report-renderer: template not found: ${templatePath}`);
  }
  const template = fs.readFileSync(templatePath, 'utf8');

  const verdict = reportJson.verdict || 'block'; // security verdict is pass|block (no pending)
  const findings = reportJson.findings || [];
  const blockFindings = findings.filter((f) => f.status === 'block');
  const warnFindings = findings.filter((f) => f.status === 'warn');

  const light = verdict === 'pass' ? '绿' : '红';
  const lightColor = light === '绿' ? 'green' : 'red';

  const oneLiner = verdict === 'pass'
    ? `0 项安全阻断（共 ${findings.length} 项发现）`
    : `${blockFindings.length} 项安全阻断（共 ${findings.length} 项发现）`;

  const findingsLines = [];
  for (const f of findings) {
    const icon = f.status === 'block' ? '✗' : (f.status === 'warn' ? '○' : '✓');
    findingsLines.push(`- ${icon} ${f.rule} [${f.status}]: ${f.evidence || ''}`);
  }
  const findingsText = findingsLines.join('\n') || '（无安全发现）';

  const fixes = blockFindings.map((f) => `- **${f.rule}**: 请修复此阻断项后重新提交安全扫描`);
  const fixGuidance = fixes.length > 0 ? `## 修复指引\n\n${fixes.join('\n')}` : '';

  const techLines = [];
  techLines.push(`verdict: ${verdict}`);
  techLines.push(`findings: ${JSON.stringify(findings)}`);
  const techText = techLines.join('\n');

  const text = template
    .replace('{{LIGHT}}', `**${light}**`)
    .replace('{{ONE_LINER}}', oneLiner)
    .replace('{{FINDINGS}}', findingsText)
    .replace('{{FIX_GUIDANCE}}', fixGuidance)
    .replace('{{TECHNICAL_DETAILS}}', techText);

  return { text, light: lightColor, oneLiner };
}
