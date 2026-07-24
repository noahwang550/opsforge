// tools/opsforge-runtime.mjs — Phase 3.6 落点 2: 薄 runtime wrapper。
// resolveWorkDir() 三级回退（env > cwd 仓库 > home/workdir > home 首建）+ 读 registry
// （委托 install.mjs readRegistryForInstall，去重）+ 转发 install.mjs 的 install()/list()/doctor()。
// 载体 B：被 bootstrap 复制到 ~/.opsforge/runtime/tools/ 后由平台内 installer agent import。
// 关键：本模块零 bare-dep 顶层 import（仅 node: 内建 + ./paths.mjs），故副本可独立加载；
// install.mjs 经 bootstrap 写入的 ~/.opsforge/.runtime-root.json 指向的仓库根动态 import
// （彻底脱钩相对路径，install.mjs 的 ajv/js-yaml/semver 在仓库 node_modules 解析成立）。
// steering 拥有，ESM，零新依赖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveOpsforgeHome,
  atomicWriteSync,
  readJsonOrNullSync,
} from './paths.mjs';

/**
 * resolveWorkDir(opts) — 工作目录解析（§3.3）。
 *  1. OPSFORGE_WORKDIR env（显式覆盖，steering/CI 用）
 *  2. cwd 是 OpsForge 仓库（templates/+schema/+tools/ 存在）→ 载体 A 兜底（仓库权威）
 *  3. resolveOpsforgeHome()/opsforge-workdir/（已存在 → in-platform 工作目录）
 *  4. 否则：in-platform 首次启动 → 创建 home/opsforge-workdir/ + 写
 *     .opsforge-bootstrap.json（来源平台/首次启动时间/载体类型）
 *  5. carrier='A'（CLI 显式）且 cwd 非仓库 → fail-loud 中文提示
 * @param {{cwd?: string, opsforgeHome?: string, platform?: string, carrier?: 'A'|'B'|'auto'}} opts
 * @returns {{dir: string, source: 'env'|'cwd'|'home'|'home-bootstrap'}}
 */
export function resolveWorkDir(opts = {}) {
  // 1. env 显式覆盖
  if (process.env.OPSFORGE_WORKDIR) {
    return { dir: process.env.OPSFORGE_WORKDIR, source: 'env' };
  }
  const home = opts.opsforgeHome || resolveOpsforgeHome();
  const cwd = opts.cwd || process.cwd();

  // 2. cwd 仓库校验（载体 A 兜底；仓库在时权威，优先于 home/workdir）
  const isRepo = ['templates', 'schema', 'tools'].every((d) => fs.existsSync(path.join(cwd, d)));
  if (isRepo) {
    return { dir: cwd, source: 'cwd' };
  }

  // 3. home/opsforge-workdir/ 已存在 → in-platform 工作目录
  const homeWorkdir = path.join(home, 'opsforge-workdir');
  if (fs.existsSync(homeWorkdir)) {
    return { dir: homeWorkdir, source: 'home' };
  }

  // 5. carrier A 显式 → fail-loud（CLI 用户在非仓库目录下启动向导）
  if (opts.carrier === 'A') {
    throw new Error(
      '当前目录不是 OpsForge 仓库（未找到 templates/ + schema/ + tools/）。' +
      '请在菜单里选 6 安装 opsforge-wizard 能力来引导你，' +
      '或设置 OPSFORGE_WORKDIR 环境变量指向一个 OpsForge 仓库。',
    );
  }

  // 4. in-platform 首次启动 → 创建 home/opsforge-workdir/ + 写 bootstrap.json
  fs.mkdirSync(homeWorkdir, { recursive: true });
  const bootstrapJson = {
    source_platform: opts.platform || 'unknown',
    first_launched_at: new Date().toISOString(),
    carrier_type: 'B',
  };
  atomicWriteSync(path.join(homeWorkdir, '.opsforge-bootstrap.json'), JSON.stringify(bootstrapJson, null, 2));
  return { dir: homeWorkdir, source: 'home-bootstrap' };
}

/**
 * resolveInstallUrl(opsforgeHome) — install.mjs 的动态 import URL。
 *  1. bootstrap 写入的 <opsforgeHome>/.runtime-root.json 指向仓库根（载体 B 副本场景）
 *  2. 回退 ../install.mjs（相对本模块；载体 A in-repo dev 场景）
 * 注：opsforgeHome 缺省时用 resolveOpsforgeHome()（= OPSFORGE_HOME/.opsforge），与
 * bootstrap 默认写入位置一致；显式 opsforgeHome 直传（不追加 .opsforge），与 install.mjs
 * 其余 opsforgeHome 形参语义一致。
 * @param {string} [opsforgeHome]
 * @returns {string} file: URL
 */
function resolveInstallUrl(opsforgeHome) {
  const home = opsforgeHome || resolveOpsforgeHome();
  const rootJson = readJsonOrNullSync(path.join(home, '.runtime-root.json'));
  if (rootJson && rootJson.runtimeRoot) {
    return pathToFileURL(path.join(rootJson.runtimeRoot, 'install.mjs')).href;
  }
  return new URL('../install.mjs', import.meta.url).href;
}

/**
 * readRegistry(opts) — 委托 install.mjs readRegistryForInstall（MINOR 4 去重）。
 * 仓库内 registry.yaml 优先（fresh），回退 home/registry.yaml（副本，避免 stale 覆盖）。
 * @param {{workDir: string, opsforgeHome?: string}} opts
 * @returns {Promise<{capabilities: Object}>} parsed registry (empty if none found)
 */
export async function readRegistry(opts = {}) {
  const { readRegistryForInstall } = await import(resolveInstallUrl(opts.opsforgeHome));
  const workDir = opts.workDir || process.cwd();
  const home = opts.opsforgeHome || resolveOpsforgeHome();
  return readRegistryForInstall(workDir, home) || { capabilities: {} };
}

/**
 * runInstall — 转发 install.mjs install()，repoRoot 用 workDir。
 * @param {{capId: string, project?: string, platform?: string, workDir?: string, opsforgeHome?: string}} args
 */
export async function runInstall(args = {}) {
  const { install } = await import(resolveInstallUrl(args.opsforgeHome));
  const workDir = args.workDir || resolveWorkDir({ opsforgeHome: args.opsforgeHome }).dir;
  return install({
    platform: args.platform || 'claude-code',
    capId: args.capId,
    project: args.project || 'default',
    repoRoot: workDir,
    opsforgeHome: args.opsforgeHome,
  });
}

/** runList — 转发 install.mjs list()。 */
export async function runList(args = {}) {
  const { list } = await import(resolveInstallUrl(args.opsforgeHome));
  return list({ project: args.project || 'default', opsforgeHome: args.opsforgeHome });
}

/** runDoctor — 转发 install.mjs doctor()。 */
export async function runDoctor(args = {}) {
  const { doctor } = await import(resolveInstallUrl(args.opsforgeHome));
  return doctor({
    platform: args.platform || 'claude-code',
    project: args.project || 'default',
    opsforgeHome: args.opsforgeHome,
  });
}
