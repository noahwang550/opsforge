# 设计方案：远程 index.json 能力索引（Phase 4 第六刀 · Stage 1 规划设计）

> 状态：proposal-v2（业务用户评审必改全部落地）  
> 日期：2026-08-07  
> v2 变更：业务用户评审裁决"不通过"→ 3 条必改全部落地 + 3 条建议采纳。  
> 前序：Phase 4 第五刀（能力目录触达 + 一键提交）已交付，574/574 绿、6 gates 全绿、14 capabilities。本刀把 `registry.yaml` 演进为远程 `index.json`（PLAN.md §15 Phase 4 治理飞轮条目 + §22.12 "随 v7 remote index.json 一起演进"），让用户**不必 clone 仓库**就能 discover（浏览能力目录）与（部分）install。配合上一刀的"菜单选 8 目录 + 选 9 一键提交"，形成完整闭环：中心仓远程索引 → 本地 discover/install → 本地建能力 → 一键提交回中心仓。  
> 硬不变量：零新 npm 依赖 / `additionalProperties:false` / `registry*.yaml` auto-gen / Windows argv / R16–R32 不弱化 + R33 同级 / §B 全套 / CODEOWNERS + 三态 / 无 Go / release gate 三报告不动 / 6 gates 全绿。

---

## 第零部分：业务用户文案守则（统领所有 user-facing 文案，沿用第五刀 + 新增）

本方案所有打印给业务用户看的文案，**必须**遵守以下词典。违反即视为缺陷（architect/tdd/reviewer 据此校验）。

| 禁用词（业务用户看不懂/有风险） | 替换业务话 |
|---|---|
| PAT / Personal Access Token / 令牌 / token | （首次引导时用"贡献码"；之后对用户不可见） |
| GitHub / github.com / Settings / Developer settings / PAT classic / repo 权限 | "团队管理员" / "能力仓" |
| PR / pull request / branch / 分支 / commit | "提交" / "提交进度页" |
| install / 安装（命令词） | "在主菜单选 2 装到他们电脑" |
| steering review / CI / review / bot | "运营团队审核" / "审核意见" |
| `127.0.0.1` / `:port` / `/capabilities/<id>` / URL 裸串 | "主菜单选 8" / "主菜单选 8 可看详情" |
| `opsforge submit <dir>` / 命令行参数 | 只走菜单"选 9 → 选草稿"，不要求敲命令 |
| **新增**：`index.json` / `registry` / `gh-pages` / `fetch` / `cache` / `TTL` / `raw.githubusercontent` / `jsdelivr` / `CDN` / `host` / `endpoint` | "能力广场" / "能力目录" / "在线能力清单" / "已连上能力仓" |
| **新增**：`clone` / `仓库` / `repo` / `git address` / `git 地址` / `git URL` / `远程`（技术义） | "把能力仓整个下到本地"（**仅在必须说明边界时用此业务话，且只在 install 边界提示一处出现**）；第三方能力来源只说"来源网址"，不出现"git"字样 |

**深链可见性规则（沿用）**：`http://127.0.0.1:<port>/...` 形式的完整 URL **只在 catalog server 正在运行时**作为终端可点击链接呈现；server 未运行时**只打印业务指引**"主菜单选 8"，绝不打印打不开的 URL 或相对路径串。

**远程来源标注规则（新增）**：discover 输出每条能力后可追加来源标注，但标注只能是业务话（"官方"/"社区"），不得出现 `index.json`/`registry`/`远程 fetch` 等技术词。能力目录页（catalog web）顶部可显示"已连上能力仓"状态徽章（绿点），不得显示 URL/host/响应码。

---

## 第一部分：现状确认（基于真实代码，附 `file_path:line`）

### 数据流现状（已确认）

1. **registry 是 auto-gen SSOT**：`tools/release.mjs:127 aggregateAll()` 扫 `packs/<pack>/` + `customers/<brand>/packs/` → 每 cap 调 `release()`（三报告门：validation+security+eval pass/pending）→ 写 `registry.yaml`（key=`<pack>.<name>`，entry=`{current, history[], changelog_index}`）+ `registry-brands.yaml`。**不得手编**。
2. **inventory 是 registry + body H2 的派生**：`tools/inventory.mjs:180 buildInventory()` 读 `registry.yaml` + `scanCapabilities()`（三态）+ 每能力 body 的 `## 能力说明` / `## 适用场景` H2（R_scenario 规则强制）→ entries（含 id/version/kind/pack/description/detail/scenarios/platformSupport/light/state/scope/installHint/intakeScope 等）。三个只读出口：README 标记块（`--readme`）、discover 文本（`--all`）、catalog snapshot。
3. **catalog snapshot 是 inventory 的发布视图**：`tools/catalog-model.mjs:91 buildCatalogSnapshot()` 调 `buildInventory()` + `loadPlatforms()` → `{version, generatedAt, count, platforms, filters, capabilities:[publicEntry...]}`，只暴露 `state==='released'` 的能力，`publicEntry()` 过滤敏感字段（`catalog-model.mjs:69`）。**这正是远程 index.json 应序列化的对象**——同一数据源的第二（第三）出口，无双 SSOT。
4. **catalog server 服务 snapshot**：`tools/catalog-server.mjs startCatalogServer()` 服务 `/api/catalog`（= snapshot）+ `/api/capabilities/<id>`（= 单个 publicEntry 含 usage/detail）。`web/catalog/app.js` fetch 这两个端点渲染。**未接远程**：只读本地仓库 buildInventory。
5. **discover 只读本地**：`tools/opsforge.mjs` `cmdDiscover`/`renderDiscoverAll` 调 `buildInventory()` → 中文文本卡片，每条末尾"（主菜单选 8 可看详情）"。无远程回退。
6. **install 解析需仓库**：`install.mjs` `readRegistryForInstall` 读 `registry.yaml`（`~/.opsforge/registry.yaml` home 回退）解析 `<id>` → capDir；`findCapabilitySource`/`installFromGit` 支持仓库内查找 + `--from-git` clone-to-temp。**无远程元数据解析**：仓库不在本地 → install 找不到 id。
7. **runtime 副本动态 import 仓库根 install.mjs**：`tools/opsforge-runtime.mjs` `resolveWorkDir()` 三级回退（env > cwd-repo > home/workdir > home-first-bootstrap）+ `pathToFileURL` 动态 import 仓库根 `install.mjs`。**架构不变量**：`~/.opsforge/` runtime 副本不自足，仓库须存在。本刀的远程索引是打破此不变量的**第一步前置**（解决"发现"，"安装源码"仍需仓库或 git）。
8. **SSRF 守卫已有**：`tools/submit.mjs` 硬编码 `api.github.com` host（不接用户输入 host）；`tools/intake-remote.mjs` `assertPublicUrl` 全套 SSRF 守卫（私网拒绝 + DNS rebinding 防御）。本刀远程 fetch 复用此模式。
9. **文案守则已有 WC1-WC4**：`tools/opsforge-wording.test.mjs` FORBIDDEN_RE 扫 PRINT_TOPICS + menu + promptInstallFlow 深链可见性。本刀新增 WC5-WC7。

