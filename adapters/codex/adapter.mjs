// adapters/codex/adapter.mjs — CodexAdapter (§22.3, Tier 1). steering 拥有.
// OpenAI Codex native landing (all formats verified against this machine's live
// ~/.codex samples — see docs/codex-compat-gap-analysis.md):
//   agent    → ~/.codex/agents/<slug>.toml   (name + description + developer_instructions)
//   skill    → ~/.codex/skills/<name>/       (SKILL.md + scripts/; tests/CHANGELOG/README excluded)
//              + mirror into ~/.agents/skills/<name>/ when that root already exists
//              (Codex desktop loads skills from that root; detect-only, never created)
//   workflow → ~/.codex/prompts/workflow-<name>.md  (invocable as /workflow-<name>)
//   mcp      → ~/.codex/config.toml [mcp_servers.<name>] block-level upsert (TOML, byte-preserving)
// workflow_orchestration / kb_mount / feedback_hook stay unsupported (honest matrix, §22.4).
import fs from 'node:fs';
import path from 'node:path';
import { BaseAdapter } from '../base.mjs';
import { resolveHome, assertSlugSegment, atomicWrite, isExecutableEntrypoint, EXAMPLE_MCP_NOTE } from '../../tools/paths.mjs';

// ---------------------------------------------------------------------------
// TOML serialization helpers (zero-dependency; block-level, not a full parser)
// ---------------------------------------------------------------------------

