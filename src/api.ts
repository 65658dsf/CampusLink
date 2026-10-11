import type { CampusAPI, Snapshot } from './types';

export const isPreview = !window.campus;
const preview: Snapshot = {
  settings: { profileId: 'guizhou-qinggong', username: '', rememberPassword: false, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 30, minimizeToTray: true, parameters: {} },
  hasPassword: false,
  profiles: [{ id: 'guizhou-qinggong', name: '贵州轻工职业大学', description: '基于学校认证页面配置的 Dr.COM 校园网连接方案。', version: '1.0.0', author: 'NingMeng123', homepage: 'http://10.151.253.10/', builtin: true, protocol: 'drcom', fields: [{key:'operator',label:'网络类型',default:'1',options:[{label:'校园网',value:'1'}]}] }],
  connection: { status: 'idle', message: '先连接校园 Wi-Fi 或网线，再进行认证。', monitoring: false, reconnectPaused: false },
  logs: [{ id: 'preview', time: new Date().toISOString(), level: 'info', message: '界面预览已就绪。网络认证及系统设置请使用桌面客户端。' }],
  app: { version: '1.1.0', platform: 'browser', packaged: false, secureStorage: false },
};
const desktopOnly = async (): Promise<never> => { throw new Error('此操作需要桌面客户端。请运行 npm run dev 或打开安装后的岚连。'); };
export const api: CampusAPI = window.campus ?? {
  copyText: text => navigator.clipboard.writeText(text),
  getSnapshot: async () => structuredClone(preview),
  saveSettings: desktopOnly,
  connect: desktopOnly,
  disconnect: desktopOnly,
  checkStatus: desktopOnly,
  importProfile: desktopOnly,
  removeProfile: desktopOnly,
  exportExample: desktopOnly,
  openPortal: desktopOnly,
  clearCredentials: desktopOnly,
  windowAction: async () => {},
  onSnapshot: () => () => {},
};
