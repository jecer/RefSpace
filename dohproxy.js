// Локальный прокси, который резолвит имена через DNS-over-HTTPS.
//
// Зачем: у части пользователей провайдер не отдаёт адрес youtube.com, и
// yt-dlp падает на getaddrinfo, хотя само соединение прошло бы. Сервер
// слушает только 127.0.0.1, принимает CONNECT, узнаёт адрес через DoH и
// дальше просто перекладывает байты. TLS остаётся сквозным: мы видим только
// имя хоста в CONNECT, но не содержимое.
//
// Своего сервера здесь нет и не нужно: мы идём на тот же адрес, просто
// узнаём его не у провайдера.

const http = require('http');
const net = require('net');
const { net: enet } = require('electron');

// Обращаемся по IP, а не по имени: иначе для резолвера понадобился бы
// резолвер. Сертификаты Cloudflare и Google покрывают эти адреса.
const DOH_ENDPOINTS = [
  'https://1.1.1.1/dns-query',
  'https://8.8.8.8/dns-query'
];

// Прокси не должен стать открытым для всего подряд: через него ходит только
// то, ради чего он заведён.
const ALLOWED_SUFFIXES = [
  'youtube.com',
  'youtu.be',
  'googlevideo.com',
  'googleapis.com',
  'ytimg.com',
  'ggpht.com'
];

const cache = new Map();   // host -> { ip, until }
let proxyPort = null;

function isAllowed(host) {
  const h = String(host || '').toLowerCase();
  return ALLOWED_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
}

async function resolveHost(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.ip;

  for (const base of DOH_ENDPOINTS) {
    try {
      const res = await enet.fetch(
        `${base}?name=${encodeURIComponent(host)}&type=A`,
        { headers: { accept: 'application/dns-json' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const answers = (data && data.Answer || []).filter(a => a.type === 1 && a.data);
      if (!answers.length) continue;
      const ip = answers[0].data;
      const ttl = Math.min(3600, Math.max(60, answers[0].TTL || 300));
      cache.set(host, { ip, until: Date.now() + ttl * 1000 });
      return ip;
    } catch {
      // Пробуем следующий резолвер.
    }
  }
  return null;
}

function start(log) {
  const server = http.createServer((req, res) => {
    // Обычный HTTP через этот прокси не ходит: YouTube везде на TLS.
    res.writeHead(405).end();
  });

  server.on('connect', async (req, clientSocket, head) => {
    const [host, portText] = String(req.url || '').split(':');
    const port = Number(portText) || 443;

    if (!isAllowed(host)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }

    const ip = await resolveHost(host);
    if (!ip) {
      if (log) log(`[DOH] не удалось разрешить ${host}`);
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    const upstream = net.connect(port, ip, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      proxyPort = server.address().port;
      if (log) log(`[DOH] прокси слушает 127.0.0.1:${proxyPort}`);
      resolve(proxyPort);
    });
  });
}

function url() {
  return proxyPort ? `http://127.0.0.1:${proxyPort}` : null;
}

module.exports = { start, url, resolveHost };
