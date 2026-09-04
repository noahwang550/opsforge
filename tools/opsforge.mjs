// tools/opsforge.mjs — §22.8 interactive wizard (Phase 3.6: top menu + 5-step
// install flow + discover-from-manifest + 3-report status + feedback jsonl).
// 载体 A：仓库内 CLI。载体 B：meta-skill/agent（packs/opsforge-meta/）经 install
// 装入目标平台后 @opsforge 启动本向导逻辑。裸子命令（new/install/status/...）
// 保留向后兼容；`opsforge menu` 进入顶层 7 选项中文菜单。Phase 4：菜单分支 1 追加
// ③收录第三方能力（git → intake）。
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpsforgeHome, resolveHome, atomicWriteSync, assertCapId, assertSlugSegment, detectPlatform, detectAllPlatforms } from './paths.mjs';
import { render } from './report-renderer.mjs';
import { resolveWorkDir } from './opsforge-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLATFORMS = ['claude-code', 'cursor', 'codex', 'cline', 'dify', 'workbuddy'];

/**
 * PRINT_TOPICS — 固定内容单一真相源（P0-A）。
 * 既有 cmdMenu/cmdNewFlow/cmdWizard 等改为读这里的字符串再 console.log，
 * 与 `print` 子命令共用同一源（避免双源真相，消除 prompt drift）。
 * report-templates/*.zh.md 仍由 report-renderer.mjs 读（print 复用同一模板文件）。
 */
const PRINT_TOPICS = {
  'menu': [
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
    '  7) 浏览仓库全部能力（清单 + 适用场景）',
    '  8) 打开能力目录（浏览器，搜索/筛选全部能力）',
    '  9) 导出能力（打包下载，发给团队管理员）',
    '  0) 退出',
    '----------------------------------------',
  ].join('\n'),
  'new-flow': [
    '--- 新建能力 ---',
    '推荐：走访谈→蒸馏→跑通五期，LLM 先生成草稿、你只勾选确认。',
    '  ① 调出 @capability-wizard（统一能力创建向导，自动判断类型）',
    '  ② 收录第三方能力（粘贴来源网址，自动收录）',
  ].join('\n'),
  'wizard-routing': [
    'OpsForge 向导 — 引导式创建能力',
    '推荐使用 @capability-wizard（统一能力创建向导，自动判断类型+引导全流程）。',
    '  ① 调出 @capability-wizard  ② 收录第三方能力',
  ].join('\n'),
  'push-reminder': '📌 提醒：能力有改动后，记得推送云端仓库（或者让我帮你推）——不然团队其他人看不到。',
  'catalog-hint': '想看这能力的详情？主菜单选 8 打开能力目录。',
  'discover-remote-hint': '想看全部能力？主菜单选 8 打开能力目录，或直接跑 opsforge discover。',
  'export-hint': '建好了？回主菜单选 9 导出能力打包下载（发给团队管理员导入）。',
  'export-flow': [
    '--- 导出能力 ---',
    '把本地草稿打包成标准格式压缩包，发给团队管理员导入能力仓库。',
  ].join('\n'),
  'error-recovery': '[黄] <msg>\n可能原因：<reason>\n下一步：<next-step>\n已返回主菜单。',
  'distiller-steps': 'Step ① · Shape inference + C12 mapping: read `_drafts/<slug>/interview.md` `## 流程实录`. Infer the kind with rationale.\nStep ② · Scaffold: `Bash: node tools/new-capability.mjs --kind <推断kind> --slug <slug> --name <name>`.\nStep ③ · Overwrite business fields + dual artifacts: Write the full body in **one** call (all H2 sections + dual artifacts).\nStep ④ · Field defaults author-confirm: give quadrant/source/confidence/allow_exact_reason defaults per case.\nStep ⑤ · `Bash: opsforge set-phase <capDir> distill_done`.',
  'wizard-phases': 'Phase 1 · 访谈期: invoke @capability-wizard (claude-code) or use capability-wizard skill (Tier 2/3). Produces _drafts/<slug>/interview.md.\nPhase 2 · 蒸馏期: invoke @capability-distiller. Reads interview.md, infers kind, scaffolds, overwrites body + dual artifacts, calls set-phase distill_done.\nPhase 3 · 跑通期: run structure gate + run-light gate (test-runner.mjs dry-run ≥2 cases). Render two-tier light via report-renderer.mjs.\nPhase 4 · 迭代期: passive evolve trigger (feedback≤2 or 3rd discover/doctor call → suggest opsforge evolve).',
};

/**
 * cmdPrint(args, opts) — `opsforge print <topic>` emit 固定内容到 stdout（P0-A）。
 * 单一真相源：PRINT_TOPICS map。既有 cmdMenu/cmdNewFlow 等改读同一常量，
 * 避免双源真相，消除 LLM 自由叙述 prompt drift（如 ③ 第三方分支丢失）。
 * @param {string[]} args  argv.slice(1) after 'print'; args[0] = topic
 * @param {{out?: (s: string) => void}} opts  opts.out 默认 console.log
 * @returns {Promise<number>} 0=success, 1=unknown topic, 2=missing topic arg
 */
