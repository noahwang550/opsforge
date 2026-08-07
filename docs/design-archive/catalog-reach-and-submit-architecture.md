# 技术方案：能力目录触达 + 一键提交到能力仓

> 配套设计：`docs/design-archive/catalog-reach-and-one-click-submit-proposal.md`（proposal-v2 已通过业务评审）  
> 守护基线：零新 npm 依赖 / `additionalProperties:false` / `registry*.yaml` auto-gen / Windows argv / CODEOWNERS+§B / R16–R31 不弱化 + R32 同级新增 / 无 Go  
> 测试基线：bare `node --test` 532/0 → 目标 +N 全绿；6 gates exit 0 不变

---

## 0. 真实代码接入点核对（已读，附 `file_path:line`）

| 接入点 | 现状 | 改动性质 |
|---|---|---|
| `tools/opsforge.mjs:25-57` `PRINT_TOPICS` | 已有 `menu`/`new-flow`/`wizard-routing`/`push-reminder`/`error-recovery`/`distiller-steps`/`wizard-phases` | 新增 `catalog-hint`/`submit-flow`/`submit-hint` 三个 topic；调用点改走 `printSubmitHint` |
| `tools/opsforge.mjs:194-219` `cmdMenu` switch | 选项 1-7，`case '7'` 路由 `cmdDiscover({all:true})`；`ask('请选择 [0-7]: ')` | 加 `case '8'`/`case '9'`；菜单文案加 8/9 行；`0) 退出` 下移；提示改 `[0-9]` |
| `tools/opsforge.mjs:67-83` `cmdPrint` | 已是 PRINT_TOPICS 单一真相源出口 | 新 topic 自动通过 `print <topic>` 暴露（CLI argv 路径覆盖天然成立） |
| `tools/opsforge.mjs:224-249` `cmdNewFlow` / `:259-290` `cmdIntakeFlow` / `:323-352` `cmdWizard` | 末尾 `printPushReminder()` | 改调 `printSubmitHint()` + `printCatalogHint()`（保留 `printPushReminder` 导出供向后兼容/旧测试） |
| `tools/opsforge.mjs:614-652` `promptInstallFlow` | 安装成功 `console.log('绿 安装完成…')` | 在成功行后按"深链可见性规则"分支追加业务指引 |
| `tools/opsforge.mjs:358-399` `cmdDiscover` | 每行 `console.log(\`  ${c.id}@${c.version}  ${qLight}  ${comm}  触发 @${name}\`)` | 行尾追加 `（主菜单选 8 可看详情）`；`--all` 分支 `renderDiscoverAll` 输出同样追加（在 inventory.mjs 渲染层加） |
| `tools/catalog-server.mjs:90-104` `startCatalogServer` | 返回 `{server, snapshot}`，已支持 `port:0`+`host:'127.0.0.1'`；`server.address().port` 读取路径已在测试与 CLI 使用 | **不改返回结构**（设计第六部分技术修正）。`cmdCatalogFlow` 自行 `server.address().port` 读取。测试扩一条显式断言 |
| `tools/intake-remote.mjs:28-51` `fetchGitHubMeta` | GitHub API fetch 模式：`fetchImpl(\`${base}/license\`, {headers})`，`headers.Authorization = \`Bearer ${token}\``，`Accept: application/vnd.github+json`，host 硬编码 `https://api.github.com` | `submit.mjs` 复用同款 fetch 模式 + 同款 host 硬编码 + 同款 `Bearer` 头 |
| `tools/intake-remote.mjs:15-19` `parseGitHubUrl` | regex `^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)` | `submit.mjs` 复用：把 `gitRemote` 先剥离 `git@github.com:owner/repo.git` SSH 形式再走同款解析 |
| `tools/paths.mjs:1-118` | 已有 `resolveHome`/`resolveOpsforgeHome`/`assertSlugSegment`/`assertCapId`/`atomicWriteSync`/`readJsonOrNullSync` | 新增 `listDrafts(repoRoot)` + `submitTokenPath()` + `draftsRoots(repoRoot)` |
| `tools/security-scan.mjs:13-19` `SECRET_PATTERNS` | 有 `ghp_[A-Za-z0-9]{36}`（classic PAT）但**缺 `github_pat_`（fine-grained PAT 前缀）** | R32 新增 fine-grained PAT regex；新增 `scanRepoForSubmitSecrets(repoRoot)` 走仓库 root，复用 `walkFiles` |
| `tools/security-scan.mjs:65-75` `walkFiles` | 已跳过 `.git`/`node_modules` | R32 复用 |
| `tools/report-renderer.mjs:17-26` `render` | 已支持 `validation-report`/`security-report`/`eval-report` 三 type | `cmdSubmitFlow` 预检失败时复用 `render(report, type, {lang:'zh'})` 的 `oneLiner`（业务话红灯），不吐 rule id |
| `tools/test-runner.mjs:34` `isStaticOnly()` / `:426` `opts.runner` | `OPSFORGE_RUNNER=static-only` env 或 `opts.runner='static-only'` | `submit.mjs` 预检调 `runSuite` 时传 `runner:'static-only'`（不污染 env） |
| `tools/validate.mjs:1274-1299` `scanCapabilities` | 扫 `_drafts/_staged/_third-party` + 品牌 + formal | `listDrafts` 复用同款目录枚举逻辑（只取 `_drafts/`） |
| `tools/opsforge.test.mjs:19-28` `mockRl` + `:434` `spawnSync` CLI | 已有 mock rl + spawn argv 测试范式 | 新测试复用 `mockRl`（菜单流）+ `spawnSync`（`opsforge print catalog-hint` argv） |
| `tools/catalog-server.test.mjs:15-20` `withServer` | 已用 `port:0`+`server.address().port` | A1 测试扩一条显式断言 |
| `tools/intake-fetch.mjs:13-43` SSRF 守卫 | `assertPublicUrl` + shell-metachar 拒绝 | `submit.mjs` 解析 gitRemote 后**不调 assertPublicUrl**（gitRemote 来自本地 git config，非用户输入 URL），但 GitHub API host 硬编码 `api.github.com` 自带 SSRF 防护 |

