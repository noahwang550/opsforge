# 第三方能力收录（intake）

> 本文档说明 `install_hint` 字段格式与 reference-scope 收录流程。

## install_hint 字段格式

`upstream-ref.json` 的 `install_hint` 字段（P1-B 新增，可选，`["string","null"]`）记录 reference-scope 能力的安装来源：

```
<git>;<kind>;<name>[;<subpath>]
```

- `<git>`：https git URL（如 `https://github.com/foo/bar.git`）
- `<kind>`：能力类型（`agent` / `skill` / `mcp` / `workflow` / `bundle`）
- `<name>`：能力名 slug（如 `code-reviewer`）
- `<subpath>`（可选）：repo 内子路径，默认 repo 根 `<kind>/<name>/`

示例：
- `https://github.com/upstream/pkg.git;agent;gitbot`
- `https://github.com/foo/bar.git;skill;analyzer;packages/analyzer`

## reference-scope 收录

reference-scope（`intake_scope: 'reference'`）只存 git 地址 + 元数据，不克隆整个 repo。收录时走 `intake.mjs --scope reference`：

1. `fetchRemoteMeta(url)` 用 GitHub API（`/repos/.../license` + `/repos/.../commits/HEAD`）或 `git ls-remote` 取 license + commit sha。
2. 不 clone，不应用 50MB 上限。
3. `upstream-ref.json` 写 `intake_scope: 'reference'` + `install_hint: '<git>;<kind>;<name>'`。

## install --from-git

reference-scope 能力安装时走 `install.mjs --from-git <url> --kind <kind> --name <name>`：

1. `installFromGit` clone-to-temp（复用 `fetchUpstream` 的 SSRF 守卫 + 50MB 上限 + argv 形式）。
2. 在 temp 内找 `<kind>/<name>/capability.yaml`。
3. 调 `install({ capDir })` 装到目标平台。
4. cleanup temp。

## SSRF 守卫

reference-scope 只存 URL 不 clone，但仍过 `assertPublicUrl` 全套守卫：
- https-only
- shell-metachar 拒绝
- 私网段拒绝（127/10/172.16/192.168/169.254/::1 等）
- DNS rebinding 拒绝（hostname 解析到私网段）
