# Windows / macOS 构建与发布

开发者：**NingMeng123**。发布工作流为 [release.yml](../.github/workflows/release.yml)，仓库为 [CampusLink](https://github.com/65658dsf/CampusLink)。

## 触发方式

| 事件 | 执行内容 |
| --- | --- |
| 推送 `main`、面向 `main` 的 PR | Linux 单元测试、发布脚本测试、类型检查和界面构建；不发布安装包 |
| 推送 `v*` 标签 | 校验标签与版本，再构建全部平台并统一创建 Release |
| 手动 Run workflow | 必须选择 `main`，输入已存在的版本标签；执行相同的完整发布流程 |

正式标签采用 `v主版本.次版本.修订版本`，例如 `v1.1.0`，当前流程不接受预发布后缀、分支名、任意 SHA 或 Git 修订表达式。标签指向的提交必须可以从远程 `main` 到达；标签版本必须与该提交的 `package.json.version`、`package-lock.json.version` 和锁文件根包版本全部一致。后续任务固定检出通过校验的提交，不使用构建期间可能变化的分支头。

## 发布一个新版本

1. 更新版本并完成代码检查，例如在项目目录执行 `npm version 1.1.0 --no-git-tag-version`。此命令只更新清单与锁文件，不生成标签。
2. 运行 `npm ci`、`npm test`、`npm run test:release`、`npm run build`；在 Windows 上再运行 `npm run test:desktop`。桌面检查仅使用本机模拟认证服务器。
3. 将变更提交并合入 `main`，推送代码，确认常规 CI 通过。
4. 在对应提交创建标签并推送该标签：

```text
git tag -a v1.1.0 -m "Campus Link v1.1.0"
git push origin v1.1.0
```

标签推送由开发者主动执行。工作流不会自行提交代码、改版本或生成标签。GitHub 内置 `GITHUB_TOKEN` 创建的事件通常不会触发另一个工作流；日常发布应由维护者正常推送标签，或使用手动触发入口。[GitHub 事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

## 构建与发布分工

Linux 校验通过后，以下三个原生 runner 并行构建：

| 系统与架构 | Runner | 安装产物（以 1.1.0 为例） |
| --- | --- | --- |
| Windows x64 | `windows-latest` | `Campus-Link-Setup-1.1.0.exe`，NSIS 安装程序 |
| Intel Mac x64 | `macos-15-intel` | `Campus-Link-1.1.0-mac-x64.dmg`、同名 `.zip` |
| Apple Silicon arm64 | `macos-15` | `Campus-Link-1.1.0-mac-arm64.dmg`、同名 `.zip` |

架构显式写入矩阵与 macOS 文件名，避免不同架构互相覆盖。macOS runner 名称依据 GitHub 的架构列表选择，而不是假定 `macos-latest` 始终为 Intel。[GitHub runner 规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

所有打包调用均带 `--publish never`。矩阵任务只有 `contents: read`，只上传本次运行的 Actions artifact；Windows 任务在打包前运行桌面集成检查。所有平台成功后，独立 `publish` 任务才获得 `contents: write`，通过 `GH_TOKEN: ${{ github.token }}` 调用 GitHub CLI。无需配置个人访问令牌，令牌不写入配置文件。

发布前再次核对远程标签指向，校验五个安装文件及其版本、架构、源码提交记录。发布任务先创建草稿，上传全部产物后才公开；上传中途失败留下草稿。发布资产还包含：

- `build-info.json`：版本、源码提交、各架构签名及公证步骤状态。
- `SHA256SUMS.txt`：五个安装文件和 `build-info.json` 的 SHA-256。

发布时优先使用对应版本的 `docs/releases-v版本号.md`，例如 [v1.1.2 发布说明](releases-v1.1.2.md)，并附加本次构建的实际签名状态。没有对应文件时使用 GitHub 自动生成的变更记录及默认平台说明。

同一版本的推送与手动运行使用相同并发组，避免两个发布任务竞争。已公开的版本禁止覆盖；需要修改代码时增加版本号，不要移动已发布标签。

## 可选的 Apple 签名与公证

未配置任何 Apple secrets 时，构建设置 `mac.identity: null`、`CSC_IDENTITY_AUTO_DISCOVERY=false`，并关闭公证。这一默认路径不需要 Apple Developer 账号，但产物是**未签名、未公证**的应用。Release 说明和构建记录会明确标注，不会将打包成功描述为已获 Apple 信任。

如需签名，在仓库 Settings → Secrets and variables → Actions 设置：

| Secret | 用途 |
| --- | --- |
| `MAC_CSC_LINK` | 导出的 Developer ID Application `.p12` 证书的 Base64 内容；不要将证书提交到仓库 |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码；证书确实无密码时可以为空 |
| `APPLE_ID` | 用于公证的 Apple 账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 对应的 App 专用密码，不是 Apple 账号的日常登录密码 |
| `APPLE_TEAM_ID` | 证书所属 Apple Developer 团队 ID |

工作流将前两项映射为 electron-builder 的 `CSC_LINK`、`CSC_KEY_PASSWORD`。只有证书时启用强制代码签名，但不公证；同时提供全部三个 Apple 公证字段时启用公证。公证字段仅填一部分、或没有证书却配置公证时，任务会失败并提示配置不完整，不会静默降级。证书无效、签名或公证失败也会阻止 Release 公开。

秘密仅注入 macOS 打包步骤，不传给 Linux 单元测试、Windows 构建或 Release 说明。请使用适合直接分发的 **Developer ID Application** 证书，而不是 Mac App Store 证书。实现采用锁定依赖版本支持的 `mac.identity`、`mac.notarize` 配置；升级 electron-builder 后应重新核对配置接口。[electron-builder 官方签名说明](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/code-signing-mac.md)

Windows 当前没有配置开发者代码签名，系统可能显示未知发布者或 SmartScreen 提示。此工作流不包含 Windows 证书签名设置。

## macOS 验证范围

在 macOS runner 生成 DMG/ZIP，只验证构建和可选签名、公证步骤。当前工作环境为 Windows，尚未在 Mac 真机完成校园认证、钥匙串密码保存、托盘行为、安装卸载和登录项验收。发布说明保留这一限制，不把这些功能标成已实测。

未签名或未公证的应用可能被 Gatekeeper 拦截，也可能无法注册开机自启动。用户应先核对下载来源，在系统提示允许的范围内处理；不建议关闭 Gatekeeper 或全局降低安全设置。安装后请将应用放入“应用程序”并从那里运行，再测试系统“登录项”。即使应用内设置调用没有抛错，也不能据此保证系统会启动它。

## 本地构建

使用 Node.js 22.12 或更新版本，CI 固定使用 Node.js 24。安装依赖后在对应系统运行：

```text
npm run dist:win
npm run dist:mac:x64
npm run dist:mac:arm64
```

`npm run dist:mac` 顺序构建两个 macOS 架构。Windows 的完整 NSIS 包在 Windows 构建，macOS 的 DMG 在 Mac 构建；脚本拒绝在错误平台上生成对应安装包。本地命令不会创建或上传 GitHub Release。macOS 默认同样为未签名；本地签名使用上述映射后的环境变量，秘密不要写进脚本、终端共享记录或版本库。

## 失败后恢复

- **版本或标签校验失败**：核对标签是否存在、是否属于 `main`、三个版本值是否相同。未发布的错误标签由维护者自行纠正；不要移动已发布版本。
- **平台构建失败**：查看失败 runner 的日志；发布任务不会运行，其它构建不会提前创建 Release。
- **网络或上传失败**：修复后重跑失败任务，或从 `main` 手动输入同一标签。未完成草稿允许重新上传；已公开版本不会被覆盖。
- **签名配置失败**：检查证书类型、密码和公证字段是否齐全。不准备签名时移除相关 secrets，工作流会明确生成未签名版本。
- **artifact 已过期**：Actions 构建附件保留 14 天，过期后须重新执行整套发布构建；已上传的 Release 资产不受这一临时保留期影响。

流程使用官方 checkout/setup-node/upload-artifact/download-artifact Actions。Release 操作通过 `gh release create --verify-tag --draft`、`gh release upload` 和 `gh release edit --draft=false` 完成。[GitHub CLI Release 文档](https://cli.github.com/manual/gh_release_create)
