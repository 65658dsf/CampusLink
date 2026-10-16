# Codex Pull Request 自动审查

开发者：NingMeng123 · 仓库：[65658dsf/CampusLink](https://github.com/65658dsf/CampusLink)

工作流为 [codex-review.yml](../.github/workflows/codex-review.yml)，使用官方 Codex Action 对 PR 进行静态审查，并以简体中文反馈具体问题、严重程度、文件位置和修复建议。

## 启用

1. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Secrets** 中新增 `OPENAI_API_KEY`，填写可用的 OpenAI API 密钥。
2. 如需指定模型，可在同页的 **Variables** 中设置 `CODEX_REVIEW_MODEL`；不设置时使用 Codex Action 的默认模型。
3. 将工作流提交到仓库后，新建或更新符合条件的 PR，在 **Actions → Codex Pull Request Review** 中查看运行情况。

密钥只通过 GitHub Secret 注入，不应写入仓库。审查使用 OpenAI API，会产生对应的 API 用量。未设置密钥时，工作流会在运行摘要中提示并跳过审查。

## 触发规则

- PR 新建、推送新提交、重新打开或从草稿转为待审查时运行。
- 仅自动审查同一仓库内、由 OWNER / MEMBER / COLLABORATOR 创建的非草稿 PR；Codex Action 还会检查触发者是否具有仓库写权限。
- 外部 fork、机器人创建的 PR 和机器人触发的运行默认跳过。这些 PR 仍由现有 Desktop CI 和人工审查处理。
- 同一个 PR 的新事件会取消旧的审查运行；每次使用事件中的 base/head 提交 SHA，按三点 diff 审查 PR 引入的改动。
- 反馈前再次检查 PR 是否打开、是否为草稿以及 head SHA 是否变化，避免发布已过期的审查结果。

## 反馈与权限

工作流在 PR 中创建一条带 `campus-link-codex-review` 标记的评论，后续运行更新同一条评论。评论包含审查提交、问题反馈和验证限制；没有明确问题时也会给出结论。

审查任务只拥有 `contents: read` 权限，checkout 不保留 Git 凭据，Codex 使用 `read-only` 沙箱及 `drop-sudo`。不安装项目依赖，不执行 PR 中的脚本或测试，不自动修复、提交或合并。只有独立的评论任务拥有 `pull-requests: write` 权限，且该任务不签出或执行 PR 代码。

模型输出通过环境变量作为评论内容传递，不拼接到 JavaScript 或 Shell 源码中。评论按 GitHub Actions 机器人身份和固定标记匹配，并限制长度。

已有的 [Desktop CI and Release](../.github/workflows/release.yml) 继续运行项目测试和构建；Codex 评论不代表这些检查已通过。

## 验证

配置密钥后，可用一个同仓库的普通 PR 验证首次评论、新提交后更新评论、草稿转为待审查和重新打开等事件。也应确认外部 fork、机器人 PR 与未配置密钥的情况会按规则跳过。

参考：[OpenAI 官方 Codex GitHub Action 文档](https://learn.chatgpt.com/docs/github-action)。
