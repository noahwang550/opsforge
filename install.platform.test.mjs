// install.platform.test.mjs — S3: workbuddy doctor + 平台自动探测 CLI spawn (DP1-DP3, AP1-AP2).
// 守 test-cli-argv-path：--platform workbuddy + 不传 --platform 自动探测必须有 CLI spawn 测试.
// 守 eval-static-only / Windows argv：spawnSync argv 形式，OPSFORGE_HOME fixture 隔离，不调 claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor, repair } from './install.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const INSTALL_MJS = path.join(REPO_ROOT, 'install.mjs');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-plat-'));
}
function makeDir(home, sub) {
  fs.mkdirSync(path.join(home, sub), { recursive: true });
}
function seedManifest(home, caps) {
  const mDir = path.join(home, 'manifests');
  fs.mkdirSync(mDir, { recursive: true });
  fs.writeFileSync(path.join(mDir, 'default.manifest.json'), JSON.stringify({
    manifest_version: '1', project: 'default', platform: 'workbuddy', brand: null,
    installer_version: '0.1.0', capabilities: caps,
  }));
}

// DP1 doctor workbuddy healthy when ~/.workbuddy 存在
test('DP1 doctor workbuddy healthy when .workbuddy exists', async () => {
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  makeDir(home, '.workbuddy');
  seedManifest(home, []);
  const r = await doctor({ platform: 'workbuddy', opsforgeHome: home });
  assert.equal(r.healthy, true, JSON.stringify(r.issues));
});

// DP2 doctor workbuddy platform_writable issue when ~/.workbuddy 缺失
test('DP2 doctor workbuddy platform_writable issue when .workbuddy missing', async () => {
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  seedManifest(home, []);
  const r = await doctor({ platform: 'workbuddy', opsforgeHome: home });
  assert.equal(r.healthy, false);
  assert.ok(r.issues.some((i) => i.check === 'platform_writable'), JSON.stringify(r.issues));
});

// DP3 doctor workbuddy mcp_missing when mcp.json 缺 key
test('DP3 doctor workbuddy mcp_missing when mcp.json missing key', async () => {
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  makeDir(home, '.workbuddy');
  // seed manifest with a cap that has mcp_keys but no mcp.json
  seedManifest(home, [{
    id: 'foo.connector', version: '1.0.0', source_commit: 'unknown',
    customer: null, security_policy: {}, owner_profile: 'default',
    installed_at: '2026-01-01T00:00:00Z', mcp_keys: ['opsforge-connector'],
    effectiveness_flag: null, artifacts: [], deps_missing: [],
  }]);
  const r = await doctor({ platform: 'workbuddy', opsforgeHome: home });
  assert.equal(r.healthy, false);
  assert.ok(r.issues.some((i) => i.check === 'mcp_missing'), JSON.stringify(r.issues));
});

// AP1 install 不传 --platform 时自动探测到 workbuddy（CLI spawn, OPSFORGE_HOME fixture 造 ~/.workbuddy/）
test('AP1 install auto-detects workbuddy when --platform omitted (CLI spawn)', () => {
  const home = mkTmp();
  makeDir(home, '.workbuddy');
  const r = spawnSync(process.execPath, [INSTALL_MJS, '--install', 'marketing-team.copywriter', '--dry-run'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, OPSFORGE_HOME: home, OPSFORGE_RUNNER: 'static-only' },
  });
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  // dry-run prints installed: <path>
  assert.match(r.stdout, /installed:/);
});

// AP2 install 多平台时打印业务话提示（WC9 断言: "检测到多个 AI 助手平台已安装"）
test('AP2 install multi-platform prints business hint (CLI spawn)', () => {
  const home = mkTmp();
  makeDir(home, '.claude');
  makeDir(home, '.workbuddy');
  const r = spawnSync(process.execPath, [INSTALL_MJS, '--install', 'marketing-team.copywriter', '--dry-run'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, OPSFORGE_HOME: home, OPSFORGE_RUNNER: 'static-only' },
  });
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /检测到多个 AI 助手平台已安装/);
  assert.match(r.stdout, /默认安装到 claude-code/);
  // WC8: 提示文案不含技术词（detectPlatform/PLATFORM_DIRS/fs.existsSync）
  assert.doesNotMatch(r.stdout, /detectPlatform|PLATFORM_DIRS|fs\.existsSync/);
});

