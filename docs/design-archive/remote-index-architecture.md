# 架构方案：远程 index.json 能力索引（Phase 4 第六刀 · Stage 2 架构 / 技术方案）

> 状态：architecture-v1（基于 proposal-v2，业务用户评审已通过）  
> 日期：2026-08-07  
> 前序：Stage 1 设计文档 `docs/design-archive/remote-index-registry-proposal.md`（v2，权威需求源）。  
> 本文给出可落地的逐文件改动清单、数据契约、R33 规约、WC5-WC7 断言规约、测试矩阵、硬不变量自检、TDD 顺序。tdd-guide 据此实现，code-reviewer 据此校验。  
> 硬不变量：零新 npm 依赖 / `additionalProperties:false` / `registry*.yaml` auto-gen / Windows argv / R16–R32 不弱化 + R33 同级 / §B 全套 / CODEOWNERS + 三态 / 无 Go / release gate 三报告不动 / 6 gates 全绿。

---

## 1. 总体数据流图（ASCII）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        本地（OpsForge 仓库在场）                         │
│                                                                         │
│  registry.yaml ──┐                                                      │
│  (auto-gen)      │                                                      │
│  body H2 章节 ──┤                                                      │
│  scanCapabilities┘                                                      │
│        ▼                                                                 │
│  buildInventory()          ← tools/inventory.mjs:180  (SSOT 派生)        │
│        ▼                                                                 │
│  buildCatalogSnapshot()   ← tools/catalog-model.mjs:91  (发布视图)      │
│        ├──→ catalogSummary()  ← tools/catalog-model.mjs:111             │
│        │     = /api/catalog 响应体（剥 detail/qualityChecks/             │
│        │       dependencies/usage）                                     │
│        └──→ publicEntry[]     ← tools/catalog-model.mjs:69              │
│              = /api/capabilities/<id> 响应体（完整含 detail/usage）       │
│        ▼                                                                 │
│  ┌─── catalog-server.mjs startCatalogServer() ← :90                    │
│  │    返回 {server, snapshot}                                           │
│  │    服务 /api/catalog + /api/capabilities/<id> + 静态资源              │
│  └─── opsforge-catalog-launcher.mjs openInBrowser() ← :13              │
│       host 白名单 127.0.0.1（本刀扩 github.io）                           │
└─────────────────────────────────────────────────────────────────────────┘
                    │ index-publish.mjs buildIndex() 复用
                    │ 同一数据源（buildCatalogSnapshot），无双 SSOT
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CI（push to main 后）                             │
│                                                                         │
│  release.yml（现有，push to main）                                       │
│    → release --all 重建 registry.yaml                                    │
│    → bot commit + push 回 main                                          │
│                                                                         │
│  publish-index.yml（新，本刀）                                           │
│    触发：push to main（在 release.yml 之后）或 workflow_run 链式          │
│    步骤：                                                                │
│      1. checkout（含刚推的 registry.yaml）                               │
│      2. setup-node (.nvmrc) + npm ci                                     │
│      3. node tools/inventory.mjs --readme（刷新 README 标记块）          │
│      4. node tools/index-publish.mjs --out-dir web/catalog/dist         │
│         → 产出 web/catalog/dist/index.json (= catalogSummary 形)         │
│         → 产出 web/catalog/dist/capabilities/<id>.json (= publicEntry 形)│
│      5. deploy-pages：web/catalog/ + dist/ → GitHub Pages (gh-pages)     │
│         → https://<owner>.github.io/<repo>/index.json                    │
│         → https://<owner>.github.io/<repo>/ （静态站）                    │
└─────────────────────────────────────────────────────────────────────────┘
                    │ GitHub Pages (gh-pages 分支)
                    │ HTTPS + CORS 友好
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    远程消费方（repo-less 机器 / 业务用户）                 │
│                                                                         │
│  ┌─── discover（CLI 文本）                                               │
│  │    cmdDiscover ← tools/opsforge.mjs:491                              │
│  │    fetchRemoteIndex() ← tools/index-fetch.mjs（新）                   │
│  │      ├ 成功 → renderDiscoverAll(index.capabilities)                  │
│  │      │         顶部 "● 已连上能力仓（共 N 项）"                       │
│  │      ├ 失败+仓库在 → buildInventory() 本地回退                        │
│  │      └ 失败+repo-less → "稍后再试或联系团队管理员"（不提示选 8）       │
│  │                                                                       │
│  ├─── catalog（web 目录，菜单选 8）                                      │
│  │    cmdCatalogFlow ← tools/opsforge.mjs:286                           │
│  │    仓库在 → 本地 server（照旧）                                       │
│  │    仓库不在 → fetchRemoteIndex 探测 →                                 │
│  │      ├ 远程可达 → openInBrowser(远程 GitHub Pages 站点)               │
│  │      └ 不可达 → 不起浏览器，业务话兜底                                │
│  │                                                                       │
│  ├─── install（元数据回退）                                              │
│  │    readRegistryForInstall ← install.mjs:45                          │
│  │    本地 registry.yaml 找不到 → fetchRemoteIndex() 查元数据           │
│  │      ├ third-party+installHint → 指向 installFromGit ← :678           │
│  │      └ 官方无仓库 → 业务话"联系团队管理员帮你装一次"                  │
│  │                                                                       │
│  └─── 静态 catalog 站点（GitHub Pages）                                 │
│       web/catalog/app.js 静态模式：                                      │
│         fetch('/api/catalog') 失败 → fetch('./index.json')               │
│         openDetail(id) → fetch('./capabilities/<id>.json')              │
│         顶部 "已连上能力仓" 徽章                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**复用点标注**：
- `buildCatalogSnapshot`（`tools/catalog-model.mjs:91`）是 index.json 的**唯一数据源**——与本地 catalog server、discover 文本、README 标记块同源，无双 SSOT。
- `catalogSummary`（`tools/catalog-model.mjs:111`）定义 index.json 的**轻量列表形状**（剥 detail/qualityChecks/dependencies/usage）。
- `publicEntry`（`tools/catalog-model.mjs:69`）定义 `capabilities/<id>.json` 的**完整详情形状**。
- `assertPublicUrl`（`tools/intake-fetch.mjs:83`）全套 SSRF 守卫，用户覆盖 URL 必经。
- `resolveGitRemote`（`tools/submit.mjs:58`）+ `parseGitRemote`（`tools/submit.mjs:33`）复用于官方 URL 派生。
- `scanRepoForSubmitSecrets`（`tools/security-scan.mjs:193`）R32 模式——R33 同级仿照。

---

## 2. 逐文件改动清单（带函数签名）

### Slice A1 — index 生成

#### `tools/index-publish.mjs`（新建，steering-owned）

**导出函数签名**：

