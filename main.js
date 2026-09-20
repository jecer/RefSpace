const { app, BrowserWindow, ipcMain, globalShortcut, dialog, clipboard, nativeImage, net } = require('electron');
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

// Зеркала Piped запрашивают YouTube у себя на сервере и отдают готовые ссылки
// на потоки. Это резерв на случай, когда yt-dlp не может сам добраться до
// youtube.com — например, когда провайдер не резолвит его имя. Тогда DNS
// пользователя для метаданных не нужен вовсе.
const PIPED_MIRRORS = [
  { api: 'https://pipedapi.kavin.rocks', domain: 'kavin.rocks' },
  { api: 'https://api.piped.victr.me', domain: 'victr.me' },
  { api: 'https://pipedapi.adminforge.de', domain: 'adminforge.de' },
  { api: 'https://api.piped.private.coffee', domain: 'private.coffee' }
];

async function resolveViaPiped(videoId) {
  for (const mirror of PIPED_MIRRORS) {
    try {
      const res = await net.fetch(`${mirror.api}/streams/${videoId}`);
      if (!res.ok) { writeLog(`[PIPED] ${mirror.api}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      if (!data || !Array.isArray(data.videoStreams)) continue;

      // Нужен слитый поток: в нём есть и картинка, и звук, и это H.264,
      // который Electron умеет проигрывать.
      const v = data.videoStreams.find(s => !s.videoOnly) || data.videoStreams[0];
      const a = (data.audioStreams && data.audioStreams[0]) || v;
      if (!v || !v.url) continue;

      const videoToken = appProtocol.registerStream(v.url, mirror.domain);
      if (!videoToken) { writeLog(`[PIPED] ${mirror.api}: недопустимый хост потока`); continue; }
      writeLog(`[PIPED] Success via ${mirror.api}`);
      return {
        videoToken,
        audioToken: appProtocol.registerStream(a.url || v.url, mirror.domain) || videoToken
      };
    } catch (err) {
      writeLog(`[PIPED] ${mirror.api}: ${err.message}`);
    }
  }
  return null;
}

async function resolveYouTubeStreams(videoId) {
  try {
    const direct = await resolveViaYtdlp(videoId);
    if (direct) return direct;
    writeLog('[MAIN] yt-dlp недоступен, пробуем зеркала Piped');
  } catch (err) {
    writeLog(`[MAIN] yt-dlp не справился (${String(err.message).split('\n')[0]}), пробуем зеркала Piped`);
  }
  return resolveViaPiped(videoId);
}

function resolveViaYtdlp(videoId) {
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
        // Рендереру отдаются токены, а не адреса googlevideo: сам адрес он
        // не видит и передать его обратно не может.
        const videoToken = appProtocol.registerStream(videoUrl);
        if (!videoToken) {
          // Ссылка есть, но хост не тот, что мы готовы отдавать. Пусть решает
          // резерв, а не пустой ответ рендереру.
          writeLog('[YT-DLP] Ссылка получена, но хост не разрешён');
          resolve(null);
          return;
        }
        writeLog(`[YT-DLP] Success: Found streams (Video: ${!!videoUrl}, Audio: ${!!audioUrl})`);
        resolve({
          videoToken,
          audioToken: appProtocol.registerStream(audioUrl) || videoToken
        });
      }
    });
  });
}

// Рендерер отмечает картинки, у которых цел исходный файл. Здесь его байты
// вшиваются в проект как есть — тогда .mpref остаётся одним самодостаточным
// файлом, которым можно поделиться, но не раздувается перекодированием.
function embedOriginals(data) {
  if (!data || !Array.isArray(data.items)) return;
  for (const item of data.items) {
    if (!item.embedFrom) continue;
    const src = item.embedFrom;
    delete item.embedFrom;
    try {
      const bytes = fs.readFileSync(src);
      item.data = 'data:' + appProtocol.contentType(src) + ';base64,' + bytes.toString('base64');
    } catch (err) {
      // Файл пропал или недоступен. Элемент сохранится без картинки, но
      // проект не потеряется целиком из-за одного файла.
      writeLog(`[SAVE] Не удалось вшить ${src}: ${err.message}`);
    }
  }
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
      embedOriginals(data);
      // Без отступов: файл почти целиком состоит из base64, форматировать нечего.
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
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

ipcMain.handle('clipboard:read-image', () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : img.toDataURL();
});
ipcMain.handle('clipboard:write-image', (e, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
  return true;
});
// Служебное описание скопированных элементов держится здесь, а не в тексте
// системного буфера. Положить рядом с картинкой собственный формат нельзя:
// clipboard.write и clipboard.writeBuffer затирают друг друга, это проверено.
// А класть описание текстом нельзя тем более — сторонние программы вставляли
// бы JSON вместо картинки.
let lastCopy = null;   // { json, fingerprint }

function imageFingerprint(image) {
  if (!image || image.isEmpty()) return null;
  return require('crypto').createHash('sha1').update(image.toBitmap()).digest('hex');
}

ipcMain.handle('clipboard:write-items', (e, payload) => {
  const json = typeof payload?.text === 'string' ? payload.text : null;

  let image = null;
  if (typeof payload?.imageDataUrl === 'string' && payload.imageDataUrl.startsWith('data:image/')) {
    image = nativeImage.createFromDataURL(payload.imageDataUrl);
  } else if (typeof payload?.imagePath === 'string') {
    image = nativeImage.createFromPath(payload.imagePath);
  }

  if (image && !image.isEmpty()) {
    clipboard.write({ image });
    lastCopy = { json, fingerprint: imageFingerprint(clipboard.readImage()) };
  } else {
    // Копировали то, у чего нет картинки: группу, видео, набор элементов.
    clipboard.clear();
    lastCopy = { json, fingerprint: null };
  }
  return true;
});

// Описание возвращается только если системный буфер всё ещё содержит ровно то,
// что мы в него положили. Иначе пользователь успел скопировать что-то другое,
// и вставлять наши элементы было бы неверно.
ipcMain.handle('clipboard:read-items', () => {
  if (!lastCopy || !lastCopy.json) return null;
  const current = clipboard.readImage();
  if (lastCopy.fingerprint === null) {
    return (current.isEmpty() && clipboard.readText() === '') ? lastCopy.json : null;
  }
  return imageFingerprint(current) === lastCopy.fingerprint ? lastCopy.json : null;
});
