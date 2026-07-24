// tools/opsforge.mjs — §22.8 interactive wizard (Phase 3.6: top menu + 5-step
// install flow + discover-from-manifest + 3-report status + feedback jsonl).
// 载体 A：仓库内 CLI。载体 B：meta-skill/agent（packs/opsforge-meta/）经 install
// 装入目标平台后 @opsforge 启动本向导逻辑。裸子命令（new/install/status/...）
// 保留向后兼容；`opsforge menu` 进入顶层 6 选项中文菜单。
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpsforgeHome, resolveHome, atomicWriteSync, assertCapId, assertSlugSegment } from './paths.mjs';
import { render } from './report-renderer.mjs';
import { resolveWorkDir } from './opsforge-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLATFORMS = ['claude-code', 'cursor', 'codex', 'cline', 'dify'];

/**
 * detectPlatform(opts) — 自动探测目标平台（修审计 #4：去硬编码 claude-code）。
 * 遍历 5 个平台 config dir（按 opts.opsforgeHome 或 resolveHome() 解析），返回首个存在的；
 * 均不中则默认 claude-code。MAJOR 2: 修 OP19 空转——改成 lazy 解析（不再用模块级常量），
 * 使 OPSFORGE_HOME 在 import 后设置也能生效。
 * @param {{opsforgeHome?: string}} opts
 * @returns {string} platform id
 */
export function detectPlatform(opts = {}) {
  const home = opts.opsforgeHome || resolveHome();
  const dirs = {
    'claude-code': path.join(home, '.claude'),
    'cursor': path.join(home, '.cursor'),
    'codex': path.join(home, '.codex'),
    'cline': path.join(home, '.cline'),
    'dify': path.join(home, '.dify'),
  };
  for (const p of PLATFORMS) {
    if (dirs[p] && fs.existsSync(dirs[p])) return p;
  }
  return 'claude-code';
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (!cmd) {
    console.error('usage: opsforge <menu|new|install|status|doctor|discover|report|feedback|wizard>');
    console.error('运行 opsforge menu 进入交互菜单');
    return 2;
  }
  try {
    switch (cmd) {
      case 'menu': return await cmdMenuInteractive(argv.slice(1));
      case 'new': return await cmdNewSubcommand(argv.slice(1));
      case 'install': return await cmdInstallSubcommand(argv.slice(1));
      case 'status': return await cmdStatus(argv.slice(1));
      case 'doctor': return await cmdDoctor(argv.slice(1));
      case 'discover': return await cmdDiscover(argv.slice(1));
      case 'report': return await cmdReport(argv.slice(1));
      case 'feedback': return await cmdFeedbackInteractive(argv.slice(1));
      case 'wizard': return await cmdWizardInteractive(argv.slice(1));
      default:
        console.error(`opsforge: unknown command "${cmd}"`);
        console.error('available: menu, new, install, status, doctor, discover, report, feedback, wizard');
        return 2;
    }
  } catch (e) {
    console.error(`opsforge: ${e.message}`);
    return 1;
  }
}

/** 交互式子命令的非 TTY 守卫：管道/CI 下 stdin 非 TTY 时拒绝挂起（防止 node:test 卡死）。 */
function requireTty(cmd) {
  if (process.stdin.isTTY) return true;
  console.error(`opsforge ${cmd}: 需要交互式终端（TTY stdin）；在非交互环境请用主菜单或管道输入。`);
  return false;
}

/**
 * makeAsker — 交互输入适配器。
 * TTY：用 readline.createInterface（真交互）。
 * 管道：readline.question 在管道下会丢行（首行之后的行在 question 注册前已 emit → 丢失
 *   → 第二个 ask 永不 resolve → 顶层 await unsettled，exit 13）。故非 TTY 时预读全部 stdin
 *   成行队列，按序返回，duck-type 为 readline.Interface（.question/.close）。MAJOR 1。
 * @returns {{question: (q: string, cb: (a: string)=>void)=>void, close: ()=>void}}
 */
function makeAsker() {
  if (process.stdin.isTTY) {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  let data = '';
  try { data = fs.readFileSync(0, 'utf8'); } catch { data = ''; }
  const lines = data.split(/\r?\n/);
  let i = 0;
  return {
    question: (_q, cb) => { cb(i < lines.length ? lines[i++] : ''); },
    close: () => {},
  };
}

/** 顶层菜单交互入口（`opsforge menu`）。 */
async function cmdMenuInteractive(args) {
  if (!requireTty('menu')) return 2;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await cmdMenu(rl, {});
  } finally {
    rl.close();
  }
}

