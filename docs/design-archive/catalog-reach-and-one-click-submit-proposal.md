# 设计方案：能力目录触达（痛点 A）+ 一键提交到能力仓（痛点 B）

> 状态：proposal-v2（业务用户评审已通过，待 architect 出技术方案）  
> 日期：2026-08-06  
> v2 变更：业务用户评审裁决"不通过"→ 4 条必改全部落地 + 5 条建议采纳 + 1 条技术准确性修正。  
> 前序：Phase 4 四刀已交付（532/532 绿、6 gates 全绿）。本刀针对两个业务用户 UX 痛点。  
> 硬不变量：零新 npm 依赖 / `additionalProperties:false` / `registry*.yaml` auto-gen / Windows 兼容 / CODEOWNERS+§B / R16–R31 不弱化 / 无 Go。

---

## 第零部分：业务用户文案守则（统领所有 user-facing 文案）

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

**深链可见性规则**：`http://127.0.0.1:<port>/...` 形式的完整 URL **只在 catalog server 正在运行时**作为终端可点击链接呈现；server 未运行时**只打印业务指引**"主菜单选 8"，绝不打印打不开的 URL 或相对路径串。

---

## 第一部分：现状确认（基于真实代码，附 `file_path:line`）

### 痛点 A ——"前端页面"确实存在，但完全未接入用户流程

1. **前端页面是真实存在的 web catalog**：`web/catalog/index.html`（零依赖静态 HTML，中文"OpsForge 能力目录"）、`web/catalog/app.js`（fetch `/api/catalog` + `/api/capabilities/<id>`，客户端 `escapeHtml`）、`web/catalog/styles.css`。
2. **HTTP server 存在且零依赖**：`tools/catalog-server.mjs` `startCatalogServer()`，默认 `127.0.0.1:4173`，CSP `default-src 'self'` + `nosniff`。数据源 `tools/catalog-model.mjs` `buildCatalogSnapshot()` 从 `buildInventory` 派生，**只暴露 `state==='released'` 的能力**，`publicEntry` 过滤敏感字段。
3. **入口现状：只有直接 `node tools/catalog-server.mjs`**。**未接入 `opsforge menu`**：`PRINT_TOPICS` 无 `catalog` topic；`cmdMenu` 7 选项里选项 7 路由到 `cmdDiscover({all:true})` 即 CLI 文本卡片；`opsforge.mjs` 全文 grep `catalog` 无命中。
4. **结论**：web 前端页面存在并已提交，但业务用户在 `opsforge menu`/wizard/discover/平台内使用能力时**完全感知不到它，也没有任何菜单项能启动它并打开浏览器**。这是痛点 A 的精确内核。

### 痛点 B ——"提交到 GitHub"对业务用户无任何非技术路径

1. **三态流本地路径**：`tools/new-capability.mjs` scaffold 落到 `packs/_drafts/<slug>/<name>/`；`promote()` 把 `_drafts/` → `_staged/`（仅本地）。`_staged/` → formal 需 `git mv` + `release.mjs --all`（无 shipped 工具）。
2. **唯一的"推送"线索是文本提示**：`tools/opsforge.mjs:53` `PRINT_TOPICS['push-reminder']` = `"📌 提醒：能力有改动后，记得推送云端仓库（或者让我帮你推）——不然团队其他人看不到。"` 在 `cmdNewFlow`/`cmdIntakeFlow`/`cmdWizard` 末尾 `printPushReminder()` 打印。**没有实际命令**。
3. **全仓库无 git 提交/PR/push 工具**：grep `git push|git commit|createPR|pullRequest|submit|gh\s` 在 `tools/` 下**零命中**。唯一 GitHub API 调用是 `tools/intake-remote.mjs` `fetchRemoteMeta()`——**只读 GET**，不写。
4. **install 侧下载路径已具备**：`install.mjs` `findCapabilitySource`/`installFromGit` 已支持从仓库/`--from-git` 安装。**缺口只在"本地草稿 → 中心仓库 PR"这一段**。
5. **结论**：业务用户用 wizard 在本地建了能力（落 `_drafts/`），要让别的用户能装，目前必须由懂 git 的人手动 commit/branch/PR。**痛点 B 的精确缺口 = 缺一个纯菜单式、零技术知识的 `submit` 机制，把本地草稿提交成中心仓库 PR**。

