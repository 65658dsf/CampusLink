# 第三方来源与许可

岚连 Campus Link 的集成开发者为 **NingMeng123**。以下上游版权归原作者所有，本项目的开发署名不替代第三方版权声明。

| 内容 | 上游来源 | 使用方式 | 许可 |
| --- | --- | --- | --- |
| 锐捷 ePortal 旧版 RSA 零填充兼容算法、固定测试向量与川大协议常量 | [LFWQSP2641/scu_net_auto_login](https://github.com/LFWQSP2641/scu_net_auto_login/tree/194c8b9da995eeef4f6d1f3b83a9f03350293bb0)，提交 `194c8b9da995eeef4f6d1f3b83a9f03350293bb0` | JavaScript 适配、协议对照及回归测试 | [MIT 全文](scu-net-auto-login-MIT.txt)，Copyright (c) 2026 LFWQSP2641 |
| 景德镇陶瓷大学认证入口、登录参数及编码事实 | [pozhu90-alt/jdztc-campus-autologin](https://github.com/pozhu90-alt/jdztc-campus-autologin/tree/74bccd4ed57b150116d8d764fc71e67e88fd407e)，提交 `74bccd4ed57b150116d8d764fc71e67e88fd407e` | 仅协议对照，使用现有架构独立实现；未复制、打包或执行上游源码 | 上游 [LICENSE](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/LICENSE) 为自定义非商业、衍生作品同许可条款，与另一版权说明的 GPL v3 表述不一致；本项目未作为第三方代码引入 |

同作者 [Go 版注销实现](https://github.com/LFWQSP2641/scunet-auto-login/blob/8677927e207befa520cbe3ccbfcc4ea4ea56a0af/pkg/schools/scu/portal/rvjx/logout.go) 用于对照川大注销接口行为。具体流程、支持范围与未完成的真实环境验证见 [锐捷方案教程](../../docs/ruijie-guide.md)。

景陶参考文件、协议差异及仍需校内验证的状态/注销接口见 [景陶接入说明](../../docs/jdztc-guide.md#参考来源与许可)。

## 本轮新增协议参考

以下只用于协议事实对照，由 NingMeng123 独立实现适配；未复制、打包或执行第三方客户端源码。运行时自动识别只读取受限门户文本，不执行脚本。

| 来源 | 固定提交 | 对照内容与许可说明 |
| --- | --- | --- |
| [haowang02/cqu-net-auth](https://github.com/haowang02/cqu-net-auth/tree/856ca7ce0ce5183668d43d6e02f61d2ffa66b667) | `856ca7ce0ce5183668d43d6e02f61d2ffa66b667` | 重庆大学 PC 登录、状态与普通注销；上游 MIT，Copyright (c) 2025 Hao Wang |
| [SWUOSA/ruijie-authentication](https://github.com/SWUOSA/ruijie-authentication/tree/1c4918833eaa249b45edcbe590cc5ae2364c905f) | `1c4918833eaa249b45edcbe590cc5ae2364c905f` | 西南大学 pageInfo 公钥与 UTF-8 RSA 数据格式；该提交未提供 LICENSE，未作为代码依赖引入 |
| [YT-O5/GZIST_CampusNet_AutoLogin](https://github.com/YT-O5/GZIST_CampusNet_AutoLogin/tree/2c61996486fdca9fcf4fc2e387114395c681a446) | `2c61996486fdca9fcf4fc2e387114395c681a446` | 门户端口、配置、前后缀及加密分支；其中学校原始门户脚本不作为本项目代码分发 |
| [Ptilopsi4/NJUPT_login_script](https://github.com/Ptilopsi4/NJUPT_login_script/tree/d0b7d6831f5b1ad6e64b807707a063d9aa8ca622) | `d0b7d6831f5b1ad6e64b807707a063d9aa8ca622` | HTTPS 端口与加密配置反例，仅协议对照 |
| [JieShenAI/OUNet](https://github.com/JieShenAI/OUNet/tree/cade50a288daab8d73a0a27e1d734cef972a72e2) | `cade50a288daab8d73a0a27e1d734cef972a72e2` | 配置接口和前后缀字段，仅协议对照 |

具体字段、限制与校内验收说明见 [自动识别](../../docs/drcom-auto-guide.md) 和 [高校接入记录](../../docs/university-adapters.md)。

## 本次 20 校协议参考

本次集成开发者为 NingMeng123。各高校来源提交、文件路径、许可信息和操作证据已固定记录。适配器按协议字段独立实现，数学常量与请求格式用于互操作。代码包未引入这些研究客户端作为依赖。[完整来源清单](../../docs/university-sources.json)

| 学校 | 主要参考 | 引用范围 |
| --- | --- | --- |
| 湖南科技大学 | [dezige131/hnust-drcom-auth](https://github.com/dezige131/hnust-drcom-auth/blob/adec498fdf1ad932e138a4bcb5ccaaadbce651d8/luci-app-campus-auth/root/usr/bin/campus-auth) | 认证参数、编码及流程对照 |
| 深圳大学 | [CollinChan002/SZU-Drcom](https://github.com/CollinChan002/SZU-Drcom/blob/cca5354b3d5af7ab3b1dd7088a90d75b95999865/drcom.sh) | 认证参数、编码及流程对照 |
| 延安大学 | [liar-ac/YAU-AutoNet-Connect](https://github.com/liar-ac/YAU-AutoNet-Connect/blob/f28f880bbf022289da0dcb198681b67f3de43978/campus_auto_login.py) | 认证参数、编码及流程对照 |
| 南京财经大学 | [Halcyonjoy/nufe-network-assistant](https://github.com/Halcyonjoy/nufe-network-assistant/blob/d563585fb6861ab36b57c43ccfbe488cea7815da/src/NufeCampus.Windows/CampusPortal.cs) | 认证参数、编码及流程对照 |
| 东南大学 | [NN708/seu-wlan-login](https://github.com/NN708/seu-wlan-login/blob/f4bca31916ebcfda1cad61923906c319c1009f89/Python/login.py) | 认证参数、编码及流程对照 |
| 中国药科大学 | [SoraNoNeko/cpu_net](https://github.com/SoraNoNeko/cpu_net/blob/2a2a148bf025fd026cdd6de153567c4d6dd3dd30/src/Core/Constants/NetworkConstants.cs) | 认证参数、编码及流程对照 |
| 安徽师范大学 | [Aurora1949/AHNU-Portal-Authenticator](https://github.com/Aurora1949/AHNU-Portal-Authenticator/blob/4ee4437e11202eae70c28c178d34cc3beb394588/src/model/auth_service.cpp) | 认证参数、编码及流程对照 |
| 集美大学 | [callmeliwen/RuijiePortalLoginTool](https://github.com/callmeliwen/RuijiePortalLoginTool/blob/a87157ee8811c710d58216e98c1abf98e9e6fb7c/Linux/ruijie_jmu.sh) | 认证参数、编码及流程对照 |
| 武汉纺织大学 | [canfengplaeir/wtu-login](https://github.com/canfengplaeir/wtu-login/blob/a4ae4803b92f81ea159dd7fabcff48f5b1ada03f/wtu-login) | 认证参数、编码及流程对照 |
| 中国石油大学（华东） | [Iamtianyuyang/UPCnetworklogin](https://github.com/Iamtianyuyang/UPCnetworklogin/blob/f906baff2a6f0214b461df27c1ad09f98afce1e2/src/portal.rs) | 认证参数、编码及流程对照 |
| 青岛科技大学 | [Mortal-Lonely-Immortal/auto-eportal-openwrt](https://github.com/Mortal-Lonely-Immortal/auto-eportal-openwrt/blob/70be7dc3ad9f2ac7cf4a67e7bdfaaf93d8719485/tools/eportal_login.py) | 认证参数、编码及流程对照 |
| 上海大学 | [DongZhouGu/shu-auto-net](https://github.com/DongZhouGu/shu-auto-net/blob/cba52c916e20c1784f1494ff4cc96424b227e9df/auto-shunet.py) | 认证参数、编码及流程对照 |
| 北京理工大学 | [BITNP/bitsrun](https://github.com/BITNP/bitsrun/blob/8567edc17a1570be7804b1f87c1a78514f20e210/src/bitsrun/user.py) | 认证参数、编码及流程对照 |
| 杭州电子科技大学 | [redchenjs/HDU-srun-login-script](https://github.com/redchenjs/HDU-srun-login-script/blob/5b7097fe3d8a43c1e022671e03293d89e782b3f2/HduSrunLogin/LoginManager.py) | 认证参数、编码及流程对照 |
| 江西师范大学 | [huxiaofan1223/jxnu_srun](https://github.com/huxiaofan1223/jxnu_srun/blob/c7adf73f99971a092c550d67f26d71bbfe7f4d6f/jxnu_wifi.py) | 认证参数、编码及流程对照 |
| 兰州大学 | [Monika-shipship/lzu-network-autologin](https://github.com/Monika-shipship/lzu-network-autologin/blob/3ab0b62a2cbb4513d2e898f0294931493d1d31c2/src/lzu_autologin/config.py) | 认证参数、编码及流程对照 |
| 中国科学院大学 | [iskoldt-X/SRUN-authenticator](https://github.com/iskoldt-X/SRUN-authenticator/blob/ef5a63faa118553fd69a0c9a23b7fd01f4b6d32c/srun_login.py) | 认证参数、编码及流程对照 |
| 南昌大学 | [kaloronahuang/NCU-Srun-Python](https://github.com/kaloronahuang/NCU-Srun-Python/blob/8f3eeb5ff63ae93a160c25c71e40ccb531019c13/login.py) | 认证参数、编码及流程对照 |
| 华北电力大学 | [lxydiy/srun-portal-ncepu](https://github.com/lxydiy/srun-portal-ncepu/blob/8f038ab0ae71b25e16e8688f0eb99d80024d8729/main.cpp) | 认证参数、编码及流程对照 |
| 山东大学 | [Bingtao-Wang/Srun_login](https://github.com/Bingtao-Wang/Srun_login/blob/7b0f3353b62f603c6ea9dc3a99df8b0771e71859/srun_login.ps1) | 认证参数、编码及流程对照 |

## 贵州高校复核参考

本轮开发者署名为 NingMeng123。贵州师范大学和贵州民族大学的公开脚本用于认证字段与流程对照，深信服算法和会话操作依据同代门户源码独立实现。固定版本、逐校检索与兼容范围保存在贵州来源记录中。[贵州来源与复核记录](../../docs/guizhou-sources.json)

| 来源 | 参考范围 |
| --- | --- |
| [jang1998/gznu_schlloNet](https://github.com/jang1998/gznu_schlloNet/tree/ae96a6e91dfc3287060280bdba41e897c9e4b6ce) | 贵州师范大学入口、表单及登录字段 |
| [yangyunuo6666/taobao_scrapy](https://github.com/yangyunuo6666/taobao_scrapy/blob/c1caa16a5acf80a4813c068ba8f01a5799d5eb27/实用的小程序/gzmu校园网登录.js) | 贵州民族大学 Dr.COM 表单与服务选择，源文件标注 MIT |
| [imcyx/SIAS-AutoLink](https://github.com/imcyx/SIAS-AutoLink/blob/d55ba00353c28a7b3fcf235f77679a5c0746108c/login_network.py) | 深信服时间戳及 RC4 密码请求格式 |
| [JairHan/SUTAutoAuthGDWIFI](https://github.com/JairHan/SUTAutoAuthGDWIFI/tree/f8a6f944adb7d3cecd41a0365f89e6a35e9bb617) | 同代门户 JavaScript 的密码变换、状态和注销协议 |
| [LeeAstra/autologin-sias](https://github.com/LeeAstra/autologin-sias/blob/8e5e527d476c94cac8b62c364b61421c23d8f0fa/src/sias_autologin/core/state.py) | 明确离线响应结构 |
| [zhy617/USTC-Network](https://github.com/zhy617/USTC-Network/blob/b6d77dad641375d7f4ebd28001b3e042d444cce2/ustc_suzhou_auth.py) | AUTHSESSID 建立与状态复核流程 |
