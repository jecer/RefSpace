const { app, BrowserWindow, ipcMain, globalShortcut, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const appProtocol = require('./protocol');

// registerSchemesAsPrivileged обязан вызываться до app.ready
appProtocol.registerScheme();

let mainWindow;
let isClickThrough = false;

let logPath;
function getLogPath() {
  if (!logPath) logPath = path.join(app.getPath('userData'), 'debug.log');
  return logPath;
}

function writeLog(msg) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(getLogPath(), `[${timestamp}] ${msg}\n`);
}

function createWindow() {
  // Очищаем лог
  fs.writeFileSync(getLogPath(), '--- START DEBUG LOG ---\n');
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, frame: false, transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true
    }
  });
  mainWindow.loadURL('refspace://app/index.html');
}

app.commandLine.appendSwitch('disable-features', 'PostQuantumKyber');

let currentHotkey = 'F4';

function registerClickThroughHotkey(hotkey) {
  if (currentHotkey) {
    try { globalShortcut.unregister(currentHotkey); } catch (e) { }
  }
  currentHotkey = hotkey;
  try {
    globalShortcut.register(currentHotkey, () => {
      if (mainWindow) {
        isClickThrough = !isClickThrough;
        mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
        mainWindow.webContents.send('window:click-through-changed', isClickThrough);
      }
    });
  } catch (err) {
    writeLog(`[MAIN] Failed to register hotkey ${hotkey}: ${err.message}`);
  }
}

let startupFilePath = null;
if (process.platform === 'win32' && process.argv.length >= 2) {
  const arg = process.argv.find(a => a.endsWith('.mpref'));
  if (arg) startupFilePath = arg;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // Find if they opened a new file
      const arg = commandLine.find(a => a.endsWith('.mpref'));
      if (arg) {
        mainWindow.webContents.send('project:open-file', arg);
      }
    }
  });

  app.whenReady().then(() => {
    appProtocol.installHandler();
    createWindow();
    registerClickThroughHotkey('F4');
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Извлечено из старого fetch-video-info, чтобы им пользовались оба канала (старый и media:resolve-youtube)
function resolveYouTubeStreams(videoId) {
  const ytdlpPath = app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp.exe')
    : path.join(__dirname, 'yt-dlp.exe');

  if (!fs.existsSync(ytdlpPath)) return null;

  writeLog(`[MAIN] Using yt-dlp for video: ${videoId}`);
  return new Promise((resolve, reject) => {
    // Формат ограничен H.264 и AAC намеренно. bestvideo отдаёт AV1 с Opus в
    // 2160p, а Electron их не декодирует — вместо картинки получается серый
    // проигрыватель. avc1+mp4a играет везде, ценой потолка в 1080p.
    exec(`"${ytdlpPath}" -f "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[vcodec^=avc1]/best[ext=mp4]/best" -g "https://www.youtube.com/watch?v=${videoId}"`, (error, stdout, stderr) => {
      if (error) {
        writeLog(`[YT-DLP] Error: ${stderr}`);
        reject(error);
      } else {
        const lines = stdout.trim().split('\n');
        const videoUrl = lines[0];
        const audioUrl = lines[1] || videoUrl; // Если аудио нет отдельно, используем ту же ссылку
        writeLog(`[YT-DLP] Success: Found streams (Video: ${!!videoUrl}, Audio: ${!!audioUrl})`);
        // Рендереру отдаются токены, а не адреса googlevideo: сам адрес он
        // не видит и передать его обратно не может.
        resolve({
          videoToken: appProtocol.registerStream(videoUrl),
          audioToken: appProtocol.registerStream(audioUrl)
        });
      }
    });
  });
}

async function saveProjectToDisk(data, existingPath, dialogTitle) {
  let filePath = existingPath;

  if (!filePath) {
    const dialogResult = await dialog.showSaveDialog(mainWindow, {
      title: dialogTitle || 'Сохранить проект RefSpace',
      defaultPath: 'project.mpref',
      filters: [
        { name: 'RefSpace Project', extensions: ['mpref'] },
        { name: 'JSON File', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    filePath = dialogResult.filePath;
  }

  if (filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath };
    } catch (err) {
      writeLog(`[SAVE ERROR] ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  return { success: false, cancelled: true };
}

async function openProjectDialog(dialogTitle) {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: dialogTitle || 'Открыть проект RefSpace',
    filters: [
      { name: 'RefSpace Project', extensions: ['mpref'] },
      { name: 'JSON File', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!canceled && filePaths.length > 0) {
    try {
      const content = fs.readFileSync(filePaths[0], 'utf-8');
      return { success: true, data: JSON.parse(content), filePath: filePaths[0] };
    } catch (err) {
      writeLog(`[OPEN ERROR] ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  return { success: false, cancelled: true };
}

async function readProjectFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, data: JSON.parse(content), filePath };
  } catch (err) {
    writeLog(`[OPEN ERROR] ${err.message}`);
    return { success: false, error: err.message };
  }
}

// --- Каналы для preload-моста ---
ipcMain.on('log', (e, m) => writeLog(`[RENDERER] ${String(m)}`));
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());
ipcMain.on('window:set-opacity', (e, value) => {
  const v = Number(value);
  if (mainWindow && Number.isFinite(v)) mainWindow.setOpacity(Math.min(1, Math.max(0.1, v)));
});
ipcMain.on('window:set-always-on-top', (e, flag) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(Boolean(flag));
});
ipcMain.on('window:set-click-through', (e, flag) => {
  if (!mainWindow) return;
  isClickThrough = Boolean(flag);
  mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
});
ipcMain.on('window:set-hotkey', (e, key) => {
  if (typeof key === 'string' && key.length > 0 && key.length < 32) {
    registerClickThroughHotkey(key);
  }
});

ipcMain.handle('project:save', (e, data, existingPath, title) =>
  saveProjectToDisk(data, existingPath, title));
ipcMain.handle('project:open', (e, title) => openProjectDialog(title));
ipcMain.handle('project:open-path', (e, filePath) => readProjectFile(filePath));
ipcMain.handle('project:startup-file', () => startupFilePath);
ipcMain.handle('project:file-exists', (e, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return false;
  return fs.existsSync(filePath.replace(/\\/g, '/').replace(/^"|"$/g, ''));
});

ipcMain.handle('media:register-local', (e, absPath) => appProtocol.registerLocalFile(absPath));

ipcMain.handle('media:resolve-youtube', (e, videoId) => {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId))) {
    throw new Error('invalid video id');
  }
  return resolveYouTubeStreams(String(videoId));
});

ipcMain.handle('clipboard:read-text', () => clipboard.readText());
ipcMain.handle('clipboard:read-image', () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : img.toDataURL();
});
ipcMain.handle('clipboard:write-image', (e, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
  return true;
});
ipcMain.handle('clipboard:write-items', (e, payload) => {
  const out = {};
  if (typeof payload?.text === 'string') out.text = payload.text;
  if (typeof payload?.imageDataUrl === 'string' && payload.imageDataUrl.startsWith('data:image/')) {
    out.image = nativeImage.createFromDataURL(payload.imageDataUrl);
  } else if (typeof payload?.imagePath === 'string') {
    out.image = nativeImage.createFromPath(payload.imagePath);
  }
  clipboard.write(out);
  return true;
});
