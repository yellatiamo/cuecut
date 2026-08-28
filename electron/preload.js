'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuecutDesktop', {
  isElectron: true,
  saveDialog: (opts) => ipcRenderer.invoke('save-dialog', opts),
  openDialog: (opts) => ipcRenderer.invoke('open-dialog', opts),
  showItem: (filePath) => ipcRenderer.invoke('show-item', filePath),
});