// CLI1 spawn: node install.mjs --install <cap> --platform workbuddy --dry-run exit 0 (test-cli-argv-path)
test('CLI1 install --platform workbuddy --dry-run exits 0 (CLI argv)', () => {
  const home = mkTmp();
  makeDir(home, '.workbuddy');
  const r = spawnSync(process.execPath, [INSTALL_MJS, '--install', 'marketing-team.copywriter', '--platform', 'workbuddy', '--dry-run'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, OPSFORGE_HOME: home, OPSFORGE_RUNNER: 'static-only' },
  });
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /installed:/);
});

// CLI2 spawn: node install.mjs --doctor --platform workbuddy exit 0 (healthy when .workbuddy exists)
test('CLI2 doctor --platform workbuddy exits 0 (CLI argv)', () => {
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  makeDir(home, '.workbuddy');
  seedManifest(home, []);
  const r = spawnSync(process.execPath, [INSTALL_MJS, '--doctor', '--platform', 'workbuddy'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, OPSFORGE_HOME: home, OPSFORGE_RUNNER: 'static-only' },
  });
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /healthy: true/);
});

// RP1-codex repair --repair-mcp TOML 分支：缺 key → injectMcp 重注入；不缺 → 文件零改动
test('RP1 codex repair re-injects missing mcp key into config.toml', async () => {
  const home = mkTmp();
  const repo = mkTmp();
  process.env.OPSFORGE_HOME = home;
  makeDir(home, '.codex');
  // 源能力：packs/itl-eng/mcps/coder/
  const capDir = path.join(repo, 'packs', 'itl-eng', 'mcps', 'coder');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'server.mjs'), '// mcp server');
  const yaml = (await import('js-yaml')).default;
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'itl-eng.coder', version: '0.1.0', kind: 'mcp', pack: 'itl-eng', owner: 'x',
    display_name: 'Coder', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['codex'],
    entrypoint: 'server.mjs', tests: 'tests/', changelog: 'CHANGELOG.md',
    transport: 'stdio', config_template: { auth_schema: ['API_KEY'] }, tools: [],
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  const cfgPath = path.join(home, '.codex', 'config.toml');
  const preExisting = 'shell = "bash"\n\n[mcp_servers.other]\ncommand = "x"\n';
  fs.writeFileSync(cfgPath, preExisting);
  const manifest = {
    manifest_version: '1', project: 'default', platform: 'codex', brand: null,
    installer_version: '0.1.0',
    capabilities: [
      { id: 'itl-eng.coder', version: '0.1.0', artifacts: [], mcp_keys: ['coder'], deps_missing: [] },
    ],
  };
  fs.mkdirSync(path.join(home, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(home, 'manifests', 'default.manifest.json'), JSON.stringify(manifest));

  // 缺 coder → 重注入，既有表保留
  const r1 = await repair({ platform: 'codex', repoRoot: repo, opsforgeHome: home });
  assert.deepEqual(r1.issues, []);
  assert.ok(r1.repaired.includes('itl-eng.coder'), 're-injected missing key');
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.ok(after.includes('[mcp_servers.coder]'), 'coder block injected');
  assert.ok(after.includes('env_vars = ["API_KEY"]'), 'auth_schema re-injected');
  assert.ok(after.includes('[mcp_servers.other]'), 'pre-existing table preserved');
  assert.ok(after.startsWith(preExisting), 'pre-existing bytes untouched');

  // 不缺 → 文件零改动，repaired 为空
  const before2 = fs.readFileSync(cfgPath, 'utf8');
  const r2 = await repair({ platform: 'codex', repoRoot: repo, opsforgeHome: home });
  assert.deepEqual(r2.issues, []);
  assert.deepEqual(r2.repaired, [], 'nothing to repair when key present');
  assert.equal(fs.readFileSync(cfgPath, 'utf8'), before2, 'no rewrite when nothing missing');
});