---

## 第二部分：痛点 A 方案——能力目录在用户使用流程中自然触达

### 用户故事（业务用户视角，v2 文案已净化）

1. 用户在 `opsforge menu` 看到新选项 **"8) 打开能力目录（浏览器，搜索/筛选全部能力）"**。选 8 → OpsForge 自动启动本地浏览器，打开目录页，展示全部已发布能力（带质量灯/平台适配/使用方式）。**用户全程不看 `127.0.0.1`/端口任何字眼**。
2. 用户在平台里跑某个已装能力时，安装完成确认消息末尾显示：
   - 若 catalog server 正在运行：一行可点击链接 `查看这能力的详情（目录）`（终端可点开直达详情页）。
   - 若 server 未运行：只打印 `想看这能力的详情？主菜单选 8 打开能力目录`。**绝不打印打不开的 URL**。
3. 用户跑 `opsforge discover`（已装清单）时，每条能力后追加 **`（主菜单选 8 可看详情）`**——纯业务指引，不出现 URL/路径串。
4. 选 8 后，OpsForge 在后台起 catalog server，打印 `已打开能力目录，浏览器应该已经弹出来了。看完按回车回到主菜单。`；用户**按回车**回到主菜单，OpsForge 内部 `server.close()` 关掉 server。**不让用户 Ctrl+C**（Windows 下 Ctrl+C 会杀整个 OpsForge 进程）。

### 涉及改动

- **`tools/opsforge.mjs`**（steering-owned）：
  - `PRINT_TOPICS` 新增 `'catalog-hint'`（固定文案，遵守第零部分守则）。
  - 顶层菜单 `PRINT_TOPICS['menu']` 追加 `  8) 打开能力目录（浏览器，搜索/筛选全部能力）`，`0) 退出` 下移。
  - `cmdMenu` switch 加 `case '8': await cmdCatalogFlow(rl, opts); break;`。
  - 新增 `cmdCatalogFlow(rl, opts)`：动态 import `./catalog-server.mjs` `startCatalogServer({port:0, host:'127.0.0.1', repoRoot: workDir})`；**从返回值的 `server.address().port` 读取实际端口**（见第六部分技术修正）；打印业务话 URL 给 `openInBrowser`；spawn 子进程（`unref()`）或浏览器打开后，`await ask('按回车回到主菜单…')`，返回前 `server.close()`。
  - `cmdDiscover` 每行追加 `（主菜单选 8 可看详情）`（业务指引，无 URL）。
  - `promptInstallFlow` 安装成功后：按"深链可见性规则"分支打印（server 在跑→可点击链接；未跑→业务指引）。
  - `cmdIntakeFlow`/`cmdNewFlow`/`cmdWizard` 末尾 `printPushReminder()` 改为 `printSubmitHint()`（指向痛点 B 的"主菜单选 9 一键提交"）+ `printCatalogHint()`。
- **`tools/catalog-server.mjs`**（steering-owned）：
  - `startCatalogServer` 已支持 `port:0`（OS 分配），但**返回值是 `{server, snapshot}`，不含 port**——调用方 `cmdCatalogFlow` 须自行 `server.address().port` 读取。本方案不改 `startCatalogServer` 返回结构（避免破现有测试），只确保 `cmdCatalogFlow` 正确读取。
  - 不改 CSP / 不改路由（已安全）。