### 痛点

1. **discover 必须 clone 仓库**：业务用户想"看看有哪些能力"必须先把整个 OpsForge 仓库 clone 到本地，然后 `opsforge discover` 或菜单选 8。非技术用户根本不会 clone。
2. **install 必须仓库在场**：`install --install <id>` 靠 `readRegistryForInstall` 读本地 `registry.yaml` 解析 id → capDir。仓库不在 → "找不到能力"。即便能力已发布到中心仓，本地没仓库就用不了。
3. **能力目录（catalog web）只在本地 server 跑时可见**：`cmdCatalogFlow` 起 `127.0.0.1` 本地 server。没有仓库就没有 buildInventory 数据，server 起不来。远程用户看不到目录。
4. **闭环断口**：上一刀"选 9 一键提交"提交后，merge → CI 重建 `registry.yaml` → 别人要看到新能力仍须 clone 仓库。远程索引补上这最后一环：merge → CI 发布 index.json → 别人 discover/catalog 直接看到。**闭环时间线（业务话，建议 #2）**：选 9 提交后提示"运营团队会审核，通过后约 2 分钟内全员能在目录看到"——让业务用户对等待有预期（审核时长由运营团队 SLA 定，本刀只补"通过后 2 分钟可见"的机器侧确定性）。

### 目标与边界（精确）

- **解决"发现"**：远程 index.json 让 `discover`（CLI 文本）+ 能力目录（web catalog）**不必 clone 仓库**就能浏览全部已发布能力。
- **install 边界明示**：index.json 提供**元数据**（id/pack/kind/version/source/installHint）；"安装源码"仍需（a）OpsForge 仓库在本地，或（b）第三方能力的 `install_hint`（git 地址）走现有 `installFromGit`。**官方能力在无仓库机器上的"克隆仓库按需安装"留作未来 Phase**（本刀只铺元数据解析，不做 clone-on-install）。这是"repo-less-machine bundled release"的前置，不是其本身。
- **不改 registry*.yaml 手编**：index.json 是 registry*.yaml + body H2 的**派生产物**，由工具 auto-gen，和 README 标记块同级。

---

## 第二部分：方案

### 2.1 index.json 生成（Slice A1）

**新文件 `tools/index-publish.mjs`**（steering-owned）：
- `export async function buildIndex(opts)`：调 `buildCatalogSnapshot({ repoRoot })`（复用 catalog-model.mjs，**同一数据源**）→ 返回 snapshot 对象。
- 序列化为两个产出物，**精确镜像 catalog-server 的 API 契约**（`catalog-model.mjs:111 catalogSummary` + `:69 publicEntry`）：
  1. `index.json` = `catalogSummary(snapshot)`（**轻量列表**，剥 `detail`/`qualityChecks`/`dependencies`/`usage`，与 `/api/catalog` 返回完全同形）→ 供 app.js `loadCatalog` 一次性拉取渲染列表。
  2. `capabilities/<id>.json` = 每个完整 `publicEntry`（**含 detail/usage/qualityChecks/dependencies**，与 `/api/capabilities/<id>` 返回完全同形）→ 供 app.js `openDetail` 懒加载深链详情。
- 这样静态站 app.js 只需把 fetch base 从 `/api/` 换成 `./`，**数据形状零改动**。
- `export async function publishIndex({ repoRoot, outDir })`：写 `index.json` + `capabilities/*.json` 到 `outDir`（默认 `web/catalog/dist/`，gitignore）。
- `main()`：CLI `node tools/index-publish.mjs [--out-dir <path>]`。
- **数据源唯一性**：`buildCatalogSnapshot` ← `buildInventory` ← `registry.yaml` + body H2。index.json 与 README 标记块、discover 文本同源，无双 SSOT。