/**
 * cmdMenu(rl, opts) — §2.2 顶层 6 选项中文菜单（首交互）。
 * 循环；非法重问；back/menu/0 回主菜单/退出。
 * @param {readline.Interface} rl
 * @param {{nonInteractive?: boolean, opsforgeHome?: string, workDir?: string}} opts
 * @returns {Promise<number>}
 */
export async function cmdMenu(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const menu = () => console.log([
    '========================================',
    '  OpsForge 能力工坊',
    '========================================',
    '你想做什么？请输入序号：',
    '  1) 新建一个能力（从零开始写）',
    '  2) 安装已有能力到我的平台',
    '  3) 我的能力（已装能力 + 触发方式）',
    '  4) 诊断问题（已装的能力出毛病了）',
    '  5) 查看能力报告（流转进度 / 体检）',
    '  6) 反馈（给能力打分）',
    '  0) 退出',
    '----------------------------------------',
  ].join('\n'));
  while (true) {
    menu();
    const choice = (await ask('请选择 [0-6]: ')).trim();
    if (choice === '0' || choice === '' || choice === 'quit' || choice === 'exit') return 0;
    if (choice === 'menu' || choice === 'back') continue;
    try {
      switch (choice) {
        case '1': await cmdNewFlow(rl, opts); break;
        case '2': await promptInstallFlow(rl, opts); break;
        case '3': await cmdDiscover({ ...opts, project: opts.project }); break;
        case '4': await cmdDoctorFlow(rl, opts); break;
        case '5': await cmdStatusFlow(rl, opts); break;
        case '6': await cmdFeedback(rl, opts); break;
        default:
          console.log('没看懂这个选项，请输入 0 到 6 之间的数字。');
      }
    } catch (e) {
      console.log(`[黄] ${e.message}`);
      console.log('已返回主菜单。');
    }
  }
}

/** 菜单分支 1：新建能力（scaffold）。复用 promptNew + new-capability.mjs。 */
async function cmdNewFlow(rl, opts = {}) {
  const o = await promptNew(rl);
  const { scaffold } = await import('./new-capability.mjs');
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  const result = scaffold({
    kind: o.kind, slug: o.slug, name: o.name, brand: o.brand,
    root: workDir,
    templatesDir: path.resolve(__dirname, '..', 'templates'),
  });
  console.log(`绿 已创建: ${result.destPath}`);
  console.log('下一步: 填写业务字段（标记 __FILL_ME__ 的位置），然后回主菜单选 5 查看报告。');
}

/** 菜单分支 4：诊断。 */
async function cmdDoctorFlow(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const platform = detectPlatform({ opsforgeHome: opts.opsforgeHome });
  const project = (await ask('project name (default: default): ')).trim() || 'default';
  const { doctor } = await import('../install.mjs');
  const r = await doctor({ platform, project, opsforgeHome: opts.opsforgeHome });
  const light = r.healthy ? '绿' : '红';
  console.log(`${light} healthy: ${r.healthy}`);
  for (const i of r.issues) console.log(`  [${i.severity}] ${i.check}: ${i.detail}`);
}

/** 菜单分支 5：报告（渲染全 3 报告）。 */
async function cmdStatusFlow(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const targetPath = (await ask('能力目录路径（回车=当前目录）: ')).trim() || (opts.workDir || process.cwd());
  await cmdStatus([targetPath]);
}

/** opsforge wizard — 旧入口（scaffold→status 提示），保留向后兼容（OP10）。 */
async function cmdWizardInteractive(args) {
  if (!requireTty('wizard')) return 2;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await cmdWizard(rl, { root: process.cwd() });
  } finally {
    rl.close();
  }
}