- **新文件 `tools/opsforge-catalog-launcher.mjs`**（steering-owned）：`openInBrowser(url)` 跨平台 spawn（Windows `cmd /c start "" <url>`、mac `open`、linux `xdg-open`，argv 形式，URL 经 `new URL` 校验必须 `http://127.0.0.1`，防注入；失败只打印 URL 不报错）。
- **测试**：`tools/opsforge-catalog-launcher.test.mjs`（mock spawn，断言 argv + URL 校验 + 平台分派）；扩 `tools/catalog-server.test.mjs` 加"port:0 + `server.address().port` 读取"用例；`cmdCatalogFlow` 的"按回车关闭 server"流程测试。

### 数据流

```
opsforge menu → 选 8 → cmdCatalogFlow
  → startCatalogServer(port:0, 127.0.0.1) → buildCatalogSnapshot(buildInventory)
  → const port = server.address().port   ← 技术修正点
  → 打印业务话（不含端口语） + openInBrowser(http://127.0.0.1:port)
  → await ask('按回车回到主菜单…')
  → server.close() → 回主菜单
安装成功/discover → 按深链可见性规则打印业务指引（不裸露 URL）
```

### 硬不变量核对

| 不变量 | 影响 |
|---|---|
| 零新 npm 依赖 | 用 Node 内置 `http`/`child_process`/`url`，无新增 |
| additionalProperties:false | 不触能力 schema |
| registry auto-gen | 不触 registry |
| Windows 兼容 | `start` argv + port:0 + 按回车（非 Ctrl+C） |
| CODEOWNERS/§B | tools/ steering-owned，catalog server 已有 CSP+nosniff+127.0.0.1 绑定 |
| R16–R31 | 不触 |

### 风险与替代

- **风险**：后台 server 生命周期。**缓解**：`cmdCatalogFlow` 用"按回车→`server.close()`"模型，不让用户 Ctrl+C；spawn 浏览器命令 detach 不阻塞菜单。
- **风险**：深链在 server 未跑时打不开。**缓解**：深链可见性规则强制——未跑时只给业务指引。
- **替代（不推荐）**：一次性生成静态 HTML 快照文件再 `open`——会丢动态详情，且引入 `~/.opsforge/` 临时文件管理负担。

---

## 第三部分：痛点 B 方案——一键提交本地草稿到能力仓（v2：贡献码 + 纯菜单）

### 授权模型决策（v2 核心）

**废弃**：业务用户自己申请 GitHub PAT（`repo` 权限）——评审必改 #1，技术词+安全风险双爆，且这些用户连 GitHub 账号都没有。

**采用**：**贡献码（Contributor Code）模型**
- 由 **steering/团队管理员**（懂 GitHub 的人）在 GitHub 为每个贡献者签发一张 **fine-grained PAT**：仅授权 OpsForge 仓库、仅 `Contents: Read and Write` + `Pull requests: Read and Write`、无管理/删除/设置权限、设过期时间。
- 管理员把这张 PAT 作为"**贡献码**"发给业务用户（线下/IM 均可，业务用户只需知道"这是一串贡献码"）。
- 业务用户首次选 9 时，OpsForge 提示 `首次使用：请联系团队管理员领取『贡献码』，粘贴在下面（只需一次）：`，用户粘贴一串码，OpsForge 存 `~/.opsforge/submit-token.json`（0600，不进 git），后续免输。
- 业务用户**全程不碰 GitHub、不登录 GitHub、不见 PAT/Settings/Developer settings/repo 任何词**。

**为什么不用 OAuth 设备流**：OAuth 设备流要求用户**登录自己的 GitHub 账号**再点 Authorize——但本方案目标用户"不知道 GitHub 是什么"，大概率没有可登录的 GitHub 账号。贡献码模型把 GitHub 侧操作完全收敛到管理员，业务用户只做"粘一串码"这个业务动作，是真正贴合该画像的方案。OAuth 设备流作为**未来升级**（见第七部分）记录，待 contributors 普遍有 GitHub 账号时启用。