```js
/**
 * buildIndex(opts) — 调 buildCatalogSnapshot 生成发布索引。
 * @param {{repoRoot?: string, now?: Date}} opts
 * @returns {Promise<{index: Object, capabilities: Object[]}>}
 *   index = catalogSummary(snapshot) 形（轻量列表）
 *   capabilities = snapshot.capabilities（完整 publicEntry 数组）
 */
export async function buildIndex(opts = {})

/**
 * publishIndex({repoRoot, outDir}) — 写 index.json + capabilities/*.json 到 outDir。
 * @param {{repoRoot?: string, outDir?: string}} opts
 *   outDir 默认 path.join(repoRoot, 'web', 'catalog', 'dist')
 * @returns {Promise<{indexFile: string, capabilityFiles: string[], count: number}>}
 */
export async function publishIndex({ repoRoot, outDir })

/** CLI main(): node tools/index-publish.mjs [--out-dir <path>] */
export function main()
```

**关键实现要点**（伪代码级）：
```
buildIndex(opts):
  snapshot = await buildCatalogSnapshot({ repoRoot: opts.repoRoot })   // 复用 catalog-model.mjs:91
  index = catalogSummary(snapshot)                                     // 复用 catalog-model.mjs:111
  return { index, capabilities: snapshot.capabilities }

publishIndex({ repoRoot, outDir }):
  { index, capabilities } = await buildIndex({ repoRoot })
  outDir = outDir || path.join(repoRoot, 'web', 'catalog', 'dist')
  fs.mkdirSync(path.join(outDir, 'capabilities'), { recursive: true })
  atomicWriteSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2))
  for cap of capabilities:
    atomicWriteSync(path.join(outDir, 'capabilities', `${cap.id}.json`), JSON.stringify(cap, null, 2))
  return { indexFile, capabilityFiles, count: capabilities.length }
```

**复用**：`buildCatalogSnapshot`（`catalog-model.mjs:91`）、`catalogSummary`（`catalog-model.mjs:111`）、`atomicWriteSync`（`paths.mjs:89`）。零新逻辑，纯序列化出口。

**守护点**：
- `additionalProperties:false`：index.json 形状由 `catalogSummary`/`publicEntry` 代码定义，不引入新字段。下游 `schema/index.schema.json` 校验消费方。
- Windows argv：CLI `main()` 用 `process.argv.slice(2)` 解析，`--out-dir` 取值，无 shell 调用。
- 无敏感字段泄露：`publicEntry` 已过滤 `dir`/`owner`/`customer`/`installHint`/`intakeScope` 等 inventory 内部字段（对比 `inventory.mjs:201-227` entry 字段集 vs `catalog-model.mjs:77-88` publicEntry 字段集）。

#### `schema/index.schema.json`（新建，steering-owned）

JSON Schema 描述 index.json 顶层 + capabilities 项 + platforms/filters 子对象。全 `additionalProperties: false`。

**顶层字段**（镜像 `catalogSummary` 返回，`catalog-model.mjs:111-117`）：
- `version`（string）— `catalog-<ISO>` 形
- `generatedAt`（string，ISO 8601）
- `count`（integer，≥0）
- `platforms`（array of `{id:string, name:string}`）
- `filters`（object，见下）
- `capabilities`（array of summary 项，见下）

**capabilities 项（summary 形，剥 detail/qualityChecks/dependencies/usage）**：
- `id`（string）、`version`（string）、`name`（string）、`nameEn`（string）
- `description`（string）、`scenarioTag`（string）、`scenarios`（array of string）
- `kind`（string）、`kindLabel`（string）、`pack`（string）
- `scope`（string）、`scopeLabel`（string）、`project`（string|null）、`projectLabel`（string|null）
- `source`（`{key:string, label:string}`）
- `quality`（string，enum: green|yellow|red）
- `releasedAt`（string|null）
- `platformSupport`（array of `{platform:string, name:string, tier:integer|null, status:string, label:string}`）
- `availability`（string，enum: usable|reference-only）

**capabilities/<id>.json（完整 publicEntry 形）**，在 summary 基础上追加：
- `detail`（string）
- `qualityChecks`（`{validation:string, security:string, eval:string}`）
- `dependencies`（array of string）
- `usage`（object：`<platformId>: {status, label, title, steps[], requirements[]}`）

**filters 子对象**（镜像 `catalog-model.mjs:100-107`）：
- `kinds`/`sources`/`scopes`/`projects`：array of `{id:string, label:string}`
- `availability`：array of `{id:string, label:string}`
- `qualities`：array of `{id:string, label:string}`

全 `additionalProperties: false`（顶层 + capabilities 项 + source 子对象 + platformSupport 项 + filters 子对象 + usage 值对象）。

#### `tools/index-publish.test.mjs`（新建）

测试：buildIndex 返回 shape == buildCatalogSnapshot 输出；publishIndex 产出 index.json + capabilities/*.json；ajv schema 校验通过；无敏感字段（dir/owner/installHint）泄露。

---

### Slice A2 — 远程拉取 + 缓存 + SSRF

#### `tools/index-fetch.mjs`（新建，steering-owned）

**导出函数签名**：

```js
/**
 * fetchRemoteIndex({url, cacheDir, ttl, refresh, fetchImpl, lookup}) —
 * 远程拉取 index.json，缓存 + TTL + SSRF + schema 校验。
 * @param {{url: string, cacheDir?: string, ttl?: number, refresh?: boolean,
 *          fetchImpl?: Function, lookup?: Function}} opts
 *   url: 官方源（host 白名单 github.io）或用户覆盖 URL（必经 assertPublicUrl）
 *   cacheDir: 默认 path.join(resolveOpsforgeHome(), 'cache')
 *   ttl: 秒，默认 86400（24h）；OPSFORGE_INDEX_TTL env 覆盖
 * @returns {Promise<{index: Object, fromCache: boolean, fetchedAt: string}>}
 * @throws {Error} fetch 失败 / Content-Type 不符 / schema 校验失败 / SSRF 拒绝
 */
export async function fetchRemoteIndex({ url, cacheDir, ttl, refresh, fetchImpl, lookup })

/**
 * officialIndexUrl(repoRoot) — 从 git remote 派生官方索引 URL。
 * @param {{execFile?: Function, repoRoot?: string}} opts
 * @returns {string} https://<owner>.github.io/<repo>/index.json
 * @throws {Error} git remote 非 github.com / 解析失败
 */
export function officialIndexUrl(opts = {})

/**
 * readCacheIndex(cacheDir) — 离线降级读缓存（不校验 TTL，只校验 schema）。
 * @param {string} cacheDir
 * @returns {Object|null} index 或 null（无缓存或 schema 失败）
 */
export function readCacheIndex(cacheDir)
```

**关键实现要点**（伪代码级）：
```
OFFICIAL_INDEX_HOSTS = ['github.io']   // 白名单

