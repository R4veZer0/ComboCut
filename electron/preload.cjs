const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('combocutDesktop', {
  isDesktop: true,
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('dialog:selectDirectory', defaultPath),
  openFolder: (targetPath) => ipcRenderer.invoke('shell:openFolder', targetPath),
  submitFeedback: (payload) => ipcRenderer.invoke('submit-feedback', payload),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});