export async function cmdPrint(args = [], opts = {}) {
  const out = opts.out || console.log;
  const topic = args[0];
  if (!topic) {
    console.error('usage: opsforge print <topic>');
    console.error(`available: ${Object.keys(PRINT_TOPICS).join(', ')}`);
    return 2;
  }
  const content = PRINT_TOPICS[topic];
  if (!content) {
    console.error(`opsforge print: unknown topic "${topic}"`);
    console.error(`available: ${Object.keys(PRINT_TOPICS).join(', ')}`);
    return 1;
  }
  out(content);
  return 0;
}

/**
 * detectPlatform / detectAllPlatforms — 抽到 tools/paths.mjs（单一真相源
 * PLATFORM_DIRS），install.mjs 可静态 import（避免反向循环依赖）。
 * 签名与原 detectPlatform 一致，现有调用点零改动。
 * 同时 re-export 供外部 import { detectPlatform } from './opsforge.mjs'。
 */
export { detectPlatform, detectAllPlatforms };

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (!cmd) {
    console.error('usage: opsforge <menu|new|install|status|doctor|discover|report|feedback|wizard|set-phase>');
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
      case 'evolve': return await cmdEvolveInteractive(argv.slice(1));
      case 'evals-import': return await cmdEvalsImport(argv.slice(1));
      case 'evals-export': return await cmdEvalsExport(argv.slice(1));
      case 'benchmark': return await cmdBenchmark(argv.slice(1));
      case 'set-phase': return await cmdSetPhase(argv.slice(1));
      case 'print': return await cmdPrint(argv.slice(1));
      default:
        console.error(`opsforge: unknown command "${cmd}"`);
        console.error('available: menu, new, install, status, doctor, discover, report, feedback, wizard, evolve, evals-import, evals-export, benchmark, set-phase, print');
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
 * cmdMenu(rl, opts) — §2.2 顶层 7 选项中文菜单（首交互）。
 * 循环；非法重问；back/menu/0 回主菜单/退出。
 * @param {readline.Interface} rl
 * @param {{nonInteractive?: boolean, opsforgeHome?: string, workDir?: string}} opts
 * @returns {Promise<number>}
 */
export async function cmdMenu(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const menu = () => console.log(PRINT_TOPICS['menu']);
  while (true) {
    menu();
    const choice = (await ask('请选择 [0-9]: ')).trim();
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
        case '7': await cmdDiscover({ ...opts, all: true }); break;
        case '8': await cmdCatalogFlow(rl, opts); break;
        case '9': await cmdExportFlow(rl, opts); break;
        default:
          console.log('没看懂这个选项，请输入 0 到 9 之间的数字。');
      }
    } catch (e) {
      console.log(`[黄] ${e.message}`);
      console.log('已返回主菜单。');
    }
  }
}

/** 菜单分支 1：新建能力。methodology §3：默认路由到 @capability-wizard
 *  （访谈→蒸馏→跑通五期，LLM 引导式沉淀）。
 *  Phase 4 追加 ②：收录第三方能力（git → intake），走 intake.mjs 治理路径。 */
async function cmdNewFlow(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log(PRINT_TOPICS['new-flow']);
  const ch = (await ask('选 [1-2]（回车=①）: ')).trim() || '1';
  if (ch === '2') {
    return await cmdIntakeFlow(rl, opts);
  }
  if (ch !== '2') {
    console.log('请调出 @capability-wizard（claude-code 形态）；非 claude-code 平台把');
    console.log('packs/opsforge-meta/skills/capability-wizard/SKILL.md 内容贴到任意 LLM 跑一遍，');
    console.log('产出 _drafts/<slug>/interview.md 后交给 @capability-distiller 蒸馏。set-phase 对你透明。');
    return 0;
  }
}

/** 能力创建/收录收尾统一提醒：别忘了推送云端仓库（B2 会话级提醒）。 */
export function printPushReminder() {
  console.log(PRINT_TOPICS['push-reminder']);
}

/** A2: 业务指引——指向能力目录（主菜单选 8）。 */
export function printCatalogHint() {
  console.log(PRINT_TOPICS['catalog-hint']);
}

/** A2: 业务指引——指向能力导出（主菜单选 9）。 */
export function printExportHint() {
  console.log(PRINT_TOPICS['export-hint']);
}

/**
 * cmdCatalogFlow(rl, opts) — A1: 菜单分支 8。
 * 启动 catalog server（port:0 OS 分配）→ 读 server.address().port → 开浏览器 →
 * 按回车关闭 server 回主菜单（不让用户 Ctrl+C，避免 Windows 杀整个进程）。
 * 文案不含 127.0.0.1/port/http:// 字眼（URL 只传给 openInBrowser 不打印）。
 * @param {readline.Interface} rl
 * @param {{opsforgeHome?: string, workDir?: string, startServer?: Function, openBrowser?: Function}} opts
 * @returns {Promise<number>}
 */
