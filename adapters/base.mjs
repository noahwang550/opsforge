// adapters/base.mjs — BaseAdapter (§22.3 / §6.2). steering 拥有。
// 平台能力点模型：9 正交点；tier() 按 §22.3 计算。
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'platform.schema.json');

const TIER1_POINTS = [
  'prompt_exec', 'agent_file', 'skill_file',
  'slash_command', 'mcp_config', 'config_dir_writable',
];

const PLATFORM_SCHEMA_CACHE = {};

function getPlatformSchemaValidator() {
  if (PLATFORM_SCHEMA_CACHE.v) return PLATFORM_SCHEMA_CACHE.v;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const v = ajv.compile(schema);
  PLATFORM_SCHEMA_CACHE.v = v;
  return v;
}

export class BaseAdapter {
  /** @type {string} */
  platform = 'base';

  /** _yamlCache: PlatformYaml|null (memoized) */
  _yamlCache = null;
  _yamlDir = null;

  /** Loads adapters/<platform>/platform.yaml via js-yaml. Memoized per instance.
   *  @param {string} platformDir  absolute adapter dir
   *  @returns {PlatformYaml}
   *  @throws {Error} if platform.yaml missing or fails platform.schema.json (ajv) */
  loadPlatformYaml(platformDir) {
    if (this._yamlCache && this._yamlDir === platformDir) return this._yamlCache;
    const yamlPath = path.join(platformDir, 'platform.yaml');
    if (!fs.existsSync(yamlPath)) {
      throw new Error(`BaseAdapter: platform.yaml not found at ${yamlPath}`);
    }
    const raw = fs.readFileSync(yamlPath, 'utf8');
    let parsed;
    try {
      parsed = yaml.load(raw, { filename: yamlPath });
    } catch (e) {
      throw new Error(`BaseAdapter: platform.yaml parse error: ${e.message}`);
    }
    const validator = getPlatformSchemaValidator();
    if (!validator(parsed)) {
      const errs = validator.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ');
      throw new Error(`BaseAdapter: platform.yaml fails schema: ${errs}`);
    }
    this._yamlCache = parsed;
    this._yamlDir = platformDir;
    return parsed;
  }

  /** @param {string} point  one of the 9 capability-point ids
   *  @returns {{supported: boolean, fallback?: string, meta?: Object}} */
  supports(point) {
    const y = this._getYaml();
    const decl = y.capability_points && y.capability_points[point];
    if (!decl) return { supported: false };
    return {
      supported: !!decl.supported,
      ...(decl.fallback ? { fallback: decl.fallback } : {}),
      ...(decl.meta ? { meta: decl.meta } : {}),
    };
  }

  /** Tier computed per §22.3:
   *  Tier1 = prompt_exec+agent_file+skill_file+slash_command+mcp_config+config_dir_writable all true
   *  Tier2 = prompt_exec supported AND ≥2 of the other 5 file/config points supported (but not all 6)
   *  Tier3 = everything else (prompt-only, or prompt_exec + 0–1 of the other 5; §22.3 "至少 2 个文件/配置类")
   *  @returns {1|2|3} */
  tier() {
    const y = this._getYaml();
    const cp = y.capability_points || {};
    const all = (pts) => pts.every((p) => cp[p] && cp[p].supported);
    if (all(TIER1_POINTS)) return 1;
    // §22.3: Tier2 requires prompt_exec + "至少 2 个文件/配置类" of the other 5 Tier1 points.
    const rest = TIER1_POINTS.slice(1);
    const supportedRest = rest.filter((p) => cp[p] && cp[p].supported).length;
    if (cp.prompt_exec && cp.prompt_exec.supported && supportedRest >= 2) {
      return 2;
    }
    return 3;
  }

  /** Internal: resolve memoized yaml by finding the platform dir.
   *  Subclasses set `this.platform` → this finds adapters/<platform>/. */
  _getYaml() {
    if (this._yamlCache) return this._yamlCache;
    // Default: resolve adapters/<platform>/ relative to this file's location.
    const platformDir = path.resolve(__dirname, this.platform);
    return this.loadPlatformYaml(platformDir);
  }

  /** §A.2 semantic-layer conform (shared by all Tier-1/2 adapters):
   *  - entrypoint file exists (for agent/skill/mcp)
   *  - every requires:hard point must have supports(point).supported===true
   *  Subclasses with platform-specific error wording (e.g. dify) override this.
   *  @param {Object} cap  parsed capability (has .yaml + .dir)
   *  @returns {{ok: boolean, errors: string[]}} */
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
        if (!res.supported) errors.push(`conform: requires:hard point "${req.point}" not supported on platform "${this.platform}"`);
      }
    }
    return { ok: errors.length === 0, errors };
  }
  /** @param {Object} cap
   *  @param {Object} opts
   *  @returns {Array} */
  translate(cap, opts) { return []; }
  /** @param {Array} artifacts
   *  @param {Object} opts */
  install(artifacts, opts) { throw new Error('install: unsupported on base'); }
  /** @param {Object} mcp  parsed mcp.yaml
   *  @param {Object} opts */
  injectMcp(mcp, opts) { throw new Error('injectMcp: unsupported on base'); }
  /** @param {string} capId  <pack>.<name>
   *  @param {Object} opts */
  uninstall(capId, opts) { throw new Error('uninstall: unsupported on base'); }
  /** @returns {boolean}  platform install dir exists & writable */
  detect() { return false; }
}
