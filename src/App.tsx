import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, EthernetPort, ExternalLink, Eye, EyeOff, FileJson2, GraduationCap, LayoutDashboard, LoaderCircle, LockKeyhole, Minus, Monitor, MoreHorizontal, Network, Power, Puzzle, Radio, RefreshCw, Settings2, ShieldCheck, Sparkles, Square, Terminal, Trash2, Upload, Wifi, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, isPreview } from './api';
import type { LogEntry, Profile, Settings, Snapshot } from './types';

type Tab = 'overview' | 'profiles' | 'logs' | 'settings';
const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: '连接概览', icon: LayoutDashboard },
  { id: 'profiles', label: '连接方案', icon: Puzzle },
  { id: 'logs', label: '活动日志', icon: Terminal },
  { id: 'settings', label: '应用设置', icon: Settings2 },
];
const statusLabels = { idle: '等待连接', checking: '正在检测', connecting: '正在连接', connected: '已登录校园网', disconnecting: '正在注销', error: '连接需要处理' };
const levelLabels = { info: '信息', success: '成功', warning: '提醒', error: '错误' };
const protocolLabels: Record<string, string> = { drcom: 'Dr.COM 认证', http: 'HTTP 认证', ruijie: '锐捷 ePortal 认证' };
const protocolLabel = (protocol?: string) => protocolLabels[protocol ?? ''] ?? protocol ?? '未知协议';
const portalOrigin = (value?: string) => {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : ''; }
  catch { return ''; }
};
const timeLabel = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }) {
  return <button className={`toggle ${checked ? 'on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

function SignalArtwork({ connected }: { connected: boolean }) {
  return <div className={`signal-art ${connected ? 'online' : ''}`} aria-hidden="true">
    <div className="signal-orbit orbit-one" /><div className="signal-orbit orbit-two" /><div className="signal-orbit orbit-three" />
    <div className="signal-core"><Wifi size={52} strokeWidth={1.7} /></div>
    <div className="signal-bubble bubble-one"><Monitor size={19} /></div>
    <div className="signal-bubble bubble-two"><ShieldCheck size={19} /></div>
    <span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" />
  </div>;
}

function LogRow({ entry, onInspect }: { entry: LogEntry; onInspect: (entry: LogEntry) => void }) {
  return <div className="log-row"><span className={`log-dot ${entry.level}`} /><time>{timeLabel(entry.time)}</time><span className="log-message">{entry.message}</span><span className="log-actions"><span className={`log-level ${entry.level}`}>{levelLabels[entry.level]}</span>{(entry.details || entry.level === 'error') && <button type="button" className="text-button log-response-button" onClick={() => onInspect(entry)}>{entry.details ? '查看响应' : '查看详情'}<ChevronRight size={12} /></button>}</span></div>;
}

function ResponseDialog({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  async function copyDetails() {
    const requests = entry.details?.requests.map((request, index) => [
      `请求 ${index + 1}: ${request.method} ${request.url}`,
      `HTTP 状态: ${request.status === undefined ? '未收到 HTTP 响应' : `${request.status} ${request.statusText ?? ''}`.trim()}`,
      `响应类型: ${request.contentType || '未提供'}`,
      `耗时: ${request.durationMs} ms`,
      '响应正文（已脱敏）:', request.responseBody || '（服务器未返回响应正文）',
      ...(request.truncated ? ['（响应较长，仅保留部分内容）'] : []),
    ].join('\n')) ?? [];
    try {
      await api.copyText([`[${entry.time}] [${levelLabels[entry.level]}] ${entry.message}`, ...(entry.details ? [`错误代码: ${entry.details.code}`] : []), '请求地址和响应中的敏感信息已脱敏。', ...requests].join('\n\n'));
      setCopyStatus('详情已复制。');
    } catch { setCopyStatus('复制失败，请选择响应文本手动复制。'); }
  }

  return <dialog ref={dialogRef} className="response-dialog" aria-modal="true" aria-labelledby="response-title" aria-describedby="response-summary" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="response-heading"><div><span className="eyebrow">CONNECTION DIAGNOSTICS</span><h2 id="response-title">{entry.details ? '服务器响应' : '错误详情'}</h2></div><button type="button" autoFocus className="icon-button" aria-label="关闭响应详情" onClick={onClose}><X size={20} /></button></header>
    <div className="response-summary"><p id="response-summary">{entry.message}</p><div><time>{new Date(entry.time).toLocaleString('zh-CN', { hour12: false })}</time>{entry.details && <span>错误代码 <code>{entry.details.code}</code></span>}</div></div>
    <p className="response-privacy"><ShieldCheck size={14} />请求地址和响应中的敏感信息已脱敏，正文以纯文本显示。</p>
    <div className="response-requests">{entry.details?.requests.length ? entry.details.requests.map((request, index) => <section className="response-request" key={index} aria-label={`请求 ${index + 1}`}>
      <div className="response-request-heading"><h3>请求 {index + 1}</h3><span className="response-method">{request.method}</span><span className={`response-http-status ${request.status !== undefined && request.status >= 400 ? 'failed' : ''}`}>{request.status === undefined ? '未收到 HTTP 响应' : `HTTP ${request.status}${request.statusText ? ` ${request.statusText}` : ''}`}</span></div>
      <dl className="response-metadata"><div><dt>请求地址</dt><dd>{request.url}</dd></div><div><dt>响应类型</dt><dd>{request.contentType || '未提供'}</dd></div><div><dt>请求耗时</dt><dd>{request.durationMs} ms</dd></div></dl>
      <h4>响应正文</h4><pre className="response-body" tabIndex={0} aria-label={`请求 ${index + 1} 响应正文`}>{request.responseBody || '（服务器未返回响应正文）'}</pre>
      {request.truncated && <p className="response-truncated">响应较长，仅保留部分内容。</p>}
    </section>) : <div className="response-empty"><CircleHelp size={22} /><p>此记录没有服务器响应正文。请求可能尚未发出，或未收到响应。</p></div>}</div>
    <footer className="response-footer"><span role="status">{copyStatus}</span><button type="button" className="button secondary small" onClick={() => void copyDetails()}><Copy size={14} />复制详情</button><button type="button" className="button primary small" onClick={onClose}>关闭</button></footer>
  </dialog>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [help, setHelp] = useState(false);
  const [logFilter, setLogFilter] = useState('all');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [inspectedLog, setInspectedLog] = useState<LogEntry | null>(null);
  const [reconnectInterval, setReconnectInterval] = useState('30');
  const [intervalError, setIntervalError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let active = true;
    api.getSnapshot().then(value => {
      if (!active) return;
      setSnapshot(value); setUsername(value.settings.username); setRemember(value.settings.rememberPassword);
      setProfileId(value.settings.profileId); setParameters(value.settings.parameters);
    }).catch(error => setToast({ message: String(error.message), error: true }));
    const unsubscribe = api.onSnapshot(value => { if (active) setSnapshot(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    if (snapshot) { setReconnectInterval(String(snapshot.settings.reconnectIntervalSeconds)); setIntervalError(''); }
  }, [snapshot?.settings.reconnectIntervalSeconds]);

  async function action<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    try { const result = await work(); if (success) setToast({ message: success, error: false }); return result; }
    catch (error) { setToast({ message: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error), error: true }); }
    finally { setBusy(false); }
  }
  async function updateSettings(patch: Partial<Settings>) {
    const result = await action(() => api.saveSettings(patch));
    if (result) setSnapshot(result);
  }
  async function saveReconnectInterval() {
    const rawValue = reconnectInterval.trim();
    const seconds = Number(rawValue);
    if (!/^\d+$/.test(rawValue) || !Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
      setIntervalError('请输入 5–3600 之间的整数秒数。');
      return;
    }
    setIntervalError('');
    const result = await action(() => api.saveSettings({ reconnectIntervalSeconds: seconds }), `检测间隔已保存为 ${seconds} 秒。`);
    if (result) { setSnapshot(result); setReconnectInterval(String(result.settings.reconnectIntervalSeconds)); }
  }
  async function selectProfile(id: string) {
    const values = Object.fromEntries((snapshot?.profiles.find(item => item.id === id)?.fields ?? []).map(field => [field.key, field.default ?? field.options?.[0]?.value ?? '']));
    if (isPreview) { setProfileId(id); setParameters(values); return; }
    const result = await action(() => api.saveSettings({ profileId: id, parameters: values }));
    if (result) { setSnapshot(result); setProfileId(id); setParameters(result.settings.parameters); setPassword(''); setUsername(result.settings.username); setRemember(result.settings.rememberPassword); }
  }
  async function connect() {
    if (busy || !snapshot || snapshot.connection.canDisconnect || ['checking', 'connecting', 'connected', 'disconnecting'].includes(snapshot.connection.status)) return;
    if (!username.trim()) { setToast({ message: '请先填写校园网账号。', error: true }); return; }
    if (!password && !(snapshot?.hasPassword && username === snapshot.settings.username && profileId === snapshot.settings.profileId)) { setToast({ message: '请填写校园网密码。', error: true }); return; }
    const result = await action(() => api.connect({ profileId, username: username.trim(), password, rememberPassword: remember, parameters }));
    if (result) { setSnapshot(result); if (result.hasPassword) setPassword(''); }
  }
  async function importProfile() {
    const result = await action(() => api.importProfile());
    if (result && !result.canceled) { setSnapshot(result.snapshot); setToast({ message: '连接方案已导入，可在列表中选择使用。', error: false }); }
  }
  async function exportExample(kind: 'http' | 'ruijie' = 'http') {
    const result = await action(() => api.exportExample(kind));
    if (result && !result.canceled) setToast({ message: `示例已保存${result.path ? `：${result.path}` : ''}`, error: false });
  }

  if (!snapshot) return <div className="loading-screen"><div className="brand-icon"><Wifi /></div><h2>岚连 · CDUTYB 专版</h2><p>{toast?.message ?? '正在准备你的校园连接…'}</p>{!toast && <LoaderCircle className="spin" />}</div>;
  const visibleProfiles = snapshot.profiles.filter(item => !item.archived);
  const archivedProfiles = snapshot.profiles.filter(item => item.archived);
  const selectProfiles = [...visibleProfiles, ...archivedProfiles.filter(item => item.id === profileId)];
  const profile = snapshot.profiles.find(item => item.id === profileId) ?? visibleProfiles[0] ?? snapshot.profiles[0];
  const renderProfileCard = (item: Profile) => (<article className={`card profile-card ${item.id === profileId ? 'selected' : ''}`} key={item.id}><div className="profile-card-header"><span className="profile-emblem"><GraduationCap size={26} /></span><span className={`badge ${item.builtin ? 'subtle' : 'neutral'}`}>{item.builtin ? '应用内置' : '外部导入'}</span></div><h2>{item.name}</h2><p className="profile-description">{item.description}</p><dl className="profile-details"><div><dt>认证协议</dt><dd>{protocolLabel(item.protocol)}</dd></div><div><dt>方案版本</dt><dd>v{item.version}</dd></div><div><dt>认证入口</dt><dd title={item.portalDiscovery?.url ?? item.homepage}>{item.portalDiscovery ? '自动发现' : item.homepage}</dd></div>{item.portalDiscovery && <><div><dt>发现地址</dt><dd title={item.portalDiscovery.url}>{item.portalDiscovery.url}</dd></div><div><dt>备用认证页</dt><dd title={item.homepage}>{item.homepage}</dd></div></>}</dl><div className="profile-actions"><button className={`button small ${item.id === profileId ? 'selected-button' : 'secondary'}`} disabled={inProgress || canDisconnect || item.id === profileId} onClick={() => void selectProfile(item.id)}>{item.id === profileId ? <><CheckCheck size={16} />当前使用</> : '使用此方案'}</button><button className="icon-button" title="打开认证页" aria-label={`打开${item.name}认证页`} onClick={() => void action(() => api.openPortal(item.id))}><ExternalLink size={17} /></button>{!item.builtin && <button className="icon-button danger-icon" disabled={inProgress || canDisconnect} title="删除方案" aria-label={`删除${item.name}方案`} onClick={() => setRemoveId(item.id)}><Trash2 size={17} /></button>}</div></article>);
  const state = snapshot.connection.status;
  const connected = state === 'connected';
  const detectedPortalOrigin = portalOrigin(snapshot.connection.portalUrl);
  const canDisconnect = connected || Boolean(snapshot.connection.canDisconnect);
  const inProgress = busy || Boolean(snapshot.connection.refreshing) || ['checking', 'connecting', 'disconnecting'].includes(state);
  const activeTab = tabs.find(item => item.id === tab)!;
  const filteredLogs = snapshot.logs.filter(entry => logFilter === 'all' || entry.level === logFilter);
  const recentLogs = snapshot.logs.slice(0, 3);
  const isMac = snapshot.app.platform === 'darwin';
  const platformName = isMac ? 'macOS' : snapshot.app.platform === 'win32' ? 'Windows' : '桌面';
  const autoLaunchDescription = isMac ? '登录系统时启动岚连 · CDUTYB 专版' : snapshot.app.platform === 'win32' ? '进入 Windows 时启动岚连 · CDUTYB 专版' : '登录系统时启动岚连 · CDUTYB 专版';
  const passwordStorageDescription = isMac ? '密码使用 macOS 钥匙串保护，仅保存在本机' : snapshot.app.platform === 'win32' ? '密码使用 Windows 系统加密，仅保存在本机' : '密码使用系统加密，仅保存在本机';
  const guardActive = !isPreview && snapshot.settings.autoReconnect && snapshot.connection.monitoring && !snapshot.connection.reconnectPaused;
  const guardPaused = !isPreview && snapshot.settings.autoReconnect && snapshot.connection.reconnectPaused;
  const guardLabel = isPreview ? '界面预览' : !snapshot.settings.autoReconnect ? '已关闭' : guardPaused ? '已暂停' : guardActive ? '守护中' : '等待认证';
  const guardSummary = isPreview ? '浏览器仅预览设置，网络守护请使用桌面客户端。' : !snapshot.settings.autoReconnect ? '自动重连已关闭，可随时手动检测或连接。' : guardPaused ? '手动注销后已暂停；再次连接成功后恢复守护。' : guardActive ? `每 ${snapshot.settings.reconnectIntervalSeconds} 秒检查，确认断线时尝试重连；无可用凭据时提示手动连接。` : connected ? '当前已在线，等待网络守护开始；无可用凭据时需手动连接。' : `自动重连已开启，等待首次成功认证；检测间隔 ${snapshot.settings.reconnectIntervalSeconds} 秒。`;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Wifi size={25} strokeWidth={2.4} /></div><div><strong>岚连<span className="brand-period">·</span></strong><span className="brand-en">CDUTYB 专版</span></div></div>
      <div className="workspace-label">你的校园网络空间</div>
      <nav aria-label="主导航">{tabs.map(item => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><item.icon size={19} strokeWidth={1.8} /><span>{item.label}</span>{item.id === 'profiles' && <span className="nav-count">{visibleProfiles.length}</span>}{tab === item.id && <span className="nav-indicator" />}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="tiny-orbit"><Sparkles size={18} /></span><strong>连接，从简单开始</strong><p>少一点等待<br />多一点校园的精彩。</p><span className="note-line" /></div>
        <button className="help-link" onClick={() => setHelp(true)}><CircleHelp size={17} />使用帮助<ExternalLink size={13} /></button>
        <div className="sidebar-version"><span className="version-dot" />Campus Link <span>v{snapshot.app.version}</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="titlebar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={13} /><strong>{activeTab.label}</strong></div><div className="titlebar-right"><span className={`system-status ${connected ? 'is-online' : ''}`}><span />{isPreview ? '浏览器预览' : `${platformName} 客户端`}</span><span className="titlebar-separator" /><div className="window-controls"><button title="最小化" aria-label="最小化" onClick={() => void api.windowAction('minimize')}><Minus size={15} /></button><button title="最大化或还原" aria-label="最大化或还原" onClick={() => void api.windowAction('maximize')}><Square size={12} /></button><button className="window-close" title="关闭窗口" aria-label="关闭窗口" onClick={() => void api.windowAction('close')}><X size={16} /></button></div></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{tab === 'overview' ? 'STAY CONNECTED. STAY INSPIRED.' : tab === 'profiles' ? 'A CONNECTION FOR EVERY CAMPUS.' : tab === 'logs' ? 'EVERY CONNECTION, IN SIGHT.' : 'MAKE YOURSELF AT HOME.'}</div><h1>{tab === 'overview' ? '校园生活，即刻在线' : activeTab.label}<span className="heading-dot">.</span></h1><p>{tab === 'overview' ? '让连接更轻松，把时间留给热爱的事。' : tab === 'profiles' ? '一份轻巧的配置，连接更多校园。' : tab === 'logs' ? '查看认证与应用事件，快速定位连接问题。' : '按你的习惯，安排每一次连接。'}</p></div><div className="heading-actions">{tab === 'overview' ? <button className="button secondary small" disabled={inProgress} onClick={() => void action(async () => setSnapshot(await api.checkStatus()))}><RefreshCw size={15} className={state === 'checking' || snapshot.connection.refreshing ? 'spin' : ''} />检测网络</button> : tab === 'profiles' ? <button className="button primary small" disabled={inProgress} onClick={() => void importProfile()}><Upload size={16} />导入连接方案</button> : <span className="heading-symbol"><activeTab.icon size={25} strokeWidth={1.5} /></span>}</div></div>

        {isPreview && <div className="preview-notice"><Monitor size={15} /><span>正在预览界面 · 网络认证、密码保存与开机自启动请在桌面客户端中使用。</span></div>}

        {tab === 'overview' && <>
          <section className={`connection-banner ${connected ? 'connected' : ''}`} aria-label="网络状态">
            <div className="banner-content"><div className="badge status-badge"><span className={`status-dot ${inProgress ? 'pulse' : ''}`} />{statusLabels[state]}</div><h2>{connected ? '已就绪，探索更大的世界' : state === 'error' ? '别着急，再检查一下连接' : state === 'checking' ? '正在检查校园网登录状态' : state === 'disconnecting' ? '正在注销校园网' : state === 'connecting' ? '正在为你建立连接' : '下一站，畅快的校园生活'}</h2><p>{snapshot.connection.message || '连接校园网络后，使用你的账号完成认证。'}</p><div className="banner-meta"><span><ShieldCheck size={14} />本地管理 · 安心连接</span><i /><span><EthernetPort size={14} />{snapshot.connection.ip ?? 'Wi-Fi / 有线网络'}</span></div></div><SignalArtwork connected={connected} />
          </section>

          <div className="overview-grid">
            <section className={`card account-card ${canDisconnect ? 'session-card' : ''}`} aria-label={canDisconnect ? '校园网会话' : '校园网认证'}>
              {canDisconnect ? <>
                <div className="card-heading"><div className="section-title"><span className={`icon-tile ${connected ? 'session-icon' : ''}`}><ShieldCheck size={20} /></span><div><h2>{connected ? '已登录校园网' : state === 'disconnecting' ? '正在注销校园网' : state === 'checking' ? '正在确认登录状态' : '登录状态待确认'}</h2><p>{connected ? '当前设备已通过认证' : '请刷新状态，或注销当前连接'}</p></div></div><span className="step-label">CAMPUS SESSION</span></div>
                <div className={`session-notice ${connected ? 'verified' : 'unconfirmed'}`} role="status">{connected ? <CheckCheck size={23} /> : inProgress ? <LoaderCircle size={23} className="spin" /> : <CircleHelp size={23} />}<p>{connected ? '已检测到当前设备通过校园网认证，无需再次登录。' : snapshot.connection.message}</p></div>
                <dl className="session-details"><div><dt>所属校园</dt><dd>{profile?.name}</dd></div><div><dt>认证状态</dt><dd className={connected ? 'session-status' : ''}>{connected ? <><span />已登录</> : state === 'disconnecting' ? '正在注销' : state === 'checking' ? '正在检查' : '待确认'}</dd></div>{detectedPortalOrigin && <div><dt>认证入口</dt><dd title={detectedPortalOrigin}>{detectedPortalOrigin}</dd></div>}{snapshot.connection.ip && <div><dt>设备 IP</dt><dd>{snapshot.connection.ip}</dd></div>}{snapshot.connection.checkedAt && <div><dt>上次检查</dt><dd>{timeLabel(snapshot.connection.checkedAt)}</dd></div>}</dl>
                <div className="session-actions"><button type="button" className="button secondary" disabled={inProgress} onClick={() => void action(async () => setSnapshot(await api.checkStatus()))}><RefreshCw size={16} className={state === 'checking' || snapshot.connection.refreshing ? 'spin' : ''} />刷新状态</button><button type="button" className="button disconnect-button" disabled={inProgress} onClick={() => void action(async () => setSnapshot(await api.disconnect()))}>{state === 'disconnecting' ? <LoaderCircle size={16} className="spin" /> : <Power size={16} />}{state === 'disconnecting' ? '正在注销…' : '注销校园网'}</button></div>
                <p className="session-footnote">手动注销会暂停自动重连，再次连接成功后恢复守护。</p>
              </> : state === 'checking' ? <div className="auth-checking" role="status"><span className="auth-checking-icon"><LoaderCircle size={28} className="spin" /></span><h2>正在检查登录状态</h2><p>正在向校园网确认当前设备是否已认证。<br />已登录时会自动显示在线状态。</p><span>{profile?.name}</span></div> : <>
              <div className="card-heading"><div className="section-title"><span className="icon-tile"><GraduationCap size={20} /></span><div><h2>连接校园网</h2><p>选择学校，输入你的认证信息</p></div></div><span className="step-label">01 / CONNECT</span></div>
              <form onSubmit={event => { event.preventDefault(); void connect(); }}>
                <label className="field-label" htmlFor="profile">连接方案</label><div className="select-wrapper school-select"><GraduationCap size={18} /><select id="profile" value={profileId} disabled={inProgress || canDisconnect} onChange={event => void selectProfile(event.target.value)}>{selectProfiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></div>
                <div className="input-row"><div><label className="field-label" htmlFor="username">校园网账号</label><input id="username" name="username" autoComplete="username" value={username} disabled={inProgress || canDisconnect} onChange={event => setUsername(event.target.value)} placeholder="请输入学号 / 认证账号" maxLength={256} /></div><div><label className="field-label" htmlFor="password">登录密码</label><div className="password-input"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} disabled={inProgress || canDisconnect} onChange={event => setPassword(event.target.value)} placeholder={snapshot.hasPassword && username === snapshot.settings.username ? '已安全保存，留空使用' : '请输入校园网密码'} maxLength={256} /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div></div>
                {(profile?.fields ?? []).length > 0 && <div className="profile-fields">{profile.fields?.map(field => <div key={field.key}><label className="field-label" htmlFor={`param-${field.key}`}>{field.label}</label>{field.options ? <div className="select-wrapper"><select id={`param-${field.key}`} value={parameters[field.key] ?? field.default ?? ''} disabled={inProgress || canDisconnect} onChange={event => setParameters({ ...parameters, [field.key]: event.target.value })}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} /></div> : <input id={`param-${field.key}`} value={parameters[field.key] ?? field.default ?? ''} disabled={inProgress || canDisconnect} onChange={event => setParameters({ ...parameters, [field.key]: event.target.value })} placeholder={field.placeholder} maxLength={256} />}</div>)}</div>}
                <div className="form-options"><label className="checkbox-label"><input type="checkbox" checked={remember} disabled={inProgress || canDisconnect || (!snapshot.app.secureStorage && !isPreview)} onChange={event => { const checked = event.target.checked; setRemember(checked); if (!checked && snapshot.settings.rememberPassword) void updateSettings({ rememberPassword: false, autoConnect: false }); }} />记住密码<LockKeyhole size={12} /></label><button type="button" className="text-button" onClick={() => void action(() => api.openPortal(profileId))}>打开认证页<ExternalLink size={12} /></button></div>
                <button type="submit" className="button primary connect-button" disabled={inProgress}>{inProgress ? <LoaderCircle size={18} className="spin" /> : <Wifi size={19} />}{state === 'connecting' ? '正在连接…' : '连接校园网'}<ArrowRight size={17} /></button>
                <div className="form-footnote"><ShieldCheck size={13} />{snapshot.app.secureStorage ? passwordStorageDescription : isPreview ? '桌面客户端支持系统级本地密码加密' : '系统加密当前不可用，密码不会持久保存'}</div>
              </form>
              </>}
            </section>

            <aside className="overview-side">
              <section className="card quick-card"><div className="compact-heading"><h2><Sparkles size={17} />连接偏好</h2><button title="更多设置" aria-label="更多设置" className="icon-button" onClick={() => setTab('settings')}><MoreHorizontal size={18} /></button></div><div className="quick-setting"><div><strong>开机自启动</strong><p>{autoLaunchDescription}</p></div><Toggle label="开机自启动" checked={snapshot.settings.autoLaunch} onChange={value => void updateSettings({ autoLaunch: value })} disabled={inProgress} /></div><div className="quick-setting"><div><strong>启动后自动连接</strong><p>使用已保存的账号认证</p></div><Toggle label="启动后自动连接" checked={snapshot.settings.autoConnect} onChange={value => void updateSettings({ autoConnect: value })} disabled={inProgress} /></div><div className="quick-setting"><div><strong>断线自动重连</strong><p>成功连接后定期检测，确认断线时尝试恢复</p></div><Toggle label="断线自动重连" checked={snapshot.settings.autoReconnect} onChange={value => void updateSettings({ autoReconnect: value })} disabled={inProgress} /></div><div className={`preference-tip guard-tip ${guardActive ? 'active' : guardPaused ? 'paused' : ''}`}><span /><p>{guardSummary}</p></div></section>
              <section className="campus-card"><div className="campus-card-top"><span className="campus-emblem"><GraduationCap size={25} strokeWidth={1.5} /></span><span className="badge subtle">{profile?.builtin ? '内置方案' : '扩展方案'}</span></div><h3>{profile?.name}</h3><p>{protocolLabel(profile?.protocol)} <span>·</span> v{profile?.version}</p>{detectedPortalOrigin && <p style={{ overflowWrap: 'anywhere' }} title={detectedPortalOrigin}>当前认证入口<br />{detectedPortalOrigin}</p>}<button className="text-button" onClick={() => setTab('profiles')}>管理连接方案<ArrowRight size={14} /></button><div className="campus-decoration" aria-hidden="true"><span /><span /><span /><span /><span /></div></section>
            </aside>
          </div>

          <section className="card activity-card"><div className="compact-heading"><h2><Clock3 size={17} />最近活动</h2><button className="text-button muted" onClick={() => setTab('logs')}>查看全部<ChevronRight size={14} /></button></div><div className="log-list">{recentLogs.length ? recentLogs.map(entry => <LogRow entry={entry} key={entry.id} onInspect={setInspectedLog} />) : <div className="empty-inline">还没有连接记录，从第一次连接开始。</div>}</div></section>
        </>}

        {tab === 'profiles' && <>
          <div className="info-strip"><ShieldCheck size={20} /><div><strong>可扩展，也保持轻巧</strong><p>导入 JSON 配置即可添加认证方式。导入前会展示请求地址，请确认来自可信来源。</p></div><span className="badge subtle">{visibleProfiles.length} 个方案</span></div>
          <div className="profile-grid">{visibleProfiles.map(renderProfileCard)}<button className="import-card" disabled={inProgress} onClick={() => void importProfile()}><span><Upload size={26} /></span><strong>添加你的校园</strong><p>导入 .json 连接方案</p><span className="import-card-link">选择配置文件<ArrowRight size={15} /></span></button></div>{archivedProfiles.length > 0 && <div className="archived-profiles"><button className="text-button archived-toggle" onClick={() => setShowArchived(value => !value)}><ChevronRight size={14} className={showArchived ? 'expanded' : ''} />{showArchived ? '收起更多内置方案' : `展开更多内置方案（${archivedProfiles.length}）`}</button>{showArchived && <div className="profile-grid">{archivedProfiles.map(renderProfileCard)}</div>}</div>}
          <section className="developer-card"><div className="developer-icon"><FileJson2 size={30} strokeWidth={1.5} /></div><div><span className="eyebrow">BUILT TO BE EXTENDED</span><h2>让更多校园，一键相连</h2><p>选择 HTTP 或锐捷示例，按学校认证页填写地址、服务与协议参数。</p></div><div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, marginLeft: 'auto' }}><button className="button secondary" title="导出 HTTP 方案示例" disabled={busy} onClick={() => void exportExample('http')}><ArrowDownToLine size={16} />导出方案示例</button><button className="button secondary" disabled={busy} onClick={() => void exportExample('ruijie')}><ArrowDownToLine size={16} />导出锐捷示例</button></div></section>
        </>}

        {tab === 'logs' && <section className="card full-log-card"><div className="compact-heading"><h2><Terminal size={18} />运行记录<span className="count-label">{snapshot.logs.length}</span></h2><div className="log-toolbar"><select aria-label="筛选日志" value={logFilter} onChange={event => setLogFilter(event.target.value)}><option value="all">全部类型</option><option value="info">信息</option><option value="success">成功</option><option value="warning">提醒</option><option value="error">错误</option></select><button className="button secondary small" onClick={() => void action(async () => { await api.copyText(filteredLogs.map(entry => `[${entry.time}] [${levelLabels[entry.level]}] ${entry.message}`).join('\n')); }, '日志已复制。')}><Copy size={14} />复制日志</button></div></div><div className="log-list">{filteredLogs.length ? filteredLogs.map(entry => <LogRow entry={entry} key={entry.id} onInspect={setInspectedLog} />) : <div className="empty-state"><Terminal size={36} strokeWidth={1.3} /><h3>这里还很安静</h3><p>符合筛选条件的活动会显示在这里。</p></div>}</div><div className="log-footer"><ShieldCheck size={14} />日志不记录密码，记录保留在当前会话中。</div></section>}

        {tab === 'settings' && <div className="settings-layout"><section className="card settings-card"><div className="card-heading"><div className="section-title"><span className="icon-tile"><Monitor size={20} /></span><div><h2>启动与窗口</h2><p>让岚连 · CDUTYB 专版配合你的使用习惯</p></div></div></div>{[
          { key: 'autoLaunch' as const, title: '开机自启动', description: isMac ? '登录 macOS 后自动启动应用。安装版可用。' : '登录系统后自动启动应用。安装版可用。' },
          { key: 'autoConnect' as const, title: '启动后自动连接', description: '需先成功保存账号密码；启动时先检测认证状态。' },
          { key: 'minimizeToTray' as const, title: '关闭时最小化到托盘', description: '点击关闭按钮后在后台保留，可从系统托盘退出。' },
        ].map(item => <div className="settings-row" key={item.key}><div><strong>{item.title}</strong><p>{item.description}</p></div><Toggle label={item.title} checked={snapshot.settings[item.key]} disabled={inProgress} onChange={value => void updateSettings({ [item.key]: value })} /></div>)}</section>
          <section className="card settings-card" aria-labelledby="diagnostics-title">
            <div className="card-heading"><div className="section-title"><span className="icon-tile"><ArrowDownToLine size={20} /></span><div><h2 id="diagnostics-title">诊断与帮助</h2><p>远程排障用的脱敏信息</p></div></div></div>
            <div className="settings-row"><div><strong>导出诊断包</strong><p>包含应用信息、网络概况与本次运行的脱敏日志，不含密码，可放心发给协助排查的人。</p></div><button className="button secondary small" disabled={inProgress} onClick={() => void action(async () => { const result = await api.exportDiagnostics(); if (!result.canceled) setToast({ message: '诊断包已导出。', error: false }); })}><ArrowDownToLine size={14} />导出诊断包</button></div>
          </section>
          <section className="card settings-card guard-card" aria-labelledby="guard-title">
            <div className="card-heading"><div className="section-title"><span className="icon-tile"><Radio size={20} /></span><div><h2 id="guard-title">网络守护</h2><p>成功连接后定期检查，确认断线时尝试恢复</p></div></div><span className={`badge ${guardActive ? 'subtle' : 'neutral'}`}>{guardLabel}</span></div>
            <div className="settings-row"><div><strong>断线自动重连</strong><p>使用本次连接的认证信息或已保存密码；无可用凭据时提示手动连接。</p></div><Toggle label="断线自动重连" checked={snapshot.settings.autoReconnect} disabled={inProgress} onChange={value => void updateSettings({ autoReconnect: value })} /></div>
            <form className="settings-row interval-settings" noValidate onSubmit={event => { event.preventDefault(); void saveReconnectInterval(); }}>
              <div><label className="settings-field-label" htmlFor="reconnect-interval">检测间隔（秒）</label><p id="reconnect-interval-help">5–3600 秒，默认 30 秒。保存后应用新的检查间隔。</p></div>
              <div className="interval-editor"><div className="interval-controls"><input id="reconnect-interval" type="number" inputMode="numeric" min={5} max={3600} step={1} value={reconnectInterval} disabled={inProgress} aria-invalid={Boolean(intervalError)} aria-describedby={intervalError ? 'reconnect-interval-help reconnect-interval-error' : 'reconnect-interval-help'} onChange={event => { setReconnectInterval(event.target.value); setIntervalError(''); }} /><button className="button secondary small" type="submit" disabled={inProgress || reconnectInterval === String(snapshot.settings.reconnectIntervalSeconds)}>保存间隔</button></div>{intervalError && <p className="field-error" id="reconnect-interval-error" role="alert">{intervalError}</p>}</div>
            </form>
            <div className={`guard-status ${guardActive ? 'active' : guardPaused ? 'paused' : ''}`}><ShieldCheck size={16} /><p>{guardSummary}<span>手动注销会暂停守护，再次连接成功后恢复。服务器暂不可达时不会把状态未知当作断线。</span></p></div>
          </section><section className="card settings-card"><div className="card-heading"><div className="section-title"><span className="icon-tile"><LockKeyhole size={20} /></span><div><h2>账号与隐私</h2><p>凭据由你掌控</p></div></div><span className={`badge ${snapshot.app.secureStorage ? 'subtle' : 'neutral'}`}>{snapshot.app.secureStorage ? '系统加密可用' : '系统加密不可用'}</span></div><div className="settings-row"><div><strong>本地保存的密码</strong><p>{snapshot.hasPassword ? '已加密保存。清除后，自动连接也会关闭。' : '暂未保存密码，可在连接页面勾选「记住密码」。'}</p></div><button className="button secondary small" disabled={inProgress || !snapshot.hasPassword} onClick={() => void action(async () => { const value = await api.clearCredentials(); setSnapshot(value); setPassword(''); setRemember(false); }, '本地密码已清除，自动连接已关闭。')}><Trash2 size={14} />清除密码</button></div></section><section className="about-card"><div className="brand-icon"><Wifi size={28} /></div><div><h2>岚连 · CDUTYB 专版</h2><p>面向成都理工大学（宜宾校区）的校园网连接工具 · v{snapshot.app.version}</p><p className="about-detail">{snapshot.app.packaged ? `${platformName} 安装版` : isPreview ? '浏览器预览' : '开发模式'} · 基于 NingMeng123 的 Campus Link 构建 · 独立辅助工具</p></div><button className="text-button" onClick={() => setHelp(true)}>使用帮助<ArrowRight size={15} /></button></section></div>}

        <footer className="page-footer"><span><span className="footer-mark">⌁</span> 简单连接，自在校园。</span><span>MADE FOR YOUR CAMPUS <span className="footer-dot">✦</span></span></footer>
      </main>
    </div>

    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="alert">{toast.error ? <CircleHelp size={19} /> : <Check size={19} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={16} /></button></div>}
    {inspectedLog && <ResponseDialog entry={inspectedLog} onClose={() => setInspectedLog(null)} />}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" aria-label="关闭帮助" onClick={() => setHelp(false)}><X size={19} /></button><span className="icon-tile large"><Wifi size={27} /></span><h2 id="help-title">三步，回到校园在线生活</h2><div className="help-step"><b>1</b><div><strong>接入学校网络</strong><p>先在系统中连接校园 Wi-Fi 或插入校园网网线。本工具负责校园网认证。</p></div></div><div className="help-step"><b>2</b><div><strong>选择方案并填写账号</strong><p>启动后会自动检查登录状态。已登录时直接显示在线信息；未登录时，选择学校并填写认证账号密码。</p></div></div><div className="help-step"><b>3</b><div><strong>连接，或按需自动连接</strong><p>点击连接完成认证。勾选记住密码后可开启启动自动连接；开机自启动需要安装桌面版本。</p></div></div><div className="help-note"><Network size={18} /><p>连接失败时查看活动日志。账号欠费、设备限制等问题请通过学校认证页或校园网服务渠道处理。</p></div><button className="button primary" onClick={() => setHelp(false)}>开始使用<ArrowRight size={16} /></button></section></div>}
    {removeId && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="remove-title"><h2 id="remove-title">移除这个连接方案？</h2><p>配置将从本机移除，之后可以重新导入。</p><div className="modal-actions"><button className="button secondary" onClick={() => setRemoveId(null)}>取消</button><button className="button danger" disabled={busy} onClick={() => void action(async () => { const value = await api.removeProfile(removeId); setSnapshot(value); setProfileId(value.settings.profileId); setParameters(value.settings.parameters); setUsername(value.settings.username); setRemember(value.settings.rememberPassword); setPassword(''); setRemoveId(null); }, '连接方案已移除。')}>确认移除</button></div></section></div>}
  </div>;
}