/** @param {readline.Interface} rl  @param {{root: string}} opts  @returns {Promise<number>} */
export async function cmdWizard(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log('OpsForge 向导 — 引导式创建能力');
  const kind = (await ask('kind (agent/skill/mcp/workflow/bundle): ')).trim() || 'agent';
  const name = (await ask('name (e.g. copywriter): ')).trim();
  if (!name) { console.error('name is required'); return 1; }
  const brand = (await ask('brand (optional, press enter to skip): ')).trim() || undefined;
  const slug = brand || (await ask('pack slug (e.g. marketing-team): ')).trim();
  if (!slug) { console.error('slug is required'); return 1; }
  const { scaffold } = await import('./new-capability.mjs');
  const result = scaffold({
    kind, slug, name, brand,
    root: opts.root || process.cwd(),
    templatesDir: path.resolve(__dirname, '..', 'templates'),
  });
  console.log(`\n绿 已创建: ${result.destPath}`);
  console.log(`下一步: 填写业务字段（标记 __FILL_ME__ 的位置），然后运行:`);
  console.log(`  node tools/validate.mjs ${result.destPath}`);
  console.log(`  opsforge status ${result.destPath}`);
  return 0;
}

/** opsforge discover — §22.10 改读 per-project manifest（修审计 #1 语义错）。
 *  渲染质量灯 + [黄 不可商用] 商用标签 + 触发方式。 */
export async function cmdDiscover(argsOrOpts) {
  // 兼容两种调用：main(['discover']) 传 argv 数组；菜单分支传 opts 对象。
  const opts = Array.isArray(argsOrOpts) ? parseSimpleOpts(argsOrOpts) : (argsOrOpts || {});
  const project = opts.project || 'default';
  const opsforgeHome = opts.opsforgeHome || resolveOpsforgeHome();
  const manifestPath = path.join(opsforgeHome, 'manifests', `${project}.manifest.json`);
  if (!fs.existsSync(manifestPath)) {
    console.log('○ 没有已安装能力（manifest 不存在）。可在主菜单选 2 安装。');
    return 0;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { console.error(`discover: manifest 解析失败: ${e.message}`); return 1; }
  const caps = manifest.capabilities || [];
  if (caps.length === 0) {
    console.log('○ 没有已安装能力。');
    return 0;
  }
  console.log(`绿 已安装 ${caps.length} 个能力：`);
  for (const c of caps) {
    const name = (c.id || '').split('.').pop();
    const qLight = c.effectiveness_flag === 'degraded' ? '黄' : '绿';
    const comm = c.commercial === false ? '[黄 不可商用]' : '[绿 可商用]';
    console.log(`  ${c.id}@${c.version}  ${qLight}  ${comm}  触发 @${name}`);
  }
  return 0;
}

/** opsforge report <capDir> — render validation + security + eval reports */
async function cmdReport(args) {
  const targetPath = args[0] || process.cwd();
  let rendered = 0;
  for (const [file, type] of [
    ['validation-report.json', 'validation-report'],
    ['security-report.json', 'security-report'],
    ['eval-report.json', 'eval-report'],
  ]) {
    const p = path.join(targetPath, file);
    if (!fs.existsSync(p)) continue;
    let report;
    try { report = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error(`${file} parse error: ${e.message}`); continue; }
    const r = render(report, type, { lang: 'zh' });
    console.log(`\n=== ${type} (${report.verdict || '?'}) ===`);
    console.log(r.oneLiner);
    rendered++;
  }
  if (rendered === 0) console.log('○ no reports found in ' + targetPath);
  return 0;
}

/** opsforge new — interactive scaffold → calls new-capability.mjs scaffold */
async function cmdNewSubcommand(args) {
  if (!requireTty('new')) return 2;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const opts = await promptNew(rl);
    const { scaffold } = await import('./new-capability.mjs');
    const result = scaffold({
      kind: opts.kind, slug: opts.slug, name: opts.name, brand: opts.brand,
      root: process.cwd(),
      templatesDir: path.resolve(__dirname, '..', 'templates'),
    });
    console.log(`created: ${result.destPath}`);
    console.log(`next: fill the business fields, then run \`opsforge status ${result.destPath}\``);
    return 0;
  } finally {
    rl.close();
  }
}

/** opsforge install — interactive single-capability install（裸子命令向后兼容）。
 *  修审计 #4：用 detectPlatform() 自动探测，不再硬编码 claude-code。 */
async function cmdInstallSubcommand(args) {
  if (!requireTty('install')) return 2;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const platform = detectPlatform({});
    const opts = await promptInstall(rl, { platform });
    const { install } = await import('../install.mjs');
    const r = await install({
      platform: opts.platform, capId: opts.capId,
      project: opts.project || 'default', repoRoot: process.cwd(),
    });
    console.log(`installed: ${r.installed.join(', ')}`);
    return 0;
  } catch (e) {
    console.error(`install failed: ${e.message}`);
    return 1;
  } finally {
    rl.close();
  }
}