export async function cmdCatalogFlow(rl, opts = {}) {
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  const { openInBrowser } = await import('./opsforge-catalog-launcher.mjs');
  const open = opts.openBrowser || openInBrowser;
  // C2: 仓库在→本地 server；仓库不在→远程探测.
  const repoPresent = ['templates', 'schema', 'tools'].every((d) => fs.existsSync(path.join(workDir, d)));
  if (!repoPresent) {
    // repo-less：探测远程可达.
    const fetchFn = opts.fetchRemoteIndex || (await import('./index-fetch.mjs')).fetchRemoteIndex;
    const officialUrl = opts.officialIndexUrl || (await import('./index-fetch.mjs')).officialIndexUrl;
    try {
      const url = process.env.OPSFORGE_INDEX_URL || officialUrl({ repoRoot: workDir });
      await fetchFn({ url, refresh: false });
      // 远程可达 → 打开远程站点（URL 去掉 /index.json 换 /）.
      const catalogUrl = url.replace(/\/index\.json$/, '/');
      open(catalogUrl);
      console.log('已打开能力广场（在线版），看完关掉浏览器回这里按回车。');
      await ask('按回车回到主菜单…');
    } catch {
      // 远程不可达 → 不起浏览器，业务话兜底，不提示选 8（避免死循环）.
      console.log('能力广场暂时打不开，可能还没准备好。稍后再试，或联系团队管理员。');
    }
    return 0;
  }
  // 仓库在→照旧起本地 server.
  const { startCatalogServer } = await import('./catalog-server.mjs');
  const start = opts.startServer || startCatalogServer;
  let server;
  try {
    const { server: srv } = await start({ port: 0, host: '127.0.0.1', repoRoot: workDir });
    server = srv;
    const port = server.address().port;   // 第六部分技术修正：不改 startCatalogServer 返回结构
    open(`http://127.0.0.1:${port}/`);     // openInBrowser 内部校验 host，失败只打印业务话
    if (opts.onServerStart) opts.onServerStart(port);
    console.log('已打开能力目录，浏览器应该已经弹出来了。看完按回车回到主菜单。');
    await ask('按回车回到主菜单…');
  } catch (e) {
    console.log(`[黄] 能力目录暂时打不开：${e.message}`);
    console.log('你可以在主菜单选 7 浏览全部能力清单。');
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (opts.onServerStop) opts.onServerStop();
  }
  return 0;
}

/**
 * cmdExportFlow(rl, opts) — 菜单分支 9：导出能力打包下载。
 * listDrafts → 选 → 预检（§A+§B+static-only tests）→ exportCapability() → 业务话结果。
 * @param {readline.Interface} rl
 * @param {{opsforgeHome?: string, workDir?: string, listDrafts?: Function, exportFn?: Function}} opts
 * @returns {Promise<number>}
 */
export async function cmdExportFlow(rl, opts = {}) {
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  console.log(PRINT_TOPICS['export-flow']);
  const { listDrafts } = await import('./paths.mjs');
  const listFn = opts.listDrafts || listDrafts;
  const drafts = listFn(workDir);
  if (drafts.length === 0) {
    console.log('○ 没有本地草稿。请先在主菜单选 1 新建能力。');
    return 0;
  }
  console.log('本地草稿：');
  drafts.forEach((d, i) => {
    const mtime = new Date(d.mtime).toLocaleString('zh-CN');
    const fill = d.hasFillMe ? ' [黄 还有未填项]' : '';
    console.log('  ' + (i + 1) + ') ' + d.slug + '.' + d.name + '  (' + d.kind + ')  ' + mtime + fill);
  });
  const sel = (await ask('选择要导出的序号（回车取消）: ')).trim();
  if (!sel) { console.log('已取消。'); return 0; }
  const idx = Number(sel) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= drafts.length) {
    console.log('序号不对，已取消。');
    return 1;
  }
  const draft = drafts[idx];
  if (draft.hasFillMe) {
    console.log('黄 这个草稿还有未填项（标记 __FILL_ME__）。建议先填完再导出。');
    if ((await ask('仍要导出？[y/N]: ')).trim().toLowerCase() !== 'y') {
      console.log('已取消。');
      return 0;
    }
  }
  const exportFn = opts.exportFn || (await import('./export.mjs')).exportCapability;
  const { ExportError } = await import('./export.mjs');
  try {
    console.log('正在导出…');
    const r = await exportFn({ draftDir: draft.path, repoRoot: workDir });
    console.log('绿 已导出！文件：' + r.zipPath);
    console.log('把这个压缩包发给团队管理员，管理员会导入到能力仓库，其他人就能在主菜单选 2 装到他们电脑。');
    printCatalogHint();
  } catch (e) {
    if (e instanceof ExportError) {
      if (e.kind === 'tests') {
        const fail = e.report && typeof e.report.fail === 'number' ? e.report.fail : '?';
        console.log('[红] 预检没过：测试有 ' + fail + ' 项没通过，请改完再回主菜单选 9 重新导出。');
      } else {
        const typeMap = { validation: 'validation-report', security: 'security-report' };
        const r = render(e.report, typeMap[e.kind] || 'validation-report', { lang: 'zh' });
        console.log('[红] 预检没过：' + r.oneLiner);
        console.log('请按上面的修复指引改完，再回主菜单选 9 重新导出。');
      }
    } else {
      console.log('[红] ' + e.message);
    }
  }
  return 0;
}

