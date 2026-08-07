// adapters/codex/adapter.mjs — CodexAdapter (§22.3, Tier 2). steering 拥有.
// OpenAI Codex CLI: ~/.codex/ config. Supports prompt_exec / mcp_config / config_dir_writable.
// agent_file / skill_file / slash_command / workflow_orchestration / kb_mount / feedback_hook
// degrade to manual-paste (Tier 2). The 9-points × 5-strategy matrix lives in §22.4.
import fs from 'node:fs';
import path from 'node:path';
import { BaseAdapter } from '../base.mjs';
import { resolveHome, assertSlugSegment, atomicWrite, readJsonOrNullSync, isExecutableEntrypoint, EXAMPLE_MCP_NOTE } from '../../tools/paths.mjs';

// Points that degrade to manual-paste on codex (not natively supported).
const MANUAL_PASTE_POINTS = new Set(['agent_file', 'skill_file', 'slash_command', 'workflow_orchestration', 'kb_mount', 'feedback_hook']);

function manualPasteArtifact(y, dir, name) {
  const sourcePath = y.entrypoint ? path.join(dir, y.entrypoint) : null;
  let content = sourcePath && fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
  return {
    kind: 'manual-paste',
    targetPath: null,
    content,
    mcpConfig: null,
    degradation: 'manual-paste',
    pasteInstructions: `Codex does not natively support ${y.kind} files. ` +
      `Paste the content below into your Codex session / AGENTS.md manually:\n\n---\n${content}\n---`,
  };
}

export class CodexAdapter extends BaseAdapter {
  platform = 'codex';

  translate(cap, opts = {}) {
    const y = cap.yaml || cap;
    const dir = cap.dir || process.cwd();
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : path.basename(dir);
    assertSlugSegment(name, 'name');

    switch (y.kind) {
      case 'agent':
      case 'skill': {
        // agent_file / skill_file unsupported → manual-paste degradation.
        return [manualPasteArtifact(y, dir, name)];
      }
      case 'mcp': {
        const entry = {};
        if (y.transport) entry.type = y.transport;
        if (y.transport === 'stdio') { entry.command = 'node'; entry.args = [path.join(dir, y.entrypoint || 'source.md')]; }
        if (y.config_template && Array.isArray(y.config_template.auth_schema)) {
          const env = {};
          for (const v of y.config_template.auth_schema) env[v] = `\${${v}}`;
          entry.env = env;
        }
        return [{ kind: 'mcp-config-merge', targetPath: null, content: null, mcpConfig: null, degradation: null, pasteInstructions: null }];
      }
      case 'workflow':
        // workflow_orchestration unsupported → manual-paste.
        return [manualPasteArtifact(y, dir, name)];
      default:
        return [];
    }
  }

  async install(artifacts, opts = {}) {
    const written = [];
    for (const a of artifacts) {
      if (a.kind === 'mcp-config-merge') continue;
      if (a.kind === 'manual-paste') continue; // instructions-only, nothing to write
      if (!a.targetPath || a.content === undefined || a.content === null) continue;
      await atomicWrite(a.targetPath, a.content);
      written.push(a.targetPath);
    }
    return { artifacts: written };
  }

  async injectMcp(mcp, opts = {}) {
    const y = mcp.yaml || mcp;
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : 'unknown';
    assertSlugSegment(name, 'mcp-name');
    const cfgPath = path.join(resolveHome(), '.codex', 'config.json');
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
    config.mcpServers[name] = entry;
    if (!isExecutableEntrypoint(y.entrypoint)) {
      config._opsforge_notes = config._opsforge_notes || {};
      config._opsforge_notes[name] = EXAMPLE_MCP_NOTE;
    }
    await atomicWrite(cfgPath, JSON.stringify(config, null, 2));
    return { mcp_keys: [name] };
  }

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
      const cfgPath = path.join(resolveHome(), '.codex', 'config.json');
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

  detect() {
    const dir = path.join(resolveHome(), '.codex');
    if (!fs.existsSync(dir)) return false;
    try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
  }
}

export const adapter = new CodexAdapter();