/** opsforge status [path] — render .opsforge-state.json + 全 3 报告（修审计 #2）。 */
export async function cmdStatus(args) {
  const targetPath = (args && args[0]) || process.cwd();
  const statePath = path.join(targetPath, '.opsforge-state.json');
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const light = state.state === 'released' ? '绿' : (state.state === 'staged' ? '黄' : '红');
    console.log(`${light} 状态: ${state.state} (history: ${(state.history || []).length} transitions)`);
    for (const h of state.history || []) console.log(`  ${h.ts}: ${h.from || '(start)'} → ${h.to}`);
  } else {
    console.log('○ 未找到 .opsforge-state.json（非 opsforge 脚手架生成）');
  }
  // 全 3 报告（validation + security + eval）——修审计 #2：原只渲染 validation。
  let rendered = 0;
  for (const [file, type] of [
    ['validation-report.json', 'validation-report'],
    ['security-report.json', 'security-report'],
    ['eval-report.json', 'eval-report'],
  ]) {
    const p = path.join(targetPath, file);
    if (!fs.existsSync(p)) continue;
    let report;
    try { report = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error(`${file} 解析失败: ${e.message}`); continue; }
    const r = render(report, type, { lang: 'zh' });
    console.log(`\n=== ${type} (${report.verdict || '?'}) ===`);
    console.log(r.oneLiner);
    rendered++;
  }
  if (rendered === 0 && !fs.existsSync(statePath)) {
    console.log('○ 无报告可渲染。');
  }
  return 0;
}

/** opsforge doctor — basic interactive doctor */
async function cmdDoctor(args) {
  const platform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : detectPlatform({});
  const project = args.includes('--project') ? args[args.indexOf('--project') + 1] : 'default';
  try {
    const { doctor } = await import('../install.mjs');
    const r = await doctor({ platform, project, repoRoot: process.cwd() });
    const light = r.healthy ? '绿' : '红';
    console.log(`${light} healthy: ${r.healthy}`);
    for (const i of r.issues) {
      console.log(`  [${i.severity}] ${i.check}: ${i.detail}`);
      if (i.fix) console.log(`    fix: ${i.fix}`);
    }
    return r.healthy ? 0 : 1;
  } catch (e) {
    console.error(`doctor failed: ${e.message}`);
    return 1;
  }
}

/** opsforge feedback — 交互式问 1-5 分 + 文字，写 jsonl。
 *  MAJOR 1: 放行管道 stdin（readline 能从 pipe 读），支持位置参数 capId
 *  （`echo "5\n文案" | opsforge feedback <capId>` 直接工作）。仅在非 TTY 且未给 capId
 *  时 fail-loud（防 node:test 无数据管道挂死）。 */
async function cmdFeedbackInteractive(args) {
  const opts = parseSimpleOpts(args);
  const capIdPos = opts._[0];
  if (!process.stdin.isTTY && !capIdPos) {
    console.error('opsforge feedback: 非交互环境需用位置参数提供 capId（opsforge feedback <capId>），或通过管道传入评分与文字。');
    return 2;
  }
  const rl = makeAsker();
  try {
    return await cmdFeedback(rl, { ...opts, capId: capIdPos });
  } finally {
    rl.close();
  }
}

/**
 * cmdFeedback(rl, opts) — 交互 1-5 分 + 文字 →
 * ~/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl。
 * @param {readline.Interface} rl
 * @param {{capId?: string, opsforgeHome?: string}} opts
 */
