# 景德镇陶瓷大学校园网接入说明

开发者：**NingMeng123** · [GitHub 主页](https://github.com/65658dsf)

岚连提供内置“景德镇陶瓷大学 · Dr.COM ePortal”方案，支持登录、只读状态检测、注销及已有网络守护流程。当前接入依据公开源码独立实现，**尚未在景德镇陶瓷大学真实校园网完成验证**。

## 使用方法

1. 先在操作系统中连接 JCU、JCI 等校园 Wi-Fi，或接入学校有线网络。
2. 在“连接方案”搜索“景德镇陶瓷大学”，点击“使用此方案”。内置方案 ID 为 `builtin-jdztc`。
3. 应用先查询当前认证状态。当前仅实现参考脚本的原始学号路径，不自动追加运营商后缀；实际门户有运营商下拉框，其选项值与账号后缀映射仍待抓包核验，尚不宣称支持所有运营商。
4. 点击连接。只有登录请求被接受且后续状态确认在线，才显示连接成功。
5. 需要结束认证时点击“注销校园网”；应用收到请求结果后继续查询，确认离线才报告注销成功。退出应用不会自动注销。

内置已知入口为 `http://172.29.0.2/a79.htm`。方案默认先通过 `http://www.msftconnecttest.com/redirect` 只读发现当前网络的认证入口，没有识别到时回退已知入口。账号密码不会提交给探测地址；正常 MSN / Bing 页面不作为认证成功信号。

该入口使用 HTTP，应用的本地加密不会改变认证协议的传输方式。请使用学校提供的校园网账号密码，并先核对认证地址。

## 协议和实现范围

上游 README 将认证描述为“深澜”，但实际脚本使用 `DDDDD` / `upass` 网页字段和 Dr.COM `/eportal/` JSONP 登录接口，没有深澜 `get_challenge` / `srun_portal` 流程。岚连据此使用独立协议标识 `drcom-eportal`，不能以 README 的名称推断支持其他深澜部署。

Dr.COM ePortal 与锐捷 ePortal Web 使用不同协议。景陶方案不使用 `ruijie`、锐捷 RSA 公钥或锐捷服务配置，也不能直接把四川大学等锐捷方案的地址替换成景陶地址使用。

| 操作 | 当前实现 | 证据与限制 |
| --- | --- | --- |
| 登录 | GET `/eportal/`，`c=Portal`、`a=login`、`login_method=1`、`callback=dr1003`、`jsVersion=3.3.2` | 入口及登录参数来自上游公开脚本，尚未校内验证 |
| 账号密码 | `user_account=,0,原始学号`，`user_password=原始密码`，分别进行 URL 编码 | 不追加运营商后缀，不进行 Base64 或 `{B}` 密码变换 |
| 当前设备参数 | 从本次认证入口的 `userip`、`wlanacip`、`wlanacname` 读取，映射到登录请求的 `wlan_user_ip`、`wlan_ac_ip`、`wlan_ac_name` | `wlan_user_ipv6` 为空，`wlan_user_mac=000000000000`；临时参数不保存到方案 |
| 只读状态 | GET `/drcom/chkstatus`，仅明确的 `result=1` / `"1"` 为在线，`result=0` / `"0"` 为离线 | 上游未提供景陶状态接口证据，当前沿用 Dr.COM 状态机制 |
| 页面状态回退 | 状态接口明确不支持或返回 HTML 时，读取入口页面并匹配唯一 `Dr.COMWebLoginID_*.htm` 注释 | 仅识别明确页面标记，忽略脚本中的模板名；无标记或标记矛盾视为状态未知 |
| 注销 | GET `/drcom/logout`，不发送账号密码，随后查询状态确认 | 上游没有发布注销请求；当前沿用 Dr.COM 接口，仍需校内验证 |

登录先读取并识别认证页，获取当前设备参数；不执行网页脚本或自动化浏览器。登录和注销均需要后续状态复核。超时、HTTP 错误、未知响应或矛盾结果不会当作离线，也不会据此触发自动重连。页面跳转限制在允许的认证来源内，发现流程不访问登录或注销操作地址。

用户提供的真实登录页截图显示“请选择运营商”下拉框，确认门户存在运营商选择。上游通过浏览器选择运营商，但没有发布认证请求中选项值和账号后缀的可靠映射，因此当前适配仅实现参考脚本的原始学号路径，不提供猜测的运营商选项，尚不宣称支持所有运营商。后续应以浏览器成功登录请求的参数为依据更新适配器。

## 导入、导出和校内验证

内置方案可以直接选择，无需导入。需要保存副本时，在方案卡片点击“导出 JSON”；导出 ID 为 `jdztc-copy`。仓库同时提供可导入的 [jdztc-campus.example.json](../examples/jdztc-campus.example.json)，其外部 ID 为 `jdztc-campus`。

该 JSON 不配置 `operations` 或自定义字段，使用应用受控的 `drcom-eportal` 适配器；仅修改 JSON 不能替换认证流程。导出不包含账号密码、当前设备参数或在线会话。结构与导入要求见 [外部方案指南](plugin-guide.md)。

校内验收应分别确认未认证时的只读检测、原始学号登录、操作后的在线确认、只读刷新、注销及离线确认。还需观察 JCU / JCI 或不同校区是否使用相同入口和参数。校内验证前，不能把本机模拟服务或源码对照视为这些行为已经通过实测。

连接失败时先打开认证页检查账户、欠费或设备上限；应用内可查看“活动日志 → 查看响应”，并导出脱敏诊断信息用于排障。不要分享真实账号密码、Cookie 或带设备参数的完整认证 URL。

## 参考来源与许可

协议事实参考 [pozhu90-alt/jdztc-campus-autologin](https://github.com/pozhu90-alt/jdztc-campus-autologin)，对照提交为 [`74bccd4ed57b150116d8d764fc71e67e88fd407e`](https://github.com/pozhu90-alt/jdztc-campus-autologin/tree/74bccd4ed57b150116d8d764fc71e67e88fd407e)：

- [build/config.blank.json](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/build/config.blank.json)：认证入口和校园 SSID。
- [portal_autofill/autofill_core.js](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/portal_autofill/autofill_core.js#L115)：原始学号、登录接口、参数与编码。

上游 [LICENSE](https://github.com/pozhu90-alt/jdztc-campus-autologin/blob/74bccd4ed57b150116d8d764fc71e67e88fd407e/LICENSE) 声明非商业及衍生作品同许可条件，另有版权说明自称 GPL v3，表述不一致。本次只参考认证地址、参数及流程事实，以岚连现有架构独立实现，没有复制、打包或运行其 PowerShell / JavaScript 源码、界面或统计功能。第三方来源记录见 [第三方声明](../assets/licenses/README.md)。
