// tools/export.mjs — 能力导出引擎：把本地草稿打包为 .opsforge.zip 标准格式压缩包。
// 零新依赖：node:fs / node:path（仅 store 模式，不压缩）。
// 管理员拿到 zip 后解压导入能力仓库。
import fs from 'node:fs';
import path from 'node:path';
import { assertSlugSegment } from './paths.mjs';
import { scan as securityScanDefault } from './security-scan.mjs';

/** 导出失败。kind: 'validation'|'security'|'tests'|'io'|'path'。 */
export class ExportError extends Error {
  constructor(kind, report) {
    super(`export ${kind} block`);
    this.name = 'ExportError';
    this.kind = kind;
    this.report = report;
  }
}

/** CRC-32 校验和（ZIP 格式要求，IEEE 802.3 多项式）。 */
function computeCRC32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else crc >>>= 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** DOS 日期时间格式。 */
function dosDateTime(d) {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();
  const min = d.getMinutes();
  const sec = d.getSeconds();
  const time = (hour << 11) | (min << 5) | (sec >> 1);
  const date = ((year - 1980) << 9) | (month << 5) | day;
  return { time, date };
}

/**
 * createZipBuffer(entries) → Buffer。
 * entries: [{ path: string, content: Buffer }]
 * 输出: 完整 ZIP 二进制（store 模式，无压缩）。
 */
function createZipBuffer(entries) {
  const now = new Date();
  const dos = dosDateTime(now);
  const parts = [];
  const cdEntries = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const content = entry.content;
    const crc = computeCRC32(content);
    const size = content.length;

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    let p = 0;
    localHeader.writeUInt32LE(0x04034b50, p); p += 4; // signature
    localHeader.writeUInt16LE(20, p); p += 2;          // version needed
    localHeader.writeUInt16LE(0, p); p += 2;           // flags
    localHeader.writeUInt16LE(0, p); p += 2;           // compression: store
    localHeader.writeUInt16LE(dos.time, p); p += 2;    // mod time
    localHeader.writeUInt16LE(dos.date, p); p += 2;    // mod date
    localHeader.writeUInt32LE(crc, p); p += 4;         // crc32
    localHeader.writeUInt32LE(size, p); p += 4;        // compressed size
    localHeader.writeUInt32LE(size, p); p += 4;        // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, p); p += 2; // filename length
    localHeader.writeUInt16LE(0, p); p += 2;           // extra field length
    nameBuf.copy(localHeader, p);
    parts.push(localHeader);
    parts.push(content);

    // Record for central directory
    cdEntries.push({
      nameBuf,
      crc,
      size,
      offset,
    });

    offset += localHeader.length + content.length;
  }

  // Central directory
  const cdStart = offset;
  for (const cd of cdEntries) {
    const cdHeader = Buffer.alloc(46 + cd.nameBuf.length);
    let q = 0;
    cdHeader.writeUInt32LE(0x02014b50, q); q += 4; // signature
    cdHeader.writeUInt16LE(20, q); q += 2;          // version made by
    cdHeader.writeUInt16LE(20, q); q += 2;          // version needed
    cdHeader.writeUInt16LE(0, q); q += 2;           // flags
    cdHeader.writeUInt16LE(0, q); q += 2;           // compression
    cdHeader.writeUInt16LE(dos.time, q); q += 2;    // mod time
    cdHeader.writeUInt16LE(dos.date, q); q += 2;    // mod date
    cdHeader.writeUInt32LE(cd.crc, q); q += 4;      // crc32
    cdHeader.writeUInt32LE(cd.size, q); q += 4;     // compressed size
    cdHeader.writeUInt32LE(cd.size, q); q += 4;     // uncompressed size
    cdHeader.writeUInt16LE(cd.nameBuf.length, q); q += 2; // filename length
    cdHeader.writeUInt16LE(0, q); q += 2;           // extra field length
    cdHeader.writeUInt16LE(0, q); q += 2;           // comment length
    cdHeader.writeUInt16LE(0, q); q += 2;           // disk start
    cdHeader.writeUInt16LE(0, q); q += 2;           // internal attrs
    cdHeader.writeUInt32LE(0, q); q += 4;           // external attrs
    cdHeader.writeUInt32LE(cd.offset, q); q += 4;   // local header offset
    cd.nameBuf.copy(cdHeader, q);
    parts.push(cdHeader);
    offset += cdHeader.length;
  }
  const cdSize = offset - cdStart;

  // End of central directory
  const eocd = Buffer.alloc(22);
  let r = 0;
  eocd.writeUInt32LE(0x06054b50, r); r += 4;          // signature
  eocd.writeUInt16LE(0, r); r += 2;                    // disk number
  eocd.writeUInt16LE(0, r); r += 2;                    // disk with cd
  eocd.writeUInt16LE(cdEntries.length, r); r += 2;     // entries on this disk
  eocd.writeUInt16LE(cdEntries.length, r); r += 2;     // total entries
  eocd.writeUInt32LE(cdSize, r); r += 4;               // cd size
  eocd.writeUInt32LE(cdStart, r); r += 4;              // cd offset
  eocd.writeUInt16LE(0, r);                            // comment length
  parts.push(eocd);

  return Buffer.concat(parts);
}