**新文件 `schema/index.schema.json`**（steering-owned）：JSON Schema 描述 index.json 顶层结构（`version`/`generatedAt`/`count`/`platforms`/`filters`/`capabilities`），`additionalProperties: false` 全保留。**作用**：fetch 远程 index 后用它校验，防损坏/投毒（untrusted data）。capabilities 数组每项的 schema 镜像 `publicEntry` 字段集（id/version/name/nameEn/description/detail/scenarios/scenarioTag/kind/kindLabel/pack/scope/scopeLabel/project/projectLabel/source/quality/qualityChecks/releasedAt/dependencies/platformSupport/availability/usage）。

### 2.2 托管位置（Slice B2 发布机制）

**推荐：GitHub Pages（`gh-pages` 分支）**。

- **理由**：(1) 稳定 URL `https://<owner>.github.io/<repo>/index.json`，CORS 友好（GitHub Pages 默认 `Access-Control-Allow-Origin: *` 对静态资源）；(2) 不污染 main 分支（独立 `gh-pages` 分支）；(3) 同时托管能力目录 web 站点（`web/catalog/` + `index.json` + `capabilities/*.json`），用户访问 `https://<owner>.github.io/<repo>/` 即见目录，**无需 clone、无需本地 server**；(4) 零成本、零新依赖（GitHub Actions `actions/deploy-pages` 官方 action）。
- **不选 raw.githubusercontent.com**：无 CORS 头，浏览器 fetch 跨域受限；只适合 CLI fetch 不适合 web 站点。
- **不选 jsdelivr**：依赖 raw.githubusercontent 作源，多一层缓存延迟，发布后刷新不及时。

**官方索引源 URL 硬编码**（仿 submit.mjs `api.github.com` 模式）：
- `tools/index-fetch.mjs` 内 `OFFICIAL_INDEX_HOSTS = ['github.io']`（白名单，只允许 `github.io` 这个 host）。
- 具体 URL 从 git remote 派生：`resolveGitRemote()`（复用 submit.mjs 的 `execFileSync('git',['config','--get','remote.origin.url'])` argv 形式 + SSH/HTTPS 解析）→ `https://<owner>.github.io/<repo>/index.json`。
- **不接受用户任意 URL 作官方源**：env `OPSFORGE_INDEX_URL` 可覆盖（仅供测试/自建镜像），但**走 `assertPublicUrl` 全套 SSRF 守卫**（私网拒绝 + DNS rebinding 防御），且 host 必须在公网。

### 2.3 拉取与缓存（Slice A2）

**新文件 `tools/index-fetch.mjs`**（steering-owned）：
- `export async function fetchRemoteIndex({ url, cacheDir, ttl, refresh })`：
  1. 若 `!refresh` 且缓存有效（`~/.opsforge/cache/index.json` 存在 + mtime 在 TTL 内，默认 24h）→ 读缓存返回。
  2. 否则 `await fetch(url)`（Node 内置 fetch）。
  3. 响应 `Content-Type` 须含 `application/json` 或 `text/plain`；`ok` 须真；否则抛错。
  4. `await response.json()` → 用 `ajv` + `schema/index.schema.json` 校验（损坏/投毒 → 抛错，不返回半截数据）。
  5. 原子写 `~/.opsforge/cache/index.json`（`atomicWriteSync`，0600 目录）+ 记 `fetchedAt`。
  6. 返回 `{ index, fromCache: boolean, fetchedAt }`。
- `export function officialIndexUrl(repoRoot)`：从 git remote 派生官方 URL（host 硬编码 `github.io`）。
- `export function readCacheIndex(cacheDir)`：离线降级读缓存（不校验 TTL，只校验 schema）。
- **缓存路径**：`~/.opsforge/cache/index.json`（新目录，复用 `paths.mjs` `opsforgeHome()` 助手）。
- **失效**：TTL 24h（可配 `OPSFORGE_INDEX_TTL` 秒数）或 `--refresh`（强制重拉）。
- **SSRF 边界**：官方 URL（host 白名单 `github.io`）不走 `assertPublicUrl`（可信源）；用户覆盖 URL（env `OPSFORGE_INDEX_URL`）**必走 `assertPublicUrl` 全套**（复用 intake-remote.mjs）。

### 2.4 discover 改造（Slice B1）

**`tools/opsforge.mjs`**（steering-owned）：
- `cmdDiscover` / `discover --all` 改为**远程优先 + 本地回退**：
  1. 尝试 `fetchRemoteIndex({ url: officialIndexUrl, ttl, refresh: opts.refresh })`。
  2. 成功 → 从 index.capabilities 渲染 `renderDiscoverAll`（复用现有渲染，数据形状兼容——index.capabilities = publicEntry[]，inventory entry 是其超集，渲染需映射少量字段）。
  3. 失败/无网 → 回退 `buildInventory()`（本地仓库）+ 顶部打印"○ 暂时连不上能力仓，显示本地已装能力"（业务话）。
  4. 失败/无网 + **无本地仓库**（repo-less）→ 不提示"主菜单选 8"（那也会失败，避免死循环），改打印"○ 暂时连不上能力仓，稍后再试或联系团队管理员。"（业务话，必改 #3）。
  5. 成功时顶部打印"● 已连上能力仓（共 N 项能力）"（业务话，无 URL/host）。
- 每条能力后保留"（主菜单选 8 可看详情）"。
- **来源标注**：远程命中时每条可标"官方"/"社区"（读 `entry.source.key`），不标技术词。
- `PRINT_TOPICS` 加 `'discover-remote-hint'`（"想看全部能力？主菜单选 8 打开能力目录，或直接跑 opsforge discover"）。

### 2.5 install 改造（Slice C1，P1）

