const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (json) => ipcRenderer.invoke('data:save', json),
  openDataFolder: () => ipcRenderer.invoke('data:folder'),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke('file:save', { defaultName, bytes, filters }),
  openFile: (filters) => ipcRenderer.invoke('file:open', { filters }),
  savePdf: (html, defaultName, landscape) => ipcRenderer.invoke('pdf:save', { html, defaultName, landscape }),
  showFile: (p) => ipcRenderer.invoke('file:show', p),
});
