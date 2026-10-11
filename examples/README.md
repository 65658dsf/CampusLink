# 外部校园网连接方案

`custom-campus.example.json` 是可直接导入的结构示例，使用保留域名 `campus.example.invalid`，不会向真实学校提交账号。请复制后将认证地址、请求字段和响应规则改为学校公布或认证页实际使用的协议，再在岚连的「连接方案」中导入。

本应用只读取声明式 JSON，不运行插件 JavaScript。文件上限 64 KB，最多导入 30 个方案。方案 ID 必须唯一，外部方案不能使用 `builtin-` 前缀。应用会校验全部字段，拒绝未知字段和模板变量。

## 基础结构

`schemaVersion` 固定为 `1`。必填字段为 `id`、`name`、`version`、`homepage`、`protocol` 和 `operations`。外部方案的 `protocol` 为 `http`；`description`、`author`、`fields`、`timeoutMs` 可选。`timeoutMs` 默认 10000，范围为 1000 至 30000。

`homepage` 是用户点击「打开认证页」访问的网址。每个请求端点必须和它使用同一协议、主机及端口；重定向不会被自动跟随。支持局域网 HTTP 和 HTTPS。校方只提供 HTTP 时，认证流量无法由本工具自动变成 HTTPS。

## 请求与判断

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

## 贵州轻工职业大学内置方案

根据 2026-10-11 从 `http://10.151.253.10/` 及其公开认证脚本读取的配置，内置方案采用 Dr.COM 本地认证，不拼接未经证实的运营商账号后缀。网络类型为校园网 `R3=1`。

- 登录：GET `/drcom/login`，账号字段 `DDDDD`、密码字段 `upass`；固定参数为 `0MKKey=123456`、`R1=0`、`R2=`、`R3=1`、`R6=0`、`para=00`、`v6ip=`、`terminal_type=1`。
- 注销：GET `/drcom/logout`，不包含账号密码。
- 只读状态：GET `/drcom/chkstatus`。
- 共用查询参数：`callback=dr1003`、`jsVersion=4.2.1`、`lang=zh` 和随机缓存参数 `v`。
- 登录与注销接受 `result=1`、`"1"` 或 `"ok"` 后，会继续读取状态确认实际结果；状态接口 `result=1` / `"1"` 表示在线、`result=0` / `"0"` 表示未认证。状态 IP 从 `v46ip`、`ss5` 或 `v4ip` 读取。

状态端点和脚本已做只读核实。未使用真实账号执行登录或注销，真实账号认证仍需在校内由用户验证。校方协议可能调整，届时可更新内置适配器或导入新的 HTTP 方案。

## 保存位置

Windows 配置存放在 Electron `app.getPath('userData')` 对应的 `settings.json`，通常是 `%APPDATA%\岚连 · Campus Link\settings.json`。配置包含账号、偏好、外部方案和可选加密密码。密码通过 Electron `safeStorage` 使用 Windows DPAPI 加密，不以明文写盘；关闭「记住密码」或点击「清除已保存密码」会移除已保存密码并关闭自动连接。

开机自启动只在 Windows 打包版中注册当前应用，不会在开发模式下注册 Electron 开发工具。自启动与启动后自动认证是两个独立开关；自动认证必须主动开启并已保存密码，启动时会先检查状态，已在线则跳过认证，状态查询失败也不盲目提交密码。关闭应用不会自动注销校园网；如需退出认证，请先点「断开」。

开发者：[NingMeng123](https://github.com/65658dsf)。