fetchRemoteIndex({ url, cacheDir, ttl, refresh, fetchImpl, lookup }):
  cacheDir = cacheDir || path.join(resolveOpsforgeHome(), 'cache')
  cacheFile = path.join(cacheDir, 'index.json')
  ttl = ttl ?? Number(process.env.OPSFORGE_INDEX_TTL) ?? 86400

  // 1. 缓存命中（!refresh + 文件存在 + mtime 在 TTL 内）→ 读缓存
  if (!refresh && fs.existsSync(cacheFile)):
    stat = fs.statSync(cacheFile)
    if (Date.now() - stat.mtimeMs < ttl * 1000):
      cached = readJsonOrNullSync(cacheFile)
      if cached && validateSchema(cached): return { index: cached, fromCache: true, fetchedAt: ... }

  // 2. SSRF 判定：官方源（host 在白名单）可信不经 assertPublicUrl；
  //    用户覆盖 URL（env OPSFORGE_INDEX_URL）必经 assertPublicUrl 全套
  parsedUrl = new URL(url)
  if (!OFFICIAL_INDEX_HOSTS.includes(parsedUrl.hostname)):
    await assertPublicUrl(url, { lookup })   // 复用 intake-fetch.mjs:83

  // 3. fetch（Node 内置，超时 5s 经 AbortController）
  fetchImpl = fetchImpl || globalThis.fetch
  controller = new AbortController()
  timer = setTimeout(() => controller.abort(), 5000)
  resp = await fetchImpl(url, { signal: controller.signal })
  clearTimeout(timer)
  if (!resp.ok) throw new Error(...)
  ct = resp.headers.get('content-type') || ''
  if (!ct.includes('application/json') && !ct.includes('text/plain')) throw ...
  json = await resp.json()

  // 4. schema 校验（ajv + schema/index.schema.json）—— untrusted data
  if (!validateSchema(json)) throw new Error('index schema validation failed')

  // 5. 原子写缓存（0600 目录）
  fs.mkdirSync(cacheDir, { recursive: true })
  atomicWriteSync(cacheFile, JSON.stringify(json))
  return { index: json, fromCache: false, fetchedAt: new Date().toISOString() }

officialIndexUrl(opts):
  remote = resolveGitRemote({ execFile: opts.execFile })   // 复用 submit.mjs:58
  gh = parseGitRemote(remote)                               // 复用 submit.mjs:33
  if (!gh) throw new Error('官方索引源需 GitHub 仓库')
  return `https://${gh.owner}.github.io/${gh.repo}/index.json`
```

**复用**：
- `assertPublicUrl`（`tools/intake-fetch.mjs:83`）——全套 SSRF（https-only + shell-metachar reject + 私网/loopback/internal 拒绝 + DNS rebinding）。
- `resolveGitRemote`（`tools/submit.mjs:58`）——`execFileSync('git', ['config','--get','remote.origin.url'])` argv 形式。
- `parseGitRemote`（`tools/submit.mjs:33`）——SSH/HTTPS → `{owner, repo}`。
- `resolveOpsforgeHome`（`tools/paths.mjs:18`）、`readJsonOrNullSync`（`tools/paths.mjs:80`）、`atomicWriteSync`（`tools/paths.mjs:89`）。
- `ajv`（已有依赖）+ `schema/index.schema.json`（A1 产出）。

**守护点**：
- SSRF：官方源 host 硬编码白名单 `['github.io']`（仿 `submit.mjs:14` `api.github.com` 模式）；用户覆盖 URL（env `OPSFORGE_INDEX_URL`）必经 `assertPublicUrl`（区分对待）。
- Windows argv：`resolveGitRemote` 用 `execFileSync('git', argv)` 形式（无 shell）。
- additionalProperties:false：schema 校验消费方，fetch 后 ajv 验证。
- 超时：5s AbortController，不无限等。

#### `tools/index-fetch.test.mjs`（新建）

测试：mock fetch 缓存命中/未命中/TTL 过期/`--refresh` 强拉/损坏 JSON/schema 失败/SSRF 拒绝私网/官方 host 派生。

---

### Slice B1 — discover 远程优先

#### `tools/opsforge.mjs`（改动，steering-owned）

**改动函数**：

```js
// cmdDiscover — 改为远程优先 + 本地回退 + repo-less 死循环防御
// 现状：tools/opsforge.mjs:491
export async function cmdDiscover(argsOrOpts)  // 签名不变，内部逻辑改

// renderDiscoverAll — 从 index.capabilities 渲染时映射字段
// 现状：tools/inventory.mjs:289（不改函数本身，cmdDiscover 调用方做数据映射）
```

**关键实现要点**（cmdDiscover `--all` 分支伪代码）：
```
if (opts.all):
  workDir = resolveWorkDir({ opsforgeHome }).dir
  repoPresent = isRepoRoot(workDir)   // 探测 templates/ + package.json

  // 1. 远程优先
  try:
    url = process.env.OPSFORGE_INDEX_URL || officialIndexUrl({ repoRoot: workDir })
    { index, fromCache } = await fetchRemoteIndex({ url, refresh: opts.refresh })
    // 映射 index.capabilities（summary 形）→ renderDiscoverAll 兼容的 entry 形
    inv = indexToInventory(index)   // 轻量映射：summary 字段 → entry 字段
    out('● 已连上能力仓（共 ' + index.count + ' 项能力）')
    out(renderDiscoverAll(inv, { lang: 'zh', remote: true }))
    return 0
  catch:
    // 2. 失败 + 仓库在 → 本地回退
    if (repoPresent):
      out('○ 暂时连不上能力仓，显示本地已装能力。')
      inv = await buildInventory({ repoRoot: workDir })
      out(renderDiscoverAll(inv, { lang: 'zh' }))
      return 0
    // 3. 失败 + repo-less → 不提示选 8（避免死循环）
    out('○ 暂时连不上能力仓，稍后再试或联系团队管理员。')
    return 0
```

**indexToInventory 映射**（summary → entry）：summary 字段已是 publicEntry 的子集，映射为 `{id, version, kind, pack, display_name_zh: name, display_name_en: nameEn, description, detail: '', scenarios: scenarios.join('\n'), scenarioTag, platformSupport, light: qualityMap[quality], state: 'released', scope, ...}`。renderDiscoverAll 读的字段（`id`/`version`/`light`/`display_name_zh`/`detail`/`scenarios`/`platformSupport`/`state`）均有对应。

**PRINT_TOPICS 新增 key**（`tools/opsforge.mjs:25`）：
```
'discover-remote-hint': '想看全部能力？主菜单选 8 打开能力目录，或直接跑 opsforge discover',
```

**守护点**：
- repo-less 死循环防御：`repoPresent` false 时不调"主菜单选 8"（那也会失败）。
- 文案：顶部徽章 + 来源标注只用业务话（"官方"/"社区"，读 `entry.source.key`），无技术词。

---

### Slice B2 — 发布机制（CI workflow）

#### `.github/workflows/publish-index.yml`（新建，steering-owned）

完整 workflow 伪 YAML：
```yaml
name: opsforge-publish-index
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  publish-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/configure-pages@v5
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
      - run: npm ci
      - name: Refresh README inventory block
        run: node tools/inventory.mjs --readme
      - name: Build index.json + capabilities
        run: node tools/index-publish.mjs --out-dir web/catalog/dist
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: web/catalog
      - name: Deploy to GitHub Pages
        uses: actions/deploy-pages@v4
```

**与 release.yml 的时序方案**：

现状 `release.yml`（`.github/workflows/release.yml`）在 push to main 时跑 `release --all` 重建 `registry.yaml` 并 bot-commit/push 回 main。`publish-index.yml` 同样在 push to main 触发。两条 workflow 并行跑，存在时序竞态：`publish-index.yml` checkout 时 `registry.yaml` 可能还是旧的（release.yml 还没 push 回去）。

**方案：`workflow_run` 链式触发**（确保时序）：
```yaml
on:
  workflow_run:
    workflows: [opsforge-release]
    types: [completed]
    branches: [main]
  workflow_dispatch:
