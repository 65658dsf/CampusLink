// 项目介绍与版本记录（新 → 旧）。
export interface JournalEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

export const projectRepo = 'https://github.com/65658dsf/CampusLink';
export const projectSite = 'https://campuslink.xzncraft.cn';
export const maintainer = 'NingMeng123';
export const projectIntro = '岚连 Campus Link 是面向 Windows / macOS 的校园网认证工具，支持连接与注销、启动状态检测、断线自动重连、开机自启动、系统托盘，以及通过 JSON 导入的校园网连接方案。';

export const journalEntries: JournalEntry[] = [
  {
    version: '1.1.4', date: '2026-10-30', title: '按景陶实际请求修正认证',
    items: [
      '景陶登录改用同主机 801 端口的新版 ePortal 接口，匹配 4.2.1 参数与重复语言字段。',
      '按网页选项补齐电信、移动、联通和测试后缀，也可按完整账号提交。',
      '加强在线身份与页面标记复核，旧导入 JSON 保留原流程。',
      '已核对登录请求与密码错误响应，成功登录、状态和注销仍需校内验证。',
    ],
  },
  {
    version: '1.1.3', date: '2026-10-30', title: '景陶校园网接入与安装修复',
    items: [
      '新增景德镇陶瓷大学 Dr.COM ePortal 方案，动态读取入口参数，使用原始学号认证。',
      '补齐新方案的搜索、JSON 导入导出、诊断脱敏与认证结果复核。',
      '景陶状态和注销使用 Dr.COM 兼容流程，当前仍需校内实网验证。',
      '修复 Windows 自定义安装目录，自动补上 Campus Link 文件夹且不重复添加。',
    ],
  },
  {
    version: '1.1.2', date: '2026-10-16', title: '方案选择与连接体验',
    items: [
      '首次启动不预选学校，引导前往连接方案选择匹配的认证配置。',
      '连接方案支持按学校、名称、描述、作者与协议搜索，所有内置方案直接展示。',
      '新增脱敏诊断包、账号密码管理、当前账号展示与开发日志，密码继续使用系统安全存储加密。',
      '改进网络变化检测、锐捷认证与托盘体验，滚动时保持标题栏可用。',
    ],
  },
  {
    version: '1.1.1', date: '2026-10-12', title: '锐捷 ePortal 支持',
    items: [
      '新增锐捷 ePortal Web 适配与认证门户自动发现。',
      '完善认证结果确认与诊断信息脱敏。',
    ],
  },
  {
    version: '1.1.0', date: '2026-10-11', title: '自动重连与跨平台',
    items: [
      '断线自动重连，检测间隔 5–3600 秒可配置。',
      'macOS 支持与标签驱动的自动发布流程。',
    ],
  },
];
