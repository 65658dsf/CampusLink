import type { CampusAPI, Snapshot } from './types';

export const isPreview = !window.campus;
const preview: Snapshot = {
  settings: { profileId: '', username: '', rememberPassword: false, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 10, minimizeToTray: true, appearance: 'classic', parameters: {} },
  hasPassword: false,
  profiles: [
    { id: 'builtin-gzqy', name: '贵州轻工职业大学', description: '基于学校认证页面配置的 Dr.COM 校园网连接方案。', version: '1.0.0', author: 'NingMeng123', homepage: 'http://10.151.253.10/', portalDiscovery: { url: 'http://www.msftconnecttest.com/redirect' }, builtin: true, protocol: 'drcom', fields: [{key:'operator',label:'网络类型',default:'1',options:[{label:'校园网',value:'1'}]}] },
    { id: 'builtin-scu-ruijie', name: '四川大学 · 锐捷 ePortal', description: '参考四川大学锐捷 ePortal 认证流程；其他学校请导入匹配的锐捷方案。', version: '1.0.0', author: 'NingMeng123', homepage: 'http://192.168.2.135/', portalDiscovery: { url: 'http://www.msftconnecttest.com/redirect' }, builtin: true, protocol: 'ruijie', fields: [{ key: 'service', label: '网络服务', default: 'internet', options: [{ label: '校园网（internet）', value: 'internet' }, { label: '电信出口', value: '电信出口' }, { label: '移动出口', value: '移动出口' }, { label: '联通出口', value: '联通出口' }] }] },
    { id: 'builtin-cdut-yibin-ruijie', name: '成都理工大学（宜宾校区）· 锐捷 ePortal', description: '成都理工大学宜宾校区锐捷 ePortal 认证；请先连接学校校园网络，使用统一认证账号。', version: '1.0.0', author: 'NingMeng123', homepage: 'http://10.26.30.253/', portalDiscovery: { url: 'http://www.msftconnecttest.com/redirect' }, builtin: true, protocol: 'ruijie', fields: [] },
  ],
  connection: { status: 'idle', message: '请先在连接方案中选择学校，再进行认证。', monitoring: false, reconnectPaused: false },
  logs: [{ id: 'preview', time: new Date().toISOString(), level: 'info', message: '界面预览已就绪。网络认证及系统设置请使用桌面客户端。' }],
  app: { version: '1.1.2', platform: 'browser', packaged: false, windowGlass: false, firstRun: false, secureStorage: false },
};
const desktopOnly = async (): Promise<never> => { throw new Error('此操作需要桌面客户端。请运行 npm run dev 或打开安装后的岚连。'); };
export const api: CampusAPI = window.campus ?? {
  copyText: text => navigator.clipboard.writeText(text),
  getSnapshot: async () => structuredClone(preview),
  saveSettings: desktopOnly,
  setAppearance: async value => { preview.settings.appearance = value; return structuredClone(preview); },
  saveCredentials: desktopOnly,
  connect: desktopOnly,
  disconnect: desktopOnly,
  checkStatus: desktopOnly,
  importProfile: desktopOnly,
  removeProfile: desktopOnly,
  exportExample: desktopOnly,
  exportDiagnostics: desktopOnly,
  exportProfile: desktopOnly,
  getUpdateState: async () => ({ status: 'idle', currentVersion: preview.app.version }),
  checkForUpdates: desktopOnly,
  openRelease: desktopOnly,
  onUpdate: () => () => {},
  openPortal: desktopOnly,
  openUrl: async url => { window.open(url, '_blank', 'noopener'); },
  clearCredentials: desktopOnly,
  windowAction: async () => {},
  onSnapshot: () => () => {},
};
