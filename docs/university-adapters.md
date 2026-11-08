# 新增高校接入记录

开发者：**NingMeng123**。源码对照日期：2026-11-08。

当前内置 28 所高校连接方案，另有 1 个 Dr.COM 自动识别通用方案。前两批接入重庆大学、西南大学及后续 20 所大学，贵州复核新增贵州师范大学和贵州民族大学。新增方案完成源码对照与本地模拟验证，真实校内认证仍待验收。

## 重庆大学

选择“重庆大学 · Dr.COM ePortal”，填写完整学校账号，使用电脑端认证，不自动添加运营商后缀。

| 项目 | 实现 |
| --- | --- |
| 已知入口 | `http://login.cqu.edu.cn/` |
| 状态 | 首页端口 `/drcom/chkstatus`；读取有效 IPv4，依据非空 `uid` 确认会话；`result=1` 本身不足以判在线 |
| 登录 | 同主机 801 端口 `/eportal/portal/login`，`,0,` 前缀、原密码 URL 编码、4.2.2 电脑端参数 |
| 注销 | 同主机 801 端口普通 `/eportal/portal/logout`，随后独立复核离线 |
| 方案设置 | `drcomEportal: { "variant": "portal-v4", "apiPort": 801, "dialect": "cqu" }` |

登录前读取新 IP，缺失或无效时不提交凭据。参考项目还包含 MAC 解绑；岚连的注销只请求退出会话，不执行解绑。普通注销是否覆盖学校当前所有接入场景仍需校内验收。

