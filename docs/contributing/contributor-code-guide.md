# 贡献码签发指南（面向团队管理员）

> 本文档面向 **团队管理员**（懂 GitHub 操作的人），**不对业务用户公开**。
> 业务用户（无开发背景）只做"粘贴一次贡献码"这一个动作，全程不碰 GitHub。

## 什么是贡献码

贡献码是一张 **GitHub fine-grained Personal Access Token (PAT)**，由管理员在 GitHub 为每位贡献者签发。业务用户拿到后粘贴到 OpsForge 一次，后续就能用"主菜单选 9"一键提交能力草稿到中心仓库。

## 签发步骤（管理员操作）

1. 打开 GitHub 仓库 → **Settings** → **Developer settings** → **Fine-grained tokens** → **Generate new token**。
2. **Resource owner**：选择 OpsForge 所在的 GitHub 账号/组织。
3. **Repository access**：选 **Only select repositories** → 选中 OpsForge 能力仓库（只授权这一个仓库）。
4. **Permissions**：
   - **Contents**: Read and Write（提交草稿文件到分支）
   - **Pull requests**: Read and Write（开提交、追加评论、读审核意见）
   - 其他权限一律不勾（无管理/删除/设置/Actions/Workflows 权限）。
5. **Expiration**：建议设 90 天，到期前提醒贡献者重新领取。
6. 生成后复制 token（`github_pat_` 开头的一串）。

## 分发与吊销

- **分发**：线下/IM 把贡献码发给对应业务用户即可。业务用户只需知道"这是一串贡献码"。
- **吊销**：贡献者离职/转岗 → GitHub Settings → Fine-grained tokens → Revoke 该 token。
- **per-contributor 签发**：建议每人一张，便于独立吊销，互不影响。

## 安全约束（OpsForge 侧已落地）

- 贡献码只存 `~/.opsforge/submit-token.json`（0600，仓库外，绝不进 git）。
- `.gitignore` 明示 `submit-token.json`。
- OpsForge §B 新增 R32 规则 `scanRepoForSubmitSecrets`：扫 `tools/`+`packs/`+`templates/`+`web/`+`docs/`，仓库内出现 `github_pat_` 字面立即 block。
- GitHub API host 硬编码 `api.github.com`（业务用户无法注入任意 host）。
- token 只在 `Authorization: Bearer` 头，不进 URL/body/日志。
- 过期/吊销（401/403）→ OpsForge 打印"贡献码可能已过期，请联系团队管理员重新领取"，不报技术错。

## 未来升级（不阻塞当前）

待 contributors 普遍有 GitHub 账号后，可改用 OAuth 设备流自助授权，业务用户无需管理员签发贡献码。需要 steering 注册 GitHub OAuth App（client_id 入配置非密）。当前贡献码模型把 GitHub 侧操作完全收敛到管理员，是贴合"不知道 GitHub 是什么"用户的方案。
