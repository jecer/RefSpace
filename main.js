const { app, BrowserWindow, ipcMain, globalShortcut, dialog, clipboard, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const appProtocol = require('./protocol');
const dohProxy = require('./dohproxy');

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
    // Поднимаем до окна: к моменту первого запроса видео прокси уже слушает.
    dohProxy.start(writeLog).catch(err => writeLog(`[DOH] запуск не удался: ${err.message}`));
    createWindow();
    registerClickThroughHotkey('F4');
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Invidious спрашивает YouTube со своего сервера и возвращает готовые ссылки
// на потоки, которые ведут прямо на googlevideo. Это резерв для случая, когда
// yt-dlp не может сам добраться до youtube.com — например, когда провайдер не
// резолвит его имя. Тогда DNS пользователя для метаданных не нужен вовсе.
//
// Сеть Piped, которой этот резерв был раньше, перестала отвечать целиком,
// поэтому здесь её больше нет.
const INVIDIOUS_MIRRORS = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de'
];

function codecOf(type) {
  return ((type || '').match(/codecs="([^".]+)/) || [])[1] || '';
}

function heightOf(f) {
  const label = f.qualityLabel || f.resolution || '';
  return parseInt(label, 10) || 0;
}

// Все три кодека проверены на этом Electron и играют вплоть до 2160p,
// поэтому выбираем просто по разрешению. При равном — vp9: он и лёгок
// для декодера, и распространён шире av01.
const CODEC_RANK = { vp9: 3, avc1: 2, av01: 1 };

async function resolveViaInvidious(videoId) {
  for (const base of INVIDIOUS_MIRRORS) {
    try {
      // Короткий срок: мёртвое зеркало не должно задерживать ответ. Раньше
      // перебор четырёх адресов по таймауту занимал около минуты, и всё это
      // время пользователь смотрел на пустой проигрыватель.
      const res = await net.fetch(`${base}/api/v1/videos/${videoId}`,
        { signal: AbortSignal.timeout(6000) });
      if (!res.ok) { writeLog(`[INVIDIOUS] ${base}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const formats = Array.isArray(data && data.adaptiveFormats) ? data.adaptiveFormats : [];

      const videos = formats
        .filter(f => (f.type || '').startsWith('video') && f.url && CODEC_RANK[codecOf(f.type)])
        .sort((a, b) => heightOf(b) - heightOf(a) ||
                        CODEC_RANK[codecOf(b.type)] - CODEC_RANK[codecOf(a.type)]);
      const audios = formats
        .filter(f => (f.type || '').startsWith('audio') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      // Слитый поток, если он есть: одна дорожка вместо двух — меньше рассинхрона.
      const merged = (data.formatStreams || []).filter(f => f.url).sort((a, b) => heightOf(b) - heightOf(a))[0];

      const v = videos[0] || merged;
      if (!v) { writeLog(`[INVIDIOUS] ${base}: подходящих потоков нет`); continue; }
      const a = videos[0] ? audios[0] : null;

      const videoToken = appProtocol.registerStream(v.url);
      if (!videoToken) { writeLog(`[INVIDIOUS] ${base}: недопустимый хост потока`); continue; }

      writeLog(`[INVIDIOUS] Success via ${base}: ${codecOf(v.type) || 'merged'} ${heightOf(v)}p`);
      return {
        videoToken,
        audioToken: (a && appProtocol.registerStream(a.url)) || videoToken
      };
    } catch (err) {
      writeLog(`[INVIDIOUS] ${base}: ${err.message}`);
    }
  }
  return null;
}

async function resolveYouTubeStreams(videoId) {
  try {
    const direct = await resolveViaYtdlp(videoId);
    if (direct) return direct;
    writeLog('[MAIN] yt-dlp недоступен, пробуем Invidious');
  } catch (err) {
    writeLog(`[MAIN] yt-dlp не справился (${String(err.message).split('\n')[0]}), пробуем Invidious`);
  }
  return resolveViaInvidious(videoId);
}

function resolveViaYtdlp(videoId) {
  const ytdlpPath = app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp.exe')
    : path.join(__dirname, 'yt-dlp.exe');

  if (!fs.existsSync(ytdlpPath)) return null;

  writeLog(`[MAIN] Using yt-dlp for video: ${videoId}`);
  return new Promise((resolve, reject) => {
    // Через локальный прокси: он резолвит имена сам, поэтому yt-dlp работает
    // и там, где провайдер не отдаёт адрес youtube.com. Если прокси почему-то
    // не поднялся, идём напрямую — хуже, чем было, не станет.
    const viaProxy = dohProxy.url() ? `--proxy "${dohProxy.url()}" ` : '';

    // Кодек не ограничиваем: h264, vp9 и av01 проверены на этом Electron и
    // играют вплоть до 2160p. А вот протокол ограничиваем — для шортсов
    // yt-dlp выбирает HLS, и тогда -g отдаёт ссылку на m3u8-плейлист.
    // Chromium вне Safari нативно HLS не проигрывает: элемент скачивает
    // текстовый плейлист и падает с DEMUXER_ERROR_COULD_NOT_PARSE.
    // Сегментные протоколы отсеиваем, прогрессивные https остаются.
    const noSegments = '[protocol!*=m3u8][protocol!*=dash]';
    const format = `bestvideo${noSegments}+bestaudio${noSegments}/best${noSegments}/best`;

    exec(`"${ytdlpPath}" ${viaProxy}-f "${format}" -g "https://www.youtube.com/watch?v=${videoId}"`, (error, stdout, stderr) => {
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