**关键发现**：设计文档第六部分"技术修正"已准确——`startCatalogServer` 返回 `{server, snapshot}` 不含 port，`cmdCatalogFlow` 须自行 `server.address().port`。此读取路径在 `catalog-server.test.mjs:18` 与 `catalog-server.mjs:122-123` 已存在，A1 测试只需补一条显式断言。

---

## 1. 逐文件改动清单（按 slice A1→A2→B1→B2→AB）

### Slice A1（P0）——菜单接入 catalog server

#### 1.1 `tools/opsforge-catalog-launcher.mjs`（**新建**，steering-owned）

```js
// tools/opsforge-catalog-launcher.mjs — A1: 跨平台浏览器启动（零依赖）。
// Windows: cmd /c start "" <url>; mac: open; linux: xdg-open.
// URL 经 new URL 校验 host 必须 127.0.0.1；失败只打印业务指引不报错。
import { spawn } from 'node:child_process';

/**
 * openInBrowser(url) — 跨平台 spawn 浏览器。
 * @param {string} url  必须 http://127.0.0.1:<port>/... 形式
 * @param {{spawn?: Function, out?: (s: string) => void}} opts  注入测试
 * @returns {boolean} true=spawn 已发起（不代表浏览器真的开）；false=校验失败或 spawn 异常
 */
export function openInBrowser(url, opts = {}) {
  const out = opts.out || console.log;
  const spawnImpl = opts.spawn || spawn;
  let parsed;
  try { parsed = new URL(url); }
  catch { out('打开浏览器失败：链接不合法。请在主菜单选 8 重新打开能力目录。'); return false; }
  if (parsed.hostname !== '127.0.0.1') {
    out('打开浏览器失败：只允许本机链接。请在主菜单选 8 重新打开能力目录。');
    return false;
  }
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else if (platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawnImpl(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref?.();
    return true;
  } catch {
    out('浏览器没自动弹出来。请在主菜单选 8 重新打开能力目录。');
    return false;
  }
}
```

**要点**：
- 全 argv 形式（无 shell:true），Windows `cmd /c start "" <url>` 第 4 个空字符串参数是 `start` 的窗口标题占位（防 URL 被当成标题）。
- `detached:true` + `unref()` 让子进程脱离父进程生命周期，菜单不被阻塞。
- `new URL` 校验 + hostname 白名单 `127.0.0.1` 是防注入承重墙。
- 失败路径**只打印业务话指引**（"主菜单选 8"），不抛错、不打印原始 URL（守则）。

#### 1.2 `tools/opsforge.mjs`（**改既有**）

**改 `PRINT_TOPICS`（:25-57）**：`menu` 数组追加 8/9 两行（A1 同时加 8+9 文案，避免二次改 menu 字符串触发回归）；新增 `'catalog-hint'`；提示语 `请选择 [0-7]: ` → `请选择 [0-9]: `。

**改 `cmdMenu` switch（:203-213）**：加 `case '8': await cmdCatalogFlow(rl, opts); break;`（B1 阶段加 `case '9'`）；default 提示 `'0 到 9'`。

**新增 `cmdCatalogFlow`（export，供测试直接调）**：
```js
export async function cmdCatalogFlow(rl, opts = {}) {
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  const { startCatalogServer } = await import('./catalog-server.mjs');
  const start = opts.startServer || startCatalogServer;
  const { openInBrowser } = await import('./opsforge-catalog-launcher.mjs');
  const open = opts.openBrowser || openInBrowser;
  let server;
  try {
    const { server: srv } = await start({ port: 0, host: '127.0.0.1', repoRoot: workDir });
    server = srv;
    const port = server.address().port;   // ← 第六部分技术修正：不改 startCatalogServer 返回结构
    open(`http://127.0.0.1:${port}/`);     // openInBrowser 内部校验 host，失败只打印业务话
    console.log('已打开能力目录，浏览器应该已经弹出来了。看完按回车回到主菜单。');
    await ask('按回车回到主菜单…');
  } catch (e) {
    console.log(`[黄] 能力目录暂时打不开：${e.message}`);
    console.log('你可以在主菜单选 7 浏览全部能力清单。');
  } finally {
    if (server) await new Promise((r) => server.close(r));
  }
  return 0;
}
```

**要点**：`port:0` 让 OS 分配端口；`opts.startServer`/`opts.openBrowser` 注入点供测试 mock；`try/finally` 保证 `server.close()` 必调；**不让用户 Ctrl+C**；文案不含 `127.0.0.1`/`port`/`http://` 字眼（URL 只传给 openInBrowser 不打印）。

#### 1.3 `tools/opsforge-catalog-launcher.test.mjs`（**新建**）

- `CL1` 平台分派：mock `opts.spawn`，断言 win32→`['cmd','/c','start','',url]`；darwin→`['open',url]`；linux→`['xdg-open',url]`。
- `CL2` URL 校验：`http://evil.com/` 返回 false 不调 spawn；`not-a-url` 同上；`http://127.0.0.1:4173/` 调 spawn。
- `CL3` spawn 抛错：返回 false + 打印业务话。
- `CL4` detached+unref：断言 options 含 `detached:true, stdio:'ignore'`。