**`install.mjs`**（steering-owned）：
- 现状澄清（基于代码确认）：`findCapabilitySource(capId, repoRoot)`（`install.mjs:64`）是**纯文件系统扫描**（扫 `packs/<pack>/{kindDirs}/<name>/` + brand + `_staged/third-party/`），**不读 registry.yaml**；`readRegistryForInstall`（`install.mjs:45`）读 registry.yaml 只取**版本/依赖元数据**，不取源码位置。源码定位永远靠仓库在场。
- `readRegistryForInstall` 增**远程元数据回退**（只补版本/依赖/source 元数据，不补源码位置）：
  1. 本地 `registry.yaml` / `~/.opsforge/registry.yaml` 找到 id → 照旧取版本/依赖元数据。
  2. 本地找不到 → `fetchRemoteIndex()` → 在 index.capabilities 查 id 的元数据（version/pack/kind/source/installHint）。
  3. **源码获取边界**（由 `findCapabilitySource` 的文件系统特性决定，明示给用户，**业务话**）：
     - 若 `entry.source.key === 'third-party'` 且 `entry.installHint`（git URL）存在 → 提示"这是社区能力，可从其来源获取——主菜单选 2，粘贴来源网址即可。"（走现有 `installFromGit`，绕过 `findCapabilitySource` 直接传 `capDir`；对用户只说"来源网址"，不出现"git"字样）。
     - 若是官方能力且无 installHint → `findCapabilitySource` 在无仓库机器上必然返回 null → 业务话提示"这能力在能力仓里找到了。要装到本地，需要团队管理员先帮你把 OpsForge 装一次（只需一次）。请联系团队管理员。"——**不给用户做不到的指令**（不要求用户自己"下到本地"/clone）。**不自动 clone 仓库**（clone-on-install 留作未来 Phase，见第八部分）。
     - index.json 只含 released 能力的元数据，不含草稿/暂存。
     - **installHint 不在 catalog web 展示**（只供 install 内部解析）：catalog 卡片的 `source.label`（"第三方"）已是业务话，不裸露 git URL（建议 #1）。
- `promptInstallFlow`（在 opsforge.mjs）：install 成功后业务话不变；install 因边界无法完成时打印上述业务话边界提示（无 `clone`/`repo`/`git` 技术词）。

### 2.6 catalog 远程数据源（repo-less 目录，Slice C2，P1）

**`tools/opsforge-catalog-launcher.mjs` + `tools/catalog-server.mjs`**（steering-owned）：
- `cmdCatalogFlow` 分支：
  - **仓库在本地**（`resolveWorkDir()` 找到 repo）→ 照旧起本地 server（buildCatalogSnapshot 从本地仓库）。
  - **仓库不在**（repo-less 机器）→ 先探测远程可达（`fetchRemoteIndex` 试读缓存/拉取）：
    - 远程可达 → `openInBrowser(officialCatalogUrl)`（远程 GitHub Pages 站点）。打印"已打开能力广场（在线版），看完关掉浏览器回这里按回车。"（业务话，无 URL）。
    - 远程不可达 + 无缓存 → **不起浏览器**（避免打开报错页），打印"能力广场暂时打不开，可能还没准备好。稍后再试，或联系团队管理员。"（业务话，必改 #3）。**不提示"主菜单选 8"**（那也会失败，避免死循环）。
- 远程站点 = GitHub Pages 静态站（见 2.7），数据源 = 静态 index.json。
- **SSRF**：`openInBrowser` 的 URL 须 `new URL` 校验 host 在 `github.io` 白名单（复用 launcher 现有 `127.0.0.1` 校验逻辑，扩白名单）。

### 2.7 静态 catalog 站点（Slice D1，P2）

**`web/catalog/app.js`**（steering-owned）：
- 增"静态模式"：页面加载时先尝试 `fetch('/api/catalog')`（本地 server），失败则 `fetch('./index.json')`（静态站点同目录）。或检测 `location.hostname` 含 `github.io` → 直接走静态模式。
- 静态模式下：`openDetail(id)` 不再 `fetch('/api/capabilities/<id>')`，改从已加载的 `state.catalog.capabilities` 内存查（snapshot 已含全字段，含 detail/usage）。或 `fetch('./capabilities/<id>.json')` 读单文件（A1 产出）。
- 顶部状态徽章"已连上能力仓"（绿点），远程站点永远显示；本地 server 模式可显示"本地模式"。
- **不改 CSP / 不改 escapeHtml**（app.js 已全程 `escapeHtml`，静态模式同源 fetch 无 XSS 新面）。

### 2.8 发布机制（Slice B2，P0）

