// tools/index-publish.mjs — Slice A1: 生成远程 index.json + capabilities/<id>.json.
// 数据源唯一性：buildCatalogSnapshot（catalog-model.mjs）← buildInventory ← registry.yaml + body H2.
// index.json = catalogSummary 形（轻量列表，剥 detail/qualityChecks/dependencies/usage）.
// capabilities/<id>.json = 完整 publicEntry 形（含 detail/usage）+ installHint（透传自 inventory）.
// 零新依赖：node:fs/path + ajv（已有）+ catalog-model.mjs + paths.mjs atomicWriteSync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { buildCatalogSnapshot, catalogSummary } from './catalog-model.mjs';
import { buildInventory } from './inventory.mjs';
import { atomicWriteSync } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'index.schema.json');

let _validateIndex = null;
let _validateCap = null;
function loadValidators() {
  if (_validateIndex && _validateCap) return { _validateIndex, _validateCap };
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  _validateIndex = ajv.compile(schema);
  // fullEntry 子 schema 的 $ref 指向根 definitions，必须从已编译根 schema 取，不能独立编译.
  _validateCap = ajv.getSchema('#/definitions/fullEntry');
  return { _validateIndex, _validateCap };
}

/**
 * validateIndex(obj) — ajv 校验 index.json 顶层（untrusted data）.
 * @param {Object} obj
 * @returns {boolean}
 */
export function validateIndex(obj) {
  try {
    const { _validateIndex } = loadValidators();
    return !!_validateIndex(obj);
  } catch {
    return false;
  }
}

/**
 * validateCapability(obj) — ajv 校验单个 capabilities/<id>.json（完整 publicEntry + installHint）.
 * @param {Object} obj
 * @returns {boolean}
 */
export function validateCapability(obj) {
  try {
    const { _validateCap } = loadValidators();
    return !!_validateCap(obj);
  } catch {
    return false;
  }
}

/**
 * buildIndex(opts) — 调 buildCatalogSnapshot 生成发布索引.
 * index = catalogSummary(snapshot) 形（轻量列表）.
 * capabilities = snapshot.capabilities（完整 publicEntry 数组）.
 * @param {{repoRoot?: string, now?: Date}} opts
 * @returns {Promise<{index: Object, capabilities: Object[]}>}
 */
export async function buildIndex(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const snapshot = await buildCatalogSnapshot({ repoRoot, now: opts.now });
  const index = catalogSummary(snapshot);
  // capabilities/<id>.json 透传 installHint（inventory entry 有，publicEntry 无）.
  // 从 inventory entry 补 installHint 到完整 publicEntry（schema 已加 installHint optional）.
  const inventory = await buildInventory({ repoRoot });
  const hintById = new Map(inventory.all
    .filter((e) => e.state === 'released' && e.installHint != null)
    .map((e) => [e.id, e.installHint]));
  const capabilities = snapshot.capabilities.map((cap) => ({
    ...cap,
    installHint: hintById.get(cap.id) ?? null,
  }));
  return { index, capabilities };
}

/**
 * publishIndex({repoRoot, outDir}) — 写 index.json + capabilities/*.json 到 outDir.
 * @param {{repoRoot?: string, outDir?: string}} opts
 *   outDir 默认 path.join(repoRoot, 'web', 'catalog', 'dist')
 * @returns {Promise<{indexFile: string, capabilityFiles: string[], count: number}>}
 */
export async function publishIndex({ repoRoot, outDir } = {}) {
  const root = repoRoot || process.cwd();
  const { index, capabilities } = await buildIndex({ repoRoot: root });
  const dest = outDir || path.join(root, 'web', 'catalog', 'dist');
  const capsDir = path.join(dest, 'capabilities');
  fs.mkdirSync(capsDir, { recursive: true });
  const indexFile = path.join(dest, 'index.json');
  atomicWriteSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  const capabilityFiles = [];
  for (const cap of capabilities) {
    const f = path.join(capsDir, `${cap.id}.json`);
    atomicWriteSync(f, JSON.stringify(cap, null, 2) + '\n');
    capabilityFiles.push(f);
  }
  return { indexFile, capabilityFiles, count: capabilities.length };
}

/** CLI main(): node tools/index-publish.mjs [--out-dir <path>] */
export function main() {
  const argv = process.argv.slice(2);
  let outDir;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-dir' && argv[i + 1]) { outDir = argv[++i]; }
  }
  const repoRoot = process.cwd();
  publishIndex({ repoRoot, outDir }).then((r) => {
    console.log(`index published: ${r.indexFile}`);
    console.log(`capabilities: ${r.count} files under ${path.dirname(r.indexFile)}/capabilities/`);
  }).catch((e) => {
    console.error(`index-publish failed: ${e.message}`);
    process.exit(1);
  });
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('index-publish.mjs');
if (invokedDirect) main();