**安全侧**：贡献码是 repo-scoped fine-grained PAT，即便泄露也只能动这一个仓库的 contents/PR、无管理权，blast radius 远小于 `repo`-scoped classic PAT；存 `~/.opsforge/`（仓库外）+ 0600 + 新 R32 扫泄露 + `.gitignore` 明示。

### 用户故事（业务用户视角，v2 文案已净化）

1. 用户用 wizard 建好能力（`packs/_drafts/<slug>/<name>/`），填完 `__FILL_ME__`，回主菜单选 **"9) 提交我的能力到能力仓（让其他人能下载）"**。
2. OpsForge 列出本地 `_drafts/` 下所有草稿，**每条显示 `能力名 + 类型 + 最后修改时间 + 是否还有未填项`**（建议 #1，避免选错）。用户选一个。
3. OpsForge 自动跑本地预检：`validate.mjs`（§A）+ `security-scan.mjs`（§B）+ `test-runner.mjs`（static-only）。任何阻断项直接红灯 + **业务话修复指引**（复用 `report-renderer.mjs` 中文红绿灯，禁吐 `R16/skeleton_guard/additionalProperties` 这类 rule id——建议 #2），不提交。
4. 预检绿后：
   - 若 `~/.opsforge/submit-token.json` 不存在/失效 → 提示 `首次使用：请联系团队管理员领取『贡献码』，粘贴在下面（只需一次）：`，用户粘贴贡献码，OpsForge 存盘 0600。
   - 若已存在 → 直接进下一步。
5. OpsForge 自动：在中心仓库创建提交分支 → 上传草稿文件 → 开提交。**用户全程只见"正在提交…"**。
6. 完成后打印：
   `✅ 已提交！提交进度页：<可点击链接>`
   `运营团队会审核，通过后其他人就能在主菜单选 2 装到他们电脑。`
   （文案遵守守则：无 PR/branch/commit/install/steering/CI 词。）
7. 审核未过时：用户**回主菜单选 9 → 选同一个草稿**（不敲命令——必改 #3）→ OpsForge 自动检测"发现你之前已提交过这个能力，已更新原提交"，force-update 原 PR + 追加评论，不新建。审核意见反馈全程只说"审核意见"，不出现 CI/review/bot（必改 #2）。

### 涉及改动

- **新文件 `tools/submit.mjs`**（steering-owned）——核心：
  - `export async function submit({draftDir, repoRoot, token, gitRemote})`：
    1. `assertDraftUnder(draftDir)`（必须在 `packs/_drafts/` 或 `customers/<brand>/packs/_drafts/` 下，防路径穿越）。
    2. 跑本地预检：动态 import `./validate.mjs` + `./security-scan.mjs` + `./test-runner.mjs`（`OPSFORGE_RUNNER=static-only`），三报告需 pass/pending；阻断则抛错带**业务话**修复指引。
    3. 读 `~/.opsforge/submit-token.json`（首次由 `cmdSubmitFlow` 交互写入 0600）。
    4. 解析中心仓库 `gitRemote`（默认 `execFileSync('git',['config','--get','remote.origin.url'])` argv 形式，复用 `intake-fetch.mjs` shell-metachar 拒绝思路）。
    5. 用 Node 内置 `fetch` 调 GitHub API（`api.github.com`，`Authorization: Bearer <token>`）：取 base SHA → 建分支 → 上传 tree+commit → 开 PR；同名分支已有 open PR 则 force-update ref + 追加评论不重开。
    6. 返回 `{ prUrl, branch, commitSha }`。
  - SSRF/安全：GitHub API host 硬编码 `api.github.com`，不接用户输入 host；token 存 `~/.opsforge/`；路径校验防 `..`；提交内容进 PR 前由本地 §B 扫（CI 再扫）。
