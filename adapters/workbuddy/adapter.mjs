// adapters/workbuddy/adapter.mjs — WorkBuddyAdapter (§22.3, Tier 2). steering 拥有.
// WorkBuddy: ~/.workbuddy/skills/<name>/SKILL.md (skill_file+slash_command),
// ~/.workbuddy/mcp.json mcpServers (mcp_config), ~/.workbuddy/ writable (config_dir).
// agent_file unsupported → agent 适配为 skill (cli-engine 降级，优于 cline manual-paste).
// workflow_orchestration unsupported → 引导式 skill (cli-engine 降级).
// kb_mount/feedback_hook unsupported → manual-paste (由 install.mjs F4 写 paste 文件).
// 载体 D：缺 kb_mount/feedback_hook 时 translate() 产非 null pasteInstructions.
import fs from 'node:fs';
import path from 'node:path';
import { BaseAdapter } from '../base.mjs';
import { resolveHome, assertSlugSegment, atomicWrite, readJsonOrNullSync, isExecutableEntrypoint, EXAMPLE_MCP_NOTE } from '../../tools/paths.mjs';

const SKILLS_DIR = 'skills';
const MCP_FILE = 'mcp.json';
const SKILL_PREFIX = 'opsforge-';

/** Strip leading YAML frontmatter (--- ... ---) from raw text, return body. */
function stripFrontmatter(raw) {
  if (raw.startsWith('---')) {
    const closeIdx = raw.indexOf('\n---', 3);
    if (closeIdx !== -1) return raw.slice(closeIdx + 4).replace(/^\r?\n/, '');
  }
  return raw;
}