```
`workflow_run` 在 `release.yml` 完成后触发（含 bot push 的第二次 push 也会再触发，但幂等——index-publish 每次从最新 registry 生成）。`workflow_run` 需要 release.yml 先跑完（含 push），确保 `publish-index.yml` checkout 到的是含新 registry 的 main。

**备选（同 push 顺序）**：若不用 `workflow_run`，同 push 并行也可接受——`publish-index.yml` 读旧 registry 产出旧 index，下次 push 自愈。但 `workflow_run` 链式更可靠，推荐采用。

**守护点**：
- `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages` 是 GitHub 官方 action，非新 npm 依赖。
- workflow 文件在 `.github/workflows/`，受 CODEOWNERS 默认 `*` + steering 保护。
- `tools/index-publish.mjs` 受 `guardrails.yml` 的 `tools/**` + `**/*.mjs` 路径守卫覆盖（不需改 guardrails.yml）。

#### `.gitignore`（改动）

加一行：
```
# 静态 catalog 站点产物（由 CI index-publish 重新生成，不进 git）
web/catalog/dist/
```

`~/.opsforge/cache/` 在仓库外，无需加。

#### `CODEOWNERS`（确认，不改）

`/tools/`（:5）、`/schema/`（:6）已覆盖 `tools/index-*.mjs` + `schema/index.schema.json`。`.github/workflows/` 未显式列出但默认 `*`（:3）覆盖。**确认不需改**。

#### `.github/workflows/guardrails.yml`（确认，不改）

`tools/**`（:28）、`schema/**`（:33）、`**/*.mjs`（:45）、`**/*.js`（:46）已覆盖新文件。**确认不需改**。

---

### Slice C1 — install 远程元数据 + 边界

#### `install.mjs`（改动，steering-owned）

**改动函数**：

```js
// readRegistryForInstall — 增远程 index 回退（只补版本/依赖/source 元数据，不补源码位置）
// 现状：install.mjs:45
export function readRegistryForInstall(repoRoot, opsforgeHome)
// 签名不变，返回值不变（registry 对象或 null）
// 新增辅助函数：
export async function lookupRemoteCapability(capId, opts = {})
// @param {{capId: string, repoRoot?: string, fetchImpl?: Function, opsforgeHome?: string}} opts
// @returns {Promise<{version?: string, pack?: string, kind?: string,
//   source?: {key: string, label: string}, installHint?: string}|null>}
```

**关键实现要点**（`lookupRemoteCapability` 伪代码）：
```
lookupRemoteCapability(capId, opts):
  assertCapId(capId)   // 复用 paths.mjs:114
  cacheDir = path.join(resolveOpsforgeHome(), 'cache')
  // 先读缓存（不强制 TTL，离线降级）
  let index = readCacheIndex(cacheDir)   // 复用 index-fetch.mjs readCacheIndex
  if (!index):
    try:
      url = process.env.OPSFORGE_INDEX_URL || officialIndexUrl({ repoRoot: opts.repoRoot })
      const r = await fetchRemoteIndex({ url, cacheDir })
      index = r.index
    catch:
      return null   // 远程不可达 + 无缓存 → 返回 null（install 上层处理边界）
  cap = index.capabilities.find(c => c.id === capId)
  if (!cap) return null
  return {
    version: cap.version, pack: cap.pack, kind: cap.kind,
    source: cap.source,
    installHint: cap.installHint || null,   // summary 形无 installHint → 读完整 capabilities/<id>.json
  }
```

**注意**：index.json summary 形不含 `installHint`（publicEntry 不含它——`catalog-model.mjs:77-88` publicEntry 字段集无 installHint）。installHint 存于 inventory entry（`inventory.mjs:221`）但**不进 publicEntry**（catalog-model.mjs 过滤了）。因此 `lookupRemoteCapability` 查 installHint 需读 `capabilities/<id>.json`（完整 publicEntry）——但 publicEntry 也不含 installHint。

**修正**：publicEntry（`catalog-model.mjs:69-88`）不含 `installHint`。设计文档 §2.5 说"index.json 提供 installHint"——这需要 index-publish 在 `publicEntry` 基础上**追加 installHint 字段**，或在 `capabilities/<id>.json` 中追加。架构决策：**在 `capabilities/<id>.json`（完整 publicEntry）中追加 `installHint` 字段**（从 inventory entry 透传），但 `index.json` summary 形不含（保持与 catalogSummary 同形）。这样 `lookupRemoteCapability` 读 `capabilities/<id>.json` 查 installHint。schema/index.schema.json 的 capabilities/<id> schema 加 `installHint`（string|null，optional）。

**install 边界分支**（在 `install()` 函数内，`install.mjs:175` 附近，capDir 解析失败后）：
```
capDir = args.capDir || findCapabilitySource(capId, repoRoot)   // install.mjs:184
if (!capDir):
  // 远程元数据回退
  remoteMeta = await lookupRemoteCapability(capId, { repoRoot, opsforgeHome })
  if (!remoteMeta):
    throw new Error('install: 找不到能力 ' + capId + '，本地无仓库且远程索引未命中。')
  if (remoteMeta.source.key === 'third-party' && remoteMeta.installHint):
    // 指向 installFromGit，对用户只说"来源网址"
    // （实际调用由 promptInstallFlow 上层处理，install() 抛特定错误带 installHint）
    throw new RemoteHintError({ installHint: remoteMeta.installHint, kind: remoteMeta.kind, name: capId.split('.')[1] })
  // 官方能力无仓库
  throw new RemoteNotFoundError({ capId })
```

`promptInstallFlow`（`opsforge.mjs:747`）catch `RemoteHintError` → 业务话"这是社区能力，可从其来源获取——主菜单选 2，粘贴来源网址即可。"；catch `RemoteNotFoundError` → "这能力在能力仓里找到了。要装到本地，需要团队管理员先帮你把 OpsForge 装一次（只需一次）。请联系团队管理员。"

**守护点**：
- 不自动 clone 仓库（clone-on-install 留作未来 Phase）。
- 不给用户做不到的指令（不要求用户自己 clone）。
- installHint 不在 catalog web 展示（只供 install 内部解析）。

#### `tools/opsforge.mjs` — `promptInstallFlow`（改动）

边界业务话提示（catch RemoteHintError / RemoteNotFoundError 分支），无 `clone`/`repo`/`git` 技术词。

#### `tools/install-remote-lookup.test.mjs`（新建）

测试：mock fetchRemoteIndex，本地找不到→远程命中 official→边界提示；远程命中 third-party+installHint→指向 installFromGit；远程未命中→"找不到"。

---

### Slice C2 — catalog repo-less 远程

#### `tools/opsforge-catalog-launcher.mjs`（改动，steering-owned）

**改动函数**：

```js
// openInBrowser — host 白名单扩 github.io（保留 127.0.0.1）
// 现状：tools/opsforge-catalog-launcher.mjs:13
export function openInBrowser(url, opts = {})
// 签名不变
```

**关键改动**（伪代码）：
```
// 现状（:19）：if (parsed.hostname !== '127.0.0.1') → 失败
// 改为：
const ALLOWED_HOSTS = ['127.0.0.1', 'github.io'];
// 但 github.io 实际是 <owner>.github.io，所以用后缀匹配：
if (parsed.hostname !== '127.0.0.1' && !parsed.hostname.endsWith('.github.io')):
  out('打开浏览器失败：只允许本机或能力广场链接。请在主菜单选 8 重新打开能力目录。')
  return false
```

**守护点**：
- H3 防御保留：URL 含 `"` 拒绝；Windows `cmd /c start` 双引号包裹。
- host 白名单用后缀匹配 `.github.io`（覆盖 `<owner>.github.io`），保留 `127.0.0.1` 精确匹配。

#### `tools/opsforge.mjs` — `cmdCatalogFlow`（改动，steering-owned）

**改动**（`tools/opsforge.mjs:286`）：
```
cmdCatalogFlow(rl, opts):
  workDir = resolveWorkDir({ opsforgeHome }).dir
  repoPresent = isRepoRoot(workDir)
  if (repoPresent):
    // 照旧起本地 server（现状逻辑 :294-301）
    ...
  else:
    // repo-less：探测远程
    try:
      url = process.env.OPSFORGE_INDEX_URL || officialIndexUrl({ repoRoot: workDir })
      await fetchRemoteIndex({ url, refresh: false })   // 探测可达
      // 远程可达 → 打开远程站点
      catalogUrl = url.replace('/index.json', '/')
      open(catalogUrl)
      out('已打开能力广场（在线版），看完关掉浏览器回这里按回车。')
      await ask('按回车回到主菜单…')
    catch:
      // 远程不可达 → 不起浏览器
      out('能力广场暂时打不开，可能还没准备好。稍后再试，或联系团队管理员。')
      // 不提示"主菜单选 8"（避免死循环）
  return 0
```

#### `tools/opsforge-catalog-launcher.test.mjs`（扩）

测试：远程 URL 校验（`*.github.io` 通过，其他 host 拒绝）+ host 白名单。

---

### Slice D1 — 静态 catalog 站点

#### `web/catalog/app.js`（改动，steering-owned）

**改动点**（基于 `web/catalog/app.js:21` `loadCatalog` + `:18` `openDetail`）：

```
// loadCatalog（:21）改为：
async function loadCatalog():
  els.loading.hidden = false; els.error.hidden = true
  try:
    // 静态模式检测：hostname 含 github.io → 直接走静态
    const isStatic = location.hostname.endsWith('.github.io')
    const catalogUrl = isStatic ? './index.json' : '/api/catalog'
    const response = await fetch(catalogUrl)
    if (!response.ok) throw new Error(...)
    state.catalog = await response.json()
    // 显示徽章
    $('connection-badge').hidden = false
    setupFilters(); render(); ...
  catch:
    // /api/catalog 失败 → 尝试 ./index.json（本地 server 不在时静态回退）
    if (!isStatic):
      try:
        const resp = await fetch('./index.json')
        if (resp.ok):
          state.catalog = await resp.json()
          $('connection-badge').hidden = false
          setupFilters(); render(); return
      catch {}
    els.loading.hidden = true; els.error.hidden = false

// openDetail（:18）改为：
async function openDetail(id, pushHistory = true):
  ...
  let item = state.details.get(id)
  if (!item):
    // 静态模式：fetch('./capabilities/<id>.json')；本地模式：fetch('/api/capabilities/<id>')
    const isStatic = location.hostname.endsWith('.github.io') || state._staticMode
    const url = isStatic ? `./capabilities/${encodeURIComponent(id)}.json` : `/api/capabilities/${encodeURIComponent(id)}`
    const response = await fetch(url)
    ...
```

**守护点**：
- 不改 `escapeHtml`（:5，全程保留）。
- 不改 CSP（静态站同源 fetch）。
- 数据形状零改动（index.json = catalogSummary 形 = /api/catalog 响应体；capabilities/<id>.json = publicEntry 形 = /api/capabilities/<id> 响应体）。

#### `web/catalog/index.html`（改动）

加徽章容器（在 `:12` header 内）：
```html
<span id="connection-badge" class="connection-badge" hidden>● 已连上能力仓</span>
```

#### `web/catalog/styles.css`（改动）

加徽章样式：
```css
.connection-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 12px; color: #16a34a; }
.connection-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #16a34a; }
```

---

### Slice AB — 文案守则 + 文档

#### `tools/opsforge-wording.test.mjs`（改动，steering-owned）

扩 WC5/WC6/WC7 断言体 + FORBIDDEN_RE 新增禁词。

#### `templates/readme-template.zh.md`（改动）

加"如何发现能力"段。

#### `AGENTS.md` / `CLAUDE.md`（改动，steering-owned）

现状段更新 Phase 4 第六刀交付。

---

## 3. 数据契约（index.json + capabilities/<id>.json 精确 shape）

### index.json（= catalogSummary 形，`catalog-model.mjs:111-117`）

| 字段 | 类型 | 来源（catalog-model.mjs 行号） |
|---|---|---|
| `version` | string | `:113` snapshot.version（`catalog-<ISO>` 形） |
| `generatedAt` | string (ISO 8601) | `:113` snapshot.generatedAt |
| `count` | integer | `:113` snapshot.count |
| `platforms` | array of `{id:string, name:string}` | `:113` snapshot.platforms（`loadPlatforms` :29） |
| `filters` | object（见下） | `:113` snapshot.filters |
| `capabilities` | array of summary 项（见下） | `:115` 剥 detail/qualityChecks/dependencies/usage |

**capabilities 项（summary 形）**（`publicEntry` :77-88 剥 `detail`/`qualityChecks`/`dependencies`/`usage`）：

| 字段 | 类型 | 来源（catalog-model.mjs 行号） |
|---|---|---|
| `id` | string | `:78` entry.id |
| `version` | string | `:78` entry.version |
| `name` | string | `:78` display_name_zh \|\| display_name_en \|\| id |
| `nameEn` | string | `:79` display_name_en \|\| '' |
| `description` | string | `:79` entry.description |
| `scenarioTag` | string | `:81` entry.scenarioTag \|\| scenarios[0] \|\| description |
| `scenarios` | array of string | `:80` linesFromMarkdown(entry.scenarios) |
| `kind` | string | `:82` entry.kind |
| `kindLabel` | string | `:82` KIND_LABELS[entry.kind] |
| `pack` | string | `:82` entry.pack |
| `scope` | string | `:83` scopeFor.key（'general'\|\|'project'） |
| `scopeLabel` | string | `:83` scopeFor.label |
| `project` | string\|null | `:83` scopeFor.project |
| `projectLabel` | string\|null | `:83` scopeFor.projectLabel |
| `source` | `{key:string, label:string}` | `:84` sourceFor（'official'\|\|'third-party'\|\|'example'） |
| `quality` | string (green\|yellow\|red) | `:84` QUALITY_MAP[entry.light] |
| `releasedAt` | string\|null | `:85` entry.releasedAt |
| `platformSupport` | array of `{platform,name,tier,status,label}` | `:85` platforms.map |
| `availability` | string (usable\|reference-only) | `:86` entry.example ? 'reference-only' : 'usable' |

**注**：`detail`/`qualityChecks`/`dependencies`/`usage` 被 `catalogSummary`（`:115`）显式剥离，不进 index.json。

### capabilities/<id>.json（= 完整 publicEntry 形 + installHint，`catalog-model.mjs:69-88`）

在 summary 项基础上追加：

| 字段 | 类型 | 来源（catalog-model.mjs 行号） |
|---|---|---|
| `detail` | string | `:80` linesFromMarkdown(entry.detail).join('\n') |
| `qualityChecks` | `{validation:string, security:string, eval:string}` | `:84` entry.qualityReports |
| `dependencies` | array of string | `:85` entry.dependsOn |
| `usage` | object: `<platformId>: {status,label,title,steps[],requirements[]}` | `:87` platforms.map(usageFor) |
| `installHint` | string\|null | 透传自 inventory entry（`inventory.mjs:221`），**本刀新增** |

**关键不变量**：app.js `loadCatalog`（:21）读 `state.catalog.capabilities`（summary 数组），`openDetail`（:18）读单条完整项。静态模式只需把 fetch base 从 `/api/` 换成 `./`，数据形状零改动。

---

## 4. R33 规则规约

**规则 ID**：`R33_index_fetch_no_user_host`

**同级独立性**：与 R32（`scanRepoForSubmitSecrets`，`security-scan.mjs:193`）同级独立。不进 per-cap `scan(capDir)` 返回值（守 `security-report.json` 结构 + `additionalProperties:false`）。

**扫描点**（静态扫源码，仿 R32 扫 `tools/`+`packs/`+`templates/`+`web/`+`docs/`）：
- `tools/index-fetch.mjs`
- `tools/index-publish.mjs`
- `tools/opsforge.mjs`（cmdDiscover/cmdCatalogFlow）
- `install.mjs`（远程回退）

**规则文本**：
> 远程 index fetch 的官方索引源 host 必须在白名单（`github.io`）；用户覆盖 URL（env `OPSFORGE_INDEX_URL`）必须经 `assertPublicUrl` 全套 SSRF 守卫；`index.json` fetch 后必须 ajv schema 校验才能消费。不得 `fetch(<变量>)` 未经校验直接消费。

**静态扫实现思路**（伪代码，仿 `scanRepoForSubmitSecrets` :193-220）：
```
export function scanRepoForIndexFetchSsrf(repoRoot):
  findings = []
  scanDirs = ['tools', 'install.mjs']   // index-fetch + opsforge + install.mjs
  for sub of scanDirs:
    files = walkFiles(sub)
    for f of files:
      content = readFileSync(f.full)
      // 检查 1：fetch(变量) 未经 assertPublicUrl 直接消费
      //   正则找 fetch( 调用，参数非字面量（变量名而非 '...' 字符串）
      //   且同文件无 assertPublicUrl 调用 → finding
      if /fetch\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)/.test(content)
         && !content.includes('assertPublicUrl'):
        findings.push({ rule: 'R33...', evidence: `${f.rel}: fetch(变量)未经 assertPublicUrl`, status: 'block' })
      // 检查 2：官方 host 字面量硬编码
      //   找 OFFICIAL_INDEX_HOSTS 常量，须含 'github.io' 字面量
      if content.includes('OFFICIAL_INDEX_HOSTS') && !content.includes("'github.io'"):
        findings.push({ rule: 'R33...', evidence: `${f.rel}: 官方 host 未硬编码 github.io`, status: 'block' })
      // 检查 3：fetch 后须 schema 校验（找 validateSchema / ajv 调用）
      if content.includes('fetchRemoteIndex') && !content.includes('validateSchema'):
        findings.push({ rule: 'R33...', evidence: `${f.rel}: fetch 后无 schema 校验`, status: 'block' })
  return { verdict: findings.length > 0 ? 'block' : 'pass', findings, rule: 'R33_index_fetch_no_user_host' }
```

**不进 per-cap scan 的实现**：独立函数 `scanRepoForIndexFetchSsrf(repoRoot)`，仿 R32 在 `security-scan.mjs` `--all` 末尾（`:249` 之后）调用，在 `process.exit` 之前。不进 `scan(capDir)` 返回值。

**与 R32 的同级独立性**：R32 扫贡献码字面（`github_pat_` regex），R33 扫 SSRF/schema 校验路径。两者独立函数、独立 findings、不互依赖。

**MEMORY 教训**：R32 死代码防回归——`--all` 末尾须在 `process.exit` 前调 `scanRepoForIndexFetchSsrf`，否则 R33 成死代码（code-reviewer CL1 修复模式复用）。必须有 `security-scan --all` CLI 集成测试（仿 R32-6）。

---

## 5. WC5-WC7 文案断言规约

### FORBIDDEN_RE 新增禁词（`tools/opsforge-wording.test.mjs:11`）

在现有 FORBIDDEN_RE 基础上追加（用 `|` 分隔）：

```
index\.json|registry|gh-pages|\bfetch\b|\bcache\b|\bTTL\b|raw\.githubusercontent|jsdelivr|\bCDN\b|\bhost\b|\bendpoint\b|\bclone\b|\brepo\b|git\s*地址|git\s*address|git\s*URL
```

**注意**：`install` 已在现有 FORBIDDEN_RE 中（:11）。`registry` 禁词需注意 `registry.yaml` 在文档/注释中合法出现——WC 断言只扫 user-facing 文案（PRINT_TOPICS + promptInstallFlow + cmdDiscover/cmdCatalogFlow 输出），不扫源码注释。

### WC5 — discover 远程文案

**扫哪个文件/函数**：`tools/opsforge.mjs` `cmdDiscover`（:491）远程分支输出 + `PRINT_TOPICS['discover-remote-hint']`。

**禁词正则**：FORBIDDEN_RE（含新增）。

**正向断言**（必须出现的业务话）：
- 远程命中时：必须含 `已连上能力仓`。
- 失败+仓库在时：必须含 `暂时连不上能力仓` + `显示本地`。
- 失败+repo-less 时：必须含 `稍后再试或联系团队管理员` 且**不含** `主菜单选 8`（断言 `doesNotMatch(/主菜单选 8/)`）。

**测试方式**：mock fetchRemoteIndex（命中/失败），调 cmdDiscover，收集 out 断言。

### WC6 — catalog 远程站点徽章文案

**扫哪个文件/函数**：`web/catalog/app.js` 徽章文本 + `web/catalog/index.html` 徽章容器。

**禁词正则**：FORBIDDEN_RE（含新增）。

**正向断言**：
- 徽章文本必须含 `已连上能力仓`。
- 徽章不得含 URL/host/响应码（断言 `doesNotMatch(/https?:|\/index\.json|200|404/)`）。

**测试方式**：读 `index.html` 徽章元素 textContent + app.js `$('connection-badge')` 文本断言。

### WC7 — install 边界提示

**扫哪个文件/函数**：`tools/opsforge.mjs` `promptInstallFlow`（:747）catch `RemoteHintError`/`RemoteNotFoundError` 分支输出。

**禁词正则**：FORBIDDEN_RE（含新增 `clone`/`repo`/`git 地址`/`git address`/`git URL`）。

**正向断言**：
- third-party+installHint 边界：必须含 `来源网址` 且**不含** `git`（断言 `doesNotMatch(/git/i)`，但 `git` 作为技术词在此分支完全禁绝）。
- 官方无仓库边界：必须含 `联系团队管理员` + `装一次`，且**不含** `clone`/`仓库`/`下到本地`（不给做不到的指令）。

**测试方式**：mock install 抛 RemoteHintError/RemoteNotFoundError，调 promptInstallFlow，收集 out 断言。

---

## 6. 测试矩阵

### 单元测试（mock fetch）

| ID | Slice | 描述 | 断言 |
|---|---|---|---|
| A1-U1 | A1 | buildIndex 返回 catalogSummary 形 index + publicEntry 数组 | `index.capabilities[0].id` 等于 fixture cap id；无 detail/usage |
| A1-U2 | A1 | publishIndex 产出 index.json + capabilities/*.json | 文件存在；index.json ajv 校验通过；capabilities/<id>.json ajv 校验通过 |
| A1-U3 | A1 | 无敏感字段泄露 | index + capabilities JSON 不含 `dir`/`owner`/`installHint`（在 index.json summary 中）/`intakeScope` |
| A2-U1 | A2 | fetchRemoteIndex 缓存命中（不调 fetch） | `fromCache: true`；fetchImpl 未调用 |
| A2-U2 | A2 | fetchRemoteIndex 缓存未命中→fetch→写缓存 | `fromCache: false`；cache 文件存在；schema 校验通过 |
| A2-U3 | A2 | TTL 过期→重新 fetch | mtime 设为 25h 前→fetch 被调 |
| A2-U4 | A2 | `--refresh` 强拉（忽略缓存） | 缓存有效但仍 fetch |
| A2-U5 | A2 | 损坏 JSON→抛错 | fetch 返回 'not json'→throw |
| A2-U6 | A2 | schema 校验失败→抛错 | fetch 返回 `{}`→throw；不返回半截数据 |
| A2-U7 | A2 | SSRF 拒绝私网（用户 URL） | `OPSFORGE_INDEX_URL=http://127.0.0.1/`→throw |
| A2-U8 | A2 | 官方 host 派生 | `officialIndexUrl` 从 mock git remote 派生 `https://owner.github.io/repo/index.json` |
| A2-U9 | A2 | 官方源不经 assertPublicUrl | mock github.io URL→fetch 被调（lookup 不被调） |
| C1-U1 | C1 | lookupRemoteCapability 本地无→远程命中 official | 返回 `{version, pack, kind, source}` |
| C1-U2 | C1 | 远程命中 third-party+installHint | 返回 installHint |
| C1-U3 | C1 | 远程未命中→null | index.capabilities 无 capId→null |

### CLI-argv 测试（spawn，MEMORY 强制）

| ID | Slice | 描述 | 断言 |
|---|---|---|---|
| A1-C1 | A1 | `node tools/index-publish.mjs` 产出文件 | spawnSync exit 0；web/catalog/dist/index.json 存在 |
| A1-C2 | A1 | `node tools/index-publish.mjs --out-dir <tmp>` | 产出到指定目录 |
| B1-C1 | B1 | `opsforge discover --all` 远程命中（mock fetchRemoteIndex） | stdout 含 `已连上能力仓` |
| B1-C2 | B1 | `opsforge discover --all` 失败+仓库在 | stdout 含 `暂时连不上能力仓` + `显示本地` |
| B1-C3 | B1 | `opsforge discover --all` 失败+repo-less | stdout 含 `稍后再试`；**不含** `主菜单选 8` |

### 文案测试（FORBIDDEN_RE）

| ID | Slice | 描述 | 断言 |
|---|---|---|---|
| AB-W1 | AB | WC5 discover 远程文案 | FORBIDDEN_RE 不匹配；含 `已连上能力仓` |
| AB-W2 | AB | WC6 catalog 徽章 | 徽章含 `已连上能力仓`；不含 URL/host |
| AB-W3 | AB | WC7 install 边界（third-party） | 含 `来源网址`；不含 `git` |
| AB-W4 | AB | WC7 install 边界（官方无仓库） | 含 `联系团队管理员`；不含 `clone`/`仓库` |
| AB-W5 | AB | PRINT_TOPICS['discover-remote-hint'] | FORBIDDEN_RE 不匹配 |

### 集成测试（真起 http server fetch fixture）

| ID | Slice | 描述 | 断言 |
|---|---|---|---|
| A2-I1 | A2 | index-fetch 真起 http server 返回 fixture index.json | fetch + 缓存写入 + schema 校验通过 |
| R33-I1 | AB | `node tools/security-scan.mjs --all` CLI 集成 | R33 函数被调（仿 R32-6）；exit 0 when clean |
| R33-I2 | AB | R33 死代码防回归 | 在 `--all` 末尾 `process.exit` 前调用（code-reviewer CL1 模式） |

**MEMORY 教训落地**：
- "test the CLI argv path, not just the function"：A1-C1/A1-C2/B1-C1-C3 必须有 spawn 测试。
- "R32 死代码防回归"：R33-I1/R33-I2 必须有 `security-scan --all` CLI 集成测试。
- "wording rules need executable assertions"：WC5-WC7 落成 FORBIDDEN_RE 可执行断言。

---

## 7. 硬不变量自检表（10 条）

| # | 不变量 | 本架构如何守住 | 函数/文件引用 |
|---|---|---|---|
| 1 | 零新 npm 依赖 | 远程 fetch 用 Node 22 内置 `globalThis.fetch`；缓存用 `fs`；schema 校验用已有 `ajv`；git remote 解析用 `child_process` argv；URL 解析用全局 `URL`；超时用 `AbortController`（Node 内置） | `index-fetch.mjs` 零 import 新包；`package.json` 不改 |
| 2 | `additionalProperties:false` 全保留 | 新 `schema/index.schema.json` 顶层 + capabilities 项 + source/platformSupport/filters/usage 子对象全 `additionalProperties:false`；不触能力 schema | `schema/index.schema.json` |
| 3 | `registry*.yaml` auto-gen 不手编 | index.json 是 `buildCatalogSnapshot` ← `buildInventory` ← `registry*.yaml` + body H2 的派生产物；不回写 registry；README 标记块同级 | `index-publish.mjs buildIndex` 复用 `catalog-model.mjs:91` |
| 4 | Windows argv | `resolveGitRemote` 用 `execFileSync('git', argv)`（复用 `submit.mjs:58`）；`openInBrowser` 远程 URL 用 `new URL` 校验 + 双引号包裹（复用 launcher H3 修复 `:25-31`）；无 `shell:true` | `index-fetch.mjs officialIndexUrl`；`opsforge-catalog-launcher.mjs:13` |
| 5 | R16–R32 不弱化 + R33 同级新增 | 不触 R16–R32；新 R33 独立函数扫 index-fetch SSRF + schema 校验路径，不进 per-cap scan 返回值 | `security-scan.mjs scanRepoForIndexFetchSsrf`（新，仿 :193） |
| 6 | §B security-scan 全套保留 | 远程 fetch 复用 `assertPublicUrl` 全套 SSRF（`intake-fetch.mjs:83`，私网/DNS rebinding/shell-metachar 拒绝）；官方 host 硬编码白名单 `github.io`（仿 `submit.mjs:14`）；index.json untrusted data 经 ajv + schema 校验；用户 URL 与官方源区分对待 | `index-fetch.mjs fetchRemoteIndex` |
| 7 | CODEOWNERS + 三态不动 | `tools/index-*.mjs` + `schema/index.schema.json` + `.github/workflows/publish-index.yml` 全 steering-owned（`/tools/` :5 + `/schema/` :6 + `**/*.mjs` :45 + 默认 `*` :3 覆盖）；贡献者仍只写 `.md/.yaml/.json`；三态 `_drafts→_staged→formal` 不变 | `CODEOWNERS` 确认不改 |
| 8 | 不引 Go 二进制 | 纯 Node（fetch + fs + child_process + ajv + URL + AbortController） | 全部新文件 `.mjs` |
| 9 | release gate 三报告不动 | `release.mjs` 三报告门不变；`publish-index.yml` 在 `release.yml` 之后跑（`workflow_run` 链式），读新 registry 发 index，不重复 release、不改 release 门逻辑 | `.github/workflows/publish-index.yml`；`release.yml` 不改 |
| 10 | 6 gates 全绿 | validate/security/eval/release/doctor 不变；bare `node --test` 574 + 新增（A1+A2+B1+C1+AB 测试）；publish-index.yml 是新 workflow 不影响现有 6 gates；**security-scan --all 须用 OPSFORGE_RUNNER=static-only 跑 eval**（MEMORY：eval must run static-only） | 新测试文件全绿 |

---

## 8. TDD 顺序

给 tdd-guide 的 slice 实现顺序（每个 slice 先写测试、依赖关系、6 gates 在哪步验证）：

### A1（index 生成）— 先写测试
1. **先写** `tools/index-publish.test.mjs`：A1-U1（buildIndex shape）、A1-U2（publishIndex 产出）、A1-U3（无敏感字段）。
2. **再写** `schema/index.schema.json`（ajv 校验消费方需先有 schema）。
3. **再写** `tools/index-publish.mjs`（buildIndex/publishIndex/main）。
4. **CLI-argv 测试**：A1-C1（spawn `node tools/index-publish.mjs`）、A1-C2（`--out-dir`）。
5. **验证**：`bare node --test` 绿（574 + A1 新增）；`node tools/index-publish.mjs` 产出存在；6 gates 不变（此步不改 security/eval）。

### A2（远程拉取+缓存+SSRF）— 依赖 A1 schema
1. **先写** `tools/index-fetch.test.mjs`：A2-U1-U9（mock fetch 全路径）。
2. **再写** `tools/index-fetch.mjs`（fetchRemoteIndex/officialIndexUrl/readCacheIndex）。
3. **集成测试**：A2-I1（真起 http server fetch fixture）。
4. **验证**：`bare node --test` 绿；6 gates 不变。

### B1（discover 远程优先）— 依赖 A2
1. **先写** `tools/opsforge-wording.test.mjs` 扩 WC5（discover 远程文案断言）+ B1-C1-C3（cmdDiscover spawn 测试，mock fetchRemoteIndex）。
2. **再改** `tools/opsforge.mjs` cmdDiscover 远程优先分支 + `PRINT_TOPICS['discover-remote-hint']`。
3. **验证**：`bare node --test` 绿；WC5 断言通过。

### B2（发布机制 CI）— 依赖 A1
1. **先写** `.github/workflows/publish-index.yml`（workflow_run 链式触发）。
2. **改** `.gitignore`（加 `web/catalog/dist/`）。
3. **确认** CODEOWNERS / guardrails.yml 不改。
4. **验证**：workflow 语法合法（本地 `actionlint` 或 YAML lint）；本地 `node tools/index-publish.mjs` 产出可被 fetch 语义消费；`bare node --test` 绿（B2 无新测试文件，CI 验证靠 workflow）。

### C1（install 远程元数据 + 边界）— 依赖 A2
1. **先写** `tools/install-remote-lookup.test.mjs`：C1-U1-U3（mock fetchRemoteIndex 边界分支）。
2. **再改** `install.mjs`（lookupRemoteCapability + 边界分支 RemoteHintError/RemoteNotFoundError）。
3. **再改** `tools/opsforge.mjs` promptInstallFlow（catch 边界业务话）。
4. **验证**：`bare node --test` 绿；install 边界业务话无禁词。

### C2（catalog repo-less 远程）— 依赖 A2
1. **先写** `tools/opsforge-catalog-launcher.test.mjs` 扩（host 白名单 `*.github.io`）。
2. **再改** `tools/opsforge-catalog-launcher.mjs`（openInBrowser host 白名单扩）。
3. **再改** `tools/opsforge.mjs` cmdCatalogFlow（仓库在/不在分支）。
4. **验证**：`bare node --test` 绿；launcher host 白名单断言通过。

### D1（静态 catalog 站点）— 依赖 A1 + B2
1. **先写** app.js 静态模式测试（若有 app.js 单测则扩；无则手测 GitHub Pages 站点）。
2. **再改** `web/catalog/app.js`（loadCatalog/openDetail 静态模式）+ `index.html`（徽章容器）+ `styles.css`（徽章样式）。
3. **验证**：本地起 `web/catalog/dist/` 静态服务（`npx serve web/catalog`），app.js 能 fetch `./index.json` + `./capabilities/<id>.json`；`bare node --test` 绿。

### AB（文案守则 + 文档）— 依赖 B1 + C1 + C2 + D1
1. **先写** `tools/opsforge-wording.test.mjs` 扩 WC6（catalog 徽章）+ WC7（install 边界）+ FORBIDDEN_RE 新增禁词。
2. **再写** R33 `scanRepoForIndexFetchSsrf` + 集成测试 R33-I1/R33-I2（仿 R32-6）。
3. **改** `templates/readme-template.zh.md`（加"如何发现能力"段）。
4. **改** `AGENTS.md`/`CLAUDE.md`（现状段更新）。
5. **验证**：`bare node --test` 全绿（574 + 全部新增）；6 gates exit 0：
   - `node tools/validate.mjs --all` exit 0（14 capabilities，无新 cap）
   - `node tools/security-scan.mjs --all` exit 0（**R33 必须在 process.exit 前调**，仿 R32 CL1 修复）
   - `OPSFORGE_RUNNER=static-only node tools/eval.mjs --all` exit 0（MEMORY：eval must run static-only）
   - `node tools/release.mjs --all` exit 0
   - `node install.mjs --doctor --platform claude-code` healthy
   - `bare node --test` 全绿

**TDD 顺序总结**：A1→A2→B1→B2→C1→C2→D1→AB。每步先写测试再写实现，6 gates 在 AB 步全验。

---

*本架构文档基于 Stage 1 设计文档 v2（业务用户评审 3 必改全落地），守住 OpsForge 10 条硬不变量。tdd-guide 据此实现，code-reviewer 据此校验。*
