// Дымовой прогон: поднимает приложение, опрашивает страницу через CDP.
// Запуск: node tools/smoke.js
const { spawn } = require('child_process');
const path = require('path');

const PORT = 9333;
const ELECTRON = require('electron'); // путь к бинарнику
const PROBE = `(() => ({
  origin: location.origin,
  protocol: location.protocol,
  hasRequire: typeof require,
  hasRefspace: typeof window.refspace,
  hasIpcRenderer: typeof window.ipcRenderer,
  mp4box: typeof MP4Box,
  fonts: document.fonts.status,
  external: performance.getEntriesByType('resource')
    .map(r => r.name).filter(u => /^https?:/.test(u))
}))()`;

function fail(msg) { console.error('FAIL ' + msg); process.exitCode = 1; }
function pass(msg) { console.log('ok   ' + msg); }

// Если порт уже занят, CDP отдаст страницу чужого приложения, и проверки
// будут выполнены не над тем окном. Лучше отказаться, чем соврать.
async function assertPortFree() {
  let taken = false;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`);
    taken = res.ok;
  } catch {
    taken = false; // соединение отклонено — порт свободен
  }
  if (taken) {
    throw new Error(`порт ${PORT} занят другим приложением Electron; освободите его или поменяйте PORT в этом скрипте`);
  }
}

async function readyTarget() {
  const deadline = Date.now() + 30000;
  let wsUrl = null;
  while (Date.now() < deadline) {
    if (!wsUrl) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json`);
        const page = (await res.json()).find(t => t.type === 'page' && t.url.endsWith('index.html'));
        if (page) wsUrl = page.webSocketDebuggerUrl;
      } catch { /* ещё не поднялось */ }
    }
    if (wsUrl) {
      try {
        const state = await evaluate(wsUrl, `document.readyState + '|' + document.fonts.status`);
        if (state === 'complete|loaded') return wsUrl;
      } catch { /* контекст ещё не готов */ }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('страница не догрузилась за 30 секунд');
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error('CDP не ответил')), 15000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true }
    }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      clearTimeout(timer); ws.close();
      if (m.result.exceptionDetails) reject(new Error(m.result.exceptionDetails.text));
      else resolve(m.result.result.value);
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(String(e.message))); };
  });
}

(async () => {
  let child;
  try {
    await assertPortFree();

    child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], {
      cwd: path.join(__dirname, '..'), stdio: 'ignore'
    });
    const state = await evaluate(await readyTarget(), PROBE);
    console.log(JSON.stringify(state, null, 2));

    // Утверждения. По мере выполнения задач часть из них ужесточается.
    state.mp4box !== 'undefined' ? pass('mp4box загружен') : fail('mp4box недоступен');
    state.fonts === 'loaded' ? pass('шрифты загружены') : fail('шрифты: ' + state.fonts);
    state.external.every(u => u.startsWith('https://www.youtube.com'))
      ? pass('посторонних запросов нет')
      : fail('посторонние запросы: ' + state.external.join(', '));
  } catch (err) {
    fail(err.message);
  } finally {
    if (child) child.kill();
  }
})();