/** 菜单分支 1②：收录第三方能力（git → intake）。
 *  走 intake.mjs 完整治理路径：clone（SSRF + shell-metachar 拒绝 + 50MB 上限）
 *  → LICENSE 允许清单 → new-capability --third-party 草稿 → upstream-ref.json。 */
export async function cmdIntakeFlow(rl, opts = {}) {
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log('--- 收录第三方能力 ---');
  console.log('把公开 git 仓库里的 skill/agent/mcp/workflow 收进能力仓库（third-party 隔离）。');
  const repoUrl = (await ask('上游 git 地址（https://...）: ')).trim();
  if (!repoUrl) { console.log('黄 未填 git 地址，已取消。'); return 1; }
  if (!/^https:\/\//i.test(repoUrl)) { console.log('黄 只支持 https:// 开头的 git 地址（SSRF 防护）。'); return 1; }
  const kind = (await ask('能力类型 [agent/skill/mcp/workflow]（回车=agent）: ')).trim() || 'agent';
  if (!['agent', 'skill', 'mcp', 'workflow'].includes(kind)) {
    console.log(`黄 不认识的类型 "${kind}"，只支持 agent/skill/mcp/workflow。`); return 1;
  }
  const name = (await ask('能力名（英文小写，如 code-reviewer）: ')).trim();
  if (!name) { console.log('黄 未填能力名，已取消。'); return 1; }
  const license = (await ask('LICENSE（SPDX，如 MIT/Apache-2.0；回车=MIT）: ')).trim() || 'MIT';
  const owner = (await ask('负责人（回车=unknown）: ')).trim() || 'unknown';
  // P1-A: reference-scope intake (only store git URL, no clone) is the default.
  const scopeCh = (await ask('收录方式 ① 完整克隆（vendored，克隆到本地）② 只存 git 地址（reference，不克隆，安装时拉取）（回车=②）: ')).trim() || '2';
  const scope = scopeCh === '1' ? 'full' : 'reference';
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  try {
    const { intake } = await import('./intake.mjs');
    const r = await intake({ repoUrl, license, kind, name, owner, repoRoot: workDir, scope });
    console.log(`绿 已收录: ${r.draftPath} @${r.commit}（${r.sizeBytes === null ? 'reference scope' : r.sizeBytes + ' bytes'}）`);
    console.log('下一步: 填写业务字段（标记 __FILL_ME__ 的位置），然后回主菜单选 5 查看报告。');
    printExportHint();
    printCatalogHint();
    return 0;
  } catch (e) {
    console.log(`黄 收录失败: ${e.message}`);
    console.log('提示：LICENSE 需在允许清单内（MIT/Apache-2.0/BSD/ISC 等宽松协议）；仓库需可公开访问。');
    return 1;
  }
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
  console.log(PRINT_TOPICS['wizard-routing']);
  const route = (await ask('选 [1-2]（回车=①）: ')).trim() || '1';
  if (route !== '2') {
    console.log('请调出 @capability-wizard；非 claude-code 平台用 capability-wizard skill。');
    console.log('产出 _drafts/<slug>/interview.md 后交给 @capability-distiller 蒸馏。');
    return 0;
  }
  // 逃生路径：直接 scaffold（保留 promptNew 问答，J.12）
  console.log('--- 逃生路径：直接脚手架 ---');
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
  printExportHint();
  printCatalogHint();
  return 0;
}

/** B1: 把远程 index.json 的 summary capabilities（publicEntry 子集）映射成
 *  renderDiscoverAll 兼容的 inventory entry 形. 远程清单全是 released 态. */
const QUALITY_TO_LIGHT = { green: '绿', yellow: '黄', red: '红' };
function indexToInventory(index) {
  const entries = (index.capabilities || []).map((cap) => ({
    id: cap.id,
    version: cap.version,
    kind: cap.kind,
    pack: cap.pack,
    display_name_zh: cap.name,
    display_name_en: cap.nameEn,
    description: cap.description,
    detail: cap.detail || cap.description || '',
    scenarios: (cap.scenarios || []).join('\n'),
    scenarioTag: cap.scenarioTag,
    scope: cap.scope,
    project: cap.project,
    sourceOrigin: cap.source && cap.source.key === 'third-party' ? 'third-party' : 'original',
    example: cap.availability === 'reference-only',
    light: QUALITY_TO_LIGHT[cap.quality] || '黄',
    state: 'released',
    platformSupport: (cap.platformSupport || []).map((p) => ({
      platform: p.platform, tier: p.tier, hardUnmet: [],
    })),
  }));
  return {
    all: entries,
    general: entries.filter((e) => e.scope !== 'project'),
    brands: {},
  };
}

/** opsforge discover — §22.10 改读 per-project manifest（修审计 #1 语义错）。
 *  渲染质量灯 + [黄 不可商用] 商用标签 + 触发方式。
 *  `discover --all`：全局仓库能力总览（从 registry + body H2 章节派生），
 *  与 per-project "已装能力" 语义分层。 */
export async function cmdDiscover(argsOrOpts) {
  // 兼容两种调用：main(['discover']) 传 argv 数组；菜单分支传 opts 对象。
  const opts = Array.isArray(argsOrOpts) ? parseSimpleOpts(argsOrOpts) : (argsOrOpts || {});
  // --all：全局仓库能力总览（非 per-project 已装清单）。
  if (opts.all) {
    const { buildInventory, renderDiscoverAll } = await import('./inventory.mjs');
    const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
    const repoPresent = ['templates', 'schema', 'tools'].every((d) => fs.existsSync(path.join(workDir, d)));
    // B1: 远程优先.
    const fetchFn = opts.fetchRemoteIndex || (await import('./index-fetch.mjs')).fetchRemoteIndex;
    const officialUrl = opts.officialIndexUrl || (await import('./index-fetch.mjs')).officialIndexUrl;
    try {
      const url = process.env.OPSFORGE_INDEX_URL || officialUrl({ repoRoot: workDir });
      const { index } = await fetchFn({ url, refresh: !!opts.refresh });
      // index.capabilities (summary 形) → renderDiscoverAll 兼容的 entry 形.
      const inv = indexToInventory(index);
      console.log(`● 已连上能力仓（共 ${index.count} 项能力）`);
      console.log(renderDiscoverAll(inv, { lang: 'zh' }));
      return 0;
    } catch {
      // 失败 + 仓库在 → 本地回退.
      if (repoPresent) {
        console.log('○ 暂时连不上能力仓，显示本地已装能力。');
        const inv = await buildInventory({ repoRoot: workDir, includeDrafts: !!opts.includeDrafts });
        console.log(renderDiscoverAll(inv, { lang: 'zh' }));
        return 0;
      }
      // 失败 + repo-less → 不提示"主菜单选 8"（那也会失败，避免死循环）.
      console.log('○ 暂时连不上能力仓，稍后再试或联系团队管理员。');
      return 0;
    }
  }
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
    console.log(`  ${c.id}@${c.version}  ${qLight}  ${comm}  触发 @${name}  （主菜单选 8 可看详情）`);
    // methodology §5.4 C4: passive evolve trigger (feedback≤2 or 3rd discover/doctor call).
    try {
      const trig = evolveTriggerSuggest(c.id, opsforgeHome);
      if (trig.suggest) {
        console.log(`    [黄] 考虑跑 \`opsforge evolve ${c.id}\` 补一条上次崩了的情况 (${trig.reason})`);
      }
    } catch { /* no capId — skip */ }
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
    // methodology §5.4 C4: passive evolve trigger per installed cap (feedback≤2 or 3rd call).
    const manifestPath = path.join(resolveOpsforgeHome(), 'manifests', `${project}.manifest.json`);
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const cap of (manifest.capabilities || [])) {
          const trig = evolveTriggerSuggest(cap.id, resolveOpsforgeHome());
          if (trig.suggest) {
            console.log(`  [黄] ${cap.id}: 考虑跑 \`opsforge evolve ${cap.id}\` 补一条上次崩了的情况 (${trig.reason})`);
          }
        }
      } catch { /* manifest parse — skip trigger */ }
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
  const out = opts.out || console.log;
  const opsforgeHome = opts.opsforgeHome || resolveOpsforgeHome();
  // ① 选平台（detect 自动探测，回车用自动）
  const detected = detectPlatform({ opsforgeHome });
  out(`--- 安装能力 ---\n① 选目标平台：`);
  out(`   [自动检测] 当前平台：${detected}`);
  out(`   1) claude-code   2) cursor   3) codex   4) cline   5) dify   6) workbuddy`);
  const platAns = (await ask('选 [1-6] 或回车用自动检测: ')).trim();
  const platform = platAns === '' ? detected : (PLATFORMS[Number(platAns) - 1] || detected);
  // ② 选安装方式
  out(`② 选安装方式：`);
  out(`   1) 从 pack 安装   2) 从 bundle 安装   3) 从 profile 安装   4) 单个能力安装`);
  const methodAns = (await ask('选 [1-4]: ')).trim();
  const method = methodAns || '4';
  // ③ 浏览能力（列已装 manifest 或 registry）+ ④ 确认依赖
  const capId = (await ask('③ 输入能力 id（如 marketing-team.copywriter）: ')).trim();
  assertCapId(capId);
  out(`④ 确认依赖：将检查 ${capId} 的依赖能力。`);
  // ⑤ 确认安装
  const confirmAns = (await ask('⑤ 确认安装 [Y/n]: ')).trim().toLowerCase();
  const confirm = confirmAns === '' || confirmAns === 'y' || confirmAns === 'yes';
  if (!confirm) {
    out('已取消安装。');
    return { platform, method, capId, project: opts.project || 'default', confirm: false };
  }
  // 执行安装（转发 install.mjs）
  if (!opts.dryRun) {
    const { install, RemoteHintError, RemoteNotFoundError } = await import('../install.mjs');
    const workDir = opts.workDir || resolveWorkDir({ opsforgeHome }).dir;
    const installFn = opts.install || install;
    try {
      const r = await installFn({ platform, capId, project: opts.project || 'default', repoRoot: workDir, opsforgeHome });
      out(`绿 安装完成：${r.installed.join(', ')}`);
    } catch (e) {
      if (e?.name === 'RemoteHintError') {
        // 第三方能力 + installHint：指向 installFromGit，对用户只说"来源网址"不出现 git 字样.
        out(`这能力来自社区。要装到本地，请回主菜单选 2，把来源网址粘贴进去即可。`);
      } else if (e?.name === 'RemoteNotFoundError') {
        // 官方能力无仓库：业务话，不给用户做不到的指令.
        out(`这能力在能力仓里找到了。要装到本地，需要团队管理员先帮你装一次（只需一次）。请联系团队管理员。`);
      } else {
        out(`[红] 安装失败：${e.message}`);
      }
    }
  }
  // A2 深链可见性规则：server 在跑→可点击链接；未跑→业务指引（不裸露 URL）。
  if (opts.catalogServerRunning) {
    out(`查看这能力的详情（目录）: http://127.0.0.1:${opts.catalogServerPort}/capabilities/${encodeURIComponent(capId)}`);
  } else {
    out(PRINT_TOPICS['catalog-hint']);
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

/**
 * opsforge evolve <capDir|capId> — 列待沉淀条目，多选后写 _drafts/ 草稿。
 * 不自动 promote（人工 gate 强制点）。
 */
async function cmdEvolveInteractive(args) {
  if (!requireTty('evolve')) return 2;
  const opts = parseSimpleOpts(args);
  const target = opts._[0];
  if (!target) {
    console.error('opsforge evolve: 需提供 capDir 或 capId');
    return 2;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await cmdEvolve(rl, { target, opsforgeHome: opts.opsforgeHome });
  } finally {
    rl.close();
  }
}

/**
 * @param {readline.Interface} rl
 * @param {{target: string, opsforgeHome?: string, workDir?: string}} opts
 * @returns {Promise<number>}
 */
export async function cmdEvolve(rl, opts = {}) {
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const { parseCapability } = await import('./validate.mjs');
  const { collectSources, generateCase } = await import('./regression-sink.mjs');
  const { resolveWorkDir } = await import('./opsforge-runtime.mjs');
  const { assertCapId } = await import('./paths.mjs');
  let capId, capDir;
  try {
    assertCapId(opts.target);
    capId = opts.target;
  } catch {
    // treat as capDir
    const cap = parseCapability(path.resolve(opts.target));
    if (!cap.yaml) {
      console.error(`evolve: 无法解析能力目录 ${opts.target}`);
      return 1;
    }
    capId = cap.yaml.id;
    capDir = cap.dir;
  }
  const { feedbacks, failures } = await collectSources(capId, { opsforgeHome: opts.opsforgeHome });
  if (feedbacks.length === 0 && failures.length === 0) {
    console.log('○ 没有可沉淀的反馈/失败条目（feedback rating<=3 或 eval failures）。');
    return 0;
  }
  console.log(`找到 ${feedbacks.length} 条低分反馈 + ${failures.length} 条 eval 失败。`);
  const items = [];
  for (const f of feedbacks) items.push({ kind: 'feedback', label: `[反馈 ${f.rating}★] ${String(f.text || '').slice(0, 60)}`, src: f });
  for (const f of failures) items.push({ kind: 'failure', label: `[失败 ${f.case || ''} ${f.mode || ''}] ${String(f.reason || '').slice(0, 60)}`, src: null, failure: f });
  items.forEach((it, i) => console.log(`  ${i + 1}) ${it.label}`));
  const sel = (await ask('选择要沉淀的序号（逗号分隔，回车=全部）: ')).trim();
  const idxs = sel === '' ? items.map((_, i) => i) : sel.split(',').map((s) => Number(s.trim()) - 1).filter((n) => n >= 0 && n < items.length);
  if (idxs.length === 0) {
    console.log('未选择，已退出。');
    return 0;
  }
  const pack = capId.split('.')[0];
  const name = capId.split('.')[1];
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  const draftsDir = path.join(workDir, 'packs', '_drafts', pack, name);
  // P2-A: pre-allocate caseNum to prevent file-name races when multiple
  // generateCase calls run concurrently via Promise.all. Start counting from
  // the existing tests/ count + 1.
  const testsDir = path.join(draftsDir, 'tests');
  const startNum = (fs.existsSync(testsDir)
    ? fs.readdirSync(testsDir).filter((f) => f.endsWith('.yaml')).length
    : 0) + 1;
  const results = await Promise.all(idxs.map(async (i, j) => {
    const it = items[i];
    try {
      const fb = it.kind === 'feedback' ? it.src : null;
      const fail = it.kind === 'failure' ? it.failure : null;
      const r = await generateCase(fb, fail, { draftsDir, caseNum: startNum + j });
      return { ok: true, destPath: r.destPath, caseName: r.name };
    } catch (e) {
      return { ok: false, idx: i, error: e.message };
    }
  }));
  let written = 0;
  for (const r of results) {
    if (r.ok) { console.log(`  绿 已生成 ${r.destPath} (name=${r.caseName})`); written++; }
    else { console.log(`  [红] 跳过 #${r.idx + 1}: ${r.error}`); }
  }
  console.log(`\n已生成 ${written} 条草稿到 ${draftsDir}/tests/。`);
  console.log('下一步: 填写 expected + judge_rubric（标记 __FILL_ME__ 的位置），然后:');
  console.log(`  node tools/new-capability.mjs --promote ${draftsDir}`);
  console.log('草稿含 __FILL_ME__，draft gate (R7) 会挡住未填实的草稿——这是人工 gate。');
  return 0;
}

/**
 * opsforge evals-import <evals.json> <pack>.<name> [--workDir <dir>]
 * Imports an evals.json file into _drafts/<pack>/<name>/tests/case-NN.yaml drafts.
 * If draftsDir doesn't exist, scaffolds via new-capability.mjs first.
 * Drafts contain __FILL_ME__ — promote is the human gate (R7 blocks them).
 */
async function cmdEvalsImport(args) {
  const opts = parseSimpleOpts(args);
  const evalsPath = opts._[0];
  const capId = opts._[1];
  if (!evalsPath || !capId) {
    console.error('opsforge evals-import: 用法: evals-import <evals.json> <pack>.<name> [--workDir <dir>]');
    return 2;
  }
  assertCapId(capId);
  const { resolveWorkDir } = await import('./opsforge-runtime.mjs');
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  const draftsDir = path.join(workDir, 'packs', '_drafts', capId.split('.')[0], capId.split('.')[1]);
  let evalsJson;
  try {
    evalsJson = JSON.parse(fs.readFileSync(path.resolve(evalsPath), 'utf8'));
  } catch (e) {
    console.error(`opsforge evals-import: 无法解析 ${evalsPath}: ${e.message}`);
    return 1;
  }
  // Scaffold drafts dir if missing (so import has a home).
  if (!fs.existsSync(draftsDir)) {
    fs.mkdirSync(draftsDir, { recursive: true });
  }
  const { importFromEvalsJson } = await import('./evals-bridge.mjs');
  const { written, skipped } = importFromEvalsJson(evalsJson, { draftsDir });
  console.log(`绿 已导入 ${written.length} 条草稿到 ${draftsDir}/tests/（跳过 ${skipped} 条）。`);
  console.log('草稿含 __FILL_ME__，draft gate (R7) 会挡住未填实的草稿——这是人工 gate。');
  console.log(`  下一步: 填写 expected + judge_rubric，然后 node tools/new-capability.mjs --promote ${draftsDir}`);
  return 0;
}

/**
 * opsforge evals-export <capDir> — read tests/*.yaml → evals.json to stdout.
 */
async function cmdEvalsExport(args) {
  const opts = parseSimpleOpts(args);
  const capDir = opts._[0];
  if (!capDir) {
    console.error('opsforge evals-export: 用法: evals-export <capDir>');
    return 2;
  }
  const { exportToEvalsJson } = await import('./evals-bridge.mjs');
  const result = exportToEvalsJson(path.resolve(capDir));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
}

/**
 * opsforge benchmark <capDir> — with/without-skill delta (advisory, not in release gate).
 */
async function cmdBenchmark(args) {
  const opts = parseSimpleOpts(args);
  const capDir = opts._[0];
  if (!capDir) {
    console.error('opsforge benchmark: 用法: benchmark <capDir>');
    return 2;
  }
  const { runBenchmark } = await import('./benchmark.mjs');
  try {
    const report = await runBenchmark(path.resolve(capDir), {
      opsforgeHome: opts.opsforgeHome,
      runner: opts.runner,
      platform: opts.platform,
    });
    console.log(`benchmark: ${report.cap_id}`);
    console.log(`  with_skill    overall=${report.with_skill.overall} (n=${report.with_skill.n}, passed=${report.with_skill.passed})`);
    console.log(`  without_skill overall=${report.without_skill.overall} (n=${report.without_skill.n}, passed=${report.without_skill.passed})`);
    console.log(`  delta=${report.delta}  min_delta=${report.min_delta}  verdict=${report.verdict}`);
    console.log(`  报告: ${path.join(path.resolve(capDir), 'benchmark-report.json')} (advisory，不进 release gate)`);
    return 0;
  } catch (e) {
    console.error(`opsforge benchmark: ${e.message}`);
    return 1;
  }
}

/**
 * opsforge set-phase <capDir> <phase> [--built-with-model <endpoint:version>] [--built-at <iso>]
 * methodology §7.2: forwards to new-capability.mjs writeOpsforgeState (no duplicated copy —
 * J.6 single source of truth). Pure argv, no readline (Windows-compatible). In-platform
 * agents call this via Bash; authors never edit .opsforge-state.json directly.
 */
async function cmdSetPhase(args) {
  const opts = parseSimpleOpts(args);
  const capDir = opts._[0];
  const phase = opts._[1];
  if (!capDir || !phase) {
    console.error('opsforge set-phase: 用法: set-phase <capDir> <phase> [--built-with-model <endpoint:version>] [--built-at <iso>]');
    return 2;
  }
  const VALID_PHASES = ['interview_done', 'distill_done', 'v0.1_built', 'iteration_converged', 'iteration_capped'];
  if (!VALID_PHASES.includes(phase)) {
    console.error(`opsforge set-phase: phase "${phase}" 不合法; 允许: ${VALID_PHASES.join(', ')}`);
    return 1;
  }
  const { writeOpsforgeState } = await import('./new-capability.mjs');
  const statePath = path.join(capDir, '.opsforge-state.json');
  let existing = null;
  if (fs.existsSync(statePath)) {
    try { existing = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { existing = null; }
  }
  const curState = (existing && existing.state) || 'staged';
  let builtWithModel;
  if (opts['built-with-model'] !== undefined) {
    // Split on the LAST colon so endpoint URLs with a port (https://api.x:8080:v1)
    // keep the host+port in `endpoint` and only the trailing segment is `version`.
    const raw = String(opts['built-with-model']);
    const ci = raw.lastIndexOf(':');
    builtWithModel = ci > 0
      ? { endpoint: raw.slice(0, ci), version: raw.slice(ci + 1) }
      : { endpoint: raw, version: '' };
  }
  const builtAt = opts['built-at'];
  writeOpsforgeState(capDir, curState, curState, { phase, ...(builtWithModel ? { builtWithModel } : {}), ...(builtAt !== undefined ? { builtAt } : {}) });
  console.log(`绿 phase: ${phase} (capDir: ${capDir})`);
  return 0;
}

/**
 * evolveTriggerSuggest(capId, opsforgeHome) — methodology §5.4 C4 passive trigger.
 * Increments a per-cap call counter (~/.opsforge/.evolve-calls.json) and returns
 * {suggest, reason, callCount}. Suggests when feedback≤2 OR 3rd call (discover/doctor).
 * No feedback data → no trigger (doc risk #9). Side-effect: counter write (best-effort).
 */
export function evolveTriggerSuggest(capId, opsforgeHome) {
  assertCapId(capId);
  const home = opsforgeHome || resolveOpsforgeHome();
  const counterPath = path.join(home, '.evolve-calls.json');
  let counts = {};
  try { counts = JSON.parse(fs.readFileSync(counterPath, 'utf8')); } catch { counts = {}; }
  counts[capId] = (counts[capId] || 0) + 1;
  try { fs.mkdirSync(path.dirname(counterPath), { recursive: true }); atomicWriteSync(counterPath, JSON.stringify(counts, null, 2)); } catch { /* best-effort */ }
  const pack = capId.split('.')[0];
  const fbPath = path.join(home, 'kb', pack, 'feedback', `${capId}.jsonl`);
  let lowFeedback = false;
  if (fs.existsSync(fbPath)) {
    for (const line of fs.readFileSync(fbPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try { const e = JSON.parse(line); if (typeof e.rating === 'number' && e.rating <= 2) lowFeedback = true; }
      catch { /* skip */ }
    }
  }
  if (lowFeedback) return { suggest: true, reason: 'feedback≤2', callCount: counts[capId] };
  if (counts[capId] >= 3) return { suggest: true, reason: '3rd-call', callCount: counts[capId] };
  return { suggest: false, reason: null, callCount: counts[capId] };
}

const invokedDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('opsforge.mjs');
if (invokedDirect) {
  const code = await main();
  process.exit(code);
}
