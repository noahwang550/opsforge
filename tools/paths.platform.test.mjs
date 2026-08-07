// tools/paths.platform.test.mjs — S2: 平台自动探测 + PLATFORM_DIRS 单一真相源 (PD1-PD6).
// 守 test-cli-argv-path：detectPlatform 只读本地目录，无网络无 spawn。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLATFORM_DIRS,
  PLATFORM_MCP_PATHS,
  platformInstallDir,
  mcpConfigPathFor,
  detectPlatform,
  detectAllPlatforms,
  isExecutableEntrypoint,
} from './paths.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-pd-'));
}
function setHome(tmp) {
  process.env.OPSFORGE_HOME = tmp;
}
function makeDir(home, sub) {
  fs.mkdirSync(path.join(home, sub), { recursive: true });
}

// PD1 PLATFORM_DIRS 含 workbuddy 且映射到 .workbuddy
test('PD1 PLATFORM_DIRS includes workbuddy -> .workbuddy', () => {
  assert.equal(PLATFORM_DIRS.workbuddy, '.workbuddy');
  // 全 6 平台在表
  assert.deepEqual(Object.keys(PLATFORM_DIRS), ['claude-code', 'cursor', 'codex', 'cline', 'dify', 'workbuddy']);
});

// PD2 detectPlatform 单平台命中返回该平台
test('PD2 detectPlatform returns sole installed platform', () => {
  const home = mkTmp();
  setHome(home);
  makeDir(home, '.workbuddy');
  assert.equal(detectPlatform(), 'workbuddy');
});

// PD3 detectPlatform 多平台命中返回表顺序首（claude-code 在前），detectAllPlatforms 返回两者
test('PD3 detectPlatform multi-platform returns first by table order', () => {
  const home = mkTmp();
  setHome(home);
  makeDir(home, '.claude');
  makeDir(home, '.workbuddy');
  // claude-code 在表首 → 优先返回
  assert.equal(detectPlatform(), 'claude-code');
  const all = detectAllPlatforms();
  assert.ok(all.includes('claude-code'));
  assert.ok(all.includes('workbuddy'));
});

// PD4 detectPlatform 零平台返回 claude-code 默认
test('PD4 detectPlatform returns claude-code default when none installed', () => {
  const home = mkTmp();
  setHome(home);
  assert.equal(detectPlatform(), 'claude-code');
  assert.deepEqual(detectAllPlatforms(), []);
});

// PD5 OPSFORGE_PLATFORM env 优先于目录探测（测试后还原 env）
test('PD5 OPSFORGE_PLATFORM env overrides directory detection', () => {
  const home = mkTmp();
  setHome(home);
  makeDir(home, '.workbuddy');
  process.env.OPSFORGE_PLATFORM = 'cursor';
  try {
    assert.equal(detectPlatform(), 'cursor');
  } finally {
    delete process.env.OPSFORGE_PLATFORM;
  }
});

// PD6 platformInstallDir/mcpConfigPathFor 返回正确路径
test('PD6 platformInstallDir + mcpConfigPathFor return correct paths', () => {
  const home = mkTmp();
  setHome(home);
  const dir = platformInstallDir('workbuddy');
  const mcp = mcpConfigPathFor('workbuddy');
  assert.ok(dir.endsWith(path.join('.workbuddy')), dir);
  assert.ok(mcp.endsWith(path.join('.workbuddy', 'mcp.json')), mcp);
  // dify 无本地 mcp 配置 → null
  assert.equal(mcpConfigPathFor('dify'), null);
  // 未知平台 → null
  assert.equal(platformInstallDir('nonexistent'), null);
});

// PD7 isExecutableEntrypoint 判断 MCP entrypoint 是否为可执行脚本
test('PD7 isExecutableEntrypoint distinguishes executable vs non-executable entrypoints', () => {
  assert.equal(isExecutableEntrypoint('source.md'), false);
  assert.equal(isExecutableEntrypoint('server.mjs'), true);
  assert.equal(isExecutableEntrypoint('server.js'), true);
  assert.equal(isExecutableEntrypoint('SERVER.MJS'), true); // case-insensitive
  assert.equal(isExecutableEntrypoint(undefined), false);
  assert.equal(isExecutableEntrypoint(null), false);
  assert.equal(isExecutableEntrypoint(''), false);
  assert.equal(isExecutableEntrypoint('readme.txt'), false);
});
