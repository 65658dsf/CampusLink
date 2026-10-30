# 外部校园网连接方案

| 示例 | 用途 |
| --- | --- |
| [custom-campus.example.json](custom-campus.example.json) | 固定 HTTP 接口；使用 `.invalid` 占位域名，需替换认证地址、请求字段和响应规则 |
| [ruijie-campus.example.json](ruijie-campus.example.json) | 制作其他学校的锐捷 ePortal Web 方案；地址、跳转源、公钥、服务名称均需确认和替换 |
| [ruijie-scu.example.json](ruijie-scu.example.json) | 四川大学锐捷参考配置，与内置方案使用相同协议参数，但使用可导入的外部 ID |
| [jdztc-campus.example.json](jdztc-campus.example.json) | 景德镇陶瓷大学 Dr.COM ePortal 参考配置，使用可导入的外部 ID；尚需校内验证 |

前两项是结构示例，不能直接用于真实校园网认证。川大和景陶参考配置均未在对应学校真实网络验证；不要将其地址或密钥直接套用到其他学校。锐捷方案详细制作、抓包和编码说明见 [锐捷教程](../docs/ruijie-guide.md)；景陶的协议、使用和验证边界见 [景陶接入说明](../docs/jdztc-guide.md)。

本应用只读取声明式 JSON，不运行插件 JavaScript。文件上限 64 KB，最多导入 30 个方案。方案 ID 必须唯一，外部方案不能使用 `builtin-` 前缀。应用会校验全部字段，拒绝未知字段和模板变量。

## 基础结构

`schemaVersion` 固定为 `1`。共有必填字段为 `id`、`name`、`version`、`homepage`、`protocol`。`description`、`author`、`timeoutMs` 可选。`timeoutMs` 默认 10000，范围为 1000 至 30000。

`http` 必须配置 `operations`，`fields` 可选。`ruijie` 必须配置 `ruijie` 及含 `service` 的 `fields`，不得设置 `operations`；`service` 须有非空默认值或非空选项。`drcom` / `drcom-eportal` 使用应用内相应的受控适配器，不得设置 `operations`；可以从现有 Dr.COM 方案卡片导出 JSON 后修改配置并重新导入。景陶的 `drcom-eportal` 示例不声明自定义字段，也不使用锐捷配置。

每张方案卡片都有“导出 JSON”按钮，导出完整的方案定义，不包含当前输入的账号密码或临时设备参数。内置方案会使用不带 `builtin-` 前缀的副本 ID，外部方案保留原 ID。完整导出和导入流程见 [方案指南](../docs/plugin-guide.md)。

`homepage` 保存已知认证入口。HTTP 方案每个请求端点必须和它使用同一协议、主机及端口，且不跟随重定向。锐捷方案可优先从网络探测识别真实认证来源，未识别时回退 `homepage` / `ruijie.discoveryUrl`；认证只发送到识别出的 ePortal 或已知回退服务器。支持局域网 HTTP 和 HTTPS。校方只提供 HTTP 时，认证流量无法由本工具自动变成 HTTPS。

顶层可选 `portalDiscovery` 仅供 `drcom` / `drcom-eportal` / `ruijie` 使用：`{ "url": "http://www.msftconnecttest.com/redirect" }`。内置方案、锐捷示例与景陶示例默认带有该配置；通用 HTTP 示例不使用。应用通过只读 GET 识别门户，不向探测地址或正常 MSN/Bing 跳转提交账号密码，也不把普通互联网页面当成已登录。发现缓存只复用运行期间的真实服务器来源，不持久保存临时查询串、MAC 或设备参数。

## HTTP 请求与判断

`operations.login`、`logout` 和 `status` 均必填，保证方案包含完整的登录、注销和只读状态查询能力。缺少操作的文件无法导入。

每个操作包含 `url`、`method`、`encoding`、`data`、`success`、`failure`：

- `method`：`GET` 或 `POST`。状态查询必须为只读 GET，地址本身也应由方案作者确认为查询端点。
- `encoding`：`form` 或 `json`。GET 仅支持 form，即 URL 查询参数；POST 支持表单和 JSON 请求体。
- `data`：键值均为字符串；值支持 `{{username}}`、`{{password}}`、`{{ip}}`、`{{mac}}`、`{{acIp}}`、`{{acName}}` 及 `fields` 声明的变量。未提供的非凭据变量为空；如需用户填写 IP 等参数，应在 `fields` 声明同名字段。状态请求禁止使用密码变量。
- `headers` 可选，只允许 `Accept` 和 `X-Requested-With`。
- JSON 判断：`{"type":"json","path":"data.online","equals":true}`，仅支持点分隔属性路径及字符串、数字、布尔值的严格相等。
- 文本判断：`{"type":"text","includes":"authentication succeeded"}`，使用区分大小写的子字符串匹配。

成功和失败都必须明确配置；未匹配、同时匹配、超时、响应过大或 HTTP 错误都会失败。对于 `status`，`success` 表示在线，`failure` 表示离线。JSONP 只会作为 JSON 解析，不会执行其内容。账号、密码和请求体不会写入日志。

