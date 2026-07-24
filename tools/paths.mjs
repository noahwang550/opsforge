// tools/paths.mjs — 共享路径/IO 助手（§5.1/§5.4）。steering 拥有。
// 所有从 id 拼路径的模块都 import assertSlugSegment / assertCapId。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const SLUG_RE = /^[a-z][a-z0-9-]{2,30}$/;
const CAP_ID_RE = /^[a-z][a-z0-9-]{2,30}\.[a-z][a-z0-9-]{2,30}$/;

/** Resolve ~ to USERPROFILE on Windows, HOME elsewhere. Honors OPSFORGE_HOME env.
 *  @returns {string} absolute home dir */
export function resolveHome() {
  if (process.env.OPSFORGE_HOME) return path.resolve(process.env.OPSFORGE_HOME);
  return process.env.USERPROFILE || os.homedir();
}

/** Resolve ~/.opsforge root. */
export function resolveOpsforgeHome() {
  return path.join(resolveHome(), '.opsforge');
}

/** Atomic write: write to <dest>.tmp.<pid> then rename. fsync before rename.
 *  Idempotent short-circuit: if existing content hash === new content, skip.
 *  @param {string} absDest  absolute target path
 *  @param {string|Buffer} content */
export async function atomicWrite(absDest, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(absDest)) {
    const existing = fs.readFileSync(absDest);
    if (existing.length === buf.length && existing.equals(buf)) return;
  }
  await fs.promises.mkdir(path.dirname(absDest), { recursive: true });
  const tmp = `${absDest}.tmp.${process.pid}`;
  const fh = await fs.promises.open(tmp, 'w');
  await fh.writeFile(buf);
  try { await fh.sync(); } catch { /* fsync best-effort on some platforms */ }
  await fh.close();
  await fs.promises.rename(tmp, absDest);
}

/** Read JSON if exists else return null. */
export async function readJsonOrNull(p) {
  try { return JSON.parse(await fs.promises.readFile(p, 'utf8')); }
  catch { return null; }
}

/** Sync variant for convenience. */
export function readJsonOrNullSync(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

/** Sync atomic write: write to <dest>.tmp.<pid> then rename. fsync before rename.
 *  Idempotent short-circuit: if existing content hash === new content, skip.
 *  @param {string} absDest  absolute target path
 *  @param {string|Buffer} content */
export function atomicWriteSync(absDest, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(absDest)) {
    const existing = fs.readFileSync(absDest);
    if (existing.length === buf.length && existing.equals(buf)) return;
  }
  fs.mkdirSync(path.dirname(absDest), { recursive: true });
  const tmp = `${absDest}.tmp.${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, buf);
  try { fs.fsyncSync(fd); } catch { /* best-effort on some platforms */ }
  fs.closeSync(fd);
  fs.renameSync(tmp, absDest);
}

/** @param {string} seg  @param {string} label  @returns {string} seg
 *  @throws {Error} if seg fails SLUG_RE (also rejects '..', '/', leading '.') */
export function assertSlugSegment(seg, label = 'segment') {
  if (typeof seg !== 'string' || !SLUG_RE.test(seg)) {
    throw new Error(`path-guard: ${label} "${seg}" does not match ^[a-z][a-z0-9-]{2,30}$`);
  }
  return seg;
}

/** Splits "<pack>.<name>" and asserts both halves. @returns {string} */
export function assertCapId(capId) {
  if (!CAP_ID_RE.test(capId)) throw new Error(`path-guard: capId "${capId}" invalid`);
  return capId;
}
