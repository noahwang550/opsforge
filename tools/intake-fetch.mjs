// tools/intake-fetch.mjs — Phase 2.6 + N2/N3: third-party intake fetcher (§12.1).
// https-only, SSRF reject (incl. encoded IPs + DNS rebinding), shell-metachar reject,
// git clone --depth 1 (execFile argv, NO shell), 50MB cap. No new deps;
// node:child_process.execFileSync + node:dns + node:net + node:fs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import net from 'node:net';

export const MAX_INTAKE_BYTES = 50 * 1024 * 1024; // 50 MB cap (§12.1)

// SSRF patterns (mirrors tools/security-scan.mjs private-network family).
const SSRF_HOST_PATTERNS = [
  /^https?:\/\/127\./i,
  /^https?:\/\/169\.254\./i,
  /^https?:\/\/10\.\d+\.\d+\.\d+/i,
  /^https?:\/\/192\.168\./i,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./i, // private 172.16/12
  /^https?:\/\/localhost/i,
  /^https?:\/\/[^/]*\.internal\b/i,
  /^https?:\/\/\[?::1\]?/i, // ipv6 loopback
  /^https?:\/\/0\./i,
];

// N3: encoded-loopback / private IP encodings + reserved host suffixes.
const SSRF_ENCODED_PATTERNS = [
  /^https?:\/\/0x7f[0-9a-f]{6}/i,        // hex 127.x.x.x
  /^https?:\/\/2130706433\b/i,            // decimal 127.0.0.1
  /^https?:\/\/0177\./i,                  // octal 127.x
  /^https?:\/\/\[?::ffff:127\./i,        // ipv4-mapped ipv6 loopback
  /^https?:\/\/\[?::ffff:10\./i,
  /^https?:\/\/\[?::ffff:192\.168\./i,
  /^https?:\/\/\[?::1\]?/i,              // ipv6 loopback
  /^https?:\/\/0\.0\.0\.0/i,             // wildcard
  /^https?:\/\/[^/]*\.local\b/i,         // mDNS
  /^https?:\/\/[^/]*\.corp\b/i,          // corp
  /^https?:\/\/[^/]*\.internal\b/i,
];

// N2: shell metacharacters — reject in the path/query to prevent command injection
// even if a URL slips through to a (now-argv-form) clone. Defense in depth.
const SHELL_METACHAR_RE = /[;|&`$\\\n\r]/;

/** N3: is a resolved IP address private/loopback/link-local/CGNAT? */
function isPrivateIp(addr) {
  if (!addr) return false;
  // IPv6
  if (addr === '::1' || addr === '::') return true;
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true; // link-local
  if (/^fc[0-9a-f]{2}:/i.test(addr) || /^fd[0-9a-f]{2}:/i.test(addr)) return true; // ULA fc00::/7
  // IPv4
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    if (a === 127) return true;                       // loopback
    if (a === 10) return true;                         // 10/8
    if (a === 0) return true;                          // 0/8 reserved
    if (a === 169 && b === 254) return true;           // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true;           // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64/10
  }
  return false;
}

/** Extract the host (lowercased, bracket-stripped) from a URL string. */
function hostOf(url) {
  const m = url.match(/^https?:\/\/(\[[^\]]+\]|[^:/]+)/i);
  if (!m) return null;
  let h = m[1];
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h.toLowerCase();
}

/**
 * Assert a URL is https, not private/loopback/internal (SSRF), free of shell
 * metacharacters, and (for hostnames) does not resolve to a private IP (DNS
 * rebinding guard). opts.lookup is injectable for tests.
 * @param {string} url
 * @param {{lookup?: Function}} opts
 * @throws {Error}
 */
export async function assertPublicUrl(url, opts = {}) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error(`intake: URL must be https:// (got: ${url})`);
  }
  // N2: reject shell metacharacters (command-injection guard, defense in depth).
  if (SHELL_METACHAR_RE.test(url)) {
    throw new Error(`intake: URL rejected — shell metacharacter detected (command-injection guard)`);
  }
  for (const re of [...SSRF_HOST_PATTERNS, ...SSRF_ENCODED_PATTERNS]) {
    if (re.test(url)) {
      throw new Error(`intake: private/loopback/internal/reserved SSRF target rejected (${url})`);
    }
  }
  // N3: DNS rebinding — resolve the hostname and reject if any address is private.
  // Literal IPs are already caught above; only do the lookup for non-IP hostnames.
  const host = hostOf(url);
  if (host && !net.isIP(host)) {
    const lookup = opts.lookup || ((h, o) => new Promise((resolve, reject) => {
      dns.lookup(h, { all: true, verbatim: true, ...(o || {}) }, (err, addrs) => {
        if (err) reject(err); else resolve(addrs);
      });
    }));
    let addrs;
    try {
      addrs = await lookup(host, {});
    } catch (e) {
      throw new Error(`intake: could not resolve hostname "${host}" (${e.message})`);
    }
    const list = Array.isArray(addrs) ? addrs : [addrs];
    for (const a of list) {
      const ip = a && (a.address || a);
      if (isPrivateIp(ip)) {
        throw new Error(`intake: hostname "${host}" resolves to private/reserved address ${ip} (DNS-rebinding SSRF guard)`);
      }
    }
  }
}

/**
 * Compute total bytes of a directory recursively.
 * @param {string} dir
 * @returns {number}
 */
export function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git') continue; // .git excluded from size accounting
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += dirSize(p);
    else {
      try { total += fs.statSync(p).size; } catch { /* ignore */ }
    }
  }
  return total;
}

/**
 * Fetch (clone) an upstream repo at depth 1, enforce the 50MB cap, return metadata.
 * N2: uses execFile (argv form, NO shell) — the URL is passed as a single argv
 * element to `git`, so shell operators can never be interpreted. opts.execFile is
 * injectable for tests (signature: (cmd, args, opts) => string).
 * @param {string} url  https public git URL
 * @param {{execFile?: Function, dest?: string, maxSizeBytes?: number}} opts
 * @returns {Promise<{dir: string, commit: string, sizeBytes: number}>}
 */
export async function fetchUpstream(url, opts = {}) {
  await assertPublicUrl(url, opts);
  const execFile = opts.execFile || ((cmd, args, o) => execFileSync(cmd, args, { encoding: 'utf8', ...o }));
  const dest = opts.dest || path.join(process.cwd(), '.opsforge-intake', `intake-${Date.now()}`);
  const maxSize = opts.maxSizeBytes || MAX_INTAKE_BYTES;

  // N2: argv form — no shell, so the URL is never tokenized by a shell.
  execFile('git', ['clone', '--depth', '1', url, dest], { stdio: ['pipe', 'pipe', 'pipe'] });
  const sizeBytes = dirSize(dest);
  if (sizeBytes > maxSize) {
    // Clean up oversized clone.
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* best-effort */ }
    throw new Error(`intake: repo size ${(sizeBytes / 1024 / 1024).toFixed(1)}MB exceeds 50MB cap`);
  }
  const commit = execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: dest, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  return { dir: dest, commit, sizeBytes };
}

export function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage: node tools/intake-fetch.mjs <https-url>');
    process.exit(2);
  }
  (async () => {
    try {
      const r = await fetchUpstream(argv[0]);
      console.log(`cloned: ${r.dir} @${r.commit} (${(r.sizeBytes / 1024 / 1024).toFixed(1)}MB)`);
      process.exit(0);
    } catch (e) {
      console.error(`intake failed: ${e.message}`);
      process.exit(1);
    }
  })();
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('intake-fetch.mjs') && !process.env.NODE_TEST_CONTEXT;
if (invokedDirect) { main(); }
