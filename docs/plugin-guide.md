# 外部连接方案指南

岚连的外部扩展是声明式 JSON 配置，支持固定 GET/POST 接口的 `http` 方案，以及使用受控适配器的 `drcom`、`drcom-eportal` 和 `ruijie` 方案。当前版本不加载任意脚本，也没有运行第三方代码的插件接口。

本指南的请求模板、操作定义与响应规则适用于 `http`。Dr.COM 和锐捷方案不配置 `operations`，使用应用固定的认证流程；锐捷请同时阅读 [锐捷校园网方案制作教程](ruijie-guide.md)，按实际认证页配置发现入口、跳转源、公钥和服务。景陶的 Dr.COM ePortal 配置见 [景陶接入说明](jdztc-guide.md)，与锐捷的同名 ePortal 产品使用不同协议。

开发者：**NingMeng123** · [GitHub 主页](https://github.com/65658dsf)

## 导入和更新

1. 在“连接方案”点击“导出方案示例”（HTTP）或“导出锐捷示例”，将示例保存为 `.json` 文件。
2. 根据学校实际认证接口修改文件，使用 UTF-8 编码保存。
3. 点击“导入连接方案”选择文件。导入只做格式校验和本地保存，不会提交认证请求。
4. 在方案卡片点击“使用此方案”，返回连接概览填写账号、密码和自定义字段。

单个文件不能超过 64 KB，最多保存 30 个外部方案。相同 `id` 不能重复导入；更新时先移除旧方案再导入，或使用新的 ID。已认证时不能切换或移除当前方案，内置方案不能移除。

## 导出已有方案

在任意方案卡片点击“导出 JSON”，选择保存位置，即可得到 UTF-8 编码的完整声明式配置。Dr.COM 的自动发现设置、HTTP 的登录/注销/状态请求与响应规则、锐捷的发现入口、公钥和服务配置都会保留，导出的文件可在同一应用或另一台安装岚连的设备上导入。

内置方案导出时移除 `builtin-` 前缀并添加 `-copy`，例如贵州轻工职业大学为 `gzqy-copy`、四川大学为 `scu-ruijie-copy`、景德镇陶瓷大学为 `jdztc-copy`，避免占用禁止外部使用的 `builtin-` 前缀。外部方案保留原 ID；同一 ID 已存在时仍会拒绝导入，不会覆盖旧方案。需要保留多个变体时，先修改副本的 `id` 和 `name`。

导出读取保存的方案定义，不会把应用设置、当前账号、保存的密码、当前选择的自定义字段值、Cookie、在线会话或运行时发现的地址拼接到文件里。方案本身声明的固定值、默认值、请求模板仍会保留，请不要将个人密码、令牌等直接写在方案定义中。

## Dr.COM 副本与兼容方案

可以从贵州轻工职业大学卡片导出 JSON，并根据目标学校已核验的信息修改 `id`、`name`、`homepage` 等声明字段。`protocol` 保持 `drcom` 时，应用继续使用内置适配器的 `/drcom/login`、`/drcom/logout`、`/drcom/chkstatus` 流程和状态复核，不允许通过 JSON 覆写 `operations` 或增加脚本。

可保留 `portalDiscovery` 自动发现当前网络认证入口；`homepage` 是发现失败时的已知回退地址。若声明 `fields` 中的 `operator` 字段，必须提供非空单行字符串默认值或选项，它会作为 `R3` 参数发送；不声明时适配器使用 `1`。不要自行猜测运营商编号、账号后缀或服务值。只适用于协议与现有适配器一致的 Dr.COM Web 部署，其他请求参数、签名或认证流程需要修改并测试主程序适配器。

`drcom-eportal` 是另一条 Dr.COM 登录流程：GET `/eportal/`，使用 `c=Portal`、`a=login` 和 `user_account=,0,原始学号`，密码按原值进行 URL 编码。它沿用 Dr.COM 只读状态查询和注销，并在操作后复核状态；不使用 `/drcom/login`，也不使用锐捷 RSA 配置。当前景陶方案不声明 `fields`，不添加账号后缀、不猜测运营商编号。可以直接从景陶卡片导出，或修改 [景陶示例](../examples/jdztc-campus.example.json)；不要把相似的产品名称当作协议兼容证据，其他学校仍需核验。

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
| `homepage` | 是 | 已知认证页 URL，必须使用 HTTP 或 HTTPS；开启网络入口发现时作为回退入口 |
| `protocol` | 是 | `http`、`drcom`、`drcom-eportal` 或 `ruijie`；后三者使用受控适配器 |
| `timeoutMs` | 否 | 单次请求超时，整数 1000–30000 毫秒；默认 10000 |
| `fields` | HTTP / Dr.COM 可选 | 界面上的额外输入项，最多 12 项；Dr.COM 若声明 `operator` 须有非空默认值或选项；锐捷必须声明有非空默认值或选项的 `service` 字段 |
| `operations` | HTTP 必填 | `http` 必须完整提供 `login`、`logout`、`status`；`drcom` / `drcom-eportal` / `ruijie` 禁止设置此字段 |
| `ruijie` | 锐捷必填 | 仅 `ruijie` 使用的发现与加密配置，详见 [锐捷教程](ruijie-guide.md) |
| `portalDiscovery` | 否 | 仅 `drcom` / `drcom-eportal` / `ruijie` 支持；形如 `{ "url": "http://www.msftconnecttest.com/redirect" }`，开启只读网络入口发现 |

不接受未声明的额外属性。配置中的 URL 必须为固定字符串，不能包含用户名密码、片段 `#...` 或模板变量。HTTP 方案所有操作的 URL 必须与 `homepage` **同源**，即协议、主机、端口完全相同；不同路径可以使用。认证页在端口 80、接口在端口 801 的通用 HTTP 方案不能以这两个地址直接组合通过校验。

锐捷方案的已知发现入口仍与 `homepage` 同源，发现链的中转来源由 `redirectOrigins` 声明。可选 `portalDiscovery` 则先从当前网络的只读探测响应识别真实门户来源；识别成功后使用该来源进行认证，未识别时回退已知入口。它支持内置及外部 `drcom` / `drcom-eportal` / `ruijie`，不支持通用 `http`。

内置方案、锐捷示例与景陶示例默认使用 `http://www.msftconnecttest.com/redirect`。该地址只是探测入口，正常 MSN/Bing 跳转不是校园网成功信号，账号密码不会被提交给 Microsoft。应用只在运行期间复用已识别的服务器来源，不持久保存发现出的 `queryString`、MAC 或其他临时参数。完整配置与抓包步骤见 [锐捷教程](ruijie-guide.md#3-找到认证服务器与发现入口)。

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

`http` 方案适用于请求结构固定、能直接得到 JSON、JSONP 或文本状态的认证服务。`ruijie` 已为指定的 ePortal Web 流程实现跳转参数发现、临时 Cookie、RSA 零填充和操作后状态复核，配置方式见 [锐捷教程](ruijie-guide.md)。以下能力不属于通用 `http` 模板；不符合现有锐捷流程的学校仍需新增并测试主程序适配器：

- 多步骤挑战应答、RSA/MD5 等动态密码变换、动态验证码。
- 从前一个响应提取 token，再放入下一个请求。
- 必须持久化 Cookie 的会话流程、浏览器单点登录、认证跳转链。
- 自动解析重定向 URL 获得客户端 IP/MAC/AC，或自动选择网卡。
- 需要跨源接口、自定义授权头、WebSocket、UDP 或 PPPoE 拨号的协议。
- 需要启动外部程序、执行系统命令或运行 JavaScript 的连接方法。

外部 `drcom` / `drcom-eportal` 方案可以复用相应受控适配器、另存配置副本，但不能替换内置方案或覆写适配器实现。若学校修改了协议，应参照 [认证协议核验](portal-protocol.md) 与 [景陶接入说明](jdztc-guide.md) 更新适配器，并使用模拟服务覆盖变更。

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
