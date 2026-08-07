// adapters/cline/adapter.mjs — ClineAdapter (§22.3, Tier 2). steering 拥有.
// Cline VS Code extension: .clinerules/ for rules, .cline/mcp_settings.json for MCP.
// Supports prompt_exec / agent_file / mcp_config / config_dir_writable (Tier 2).
// skill_file / slash_command / workflow_orchestration / kb_mount / feedback_hook → manual-paste.
// 载体 D：缺 skill_file/slash_command 等点时 translate() 产非 null pasteInstructions
// （manual-paste 说明书），install.mjs 写入 paste/<project>/<capSlug>.md 供用户手动粘贴。
import fs from 'node:fs';
import path from 'node:path';
import { BaseAdapter } from '../base.mjs';
import { resolveHome, assertSlugSegment, atomicWrite, readJsonOrNullSync, isExecutableEntrypoint, EXAMPLE_MCP_NOTE } from '../../tools/paths.mjs';

function manualPasteArtifact(y, dir, name) {
  const sourcePath = y.entrypoint ? path.join(dir, y.entrypoint) : null;
  let content = sourcePath && fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
  return {
    kind: 'manual-paste',
    targetPath: null,
    content,
    mcpConfig: null,
    degradation: 'manual-paste',
    pasteInstructions: `Cline does not natively support ${y.kind} files. ` +
      `Paste the content below into a Cline custom mode / rules file manually:\n\n---\n${content}\n---`,
  };
}

export class ClineAdapter extends BaseAdapter {
  platform = 'cline';

  translate(cap, opts = {}) {
    const y = cap.yaml || cap;
    const dir = cap.dir || process.cwd();
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : path.basename(dir);
    assertSlugSegment(name, 'name');
    const home = resolveHome();

    switch (y.kind) {
      case 'agent': {
        // agent_file supported → .clinerules/<name>.md
        const targetPath = path.join(home, '.clinerules', `${name}.md`);
        const sourcePath = path.join(dir, y.entrypoint || 'source.md');
        let content = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
        return [{ kind: 'agent-file', targetPath, content, mcpConfig: null, degradation: null, pasteInstructions: null }];
      }
      case 'skill': {
        // skill_file unsupported → manual-paste.
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
        return [manualPasteArtifact(y, dir, name)];
      default:
        return [];
    }
  }

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

  async injectMcp(mcp, opts = {}) {
    const y = mcp.yaml || mcp;
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : 'unknown';
    assertSlugSegment(name, 'mcp-name');
    const cfgPath = path.join(resolveHome(), '.cline', 'mcp_settings.json');
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
      const cfgPath = path.join(resolveHome(), '.cline', 'mcp_settings.json');
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
    // Cline uses either .clinerules/ or .cline/ — detect either as the install root.
    const home = resolveHome();
    const dirs = [path.join(home, '.cline'), path.join(home, '.clinerules')];
    for (const d of dirs) {
      if (fs.existsSync(d)) {
        try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { continue; }
      }
    }
    return false;
  }
}

export const adapter = new ClineAdapter();