- **`tools/opsforge.mjs`**：
  - `PRINT_TOPICS` 加 `'submit-flow'` + `'submit-hint'` + `'catalog-hint'`（全遵守第零部分守则）。
  - 菜单 `PRINT_TOPICS['menu']` 加 `  9) 提交我的能力到能力仓（让其他人能下载）`。
  - `cmdMenu` switch 加 `case '9': await cmdSubmitFlow(rl, opts); break;`。
  - 新增 `cmdSubmitFlow(rl, opts)`：`listDrafts()` → 选 → 跑 `submit()` → 渲染结果（复用 `report-renderer.mjs` 绿/红 oneLiner，业务话）。
  - `cmdNewFlow`/`cmdWizard` 末尾 `printPushReminder()` 升级为 `printSubmitHint()`："建好了？回主菜单选 9 一键提交到能力仓。"
  - **CLI `opsforge submit <dir>` 仅作为高级用户可选入口**，业务用户路径是菜单选 9，文档/提示只引导菜单（必改 #3）。
- **`tools/paths.mjs`**：加 `listDrafts(repoRoot)`（扫 `packs/_drafts/*/` + `customers/*/packs/_drafts/*/`，返回 `{slug,name,kind,path,mtime,hasFillMe}`）；加 `submitTokenPath()` → `~/.opsforge/submit-token.json`。
- **`tools/security-scan.mjs`**：新增 §B 规则 `R32_submit_no_secret_in_token_file`（同级新增，R16–R31 不弱化）：确保仓库内不得出现贡献码/PAT 字面（复用现有 hardcoded-secrets 引擎扫 `tools/`+`packs/`，`~/.opsforge/` 本就在仓库外）。
- **`.gitignore`**：加 `submit-token.json` 注释行明示（`~/.opsforge/` 已在仓库外，但明示防误建）。
- **测试**：`tools/submit.test.mjs`（mock `fetch` + mock `execFileSync`，断言分支名/PR body/三报告预检门/贡献码读取错误处理/路径穿越拒绝/同名分支更新而不新建）；`tools/opsforge-catalog-launcher.test.mjs`。
- **文档**：`templates/readme-template.zh.md` 加一段"如何发布：主菜单选 9"；新增 `docs/contributing/contributor-code-guide.md`（面向**管理员**的贡献码签发指南，中文，含 fine-grained PAT 逐步图示——此文档面向管理员非业务用户，可含技术词）。

### 数据流

```
opsforge menu → 选 9 → cmdSubmitFlow
  → listDrafts()（带 能力名/类型/mtime/hasFillMe）→ 用户选 <draft>
  → 预检 validate + security-scan + test-runner(static-only)
    ├─ 阻断 → report-renderer 业务话红灯 + 修复指引 → 返回菜单
    └─ 通过 → 读 ~/.opsforge/submit-token.json
         ├─ 不存在 → 提示"找管理员领贡献码粘贴一次"→ 写 0600
         └─ 存在 → submit()
              → git config --get remote.origin.url（argv）
              → fetch api.github.com: 建分支/上传/开 PR（同名则更新）
              → 返回 {prUrl}
  → 打印 ✅ 提交进度页链接 + "运营团队审核通过后别人可在主菜单选 2 装到他们电脑"
```

中心侧闭环：PR → CI 跑 validate+security+eval（既有 3-report gate）→ 运营团队 review → merge → `release.mjs` 在 CI 重建 `registry.yaml` → 别人 `opsforge install <id>` 或主菜单选 8 目录看到新能力。

### 硬不变量核对

