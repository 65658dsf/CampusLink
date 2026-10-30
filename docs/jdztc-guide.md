# 景德镇陶瓷大学校园网接入说明

开发者：**NingMeng123** · [GitHub 主页](https://github.com/65658dsf)

岚连提供内置“景德镇陶瓷大学 · Dr.COM ePortal”方案。v1.1.4 根据用户提供的实际请求、网页运营商选项和失败响应修正了登录流程；内置方案配置版本为 `1.1.0`。目前没有成功响应，**尚未在景德镇陶瓷大学真实校园网完成成功登录、状态和注销验收**。

## 使用方法

1. 先在操作系统中连接 JCU、JCI 等校园 Wi-Fi，或接入学校有线网络。
2. 在“连接方案”搜索“景德镇陶瓷大学”，点击“使用此方案”。内置方案 ID 为 `builtin-jdztc`。
3. 应用先查询当前认证状态。选择学校页面对应的中国电信、中国移动、中国联通或“测试”，填写学号，程序补上对应后缀；已有正确后缀时不重复追加。需要手工填写完整账号时选择“其他”。
4. 点击连接。只有登录请求被接受且后续状态确认在线，才显示连接成功。
5. 需要结束认证时点击“注销校园网”；应用收到请求结果后继续查询，确认离线才报告注销成功。退出应用不会自动注销。

内置已知入口为 `http://172.29.0.2/a79.htm`，页面位于 HTTP 80 端口；实际登录请求发送到同主机 801 端口的 `/eportal/portal/login`，Referer 使用认证服务器根页。方案默认先通过 `http://www.msftconnecttest.com/redirect` 只读发现当前网络的认证入口，没有识别到时回退已知入口。账号密码不会提交给探测地址；正常 MSN / Bing 页面不作为认证成功信号。

该入口使用 HTTP，应用的本地加密不会改变认证协议的传输方式。请使用学校提供的校园网账号密码，并先核对认证地址。

## 协议和实现范围

早期参考仓库的 README 将认证描述为“深澜”，其脚本实际使用 Dr.COM 字段。用户后续提供的真实页面与请求进一步确认了 Dr.COM ePortal 的新版登录形式。v1.1.3 沿用参考脚本的旧 `/eportal/?c=Portal&a=login` 入口，未匹配该实际请求；v1.1.4 改用显式的 `portal-v4` 配置。没有深澜 `get_challenge` / `srun_portal` 实现，也不能以 README 名称推断支持其他深澜部署。

Dr.COM ePortal 与锐捷 ePortal Web 使用不同协议。景陶方案不使用 `ruijie`、锐捷 RSA 公钥或锐捷服务配置，也不能直接把四川大学等锐捷方案的地址替换成景陶地址使用。

| 操作 | 当前实现 | 证据与限制 |
| --- | --- | --- |
| 登录 | 同主机 801 端口 GET `/eportal/portal/login`，`callback=dr1003`、`login_method=1`、`jsVersion=4.2.1`、`terminal_type=1`，保留先 `lang=zh-cn` 后 `lang=zh` 两个字段 | 已对照实际请求和失败响应；没有成功响应 |
| 账号密码 | 电信为 `user_account=,0,学号@telecom`；“其他”保留完整输入；`user_password` 使用原始密码 | 每个值仅 URL 编码，不进行 Base64 或 `{B}` 密码变换 |
| 当前设备参数 | `wlan_user_ip` 来自本次入口；`wlan_user_ipv6=`、`wlan_user_mac=000000000000`、`wlan_ac_ip=`、`wlan_ac_name=` | 按实际登录请求，即使入口有 AC IP 也不转入新版请求；不将长 `usermac` 直接当硬件 MAC |
| 只读状态 | HTTP 80 端口 GET `/drcom/chkstatus`，`jsVersion=4.2.1`；仅 `result=1`、非空 `uid` 和有效 IP 同时存在时据此确认在线 | 同家族兼容流程，尚未取得景陶状态响应；缺少在线身份时不将 `result` 单独当登录状态 |
| 页面状态回退 | 身份信息不足或接口明确不支持时，重新读取入口页，匹配唯一 `Dr.COMWebLoginID_*.htm` 注释 | 忽略脚本中的模板标记；无明确标记或标记矛盾时为状态未知，不触发重连 |
| 注销 | 同主机 801 端口裸 GET `/eportal/portal/logout`，不携带账号密码 | 参考同家族公开实现；仅解析明确 JSON / JSONP 结果，并独立复核离线，仍需景陶实测 |

登录先读取并识别认证页，获取当前设备参数；不执行网页脚本或自动化浏览器。登录和注销均需要后续状态复核。超时、HTTP 错误、未知响应或矛盾结果不会当作离线，也不会据此触发自动重连。页面跳转限制在允许的认证来源内，发现流程不访问登录或注销操作地址。

用户提供的网页选项确认了以下映射，不使用占位项 `-1`。其中“测试”保留学校原名，不将其称为校园网。

| 选择项 | 配置值 | 自动追加后缀 |
| --- | --- | --- |
| 中国电信（默认） | `telecom` | `@telecom` |
| 中国移动 | `cmcc` | `@cmcc` |
| 中国联通 | `unicom` | `@unicom` |
| 测试 | `xyw` | `@xyw` |
| 其他（完整账号） | `raw` | 不追加 |

实际失败响应为 `result=0`、`ret_code=1`，服务器提示“云陶密码错误，请登录云上陶大修改密码”。这是明确的业务拒绝；即使 HTTP 200 也不能显示认证成功。遇到该提示应在“云上陶大”修改密码后重试。请求参数和失败处理已核对，后续仍需成功响应及认证后的只读状态响应验证。

## 导入、导出和校内验证

内置方案可以直接选择，无需导入。需要保存副本时，在方案卡片点击“导出 JSON”；导出 ID 为 `jdztc-copy`。仓库同时提供可导入的 [jdztc-campus.example.json](../examples/jdztc-campus.example.json)，其外部 ID 为 `jdztc-campus`。

新版 JSON 使用 `drcomEportal: { "variant": "portal-v4", "apiPort": 801 }` 和 `operator` 字段，默认值为 `telecom`，选项值见上表。它不配置 `operations`，使用应用受控的 `drcom-eportal` 适配器。导出不包含账号密码、当前设备参数或在线会话。结构与导入要求见 [外部方案指南](plugin-guide.md)。

省略 `drcomEportal` 的旧导入 JSON 保留原有旧流程，升级应用不会自动修改这些定义。升级后应切换到内置新版方案，或移除旧副本后重新导入新版示例；需要保留旧副本时，修改新版的 `id` 再导入。

校内验收应分别确认未认证时的只读检测、对应运营商账号提交、成功响应、在线确认、只读刷新、注销及离线确认。网页选项已确认其后缀，但各类账号、JCU / JCI 或不同校区的实际可用性仍需验证。本机模拟服务和请求对照不能替代真实账号验收。

连接失败时先打开认证页检查账户、欠费或设备上限；应用内可查看“活动日志 → 查看响应”，并导出脱敏诊断信息用于排障。不要分享真实账号密码、Cookie 或带设备参数的完整认证 URL。

## 参考来源与许可

v1.1.4 的新版登录字段、运营商映射和业务拒绝处理以用户提供的实际请求、网页选项和失败响应为依据，文档只记录接口和参数规则，不保存原始抓包或个人凭据。兼容注销参考 [haowang02/cqu-net-auth 的公开实现](https://github.com/haowang02/cqu-net-auth/blob/856ca7ce0ce5183668d43d6e02f61d2ffa66b667/logout.py#L75-L84)，仅支持同家族协议对照，不代表已验证景陶的注销行为。

早期入口与旧流程参考 [pozhu90-alt/jdztc-campus-autologin](https://github.com/pozhu90-alt/jdztc-campus-autologin)，对照提交为 [`74bccd4ed57b150116d8d764fc71e67e88fd407e`](https://github.com/pozhu90-alt/jdztc-campus-autologin/tree/74bccd4ed57b150116d8d764fc71e67e88fd407e)：

- [build/config.blank.json](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/build/config.blank.json)：认证入口和校园 SSID。
- [portal_autofill/autofill_core.js](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/portal_autofill/autofill_core.js#L115)：原始学号、登录接口、参数与编码。

上游 [LICENSE](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/LICENSE) 声明非商业及衍生作品同许可条件，另有版权说明自称 GPL v3，表述不一致。本次只参考认证地址、参数及流程事实，以岚连现有架构独立实现，没有复制、打包或运行其 PowerShell / JavaScript 源码、界面或统计功能。第三方来源记录见 [第三方声明](../assets/licenses/README.md)。
