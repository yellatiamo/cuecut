'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#121214',
    title: 'Cuecut',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      sandbox: false,
    },
  });

  const url = process.env.CUECUT_DEV_URL || 'http://127.0.0.1:5173';
  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('save-dialog', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: opts && opts.title ? opts.title : '保存',
    defaultPath: opts && opts.defaultPath ? opts.defaultPath : undefined,
    filters: opts && opts.filters ? opts.filters : undefined,
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-dialog', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: opts && opts.title ? opts.title : '打开',
    properties: (opts && opts.properties) || ['openFile'],
    filters: opts && opts.filters ? opts.filters : undefined,
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('show-item', async (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});