| 不变量 | 影响 |
|---|---|
| 零新 npm 依赖 | 用 Node 内置 `fetch`/`child_process`/`fs` |
| additionalProperties:false | 不触能力 schema（submit 元数据在 `~/.opsforge/`） |
| registry auto-gen | submit 只开 PR，不碰 `registry*.yaml`；merge 后 CI 由 `release.mjs` 重建 |
| Windows 兼容 | `execFileSync('git', argv)` 全 argv；fetch 跨平台 |
| CODEOWNERS/§B | `tools/submit.mjs` steering-owned；PR 经 CI §B 扫；本地预检先跑 §B；新 R32 |
| R16–R31 不弱化 | 不触 R-rules，新增 R32 同级 |
| 无 Go | 纯 Node |

### 风险与替代

- **风险**：贡献码泄露。**缓解**：repo-scoped fine-grained PAT（仅 Contents+PR 写，无管理权）限制 blast radius；存 `~/.opsforge/` 0600 + R32 扫 + `.gitignore` 明示；管理员可设过期 + per-contributor 签发便于吊销。
- **风险**：贡献码过期/被吊销。**缓解**：`submit()` 检测 401/403 → 提示"贡献码可能已过期，请联系团队管理员重新领取"，不重试不报技术错。
- **风险**：多个贡献者分支名冲突。**缓解**：分支名带 `<slug>-<name>-<hash前8>` + 同名分支 open PR force-update 不重开。
- **风险**：提交恶意能力。**缓解**：本地 §B 预检 + CI §B 再扫（非可例外项 prompt-injection/SSRF/supply-chain）+ 运营团队 PR review；third-party 走 `_drafts/third-party/` 隔离。
- **风险**：草稿未 `--promote` 到 `_staged/`。**决策**：submit 直接提交 `_drafts/` 内容到 PR；promete 时机由运营团队在 merge 前决定（守住"promote 是人工 gate"原则）。
- **未来升级（不阻塞本刀）**：OAuth 设备流（contributors 有 GitHub 账号时，自助授权，无需管理员签发）；或中心侧 submission service（完全代提交，业务用户连贡献码都不用）。见第七部分。

---

## 第四部分：slice 切分（P0/P1/P2，每个独立可交付可测）

### Slice A1（P0，痛点 A 核心）——菜单接入 catalog server
- 文件：`tools/opsforge.mjs`（菜单选项 8 + `cmdCatalogFlow` 含 `server.address().port` 读取 + 按回车 `server.close()` + `PRINT_TOPICS['catalog-hint']`）、`tools/opsforge-catalog-launcher.mjs`（新）、`tools/opsforge-catalog-launcher.test.mjs`（新）、`tools/catalog-server.test.mjs`（扩 port:0 + port 读取断言）。
- 验收：`opsforge menu` 选 8 启动 server + 打开浏览器 + 按回车关 server 回菜单；业务话文案无端口语；bare `node --test` 绿；6 gates 不变。

### Slice A2（P1，痛点 A 联动）——使用流程内业务指引触达
- 文件：`tools/opsforge.mjs`（`promptInstallFlow` 按深链可见性规则分支打印、`cmdDiscover` 每行加"（主菜单选 8 可看详情）"、`cmdNewFlow`/`cmdWizard`/`cmdIntakeFlow` 末尾 `printCatalogHint()`）。
- 验收：安装成功/discover 输出含业务指引，**无裸露 URL/路径串**；bare `node --test` 绿。

### Slice B1（P0，痛点 B 核心）——`opsforge submit` 贡献码 + 纯菜单
- 文件：`tools/submit.mjs`（新，`submit()` + GitHub API via Node fetch + 贡献码读取）、`tools/opsforge.mjs`（菜单选项 9 + `cmdSubmitFlow` 首次引导贡献码 + `PRINT_TOPICS['submit-flow'/'submit-hint']` + `printSubmitHint` 替换 `printPushReminder`）、`tools/paths.mjs`（`listDrafts` 带 mtime/hasFillMe + `submitTokenPath`）、`tools/submit.test.mjs`（新，mock fetch + execFileSync + 贡献码读取 + 路径穿越拒绝）。
- 验收：`opsforge menu` 选 9 → 选 draft（列表含能力名/类型/mtime/hasFillMe）→ 预检 → 首次引导贡献码（业务话，无 PAT 词）→ 开 PR → 打印业务话结果；token 0600 不进 git；bare `node --test` 绿；6 gates 不变。