function readCapabilityManifest(draftDir) {
  // 按优先级探测 manifest 文件
  const candidates = ['capability.yaml', 'SKILL.md', 'mcp.yaml', 'workflow.yaml', 'bundle.yaml'];
  for (const name of candidates) {
    const p = path.join(draftDir, name);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      // 解析 frontmatter（YAML 简单提取）
      const idMatch = content.match(/^id:\s*(.+)$/m);
      const versionMatch = content.match(/^version:\s*(.+)$/m);
      const kindMatch = content.match(/^kind:\s*(.+)$/m);
      const packMatch = content.match(/^pack:\s*(.+)$/m);
      return {
        id: idMatch ? idMatch[1].trim() : 'unknown',
        version: versionMatch ? versionMatch[1].trim() : '0.1.0',
        kind: kindMatch ? kindMatch[1].trim() : 'skill',
        pack: packMatch ? packMatch[1].trim() : 'unknown',
        manifestFile: name,
      };
    }
  }
  return null;
}

function assertDraftUnderExport(draftDir, repoRoot) {
  let resolved;
  try { resolved = fs.realpathSync(draftDir); }
  catch { resolved = path.resolve(draftDir); }
  let root;
  try { root = fs.realpathSync(repoRoot); }
  catch { root = path.resolve(repoRoot); }
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ExportError('path', 'draftDir outside repo root');
  }
  const parts = rel.split(path.sep);
  if (!parts.includes('_drafts')) {
    throw new ExportError('path', 'draftDir not under a _drafts root');
  }
  const draftIdx = parts.indexOf('_drafts');
  const slug = parts[draftIdx + 1];
  const name = parts[draftIdx + 2];
  if (slug) assertSlugSegment(slug, 'draft slug');
  if (name) assertSlugSegment(name, 'draft name');
  return resolved;
}

/**
 * runLocalPreflight(draftDir, repoRoot, opts) — 跑 validate + security-scan + test-runner。
 * 三报告需 pass/pending；阻断抛 ExportError(kind, report)。
 */
export async function runLocalPreflight(draftDir, repoRoot, opts = {}) {
  const validateFn = opts.validate || (async () => {
    const m = await import('./validate.mjs');
    return m.validateDir(draftDir, { repoRoot });
  });
  const securityFn = opts.securityScan || (() => securityScanDefault(draftDir));
  const runSuiteFn = opts.runSuite || (async () => {
    const m = await import('./test-runner.mjs');
    return m.runSuite(draftDir, { runner: 'static-only' });
  });
  const valReport = await validateFn(draftDir, repoRoot);
  if (valReport && (valReport.verdict === 'block' || valReport.verdict === 'fail')) {
    throw new ExportError('validation', valReport);
  }
  const secReport = securityFn(draftDir);
  if (secReport && secReport.verdict === 'block') throw new ExportError('security', secReport);
  const testReport = await runSuiteFn(draftDir, { runner: 'static-only' });
  if (testReport && testReport.verdict === 'fail') throw new ExportError('tests', testReport);
  return { ok: true };
}

function buildExportEntries(draftDir) {
  const entries = [];
  const realDraft = fs.realpathSync(draftDir);
  const skipFiles = new Set(['.opsforge-state.json', 'interview.md', 'upstream-ref.json']);
  function walk(dir, prefix) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      const relPath = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { walk(full, relPath); continue; }
      if (skipFiles.has(ent.name)) continue;
      if (ent.name.endsWith('-report.json')) continue;
      const content = fs.readFileSync(full);
      entries.push({ path: relPath, content });
    }
  }
  walk(realDraft, '');
  return entries;
}

/**
 * exportCapability({ draftDir, repoRoot, outDir?, ...opts }) → { zipPath, zipName, cap }。
 * 1. assertDraftUnderExport 2. runLocalPreflight 3. 读 manifest 4. 打包 zip。
 */
export async function exportCapability({ draftDir, repoRoot, outDir, ...opts }) {
  assertDraftUnderExport(draftDir, repoRoot);
  await runLocalPreflight(draftDir, repoRoot, opts);

  const cap = readCapabilityManifest(draftDir);
  if (!cap) throw new ExportError('io', 'draft directory has no recognizable manifest');

  const parts = cap.id.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 1] : cap.id;
  const zipName = `${cap.kind}-${cap.pack}-${name}-v${cap.version}.opsforge.zip`;
  const targetDir = outDir || path.dirname(draftDir);
  const zipPath = path.join(targetDir, zipName);

  const entries = buildExportEntries(draftDir);
  if (entries.length === 0) throw new ExportError('io', 'draft directory is empty');
  const zipBuf = createZipBuffer(entries);
  fs.writeFileSync(zipPath, zipBuf);

  return { zipPath, zipName, cap };
}
