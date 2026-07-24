// tools/opsforge-bootstrap.mjs — Phase 3.6 落点 1: OpsForge-as-capability 自举。
// 把 opsforge-meta 能力装入目标平台 config dir；并把薄 runtime wrapper（opsforge-runtime.mjs
// + paths.mjs，零 bare-dep）复制到 resolveOpsforgeHome()/runtime/ 保留仓库布局，使目标平台内
// @opsforge / @opsforge-wizard / installer agent 可经 .runtime-root.json 找到仓库根的 install.mjs
// 动态 import（彻底脱钩相对路径，避免 ERR_MODULE_NOT_FOUND）。registry*.yaml 平铺到 home 根
// （install.mjs readRegistryForInstall 的 home 回退读这里）。
// steering 拥有，ESM，零新依赖（复用 node:fs/path + tools/paths.mjs + install.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveOpsforgeHome,
  atomicWrite,
  assertSlugSegment,
} from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 载体 B 的三个 meta-capability（agent 菜单 + skill 向导 + agent 安装器）。
const DEFAULT_META_CAPS = [
  'opsforge-meta.opsforge',
  'opsforge-meta.opsforge-wizard',
  'opsforge-meta.opsforge-installer',
];

// 复制到 ~/.opsforge/runtime/ 保留相对路径的 runtime 子树（零 bare-dep，可独立加载）。
const RUNTIME_TREE = [
  'tools/opsforge-runtime.mjs',
  'tools/paths.mjs',
];

// 平铺复制到 ~/.opsforge/ 根的文件（install.mjs readRegistryForInstall 的 home 回退读这里）。
const HOME_FLAT_FILES = [
  'registry.yaml',
  'registry-brands.yaml',
];

/**
 * bootstrap({platform, project, repoRoot, opsforgeHome, caps}) — 自举入口。
 * 用 install.mjs install()（内含 adapter.translate()+install()）把 opsforge-meta
 * 能力装入目标平台 config dir；同时：
 *   - 把 opsforge-runtime.mjs + paths.mjs 复制到 opsforgeHome/runtime/tools/（保布局）
 *   - 把 registry*.yaml 复制到 opsforgeHome/（home 回退）
 *   - 写 opsforgeHome/.runtime-root.json 记录仓库根（runtime 据此动态 import install.mjs）
 *
 * 幂等：runtime 文件用 atomicWrite（content-hash compare，已存在且内容一致则跳过）；
 * caps 安装本身幂等（install.mjs install() 是 atomic write）；.runtime-root.json 同理。
 *
 * @param {{platform?: string, project?: string, repoRoot: string, opsforgeHome?: string, caps?: string[]}} args
 * @returns {Promise<{installed: string[], copied: string[], skipped: string[], rewritten: string[], runtimeRoot: string}>}
 */
export async function bootstrap(args = {}) {
  const platform = args.platform || 'claude-code';
  const project = args.project || 'default';
  const repoRoot = args.repoRoot || process.cwd();
  const opsforgeHome = args.opsforgeHome || resolveOpsforgeHome();
  // project slug 参与路径（manifests/<project>.manifest.json），断言防穿越。
  assertSlugSegment(project, 'project');
  const caps = args.caps && args.caps.length ? args.caps : DEFAULT_META_CAPS;

  const { install } = await import('../install.mjs');
  const installed = [];
  for (const capId of caps) {
    // install.mjs install() 内部 assertCapId + findCapabilitySource；缺源则抛错。
    // 这里对"opsforge-meta 能力尚未在仓库中"做优雅降级：跳过而非崩（让 runtime 复制仍可进行）。
    try {
      await install({ platform, capId, project, repoRoot, opsforgeHome });
      installed.push(capId);
    } catch (e) {
      // NIT 8: 用 error code 匹配，不耦合报错文本；其它错误（conform 失败等）继续抛。
      if (e && e.code === 'ENOCAPSOURCE') continue;
      throw e;
    }
  }

  const copied = [];
  const skipped = [];
  const rewritten = [];

  // 1. runtime 子树：保留相对路径复制到 opsforgeHome/runtime/（让 ./paths.mjs 相对 import 成立）。
  for (const rel of RUNTIME_TREE) {
    const src = path.join(repoRoot, rel);
    if (!fs.existsSync(src)) continue; // 缺文件优雅跳过
    const dest = path.join(opsforgeHome, 'runtime', rel);
    const existed = fs.existsSync(dest);
    const newContent = fs.readFileSync(src);
    const sameContent = existed && newContent.equals(fs.readFileSync(dest));
    if (sameContent) {
      skipped.push(rel);
      continue;
    }
    await atomicWrite(dest, newContent);
    copied.push(rel);
    if (existed) rewritten.push(rel);
  }

  // 2. registry*.yaml 平铺到 opsforgeHome/（install.mjs readRegistryForInstall home 回退读这里）。
  for (const rel of HOME_FLAT_FILES) {
    const src = path.join(repoRoot, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(opsforgeHome, path.basename(rel));
    const existed = fs.existsSync(dest);
    const newContent = fs.readFileSync(src);
    const sameContent = existed && newContent.equals(fs.readFileSync(dest));
    if (sameContent) {
      skipped.push(rel);
      continue;
    }
    await atomicWrite(dest, newContent);
    copied.push(rel);
    if (existed) rewritten.push(rel);
  }

  // 3. 记录 runtime 根（仓库根）→ runtime 副本据此 pathToFileURL 动态 import install.mjs。
  const runtimeRootPath = path.join(opsforgeHome, '.runtime-root.json');
  const runtimeRoot = {
    runtimeRoot: repoRoot,
    platform,
    project,
    bootstrappedAt: new Date().toISOString(),
  };
  await atomicWrite(runtimeRootPath, JSON.stringify(runtimeRoot, null, 2));

  return { installed, copied, skipped, rewritten, runtimeRoot: repoRoot };
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('opsforge-bootstrap.mjs');
if (invokedDirect) {
  const platform = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : 'claude-code';
  const project = process.argv.includes('--project') ? process.argv[process.argv.indexOf('--project') + 1] : 'default';
  bootstrap({ platform, project, repoRoot: process.cwd() })
    .then((r) => {
      console.log(`bootstrap: installed ${r.installed.length} caps, copied ${r.copied.length} files (${r.skipped.length} skipped)`);
      process.exit(0);
    })
    .catch((e) => { console.error(`bootstrap failed: ${e.message}`); process.exit(1); });
}
