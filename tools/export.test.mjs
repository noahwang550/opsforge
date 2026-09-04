// tools/export.test.mjs — 能力导出功能测试（零依赖 ZIP 写入器）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-export-')); }

// helper: 创建一个最小有效草稿目录
function mkDraft(repoRoot, slug, name) {
  const dir = path.join(repoRoot, 'packs', '_drafts', slug, name);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.yaml'),
    `id: ${slug}.${name}\nversion: 0.1.0\nkind: skill\npack: ${slug}\nname: ${name}\nowner: tester\ndisplay_name: Test\nentrypoint: SKILL.md\ntests: tests/\nchangelog: CHANGELOG.md\nsource:\n  origin: original\n  upstream_ref: null`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n## 能力说明\ntest body content\n## 适用场景\nscenario`);
  fs.writeFileSync(path.join(dir, 'tests', 'case-01.yaml'),
    'name: case-01\ninput:\n  kind: skill\n  name: test\nexpect: contains\nexpected: ok\nquadrant: positive\nsource: recalled\nconfidence: med\nallow_exact_reason: null\nref: null\n');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n- 0.1.0: initial');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Readme');
  return dir;
}

// 辅助：解码 ZIP 文件，返回 entry 路径列表
function listZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  // 找 EOCD 签名 0x06054b50（从末尾向前搜索）
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP 文件缺少 EOCD 签名');
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdCount = buf.readUInt16LE(eocdOffset + 10);
  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    const sig = buf.readUInt32LE(pos);
    assert.equal(sig, 0x02014b50, `entry ${i} 缺少 central directory 签名`);
    const nameLen = buf.readUInt16LE(pos + 28);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.push(name);
    pos += 46 + nameLen;
  }
  return entries;
}

// EX1 正常导出：有效草稿 → 生成 zip，文件完整
test('EX1 export valid draft produces zip with correct entries', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const { exportCapability } = await import('./export.mjs');
  const result = await exportCapability({
    draftDir: draft, repoRoot,
    validate: async () => ({ verdict: 'pass' }),
    securityScan: () => ({ verdict: 'pass', findings: [] }),
    runSuite: async () => ({ verdict: 'pass' }),
  });
  assert.ok(fs.existsSync(result.zipPath), 'zip 文件应存在');
  assert.ok(result.zipName.endsWith('.opsforge.zip'), 'zip 文件名应以 .opsforge.zip 结尾');
  assert.ok(result.zipName.startsWith('skill-foo-'), 'zip 文件名应以 kind-slug.name 开头');
  const entries = listZipEntries(result.zipPath);
  assert.ok(entries.includes('capability.yaml'), '应包含 capability.yaml');
  assert.ok(entries.includes('SKILL.md'), '应包含 SKILL.md');
  assert.ok(entries.includes('tests/case-01.yaml'), '应包含 tests/case-01.yaml');
  assert.ok(entries.includes('CHANGELOG.md'), '应包含 CHANGELOG.md');
  assert.ok(entries.includes('README.md'), '应包含 README.md');
  // 不应包含运行时产物
  assert.ok(!entries.includes('.opsforge-state.json'), '不应包含 .opsforge-state.json');
});

// EX2 预检失败拒绝：验证不通过 → 抛 ExportError
test('EX2 export blocks on validation failure', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const { exportCapability, ExportError } = await import('./export.mjs');
  await assert.rejects(
    exportCapability({
      draftDir: draft, repoRoot,
      validate: async () => ({ verdict: 'fail', checks: [] }),
    }),
    (e) => { assert.ok(e instanceof ExportError); assert.equal(e.kind, 'validation'); return true; },
  );
});

// EX3 安全扫描阻断
test('EX3 export blocks on security block', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const { exportCapability, ExportError } = await import('./export.mjs');
  await assert.rejects(
    exportCapability({
      draftDir: draft, repoRoot,
      validate: async () => ({ verdict: 'pass' }),
      securityScan: () => ({ verdict: 'block', findings: [{ rule: 'prompt_injection', status: 'block' }] }),
    }),
    (e) => { assert.ok(e instanceof ExportError); assert.equal(e.kind, 'security'); return true; },
  );
});

// EX4 自定义输出目录
test('EX4 export respects outDir option', async () => {
  const repoRoot = mkTmp();
  const draft = mkDraft(repoRoot, 'foo', 'bar');
  const outDir = mkTmp();
  const { exportCapability } = await import('./export.mjs');
  const result = await exportCapability({
    draftDir: draft, repoRoot, outDir,
    validate: async () => ({ verdict: 'pass' }),
    securityScan: () => ({ verdict: 'pass', findings: [] }),
    runSuite: async () => ({ verdict: 'pass' }),
  });
  assert.ok(result.zipPath.startsWith(outDir), 'zip 应在指定的 outDir 中');
  assert.ok(fs.existsSync(result.zipPath), 'zip 文件应存在');
});

// EX5 品牌能力导出
test('EX5 export handles brand draft', async () => {
  const repoRoot = mkTmp();
  const brandDir = path.join(repoRoot, 'customers', 'acme', 'packs', '_drafts', 'acme', 'mybot');
  fs.mkdirSync(path.join(brandDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(brandDir, 'capability.yaml'),
    `id: acme.mybot\nversion: 0.1.0\nkind: agent\npack: acme\nowner: acme\ncustomer: acme\ndisplay_name: MyBot\nentrypoint: source.md\ntests: tests/\nchangelog: CHANGELOG.md\nsource:\n  origin: original\n  upstream_ref: null`);
  fs.writeFileSync(path.join(brandDir, 'source.md'), `# mybot\n## 能力说明\nbrand bot\n## 适用场景\nscenario`);
  fs.writeFileSync(path.join(brandDir, 'tests', 'case-01.yaml'),
    'name: case-01\ninput:\n  kind: agent\n  name: test\nexpect: contains\nexpected: ok\nquadrant: positive\nsource: recalled\nconfidence: med\nallow_exact_reason: null\nref: null\n');
  fs.writeFileSync(path.join(brandDir, 'CHANGELOG.md'), '# Changelog');
  fs.writeFileSync(path.join(brandDir, 'README.md'), '# Readme');
  const { exportCapability } = await import('./export.mjs');
  const result = await exportCapability({
    draftDir: brandDir, repoRoot,
    validate: async () => ({ verdict: 'pass' }),
    securityScan: () => ({ verdict: 'pass', findings: [] }),
    runSuite: async () => ({ verdict: 'pass' }),
  });
  assert.ok(fs.existsSync(result.zipPath), '品牌能力 zip 文件应存在');
  const entries = listZipEntries(result.zipPath);
  assert.ok(entries.includes('capability.yaml'), '品牌能力应包含 capability.yaml');
  assert.ok(entries.includes('source.md'), '品牌能力应包含 source.md');
});

// EX6 路径穿越拒绝
test('EX6 export rejects path traversal', async () => {
  const repoRoot = mkTmp();
  const { exportCapability, ExportError } = await import('./export.mjs');
  await assert.rejects(
    exportCapability({
      draftDir: path.join(repoRoot, '..', '..', '..', 'etc'),
      repoRoot,
    }),
    /path block|_drafts/,
  );
});

// EX7 空目录拒绝
test('EX7 export rejects non-existent draft', async () => {
  const repoRoot = mkTmp();
  const { exportCapability } = await import('./export.mjs');
  await assert.rejects(
    exportCapability({
      draftDir: path.join(repoRoot, 'packs', 'staged', 'missing', 'none'),
      repoRoot,
    }),
    /path block|_drafts/,
  );
});
