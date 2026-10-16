# 锐捷校园网方案制作教程

开发者：**NingMeng123** · [GitHub](https://github.com/65658dsf/CampusLink)

本教程适用于**锐捷 ePortal Web 网页认证**。岚连内置贵州轻工职业大学 Dr.COM、四川大学与成都理工大学（宜宾校区）锐捷方案，也允许导入其他学校的锐捷 JSON 配置。首次打开需在“连接方案”中搜索并选择学校，不预选默认方案。认证入口优先从当前网络探测；方案只描述参数，不执行导入文件中的脚本。

四川大学配置来自公开源码对照；当前没有在四川大学真实校园网进行登录、注销或重连验收。本机模拟服务可检查请求、编码和状态处理，但不能证明学校当前部署接受这些参数。

## 1. 先确认学校使用哪种认证

在学校 Wi-Fi 或有线网络下打开官方认证页，按 `F12` 打开开发者工具，选择 **Network / 网络**，开启 **Preserve log / 保留日志**。以自己的账号手动认证一次，筛选 `InterFace.do`。

符合本适配器的常见请求形式是：

```text
POST /eportal/InterFace.do?method=login
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

userId=...&password=...&service=...&queryString=...
&operatorPwd=&operatorUserId=&validcode=&passwordEncrypt=true
```

请从 **Payload / 载荷** 的原始视图检查实际字段，而不只看开发者工具解码后的表格。`password` 应为该部署使用的 RSA 密文，`queryString` 来自本次设备认证页地址。HTTP 200 只代表收到响应；JSON 的 `result` 和再次查询到的认证状态才决定业务是否成功。

如果学校要求安装锐捷 802.1X 客户端、扫码、短信验证码、CAS/统一身份认证、多阶段动态挑战，或者接口路径不是 `/eportal/InterFace.do`，仅填写此 JSON 不足以适配。应增加对应适配器，不能通过改 `protocol` 名称解决。

## 2. 选择正确的起始文件

- 四川大学用户：在应用“连接方案”选择内置 **四川大学 · 锐捷 ePortal**，按账号已开通的服务选择校园网或运营商。无须重复导入。
- 制作其他学校方案：在“连接方案”点击 **导出锐捷示例**，或复制 [ruijie-campus.example.json](../examples/ruijie-campus.example.json)。该文件使用 `.invalid` 地址和不能用于真实认证的示例公钥，必须修改。
- 查看川大参数结构：使用 [ruijie-scu.example.json](../examples/ruijie-scu.example.json)。它与内置方案采用相同参数，外部 ID 为 `scu-ruijie`，可用于学习或维护独立配置。

修改 `id`、`name`、`description`、`version`，将本项目制作的方案 `author` 填为 `NingMeng123`。ID 使用小写字母、数字和连字符，不得以 `builtin-` 开头；不要使用已有外部方案的 ID。通用字段长度及文件大小限制见 [外部连接方案指南](plugin-guide.md#顶层字段)。

## 3. 找到认证服务器与发现入口

先区分三个地址：**网络探测入口**用于触发当前网络的认证跳转；**认证服务器**接收账号密码；**已知回退入口**在未探测到门户时继续提供该学校原有认证路径。

两种内置方案和锐捷示例默认包含以下顶层字段：

```json
"portalDiscovery": {
  "url": "http://www.msftconnecttest.com/redirect"
}
```

这是完整 JSON 中的一个属性，需与 `homepage`、`protocol`、`ruijie` 同级，不是 `ruijie` 内的字段。`portalDiscovery` 可省略；仅支持 `drcom` / `ruijie`，通用 `http` 方案不能添加。网络发现优先于已知入口：应用只读 GET 探测地址，检查网络返回的跳转和门户内容，识别出与当前方案对应的真实 Dr.COM 或 ePortal 服务器后才将它用于认证。没有发现新入口时，优先复用本次运行中已识别的来源；没有缓存时才回退配置中的已知入口。明确识别到协议不匹配时会提示切换方案，不盲目提交账号。

直接接入互联网时，该 Microsoft 地址可能正常跳转到 MSN/Bing 或返回普通网页；这不代表校园网已登录，应用也不会向 Microsoft 提交账号密码。自动发现只解决服务器地址变化，不会自动选择学校、服务名称或加密算法，公钥仍须与目标学校一致。

制作配置时按以下步骤保留可靠的回退信息：

1. 在 Network 中打开成功登录的 `InterFace.do?method=login` 请求，记录完整协议、主机、端口。将该来源已知的认证页填写到 `homepage`，例如 `http://192.168.2.135/`，作为网络发现未能识别门户时的回退地址。
2. 检查未登录时从认证入口开始的 GET 请求与每个 `Location` 响应头。找到可反复使用、与 `homepage` 同源的起始 URL，填写 `ruijie.discoveryUrl`；省略该字段时使用 `homepage`。该字段仍表示已知入口，不要把不同来源的 Microsoft 探测 URL 填在这里。
3. 若中途跨源到另一个发现主机，把那个来源加入 `ruijie.redirectOrigins`。来源只包含 `协议://主机:可选端口`，例如 `http://123.123.123.123`，**不带尾部 `/`、路径、查询参数或片段**。同一来源不要重复填写，最多 8 项；`homepage` 的来源已默认允许。
4. 找到最终 `/eportal/index.jsp?...`。查询参数中必须存在有效的 `mac`。应用会每次重新获取完整 `queryString`，无需把自己的 IP、MAC、设备索引或整段临时查询串写进共享配置。

可以在 Network 保留日志时先访问 `http://www.msftconnecttest.com/redirect`，记录校园网络是否将它转向真实认证页。没有跳转或只到正常互联网网页时，继续检查已知入口。川大的已知入口参考流程如下，其他学校不一定使用相同地址或中转主机：

```text
GET http://192.168.2.135/
  → /eportal/redirectortosuccess.jsp
  → 未登录：中转页 http://123.123.123.123/ 返回认证页 URL
            → http://192.168.2.135/eportal/index.jsp?...&mac=...
  → 已登录：http://192.168.2.135/eportal/success.jsp?userIndex=...
```

确定认证来源后，锐捷适配器跟随该来源及允许中转来源的 HTTP 跳转，并读取网页中明确的 `index.jsp` / `success.jsp` URL 文本；不会运行认证页的 JavaScript。该 ePortal 发现链每次最多处理 6 个地址，循环跳转、未知来源和无法识别的页面不会被当作离线。

发现链使用只读 GET。Cookie 只在本次操作中按来源保存，绝不从一个来源传给另一个允许的中转来源。账号和密码仅 POST 到本次选定认证服务器的固定 `/eportal/InterFace.do`：它可以是网络发现识别出的真实来源，也可以是已知回退来源。认证 POST 不跟随重定向。不要为了绕过错误把不属于学校认证流程的域名加入允许列表。

应用运行期间可以复用已识别的服务器来源（协议、主机、端口）；发现缓存不保存临时 `queryString`、MAC 或设备参数，后续认证仍重新获取当前参数。该缓存不会写入设置文件，退出应用后清除。JSON 中的已知入口和显式配置仍照常保存在方案中。

## 4. 提取学校自己的 RSA 公钥

在开发者工具 **Sources / 源代码** 中搜索 `RSAKeyPair`、`publicKey`、`modulus`、`exponent` 或 `passwordEncrypt`；也可以从 Network 查找认证页加载的加密脚本。找到实际用于登录密码的公钥模数与指数，填写到 `ruijie.publicKey`：

| 字段 | 格式 |
| --- | --- |
| `modulus` | 十六进制字符串，不带 `0x`；数值为 512–4096 bit 的正奇数，字符串最多 1024 个十六进制字符 |
| `exponent` | 十六进制字符串，不带 `0x`；数值为 `3` 至 `0xffffffff` 的奇数，最多 8 个十六进制字符；常见值 `10001` 表示十进制 65537 |

川大公开实现的完整密钥已经放在 [川大示例](../examples/ruijie-scu.example.json) 中。其他学校可能采用不同密钥，不要直接照搬；结构校验通过也不代表密钥正确。

还需核对网页加密过程是否与适配器一致：拼接 `密码 + ">" + mac`，反转 UTF-16 字符单元，按旧版浏览器 RSA 的小端字打包、零填充和模幂输出十六进制密文。标准 OAEP、PKCS#1 随机填充、UTF-8 后直接加密等流程都不同，不能只替换公钥实现兼容。

这一步读取的是公开密钥，不需要也不应收集服务器私钥。RSA 密码变换是对学校现有协议的兼容，并不把 HTTP 连接变成 HTTPS。

## 5. 配置服务名称与编码

每个锐捷方案必须在 `fields` 中声明 `key: "service"`，并提供非空默认值或非空选项。值要与认证页使用的服务名称一致；下拉框的展示文字与提交值可以不同，例如：

```json
{
  "key": "service",
  "label": "网络服务",
  "default": "internet",
  "options": [
    { "label": "校园网", "value": "internet" },
    { "label": "电信出口", "value": "电信出口" }
  ]
}
```

这是 `fields` 数组中的一项，不是完整可导入文件。其他学校的服务名称未必为 `internet` 或“电信出口”；应以真实成功请求为准。不要自动给账号添加运营商后缀。

`ruijie.serviceEncoding` 控制**进入表单编码之前**是否再进行一次百分号编码：

| 模式 | JSON 中的服务值 | 请求正文中的结果 |
| --- | --- | --- |
| `plain`（默认） | `电信出口` | `service=%E7%94%B5%E4%BF%A1%E5%87%BA%E5%8F%A3` |
| `percent` | `电信出口` | `service=%25E7%2594%25B5%25E4%25BF%25A1%25E5%2587%25BA%25E5%258F%25A3` |

川大参考代码把已编码的服务名称交给表单序列化，因此川大配置使用 `percent`，JSON 中仍填写中文原文。不要把 `%E7...` 预先写入 `value` 再选择 `percent`，否则会多编码一次。英文 `internet` 在两种模式下相同，只有测试该值不能验证中文编码是否正确。

在 Chrome/Edge 载荷面板选择原始正文查看 `%25`，或复制请求为 cURL 后在本地检查 `--data-raw`，以区分一次和两次编码。只检查文本，不必重复执行复制出的请求。对外分享之前删除账号、密码、Cookie、`queryString` 和设备信息。

## 6. `ruijie` 配置字段速查

| 字段 | 要求与默认值 |
| --- | --- |
| `protocol` | 必须为 `ruijie` |
| `homepage` | 必填，学校已知认证页；作为未识别到网络门户时的回退入口 |
| `portalDiscovery` | 可选顶层对象，仅包含 `url`；两种内置方案和锐捷示例默认使用 `http://www.msftconnecttest.com/redirect` |
| `ruijie.discoveryUrl` | 可选，与 `homepage` 同源；默认 `homepage`，保持作为已知发现入口，网络发现优先 |
| `ruijie.redirectOrigins` | 可选，默认 `[]`；最多 8 个无重复、无尾部斜杠的完整来源 |
| `ruijie.publicKey` | 必填，只包含 `modulus`、`exponent` 两个十六进制字符串 |
| `ruijie.serviceEncoding` | 可选，`plain` 或 `percent`；默认 `plain` |
| `ruijie.passwordWithMac` | 可选布尔值，默认 `true`，RSA 输入为 `密码 + ">" + mac`；仅在学校网页脚本确认只加密密码时设为 `false` |
| `ruijie.serviceOptional` | 可选布尔值，默认 `false`；为 `true` 时允许省略或留空 `service`，适用于登录时不选择网络服务的部署 |
| `ruijie.valueEncoding` | 可选，`plain` 或 `percent`；默认 `plain`。`percent` 对账号与 `queryString` 在表单序列化前再编码一次 |
| `fields` | 默认必须包含 `service` 字段，提供非空默认值或非空选项；`serviceOptional` 为 `true` 时可省略 |
| `operations` | 锐捷方案不允许填写；由主程序固定实现登录、注销和状态检查 |

这里只能配置以上能力。添加 `headers`、动态脚本、任意 API 路径或未知属性会被拒绝，不能把通用 HTTP 的 `operations` 复制到锐捷方案中。

成都理工大学（宜宾校区）内置方案启用 `serviceOptional: true` 与 `valueEncoding: "percent"`，登录提交空服务名，账号与查询串在表单中呈现双重编码。密码仍使用默认的 `密码>mac` RSA 输入，与川大方案一致。参数来自 PR 提供的抓包对照，本项目使用本机模拟服务验证，仍需相应校园实际网络验收。

## 7. 导入、检查和实际验收

在项目根目录先做离线结构检查：

```powershell
node -e "const fs=require('node:fs'); const {parseProfile}=require('./electron/profiles.cjs'); const p=parseProfile(fs.readFileSync(process.argv[1],'utf8')); console.log('配置有效：'+p.name);" .\examples\ruijie-campus.example.json
```

将最后的文件路径替换成自己的配置。此命令不会请求学校服务器；示例占位地址和示例密钥也能通过结构检查，必须先替换为真实参数才能使用。

1. 打开岚连“连接方案 → 导入连接方案”，选择 UTF-8 JSON。核对导入提示中的学校、来源与服务，导入本身不会提交账号密码。
2. 点击“使用此方案”。已有认证时先按正常操作退出当前会话，再切换方案。
3. 在已登录状态点击“检测网络”，应直接显示已登录，不应重复提交密码。
4. 在自己可以中断网络的时间，点击“注销校园网”。应用应确认离线并暂停网络守护。
5. 输入自己的账号密码和正确服务，手动连接；状态确认在线后才算完成登录验收。
6. 如需测试重连，在手动连接成功且守护开启后验证实际断线恢复。通过“注销校园网”触发的退出会暂停守护，不能用它模拟需要自动恢复的意外断线。

不应在 CI 或无人值守测试中使用真实账号、真实校园网地址执行登录/注销。`npm test` 使用本机模拟服务，不改变真实校园网会话。

## 8. 状态判断、注销与重连规则

锐捷状态检查复用 GET 发现链。只有实际取到本次选定认证来源的 `/eportal/success.jsp` 才认定在线；取到该来源的 `/eportal/index.jsp` 且包含有效设备参数才认定离线。`redirectortosuccess.jsp` 本身不是成功页，Microsoft 探测入口的普通联网结果也不是校园网在线依据。超时、返回其他网页或陌生跳转均代表未知状态，不会触发自动重连。

连接前发现已在线时直接返回在线状态，避免重复登录。登录 POST 返回 `result: "success"` 后，应用再次 GET 检查在线状态；校验失败时提示暂时无法确认，不把“服务器接受了请求”当作完成认证。

注销也先检查状态，已离线时直接结束；在线时从成功页提取 `userIndex`（如果存在），提交 `method=logout`。存在索引则提交该字段，缺少索引时采用川大参考实现的空正文方式。服务器接受注销后，再用 GET 确认离线。要求其他注销字段或独立状态 API 的部署不在此配置能力范围内。

认证成功或确认在线后接入应用已有的网络守护，新用户默认 10 秒，已有设置保持原值，设置中可调整或关闭。只有明确离线时才使用本次会话或已保存凭据尝试连接；用户手动注销会暂停守护，托盘菜单也可暂停或恢复守护。

## 9. 排错与能力边界

| 现象 | 检查方式 |
| --- | --- |
| 探测地址正常跳转 MSN/Bing | 这通常是普通互联网返回结果，应用不会对它认证；检查已知学校入口是否可达及当前是否接入正确校园网 |
| 当前认证类型与所选方案不同 | 切换到匹配的 Dr.COM 或锐捷方案，再按该学校的服务和公钥配置认证 |
| 跳转到了未允许的地址 | 对照 Network 的 `Location` 或页面中的 URL；只为确认属于学校流程的来源添加 `redirectOrigins` |
| 缺少有效设备参数 | 检查是否已接入校园网络、发现入口是否正确，以及最终认证页是否包含 `mac`；不要填入另一台设备的参数 |
| 无法识别认证页面 | 可能是门户版本、路径或脚本流程不同；记录脱敏响应，不能简单改成“离线”绕过 |
| 学校网页能登录、应用失败 | 对照服务值、单次/双次编码、公钥及加密流程，并检查账号是否有运营商后缀要求；未知差异需要适配器支持 |
| 服务器提示验证码 | 在官方认证页完成验证码后回到应用检测；本适配器不自动识别或绕过验证码 |
| 请求已接受但无法确认状态 | 检查之后的 GET 发现链，稍后手动检测；不要因 HTTP 200 就认定在线或离线 |

活动日志中的“查看响应”提供脱敏的请求信息和纯文本响应。复制详情前仍应检查是否含学校私有信息；不要公开原始 HAR、完整 cURL 或包含个人设备参数的认证页。

川大参考项目特别说明中转设备对请求头大小写存在兼容性要求。适配器使用 `Host:`（首字母 H 大写）发送请求；这是特定设备行为，不代表 HTTP 标准要求请求头区分大小写。

本适配器不支持任意网页脚本执行、自动图形验证码、短信/二维码认证、802.1X、PPPoE、任意多阶段挑战、自动寻找网卡或接口路径改写。学校更换公钥时可更新 JSON；变更加密算法、认证路径或成功页规则时需更新主程序并补充模拟测试。

## 参考来源与许可

以下来源用于协议对照，不表示上游作者或学校为本应用背书：

- 指定参考项目 [LFWQSP2641/scu_net_auto_login](https://github.com/LFWQSP2641/scu_net_auto_login)，固定提交 `194c8b9da995eeef4f6d1f3b83a9f03350293bb0`：[发现与登录实现](https://github.com/LFWQSP2641/scu_net_auto_login/blob/194c8b9da995eeef4f6d1f3b83a9f03350293bb0/ScuNetAutoLogin/ServiceLib/Service/LoginService.cs)、[协议常量](https://github.com/LFWQSP2641/scu_net_auto_login/blob/194c8b9da995eeef4f6d1f3b83a9f03350293bb0/ScuNetAutoLogin/ServiceLib/Common/LoginConstants.cs)、[RSA 实现](https://github.com/LFWQSP2641/scu_net_auto_login/blob/194c8b9da995eeef4f6d1f3b83a9f03350293bb0/ScuNetAutoLogin/ServiceLib/Helper/LegacyCampusRsaEncryptor.cs)、[RSA 固定测试向量](https://github.com/LFWQSP2641/scu_net_auto_login/blob/194c8b9da995eeef4f6d1f3b83a9f03350293bb0/ScuNetAutoLogin/ServiceLib.Test/RsaEncryptorTests.cs)。
- 同作者 Go 实现固定提交 `8677927e207befa520cbe3ccbfcc4ea4ea56a0af`：[川大空正文注销及响应判断](https://github.com/LFWQSP2641/scunet-auto-login/blob/8677927e207befa520cbe3ccbfcc4ea4ea56a0af/pkg/schools/scu/portal/rvjx/logout.go)。

RSA 兼容实现及测试向量的上游 MIT 许可完整保存在 [scu-net-auto-login-MIT.txt](../assets/licenses/scu-net-auto-login-MIT.txt)，保留 `Copyright (c) 2026 LFWQSP2641`。岚连的集成、配置和文档开发者为 **NingMeng123**。
