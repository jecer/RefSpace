// Собственная схема refspace://
//
// Страница и всё локальное медиа отдаются с одного происхождения
// (refspace://app), поэтому чтение пикселей из canvas остаётся возможным
// после включения webSecurity: скриншот кадра, копирование картинки и
// вшивание изображений при сохранении проекта.
//
// Рендерер никогда не передаёт и не получает абсолютный путь: файл
// регистрируется главным процессом и адресуется непрозрачным токеном.

const { protocol, net } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const APP_ROOT = __dirname;
const localFiles = new Map();   // token -> absolute path
const streams = new Map();      // token -> remote stream url

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'refspace',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }]);
}

function registerLocalFile(absPath) {
  if (typeof absPath !== 'string' || !absPath) return null;
  const clean = absPath.replace(/^"|"$/g, '');
  if (!fs.existsSync(clean)) return null;
  for (const [token, p] of localFiles) if (p === clean) return token;
  const token = crypto.randomBytes(16).toString('hex');
  localFiles.set(token, clean);
  return token;
}

// Токен выдаётся только на адрес, который главный процесс разрешил сам через
// yt-dlp. Проверка хоста обязательна: без неё приложение превратится в
// открытый прокси на произвольный адрес по просьбе рендерера.
// allowSuffix расширяет список разрешённых хостов на время одного вызова:
// зеркало Piped может отдать ссылку на собственный прокси, а не на googlevideo.
// Расширение задаёт главный процесс, исходя из того, к какому зеркалу он сам
// обратился, — рендерер на этот список влиять не может.
function registerStream(url, allowSuffix) {
  if (typeof url !== 'string') return null;
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  const allowed =
    host === 'googlevideo.com' || host.endsWith('.googlevideo.com') ||
    (typeof allowSuffix === 'string' && allowSuffix &&
      (host === allowSuffix || host.endsWith('.' + allowSuffix)));
  if (!allowed) return null;
  for (const [token, u] of streams) if (u === url) return token;
  const token = crypto.randomBytes(16).toString('hex');
  streams.set(token, url);
  return token;
}

function clearRegistry() {
  localFiles.clear();
  streams.clear();
}

// Проксирует удалённый поток. Range пробрасывается вверх и статус источника
// возвращается как есть — без этого медиа-элемент не сможет перематывать.
async function serveStream(remoteUrl, rangeHeader) {
  const headers = new Headers();
  if (rangeHeader) headers.set('Range', rangeHeader);

  let upstream;
  try {
    upstream = await net.fetch(remoteUrl, { headers });
  } catch (err) {
    return new Response('upstream failed: ' + err.message, { status: 502 });
  }

  const out = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// Отдаёт файл с диска с поддержкой Range. Без неё не работает перемотка
// видео: медиа-элемент запрашивает куски, а не файл целиком.
function serveFile(filePath, rangeHeader) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response('not found', { status: 404 });
  }

  const type = contentType(filePath);
  const total = stat.size;

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end !== null) {          // последние N байт
        start = Math.max(0, total - end);
        end = total - 1;
      } else {
        if (start === null) start = 0;
        if (end === null || end >= total) end = total - 1;
      }
      if (start > end || start >= total) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${total}` }
        });
      }
      return new Response(streamOf(filePath, start, end), {
        status: 206,
        headers: {
          'content-type': type,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${total}`,
          'accept-ranges': 'bytes'
        }
      });
    }
  }

  return new Response(streamOf(filePath, 0, total - 1), {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(total),
      'accept-ranges': 'bytes'
    }
  });
}

function streamOf(filePath, start, end) {
  const rs = fs.createReadStream(filePath, { start, end });
  return new ReadableStream({
    start(controller) {
      rs.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      rs.on('end', () => controller.close());
      rs.on('error', (err) => controller.error(err));
    },
    cancel() { rs.destroy(); }
  });
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
};

function contentType(filePath) {
  return TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function installHandler() {
  protocol.handle('refspace', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('not found', { status: 404 });

    const range = request.headers.get('Range');

    if (url.pathname.startsWith('/_stream/')) {
      const token = decodeURIComponent(url.pathname.slice('/_stream/'.length));
      const remote = streams.get(token);
      if (!remote) return new Response('unknown token', { status: 404 });
      return serveStream(remote, range);
    }

    if (url.pathname.startsWith('/_media/')) {
      const token = decodeURIComponent(url.pathname.slice('/_media/'.length));
      const filePath = localFiles.get(token);
      if (!filePath) return new Response('unknown token', { status: 404 });
      return serveFile(filePath, range);
    }

    // Файлы самого приложения
    const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const target = path.join(APP_ROOT, path.normalize(rel));
    // Без этой проверки '..' в пути выпустит обработчик за пределы каталога.
    if (!target.startsWith(APP_ROOT + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return serveFile(target, range);
  });
}

module.exports = {
  registerScheme, installHandler, registerLocalFile, registerStream, clearRegistry
};
