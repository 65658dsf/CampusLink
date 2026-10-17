<div align="center">

<img src="assets/icon.png" width="88" alt="岚连 Campus Link 图标" />

# 岚连 Campus Link · CDUTYB 专版

**简单连接，自在校园。**

面向 Windows 和 macOS 的轻巧校园网认证工具，让连接、守护与方案管理更省心。

[![最新版本](https://img.shields.io/github/v/release/PowerT-0704/CampusLink?style=flat-square&color=159b7d)](https://github.com/PowerT-0704/CampusLink/releases/latest)
[![下载次数](https://img.shields.io/github/downloads/PowerT-0704/CampusLink/total?style=flat-square&color=439fa8)](https://github.com/65658dsf/CampusLink/releases)
[![构建状态](https://github.com/PowerT-0704/CampusLink/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/PowerT-0704/CampusLink/actions/workflows/release.yml)
[![GitHub Stars](https://img.shields.io/github/stars/PowerT-0704/CampusLink?style=flat-square&color=e9b44c)](https://github.com/PowerT-0704/CampusLink/stargazers)

[**📥 下载客户端**](https://github.com/PowerT-0704/CampusLink/releases/latest) · [**📖 在线文档**](https://campuslink.xzncraft.cn/) · [**💬 反馈问题**](https://github.com/65658dsf/CampusLink/issues)

开发者：**[PowerT-0704](https://github.com/PowerT-0704)**

<p><sub>当前版本 <strong>v1.4.0</strong> · Windows x64 安装包见 Releases</sub></p>

基于 **[NingMeng123](https://github.com/65658dsf)** 的 Campus Link 构建；本版本在 v1.4.0 的基础上增加「液态玻璃」外观。

</div>

## ✨ 连接校园，少一点折腾

| | 能做什么 |
| --- | --- |
| 🔌 轻松认证 | 支持 Dr.COM、锐捷 ePortal Web 和声明式 HTTP 方案；内置方案自动发现认证入口 |
| 🛡️ 网络守护 | 检测状态、断线重连、网络变化快速检查，托盘一键暂停或恢复 |
| 🧩 灵活配置 | 搜索学校方案，导入 / 导出 JSON，扩展更多校园网络 |
| 🔐 本地凭据 | 密码以明文保存在本机设置文件（日志与诊断包不含密码），也支持仅在本次连接中使用 |
| 🖥️ 桌面常驻 | Windows / macOS 托盘、可选开机自启动、启动后自动连接与更新检查 |
| 🔎 方便排障 | 活动日志、服务器响应详情和脱敏诊断包导出 |
| 🪟 双外观 | 经典 / 液态玻璃一键切换：玻璃侧边栏与顶栏，Win11 22H2 以上可透视桌面 |

<p align="center">
  <img src="docs/images/connection-profiles-liquid-glass.png" width="960" alt="岚连 · CDUTYB 专版（液态玻璃外观）：连接方案页面" />
</p>

<p align="center"><sub>液态玻璃外观：侧边栏与顶栏是可折射的玻璃面板；在「应用设置 → 界面外观」随时切回经典。</sub></p>

## 🪟 两种外观，一键切换

- **经典（默认）**：与上游一致的浅色界面，老用户升级后外观不变。
- **液态玻璃**：侧边栏与顶栏变为玻璃面板，内容在玻璃下方独立滚动；Windows 11 22H2 及以上使用系统 Acrylic 材质透视桌面，其他平台自动回退为应用内玻璃。
- 切换入口：**应用设置 → 界面外观**。只影响外观，不改变认证、凭据存储与日志行为。

<p align="center"><img src="docs/images/connection-profiles.png" width="640" alt="经典外观（默认）下的连接方案页面" /><br /><sub>经典外观（默认）</sub></p>

## 🚀 三步开始

1. **安装客户端**：从 [Releases](https://github.com/PowerT-0704/CampusLink/releases/latest) 下载 Windows x64、Intel Mac 或 Apple Silicon 对应安装包。
2. **确认学校方案**：先连接校园 Wi-Fi 或网线，再到“连接方案”确认学校；默认已选中成都理工大学（宜宾校区），其他学校可在列表中切换或导入。
3. **填写账号并连接**：已认证时会直接展示在线状态；需要认证时输入账号密码，按需开启记住密码和自动连接。

默认内置**成都理工大学（宜宾校区）**方案；其他学校可[制作并导入 JSON](docs/plugin-guide.md)。具体部署仍需校内验证，锐捷支持范围为 ePortal 网页认证。

> macOS 将应用拖入“应用程序”后运行。当前安装包未签名，macOS 也未公证，系统可能提示拦截；详见[安装说明](docs/usage.md#安装和首次连接)。

## 📚 想了解更多

[完整使用指南](docs/usage.md) · [方案制作](docs/plugin-guide.md) · [锐捷教程](docs/ruijie-guide.md) · [版本更新](https://github.com/PowerT-0704/CampusLink/releases) · [构建与发布](docs/releases.md)

连接失败时先查看应用内日志，也可携带脱敏诊断信息提交 [Issue](https://github.com/65658dsf/CampusLink/issues)。学校账号、欠费或设备上限问题请联系校园网服务渠道。

## 🛠️ 本地开发

需要 **Node.js 22.12+** 和 npm。

```bash
npm ci
npm run dev
```

`npm run dev:web` 预览界面；`npm test` 运行测试；`npm run build` 检查类型并构建。更多命令见[使用指南](docs/usage.md#本地开发)。文档网站源码独立维护于 [CampusLinkPages](https://github.com/65658dsf/CampusLinkPages)。

## ⭐ Star History

如果岚连帮到了你，欢迎点亮一颗 Star，让更多同学发现它。

<a href="https://www.star-history.com/?repos=PowerT-0704%2FCampusLink&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=PowerT-0704/CampusLink&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=PowerT-0704/CampusLink&amp;type=Date" />
    <img alt="CampusLink Star History 趋势图" src="https://api.star-history.com/svg?repos=PowerT-0704/CampusLink&amp;type=Date" width="800" />
  </picture>
</a>

## ❤️ 感谢贡献者

感谢每一位提交代码、完善文档、反馈问题与分享校园方案的朋友。

<a href="https://github.com/PowerT-0704/CampusLink/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=PowerT-0704/CampusLink" alt="CampusLink 代码贡献者头像" />
</a>

<sub>头像由 <a href="https://contrib.rocks">contrib.rocks</a> 根据 GitHub 贡献记录自动更新，点击可查看完整列表。</sub>

## 📄 授权与许可

- 本专版基于 [Campus Link](https://github.com/65658dsf/CampusLink)（作者 **NingMeng123**）构建，已获得原作者的修改与分发授权（2026-10-16 经维护者确认）。
- 本仓库以 MIT 许可发布，见 [LICENSE](LICENSE)；上游与第三方（如 `scu_net_auto_login`）的许可以原文保留，详见[第三方声明](assets/licenses/README.md)。

---

岚连是独立校园网辅助工具，与学校或认证服务商无官方隶属关系。使用外部方案前请核对认证地址；[隐私说明](docs/usage.md#密码与本地数据) · [第三方声明](assets/licenses/README.md)。