### Slice B2（P1，痛点 B 安全与闭环）——§B 加固 + 同名分支更新
- 文件：`tools/security-scan.mjs`（新 R32_submit_no_secret_in_token_file，同级新增）、`tools/submit.mjs`（同名分支 open PR 检测 → force-update + 评论不重开 + 401/403 过期提示）、`tools/submit.test.mjs`（扩同名分支更新 + 过期提示用例）、`.gitignore`（明示 `submit-token.json`）、`docs/contributing/contributor-code-guide.md`（新，管理员向）。
- 验收：R32 扫描 0 findings；同名 draft 重复 submit 更新原 PR；过期 token 友好提示；bare `node --test` 绿（含新 R32 fixture）。
- **体验增强（评审非阻塞建议，纳入 B2）**：`cmdSubmitFlow` 检测同名分支 open PR 有 review comments → `fetch` PR comments → **业务话摘要打印**（"运营团队的意见：…请改某某处"），不让业务用户点"提交进度页"链接去 GitHub PR 页看（那里满屏 Pull request/Commits/Checks/Files changed 技术词）。实现为可选增强，不阻塞 B1。

### Slice AB（P2，两痛点联动 + 文档）——提交后指向目录、目录显示"社区贡献"
- 文件：`tools/opsforge.mjs`（`cmdSubmitFlow` 成功后 `printCatalogHint()` 指向目录）、`web/catalog/app.js`（卡片加"社区贡献"徽章，读 `entry.sourceOrigin`/`pack==='third-party'`，数据已有不动 schema）、`templates/readme-template.zh.md`（"发布：主菜单选 9"段）、`AGENTS.md`/`CLAUDE.md` 现状段更新。
- 验收：submit 成功消息含目录业务指引；catalog 卡片对 third-party 显示"第三方/社区"标签；bare `node --test` 绿。

---

## 第五部分：测试策略

- **单元**：`tools/opsforge-catalog-launcher.test.mjs`（平台分派 spawn argv + URL 校验）、`tools/submit.test.mjs`（mock fetch 断言 GitHub API 序列 + 贡献码读取 + 路径穿越拒绝 + 同名分支更新 + 过期提示）、`tools/catalog-server.test.mjs` 扩 port:0 + `server.address().port` 读取断言。
- **CLI argv 路径**（MEMORY 强制）：`opsforge print catalog-hint`/`submit-hint`、`opsforge menu` 选 8/9 的 spawn 测试（mock `startCatalogServer`/`submit` 避免真网络）。
- **文案守则测试**：新增测试断言 `PRINT_TOPICS` 各业务文案不含禁用词（第零部分词典正则扫），防止回归。
- **集成**：`submit.mjs` 跑本地预检（真 `validate.mjs`/`security-scan.mjs` 对 fixture draft）、catalog-server 真起 port:0 + `fetch /api/catalog`。
- **硬不变量 gate**：bare `node --test` 必绿；6 gates exit 0；`additionalProperties:false` 不变；`package.json` 无新依赖（CI `deps-change` 标签不触发）。

---

## 第六部分：技术准确性修正（评审附注）

评审指出：`tools/catalog-server.mjs` `startCatalogServer` 当前返回 `{server, snapshot}`，**未返回实际端口**。本方案原文"port:0 兜底返回实际端口（已有）"不准。修正：**不改 `startCatalogServer` 返回结构**（避免破现有测试），改由 `cmdCatalogFlow` 在拿到 `{server, snapshot}` 后自行 `server.address().port` 读取实际端口。`tools/catalog-server.test.mjs` 扩一条断言验证此读取路径。

---

## 第七部分：风险总览与未来升级