#### 1.4 `tools/catalog-server.test.mjs`（**扩既有**）

- `CS4 port:0 + server.address().port 读取`：`const {server} = await startCatalogServer({snapshot, webRoot, port:0}); const port = server.address().port; assert.ok(Number.isInteger(port) && port > 0);`

`cmdCatalogFlow` 编排测试放 `opsforge.test.mjs`：
- `OP20 cmdCatalogFlow 按回车关闭 server`：mock startServer 返 `{server:{address:()=>({port:4173}), close:(cb)=>cb&&cb()}}`；mock openBrowser；mockRl `['']`；断言 openBrowser 被调、`server.close()` 被调、返回 0。
- `OP20b cmdCatalogFlow server 起不来打印业务指引`：mock startServer throw；断言打印 `[黄] 能力目录暂时打不开` + `主菜单选 7`。

---

### Slice A2（P1）——使用流程内业务指引触达

#### 2.1 `tools/opsforge.mjs`（**改既有**）

**改 `promptInstallFlow`（:644-648）**：所有 `console.log` 改走 `const out = opts.out || console.log`（与 `cmdPrint:68` 同款）；成功行后按深链可见性规则分支：
```js
if (opts.catalogServerRunning) {
  out(`查看这能力的详情（目录）: http://127.0.0.1:${opts.catalogServerPort}/capabilities/${encodeURIComponent(capId)}`);
} else {
  out(PRINT_TOPICS['catalog-hint']);  // "想看这能力的详情？主菜单选 8 打开能力目录。"
}
```

**session 级状态**：`cmdMenu` 闭包 `let catalogRunning=false; let catalogPort=0;`，`cmdCatalogFlow(rl, {...opts, onServerStart:(p)=>{catalogRunning=true;catalogPort=p;}, onServerStop:()=>{catalogRunning=false;}})`，传给 `promptInstallFlow`。

**改 `cmdDiscover` 已装分支（:389）**：行尾追加 `  （主菜单选 8 可看详情）`。`--all` 分支在 `tools/inventory.mjs renderDiscoverAll` 每条卡片末尾追加同款业务指引。

**改 `cmdNewFlow`/`cmdIntakeFlow`/`cmdWizard` 末尾**：`printPushReminder()` → `printSubmitHint(); printCatalogHint();`。新增两个 export：
```js
export function printSubmitHint() { console.log(PRINT_TOPICS['submit-hint']); }
export function printCatalogHint() { console.log(PRINT_TOPICS['catalog-hint']); }
```
`PRINT_TOPICS['submit-hint']`（B1 加）= `'建好了？回主菜单选 9 一键提交到能力仓（让其他人能下载）。'`。**保留** `printPushReminder` 导出（:252）不删，向后兼容旧测试。

#### 2.2 `tools/inventory.mjs`（**改既有**）

`renderDiscoverAll` 每条卡片末尾追加 ` （主菜单选 8 可看详情）`。不动 `buildInventory` 数据结构。

#### 2.3 `tools/opsforge-wording.test.mjs`（**新建**，见第 7 节）

---

### Slice B1（P0）——`opsforge submit` 贡献码 + 纯菜单

#### 3.1 `tools/paths.mjs`（**改既有**）

```js
/** draftsRoots(repoRoot) — 枚举所有 _drafts 根（通用 + 品牌）。 */
export function draftsRoots(repoRoot) {
  const out = [];
  const general = path.join(repoRoot, 'packs', '_drafts');
  if (fs.existsSync(general)) out.push(general);
  const customersDir = path.join(repoRoot, 'customers');
  if (fs.existsSync(customersDir)) {
    for (const brand of fs.readdirSync(customersDir, { withFileTypes: true })) {
      if (!brand.isDirectory()) continue;
      const bp = path.join(customersDir, brand.name, 'packs', '_drafts');
      if (fs.existsSync(bp)) out.push(bp);
    }
  }
  return out;
}

/**
 * listDrafts(repoRoot) — 列所有 _drafts 下的草稿能力目录。
 * @returns {{slug: string, name: string, kind: string, path: string, mtime: number, hasFillMe: boolean}[]}
 */
