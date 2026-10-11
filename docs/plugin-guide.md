# 外部连接方案指南

岚连的外部扩展是声明式 JSON 配置，用于描述 HTTP 认证接口。无需修改应用代码即可增加使用固定 GET/POST 请求的校园网方案。当前版本不加载任意脚本，也没有运行第三方代码的插件接口。

开发者：**NingMeng123** · [GitHub 主页](https://github.com/65658dsf)

## 导入和更新

1. 在“连接方案”点击“导出方案示例”，将示例保存为 `.json` 文件。
2. 根据学校实际认证接口修改文件，使用 UTF-8 编码保存。
3. 点击“导入连接方案”选择文件。导入只做格式校验和本地保存，不会提交认证请求。
4. 在方案卡片点击“使用此方案”，返回连接概览填写账号、密码和自定义字段。

单个文件不能超过 64 KB，最多保存 30 个外部方案。相同 `id` 不能重复导入；更新时先移除旧方案再导入，或使用新的 ID。已认证时不能切换或移除当前方案，内置方案不能移除。

## 完整示例

下面与仓库中的 [custom-campus.example.json](../examples/custom-campus.example.json) 使用相同格式。地址和运营商选项都是教学占位值，必须替换为目标学校实际信息。

```json
{
  "schemaVersion": 1,
  "id": "example-campus",
  "name": "示例大学 · HTTP 表单",
  "description": "可编辑示例；请把认证页、请求端点和响应判断替换为学校实际值。默认示例域名不可用于校园网登录。",
  "version": "1.0.0",
  "author": "NingMeng123",
  "homepage": "https://campus.example.invalid/",
  "protocol": "http",
  "timeoutMs": 10000,
  "fields": [
    {
      "key": "operator",
      "label": "运营商",
      "default": "campus",
      "options": [
        { "label": "校园网", "value": "campus" },
        { "label": "移动", "value": "mobile" }
      ]
    }
  ],
  "operations": {
    "login": {
      "url": "https://campus.example.invalid/api/login",
      "method": "POST",
      "encoding": "form",
      "data": {
        "username": "{{username}}",
        "password": "{{password}}",
        "operator": "{{operator}}"
      },
      "success": { "type": "json", "path": "success", "equals": true },
      "failure": { "type": "json", "path": "success", "equals": false }
    },
    "logout": {
      "url": "https://campus.example.invalid/api/logout",
      "method": "POST",
      "encoding": "json",
      "data": { "username": "{{username}}" },
      "success": { "type": "json", "path": "success", "equals": true },
      "failure": { "type": "json", "path": "success", "equals": false }
    },
    "status": {
      "url": "https://campus.example.invalid/api/status",
      "method": "GET",
      "encoding": "form",
      "data": {},
      "success": { "type": "json", "path": "online", "equals": true },
      "failure": { "type": "json", "path": "online", "equals": false }
    }
  }
}
```

例如，登录服务器返回 `{"success":true}` 时，本例判定认证成功；返回 `{"success":false}` 时判定失败。状态接口则读取独立的 `online` 布尔字段。接口仅返回 HTTP 200 不足以判定成功。

## 顶层字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 当前只能为数字 `1` |
| `id` | 是 | 3–64 个字符，小写字母开头，只含小写字母、数字、连字符；不得使用 `builtin-` 前缀 |
| `name` | 是 | 界面显示名称，最多 80 字符 |
| `description` | 否 | 简介，最多 800 字符 |
| `version` | 是 | 版本字符串，最多 32 字符，例如 `1.0.0` |
| `author` | 否 | 作者，最多 80 字符 |
| `homepage` | 是 | 可打开的认证页 URL，必须使用 HTTP 或 HTTPS |
| `protocol` | 是 | 外部方案固定为 `http`；`drcom` 仅供内置适配使用 |
| `timeoutMs` | 否 | 单次请求超时，整数 1000–30000 毫秒；默认 10000 |
| `fields` | 否 | 界面上的额外输入项，最多 12 项 |
| `operations` | 是 | 必须完整提供 `login`、`logout`、`status` 三个操作 |

不接受未声明的额外属性。URL 必须为固定字符串，不能包含用户名密码、片段 `#...` 或模板变量。所有操作的 URL 必须与 `homepage` **同源**，即协议、主机、端口完全相同；不同路径可以使用。认证页在端口 80、接口在端口 801 的通用方案不能以这两个地址直接组合通过校验。

## 自定义字段和变量

`fields` 中的每项支持：

| 字段 | 说明 |
| --- | --- |
| `key` | 1–40 字符，以英文字母开头，其后为字母、数字或下划线；唯一且不能为 `username`、`password` 等保留名 |
| `label` | 界面标签，最多 80 字符 |
| `default` | 默认字符串，最多 500 字符，可为空 |
| `placeholder` | 可选输入提示，最多 160 字符 |
| `options` | 可选下拉选项，1–20 项；每项为 `label` / `value`，`value` 必须是字符串 |

没有 `options` 时显示普通文本输入框；有 `options` 时显示下拉选择。如果设置了默认值，该值必须出现在选项中。字段值是普通设置，不使用密码加密存储，勿把密码、令牌放入自定义字段。

请求 `data` 内可以使用以下变量：

| 变量 | 来源 |
| --- | --- |
| `{{username}}` | 用户输入的账号 |
| `{{password}}` | 用户输入或由系统安全存储解密的密码，仅用于认证需要的操作 |
| `{{字段key}}` | 已在 `fields` 中声明的自定义字段 |
| `{{ip}}`、`{{mac}}`、`{{acIp}}`、`{{acName}}` | 预留网络参数；默认空字符串，当前不会自动发现 |

若协议要求固定的 IP、MAC 或 AC 地址，应将相应名称定义为自定义字段供用户填写。不要假设这些变量会自动获得校园网重定向参数。

模板支持字符串拼接，例如 `"account": "{{username}}@example"`。后缀只有经学校实际协议确认后才应添加。模板只替换参数值，不执行表达式、函数、编码脚本或数学运算；未知变量会导致导入失败。通常输入原始值即可，应用会负责表单或查询参数的 URL 编码。

## 操作定义

每个操作允许以下字段：

| 字段 | 说明 |
| --- | --- |
| `url` | 与认证页同源的固定接口 URL |
| `method` | `GET` 或 `POST`；状态查询必须为 `GET` |
| `encoding` | `form` 或 `json`；GET 只能为 `form` |
| `headers` | 可选，仅接受 `Accept`、`X-Requested-With` |
| `data` | 必填对象，最多 50 个参数；不需要参数时填写 `{}` |
| `success` | 必填成功规则 |
| `failure` | 必填失败规则 |

GET 会将参数放入 URL 查询字符串；POST + `form` 使用 `application/x-www-form-urlencoded`；POST + `json` 使用 `application/json`。`data` 的每个值都必须是字符串，因此 JSON 请求体也会发送字符串值，当前不支持嵌套对象、数组、数字或布尔值作为请求参数值。

参数值最长 2048 字符。`Content-Type` 由编码类型决定，不能通过 `headers` 自定义；Cookie、Authorization 和任意其它请求头也不支持。应用拒绝跟随 HTTP 重定向，响应正文最多 1 MiB。

`status` 必须配置为真正只读的查询接口，禁止包含 `{{password}}`。成功规则表示“在线”，失败规则表示“离线”；超时、HTTP 错误或无法识别的响应表示状态未知。应用不会推断任意 GET 都具有只读语义，方案作者需要选对接口。

v1 方案必须提供完整的登录、注销和只读状态查询接口，缺少其中任何一项都会拒绝导入。若目标学校没有可用的只读状态接口，不要把登录或注销地址冒充状态查询；此时需要扩展主程序适配器。

## 响应规则

### JSON / JSONP

```json
{ "type": "json", "path": "data.online", "equals": true }
```

支持用点分路径读取响应对象字段，也可以用数字路径段索引数组。`equals` 支持字符串、数字或布尔值，使用严格相等：数字 `1` 与字符串 `"1"` 不相同。

JSONP 只允许普通回调函数包装的 JSON，例如 `dr1003({"result":1});`。应用移除包装后解析 JSON，不执行回调代码。如果服务器要求 JSONP 回调参数，可在 `data` 中声明固定字符串，例如 `"callback": "dr1003"`；当前不支持生成随机回调名。

### 文本包含

```json
{ "type": "text", "includes": "明确的已登录标记" }
```

文本规则进行区分大小写的包含判断，不支持正则表达式。应选择已观察到、只在对应状态出现的标记，避免使用登录表单中也会出现的“成功”“登录”等宽泛词语。

每个操作只能配置一条成功规则和一条失败规则，不支持规则组合或多个备选值。两条规则不能完全相同；实际响应同时匹配二者或二者均不匹配时会报告异常，不能误显示为已连接。

## 能力边界

当前声明式方案适用于请求结构固定、能直接得到 JSON、JSONP 或文本状态的认证服务。以下场景需要新增并测试主程序适配器，不能只靠 JSON 完成：

- 多步骤挑战应答、RSA/MD5 等动态密码变换、动态验证码。
- 从前一个响应提取 token，再放入下一个请求。
- 必须持久化 Cookie 的会话流程、浏览器单点登录、认证跳转链。
- 自动解析重定向 URL 获得客户端 IP/MAC/AC，或自动选择网卡。
- 需要跨源接口、自定义授权头、WebSocket、UDP 或 PPPoE 拨号的协议。
- 需要启动外部程序、执行系统命令或运行 JavaScript 的连接方法。

也不能通过导入文件替换内置的贵州轻工职业大学 `drcom` 实现。若学校修改了协议，应参照 [认证协议核验](portal-protocol.md) 更新适配器，并使用模拟服务覆盖变更。

## 本地校验和调试

导入前可以在项目目录运行相同的解析校验器，不会触发任何网络请求：

```powershell
node -e "const fs=require('node:fs'); const {parseProfile}=require('./electron/profiles.cjs'); const p=parseProfile(fs.readFileSync(process.argv[1],'utf8')); console.log('配置有效：'+p.name);" .\examples\custom-campus.example.json
```

校验成功只代表结构符合要求，不代表地址可达或能登录学校网络。完整开发测试使用 `npm test`，通过本机模拟服务器检查编码与响应解析；不要把真实认证 endpoint 放进无人值守测试中。

常见导入错误对应处理：

| 提示 | 处理 |
| --- | --- |
| ID 已存在 | 移除旧外部方案，或使用新的唯一 ID |
| 包含不支持字段 | 对照本指南和 `electron/profiles.cjs` 删除未知属性 |
| 请求必须同源 | 核对认证页和全部接口的协议、主机、端口 |
| 未声明的模板变量 | 在 `fields` 中声明该变量，或修正变量拼写 |
| `data` 值必须是字符串 | 将固定数值写成字符串，例如 `"1"` |
| 响应未匹配成功或失败规则 | 对照实际响应结构、字段类型和明确状态标记调整规则 |

分享方案时只包含服务器地址和协议结构，不包含任何个人账号、密码、Cookie、token、客户端 IP/MAC 或私有页面副本。