**新文件 `.github/workflows/publish-index.yml`**（steering-owned CI）：
- 触发：`push` to `main`（merge 后，在现有 `release.yml` 重建并 bot-commit `registry.yaml` 之后跑）+ `workflow_dispatch`。
- 现状澄清：`release.yml` 已在 push-to-main 时跑 `release --all` 重建 registry 并 bot-commit/push 回 main。本 workflow **不重复 release**，只做 index 发布：
  1. checkout（含 `release.yml` 刚推的 registry.yaml）。
  2. setup-node（`.nvmrc`）+ `npm ci`。
  3. `node tools/inventory.mjs --readme`（刷新 README 标记块，与 registry 同源）。
  4. `node tools/index-publish.mjs --out-dir web/catalog/dist`（生成 index.json + capabilities/*.json）。
  5. 把 `web/catalog/`（HTML/CSS/JS）+ `web/catalog/dist/index.json` + `web/catalog/dist/capabilities/*.json` 部署到 GitHub Pages（`actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages`）。
- **业务用户不碰**：全自动。merge PR 后 1-2 分钟远程索引更新。
- **guardrails**：此 workflow 文件本身在 `.github/workflows/`，受 CODEOWNERS steering 保护；`tools/index-publish.mjs` 受 `tools/**` + `**/*.mjs` 路径守卫。
- **时序**：`release.yml`（重建 registry → push main）触发 `publish-index.yml`（读新 registry → 发 index）。若 `release.yml` 还没把 registry push 上去，本 workflow 读到的是旧 registry——可接受（下次 push 自愈），或用 `workflow_run` 事件链式触发确保时序。

### 2.9 菜单集成（Slice B1 + C2）

- `opsforge menu` 选项 8 文案不变（"打开能力目录"），行为变：仓库在→本地 server；仓库不在→远程站点。**用户无感**（都只看到"已打开能力目录"）。
- discover 输出顶部加远程连接状态徽章（业务话）。

### 2.10 安全

- **官方索引源 URL 硬编码 host** `github.io`（白名单），从 git remote 派生，不接用户输入。
- **用户覆盖 URL**（`OPSFORGE_INDEX_URL`）走 `assertPublicUrl` 全套 SSRF 守卫（复用 intake-remote.mjs：私网/元数据/`.local`/`.corp`/hex/decimal/octal/v4-mapped-v6 拒绝 + DNS rebinding 防御）。
- **index.json 是 untrusted data**：fetch 后 `ajv` + `schema/index.schema.json` 校验；解析后**只作展示数据**，不当指令执行；catalog app 全程 `escapeHtml`（已有）；discover 文本渲染不 eval。
- **缓存篡改**：`~/.opsforge/cache/` 目录 0600；缓存文件 schema 校验后才用；不信任缓存的 `fetchedAt`（防时间欺骗不在此 scope，schema 校验已足够）。
- **R33 同级新增**（见下）。

### 2.11 失败降级

| 场景 | 降级 | 业务话 |
|---|---|---|
| 网络不可达（仓库在场） | 读缓存 → 无缓存则本地仓库 buildInventory → 无仓库则空清单 | "暂时连不上能力仓，显示本地能力。" |
| 网络不可达 + **repo-less**（无仓库） | 读缓存 → 无缓存则空清单，**不提示选 8**（避免死循环） | "暂时连不上能力仓，稍后再试或联系团队管理员。"（必改 #3） |
| index.json 损坏/schema 失败 | 读缓存 → 无缓存则本地回退 | "能力仓数据异常，已用上次缓存。" / 无缓存则"暂时无法读取能力仓，稍后再试。" |
| 版本不兼容 | 检查 `index.version` 前缀，major 不匹配则告警 + 读缓存 | "能力仓版本较新，建议升级 OpsForge 后再试。" |
| GitHub Pages 未配置/404 | 仓库在→回退本地；repo-less→不起浏览器，业务话兜底 | "远程能力仓暂未就绪，稍后再试或联系团队管理员。"（必改 #3） |
| catalog 选 8 远程打不开（repo-less） | 不起浏览器，不提示选 8 | "能力广场暂时打不开，可能还没准备好。稍后再试或联系团队管理员。" |

---

## 第三部分：slice 切分（P0/P1/P2，每个独立可交付可测）

### Slice A1（P0，index 生成）——index-publish + schema
- 文件：`tools/index-publish.mjs`（新，`buildIndex`/`publishIndex`/`main`，调 `buildCatalogSnapshot` 复用）、`schema/index.schema.json`（新，`additionalProperties:false`）、`tools/index-publish.test.mjs`（新，断言 index.json shape == buildCatalogSnapshot 输出 + capabilities/*.json 生成 + schema 校验通过 + 无敏感字段泄露）。
- 验收：`node tools/index-publish.mjs` 产出 `index.json` + `capabilities/*.json`；ajv 校验通过；bare `node --test` 绿；6 gates 不变。

### Slice A2（P0，远程拉取+缓存+SSRF）——index-fetch
- 文件：`tools/index-fetch.mjs`（新，`fetchRemoteIndex`/`officialIndexUrl`/`readCacheIndex`，Node fetch + `~/.opsforge/cache/` + TTL + `--refresh` + `assertPublicUrl` 对用户 URL + ajv schema 校验）、`tools/index-fetch.test.mjs`（新，mock fetch：缓存命中/未命中/TTL 过期/`--refresh` 强拉/损坏 JSON/schema 失败/SSRF 拒绝私网/官方 host 派生）。
- 验收：fetch + 缓存 + TTL + SSRF 守卫全路径测过；bare `node --test` 绿；零新依赖。

### Slice B1（P0，discover 远程优先）——opsforge.mjs + 文案
- 文件：`tools/opsforge.mjs`（`cmdDiscover`/`renderDiscoverAll` 远程优先 + 本地回退 + 来源标注 + `PRINT_TOPICS['discover-remote-hint']`）、`tools/opsforge-wording.test.mjs`（扩 WC5：discover 远程文案无禁用词 + 来源标注无技术词 + 连接状态徽章业务话）。
- 验收：`opsforge discover --all` 远程命中时顶部"已连上能力仓" + 每条来源标注；无网时本地回退 + 业务话；WC5 断言通过；bare `node --test` 绿。

### Slice B2（P0，发布机制）——CI workflow
- 文件：`.github/workflows/publish-index.yml`（新，merge-to-main → inventory --readme → index-publish → deploy-pages）、`.github/workflows/guardrails.yml`（确认 `tools/index-publish.mjs` 已被 `tools/**` + `**/*.mjs` 覆盖，不需改）、`CODEOWNERS`（确认 `.github/workflows/` + `schema/` 已覆盖）、`.gitignore`（加 `web/catalog/dist/`——index-publish 的产物不进 git，由 CI 重新生成；`~/.opsforge/cache/` 在仓库外无需加）。
- 验收：workflow 语法合法（`actionlint` 或本地检）；merge 后 gh-pages 有 index.json；本地 `node tools/index-publish.mjs` 产出可被 `fetch` 语义消费；bare `node --test` 绿。

### Slice C1（P1，install 远程元数据 + 边界）——install.mjs
- 文件：`install.mjs`（`readRegistryForInstall` 增远程 index 回退查元数据；不自动 clone 仓库）、`tools/opsforge.mjs`（`promptInstallFlow` 边界业务话提示）、`tools/install-remote-lookup.test.mjs`（新，mock fetchRemoteIndex：本地找不到→远程命中 official→边界提示；远程命中 third-party+installHint→指向 installFromGit；远程未命中→"找不到"）。
- 验收：install 能从远程 index 查到 id 元数据；官方能力无仓库时业务话边界提示（无 clone/repo/git 词）；第三方有 installHint 指向 installFromGit；bare `node --test` 绿。

### Slice C2（P1，catalog repo-less 远程）——launcher + cmdCatalogFlow
- 文件：`tools/opsforge-catalog-launcher.mjs`（`openInBrowser` URL host 白名单扩 `github.io`）、`tools/opsforge.mjs`（`cmdCatalogFlow` 分支：仓库在→本地 server；仓库不在→openInBrowser 远程站点 + "按回车回菜单"）、`tools/opsforge-catalog-launcher.test.mjs`（扩：远程 URL 校验 + host 白名单）。
- 验收：repo-less 机器选 8 打开远程能力广场；仓库在时照旧本地 server；URL 校验防逃逸；bare `node --test` 绿。

### Slice D1（P2，静态 catalog 站点）——app.js 静态模式
- 文件：`web/catalog/app.js`（静态模式：`fetch('./index.json')` 回退 + detail 从内存 snapshot 读 + "已连上能力仓"徽章）、`web/catalog/index.html`（徽章容器）、`web/catalog/styles.css`（徽章样式）。
- 验收：GitHub Pages 静态站打开能看全部能力 + 详情抽屉 + 筛选；无 `/api/` 依赖；escapeHtml 不变；bare `node --test` 绿（若有 app.js 单测则扩）。

### Slice AB（P2，文案守则 + 文档）
- 文件：`tools/opsforge-wording.test.mjs`（扩 WC6：catalog 远程站点徽章文案无禁用词；WC7：install 边界提示无 clone/repo/git 词 + 只业务话）、`templates/readme-template.zh.md`（加"如何发现能力：主菜单选 8 打开能力广场，无需下到本地"段）、`AGENTS.md`/`CLAUDE.md`（现状段更新 Phase 4 第六刀交付）。
- 验收：WC5-WC7 断言通过；文档段无禁用词；bare `node --test` 绿。

---

## 第四部分：测试策略

- **单元**：`index-publish.test.mjs`（index.json shape + schema + 无敏感字段）、`index-fetch.test.mjs`（mock fetch + 缓存 + TTL + SSRF + schema 校验）、`install-remote-lookup.test.mjs`（mock fetchRemoteIndex + 边界分支）。
- **CLI argv 路径**（MEMORY 强制）：`node tools/index-publish.mjs` spawn 测试；`opsforge discover --all` 远程/本地回退 spawn 测试（mock fetchRemoteIndex）。
- **文案守则测试**：WC5（discover 远程文案 + 来源标注）、WC6（catalog 徽章）、WC7（install 边界）—— FORBIDDEN_RE 扩新增禁词（`index\.json`/`registry`/`gh-pages`/`fetch`/`cache`/`TTL`/`raw\.githubusercontent`/`jsdelivr`/`CDN`/`host`/`endpoint`/`clone`/`repo`）。
- **集成**：`index-publish` 真跑 buildCatalogSnapshot 对 fixture；`index-fetch` 真起本地 http server 返回 fixture index.json + fetch + 缓存写入。
- **硬不变量 gate**：bare `node --test` 必绿（574 + 新增）；6 gates exit 0；`additionalProperties:false` 全保留（含新 `schema/index.schema.json`）；`package.json` 无新依赖；`registry*.yaml` 仍 auto-gen（index.json 是派生，不回写 registry）。

---

## 第五部分：R33 同级新增（§B 安全）

**新规则 `R33_index_fetch_no_user_host`**（同级独立新增，R16–R32 不弱化）：
- 扫描点：`tools/index-fetch.mjs` + `tools/opsforge.mjs`（cmdDiscover）+ `install.mjs`（远程回退）+ `tools/opsforge-catalog-launcher.mjs`。
- 规则：远程 fetch 的官方索引源 host 必须在白名单（`github.io`）；用户覆盖 URL（env）必须经 `assertPublicUrl`；`index.json` fetch 后必须 ajv schema 校验才能消费。
- 实现：`security-scan.mjs` 加 `R33` 函数，静态扫 `tools/` 源码确认：无 `fetch(<变量>)` 未经校验直接消费；官方 host 字面量硬编码；用户 URL 变量经 `assertPublicUrl` 调用。
- 不进 per-cap `scan(capDir)` 返回值（守 security-report.json 结构），与 R32 同级独立。

---

## 第六部分：硬不变量自检表（10 条逐条确认）

| # | 不变量 | 影响 | 结论 |
|---|---|---|---|
| 1 | 零新 npm 依赖 | 远程 fetch 用 Node 内置 `fetch`（Node 22 原生）；缓存用 `fs`；schema 校验用已有 `ajv`；git remote 解析用 `child_process` argv | ✅ 零新依赖 |
| 2 | `additionalProperties:false` 全保留 | 新 `schema/index.schema.json` 顶层 + capabilities 项 + platforms/filters 子对象全 `additionalProperties:false`；不触能力 schema | ✅ 保留 |
| 3 | `registry*.yaml` auto-gen 不手编 | index.json 是 `buildCatalogSnapshot` ← `buildInventory` ← `registry*.yaml` + body H2 的**派生产物**；不回写 registry；README 标记块同级 | ✅ 不触手编 |
| 4 | Windows argv | `resolveGitRemote` 用 `execFileSync('git', argv)` 形式；`openInBrowser` 远程 URL 用 `new URL` 校验 + 双引号包裹（防 `&`/`|` 逃逸，复用 launcher 现有 Windows 修复）；无 `shell:true` | ✅ 全 argv |
| 5 | R16–R32 不弱化 + R33 同级新增 | 不触 R16–R32；新 R33 独立函数扫 index-fetch SSRF + schema 校验路径，不进 per-cap scan 返回值 | ✅ 不弱化 + R33 |
| 6 | §B security-scan 全套保留 | 远程 fetch 复用 `assertPublicUrl` 全套 SSRF（`tools/intake-fetch.mjs:83`，私网/DNS rebinding/`SHELL_METACHAR` 拒绝）；官方 host 硬编码白名单 `github.io`（仿 `submit.mjs:14` `api.github.com` 模式）；index.json untrusted data 经 `ajv` + `schema/index.schema.json` 校验；用户输入 URL（env 覆盖）与硬编码官方源**区分对待**（官方源可信不经 assertPublicUrl，用户覆盖 URL 必经） | ✅ 全套保留 |
| 7 | CODEOWNERS + 三态不动 | `tools/index-*.mjs` + `schema/index.schema.json` + `.github/workflows/publish-index.yml` 全 steering-owned（`tools/**`+`schema/**`+`**/*.mjs`+`.github/workflows/` 覆盖）；贡献者仍只写 `.md/.yaml/.json`；三态 `_drafts→_staged→formal` 不变 | ✅ 不动 |
| 8 | 不引 Go 二进制 | 纯 Node（fetch + fs + child_process + ajv） | ✅ 无 Go |
| 9 | release gate 三报告不动 | `release.mjs` 三报告门（validation+security+eval pass/pending）不变；`publish-index.yml` 在 `release.yml`（push-to-main 重建 registry 并 bot-commit）**之后**跑（读新 registry 发 index），不重复 release、不改 release 门逻辑 | ✅ 不动 |
| 10 | 6 gates 全绿 | validate/security/eval/release/doctor 不变；bare `node --test` 574 + 新增（A1+A2+B1+C1+AB 测试）；publish-index.yml 是新 workflow 不影响现有 6 gates | ✅ 全绿 |

---

## 第七部分：成功标准

- [ ] `node tools/index-publish.mjs` 产出 `index.json` + `capabilities/*.json`，ajv schema 校验通过，无敏感字段泄露。
- [ ] `opsforge discover --all` 远程命中时顶部"已连上能力仓（共 N 项）" + 来源标注（官方/社区，无技术词）；无网 + 有仓库时本地回退 + 业务话；无网 + repo-less 时"稍后再试或联系团队管理员"，**不提示选 8**（避免死循环，必改 #3）。
- [ ] repo-less 机器选 8：远程可达→打开能力广场；远程不可达→**不起浏览器**，业务话"能力广场暂时打不开…稍后再试或联系团队管理员"（必改 #3）。
- [ ] install 从远程 index 查到 id 元数据；官方能力无仓库时业务话"联系团队管理员帮你装一次"（**不给做不到的指令**，必改 #1）；第三方有 installHint 指向 installFromGit，对用户只说"来源网址"不出现"git"（必改 #2）。
- [ ] `OPSFORGE_INDEX_URL` 覆盖 URL 走 `assertPublicUrl` SSRF 守卫（私网拒绝）；官方源 host 硬编码 `github.io`。
- [ ] merge to main → CI 自动发布 index.json + 静态站到 gh-pages；业务用户不碰 git。
- [ ] **文案守则测试**：WC5-WC7 断言通过，FORBIDDEN_RE 扩新增禁词（含 `git 地址`/`git address`/`git URL`）。
- [ ] bare `node --test` 全绿（574 + 新增）；6 gates exit 0；零新 npm 依赖；`additionalProperties:false` 全保留（含新 schema）；`registry*.yaml` 仍 auto-gen；R16–R32 不弱化 + R33 同级新增。
- [ ] 业务用户全程只做"选菜单选 8 看能力广场 / 跑 discover 看清单"，不碰 git/clone/命令行/技术词；install 边界只让用户"联系管理员"或"粘来源网址"，不要求做不到的操作。

---

## 第八部分：风险总览与未来升级

| 风险 | 等级 | 缓解 |
|---|---|---|
| GitHub Pages 未配置/404 | 中 | discover/install 回退本地；业务话"远程能力仓暂未就绪" |
| index.json 被篡改（MITM） | 中 | HTTPS 传输 + ajv schema 校验 + 不当指令执行 + 缓存目录 0600；GitHub Pages 本身 HTTPS |
| 缓存陈旧导致 discover 漏新能力 | 低 | TTL 24h + `--refresh` + merge 后 CI 自动刷新 |
| 官方 host 变更（仓库迁移） | 低 | `officialIndexUrl` 从 git remote 动态派生 owner/repo，host 白名单 `github.io` 不变；迁移时改 remote 即可 |
| 远程 fetch 阻塞 CLI（超时） | 低 | fetch 超时 5s → 回退缓存/本地；不无限等 |
| 静态站 XSS（index.json 注入） | 低 | app.js 全程 `escapeHtml`（已有）+ CSP `default-src 'self'`（静态站同源）|
| install 边界让用户困惑（"为什么还要下仓库"） | 中 | 业务话边界提示 + 文档说明"在线浏览 vs 装到本地"区别；未来 clone-on-install 消除此边界 |

**未来升级（不阻塞本刀）**：
1. **clone-on-install**：官方能力在 repo-less 机器上 install 时自动 `git clone --depth 1` 仓库到 temp → 解析 capDir → install → cleanup。需 temp 管理与大仓库体积缓解（sparse-checkout）。本刀只铺元数据解析。
2. **repo-less-machine bundled release**：把 `node_modules` + runtime 打包成自足发行版，彻底脱离仓库在场。PLAN.md §22.13 "无仓库机器发行版留后续 Phase"。
3. **远程 `index.json` registry 演进**：PLAN.md §15 "registry.yaml 演进为远程 index.json" 的终态 = index.json 成为 install 的唯一解析源（registry.yaml 退居发布中间产物）。本刀是第一步（discover + 元数据），install 源码解析仍需仓库。
4. **趋势看板**：PLAN.md §22.12 "eval-history 趋势看板（随 v7 remote index.json 一起演进）"——index.json 未来可扩 eval-history 字段，静态站渲染趋势图。

---

## 相关文件路径（均以 `D:\XD\ClaudeCode\sy-eeo\` 为根）

- 现状关键文件：`tools/release.mjs`、`tools/inventory.mjs`、`tools/catalog-model.mjs`、`tools/catalog-server.mjs`、`tools/opsforge.mjs`、`tools/opsforge-catalog-launcher.mjs`、`install.mjs`、`tools/opsforge-runtime.mjs`、`tools/paths.mjs`、`tools/submit.mjs`（`assertPublicUrl` + `resolveGitRemote` 复用）、`tools/intake-remote.mjs`（`assertPublicUrl` 全套）、`web/catalog/`、`tools/opsforge-wording.test.mjs`。
- 本方案新增/改动：`tools/index-publish.mjs`（新）、`tools/index-fetch.mjs`（新）、`schema/index.schema.json`（新）、`tools/index-publish.test.mjs`（新）、`tools/index-fetch.test.mjs`（新）、`tools/install-remote-lookup.test.mjs`（新）、`tools/opsforge.mjs`（cmdDiscover 远程优先 + cmdCatalogFlow 分支 + PRINT_TOPICS）、`install.mjs`（readRegistryForInstall 远程回退）、`tools/opsforge-catalog-launcher.mjs`（host 白名单扩 github.io）、`tools/security-scan.mjs`（新 R33）、`tools/opsforge-wording.test.mjs`（WC5-WC7 + FORBIDDEN_RE 扩）、`.github/workflows/publish-index.yml`（新）、`.gitignore`（加 `web/catalog/dist/`）、`web/catalog/app.js`（静态模式）、`web/catalog/index.html`（徽章）、`web/catalog/styles.css`（徽章）、`templates/readme-template.zh.md`、`AGENTS.md`/`CLAUDE.md`。

---

## 第九部分：业务用户评审落地（v2 变更记录）

模拟业务用户评审裁决"不通过"→ 3 条必改 + 3 条建议，全部落地：

### MUST-FIX（必改，全部已落地）
1. **"把能力仓整个下到本地"对非技术用户是死路**（2.5 正文）→ 改为"联系团队管理员帮你装一次（只需一次）"，**不给用户做不到的指令**；移除空的"主菜单选…"占位；clone-on-install 留作未来 Phase（第八部分）。
2. **"git 地址"违反方案自己的禁用词表**（2.5 正文）→ 改为"来源网址"，第三方能力路径只说"主菜单选 2，粘贴来源网址即可"，不出现"git"字样；禁词表新增 `git address`/`git 地址`/`git URL`。
3. **repo-less + 远程未就绪 = 死路无兜底**（2.6 + 2.11 + discover 2.4）→ 补：远程打不开 + repo-less 时**不起浏览器** + **不提示选 8**（避免死循环），改打印"能力广场暂时打不开…稍后再试或联系团队管理员"；discover 同理，repo-less + 无网时不提示选 8。

### SUGGESTION（建议，全部采纳）
1. **catalog 网页 installHint 转业务话**（2.5）→ 明示"installHint 不在 catalog web 展示，只供 install 内部解析"；catalog 卡片用 `source.label`（"第三方"）已是业务话，不裸露 git URL。
2. **提交后闭环时间线**（痛点 #4）→ 补业务话"运营团队会审核，通过后约 2 分钟内全员能在目录看到"，让业务用户对等待有预期。
3. **discover repo-less + 无网不提示选 8**（2.4）→ 已并入 MUST-FIX #3 落地。

---

*本方案 v2 经业务用户评审 3 必改全部落地，守住 OpsForge 所有硬不变量。远程索引解决"发现"与"元数据解析"；"安装源码"仍需仓库或来源网址（边界明示、业务话、不给做不到的指令）；是"repo-less-machine bundled release"的前置第一步。*