| 风险 | 等级 | 缓解 |
|---|---|---|
| catalog server 生命周期阻塞菜单 | 中 | "按回车→`server.close()`"模型，不让用户 Ctrl+C |
| 贡献码泄露 | 中 | repo-scoped fine-grained PAT + 0600 + R32 + `.gitignore` + 可过期可吊销 |
| 贡献码过期/吊销 | 低 | 401/403 → 业务话提示重新领取，不报技术错 |
| 提交恶意/低质能力 | 中 | 本地 §B 预检 + CI §B 再扫 + 运营团队 review + third-party 隔离 |
| 同名 PR 冲突 | 低 | 分支带 hash + open PR force-update |
| catalog 暴露未发布草稿 | 低 | `catalog-model.mjs` 已只过滤 `released` |
| Windows spawn 浏览器失败 | 低 | 失败只打印业务指引不报错 |

**未来升级（不阻塞本刀，记录待后续）**：
1. **OAuth 设备流自助授权**：待 contributors 普遍有 GitHub 账号，steering 注册 GitHub OAuth App（client_id 入配置非密），业务用户选 9 后浏览器弹 GitHub 授权页点 Authorize 即可，无需管理员签发贡献码。零新依赖（Node fetch 跑 device flow）。
2. **中心侧 submission service**：完全代提交，业务用户连贡献码都不用，只上传草稿。需后端基建，超出本刀。

---

## 第八部分：成功标准

- [ ] `opsforge menu` 选 8 启动 catalog server + 自动开浏览器 + 按回车关 server 回菜单；业务话文案无端口语。
- [ ] 安装成功/discover 输出**只含业务指引**（"主菜单选 8"），无裸露 URL/路径串；深链可见性规则生效。
- [ ] `opsforge menu` 选 9 → 列草稿（含能力名/类型/mtime/hasFillMe）→ 预检 → 首次引导贡献码（业务话，无 PAT/Settings/repo 词）→ 开 PR → 打印业务话结果（无 PR/branch/install/steering/CI 词）。
- [ ] 同名 draft 重复 submit 更新原 PR 而非新建；过期 token 业务话提示。
- [ ] **文案守则测试**：`PRINT_TOPICS` 各业务文案不含禁用词。
- [ ] bare `node --test` 全绿（532 + 新增）；6 gates exit 0；零新 npm 依赖；`additionalProperties:false` 全保留；`registry*.yaml` 仍 auto-gen；R16–R31 不弱化 + R32 同级新增。
- [ ] 业务用户全程只做"选菜单 + 选草稿 + 粘一次贡献码"，不碰 GitHub/git/命令行。

---

## 相关文件路径

- 现状关键文件：`web/catalog/`、`tools/catalog-server.mjs`、`tools/catalog-model.mjs`、`tools/opsforge.mjs`、`tools/new-capability.mjs`、`tools/intake-remote.mjs`、`install.mjs`、`tools/paths.mjs`。
- 本方案新增/改动：`tools/opsforge.mjs`、`tools/catalog-server.mjs`（仅测试扩）、`tools/opsforge-catalog-launcher.mjs`（新）、`tools/opsforge-catalog-launcher.test.mjs`（新）、`tools/submit.mjs`（新）、`tools/submit.test.mjs`（新）、`tools/paths.mjs`、`tools/security-scan.mjs`（新 R32）、`tools/catalog-server.test.mjs`、`templates/readme-template.zh.md`、`.gitignore`、`docs/contributing/contributor-code-guide.md`（新，管理员向）、`web/catalog/app.js`（P2 徽章）。

---

*本方案 v2 经业务用户评审 4 必改全部落地，守住 OpsForge 所有硬不变量。两痛点各自有独立可交付的 P0 slice（A1 / B1），通过 AB slice 联动。不引入新依赖、不引 Go、不改 registry 手写、不弱化 R16–R31、对业务用户真正零技术知识。*
