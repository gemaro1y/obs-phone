const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  onServerInfo: (callback) => ipcRenderer.on('server-info', (_, data) => callback(data)),
});
