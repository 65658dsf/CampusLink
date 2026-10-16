'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = method => (...args) => ipcRenderer.invoke(`campus:${method}`, ...args);
contextBridge.exposeInMainWorld('campus', Object.freeze({
  getSnapshot: invoke('getSnapshot'),
  copyText: invoke('copyText'),
  saveSettings: invoke('saveSettings'),
  saveCredentials: invoke('saveCredentials'),
  connect: invoke('connect'),
  disconnect: invoke('disconnect'),
  checkStatus: invoke('checkStatus'),
  importProfile: invoke('importProfile'),
  removeProfile: invoke('removeProfile'),
  exportExample: invoke('exportExample'),
  exportDiagnostics: invoke('exportDiagnostics'),
  openPortal: invoke('openPortal'),
  openUrl: invoke('openUrl'),
  clearCredentials: invoke('clearCredentials'),
  windowAction: invoke('windowAction'),
  onSnapshot(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback 必须为函数');
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('campus:snapshot', listener);
    return () => ipcRenderer.removeListener('campus:snapshot', listener);
  },
}));