/** True when the string carries a C0 control char or DEL (forbidden in TOML strings). */
function hasControl(s) {
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/** Strip C0 control chars + DEL. keepTabLf=true keeps tab and LF (multi-line bodies). */
function stripControl(s, keepTabLf) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c === 127) continue;
    if (c < 32) {
      if (keepTabLf && (c === 9 || c === 10)) out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Escape a value for a TOML single-line basic string ("..."). Collapses newlines. */
function tomlBasicString(v) {
  return stripControl(String(v ?? '').replace(/[\r\n]+/g, ' '), false)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/** Escape a value for a TOML literal string ('...'). Falls back to a basic string when
 *  the value contains a single quote or control chars (literal strings cannot embed them). */
function tomlString(v) {
  const s = String(v ?? '');
  if (s.indexOf("'") === -1 && !hasControl(s)) return `'${s}'`;
  return `"${tomlBasicString(s)}"`;
}

/** Escape body text for a TOML multi-line basic string ("""..."""):
 *  backslash first, then any """ run, then strip control chars (keep \t \n). */
function tomlMultiLineEscape(v) {
  return stripControl(String(v ?? '').replace(/\r\n/g, '\n'), true)
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '\\"""');
}

/** Strip a leading `---\n...\n---\n` YAML frontmatter block; return the body. */
function stripFrontmatter(raw) {
  if (!raw || !raw.startsWith('---')) return raw || '';
  const closeIdx = raw.indexOf('\n---', 3);
  if (closeIdx === -1) return raw;
  return raw.slice(closeIdx + 4).replace(/^\r?\n/, '');
}

/** Serialize an OpsForge agent source.md into a Codex agent TOML file
 *  (3-field shape verified against ~/.codex/agents/capability-distiller.toml). */
export function toCodexAgentToml(raw, name, y) {
  const body = tomlMultiLineEscape(stripFrontmatter(raw));
  const description = (y && y.description) || (y && y.display_name) || name;
  return `name = "${tomlBasicString(name)}"\n` +
    `description = "${tomlBasicString(description)}"\n` +
    `developer_instructions = """\n${body}\n"""\n`;
}

/** Synthesize a Codex custom-prompt markdown for a workflow.yaml.
 *  workflow.yaml has no source-md pointer field, so the prompt body is rendered
 *  deterministically from display_name/description/steps (never fails). */
export function renderCodexWorkflowPrompt(y, name) {
  const displayName = (y && y.display_name) || name;
  const description = (y && y.description) || displayName;
  const steps = Array.isArray(y && y.steps) ? y.steps : [];
  const lines = [];
  lines.push(`# Workflow: ${displayName}`);
  lines.push('');
  lines.push(String(description));
  lines.push('');
  if (steps.length > 0) {
    lines.push('Execute the following steps in order:');
    lines.push('');
    steps.forEach((s, i) => {
      lines.push(`${i + 1}. **${s.id}** — invoke capability \`${s.capability}\`.`);
      if (s.inputs && Object.keys(s.inputs).length > 0) {
        for (const [k, v] of Object.entries(s.inputs)) lines.push(`   - input ${k}: ${JSON.stringify(v)}`);
      }
      if (s.outputs && s.outputs.length > 0) lines.push(`   - expected outputs: ${s.outputs.join(', ')}`);
    });
    lines.push('');
  }
  lines.push(`Persist per-run state to \`~/.opsforge/runs/${(y && y.id) || name}/<run-id>/\` after each step.`);
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// TOML block-level upsert/delete for [mcp_servers.<name>] in config.toml
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate the [mcp_servers.<name>] block in TOML text.
 * Block = any contiguous `# opsforge-note:` comment lines directly above the header
 * + the header line + everything up to (excluding) the next table header that is NOT
 * a `[mcp_servers.<name>.<sub>]` sub-table (so `.env` children are swallowed).
 * @returns {{start: number, end: number}|null} char offsets into `text`, or null.
 */
function findMcpServerBlock(text, name) {
  const esc = escapeRegExp(name);
  const headerRe = new RegExp(`^[ \\t]*\\[mcp_servers\\.${esc}\\][ \\t]*(?=\\r?$)`, 'm');
  const m = headerRe.exec(text);
  if (!m) return null;
  let start = m.index;
  // swallow contiguous opsforge-note comment lines directly above the header
  for (;;) {
    const before = text.slice(0, start);
    const nm = /(^|\n)([ \t]*# opsforge-note:[^\n]*)\r?\n$/.exec(before);
    if (!nm) break;
    start = before.length - nm[0].length + (nm[1] === '\n' ? 1 : 0);
  }
  // scan forward for the first header line that is not our own sub-table
  const subRe = new RegExp(`^[ \\t]*\\[mcp_servers\\.${esc}\\.`);
  const anyHeaderRe = /^[ \t]*\[/gm;
  anyHeaderRe.lastIndex = m.index + m[0].length;
  let end = text.length;
  let hm;
  while ((hm = anyHeaderRe.exec(text)) !== null) {
    const lineEnd = text.indexOf('\n', hm.index);
    const line = text.slice(hm.index, lineEnd === -1 ? text.length : lineEnd);
    if (subRe.test(line)) continue; // our own sub-table → part of the block
    end = hm.index;
    break;
  }
  return { start, end };
}

/** Normalize a block so it ends with exactly one \n. */
function normalizeBlock(blockText) {
  return blockText.replace(/\s*$/, '') + '\n';
}

/**
 * Upsert the [mcp_servers.<name>] block. Hit → whole block replaced; miss → appended
 * at EOF (one blank line separator). All other content preserved byte-for-byte.
 * Idempotent: same input twice yields identical output.
 */
export function upsertMcpServerBlock(text, name, blockText) {
  const block = normalizeBlock(blockText);
  const loc = findMcpServerBlock(text, name);
  if (!loc) {
    let out = text;
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
    if (out.length > 0 && !out.endsWith('\n\n')) out += '\n';
    return out + block;
  }
  const replacement = loc.end < text.length ? block + '\n' : block;
  return text.slice(0, loc.start) + replacement + text.slice(loc.end);
}

/** Delete the [mcp_servers.<name>] block (+ note comment + sub-tables). Other content
 *  preserved byte-for-byte; trailing blank lines at EOF trimmed. Idempotent. */
export function deleteMcpServerBlock(text, name) {
  const loc = findMcpServerBlock(text, name);
  if (!loc) return text;
  let out = text.slice(0, loc.start) + text.slice(loc.end);
  if (loc.end === text.length) {
    // block was at EOF: strip trailing blank lines so the file ends with content + \n
    out = out.replace(/(\r?\n)[ \t\r\n]*$/, '$1');
  }
  return out;
}

/** Render the [mcp_servers.<name>] TOML block (aligned with the live samples in this
 *  machine's config.toml: win32 wraps via `cmd /c node '<path>'`; literal-quoted paths). */
export function renderMcpServerBlockToml(name, y, dir) {
  if (y.transport && y.transport !== 'stdio') {
    throw new Error(`codex injectMcp: transport "${y.transport}" not supported (stdio only)`);
  }
  const absEntry = path.resolve(dir || '.', y.entrypoint || 'source.md');
  const lines = [];
  if (!isExecutableEntrypoint(y.entrypoint)) lines.push(`# opsforge-note: ${EXAMPLE_MCP_NOTE}`);
  lines.push(`[mcp_servers.${name}]`);
  if (process.platform === 'win32') {
    lines.push('command = "cmd"');
    lines.push('args = [');
    lines.push('    "/c",');
    lines.push('    "node",');
    lines.push(`    ${tomlString(absEntry)},`);
    lines.push(']');
  } else {
    lines.push('command = "node"');
    lines.push('args = [');
    lines.push(`    ${tomlString(absEntry)},`);
    lines.push(']');
  }
  const auth = y.config_template && Array.isArray(y.config_template.auth_schema) ? y.config_template.auth_schema : [];
  if (auth.length > 0) lines.push(`env_vars = [${auth.map((v) => `"${tomlBasicString(v)}"`).join(', ')}]`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Skill dir copy helpers
// ---------------------------------------------------------------------------

/** Guard: a dir artifact may only replace/remove a slug-validated dir strictly under
 *  ~/.codex/skills/ or ~/.agents/skills/ (adapter self-managed roots). */
function assertManagedSkillDir(absPath) {
  const home = resolveHome();
  const roots = [path.join(home, '.codex', 'skills'), path.join(home, '.agents', 'skills')];
  const resolved = path.resolve(absPath);
  for (const root of roots) {
    const rel = path.relative(root, resolved);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep)) {
      assertSlugSegment(rel, 'skill-dir name');
      return;
    }
  }
  throw new Error(`path-guard: skill-dir "${absPath}" is not under an adapter-managed skills root`);
}

/** Recursively copy a directory (files only; preserves structure). */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// CodexAdapter
// ---------------------------------------------------------------------------

export class CodexAdapter extends BaseAdapter {
  platform = 'codex';

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
        const targetPath = path.join(home, '.codex', 'agents', `${name}.toml`);
        const sourcePath = path.join(dir, y.entrypoint || 'source.md');
        const raw = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
        return [{
          kind: 'agent-file',
          targetPath,
          content: toCodexAgentToml(raw, name, y),
          mcpConfig: null,
          degradation: null,
          pasteInstructions: null,
        }];
      }
      case 'skill': {
        const sourcePath = path.join(dir, y.entrypoint || 'SKILL.md');
        const content = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
        const scriptsSource = path.join(dir, 'scripts');
        const artifacts = [{
          kind: 'skill-dir',
          targetPath: path.join(home, '.codex', 'skills', name),
          content,
          scriptsSource: fs.existsSync(scriptsSource) ? scriptsSource : null,
          mcpConfig: null,
          degradation: null,
          pasteInstructions: null,
        }];
        // Codex desktop also loads skills from ~/.agents/skills/ (verified live:
        // opsforge-wizard resolves from that root). Mirror only when the root already
        // exists — detect-only, never create it, to avoid polluting other setups.
        const agentsSkillsRoot = path.join(home, '.agents', 'skills');
        if (fs.existsSync(agentsSkillsRoot)) {
          artifacts.push({
            kind: 'skill-dir',
            targetPath: path.join(agentsSkillsRoot, name),
            content,
            scriptsSource: fs.existsSync(scriptsSource) ? scriptsSource : null,
            mirror: true,
            mcpConfig: null,
            degradation: null,
            pasteInstructions: null,
          });
        }
        return artifacts;
      }
      case 'mcp':
        // Merge handled by injectMcp (block-level TOML upsert into config.toml).
        return [{ kind: 'mcp-config-merge', targetPath: null, content: null, mcpConfig: null, degradation: null, pasteInstructions: null }];
      case 'workflow': {
        const targetPath = path.join(home, '.codex', 'prompts', `workflow-${name}.md`);
        return [{
          kind: 'workflow-prompt',
          targetPath,
          content: renderCodexWorkflowPrompt(y, name),
          mcpConfig: null,
          degradation: null,
          pasteInstructions: null,
        }];
      }
      default:
        return [];
    }
  }

  async install(artifacts, opts = {}) {
    const written = [];
    for (const a of artifacts) {
      if (a.kind === 'mcp-config-merge') continue; // handled by injectMcp
      if (a.kind === 'manual-paste') continue; // instructions-only, nothing to write
      if (a.kind === 'skill-dir') {
        // Replace the whole dir (adapter self-managed, slug-validated paths only).
        assertManagedSkillDir(a.targetPath);
        fs.rmSync(a.targetPath, { recursive: true, force: true });
        fs.mkdirSync(a.targetPath, { recursive: true });
        await atomicWrite(path.join(a.targetPath, 'SKILL.md'), a.content || '');
        if (a.scriptsSource && fs.existsSync(a.scriptsSource)) {
          copyDirRecursive(a.scriptsSource, path.join(a.targetPath, 'scripts'));
        }
        written.push(a.targetPath);
        continue;
      }
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

    const cfgPath = path.join(resolveHome(), '.codex', 'config.toml');
    const existing = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
    const block = renderMcpServerBlockToml(name, y, mcp.dir);
    const next = upsertMcpServerBlock(existing, name, block);
    await atomicWrite(cfgPath, next);
    return { mcp_keys: [name] };
  }

  async uninstall(capId, opts = {}) {
    const removed = [];
    if (opts.artifacts) {
      for (const f of opts.artifacts) {
        try {
          if (!fs.existsSync(f)) continue;
          if (fs.statSync(f).isDirectory()) {
            assertManagedSkillDir(f); // recursive delete restricted to managed roots
            fs.rmSync(f, { recursive: true, force: true });
          } else {
            fs.unlinkSync(f);
          }
          removed.push(f);
        } catch { /* best-effort */ }
      }
    }
    if (opts.mcp_keys && opts.mcp_keys.length) {
      const cfgPath = path.join(resolveHome(), '.codex', 'config.toml');
      if (fs.existsSync(cfgPath)) {
        let text = fs.readFileSync(cfgPath, 'utf8');
        let changed = false;
        for (const key of opts.mcp_keys) {
          assertSlugSegment(key, 'mcp-key');
          const next = deleteMcpServerBlock(text, key);
          if (next !== text) { removed.push(`mcp:${key}`); text = next; changed = true; }
        }
        if (changed) await atomicWrite(cfgPath, text);
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