// adapters/dify/adapter.mjs — DifyAdapter (§22.3, Tier 3 domestic example). steering 拥有.
// Dify (domestic, HTTP-API-only): supports only prompt_exec. Every other point
// degrades — agent/skill → http-direct (paste into Dify app prompt config),
// mcp/workflow/etc. → manual-paste. The 9×5 degradation matrix (§22.4) is encoded
// via the per-point `fallback` declarations in platform.yaml.
import fs from 'node:fs';
import path from 'node:path';
import { BaseAdapter } from '../base.mjs';
import { resolveHome } from '../../tools/paths.mjs';

function httpDirectArtifact(y, dir, name) {
  const sourcePath = y.entrypoint ? path.join(dir, y.entrypoint) : null;
  const content = sourcePath && fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
  return {
    kind: 'manual-paste',
    targetPath: null,
    content,
    mcpConfig: null,
    degradation: 'http-direct',
    pasteInstructions:
      `Dify is a Tier-3 (HTTP-API-only) platform; it has no native agent/skill file system.\n` +
      `Configure a Dify app (Chatflow / Agent) and paste the capability body below into the app's\n` +
      `system-prompt / instruction field, then expose it via the Dify HTTP API (POST /v1/chat-messages).\n\n` +
      `--- capability: ${y.id || name} ---\n${content}\n--- end ---`,
  };
}

export class DifyAdapter extends BaseAdapter {
  platform = 'dify';

  conform(cap) {
    const errors = [];
    const y = cap.yaml || cap;
    const dir = cap.dir || process.cwd();
    if (['agent', 'skill', 'mcp'].includes(y.kind)) {
      const ep = y.entrypoint;
      if (ep) {
        const epPath = path.join(dir, ep);
        if (!fs.existsSync(epPath)) errors.push(`conform: entrypoint "${ep}" not found in ${dir}`);
      }
    }
    const requires = y.requires || [];
    for (const req of requires) {
      if (req.severity === 'hard') {
        const res = this.supports(req.point);
        if (!res.supported) errors.push(`conform: requires:hard point "${req.point}" not supported on platform "${this.platform}" (degrades to ${res.fallback})`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  translate(cap, opts = {}) {
    const y = cap.yaml || cap;
    const dir = cap.dir || process.cwd();
    const capId = y.id || '';
    const parts = capId.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 1] : path.basename(dir);
    switch (y.kind) {
      case 'agent':
      case 'skill':
      case 'workflow':
        // agent_file / skill_file / workflow_orchestration unsupported → http-direct.
        return [httpDirectArtifact(y, dir, name)];
      case 'mcp':
        // mcp_config unsupported → manual-paste.
        return [{
          kind: 'manual-paste', targetPath: null, content: '', mcpConfig: null,
          degradation: 'manual-paste',
          pasteInstructions: `Dify does not support MCP server config injection. Configure the MCP connector in the Dify app UI manually.`,
        }];
      default:
        return [];
    }
  }

  async install(artifacts, opts = {}) {
    // Tier-3: no native install targets; all artifacts are paste-instructions.
    return { artifacts: [] };
  }

  async injectMcp(mcp, opts = {}) {
    // mcp_config unsupported on Tier-3.
    return { mcp_keys: [] };
  }

  async uninstall(capId, opts = {}) {
    return { uninstalled: [] };
  }

  detect() {
    // Dify has no local config dir; detect() is always false (remote HTTP platform).
    return false;
  }
}

export const adapter = new DifyAdapter();
