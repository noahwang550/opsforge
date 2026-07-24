// adapters/claude-code/adapter.mjs — ClaudeCodeAdapter (§6.2/§22.3/§A.2). steering 拥有。
import fs from 'node:fs';
import path from 'node:path';
import { BaseAdapter } from '../base.mjs';
import { resolveHome, assertSlugSegment, atomicWrite, readJsonOrNullSync } from '../../tools/paths.mjs';

export class ClaudeCodeAdapter extends BaseAdapter {
  platform = 'claude-code';

  /** §6.1 + §7.2 translate:
   *   agent → agent-file artifact at ~/.claude/agents/<name>.md
   *   skill → skill-file artifact at ~/.claude/skills/<name>/SKILL.md
   *   mcp   → mcp-config-merge artifact
   *   workflow → workflow-command artifact at ~/.claude/commands/workflow-<name>.md
   *  载体 D 说明：Tier 1（claude-code/cursor）拥有 agent_file+skill_file+slash_command，
   *  能力直接落盘到平台 config dir，故 pasteInstructions 恒为 null——这是正确设计，勿改坏。
   *  Tier 2/3 平台（cline/codex/dify）缺文件落盘点时产非 null pasteInstructions（载体 D 说明书），
   *  由 install.mjs 写入 paste/<project>/<capSlug>.md。
   *  @param {Object} cap
   *  @param {Object} opts
   *  @returns {Array} PlatformArtifact[] */
  translate(cap, opts = {}) {
    const y = cap.yaml || cap;
    const dir = cap.dir || process.cwd();
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : (cap.name || path.basename(dir));
    assertSlugSegment(name, 'name');

    const home = resolveHome();
    const claudeDir = path.join(home, '.claude');

    switch (y.kind) {
      case 'agent': {
        const targetPath = path.join(claudeDir, 'agents', `${name}.md`);
        const sourcePath = path.join(dir, y.entrypoint || 'source.md');
        let content = '';
        if (fs.existsSync(sourcePath)) {
          content = fs.readFileSync(sourcePath, 'utf8');
        }
        return [{ kind: 'agent-file', targetPath, content, mcpConfig: null, degradation: null, pasteInstructions: null }];
      }
      case 'skill': {
        const targetPath = path.join(claudeDir, 'skills', name, 'SKILL.md');
        const sourcePath = path.join(dir, y.entrypoint || 'SKILL.md');
        let content = '';
        if (fs.existsSync(sourcePath)) {
          content = fs.readFileSync(sourcePath, 'utf8');
        }
        return [{ kind: 'skill-file', targetPath, content, mcpConfig: null, degradation: null, pasteInstructions: null }];
      }
      case 'mcp': {
        const mcpConfig = { servers: {} };
        const serverName = name;
        const serverEntry = {};
        if (y.transport) serverEntry.type = y.transport;
        if (y.transport === 'stdio') {
          serverEntry.command = 'node';
          serverEntry.args = [path.join(dir, y.entrypoint || 'source.md')];
        }
        // env whitelist from config_template.auth_schema
        if (y.config_template && Array.isArray(y.config_template.auth_schema)) {
          const env = {};
          for (const envVar of y.config_template.auth_schema) {
            env[envVar] = `\${${envVar}}`;
          }
          serverEntry.env = env;
        }
        mcpConfig.servers[serverName] = serverEntry;
        return [{ kind: 'mcp-config-merge', targetPath: null, content: null, mcpConfig, degradation: null, pasteInstructions: null }];
      }
      case 'workflow': {
        // P1-4: workflow translate is handled by install.mjs calling
        // workflow-compile.mjs directly. The adapter returns [] here;
        // install.mjs overrides with the compiled artifact.
        return [];
      }
      default:
        return [];
    }
  }

  /** §8 atomic idempotent write to ~/.claude/.
   *  @param {Array} artifacts
   *  @param {Object} opts
   *  @returns {{artifacts: string[]}} written artifact paths */
  async install(artifacts, opts = {}) {
    const written = [];
    for (const a of artifacts) {
      if (a.kind === 'mcp-config-merge') continue; // handled by injectMcp
      if (!a.targetPath || a.content === undefined || a.content === null) continue;
      await atomicWrite(a.targetPath, a.content);
      written.push(a.targetPath);
    }
    return { artifacts: written };
  }

  /** §9.2 idempotent merge into ~/.claude.json mcpServers.
   *  @param {Object} mcp  parsed mcp.yaml (or the capability with kind=mcp)
   *  @param {Object} opts
   *  @returns {{mcp_keys: string[]}} */
  async injectMcp(mcp, opts = {}) {
    const y = mcp.yaml || mcp;
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : 'unknown';
    assertSlugSegment(name, 'mcp-name');

    const claudeJsonPath = path.join(resolveHome(), '.claude.json');
    let config = readJsonOrNullSync(claudeJsonPath) || {};
    if (!config.mcpServers) config.mcpServers = {};

    const serverEntry = {};
    if (y.transport) serverEntry.type = y.transport;
    if (y.transport === 'stdio') {
      serverEntry.command = 'node';
      serverEntry.args = [path.join(mcp.dir || '.', y.entrypoint || 'source.md')];
    }
    if (y.config_template && Array.isArray(y.config_template.auth_schema)) {
      const env = {};
      for (const envVar of y.config_template.auth_schema) {
        env[envVar] = `\${${envVar}}`;
      }
      serverEntry.env = env;
    }

    config.mcpServers[name] = serverEntry;
    await atomicWrite(claudeJsonPath, JSON.stringify(config, null, 2));
    return { mcp_keys: [name] };
  }

  /** Reverse-by-manifest: remove entries whose id matches.
   *  @param {string} capId  <pack>.<name>
   *  @param {Object} opts  with manifest entry (artifacts[], mcp_keys[]) */
  async uninstall(capId, opts = {}) {
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : capId;
    const removed = [];

    // Remove artifact files
    if (opts.artifacts) {
      for (const f of opts.artifacts) {
        try {
          if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          removed.push(f);
          }
        } catch { /* best-effort */ }
      }
    }

    // Remove mcp keys from ~/.claude.json
    if (opts.mcp_keys && opts.mcp_keys.length) {
      const claudeJsonPath = path.join(resolveHome(), '.claude.json');
      let config = readJsonOrNullSync(claudeJsonPath) || {};
      if (config.mcpServers) {
        for (const key of opts.mcp_keys) {
          if (config.mcpServers[key]) {
            delete config.mcpServers[key];
            removed.push(`mcp:${key}`);
          }
        }
        await atomicWrite(claudeJsonPath, JSON.stringify(config, null, 2));
      }
    }
    return { uninstalled: removed };
  }

  /** §8.4: check ~/.claude/ exists & writable. */
  detect() {
    const claudeDir = path.join(resolveHome(), '.claude');
    if (!fs.existsSync(claudeDir)) return false;
    try {
      fs.accessSync(claudeDir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export const adapter = new ClaudeCodeAdapter();