export function listDrafts(repoRoot) {
  const out = [];
  for (const draftsDir of draftsRoots(repoRoot)) {
    if (!fs.existsSync(draftsDir)) continue;
    for (const slug of fs.readdirSync(draftsDir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      const slugDir = path.join(draftsDir, slug.name);
      for (const name of fs.readdirSync(slugDir, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const capDir = path.join(slugDir, name.name);
        let kind = 'agent', hasFillMe = false;
        for (const f of fs.readdirSync(capDir, { withFileTypes: true })) {
          const fp = path.join(capDir, f.name);
          if (['capability.yaml','mcp.yaml','workflow.yaml','bundle.yaml'].includes(f.name)) {
            try { const y = yaml.load(fs.readFileSync(fp, 'utf8')); if (y && y.kind) kind = y.kind; } catch {}
          }
          if (f.isFile()) {
            try { if (fs.readFileSync(fp, 'utf8').includes('__FILL_ME__')) hasFillMe = true; } catch {}
          }
        }
        const st = fs.statSync(capDir);
        out.push({ slug: slug.name, name: name.name, kind, path: capDir, mtime: st.mtimeMs, hasFillMe });
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** submitTokenPath() — 贡献码存盘路径 ~/.opsforge/submit-token.json。 */
export function submitTokenPath() {
  return path.join(resolveOpsforgeHome(), 'submit-token.json');
}
```

**要点**：复用 `validate.mjs:1274 scanCapabilities` 同款枚举逻辑只取 `_drafts/`；`yaml` 已是依赖（`security-scan.mjs:7` 用）；`hasFillMe` 供 `cmdSubmitFlow` 展示"还有未填项"。

#### 3.2 `tools/submit.mjs`（**新建**，steering-owned）

核心 export 签名：
```js
export function readSubmitToken()  // → {token}|null
export function writeSubmitToken(token)  // 0600
export function parseGitRemote(gitRemote)  // → {owner,repo}|null
export function resolveGitRemote(opts = {})  // execFileSync('git',argv) → string
export async function submit({ draftDir, repoRoot, token, gitRemote, ...opts })  // → {prUrl,branch,commitSha,updated}
export class PreflightError extends Error { constructor(kind, report) }  // 预检失败
```

`submit()` 内部步骤：
1. `assertDraftUnder(draftDir, repoRoot)` — 路径校验，必须在 `packs/_drafts/` 或 `customers/*/packs/_drafts/` 下，`assertSlugSegment` 防 `..`。
2. `runLocalPreflight(draftDir, repoRoot, opts)` — 动态 import `validate`+`security-scan`+`test-runner`，三报告需 pass/pending，阻断抛 `PreflightError(kind, report)`。
3. `resolveGitRemote({execFile})` → `parseGitRemote` → `{owner, repo}`。
4. `callGithubApi({gh, draftDir, token, fetchImpl})` → `{prUrl, branch, commitSha, updated}`。

**关键不变量**：全 argv `execFileSync('git', [...])`（N2 RCE 思路复用）；GitHub API host 硬编码 `https://api.github.com`（不接用户输入 host）；token 只在 `Authorization` 头，不进 URL/body/日志；草稿文件内容由 `buildTreeEntries(draftDir)` 读盘成 tree entries，跳过 `.opsforge-state.json`/`*-report.json`/`interview.md`（复用 `validate.mjs:37 SKELETON_GUARD_EXCLUSIONS`）；预检先跑 §A+§B+static-only tests，阻断抛 `PreflightError`（`cmdSubmitFlow` catch 后用 `render(report, type)` 渲染业务话红灯，不吐 rule id）。

#### 3.3 `tools/opsforge.mjs`（**改既有**，B1 部分）

`PRINT_TOPICS` 加 `submit-flow` + `submit-hint`；`cmdMenu` switch 加 `case '9': await cmdSubmitFlow(rl, opts); break;`；新增 `cmdSubmitFlow`（export）：

```js
export async function cmdSubmitFlow(rl, opts = {}) {
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const workDir = opts.workDir || resolveWorkDir({ opsforgeHome: opts.opsforgeHome }).dir;
  console.log(PRINT_TOPICS['submit-flow']);
  const { listDrafts } = await import('./paths.mjs');
  const listFn = opts.listDrafts || listDrafts;
  const drafts = listFn(workDir);
  if (drafts.length === 0) { console.log('○ 没有本地草稿。请先在主菜单选 1 新建能力。'); return 0; }
  console.log('本地草稿：');
  drafts.forEach((d, i) => {
    const mtime = new Date(d.mtime).toLocaleString('zh-CN');
    const fill = d.hasFillMe ? ' [黄 还有未填项]' : '';
    console.log(`  ${i + 1}) ${d.slug}.${d.name}  (${d.kind})  ${mtime}${fill}`);
  });
  const sel = (await ask('选择要提交的序号（回车取消）: ')).trim();
  if (!sel) { console.log('已取消。'); return 0; }
  const idx = Number(sel) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= drafts.length) { console.log('序号不对，已取消。'); return 1; }
  const draft = drafts[idx];
  if (draft.hasFillMe) {
    console.log('黄 这个草稿还有未填项（标记 __FILL_ME__）。建议先填完再提交。');
    if ((await ask('仍要提交？[y/N]: ')).trim().toLowerCase() !== 'y') { console.log('已取消。'); return 0; }
  }
  const { readSubmitToken, writeSubmitToken, PreflightError } = await import('./submit.mjs');
  let token = readSubmitToken()?.token;
  if (!token) {
    console.log('首次使用：请联系团队管理员领取『贡献码』，粘贴在下面（只需一次）：');
    token = (await ask('贡献码: ')).trim();
    if (!token) { console.log('未输入贡献码，已取消。'); return 1; }
    writeSubmitToken(token);
  }
  const submitFn = opts.submit || (await import('./submit.mjs')).submit;
  try {
    console.log('正在提交…');
    const r = await submitFn({ draftDir: draft.path, repoRoot: workDir, token });
    const verb = r.updated ? '已更新原提交' : '已提交';
    console.log(`绿 ${verb}！提交进度页：${r.prUrl}`);
    console.log('运营团队会审核，通过后其他人就能在主菜单选 2 装到他们电脑。');
    printCatalogHint();
  } catch (e) {
    if (e instanceof PreflightError) {
      const { render } = await import('./report-renderer.mjs');
      const typeMap = { validation: 'validation-report', security: 'security-report', tests: 'eval-report' };
      const r = render(e.report, typeMap[e.kind] || 'validation-report', { lang: 'zh' });
      console.log(`[红] 预检没过：${r.oneLiner}`);
      console.log('请按上面的修复指引改完，再回主菜单选 9 重新提交。');
    } else {
      console.log(`[红] ${e.message}`);
    }
  }
  return 0;
}
```

**要点**：文案全守则化（提交进度页/运营团队审核/主菜单选 2 装到他们电脑）；贡献码首次引导用"贡献码"一词之后不可见；`PreflightError` 预检失败走 report-renderer 业务话红灯；`opts.submit`/`opts.listDrafts` 注入测试。

#### 3.4 `tools/submit.test.mjs`（**新建**）——见第 8 节

---

### Slice B2（P1）——§B 加固 + 同名分支更新 + 体验增强

#### 4.1 `tools/security-scan.mjs`（**改既有**，新 R32）

加 fine-grained PAT pattern 到 `SECRET_PATTERNS`（:13-19）：
```js
{ regex: /github_pat_[A-Za-z0-9_]{82,}/, rule: 'hardcoded_secret', label: 'GitHub fine-grained PAT (贡献码)' },
```

新增独立函数（**不进 per-cap `scan(capDir)` 返回值**，守住 `security-report.json` 结构 + `additionalProperties:false`）：
```js
export function scanRepoForSubmitSecrets(repoRoot) {
  const findings = [];
  const scanDirs = ['tools', 'packs', 'templates', 'web', 'docs'];
  const CONTRIBUTION_CODE_RE = /github_pat_[A-Za-z0-9_]{82,}/;
  for (const sub of scanDirs) {
    const dir = path.join(repoRoot, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of walkFiles(dir)) {
      const content = fs.readFileSync(f.full, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (CONTRIBUTION_CODE_RE.test(lines[i])) {
          findings.push({ rule: 'R32_submit_no_secret_in_token_file', severity: 'high',
            evidence: `${f.rel}:${i+1}: 贡献码字面出现在仓库内`, status: 'block' });
        }
      }
    }
  }
  return { verdict: findings.length > 0 ? 'block' : 'pass', findings, rule: 'R32_submit_no_secret_in_token_file' };
}
```

R32 接入 `--all` CLI 末尾追加一次 repo-level 扫描，不污染 per-cap security-report.json。fixture 用 `'github_pat_' + 'a'.repeat(82)` 拼接构造，不写字面量（避免 R32 误报测试代码自身）。

#### 4.2 `tools/submit.mjs`（**改既有**，B2 同名分支 + 401/403 + 拉回审核意见）

`callGithubApi` 内部：分支已存在→取 oldCommitSha→`GET pulls?head={owner}:{branch}&state=open` 检测 open PR→有则 `updated=true` 不重开只追加评论；force-update `PATCH refs/heads/{branch} {sha, force:true}`；任一 401/403 抛业务话"贡献码可能已过期，请联系团队管理员重新领取"（不报 HTTP status/body）。

新增 export：
```js
export async function fetchPrReviewSummary({ gh, prNumber, token, fetchImpl })
  // 并发 GET /pulls/{n}/comments + /pulls/{n}/reviews → 业务话摘要 "运营团队的意见：…/审核意见：…"
  // 不暴露 APPROVED/CHANGES_REQUESTED 等技术词；fetch 失败只打印"审核意见暂不可读"不阻断
```

#### 4.3 `.gitignore`（**改既有**）

```
# 贡献码（B2）：本文件绝不进 git，贡献码只存 ~/.opsforge/submit-token.json
submit-token.json
```

#### 4.4 `docs/contributing/contributor-code-guide.md`（**新建**，管理员向）

面向**管理员**（非业务用户，可含技术词）：fine-grained PAT 签发步骤、repo-scoped 权限（Contents: Read and Write + Pull requests: Read and Write）、过期时间、per-contributor 签发与吊销、贡献码线下分发。明确不给业务用户看。

---

### Slice AB（P2）——提交后指向目录、目录显示"社区贡献"

- `tools/opsforge.mjs`：`cmdSubmitFlow` 成功路径末尾调 `printCatalogHint()`（B1 已加）。
- `web/catalog/app.js`（**改既有**）：卡片渲染加"社区贡献"徽章，读 `entry.sourceOrigin === 'third-party'` 或 `entry.pack === 'third-party'`（数据已有），不动 schema/`catalog-model.mjs`。
- `templates/readme-template.zh.md`（**改既有**）：加"如何发布"段。
- `AGENTS.md`/`CLAUDE.md` 现状段：更新 Phase 4 第五刀已交付。

---

## 2. `tools/submit.mjs` GitHub API 调用序列（B1 核心）

host 硬编码 `GITHUB_API = 'https://api.github.com'`（同 `intake-remote.mjs:34`）。所有请求带 `Authorization: Bearer <token>` / `Accept: application/vnd.github+json` / `X-GitHub-Api-Version: 2022-11-28`。

**步骤 0 解析 gitRemote**：`execFileSync('git', ['config','--get','remote.origin.url'], {encoding:'utf8', stdio:['pipe','pipe','pipe']})` argv 形式无 shell；`parseGitRemote` 支持 `git@github.com:o/r.git` 与 `https://github.com/o/r(.git)`；非 github.com 抛"无法识别中心仓库地址"。**SSRF 说明**：不调 `assertPublicUrl`（gitRemote 来自本地 git config 非用户输入）；host 硬编码，owner/repo regex 解析后拼到硬编码 base，用户无法注入任意 host。

**步骤 1 取 base SHA**：`GET /repos/{o}/{r}/git/refs/heads/main` → `baseSha`；404 尝试 `master`；都 404 抛业务话"中心仓库找不到 main/master 分支"。

**步骤 2 算 branchName + 检测同名**：`branchName = opsforge-${slug}-${name}-${hash8(draftDir)}`（hash8 用 `node:crypto`，零依赖）；`GET /repos/{o}/{r}/git/refs/heads/{branch}` → 200 则 `oldCommitSha`/`branchExists=true`，404 则新建；`branchExists=true` 时 `GET /repos/{o}/{r}/pulls?head={owner}:{branch}&state=open` → 非空则 `openPrNumber`/`updated=true`。

**步骤 3 建分支**（若不存在）：`POST /repos/{o}/{r}/git/refs/heads/{branch} {sha: baseSha}`；422 回退步骤 2。

**步骤 4 上传草稿为 tree**：`buildTreeEntries(draftDir)` → `[{path, mode:"100644", type:"blob", content}, ...]`（文本直接 content，二进制 base64）；跳过 `.opsforge-state.json`/`*-report.json`/`interview.md`（复用 SKELETON_GUARD_EXCLUSIONS）；path 为相对仓库根的草稿路径（保留草稿路径，merge 后运营团队决定 promote 时机——守"promote 是人工 gate"）；`POST /repos/{o}/{r}/git/trees {base_tree: parentSha, tree: entries}` → `treeSha`。

**步骤 5 建 commit**：`POST /repos/{o}/{r}/git/commits {tree: treeSha, parents: [parentSha], message: "opsforge: 提交能力草稿 {slug}.{name}"}` → `commitSha`（`parentSha = branchExists ? oldCommitSha : baseSha`）。

**步骤 6 force-update 分支 ref**：`PATCH /repos/{o}/{r}/git/refs/heads/{branch} {sha: commitSha, force: true}`。

**步骤 7 开 PR 或追加评论**：`updated=true` → `POST /repos/{o}/{r}/pulls/{openPrNumber}/comments {body: "opsforge 已更新此提交（{ISO}）。"}`，不重开，`prUrl` 从步骤 2 响应 `html_url` 取；`updated=false` → `POST /repos/{o}/{r}/pulls {title, head: branchName, base: "main", body: "由 opsforge submit 一键提交。请运营团队审核。"}` → `prUrl = response.html_url`。

**步骤 8 401/403 统一处理**：任一 401/403 → `throw new Error('贡献码可能已过期，请联系团队管理员重新领取。')`，不报 HTTP status/body，不重试。

**B2 拉回审核意见**：`GET /repos/{o}/{r}/pulls/{n}/comments` + `GET /repos/{o}/{r}/pulls/{n}/reviews` 并发 `Promise.all`；业务话摘要 `运营团队的意见：${body.slice(0,80)}` / `审核意见：${body.slice(0,80)}`；不暴露 GitHub 原始 state。

---

## 3. `openInBrowser` 详述

跨平台 argv：`win32`→`spawn('cmd', ['/c','start','',url], {detached:true, stdio:'ignore'})`；`darwin`→`spawn('open', [url], ...)`；其他→`spawn('xdg-open', [url], ...)`。全 argv 无 shell:true。`new URL` 校验 `hostname !== '127.0.0.1'` 返回 false + 打印业务话。失败只打印业务指引不抛错不打印原始 URL。`detached:true` + `child.unref()`。

---

## 4. `cmdCatalogFlow` 生命周期

1. 动态 `import('./catalog-server.mjs')` `startCatalogServer`；
2. `const { server } = await start({ port: 0, host: '127.0.0.1', repoRoot: workDir })`（opts.startServer 注入点）；
3. `const port = server.address().port`（**第六部分技术修正：不改返回结构**）；
4. `open(\`http://127.0.0.1:${port}/\`)`（opts.openBrowser 注入点；openInBrowser 内部校验 host）；
5. 打印业务话（无 URL/端口字眼）；
6. `await ask('按回车回到主菜单…')`（**不给 Ctrl+C 句柄**）；
7. `finally { server.close() }` 必关防泄漏；
8. session 级状态上报：`opts.onServerStart(port)`/`opts.onServerStop()` 回调供 `cmdMenu` 闭包追踪 `catalogRunning`/`catalogPort` 传给 `promptInstallFlow`。

---

## 5. `listDrafts(repoRoot)` 签名

`@returns {{slug, name, kind, path, mtime, hasFillMe}[]}`。扫 `packs/_drafts/*/` + `customers/*/packs/_drafts/*/`（`draftsRoots` 枚举）；`slug`/`name` 来自目录名；`kind` 从 `capability.yaml`/`mcp.yaml`/`workflow.yaml`/`bundle.yaml` 解析默认 `agent`；`mtime` 倒序（最近改的在前）；`hasFillMe` 扫所有文本文件含 `__FILL_ME__`。`submitTokenPath()` → `~/.opsforge/submit-token.json`。

---

## 6. R32 规则

- **同级新增不弱化 R16–R31**：R32 是仓库级独立函数 `scanRepoForSubmitSecrets(repoRoot)`，**不进 per-cap `scan(capDir)` 返回值**（守住 `security-report.json` 结构 + `additionalProperties:false`）。
- 复用 `SECRET_PATTERNS` 加 `github_pat_` regex；复用 `walkFiles` 扫 `tools/`+`packs/`+`templates/`+`web/`+`docs/`。
- `~/.opsforge/` 仓库外，`.gitignore` 明示 `submit-token.json` 防误建。
- fixture：`R32-1` 干净 pass；`R32-2` 真 token block；`R32-3` regex 定义行不误报（字符类+量词不是 82 个真实字符）；`R32-4` 中文"贡献码"不误报；`R32-5` 拼接代码 `'github_pat_' + 'a'.repeat(82)` 不误报（运行时串非字面量）。

---

## 7. 文案守则测试 + 深链可见性规则断言

### `tools/opsforge-wording.test.mjs`（**新建**）

禁用词正则：
```js
const FORBIDDEN_RE = /PAT|Personal Access Token|github\.com\/settings|Developer settings|repo 权限|\bPR\b|pull request|branch|commit|install|steering review|\bCI\b|\breview\b|\bbot\b|127\.0\.0\.1|\/capabilities\/|opsforge submit </;
```

- `WC1 PRINT_TOPICS 业务文案不含禁用词`：对各 business topic（`new-flow`/`wizard-routing`/`error-recovery`/`distiller-steps`/`wizard-phases`/`catalog-hint`/`submit-flow`/`submit-hint`）用 `spawnSync(process.execPath, ['tools/opsforge.mjs', 'print', topic])` 读 stdout，`assert.doesNotMatch(content, FORBIDDEN_RE)`（一举测文案守则 + CLI argv 路径）。
- `WC2 menu 含 8/9 选项且不含禁用词`：`opsforge print menu`，`assert.match(/8\) 打开能力目录/)`、`/9\) 提交我的能力/`，`doesNotMatch(FORBIDDEN_RE)`。

深链可见性断言：
- `WC3 promptInstallFlow server 未跑时只打印业务指引不含 http://`：`opts.catalogServerRunning=false`、`opts.out` 捕获、`dryRun:true`；断言含"主菜单选 8 打开能力目录"、`doesNotMatch(/http:\/\/127\.0\.0\.1/)`。
- `WC4 server 在跑时含可点击链接`：`opts.catalogServerRunning=true, catalogServerPort:4173`；断言 `match(/http:\/\/127\.0\.0\.1:4173\/capabilities\/foo\.bar/)`。

**实现前置**：`promptInstallFlow` 内所有 `console.log` 改走 `const out = opts.out || console.log`（与 `cmdPrint:68` 同款），`opts.out` 默认 `console.log` 向后兼容旧测试 OP15。

---

## 8. 测试矩阵

| Slice | 测试文件 | 覆盖点 | mock 策略 |
|---|---|---|---|
| A1 | `tools/opsforge-catalog-launcher.test.mjs`（新） | CL1 平台分派 / CL2 URL 校验 / CL3 spawn 抛错 / CL4 detached+unref | `opts.spawn` mock；`Object.defineProperty(process,'platform')` + try/finally 还原 |
| A1 | `tools/catalog-server.test.mjs`（扩） | CS4 port:0 + address().port 显式断言 | 真起 server |
| A1 | `tools/opsforge.test.mjs`（扩） | OP20 按回车关闭 server / OP20b server 起不来业务指引 | `opts.startServer` mock；`opts.openBrowser` mock；mockRl `['']` |
| A2 | `tools/opsforge-wording.test.mjs`（新） | WC1-WC2 文案守则 / WC3-WC4 深链可见性 | spawnSync CLI argv；`promptInstallFlow` `opts.out` + `dryRun:true` + `catalogServerRunning` mock |
| B1 | `tools/submit.test.mjs`（新） | SU1 parseGitRemote / SU2 resolveGitRemote execFile / SU3 assertDraftUnder 路径穿越 / SU4 runLocalPreflight 三报告门 / SU5 callGithubApi 序列 / SU6 贡献码读取 / SU7 401/403 | `opts.fetch` mock `{ok,status,json:async()=>({})}`；`opts.execFile` mock；`opts.validate`/`opts.securityScan`/`opts.runSuite` mock |
| B1 | `tools/opsforge.test.mjs`（扩） | OP21 cmdSubmitFlow 选草稿+预检+submit / OP22 无草稿 / OP23 hasFillMe 警告 / OP24 printSubmitHint 文案 | `opts.listDrafts` mock；`opts.submit` mock `{prUrl,branch,commitSha,updated}`；mockRl |
| B1 | `tools/paths.test.mjs`（新或扩） | PA1 listDrafts 枚举 + mtime 倒序 + hasFillMe / PA2 submitTokenPath | mkdtempSync 造 fixture；无 mock |
| B2 | `tools/security-scan-r32.test.mjs`（新） | R32-1 干净 / R32-2 真 token block / R32-3 regex 定义行不误报 / R32-4 中文不误报 / R32-5 拼接不误报 | mkdtempSync；无 mock |
| B2 | `tools/submit.test.mjs`（扩） | SU8 同名分支 force-update 不重开 / SU9 fetchPrReviewSummary 业务话 / SU10 401/403 过期 | `opts.fetch` mock 多次响应序列 |
| AB | `web/catalog/app.test.mjs`（新或扩） | AB1 third-party 卡片显示社区贡献徽章 | 真 buildCatalogSnapshot 断言 sourceOrigin 字段 |

**bare `node --test` 预期**：532 + ~15 新测试 = ~547 全绿。6 gates 不变（R32 repo-level 不进 per-cap security-report.json，release gate 逻辑不动）。

---

## 9. 硬不变量核对表

| 不变量 | 核对 | 证据 |
|---|---|---|
| 零新 npm 依赖 | ✅ | submit.mjs 用 `node:child_process`/`node:crypto`/`node:fs`/`globalThis.fetch`；catalog-launcher 用 `node:child_process`/全局 `URL`；paths.mjs 新增用已有 `node:fs`/`node:path` + 已有依赖 `js-yaml`。package.json 不动 |
| additionalProperties:false | ✅ | 不改能力 schema；submit 元数据在 `~/.opsforge/`；R32 独立函数不进 security-report.json 结构 |
| registry auto-gen | ✅ | submit 只开 PR 不碰 `registry*.yaml`；release.mjs 不改 |
| Windows argv | ✅ | `execFileSync('git', argv)` / `spawn('cmd', ['/c','start','',url])` / `spawnSync(process.execPath, ['tools/opsforge.mjs','print',topic])` 全 argv 无 shell:true |
| CODEOWNERS | ✅ | 新文件全在 `tools/` steering-owned；`.gitignore`/`docs/contributing/` steering review |
| R16–R31 + R32 同级 | ✅ | R32 独立 export 不进 `scan(capDir)` 返回值；`github_pat_` regex 是加不是改（`ghp_` 保留）；validate.mjs R-rules 不动 |
| 无 Go | ✅ | 全 Node ESM |
| 深链可见性规则 | ✅ | WC3/WC4 断言 |
| 文案守则 | ✅ | WC1/WC2 断言 |
| CLI argv 路径覆盖 | ✅ | WC1/WC2 spawnSync `opsforge print` |
| skeleton_guard 不触 | ✅ | 不改 `templates/<kind>/`；SKELETON_GUARD_EXCLUSIONS 两处不动 |
| CSP/nosniff | ✅ | catalog-server.mjs 既有 CSP 不动（A1 只扩测试） |

---

## 10. 实施顺序与 TDD 流程

每 slice 先写测试再写实现：

1. **A1**：`opsforge-catalog-launcher.test.mjs`（CL1-4）→ `opsforge-catalog-launcher.mjs` → 扩 `catalog-server.test.mjs` CS4 → 改 `opsforge.mjs`（PRINT_TOPICS menu+catalog-hint + cmdCatalogFlow + cmdMenu case 8）→ 扩 `opsforge.test.mjs` OP20/20b → 跑绿。
2. **A2**：`opsforge-wording.test.mjs` WC1-4（WC3/4 需 `promptInstallFlow` `out` 注入，先改实现）→ 改 `promptInstallFlow`（out + catalogServerRunning 分支）→ 改 `cmdDiscover` + `inventory.mjs renderDiscoverAll` → 改 `cmdNewFlow`/`cmdIntakeFlow`/`cmdWizard` 末尾 `printSubmitHint`+`printCatalogHint` → 跑绿。
3. **B1**：`submit.test.mjs` SU1-7 → `submit.mjs`（parseGitRemote/resolveGitRemote/readSubmitToken/writeSubmitToken/assertDraftUnder/runLocalPreflight/callGithubApi/submit）→ 改 `paths.mjs`（listDrafts/draftsRoots/submitTokenPath）→ 改 `opsforge.mjs`（submit-flow/submit-hint + cmdMenu case 9 + cmdSubmitFlow + printSubmitHint）→ 扩 `opsforge.test.mjs` OP21-24 → 跑绿。
4. **B2**：`security-scan-r32.test.mjs` R32-1-5 → `scanRepoForSubmitSecrets` + `github_pat_` regex → 改 `submit.mjs`（同名分支 force-update + 401/403 + fetchPrReviewSummary）→ 扩 `submit.test.mjs` SU8-10 → `.gitignore` → `docs/contributing/contributor-code-guide.md` → 跑绿。
5. **AB**：`cmdSubmitFlow` 成功路径调 `printCatalogHint`（B1 已加）→ `web/catalog/app.js` 徽章 → `templates/readme-template.zh.md` → `AGENTS.md`/`CLAUDE.md` 现状段 → 跑绿。

每 slice 结束跑 6 gates：`validate --all` / `security-scan --all` / `eval --all`（OPSFORGE_RUNNER=static-only）/ `release --all` / `install --doctor` / bare `node --test`。

---

## 11. 风险与缓解（实现层）

| 风险 | 缓解 |
|---|---|
| cmdCatalogFlow server 泄漏（用户直接关终端） | `try/finally` + 进程退出 Node 自动回收 fd；下次 port:0 分配新端口 |
| GitHub API rate limit (403) | 401/403 统一业务话"贡献码可能已过期"，不区分 rate limit |
| 草稿含二进制 | trees API 支持 base64；`buildTreeEntries` 检测 Buffer |
| 同名草稿多人并发 | branchName 带 hash8(draftDir)，同一草稿多次提交收敛到同一 PR（设计意图） |
| parseGitRemote 遇非 github.com | 抛"无法识别中心仓库地址"，不尝试非 GitHub |
| R32 误报 submit.mjs regex 字面量 | 字符类+量词不足 82 真实字符，R32-3 断言不误报 |
| promptInstallFlow 改 `out` 破 OP15 | `opts.out` 默认 `console.log` 向后兼容 |

---

## 12. 相关文件路径

**新建**：`tools/opsforge-catalog-launcher.mjs`、`tools/opsforge-catalog-launcher.test.mjs`、`tools/submit.mjs`、`tools/submit.test.mjs`、`tools/opsforge-wording.test.mjs`、`tools/security-scan-r32.test.mjs`、`docs/contributing/contributor-code-guide.md`。

**改既有**：`tools/opsforge.mjs`、`tools/paths.mjs`、`tools/security-scan.mjs`、`tools/catalog-server.test.mjs`、`tools/opsforge.test.mjs`、`tools/inventory.mjs`、`web/catalog/app.js`、`templates/readme-template.zh.md`、`.gitignore`、`AGENTS.md`/`CLAUDE.md`。

**不改（核对用）**：`tools/catalog-server.mjs`、`tools/catalog-model.mjs`、`tools/release.mjs`、`tools/validate.mjs`、`schema/*.schema.json`、`package.json`。

---

**方案完成**。工程师拿到此文档可直接 TDD：按 slice 顺序，每 slice 先写测试再写实现，每 slice 结束跑 bare `node --test` + 6 gates。所有函数签名、mock 策略、API 调用序列、文案守则断言均已给出，无臆测。
