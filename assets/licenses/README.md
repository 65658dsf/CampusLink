# 第三方来源与许可

岚连 Campus Link 的集成开发者为 **NingMeng123**。以下上游版权归原作者所有，本项目的开发署名不替代第三方版权声明。

| 内容 | 上游来源 | 使用方式 | 许可 |
| --- | --- | --- | --- |
| 锐捷 ePortal 旧版 RSA 零填充兼容算法、固定测试向量与川大协议常量 | [LFWQSP2641/scu_net_auto_login](https://github.com/LFWQSP2641/scu_net_auto_login/tree/194c8b9da995eeef4f6d1f3b83a9f03350293bb0)，提交 `194c8b9da995eeef4f6d1f3b83a9f03350293bb0` | JavaScript 适配、协议对照及回归测试 | [MIT 全文](scu-net-auto-login-MIT.txt)，Copyright (c) 2026 LFWQSP2641 |
| 景德镇陶瓷大学认证入口、登录参数及编码事实 | [pozhu90-alt/jdztc-campus-autologin](https://github.com/pozhu90-alt/jdztc-campus-autologin/tree/74bccd4ed57b150116d8d764fc71e67e88fd407e)，提交 `74bccd4ed57b150116d8d764fc71e67e88fd407e` | 仅协议对照，使用现有架构独立实现；未复制、打包或执行上游源码 | 上游 [LICENSE](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/LICENSE) 为自定义非商业、衍生作品同许可条款，与另一版权说明的 GPL v3 表述不一致；本项目未作为第三方代码引入 |

同作者 [Go 版注销实现](https://github.com/LFWQSP2641/scunet-auto-login/blob/8677927e207befa520cbe3ccbfcc4ea4ea56a0af/pkg/schools/scu/portal/rvjx/logout.go) 用于对照川大注销接口行为。具体流程、支持范围与未完成的真实环境验证见 [锐捷方案教程](../../docs/ruijie-guide.md)。

景陶参考文件、协议差异及仍需校内验证的状态/注销接口见 [景陶接入说明](../../docs/jdztc-guide.md#参考来源与许可)。