export async function cmdFeedback(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const opsforgeHome = opts.opsforgeHome || resolveOpsforgeHome();
  // MAJOR 1: 位置参数 capId 优先（管道场景免交互输入 capId）。
  const capId = opts.capId || (await ask('能力 id（如 marketing-team.copywriter）: ')).trim();
  assertCapId(capId);
  const pack = capId.split('.')[0];
  assertSlugSegment(pack, 'pack');
  const ratingStr = (await ask('打分 1-5（5=很好，1=很差）: ')).trim();
  const rating = Number(ratingStr);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    console.error('打分必须是 1 到 5 的整数。');
    return 1;
  }
  const text = (await ask('文字反馈（可选，回车跳过）: ')).trim();
  const fbDir = path.join(opsforgeHome, 'kb', pack, 'feedback');
  fs.mkdirSync(fbDir, { recursive: true });
  const line = JSON.stringify({ cap_id: capId, rating, text, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(path.join(fbDir, `${capId}.jsonl`), line);
  console.log(`绿 已记录反馈：${capId} 评分 ${rating}`);
  return 0;
}

/** @param {readline.Interface} rl
 *  @returns {Promise<{kind, slug, name, brand?}>} */
export async function promptNew(rl) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const kind = (await ask('kind (agent/skill/mcp/workflow/bundle): ')).trim() || 'agent';
  const name = (await ask('name (e.g. copywriter): ')).trim();
  if (!name) throw new Error('name is required');
  const brand = (await ask('brand (optional, press enter to skip): ')).trim() || undefined;
  const slug = brand || (await ask('pack slug (e.g. marketing-team): ')).trim();
  if (!slug) throw new Error('slug is required');
  return { kind, slug, name, brand };
}

/** @param {readline.Interface} rl
 *  @param {{platform: string}} opts
 *  @returns {Promise<{capId, platform, project?}>} */
export async function promptInstall(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const capId = (await ask('capability id (e.g. marketing-team.copywriter): ')).trim();
  if (!capId) throw new Error('capId is required');
  const project = (await ask('project name (default: default): ')).trim() || 'default';
  return { capId, platform: opts.platform || 'claude-code', project };
}

/**
 * promptInstallFlow(rl, opts) — §6 5 步安装引导：
 * ① 选平台（detect 自动探测）→ ② 选方式 → ③ 浏览能力 → ④ 确认依赖 → ⑤ 确认安装。
 * @param {readline.Interface} rl
 * @param {{opsforgeHome?: string, workDir?: string}} opts
 * @returns {Promise<{platform, method, capId, project, confirm: boolean}>}
 */
export async function promptInstallFlow(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const opsforgeHome = opts.opsforgeHome || resolveOpsforgeHome();
  // ① 选平台（detect 自动探测，回车用自动）
  const detected = detectPlatform({ opsforgeHome });
  console.log(`--- 安装能力 ---\n① 选目标平台：`);
  console.log(`   [自动检测] 当前平台：${detected}`);
  console.log(`   1) claude-code   2) cursor   3) codex   4) cline   5) dify`);
  const platAns = (await ask('选 [1-5] 或回车用自动检测: ')).trim();
  const platform = platAns === '' ? detected : (PLATFORMS[Number(platAns) - 1] || detected);
  // ② 选安装方式
  console.log(`② 选安装方式：`);
  console.log(`   1) 从 pack 安装   2) 从 bundle 安装   3) 从 profile 安装   4) 单个能力安装`);
  const methodAns = (await ask('选 [1-4]: ')).trim();
  const method = methodAns || '4';
  // ③ 浏览能力（列已装 manifest 或 registry）+ ④ 确认依赖
  const capId = (await ask('③ 输入能力 id（如 marketing-team.copywriter）: ')).trim();
  assertCapId(capId);
  console.log(`④ 确认依赖：将检查 ${capId} 的依赖能力。`);
  // ⑤ 确认安装
  const confirmAns = (await ask('⑤ 确认安装 [Y/n]: ')).trim().toLowerCase();
  const confirm = confirmAns === '' || confirmAns === 'y' || confirmAns === 'yes';
  if (!confirm) {
    console.log('已取消安装。');
    return { platform, method, capId, project: opts.project || 'default', confirm: false };
  }
  // 执行安装（转发 install.mjs）
  if (!opts.dryRun) {
    const { install } = await import('../install.mjs');
    const workDir = opts.workDir || resolveWorkDir({ opsforgeHome }).dir;
    try {
      const r = await install({ platform, capId, project: opts.project || 'default', repoRoot: workDir, opsforgeHome });
      console.log(`绿 安装完成：${r.installed.join(', ')}`);
    } catch (e) {
      console.log(`[红] 安装失败：${e.message}`);
    }
  }
  return { platform, method, capId, project: opts.project || 'default', confirm };
}

/** 简单 --key value argv 解析为 {key: value, _: [...]}. */
function parseSimpleOpts(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { o[k] = next; i++; }
      else o[k] = true;
    } else o._.push(a);
  }
  return o;
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('opsforge.mjs');
if (invokedDirect) {
  const code = await main();
  process.exit(code);
}