/** YAML-escape a string value for double-quoted scalar. */
function yamlEscape(s) {
  return String(s || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/**
 * Build WorkBuddy SKILL.md content with WorkBuddy-native frontmatter
 * (summary/description/read_when per WorkBuddy skill spec).
 * @param {Object} y  parsed capability.yaml
 * @param {string} dir  capability source dir
 * @param {string} name  capability name (last segment of capId)
 * @param {string} kindLabel  label for "类型" line (agent/skill/workflow)
 */
function buildSkillContent(y, dir, name, kindLabel) {
  const entrypoint = y.entrypoint || (y.kind === 'skill' ? 'SKILL.md' : 'source.md');
  const sourcePath = path.join(dir, entrypoint);
  let body = '';
  if (fs.existsSync(sourcePath)) {
    body = stripFrontmatter(fs.readFileSync(sourcePath, 'utf8'));
  }
  const displayName = y.display_name_zh || y.display_name || name;
  const description = y.description || displayName;
  const capId = y.id || name;
  const version = y.version || '1.0.0';
  return `---\nsummary: "${yamlEscape(displayName)}"\ndescription: "${yamlEscape(description)}"\nread_when:\n  - "用户需要 ${yamlEscape(displayName)} 相关能力"\n  - "OpsForge 能力: ${yamlEscape(capId)}"\n---\n\n# ${displayName}\n\n> 来源: OpsForge 能力仓 \`${capId}\` (v${version})\n> 类型: ${kindLabel}\n\n${body}\n\n## 适配说明\n\n本能力从 OpsForge ${kindLabel} 适配为 WorkBuddy skill。可通过 skill 自动触发或手动调用 (\`/${SKILL_PREFIX}${name}\`)。如果本能力涉及运行 OpsForge 工具链命令，请确保 OpsForge 仓库存在于本地。\n`;
}

/** Build a guided-step skill body for workflow kind (workflow_orchestration unsupported). */
function buildWorkflowSkillContent(y, dir, name) {
  const displayName = y.display_name_zh || y.display_name || name;
  const description = y.description || displayName;
  const capId = y.id || name;
  const version = y.version || '1.0.0';
  const steps = Array.isArray(y.steps) ? y.steps : [];
  const stepsText = steps.map((s, i) => {
    const sid = s.id || `step-${i + 1}`;
    const cap = s.capability || 'N/A';
    return `### 步骤 ${i + 1}: ${sid}\n- 调用能力: \`${cap}\``;
  }).join('\n\n');
  return `---\nsummary: "${yamlEscape(displayName)}"\ndescription: "${yamlEscape(description)}"\nread_when:\n  - "用户需要 ${yamlEscape(displayName)} 相关能力"\n  - "OpsForge 工作流: ${yamlEscape(capId)}"\n---\n\n# ${displayName}（工作流）\n\n> 来源: OpsForge 能力仓 \`${capId}\` (v${version})\n> 类型: workflow (已适配为 WorkBuddy 引导式 skill)\n\n## 能力说明\n\n${description}\n\n## 工作流步骤\n\n${stepsText || '（无步骤定义）'}\n\n## 运行指令\n\n这是一个 OpsForge 工作流能力，已适配为 WorkBuddy 引导式 skill。按上述步骤顺序执行，每步调用对应的 OpsForge 能力。可通过 \`/${SKILL_PREFIX}${name}\` 手动触发。\n`;
}

export class WorkBuddyAdapter extends BaseAdapter {
  platform = 'workbuddy';

  /**
   * translate: OpsForge 能力 → WorkBuddy 原生格式.
   *   agent   → skill-file (~/.workbuddy/skills/opsforge-<name>/SKILL.md, cli-engine 降级)
   *   skill   → skill-file (原样)
   *   mcp     → mcp-config-merge (由 injectMcp 处理实际写入)
   *   workflow → skill-file (引导式 skill, cli-engine 降级)
   */
  translate(cap, opts = {}) {
    const y = cap.yaml || cap;
    const dir = cap.dir || process.cwd();
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : path.basename(dir);
    assertSlugSegment(name, 'name');
    const skillName = `${SKILL_PREFIX}${name}`;
    const skillPath = path.join(resolveHome(), '.workbuddy', SKILLS_DIR, skillName, 'SKILL.md');

    switch (y.kind) {
      case 'agent':
        return [{ kind: 'skill-file', targetPath: skillPath, content: buildSkillContent(y, dir, name, 'agent'), mcpConfig: null, degradation: 'cli-engine', pasteInstructions: null }];
      case 'skill':
        return [{ kind: 'skill-file', targetPath: skillPath, content: buildSkillContent(y, dir, name, 'skill'), mcpConfig: null, degradation: null, pasteInstructions: null }];
      case 'mcp': {
        // MCP 不产文件 artifact；由 injectMcp 合并到 ~/.workbuddy/mcp.json。
        // mcpConfig 设为 null：install.mjs 从不消费 translate 返回的 mcpConfig（grep 确认
        // 全平台 adapter 的 translate mcpConfig 字段都是死字段，injectMcp 才是真实写入路径）。
        // 与本 adapter 的 agent/skill/workflow case 一致（均 mcpConfig:null）。
        // 跨平台 cline/codex/claude-code/cursor 仍返回 {servers:{}} 死字段——见 review 报告
        // （不顺带重构，守纪律）。
        return [{ kind: 'mcp-config-merge', targetPath: null, content: null, mcpConfig: null, degradation: null, pasteInstructions: null }];
      }
      case 'workflow':
        // S6: workflow_orchestration 不支持时 install.mjs 走 adapter.translate() 而非 compile()。
        // 落引导式 skill (cli-engine 降级)。
        return [{ kind: 'skill-file', targetPath: skillPath, content: buildWorkflowSkillContent(y, dir, name), mcpConfig: null, degradation: 'cli-engine', pasteInstructions: null }];
      default:
        return [];
    }
  }

  /** install: 写入 skill 文件到 ~/.workbuddy/skills/。跳过 mcp-config-merge（injectMcp 处理）+ manual-paste（F4 处理）。 */
  async install(artifacts, opts = {}) {
    const written = [];
    for (const a of artifacts) {
      if (a.kind === 'mcp-config-merge') continue;
      if (a.kind === 'manual-paste') continue;
      if (!a.targetPath || a.content === undefined || a.content === null) continue;
      await atomicWrite(a.targetPath, a.content);
      written.push(a.targetPath);
    }
    return { artifacts: written };
  }

  /** injectMcp: 把 MCP server 配置合并到 ~/.workbuddy/mcp.json mcpServers。 */
  async injectMcp(mcp, opts = {}) {
    const y = mcp.yaml || mcp;
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : 'unknown';
    assertSlugSegment(name, 'mcp-name');
    const cfgPath = path.join(resolveHome(), '.workbuddy', MCP_FILE);
    let config = readJsonOrNullSync(cfgPath) || {};
    if (!config.mcpServers) config.mcpServers = {};
    const entry = {};
    if (y.transport) entry.type = y.transport;
    if (y.transport === 'stdio') { entry.command = 'node'; entry.args = [path.join(mcp.dir || '.', y.entrypoint || 'source.md')]; }
    if (y.config_template && Array.isArray(y.config_template.auth_schema)) {
      const env = {};
      for (const v of y.config_template.auth_schema) env[v] = `\${${v}}`;
      entry.env = env;
    }
    const key = `${SKILL_PREFIX}${name}`;
    config.mcpServers[key] = entry;
    if (!isExecutableEntrypoint(y.entrypoint)) {
      config._opsforge_notes = config._opsforge_notes || {};
      config._opsforge_notes[key] = EXAMPLE_MCP_NOTE;
    }
    await atomicWrite(cfgPath, JSON.stringify(config, null, 2));
    return { mcp_keys: [key] };
  }

  /** uninstall: 删除 skill 文件 + 移除 MCP 配置 key。 */
  async uninstall(capId, opts = {}) {
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : capId;
    const removed = [];
    if (opts.artifacts) {
      for (const f of opts.artifacts) {
        try { if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(f); } } catch { /* best-effort */ }
      }
    }
    if (opts.mcp_keys && opts.mcp_keys.length) {
      const cfgPath = path.join(resolveHome(), '.workbuddy', MCP_FILE);
      let config = readJsonOrNullSync(cfgPath) || {};
      if (config.mcpServers) {
        for (const key of opts.mcp_keys) {
          if (config.mcpServers[key]) { delete config.mcpServers[key]; removed.push(`mcp:${key}`); }
          if (config._opsforge_notes && config._opsforge_notes[key]) { delete config._opsforge_notes[key]; }
        }
        await atomicWrite(cfgPath, JSON.stringify(config, null, 2));
      }
    }
    return { uninstalled: removed };
  }

  /** detect: 检查 ~/.workbuddy/ 是否存在且可写。 */
  detect() {
    const dir = path.join(resolveHome(), '.workbuddy');
    if (!fs.existsSync(dir)) return false;
    try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
  }
}

export const adapter = new WorkBuddyAdapter();