参考：[登录实现](https://github.com/haowang02/cqu-net-auth/blob/856ca7ce0ce5183668d43d6e02f61d2ffa66b667/login.py)、[注销实现](https://github.com/haowang02/cqu-net-auth/blob/856ca7ce0ce5183668d43d6e02f61d2ffa66b667/logout.py)、[使用记录](https://github.com/haowang02/cqu-net-auth/blob/856ca7ce0ce5183668d43d6e02f61d2ffa66b667/README.md)。可导入 [重庆大学示例](../examples/cqu-campus.example.json)。

## 西南大学

选择“西南大学 · 锐捷 ePortal”，填写学校账号，服务保持“默认”。

| 项目 | 实现 |
| --- | --- |
| 已知入口 | `http://222.198.127.170/` |
| 发现中转 | `http://123.123.123.123`，只用于受限入口发现 |
| 公钥 | 每次登录通过同源 `InterFace.do?method=pageInfo` 读取并校验 |
| 密码 | `密码>MAC` 的 UTF-8 字节按上游规则做 RSA 变换 |
| 编码 | 账号、服务、queryString 使用普通表单编码 |
| 状态 | 新读取的锐捷登录页 / 成功页 |
| 注销 | 沿用受控锐捷 `method=logout` 与状态复核；该学校上游未提供注销验证记录 |

动态公钥仅用于本次登录，不写回方案；缺失、过大或格式不合法时不提交账号密码。原有川大、成都理工宜宾方案继续使用其静态公钥与既有编码。

参考：[西南大学实现](https://github.com/SWUOSA/ruijie-authentication/blob/1c4918833eaa249b45edcbe590cc5ae2364c905f/login.py)、[流程说明](https://github.com/SWUOSA/ruijie-authentication/blob/1c4918833eaa249b45edcbe590cc5ae2364c905f/README.md)。可导入 [西南大学示例](../examples/ruijie-swu.example.json)。

## 验收重点

校内验收应依次确认首次登录、错误密码响应、已登录状态、主动注销、断线重连和切换校园网络后的重新发现。成功 HTTP 响应或本地测试通过不代表真实校园网络已通过验收。

## 本次新增 20 所大学

本次新增 7 所 Dr.COM、5 所锐捷 ePortal 和 8 所深澜 Srun 高校。开发者署名为 NingMeng123。每个源码链接固定到实际检索的提交，完整记录保存在机器可读清单中。[来源与证据记录](university-sources.json)

| 学校 | 协议 | 已知认证入口 | 主要源码 |
| --- | --- | --- | --- |
| 湖南科技大学 | Dr.COM | `http://192.168.254.226/` | [dezige131/hnust-drcom-auth](https://github.com/dezige131/hnust-drcom-auth/blob/adec498fdf1ad932e138a4bcb5ccaaadbce651d8/luci-app-campus-auth/root/usr/bin/campus-auth) |
| 深圳大学 | Dr.COM | `http://172.30.255.42/` | [CollinChan002/SZU-Drcom](https://github.com/CollinChan002/SZU-Drcom/blob/cca5354b3d5af7ab3b1dd7088a90d75b95999865/drcom.sh) |
| 延安大学 | Dr.COM | `http://10.200.84.3/` | [liar-ac/YAU-AutoNet-Connect](https://github.com/liar-ac/YAU-AutoNet-Connect/blob/f28f880bbf022289da0dcb198681b67f3de43978/campus_auto_login.py) |
| 南京财经大学 | Dr.COM | `http://10.200.253.5/` | [Halcyonjoy/nufe-network-assistant](https://github.com/Halcyonjoy/nufe-network-assistant/blob/d563585fb6861ab36b57c43ccfbe488cea7815da/src/NufeCampus.Windows/CampusPortal.cs) |
| 东南大学 | Dr.COM | `https://w.seu.edu.cn/` | [NN708/seu-wlan-login](https://github.com/NN708/seu-wlan-login/blob/f4bca31916ebcfda1cad61923906c319c1009f89/Python/login.py) |
| 中国药科大学 | Dr.COM | `http://192.168.199.21/` | [SoraNoNeko/cpu_net](https://github.com/SoraNoNeko/cpu_net/blob/2a2a148bf025fd026cdd6de153567c4d6dd3dd30/src/Core/Constants/NetworkConstants.cs) |
| 安徽师范大学 | Dr.COM | `http://100.64.4.10/` | [Aurora1949/AHNU-Portal-Authenticator](https://github.com/Aurora1949/AHNU-Portal-Authenticator/blob/4ee4437e11202eae70c28c178d34cc3beb394588/src/model/auth_service.cpp) |
| 集美大学 | 锐捷 ePortal | `http://210.34.130.210/` | [callmeliwen/RuijiePortalLoginTool](https://github.com/callmeliwen/RuijiePortalLoginTool/blob/a87157ee8811c710d58216e98c1abf98e9e6fb7c/Linux/ruijie_jmu.sh) |
| 武汉纺织大学 | 锐捷 ePortal | `http://172.30.1.111/` | [canfengplaeir/wtu-login](https://github.com/canfengplaeir/wtu-login/blob/a4ae4803b92f81ea159dd7fabcff48f5b1ada03f/wtu-login) |
| 中国石油大学（华东） | 锐捷 ePortal | `http://wlan.upc.edu.cn/` | [Iamtianyuyang/UPCnetworklogin](https://github.com/Iamtianyuyang/UPCnetworklogin/blob/f906baff2a6f0214b461df27c1ad09f98afce1e2/src/portal.rs) |
| 青岛科技大学 | 锐捷 ePortal | `http://211.87.158.84/` | [Mortal-Lonely-Immortal/auto-eportal-openwrt](https://github.com/Mortal-Lonely-Immortal/auto-eportal-openwrt/blob/70be7dc3ad9f2ac7cf4a67e7bdfaaf93d8719485/tools/eportal_login.py) |
| 上海大学 | 锐捷 ePortal | `http://10.10.9.9:8080/` | [DongZhouGu/shu-auto-net](https://github.com/DongZhouGu/shu-auto-net/blob/cba52c916e20c1784f1494ff4cc96424b227e9df/auto-shunet.py) |
| 北京理工大学 | 深澜 Srun | `http://10.0.0.55/` | [BITNP/bitsrun](https://github.com/BITNP/bitsrun/blob/8567edc17a1570be7804b1f87c1a78514f20e210/src/bitsrun/user.py) |
| 杭州电子科技大学 | 深澜 Srun | `https://login.hdu.edu.cn/` | [redchenjs/HDU-srun-login-script](https://github.com/redchenjs/HDU-srun-login-script/blob/5b7097fe3d8a43c1e022671e03293d89e782b3f2/HduSrunLogin/LoginManager.py) |
| 江西师范大学 | 深澜 Srun | `http://172.16.8.6/` | [huxiaofan1223/jxnu_srun](https://github.com/huxiaofan1223/jxnu_srun/blob/c7adf73f99971a092c550d67f26d71bbfe7f4d6f/jxnu_wifi.py) |
| 兰州大学 | 深澜 Srun | `http://10.10.0.166/` | [Monika-shipship/lzu-network-autologin](https://github.com/Monika-shipship/lzu-network-autologin/blob/3ab0b62a2cbb4513d2e898f0294931493d1d31c2/src/lzu_autologin/config.py) |
| 中国科学院大学 | 深澜 Srun | `https://portal.ucas.ac.cn/` | [iskoldt-X/SRUN-authenticator](https://github.com/iskoldt-X/SRUN-authenticator/blob/ef5a63faa118553fd69a0c9a23b7fd01f4b6d32c/srun_login.py) |
| 南昌大学 | 深澜 Srun | `http://222.204.3.154/` | [kaloronahuang/NCU-Srun-Python](https://github.com/kaloronahuang/NCU-Srun-Python/blob/8f3eeb5ff63ae93a160c25c71e40ccb531019c13/login.py) |
| 华北电力大学 | 深澜 Srun | `http://202.204.67.15/` | [lxydiy/srun-portal-ncepu](https://github.com/lxydiy/srun-portal-ncepu/blob/8f038ab0ae71b25e16e8688f0eb99d80024d8729/main.cpp) |
| 山东大学 | 深澜 Srun | `http://192.168.75.252/` | [Bingtao-Wang/Srun_login](https://github.com/Bingtao-Wang/Srun_login/blob/7b0f3353b62f603c6ea9dc3a99df8b0771e71859/srun_login.ps1) |

### 使用与覆盖范围

在连接方案中搜索学校全名，选择对应服务后连接。每个内置方案均可通过卡片导出 JSON，再作为副本导入。学校账号后缀、服务代码和端口按照对应源码设置。校区未在来源中明确的方案，适用范围限于表中的网关部署。

南京财经大学区分移动 `@cmcc` 与电信 `@njxy`。延安大学使用源码中的 `@dx`、`@lt`，并从当前状态读取设备 MAC，来源允许缺失时使用零值。深圳大学使用 `,1,` 前缀。安徽师范大学的登录只发送账号和密码字段。

集美大学保留来源脚本的分隔符编码规则，原查询已有百分号或加号时也遵循其实际请求格式。中国石油大学（华东）使用来源的专用查询编码，包括下划线。上海大学采用原始实现与派生项目共同确认的 `10.10.9.9:8080` 网关，其他校区需核对实际入口。

深澜新增 BX1 挑战应答、两种 HMAC 模式和状态复核。杭州电子科技大学 AC 编号为 `0`，北京理工大学和南昌大学从同源页面读取。兰州大学默认使用 `@study`，也可选择完整账号。南昌大学提供校园网、移动、电信、联通和完整账号选项。山东大学的密码更新提醒响应仍需明确在线身份和 IP 才确认为成功。

动态 AC 编号只在进程内保留。若在线门户在重启后不再提供编号，可导出学校方案，将 `srun.acId` 改为学校实际校区编号后导入副本。北京理工大学来源还包含外部劫持探测分支，本次适配使用同源入口读取 AC。中国科学院大学来源的设备 IP 查询另用 HTTP 地址，本次使用同源挑战返回的 `client_ip`，该部署差异需要校内确认。

### 验证范围

20 个新增定义均经过格式校验、导出导入、默认参数恢复和逐校本地认证服务测试。请求测试覆盖实际账号前后缀、服务代码、端口、编码、状态查询及注销后的独立复核。桌面检查覆盖内置方案的搜索，以及通用、Dr.COM 学校参数、深澜配置的原生导入。

部分来源只给出了登录实现。这些学校的状态和注销采用同协议兼容流程，证据等级已单独记录。所有新增学校均待校内真实验收，尤其需要核对当前固件、校区入口、在线页面和注销行为。

## 贵州高校复核与接入

2026 年 11 月 8 日按教育部名单中的 80 所贵州普通高校逐校检索 GitHub，补查旧名、缩写和认证字段。此前检索覆盖不足，将只有登录脚本的学校也排除，导致“贵州新增 0 所”的结论失实。这次保留贵州轻工职业大学，并接入下列两所已有公开登录实现的学校。逐校检索、来源和限制保存在复核记录中。检索未命中仅表示本轮未找到可实施方案。[贵州来源与复核记录](guizhou-sources.json)

| 学校 | 接入方式 | 源码与范围 |
| --- | --- | --- |
| 贵州轻工职业大学 | 原有 Dr.COM 方案 | 保留已核验的 `10.151.253.10` 部署。[协议核验](portal-protocol.md) |
| 贵州师范大学 | 新增深信服 Portal 适配器 | 学校脚本提供门户入口、表单和 `pwdLogin` 请求。同代门户源码补全按时间戳生成的 RC4 密码、`auth_tag`、只读状态及注销流程。[学校源码](https://github.com/jang1998/gznu_schlloNet/blob/ae96a6e91dfc3287060280bdba41e897c9e4b6ce/request_school.py) |
| 贵州民族大学 | Dr.COM 自动识别 | 学校脚本提供 `DDDDD`、`upass`、`0MKKey` 表单及服务选择。当前入口、接口类型、端口和账号前后缀从校园门户读取。[学校源码](https://github.com/yangyunuo6666/taobao_scrapy/blob/c1caa16a5acf80a4813c068ba8f01a5799d5eb27/实用的小程序/gzmu校园网登录.js) |

在连接方案搜索学校全名即可使用。贵州师范大学的默认入口来自公开源码，校区入口变化时在连接页填写当前认证页。客户端每次创建当前来源的门户会话，生成新的密码参数，并在登录、注销后独立复核状态。

贵州民族大学原脚本的匹配地址只给出 `*.101.6.51/a79.htm`，缺少完整 IP。末项 `@lt` 的注释也存在冲突，因此方案通过当前页面确定服务。自动发现失败时填写浏览器中的认证页，参数识别不完整时会给出具体提示。公开脚本没有提供完整页面配置，本地合成门户测试覆盖了识别和认证执行链，当前学校页面是否能完整识别仍需校内验证。

贵州师范大学的状态及注销使用同代深信服协议兼容实现。两项新增方案均待校内真实登录、错误密码、状态、注销及断线重连验收。仅有厂家名单、设备采购或学校名称的资料保留为研究线索。
