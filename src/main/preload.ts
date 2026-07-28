import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('terminal', {
  version: '0.1.0',
  settings: {
    chooseRoot: () => ipcRenderer.invoke('settings:choose-root'),
    initializeRoot: (rootPath: string) => ipcRenderer.invoke('settings:initialize-root', rootPath),
    get: () => ipcRenderer.invoke('settings:get')
  },
  business: {
    dispatch: (name: string, input: unknown) => ipcRenderer.invoke('business:dispatch', name, input)
  },
  agent: {
    scanAuth: () => ipcRenderer.invoke('agent:scan-auth'),
    saveApiKey: (apiKey: string) => ipcRenderer.invoke('agent:save-api-key', apiKey),
    importCodex: () => ipcRenderer.invoke('agent:import-codex'),
    login: (method: 'browser' | 'device_code') => ipcRenderer.invoke('agent:login', method),
    onAuthEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: unknown, value: unknown) => listener(value);
      ipcRenderer.on('agent:auth-event', handler);
      return () => ipcRenderer.removeListener('agent:auth-event', handler);
    }
  },
  lifecycle: {
    quit: () => ipcRenderer.invoke('app:quit'),
    closeWindow: () => ipcRenderer.invoke('app:close-window'),
    reopenWindow: () => ipcRenderer.invoke('app:reopen-window')
  },
  system: {
    openPath: (filePath: string) => ipcRenderer.invoke('system:open-path', filePath),
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
    copyText: (text: string) => ipcRenderer.invoke('system:copy-text', text),
    imageData: (filePath: string) => ipcRenderer.invoke('system:image-data', filePath),
    capturePage: (filePath: string) => ipcRenderer.invoke('system:capture-page', filePath)
  },
  browser: {
    create: (url?: string) => ipcRenderer.invoke('browser:create', url),
    activate: (id: string) => ipcRenderer.invoke('browser:activate', id),
    navigate: (id: string, url: string) => ipcRenderer.invoke('browser:navigate', id, url),
    back: (id: string) => ipcRenderer.invoke('browser:back', id),
    forward: (id: string) => ipcRenderer.invoke('browser:forward', id),
    reload: (id: string) => ipcRenderer.invoke('browser:reload', id),
    find: (id: string, text: string) => ipcRenderer.invoke('browser:find', id, text),
    visible: (visible: boolean) => ipcRenderer.invoke('browser:visible', visible)
  }
});
