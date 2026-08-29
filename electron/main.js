'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { attachExportApi } = require('../server/ffmpeg-api.js');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

app.setName('Cuecut');

const APP_ROOT = path.resolve(__dirname, '..');
const USER_DATA = path.join(os.homedir(), '.config', 'cuecut');
const NODE_BIN = '/home/tiamo/.nvm/versions/node/v24.19.0/bin/node';
const VITE_BIN = path.join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const VITE_HOST = '127.0.0.1';
const VITE_PORT = 5173;
const DEV_URL = process.env.CUECUT_DEV_URL || `http://${VITE_HOST}:${VITE_PORT}`;
const VITE_WAIT_MS = 25000;

app.setPath('userData', USER_DATA);

let mainWindow = null;
let viteChild = null;
let weSpawnedVite = false;
let viteLog = '';
let packagedServer = null;
let lastLoadUrl = DEV_URL;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function isPortOpen(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => {
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch (_) {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function isHttpReady(timeoutMs = 400) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: VITE_HOST, port: VITE_PORT, path: '/', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForVite(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await isPortOpen(VITE_HOST, VITE_PORT)) && (await isHttpReady())) {
      return true;
    }
    if (viteChild && viteChild.exitCode != null) {
      return false;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function resolveNodeForVite() {
  if (fs.existsSync(NODE_BIN)) {
    return { bin: NODE_BIN, extraEnv: {} };
  }
  return { bin: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
}

function spawnVite() {
  if (!fs.existsSync(VITE_BIN)) {
    throw new Error('未找到 Vite：' + VITE_BIN);
  }

  const resolved = resolveNodeForVite();
  const bin = resolved.bin;
  const extraEnv = resolved.extraEnv;
  if (!fs.existsSync(bin)) {
    throw new Error('未找到 Node：' + bin);
  }

  const env = Object.assign({}, process.env, extraEnv);
  const binDir = path.dirname(bin);
  env.PATH = binDir + (env.PATH ? path.delimiter + env.PATH : '');

  viteLog = '';
  viteChild = spawn(
    bin,
    [VITE_BIN, '--host', VITE_HOST, '--port', String(VITE_PORT), '--strictPort'],
    {
      cwd: APP_ROOT,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    }
  );
  weSpawnedVite = true;

  const collect = (buf) => {
    viteLog += buf.toString();
    if (viteLog.length > 8000) viteLog = viteLog.slice(-8000);
  };
  viteChild.stdout.on('data', collect);
  viteChild.stderr.on('data', collect);
  viteChild.on('error', (err) => {
    viteLog += '\nspawn error: ' + err.message + '\n';
  });
}

function killVite() {
  if (!weSpawnedVite || !viteChild || viteChild.pid == null) return;
  const pid = viteChild.pid;
  weSpawnedVite = false;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (_) {
    try {
      viteChild.kill('SIGTERM');
    } catch (__) {}
  }
  viteChild = null;
}

function closePackagedServer() {
  if (!packagedServer) return;
  try {
    packagedServer.close();
  } catch (_) {}
  packagedServer = null;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusHtml(title, body, isError) {
  const color = isError ? '#ffb4b4' : '#c8c8cc';
  return '<!DOCTYPE html>\n'
    + '<html><head><meta charset="utf-8"><title>Cuecut</title>\n'
    + '<style>\n'
    + '  html,body { margin:0; height:100%; background:#121214; color:#f2f2f3;\n'
    + '    font-family: system-ui, sans-serif; }\n'
    + '  .wrap { min-height:100%; display:flex; align-items:center; justify-content:center; padding:32px; }\n'
    + '  .box { max-width:640px; }\n'
    + '  h1 { font-size:22px; margin:0 0 12px; font-weight:600; }\n'
    + '  p { color:' + color + '; line-height:1.5; }\n'
    + '  pre { white-space:pre-wrap; background:#1c1c1f; padding:16px; border-radius:8px;\n'
    + '    color:#ffb4b4; overflow:auto; max-height:280px; }\n'
    + '</style></head>\n'
    + '<body><div class="wrap"><div class="box">\n'
    + '  <h1>' + escapeHtml(title) + '</h1>\n'
    + '  <div>' + body + '</div>\n'
    + '</div></div></body></html>';
}

function loadStatusPage(title, message, isError) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const body = isError
    ? '<p>' + escapeHtml(message) + '</p>' + (viteLog ? '<pre>' + escapeHtml(viteLog) + '</pre>' : '')
    : '<p>' + escapeHtml(message) + '</p>';
  const html = statusHtml(title, body, isError);
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  if (!mainWindow.isVisible()) mainWindow.show();
}

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

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return;
    if (String(url || '').startsWith('data:')) return;
    const message = '窗口加载失败（' + code + '）：' + desc + '\n' + (url || '');
    loadStatusPage('Cuecut 无法启动', message, true);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function ensureDevServer() {
  if (await isPortOpen(VITE_HOST, VITE_PORT)) {
    return;
  }
  spawnVite();
  const ready = await waitForVite(VITE_WAIT_MS);
  if (!ready) {
    const extra = viteLog.trim() ? '\n\nVite 输出：\n' + viteLog.trim() : '';
    throw new Error(
      'Vite 未能在 ' + (VITE_WAIT_MS / 1000) + ' 秒内于 ' + VITE_HOST + ':' + VITE_PORT + ' 就绪。' + extra
    );
  }
}

function startPackagedServer() {
  const distDir = path.join(app.getAppPath(), 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('未找到打包后的前端资源：' + distDir);
  }

  const middlewares = {
    use: function (fn) {
      this._fn = fn;
    },
  };
  attachExportApi(middlewares);

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
  };

  function serveStatic(req, res) {
    let rel = '/';
    try {
      rel = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    } catch (_) {
      rel = '/';
    }
    if (rel === '/') rel = '/index.html';
    const abs = path.normalize(path.join(distDir, rel));
    const distPrefix = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;
    if (abs !== distDir && !abs.startsWith(distPrefix)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    const sendFile = (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    };

    fs.stat(abs, (err, st) => {
      if (!err && st.isFile()) {
        sendFile(abs);
        return;
      }
      const index = path.join(distDir, 'index.html');
      fs.stat(index, (e2, st2) => {
        if (e2 || !st2.isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        sendFile(index);
      });
    });
  }

  const server = http.createServer((req, res) => {
    const fallback = () => serveStatic(req, res);
    if (typeof middlewares._fn === 'function') {
      try {
        middlewares._fn(req, res, fallback);
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(String(err && err.message ? err.message : err));
        }
      }
    } else {
      fallback();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server: server, port: addr && addr.port });
    });
  });
}

async function loadApp() {
  if (app.isPackaged) {
    const started = await startPackagedServer();
    packagedServer = started.server;
    lastLoadUrl = 'http://127.0.0.1:' + started.port + '/';
  } else {
    await ensureDevServer();
    lastLoadUrl = DEV_URL;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadURL(lastLoadUrl);
}

if (gotLock) {
  app.whenReady().then(async () => {
    createWindow();
    loadStatusPage('Cuecut', '正在启动…', false);
    try {
      await loadApp();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      loadStatusPage('Cuecut 无法启动', message, true);
    }
  });
}

app.on('window-all-closed', () => {
  killVite();
  closePackagedServer();
  app.quit();
});

app.on('before-quit', () => {
  killVite();
  closePackagedServer();
});

app.on('will-quit', () => {
  killVite();
  closePackagedServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    if (lastLoadUrl) mainWindow.loadURL(lastLoadUrl);
  }
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
