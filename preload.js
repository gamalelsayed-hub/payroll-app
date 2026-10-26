const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (json) => ipcRenderer.invoke('data:save', json),
  openDataFolder: () => ipcRenderer.invoke('data:folder'),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke('file:save', { defaultName, bytes, filters }),
  openFile: (filters) => ipcRenderer.invoke('file:open', { filters }),
  savePdf: (html, defaultName, landscape) => ipcRenderer.invoke('pdf:save', { html, defaultName, landscape }),
  showFile: (p) => ipcRenderer.invoke('file:show', p),
  openFiles: (filters) => ipcRenderer.invoke('file:openMany', { filters }),
  extractPdf: (bytes) => ipcRenderer.invoke('pdf:extract', bytes),
  readXlsx: (bytes) => ipcRenderer.invoke('xlsx:read', bytes),
  addAttachments: (folder) => ipcRenderer.invoke('attach:add', { folder }),
  openAttachment: (rel) => ipcRenderer.invoke('attach:open', rel),
  removeAttachment: (rel) => ipcRenderer.invoke('attach:remove', rel),
});
