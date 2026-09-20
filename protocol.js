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

function clearRegistry() {
  localFiles.clear();
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

module.exports = { registerScheme, installHandler, registerLocalFile, clearRegistry };
