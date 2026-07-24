// tools/security-scan.mjs — §B.1 P1 minimal subset (3 non-exceptionable families).
// Full §B (over-privileged tools, supply-chain, MCP tool-surface, dep advisories,
// data-residency-cn) deferred to Phase 3.3.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 3 non-exceptionable families
const SECRET_PATTERNS = [
  { regex: /AKIA[0-9A-Z]{16}/, rule: 'hardcoded_secret', label: 'AWS access key' },
  { regex: /ghp_[A-Za-z0-9]{36}/, rule: 'hardcoded_secret', label: 'GitHub PAT' },
  { regex: /sk-[a-zA-Z0-9]{20,}/, rule: 'hardcoded_secret', label: 'API secret (sk-)' },
  { regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/, rule: 'hardcoded_secret', label: 'private key block' },
  { regex: /(mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@/, rule: 'hardcoded_secret', label: 'connection string with credentials' },
];

const INJECTION_PATTERNS = [
  { regex: /忽略以上指令|忽略上面的指令/, rule: 'prompt_injection', label: 'ignore previous instructions (zh)' },
  { regex: /以管理员身份/, rule: 'prompt_injection', label: 'claim admin role (zh)' },
  { regex: /删除所有/, rule: 'prompt_injection', label: 'delete all (zh)' },
  { regex: /覆盖系统提示/, rule: 'prompt_injection', label: 'overwrite system prompt (zh)' },
  { regex: /ignore previous instructions/i, rule: 'prompt_injection', label: 'ignore previous instructions (en)' },
  { regex: /you are (a |an )?(sysadmin|administrator|root)\b/i, rule: 'prompt_injection', label: 'claim admin role (en)' },
  { regex: /do not follow (the )?rules/i, rule: 'prompt_injection', label: 'disregard rules (en)' },
];

const SSRF_PATTERNS = [
  { regex: /169\.254\.169\.254/, rule: 'ssrf_private_network', label: 'AWS metadata endpoint' },
  { regex: /\b127\./, rule: 'ssrf_private_network', label: 'loopback address' },
  { regex: /\b10\.\d+\.\d+\.\d+/, rule: 'ssrf_private_network', label: 'private network 10/8' },
  { regex: /\b192\.168\./, rule: 'ssrf_private_network', label: 'private network 192.168/16' },
  { regex: /\.internal\b/, rule: 'ssrf_private_network', label: 'internal domain' },
];

// Phase 3.3: data-residency-cn — domestic-model endpoints (warn, NOT block).
const DATA_RESIDENCY_CN_PATTERNS = [
  { regex: /dashscope\.aliyuncs\.com/i, label: 'Aliyun DashScope (domestic)' },
  { regex: /aip\.baidubce\.com/i, label: 'Baidu Qianfan (domestic)' },
  { regex: /ernie-bot|wenxin/i, label: 'Baidu ERNIE/Wenxin (domestic)' },
  { regex: /api\.minimax\.chat/i, label: 'MiniMax (domestic)' },
  { regex: /dify\.cn|dify-chat/i, label: 'Dify CN (domestic)' },
  { regex: /api\.deepseek\.com/i, label: 'DeepSeek (domestic)' },
];

// Phase 3.3: supply-chain — unpinned git URLs (block).
const SUPPLY_CHAIN_PATTERNS = [
  { regex: /git\+(https?|ssh):\/\/[^\s"']+\.git(?!@)/, rule: 'supply_chain_unpinned', label: 'unpinned git URL (no @commit)' },
  { regex: /git clone [^\s"']+(?!@)/, rule: 'supply_chain_unpinned', label: 'bare git clone (no pin)' },
];

// Phase 3.3: over-privileged MCP tools — tool names/surfaces that grant excessive power.
const OVERPRIVILEGED_TOOL_PATTERNS = [
  { regex: /^(exec_command|run_command|execute_command|shell|bash|sh_exec|terminal)$/i, label: 'arbitrary command execution tool' },
  { regex: /^(write_file|delete_file|remove_file|rm_file|overwrite_file| filesystem)$/i, label: 'unscoped filesystem write/delete tool' },
  { regex: /^(eval|eval_js|run_js|eval_python)$/i, label: 'arbitrary code evaluation tool' },
  { regex: /^(http_request|fetch_url|curl|wget)$/i, label: 'unscoped outbound HTTP tool (SSRF surface)' },
];

const ALL_PATTERNS = [...SECRET_PATTERNS, ...INJECTION_PATTERNS, ...SSRF_PATTERNS];

function walkFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(p, base));
    else out.push({ rel: path.relative(base, p).split(path.sep).join('/'), full: p });
  }
  return out;
}

/**
 * @param {string} capDir
 * @returns {SecurityReport}
 */
export function scan(capDir) {
  if (!fs.existsSync(capDir)) {
    throw new Error(`security-scan: capDir not found: ${capDir}`);
  }

  // P0-5: derive id from parsed capability yaml (e.g. marketing-team.copywriter),
  // fall back to basename only if parse fails.
  let id = path.basename(capDir);
  try {
    const manifestFiles = ['capability.yaml', 'SKILL.md', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml'];
    for (const f of manifestFiles) {
      const p = path.join(capDir, f);
      if (fs.existsSync(p)) {
        let raw = fs.readFileSync(p, 'utf8');
        if (f.endsWith('.md')) {
          const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (m) raw = m[1];
        }
        const parsed = yaml.load(raw, { filename: p });
        if (parsed && parsed.id) { id = parsed.id; break; }
      }
    }
  } catch { /* fall back to basename */ }

  const origin = 'original';
  const findings = [];

  const files = walkFiles(capDir);
  for (const f of files) {
    // Skip binary-ish files and test fixtures
    const ext = path.extname(f.rel).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.lock'].includes(ext)) continue;

    const content = fs.readFileSync(f.full, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const pat of ALL_PATTERNS) {
        if (pat.regex.test(lines[i])) {
          findings.push({
            rule: pat.rule,
            severity: 'high',
            evidence: `${f.rel}:${i + 1}: ${lines[i].trim().slice(0, 100)}`,
            status: 'block',
          });
        }
      }
      // Phase 3.3: data-residency-cn (warn — non-exceptionable, does not block).
      for (const pat of DATA_RESIDENCY_CN_PATTERNS) {
        if (pat.regex.test(lines[i])) {
          findings.push({
            rule: 'data_residency_cn',
            severity: 'low',
            evidence: `${f.rel}:${i + 1}: ${pat.label}: ${lines[i].trim().slice(0, 100)}`,
            status: 'warn',
          });
        }
      }
      // Phase 3.3: supply-chain (block).
      for (const pat of SUPPLY_CHAIN_PATTERNS) {
        if (pat.regex.test(lines[i])) {
          findings.push({
            rule: pat.rule,
            severity: 'high',
            evidence: `${f.rel}:${i + 1}: ${pat.label}: ${lines[i].trim().slice(0, 100)}`,
            status: 'block',
          });
        }
      }
    }
  }

  // Phase 3.3: over-privileged MCP tool surface (structured mcp.yaml analysis).
  const mcpYamlPath = path.join(capDir, 'mcp.yaml');
  if (fs.existsSync(mcpYamlPath)) {
    try {
      const mcp = yaml.load(fs.readFileSync(mcpYamlPath, 'utf8'));
      for (const tool of (mcp.tools || [])) {
        if (!tool || !tool.name) continue;
        for (const pat of OVERPRIVILEGED_TOOL_PATTERNS) {
          if (pat.regex.test(tool.name)) {
            findings.push({
              rule: 'overprivileged_tool',
              severity: 'high',
              evidence: `mcp.yaml tools[]: ${pat.label} (name="${tool.name}")`,
              status: 'block',
            });
          }
        }
      }
    } catch { /* unparseable mcp.yaml — skip structured checks */ }
  }

  // verdict: block if any block finding; warn-only → pass (warn-not-block per §22.6).
  const hasBlock = findings.some((f) => f.status === 'block');
  const verdict = hasBlock ? 'block' : 'pass';
  return {
    id,
    origin,
    findings,
    verdict,
    exceptions: [],
  };
}

/** CLI: `node tools/security-scan.mjs <capDir> | --all` */
export function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/security-scan.mjs <capDir> | --all');
    process.exit(2);
  }

  if (argv[0] === '--all') {
    (async () => {
      const { scanCapabilities } = await import('./validate.mjs');
      const caps = scanCapabilities(process.cwd());
      let allPass = true;
      for (const cap of caps) {
        if (!cap.yaml) continue;
        const report = scan(cap.dir);
        // P0-5: write security-report.json per cap dir
        atomicWriteSync(path.join(cap.dir, 'security-report.json'), JSON.stringify(report, null, 2));
        const tag = report.verdict === 'pass' ? 'PASS' : 'BLOCK';
        if (tag === 'BLOCK') allPass = false;
        console.log(`${tag}  ${cap.yaml.id}  (${report.findings.length} findings)`);
        for (const f of report.findings) {
          console.log(`       ${f.rule}: ${f.evidence}`);
        }
      }
      process.exit(allPass ? 0 : 1);
    })();
  } else {
    const capDir = path.resolve(argv[0]);
    try {
      const report = scan(capDir);
      // P0-5: write security-report.json into cap dir
      atomicWriteSync(path.join(capDir, 'security-report.json'), JSON.stringify(report, null, 2));
      for (const f of report.findings) {
        console.log(`BLOCK  ${f.rule}: ${f.evidence}`);
      }
      console.log(`\nverdict: ${report.verdict} (${report.findings.length} findings)`);
      process.exit(report.verdict === 'pass' ? 0 : 1);
    } catch (e) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
  }
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('security-scan.mjs');
if (invokedDirect) { main(); }