`fields` 最多 12 项，每项包含唯一 `key` 和 `label`，可选 `default`、`placeholder`、`options`。有 `options` 时渲染选择器，每个选项由 `label` 和 `value` 组成。没有选项时渲染输入框。密码由应用独立管理，禁止声明 `username` 或 `password` 字段。

仅导入你理解并信任的方案：认证操作会把你填写的账号、密码发送给方案指定的认证服务器。

## 锐捷 ePortal Web 方案

应用的「导出锐捷示例」导出 [ruijie-campus.example.json](ruijie-campus.example.json)。保留顶层 `portalDiscovery` 可优先发现当前网络的真实认证地址，同时按学校网页填写已知回退入口 `homepage` / `ruijie.discoveryUrl`、`redirectOrigins`、`publicKey`、`serviceEncoding` 与 `fields` 的 `service` 值，然后导入；不需要手工填写当前客户端的 IP、MAC 或 `queryString`。

`discoveryUrl` 与 `homepage` 同源，省略时使用 `homepage`；`redirectOrigins` 仅填写其他允许发现的来源，如 `http://123.123.123.123`，不能带尾部斜杠、路径或参数。公钥是十六进制模数与指数。服务值使用网页原始文本，川大示例的 `percent` 模式会先对中文服务值进行百分号编码，再进行表单编码。其他学校是否使用该模式须检查真实请求。

内置四川大学方案可直接在学校列表中选择，无须重复导入。已有贵州轻工职业大学 Dr.COM 默认方案保持独立。当前锐捷适配范围是网页 ePortal，不包括 802.1X、二维码/短信登录或自动处理验证码。请按 [详细教程](../docs/ruijie-guide.md) 验证对应部署，不要把本机模拟测试当成校园网实测。

## 贵州轻工职业大学内置方案

根据 2026-10-11 从 `http://10.151.253.10/` 及其公开认证脚本读取的配置，内置方案采用 Dr.COM 本地认证，不拼接未经证实的运营商账号后缀。网络类型为校园网 `R3=1`。

- 登录：GET `/drcom/login`，账号字段 `DDDDD`、密码字段 `upass`；固定参数为 `0MKKey=123456`、`R1=0`、`R2=`、`R3=1`、`R6=0`、`para=00`、`v6ip=`、`terminal_type=1`。
- 注销：GET `/drcom/logout`，不包含账号密码。
- 只读状态：GET `/drcom/chkstatus`。
- 共用查询参数：`callback=dr1003`、`jsVersion=4.2.1`、`lang=zh` 和随机缓存参数 `v`。
- 登录与注销接受 `result=1`、`"1"` 或 `"ok"` 后，会继续读取状态确认实际结果；状态接口 `result=1` / `"1"` 表示在线、`result=0` / `"0"` 表示未认证。状态 IP 从 `v46ip`、`ss5` 或 `v4ip` 读取。

状态端点和脚本已做只读核实。未使用真实账号执行登录或注销，真实账号认证仍需在校内由用户验证。校方协议可能调整，届时可更新内置适配器或导入新的 HTTP 方案。

## 景德镇陶瓷大学 Dr.COM ePortal 方案

内置“景德镇陶瓷大学 · Dr.COM ePortal”可直接选择；[jdztc-campus.example.json](jdztc-campus.example.json) 是同参数的外部副本，ID 为 `jdztc-campus`。也可通过内置卡片“导出 JSON”生成 ID 为 `jdztc-copy` 的副本。

先手动连接 JCU / JCI，再输入原始学号和密码，不追加运营商后缀。已知入口为 `http://172.29.0.2/a79.htm`。登录使用 `/eportal/?c=Portal&a=login`，账号字段为 `user_account=,0,原始学号`；只读状态和注销当前沿用 `/drcom/chkstatus`、`/drcom/logout`，并在操作后复核。未知响应、超时或 HTTP 错误不当作离线。上游没有提供景陶状态及注销接口证据，这些行为仍需校内验证。

该协议为 `drcom-eportal`，与锐捷 `ruijie` ePortal Web 不同；上游 README 的“深澜”描述与实际登录脚本不一致。岚连仅参考公开认证地址和协议事实独立实现，没有复制上游源码。完整来源、许可说明及验证范围见 [景陶接入说明](../docs/jdztc-guide.md)。

## 保存位置

Windows 配置存放在 Electron `app.getPath('userData')` 对应的 `settings.json`，通常是 `%APPDATA%\岚连 · Campus Link\settings.json`。配置包含账号、偏好、外部方案和可选加密密码。密码通过 Electron `safeStorage` 使用 Windows DPAPI 加密，不以明文写盘；关闭「记住密码」或点击「清除已保存密码」会移除已保存密码并关闭自动连接。

开机自启动只在 Windows 打包版中注册当前应用，不会在开发模式下注册 Electron 开发工具。自启动与启动后自动认证是两个独立开关；自动认证必须主动开启并已保存密码，启动时会先检查状态，已在线则跳过认证，状态查询失败也不盲目提交密码。关闭应用不会自动注销校园网；如需退出认证，请先点「断开」。

开发者：[NingMeng123](https://github.com/65658dsf)。
