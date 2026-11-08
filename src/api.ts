import builtinProfiles from '../electron/builtin-profiles.json';
import type { CampusAPI, Profile, Snapshot } from './types';

export const isPreview = !window.campus;
const previewProfiles: Profile[] = builtinProfiles.map(({ id, name, description = '', version, author = '', homepage, protocol, fields = [], portalDiscovery }) => ({
  id, name, description, version, author, homepage, protocol, fields, builtin: true,
  ...(portalDiscovery ? { portalDiscovery } : {}),
}));
const preview: Snapshot = {
  settings: { profileId: '', username: '', rememberPassword: false, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 10, minimizeToTray: true, parameters: {} },
  hasPassword: false,
  profiles: previewProfiles,
  connection: { status: 'idle', message: '请先在连接方案中选择学校，再进行认证。', monitoring: false, reconnectPaused: false },
  logs: [{ id: 'preview', time: new Date().toISOString(), level: 'info', message: '界面预览已就绪。网络认证及系统设置请使用桌面客户端。' }],
  app: { version: '1.1.5', platform: 'browser', packaged: false, firstRun: false, secureStorage: false },
};
const desktopOnly = async (): Promise<never> => { throw new Error('此操作需要桌面客户端。请运行 npm run dev 或打开安装后的岚连。'); };
export const api: CampusAPI = window.campus ?? {
  copyText: text => navigator.clipboard.writeText(text),
  getSnapshot: async () => structuredClone(preview),
  saveSettings: desktopOnly,
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
