
// --- Управление окном ---
document.getElementById('btn-close').addEventListener('click', () => tryCloseApp());
document.getElementById('btn-maximize').addEventListener('click', () => refspace.window.maximize());
document.getElementById('btn-minimize').addEventListener('click', () => refspace.window.minimize());

const opacitySlider = document.getElementById('opacity-slider');
opacitySlider.addEventListener('input', (e) => {
  refspace.window.setOpacity(e.target.value);
});

const alwaysOnTopCheckbox = document.getElementById('always-on-top');
alwaysOnTopCheckbox.addEventListener('change', (e) => {
  refspace.window.setAlwaysOnTop(e.target.checked);
});

const clickThroughCheckbox = document.getElementById('click-through');
clickThroughCheckbox.addEventListener('change', (e) => {
  refspace.window.setClickThrough(e.target.checked);
  if (e.target.checked) {
    alwaysOnTopCheckbox.checked = true;
    refspace.window.setAlwaysOnTop(true);
  }
});

// Отлавливаем отключение по горячей клавише
refspace.window.onClickThroughChanged((state) => {
  clickThroughCheckbox.checked = state;
  if (state) {
    alwaysOnTopCheckbox.checked = true;
    refspace.window.setAlwaysOnTop(true);
  }
});

// Настройка горячей клавиши отключения клик-тру
const hotkeyInput = document.getElementById('click-through-hotkey');
const hotkeyHint = document.getElementById('click-through-hint');
let currentHotkey = localStorage.getItem('refspace-clickthrough-hotkey') || 'F4';

hotkeyInput.value = currentHotkey;
hotkeyHint.innerHTML = t('panel.disableHint', { key: currentHotkey });
refspace.window.setClickThroughHotkey(currentHotkey);

let isRecordingHotkey = false;

hotkeyInput.addEventListener('click', () => {
  isRecordingHotkey = true;
  hotkeyInput.value = t('panel.pressKey');
  hotkeyInput.style.borderColor = '#6C5CE7';
});

hotkeyInput.addEventListener('keydown', (e) => {
  if (!isRecordingHotkey) return;
  e.preventDefault();

  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;

  let accelerator = '';
  if (e.ctrlKey) accelerator += 'CommandOrControl+';
  if (e.altKey) accelerator += 'Alt+';
  if (e.shiftKey) accelerator += 'Shift+';

  let keyName = e.key;
  if (/^[a-zа-яё]$/i.test(keyName)) {
    // В Electron горячие клавиши должны быть на англ, но e.code дает "KeyA"
    if (e.code.startsWith('Key')) keyName = e.code.replace('Key', '');
    else keyName = keyName.toUpperCase();
  }
  if (keyName === ' ') keyName = 'Space';

  accelerator += keyName;

  currentHotkey = accelerator;
  localStorage.setItem('refspace-clickthrough-hotkey', currentHotkey);
  hotkeyInput.value = currentHotkey;
  hotkeyHint.innerHTML = t('panel.disableHint', { key: currentHotkey });
  hotkeyInput.style.borderColor = '#444';
  isRecordingHotkey = false;
  hotkeyInput.blur();

  refspace.window.setClickThroughHotkey(currentHotkey);
});

hotkeyInput.addEventListener('blur', () => {
  if (isRecordingHotkey) {
    isRecordingHotkey = false;
    hotkeyInput.value = currentHotkey;
    hotkeyInput.style.borderColor = '#444';
  }
});

const burgerMenuBtn = document.getElementById('burger-menu-btn');
const controlPanel = document.getElementById('controlPanel');
if (burgerMenuBtn && controlPanel) {
  burgerMenuBtn.addEventListener('click', () => {
    controlPanel.classList.toggle('collapsed');
  });
}

// --- Бесконечный холст (Pan & Zoom) ---
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas');

let canvasBoundsEl = document.getElementById('canvas-bounds');
if (!canvasBoundsEl) {
  canvasBoundsEl = document.createElement('div');
  canvasBoundsEl.id = 'canvas-bounds';
  canvasBoundsEl.style.position = 'absolute';
  canvasBoundsEl.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; // светлый фон как в pureref
  canvasBoundsEl.style.borderRadius = '10px';
  canvasBoundsEl.style.pointerEvents = 'none';
  canvasBoundsEl.style.zIndex = '0'; 
  canvas.insertBefore(canvasBoundsEl, canvas.firstChild);
}

let multiSelectionBoundsEl = document.getElementById('multi-selection-bounds');
let isMultiResizing = false;
let currentMultiResizePos = null;
let multiResizeStartX = 0;
let multiResizeStartY = 0;
let multiResizeStartGroupWidth = 0;
let multiResizeStartGroupHeight = 0;
let multiResizeStartGroupMinX = 0;
let multiResizeStartGroupMinY = 0;
let multiResizeInitialData = [];

if (!multiSelectionBoundsEl) {
  multiSelectionBoundsEl = document.createElement('div');
  multiSelectionBoundsEl.id = 'multi-selection-bounds';
  multiSelectionBoundsEl.style.position = 'absolute';
  multiSelectionBoundsEl.style.outline = 'calc(2px * var(--inv-scale, 1)) solid var(--accent)';
  multiSelectionBoundsEl.style.pointerEvents = 'none';
  multiSelectionBoundsEl.style.zIndex = '5'; // Внутри canvas-item: выше фона, ниже маркеров ресайза

  const multiResizeHandles = ['nw', 'ne', 'se', 'sw'];
  multiResizeHandles.forEach(pos => {
    const handleObj = document.createElement('div');
    handleObj.className = `resize-handle resize-${pos}`;
    handleObj.style.display = 'block';
    handleObj.style.pointerEvents = 'auto';
    multiSelectionBoundsEl.appendChild(handleObj);

    handleObj.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      isMultiResizing = true;
      currentMultiResizePos = pos;
      multiResizeStartX = e.clientX;
      multiResizeStartY = e.clientY;
      multiResizeStartGroupWidth = parseFloat(multiSelectionBoundsEl.style.width) || 0;
      multiResizeStartGroupHeight = parseFloat(multiSelectionBoundsEl.style.height) || 0;

      multiResizeInitialData = [];
      const selectedItems = document.getElementsByClassName('selected-item');
      let sMinX = Infinity, sMinY = Infinity;
      for (let i = 0; i < selectedItems.length; i++) {
        const el = selectedItems[i];
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const w = parseFloat(el.style.width) || parseFloat(el.dataset.w) || parseFloat(getComputedStyle(el).width) || 0;
        const h = parseFloat(el.style.height) || parseFloat(el.dataset.h) || parseFloat(getComputedStyle(el).height) || 0;
        if (l < sMinX) sMinX = l;
        if (t < sMinY) sMinY = t;
        multiResizeInitialData.push({ el, l, t, w, h });
      }
      multiResizeStartGroupMinX = sMinX;
      multiResizeStartGroupMinY = sMinY;
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMultiResizing) return;
    const deltaX = (e.clientX - multiResizeStartX) / scale;
    let newGroupWidth = multiResizeStartGroupWidth;
    let newGroupHeight = multiResizeStartGroupHeight;

    if (currentMultiResizePos === 'se') {
      newGroupWidth = multiResizeStartGroupWidth + deltaX;
    } else if (currentMultiResizePos === 'nw') {
      newGroupWidth = multiResizeStartGroupWidth - deltaX;
    } else if (currentMultiResizePos === 'ne') {
      newGroupWidth = multiResizeStartGroupWidth + deltaX;
    } else if (currentMultiResizePos === 'sw') {
      newGroupWidth = multiResizeStartGroupWidth - deltaX;
    }

    if (newGroupWidth < 10) newGroupWidth = 10;
    newGroupHeight = multiResizeStartGroupHeight * (newGroupWidth / multiResizeStartGroupWidth);

    const factor = newGroupWidth / multiResizeStartGroupWidth;

    multiResizeInitialData.forEach(data => {
      let newL = data.l;
      let newT = data.t;
      const newW = data.w * factor;
      const newH = data.h * factor;
      
      const dx = (data.l - multiResizeStartGroupMinX) * factor;
      const dy = (data.t - multiResizeStartGroupMinY) * factor;

      if (currentMultiResizePos === 'se') {
        newL = multiResizeStartGroupMinX + dx;
        newT = multiResizeStartGroupMinY + dy;
      } else if (currentMultiResizePos === 'nw') {
        newL = multiResizeStartGroupMinX + multiResizeStartGroupWidth - newGroupWidth + dx;
        newT = multiResizeStartGroupMinY + multiResizeStartGroupHeight - newGroupHeight + dy;
      } else if (currentMultiResizePos === 'ne') {
        newL = multiResizeStartGroupMinX + dx;
        newT = multiResizeStartGroupMinY + multiResizeStartGroupHeight - newGroupHeight + dy;
      } else if (currentMultiResizePos === 'sw') {
        newL = multiResizeStartGroupMinX + multiResizeStartGroupWidth - newGroupWidth + dx;
        newT = multiResizeStartGroupMinY + dy;
      }

      data.el.style.left = `${newL}px`;
      data.el.style.top = `${newT}px`;
      data.el.style.width = `${newW}px`;
      data.el.style.height = `${newH}px`;
    });
  });

  window.addEventListener('mouseup', () => {
    if (isMultiResizing) {
      isMultiResizing = false;
      const finalItemsData = multiResizeInitialData.map(data => ({
        el: data.el,
        oldL: data.l, oldT: data.t, oldW: data.w, oldH: data.h,
        newL: parseFloat(data.el.style.left),
        newT: parseFloat(data.el.style.top),
        newW: parseFloat(data.el.style.width),
        newH: parseFloat(data.el.style.height)
      }));
      
      if (typeof pushHistory === 'function') {
        pushHistory({
          undo: () => {
            finalItemsData.forEach(d => {
              d.el.style.left = `${d.oldL}px`;
              d.el.style.top = `${d.oldT}px`;
              d.el.style.width = `${d.oldW}px`;
              d.el.style.height = `${d.oldH}px`;
            });
          },
          redo: () => {
            finalItemsData.forEach(d => {
              d.el.style.left = `${d.newL}px`;
              d.el.style.top = `${d.newT}px`;
              d.el.style.width = `${d.newW}px`;
              d.el.style.height = `${d.newH}px`;
            });
          }
        });
      }
      multiResizeInitialData = [];
    }
  });
}

function addPendingMedia() {
  // Плашка вставки убрана по просьбе пользователя
}

function resolvePendingMedia() {
  // Плашка вставки убрана по просьбе пользователя
}

// Живые коллекции для высокой производительности (вместо querySelectorAll)
const allCanvasItems = document.getElementsByClassName('canvas-item');
const allSelectedItems = document.getElementsByClassName('selected-item');

let lastBoundsStr = '';
function updateCanvasBoundsLoop() {
  requestAnimationFrame(updateCanvasBoundsLoop);
  const items = allCanvasItems;
  if (items.length === 0) {
    if (lastBoundsStr !== 'none') {
      canvasBoundsEl.style.display = 'none';
      lastBoundsStr = 'none';
    }
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasValidItems = false;
  
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    const w = parseFloat(el.style.width) || parseFloat(el.dataset.w) || 0;
    const h = parseFloat(el.style.height) || parseFloat(el.dataset.h) || 0;
    
    hasValidItems = true;
    if (l < minX) minX = l;
    if (t < minY) minY = t;
    if (l + w > maxX) maxX = l + w;
    if (t + h > maxY) maxY = t + h;
  }
  
  if (!hasValidItems || minX === Infinity) return;
  
  const padding = 200;
  const bx = minX - padding;
  const by = minY - padding;
  const bw = maxX - minX + padding * 2;
  const bh = maxY - minY + padding * 2;
  
  const boundsStr = `${bx},${by},${bw},${bh}`;
  if (boundsStr !== lastBoundsStr) {
    canvasBoundsEl.style.display = 'block';
    canvasBoundsEl.style.left = `${bx}px`;
    canvasBoundsEl.style.top = `${by}px`;
    canvasBoundsEl.style.width = `${bw}px`;
    canvasBoundsEl.style.height = `${bh}px`;
    lastBoundsStr = boundsStr;
  }

  // --- Рамка выделения ---
  const selectedItems = allSelectedItems;

  // Очищаем класс single-selected со всех, если выделен не 1 элемент
  for(let i=0; i<items.length; i++) {
    if (items[i].classList.contains('single-selected')) {
      if (selectedItems.length !== 1 || items[i] !== selectedItems[0]) {
        items[i].classList.remove('single-selected');
      }
    }
  }

  if (selectedItems.length === 0) {
    if (multiSelectionBoundsEl.parentNode) {
      multiSelectionBoundsEl.parentNode.removeChild(multiSelectionBoundsEl);
    }
  } else if (selectedItems.length === 1) {
    if (multiSelectionBoundsEl.parentNode) {
      multiSelectionBoundsEl.parentNode.removeChild(multiSelectionBoundsEl);
    }
    if (!selectedItems[0].classList.contains('single-selected')) {
      selectedItems[0].classList.add('single-selected');
    }
  } else {
    let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
    for (let i = 0; i < selectedItems.length; i++) {
      const el = selectedItems[i];
      const l = parseFloat(el.style.left) || 0;
      const t = parseFloat(el.style.top) || 0;
      const w = parseFloat(el.style.width) || parseFloat(el.dataset.w) || 0;
      const h = parseFloat(el.style.height) || parseFloat(el.dataset.h) || 0;
      if (l < sMinX) sMinX = l;
      if (t < sMinY) sMinY = t;
      if (l + w > sMaxX) sMaxX = l + w;
      if (t + h > sMaxY) sMaxY = t + h;
    }
    if (sMinX !== Infinity) {
      const firstItem = selectedItems[0];
      if (multiSelectionBoundsEl.parentNode !== firstItem) {
        firstItem.appendChild(multiSelectionBoundsEl);
      }
      
      const firstL = parseFloat(firstItem.style.left) || 0;
      const firstT = parseFloat(firstItem.style.top) || 0;
      
      const padding = 2; // Небольшой отступ от объектов
      multiSelectionBoundsEl.style.left = `${(sMinX - firstL) - padding}px`;
      multiSelectionBoundsEl.style.top = `${(sMinY - firstT) - padding}px`;
      multiSelectionBoundsEl.style.width = `${sMaxX - sMinX + padding * 2}px`;
      multiSelectionBoundsEl.style.height = `${sMaxY - sMinY + padding * 2}px`;
    }
  }
}
requestAnimationFrame(updateCanvasBoundsLoop);


let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;

function updateCanvasTransform() {
  canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  document.documentElement.style.setProperty('--inv-scale', 1 / scale);
}

function fitItemsToView(items) {
  if (!items || items.length <= 1) return;
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach(el => {
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    const w = parseFloat(el.style.width) || parseFloat(el.dataset.w) || 0;
    const h = parseFloat(el.style.height) || parseFloat(el.dataset.h) || 0;
    if (w === 0 && h === 0) return;
    if (l < minX) minX = l;
    if (t < minY) minY = t;
    if (l + w > maxX) maxX = l + w;
    if (t + h > maxY) maxY = t + h;
  });
  
  if (minX === Infinity) return;

  const rect = canvasContainer.getBoundingClientRect();
  const screenW = rect.width || window.innerWidth;
  const screenH = rect.height || window.innerHeight;
  
  const padding = 100;
  const itemsW = maxX - minX;
  const itemsH = maxY - minY;
  if (itemsW === 0 || itemsH === 0) return;

  const scaleX = (screenW - padding * 2) / itemsW;
  const scaleY = (screenH - padding * 2) / itemsH;
  let newScale = Math.min(scaleX, scaleY);
  
  if (newScale > 1) newScale = 1;
  if (newScale < 0.0001) newScale = 0.0001;
  
  const itemsCenterX = minX + itemsW / 2;
  const itemsCenterY = minY + itemsH / 2;
  
  scale = newScale;
  translateX = screenW / 2 - itemsCenterX * scale;
  translateY = screenH / 2 - itemsCenterY * scale;
  
  updateCanvasTransform();
}

// Кэшируем rect для предотвращения Forced Synchronous Layout при зуме
let canvasContainerRect = canvasContainer.getBoundingClientRect();
window.addEventListener('resize', () => {
  canvasContainerRect = canvasContainer.getBoundingClientRect();
});

// Зум колесиком мыши (центрирование по курсору)
canvasContainer.addEventListener('wheel', (e) => {
  if (e.target.closest('.canvas-item')) {
    // Если колесико крутят внутри элемента (например, скролл страницы youtube) - не зумим холст.
    // Но так как у нас картинки/видео, там скролла нет, кроме iframe.
    // Если это iframe, лучше не зумить.
    if (e.target.tagName.toLowerCase() === 'iframe') return;
  }

  e.preventDefault();

  const zoomSensitivity = 0.001;
  const delta = e.deltaY * zoomSensitivity;
  let newScale = scale * (1 - delta);

  // Ограничения зума (убраны границы для бесконечного отдаления)
  if (newScale < 0.0001) newScale = 0.0001;
  if (newScale > 1000) newScale = 1000;

  // Математика для зума в точку курсора (ОПТИМИЗАЦИЯ: используем кэшированный rect)
  const mouseX = e.clientX - canvasContainerRect.left;
  const mouseY = e.clientY - canvasContainerRect.top;

  // Вычисляем смещение
  translateX = mouseX - (mouseX - translateX) * (newScale / scale);
  translateY = mouseY - (mouseY - translateY) * (newScale / scale);
  scale = newScale;

  updateCanvasTransform();
}, { passive: false });

// Переменные для выделения рамкой
let isBoxSelecting = false;
let boxStartX = 0;
let boxStartY = 0;
let selectionBox = null;
let isSpacePressed = false;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (!document.activeElement || document.activeElement.tagName.toLowerCase() !== 'input')) {
    isSpacePressed = true;
    if (!isPanning && !isBoxSelecting) canvasContainer.style.cursor = 'grab';
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    isSpacePressed = false;
    if (!isPanning && !isBoxSelecting) canvasContainer.style.cursor = 'default';
  }
});

function updateSelectionBox(clientX, clientY) {
  if (!selectionBox) return;
  const x = Math.min(boxStartX, clientX);
  const y = Math.min(boxStartY, clientY);
  const w = Math.abs(clientX - boxStartX);
  const h = Math.abs(clientY - boxStartY);
  selectionBox.style.left = `${x}px`;
  selectionBox.style.top = `${y}px`;
  selectionBox.style.width = `${w}px`;
  selectionBox.style.height = `${h}px`;
}

// Панорамирование (Pan) и Выделение рамкой
canvasContainer.addEventListener('mousedown', (e) => {
  if (e.target === canvas || e.target === canvasContainer) {
    if (e.button === 0 && !isSpacePressed && !e.shiftKey) {
      document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));
    }
  }

  // Панорамируем если нажата средняя кнопка или пробел + ЛКМ
  if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
    isPanning = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    canvasContainer.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  // Выделение рамкой, если ЛКМ по фону и нет пробела
  if (e.button === 0 && (e.target === canvas || e.target === canvasContainer)) {
    isBoxSelecting = true;
    boxStartX = e.clientX;
    boxStartY = e.clientY;

    selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    document.body.appendChild(selectionBox);
    updateSelectionBox(e.clientX, e.clientY);
  }
});

window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateCanvasTransform();
    return;
  }
  if (isBoxSelecting) {
    updateSelectionBox(e.clientX, e.clientY);
  }
});

window.addEventListener('mouseup', (e) => {
  if (isPanning) {
    isPanning = false;
    canvasContainer.style.cursor = isSpacePressed ? 'grab' : 'default';
  }

  if (isBoxSelecting) {
    isBoxSelecting = false;
    if (selectionBox && selectionBox.parentNode) {
      selectionBox.remove();
      selectionBox = null;
    }

    const rect = canvasContainer.getBoundingClientRect();
    const minX = Math.min(boxStartX, e.clientX);
    const maxX = Math.max(boxStartX, e.clientX);
    const minY = Math.min(boxStartY, e.clientY);
    const maxY = Math.max(boxStartY, e.clientY);

    const canvasMinX = (minX - rect.left - translateX) / scale;
    const canvasMaxX = (maxX - rect.left - translateX) / scale;
    const canvasMinY = (minY - rect.top - translateY) / scale;
    const canvasMaxY = (maxY - rect.top - translateY) / scale;

    // Выделяем элементы, попавшие в рамку
    document.querySelectorAll('#canvas > .canvas-item').forEach(el => {
      const elL = parseFloat(el.style.left) || 0;
      const elT = parseFloat(el.style.top) || 0;
      const elW = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width);
      const elH = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height);

      // Пересечение прямоугольников
      if (elL < canvasMaxX && elL + elW > canvasMinX && elT < canvasMaxY && elT + elH > canvasMinY) {
        el.classList.add('selected-item');
      }
    });
  }
});

// --- Добавление элементов (Drag & Drop) ---
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();

  // Игнорируем drop, если он был на панели управления
  if (e.target.closest('#controlPanel')) return;

  (async () => {
    let offsetStep = 0;
    const expectedCount = e.dataTransfer.files.length;
    if (expectedCount === 0) return;
    
    const droppedItems = [];
    let loadedCount = 0;
    
    for (const f of e.dataTransfer.files) {
      handleFile(f, e.clientX + (offsetStep * 30 * scale), e.clientY + (offsetStep * 30 * scale), (loadedItem) => {
        loadedCount++;
        if (loadedItem) droppedItems.push(loadedItem);
        if (loadedCount === expectedCount && droppedItems.length > 1) {
          fitItemsToView(droppedItems);
        }
      });
      offsetStep++;
      if (offsetStep % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
  })();
});

// --- Система отмены действий (Undo / Redo) ---
const history = [];
let historyIndex = -1;

function pushHistory(action) {
  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  history.push(action);
  if (history.length > 50) {
    history.shift(); // Ограничиваем историю 50 шагами
  } else {
    historyIndex++;
  }
}

function undo() {
  if (historyIndex >= 0) {
    history[historyIndex].undo();
    historyIndex--;
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    history[historyIndex].redo();
  }
}

function deleteItem(item) {
  if (!item) return;
  if (item.dataset.locked === '1') return;   // заблокированный не удаляется
  const parent = item.parentNode;
  const nextSibling = item.nextSibling;

  const relatedConns = connections.filter(c => c.from === item || c.to === item);

  item.remove();
  relatedConns.forEach(c => {
    c.pathEl.remove();
    const idx = connections.indexOf(c);
    if (idx !== -1) connections.splice(idx, 1);
  });

  pushHistory({
    undo: () => {
      if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(item, nextSibling);
      else parent.appendChild(item);

      const svg = document.getElementById('connections-svg');
      relatedConns.forEach(c => {
        connections.push(c);
        svg.appendChild(c.pathEl);
        updateConnection(c);
      });
    },
    redo: () => {
      item.remove();
      relatedConns.forEach(c => {
        c.pathEl.remove();
        const idx = connections.indexOf(c);
        if (idx !== -1) connections.splice(idx, 1);
      });
    }
  });
}

let zIndexCounter = 100;
let groupZIndexCounter = 10;
let lastClickedItem = null; // Для Shift-выделения диапазона

// --- Система соединительных линий ---
const connections = []; // { from: item, to: item, controlX: num, controlY: num, pathEl, cpEl }
let isConnecting = false;
let connectFrom = null;
let connectionHint = null;

function createItemContainer(x, y, path = '') {
  const item = document.createElement('div');
  item.className = 'canvas-item';
  item.dataset.id = 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const cleanPath = (path || '').replace(/\\/g, '/');
  item.setAttribute('data-path', cleanPath);

  // Координаты относительно холста, учитывая текущий зум и сдвиг
  const rect = canvasContainer.getBoundingClientRect();
  const realX = (x - rect.left - translateX) / scale;
  const realY = (y - rect.top - translateY) / scale;

  item.style.left = `${realX}px`;
  item.style.top = `${realY}px`;
  item.style.zIndex = zIndexCounter++;

  // Drag ручка
  const handle = document.createElement('div');
  handle.className = 'drag-handle';

  const title = document.createElement('span');
  title.style.fontSize = '12px';
  handle.appendChild(title);

  const removeBtn = document.createElement('span');
  removeBtn.className = 'btn-remove';
  removeBtn.textContent = '✕';
  removeBtn.onclick = () => deleteItem(item);
  handle.appendChild(removeBtn);

  item.appendChild(handle);

  const contentWrap = document.createElement('div');
  contentWrap.className = 'item-content';
  item.appendChild(contentWrap);

  // Логика перемещения элемента (Drag)
  let isDraggingItem = false;
  let hasDragged = false;
  let itemStartX, itemStartY;
  let startMoveLeft = 0, startMoveTop = 0;

  // Логика ресайза
  let isResizingItem = false;
  let resizePos = '';
  let startWidth, startHeight, startLeft, startTop;

  // Создаем точки ресайза (только диагональные)
  const resizeHandles = ['nw', 'ne', 'se', 'sw'];
  resizeHandles.forEach(pos => {
    const handleObj = document.createElement('div');
    handleObj.className = `resize-handle resize-${pos}`;
    item.appendChild(handleObj);

    handleObj.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Только левая кнопка
      if (item.dataset.locked === '1') { e.stopPropagation(); return; }
      e.stopPropagation();
      // Если элемент не выделен, сбрасываем всё и выделяем его
      if (!item.classList.contains('selected-item')) {
        document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));
        item.classList.add('selected-item');
      }
      isResizingItem = true;
      resizePos = pos;
      itemStartX = e.clientX / scale;
      itemStartY = e.clientY / scale;
      startWidth = parseFloat(getComputedStyle(item).width);
      startHeight = parseFloat(getComputedStyle(item).height);
      startLeft = parseFloat(item.style.left) || 0;
      startTop = parseFloat(item.style.top) || 0;

      // Если это оболочка, запоминаем все элементы внутри неё
      item._resizeChildren = [];
      if (item.classList.contains('group-box')) {
        const gLeft = startLeft;
        const gTop = startTop;
        const gWidth = startWidth;
        const gHeight = startHeight;

        document.querySelectorAll('#canvas > .canvas-item:not(.group-box)').forEach(el => {
          const elLeft = parseFloat(el.style.left) || 0;
          const elTop = parseFloat(el.style.top) || 0;
          const elWidth = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width);
          const elHeight = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height);

          const elCenterX = elLeft + elWidth / 2;
          const elCenterY = elTop + elHeight / 2;
          if (elCenterX >= gLeft && elCenterX <= gLeft + gWidth && elCenterY >= gTop && elCenterY <= gTop + gHeight) {
            item._resizeChildren.push({
              el, startW: elWidth, startH: elHeight, startL: elLeft, startT: elTop
            });
          }
        });
      }

      // Вычисляем якорную точку как противоположный угол выделения
      let allMinX = startLeft, allMinY = startTop;
      let allMaxX = startLeft + startWidth, allMaxY = startTop + startHeight;
      document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        const w = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width);
        const h = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height);
        if (l < allMinX) allMinX = l;
        if (t < allMinY) allMinY = t;
        if (l + w > allMaxX) allMaxX = l + w;
        if (t + h > allMaxY) allMaxY = t + h;
      });
      // Для оболочки учитываем и дочерние элементы
      if (item._resizeChildren && item._resizeChildren.length > 0) {
        item._resizeChildren.forEach(child => {
          if (child.startL < allMinX) allMinX = child.startL;
          if (child.startT < allMinY) allMinY = child.startT;
          if (child.startL + child.startW > allMaxX) allMaxX = child.startL + child.startW;
          if (child.startT + child.startH > allMaxY) allMaxY = child.startT + child.startH;
        });
      }

      item._resizeAnchorX = resizePos.includes('w') ? allMaxX : allMinX;
      item._resizeAnchorY = resizePos.includes('n') ? allMaxY : allMinY;

      // Запоминаем начальные размеры ВСЕХ выделенных для массового ресайза
      document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
        el._resizeStartW = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width);
        el._resizeStartH = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height);
        el._resizeStartL = parseFloat(el.style.left) || 0;
        el._resizeStartT = parseFloat(el.style.top) || 0;
      });
    });
  });

  // Создаем коннекторы (фиолетовые точки на сторонах для вытягивания линий)
  const connectorSides = ['top', 'bottom', 'left', 'right'];
  connectorSides.forEach(side => {
    const cp = document.createElement('div');
    cp.className = `connector-point connector-${side}`;
    cp.dataset.side = side;
    item.appendChild(cp);

    cp.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      // Начинаем вытягивание линии
      const svg = document.getElementById('connections-svg');
      const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempPath.classList.add('connection-path');
      tempPath.setAttribute('marker-end', 'url(#arrowhead)');
      tempPath.style.opacity = '0.5';
      svg.appendChild(tempPath);

      const fromItem = item;

      const onMove = (ev) => {
        const rect = canvasContainer.getBoundingClientRect();
        const mouseCanvasX = (ev.clientX - rect.left - translateX) / scale;
        const mouseCanvasY = (ev.clientY - rect.top - translateY) / scale;
        const fromPt = getConnectorPoint(fromItem, side);
        // Кубическая Безье S-кривая: два промежуточных контрольных
        const cp1 = calcAutoControl(fromPt, { x: mouseCanvasX, y: mouseCanvasY }, side);
        const cp2 = calcAutoControl({ x: mouseCanvasX, y: mouseCanvasY }, fromPt, guessOppositeSide(fromPt, { x: mouseCanvasX, y: mouseCanvasY }));
        tempPath.setAttribute('d', `M ${fromPt.x} ${fromPt.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${mouseCanvasX} ${mouseCanvasY}`);
      };

      const onUp = (ev) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        tempPath.remove();

        // Ищем элемент под курсором
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = (ev.clientX - rect.left - translateX) / scale;
        const mouseY = (ev.clientY - rect.top - translateY) / scale;
        const target = findItemAt(mouseX, mouseY);

        if (target && target !== fromItem) {
          createConnection(fromItem, target);
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });

  let wasSelectedBeforeClick = false;
  let startMouseX = 0, startMouseY = 0;

  item.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Разрешаем выделение и перетаскивание только левой кнопкой
    if (e.target.closest('.btn-remove') || e.target.closest('button') || e.target.closest('.resize-handle') || e.target.closest('.connector-point') || e.target.closest('input[type="color"]')) return;
    e.stopPropagation(); // Чтобы не срабатывал Pan холста

    const isShift = e.shiftKey;
    const isCtrl = e.ctrlKey || e.metaKey;
    wasSelectedBeforeClick = item.classList.contains('selected-item');

    // Логика выделения: Shift выделяет все элементы в той же горизонтальной полосе (Y-пересечение)
    if (isShift && lastClickedItem && lastClickedItem !== item) {
      // Находим прямоугольник между двумя точками
      const aLeft = parseFloat(lastClickedItem.style.left) || 0;
      const aTop = parseFloat(lastClickedItem.style.top) || 0;
      const aW = parseFloat(lastClickedItem.style.width) || 0;
      const aH = parseFloat(lastClickedItem.style.height) || 0;
      const bLeft = parseFloat(item.style.left) || 0;
      const bTop = parseFloat(item.style.top) || 0;
      const bW = parseFloat(item.style.width) || 0;
      const bH = parseFloat(item.style.height) || 0;

      // Объемлющий прямоугольник обоих элементов
      const selMinX = Math.min(aLeft, bLeft);
      const selMinY = Math.min(aTop, bTop);
      const selMaxX = Math.max(aLeft + aW, bLeft + bW);
      const selMaxY = Math.max(aTop + aH, bTop + bH);

      if (!isCtrl) {
        document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));
      }

      // Выделяем все элементы, пересекающиеся с этим прямоугольником
      document.querySelectorAll('#canvas > .canvas-item').forEach(el => {
        const elL = parseFloat(el.style.left) || 0;
        const elT = parseFloat(el.style.top) || 0;
        const elW = parseFloat(el.style.width) || 0;
        const elH = parseFloat(el.style.height) || 0;

        if (elL + elW > selMinX && elL < selMaxX && elT + elH > selMinY && elT < selMaxY) {
          el.classList.add('selected-item');
        }
      });
    } else if (isCtrl) {
      if (wasSelectedBeforeClick) {
        item.classList.remove('selected-item');
      } else {
        item.classList.add('selected-item');
      }
      lastClickedItem = item;
    } else {
      if (!wasSelectedBeforeClick) {
        document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));
        item.classList.add('selected-item');
      }
      lastClickedItem = item;
    }

    // Если кликнули и сняли выделение, тащить ничего не нужно
    if (!item.classList.contains('selected-item')) {
      isDraggingItem = false;
      return;
    }

    isDraggingItem = true;
    hasDragged = false;

    startMouseX = e.clientX / scale;
    startMouseY = e.clientY / scale;

    if (item.classList.contains('group-box')) {
      item.style.zIndex = groupZIndexCounter++;

      const gLeft = parseFloat(item.style.left) || 0;
      const gTop = parseFloat(item.style.top) || 0;
      const gWidth = parseFloat(item.style.width) || 0;
      const gHeight = parseFloat(item.style.height) || 0;

      // Автоматически захватываем все элементы, которые находятся внутри группы
      document.querySelectorAll('.canvas-item:not(.group-box)').forEach(el => {
        const elLeft = parseFloat(el.style.left) || 0;
        const elTop = parseFloat(el.style.top) || 0;
        const elWidth = parseFloat(el.style.width) || 0;
        const elHeight = parseFloat(el.style.height) || 0;

        const elCenterX = elLeft + elWidth / 2;
        const elCenterY = elTop + elHeight / 2;
        if (elCenterX >= gLeft && elCenterX <= gLeft + gWidth && elCenterY >= gTop && elCenterY <= gTop + gHeight) {
          el.classList.add('selected-item');
        }
      });
    } else {
      item.style.zIndex = zIndexCounter++; // Поднимаем наверх
    }

    // Подготовка ВСЕХ выделенных элементов к групповому перемещению
    document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
      el._startMoveLeft = parseFloat(el.style.left) || 0;
      el._startMoveTop = parseFloat(el.style.top) || 0;
      if (!el.classList.contains('group-box')) {
        el.style.zIndex = zIndexCounter++; // Поднимаем элементы группы
      }
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (isResizingItem) {
      const deltaX = (e.clientX / scale) - itemStartX;
      const deltaY = (e.clientY / scale) - itemStartY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;

      if (resizePos.includes('e')) newWidth = startWidth + deltaX;
      if (resizePos.includes('w')) newWidth = startWidth - deltaX;
      if (resizePos.includes('s')) newHeight = startHeight + deltaY;
      if (resizePos.includes('n')) newHeight = startHeight - deltaY;

      let scaleRatio = 1;
      if (resizePos === 'e' || resizePos === 'w') {
        scaleRatio = newWidth / startWidth;
      } else if (resizePos === 'n' || resizePos === 's') {
        scaleRatio = newHeight / startHeight;
      } else {
        // Проекция движения мыши на диагональ (математически идеальный ресайз без скачков)
        const deltaW = newWidth - startWidth;
        const deltaH = newHeight - startHeight;
        const projScale = (deltaW * startWidth + deltaH * startHeight) / (startWidth * startWidth + startHeight * startHeight);
        scaleRatio = 1 + projScale;
      }

      // Ограничение: картинка не может быть меньше 1 пикселя, и не может "вывернуться" (отрицательный масштаб)
      const minScale = 1 / Math.max(startWidth, startHeight);
      if (scaleRatio < minScale) scaleRatio = minScale;

      newWidth = startWidth * scaleRatio;
      newHeight = startHeight * scaleRatio;

      const ax = item._resizeAnchorX;
      const ay = item._resizeAnchorY;

      // Позиционируем основной элемент через якорь (единая логика для всех)
      newLeft = ax + (startLeft - ax) * scaleRatio;
      newTop = ay + (startTop - ay) * scaleRatio;

      item.style.width = `${newWidth}px`;
      item.style.left = `${newLeft}px`;
      item.style.height = `${newHeight}px`;
      item.style.top = `${newTop}px`;

      // Если это оболочка, масштабируем все дочерние элементы относительно якоря
      if (item._resizeChildren && item._resizeChildren.length > 0) {
        item._resizeChildren.forEach(child => {
          const nw = child.startW * scaleRatio;
          const nh = child.startH * scaleRatio;
          const nl = ax + (child.startL - ax) * scaleRatio;
          const nt = ay + (child.startT - ay) * scaleRatio;
          child.el.style.width = `${nw}px`;
          child.el.style.height = `${nh}px`;
          child.el.style.left = `${nl}px`;
          child.el.style.top = `${nt}px`;
        });
      }

      // Массовый пропорциональный ресайз всех выделенных (относительно якоря)
      document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
        if (el === item || el._resizeStartW === undefined) return;
        const nw = el._resizeStartW * scaleRatio;
        const nh = el._resizeStartH * scaleRatio;
        const nl = ax + (el._resizeStartL - ax) * scaleRatio;
        const nt = ay + (el._resizeStartT - ay) * scaleRatio;
        el.style.width = `${nw}px`;
        el.style.height = `${nh}px`;
        el.style.left = `${nl}px`;
        el.style.top = `${nt}px`;
      });
      return;
    }

    if (!isDraggingItem) return;
    if (!hasDragged) {
      // При начале перетаскивания ставим видео на паузу, чтобы клик не воспроизводил
      document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
        const vid = el.querySelector('video');
        if (vid && !vid.paused) vid.pause();
      });
    }
    hasDragged = true;

    const deltaX = (e.clientX / scale) - startMouseX;
    const deltaY = (e.clientY / scale) - startMouseY;

    // Двигаем сразу всю группу выделенных элементов
    document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
      if (el.dataset.locked === '1') return;   // заблокированный не двигается
      if (el._startMoveLeft !== undefined) {
        el.style.left = `${el._startMoveLeft + deltaX}px`;
        el.style.top = `${el._startMoveTop + deltaY}px`;
      }
    });
  });

  window.addEventListener('mouseup', (e) => {
    // Если клик без таскания и без шифта по УЖЕ выделенному элементу, снимаем выделение с остальных
    if (isDraggingItem && !hasDragged) {
      const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!isMultiSelect && wasSelectedBeforeClick) {
        document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));
        item.classList.add('selected-item');
      }
    }

    // После перетаскивания блокируем следующий click на видео, чтобы оно не воспроизводилось
    if (isDraggingItem && hasDragged) {
      const vid = item.querySelector('video');
      if (vid) {
        const blockClick = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        vid.addEventListener('click', blockClick, { capture: true, once: true });
        // Страховка: убираем блокировку через 300мс
        setTimeout(() => vid.removeEventListener('click', blockClick, { capture: true }), 300);
      }
    }

    if (isDraggingItem && hasDragged) {
      const movedItems = [];
      document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
        if (el.dataset.locked === '1') return;   // заблокированный не двигается
      if (el._startMoveLeft !== undefined) {
          const endLeft = parseFloat(el.style.left) || 0;
          const endTop = parseFloat(el.style.top) || 0;
          const sLeft = el._startMoveLeft;
          const sTop = el._startMoveTop;

          if (endLeft !== sLeft || endTop !== sTop) {
            movedItems.push({ el, sLeft, sTop, endLeft, endTop });
          }
        }
      });

      if (movedItems.length > 0) {
        pushHistory({
          undo: () => {
            movedItems.forEach(m => {
              m.el.style.left = `${m.sLeft}px`;
              m.el.style.top = `${m.sTop}px`;
            });
          },
          redo: () => {
            movedItems.forEach(m => {
              m.el.style.left = `${m.endLeft}px`;
              m.el.style.top = `${m.endTop}px`;
            });
          }
        });
      }
    }

    if (isResizingItem) {
      const endWidth = parseFloat(item.style.width) || 0;
      const endHeight = parseFloat(item.style.height) || 0;
      const endLeft = parseFloat(item.style.left) || 0;
      const endTop = parseFloat(item.style.top) || 0;
      const sWidth = startWidth, sHeight = startHeight, sLeft = startLeft, sTop = startTop;

      if (endWidth !== sWidth || endHeight !== sHeight) {
        // Собираем состояние всех затронутых элементов (дочерних + выделенных)
        const affectedItems = [];

        // Дочерние элементы оболочки
        if (item._resizeChildren) {
          item._resizeChildren.forEach(child => {
            affectedItems.push({
              el: child.el,
              oldW: child.startW, oldH: child.startH,
              oldL: child.startL, oldT: child.startT,
              newW: parseFloat(child.el.style.width), newH: parseFloat(child.el.style.height),
              newL: parseFloat(child.el.style.left), newT: parseFloat(child.el.style.top)
            });
          });
        }

        // Выделенные элементы (кроме основного)
        document.querySelectorAll('.canvas-item.selected-item').forEach(el => {
          if (el === item) return;
          if (el._resizeStartW === undefined) return;
          // Проверяем, не добавлен ли уже как дочерний
          if (!affectedItems.find(a => a.el === el)) {
            affectedItems.push({
              el,
              oldW: el._resizeStartW, oldH: el._resizeStartH,
              oldL: el._resizeStartL, oldT: el._resizeStartT,
              newW: parseFloat(el.style.width), newH: parseFloat(el.style.height),
              newL: parseFloat(el.style.left), newT: parseFloat(el.style.top)
            });
          }
        });

        pushHistory({
          undo: () => {
            item.style.width = `${sWidth}px`; item.style.height = `${sHeight}px`;
            item.style.left = `${sLeft}px`; item.style.top = `${sTop}px`;
            affectedItems.forEach(a => {
              a.el.style.width = `${a.oldW}px`; a.el.style.height = `${a.oldH}px`;
              a.el.style.left = `${a.oldL}px`; a.el.style.top = `${a.oldT}px`;
            });
          },
          redo: () => {
            item.style.width = `${endWidth}px`; item.style.height = `${endHeight}px`;
            item.style.left = `${endLeft}px`; item.style.top = `${endTop}px`;
            affectedItems.forEach(a => {
              a.el.style.width = `${a.newW}px`; a.el.style.height = `${a.newH}px`;
              a.el.style.left = `${a.newL}px`; a.el.style.top = `${a.newT}px`;
            });
          }
        });
      }
    }

    isDraggingItem = false;
    isResizingItem = false;
  });

  canvas.appendChild(item);

  // Добавляем создание в историю
  pushHistory({
    undo: () => item.remove(),
    redo: () => document.getElementById('canvas').appendChild(item)
  });

  return { item, contentWrap, title };
}

function handleFile(file, mouseX, mouseY, onLoadedCallback = null) {
  // Универсальный и самый надежный способ работы с локальными медиафайлами
  const localUrl = URL.createObjectURL(file);

  if (file.type.startsWith('image/')) {
    let filePath = file.path;
    if (!filePath) {
      filePath = refspace.media.pathForDroppedFile(file);
    }

    const { item, contentWrap, title } = createItemContainer(mouseX, mouseY, filePath || '');
    item.dataset.type = 'image';
    title.textContent = file.name;

    addPendingMedia();
    const img = document.createElement('img');
    img.draggable = false;
    img.onerror = () => {
      resolvePendingMedia();
      if (onLoadedCallback) onLoadedCallback(null);
    };
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      item.style.width = `${w}px`;
      item.style.height = `${h}px`;

      // Сдвигаем влево и вверх на половину размера, чтобы курсор был ровно в центре
      const currentLeft = parseFloat(item.style.left) || 0;
      const currentTop = parseFloat(item.style.top) || 0;
      item.style.left = `${currentLeft - w / 2}px`;
      item.style.top = `${currentTop - h / 2}px`;
      resolvePendingMedia();
      if (onLoadedCallback) onLoadedCallback(item);
    };
    img.src = localUrl;
    img.dataset.originalPath = file.path;
    contentWrap.appendChild(img);
  }
  else if (file.type.startsWith('video/')) {
    let filePath = file.path;
    if (!filePath) {
      filePath = refspace.media.pathForDroppedFile(file);
    }

    const { item, contentWrap, title } = createItemContainer(mouseX, mouseY, filePath || '');
    item.dataset.type = 'video';
    title.textContent = file.name;

    addPendingMedia();
    const video = document.createElement('video');
    video.onerror = () => {
      resolvePendingMedia();
      if (onLoadedCallback) onLoadedCallback(null);
      alert(`Ошибка: Формат видео "${file.name}" не поддерживается стандартным плеером. Пожалуйста, используйте стандартные MP4 (H.264) или WebM файлы.`);
    };
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      item.style.width = `${w}px`;
      item.style.height = `${h}px`;

      // Сдвигаем влево и вверх на половину размера, чтобы курсор был ровно в центре
      const currentLeft = parseFloat(item.style.left) || 0;
      const currentTop = parseFloat(item.style.top) || 0;
      item.style.left = `${currentLeft - w / 2}px`;
      item.style.top = `${currentTop - h / 2}px`;
      resolvePendingMedia();
      if (onLoadedCallback) onLoadedCallback(item);
    };
    video.src = localUrl;
    video.controls = true;
    contentWrap.appendChild(video);

    setupMarkerLogic(item, video, false, file);
  }
}

// --- Логика Маркеров ---
function setupMarkerLogic(containerItem, mediaElement, isYouTube, localFile = null) {
  const panel = document.createElement('div');
  panel.className = 'video-markers-panel';

  let videoFPS = 30; // Дефолтный фреймрейт

  const infoHeader = document.createElement('div');
  infoHeader.style.textAlign = 'center';
  infoHeader.style.fontSize = '10px';
  infoHeader.style.color = '#ccc';
  infoHeader.style.marginBottom = '6px';
  infoHeader.style.fontWeight = 'bold';

  const updateHeader = () => {
    if (isYouTube) {
      infoHeader.textContent = 'YouTube Video (Покадровая: ~30 FPS)';
    } else {
      infoHeader.textContent = `Разрешение: ${mediaElement.videoWidth || '?'}x${mediaElement.videoHeight || '?'} | Фреймрейт: ~${videoFPS} FPS`;
    }
  };

  let isFpsDetectedFromMetadata = false;

  if (!isYouTube && mediaElement) {
    // Беззвучный и незаметный парсинг MP4 через MP4Box без запуска самого видео
    if (localFile && localFile.name.toLowerCase().endsWith('.mp4') && typeof MP4Box !== 'undefined') {
      try {
        const mp4boxfile = MP4Box.createFile();
        mp4boxfile.onReady = (info) => {
          if (info.videoTracks && info.videoTracks.length > 0) {
            const track = info.videoTracks[0];
            if (track.nb_samples && track.duration && track.timescale) {
              const fps = Math.round(track.nb_samples / (track.duration / track.timescale));
              if (fps >= 10 && fps <= 144) {
                videoFPS = fps;
                isFpsDetectedFromMetadata = true; // Фиксируем точный FPS
                updateHeader();
              }
            }
          }
        };
        const reader = new FileReader();
        reader.onload = (e) => {
          const buffer = e.target.result;
          buffer.fileStart = 0;
          mp4boxfile.appendBuffer(buffer);
          mp4boxfile.flush();
        };
        // Читаем только первые 5 мегабайт файла, чтобы быстро найти заголовок
        reader.readAsArrayBuffer(localFile.slice(0, 5 * 1024 * 1024));
      } catch (err) {
        console.error("MP4Box parsing failed:", err);
      }
    }

    mediaElement.addEventListener('loadedmetadata', () => {
      updateHeader();
    });

    // Динамическое определение реального FPS во время воспроизведения (только если MP4Box не справился)
    if ('requestVideoFrameCallback' in mediaElement) {
      let lastMediaTime = 0;
      let lastPresentedFrames = 0;

      const frameCallback = (now, metadata) => {
        // Убиваем цикл проверок, если мы уже достали 100% точный FPS из заголовка файла
        if (isFpsDetectedFromMetadata) return;

        // Мерим только во время нормального воспроизведения, игнорируем ручную перемотку на паузе
        if (!mediaElement.paused && lastPresentedFrames > 0 && metadata.presentedFrames > lastPresentedFrames) {
          const timeDiff = Math.abs(metadata.mediaTime - lastMediaTime);
          const frameDiff = Math.abs(metadata.presentedFrames - lastPresentedFrames);

          // Для точности собираем как минимум 10 кадров (треть секунды)
          if (timeDiff > 0.3 && frameDiff >= 10) {
            const calculatedFps = Math.round(frameDiff / timeDiff);
            if (calculatedFps >= 10 && calculatedFps <= 144 && calculatedFps !== videoFPS) {
              videoFPS = calculatedFps;
              updateHeader();
            }
            // Сбрасываем точки отсчета для следующего замера
            lastMediaTime = metadata.mediaTime;
            lastPresentedFrames = metadata.presentedFrames;
          }
        } else if (!mediaElement.paused) {
          // Только начали воспроизведение
          lastMediaTime = metadata.mediaTime;
          lastPresentedFrames = metadata.presentedFrames;
        } else {
          // Пауза или перемотка, сбрасываем отсчет
          lastPresentedFrames = 0;
        }

        mediaElement.requestVideoFrameCallback(frameCallback);
      };
      mediaElement.requestVideoFrameCallback(frameCallback);
    }
  }

  updateHeader();
  panel.appendChild(infoHeader);

  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'video-buttons-row';

  const btnPrevFrame = document.createElement('button');
  btnPrevFrame.textContent = '⏪ -1';
  btnPrevFrame.title = 'На кадр назад (Стрелка влево)';

  const btnMarker = document.createElement('button');
  btnMarker.textContent = '📍 Маркер';

  const btnNextFrame = document.createElement('button');
  btnNextFrame.textContent = '+1 ⏩';
  btnNextFrame.title = 'На кадр вперед (Стрелка вправо)';

  const btnScreenshot = document.createElement('button');
  btnScreenshot.textContent = '📸 Кадр';
  btnScreenshot.title = 'Скопировать текущий кадр в буфер и вставить рядом';

  const btnClearAll = document.createElement('button');
  btnClearAll.textContent = '🗑️ Удалить все маркеры';
  btnClearAll.title = 'Удалить все маркеры';

  buttonsRow.appendChild(btnPrevFrame);
  buttonsRow.appendChild(btnMarker);
  buttonsRow.appendChild(btnNextFrame);
  buttonsRow.appendChild(btnScreenshot);
  buttonsRow.appendChild(btnClearAll);

  btnScreenshot.onclick = async (e) => {
    e.stopPropagation();
    try {
      // Для YouTube нам нужно найти само видео внутри контейнера, так как mediaElement может быть прокси-объектом
      const actualVideo = isYouTube ? containerItem.querySelector('video') : mediaElement;

      const canvas = document.createElement('canvas');
      canvas.width = actualVideo.videoWidth || actualVideo.clientWidth;
      canvas.height = actualVideo.videoHeight || actualVideo.clientHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(actualVideo, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');

      // 1. Копируем в буфер обмена
      await refspace.clipboard.writeImage(dataUrl);

      // 2. Вставляем рядом на холст
      const currentLeft = parseFloat(containerItem.style.left) || 0;
      const currentTop = parseFloat(containerItem.style.top) || 0;
      const currentVideoWidth = parseFloat(containerItem.style.width) || canvas.width;
      const currentVideoHeight = parseFloat(containerItem.style.height) || canvas.height;

      // Рассчитываем реальные размеры видимой части видео (с учетом object-fit: contain)
      const videoRatio = canvas.width / canvas.height;
      const containerRatio = currentVideoWidth / currentVideoHeight;

      let visualWidth = currentVideoWidth;
      let visualHeight = currentVideoHeight;

      if (videoRatio > containerRatio) {
        visualHeight = currentVideoWidth / videoRatio;
      } else {
        visualWidth = currentVideoHeight * videoRatio;
      }

      if (typeof actualVideo._screenshotOffset === 'undefined') {
        actualVideo._screenshotOffset = currentVideoWidth + 40;
      }

      const targetLeft = currentLeft + actualVideo._screenshotOffset;
      const targetTop = currentTop + (currentVideoHeight - visualHeight) / 2;
      actualVideo._screenshotOffset += visualWidth + 40;

      const { item: newImgItem, contentWrap: newWrap, title: newTitle } = createItemContainer(0, 0, '');
      newImgItem.dataset.type = 'image';
      newTitle.textContent = `Кадр: ${actualVideo.currentTime.toFixed(2)}с`;

      // Скрываем элемент до того, как он будет позиционирован, чтобы избежать "моргания"
      newImgItem.style.visibility = 'hidden';

      addPendingMedia();
      const img = document.createElement('img');
      img.draggable = false;
      img.src = dataUrl;
      img.onerror = resolvePendingMedia;
      img.onload = () => {
        newImgItem.style.width = `${visualWidth}px`;
        newImgItem.style.height = `${visualHeight}px`;
        newImgItem.style.left = `${targetLeft}px`;
        newImgItem.style.top = `${targetTop}px`;
        newImgItem.style.visibility = 'visible';
        resolvePendingMedia();
      };
      newWrap.appendChild(img);

    } catch (err) {
      console.error("Screenshot error:", err);
    }
  };

  const markersList = document.createElement('div');
  markersList.className = 'markers-list';

  let markers = containerItem._markers || [];

  const playInterval = (start, end) => {
    if (isYouTube) {
      mediaElement.seekTo(start, true);
      mediaElement.playVideo();

      if (mediaElement._ytIntervalCheck) clearInterval(mediaElement._ytIntervalCheck);

      mediaElement._ytIntervalCheck = setInterval(async () => {
        const current = await mediaElement.getCurrentTime();
        if (current >= end) {
          mediaElement.pauseVideo();
          clearInterval(mediaElement._ytIntervalCheck);
        }
      }, 50);
    } else {
      mediaElement.currentTime = start;
      mediaElement.play();

      const checkEnd = () => {
        if (mediaElement.currentTime >= end) {
          mediaElement.pause();
          mediaElement.removeEventListener('timeupdate', checkEnd);
        }
      };

      if (mediaElement._currentIntervalListener) {
        mediaElement.removeEventListener('timeupdate', mediaElement._currentIntervalListener);
      }
      mediaElement._currentIntervalListener = checkEnd;
      mediaElement.addEventListener('timeupdate', checkEnd);
    }
  };

  updateMarkerInfo(markers, markersList, playInterval); // Показать начальное состояние

  panel.appendChild(buttonsRow);
  panel.appendChild(markersList);
  containerItem.appendChild(panel);

  const seekFrame = async (direction) => {
    // Используем динамически определенный фреймрейт (или дефолтные 30)
    const frameTime = 1 / videoFPS;
    const delta = direction * frameTime;

    if (isYouTube) {
      const current = await mediaElement.getCurrentTime();
      mediaElement.seekTo(current + delta, true);
    } else {
      mediaElement.currentTime += delta;
    }
  };

  btnPrevFrame.onclick = (e) => { e.stopPropagation(); seekFrame(-1); };
  btnNextFrame.onclick = (e) => { e.stopPropagation(); seekFrame(1); };

  // Перехватываем стрелочки на всем контейнере (включая само видео),
  // чтобы отключить встроенную браузерную перемотку на 5 секунд и использовать покадровую
  containerItem.addEventListener('keydown', (e) => {
    // Игнорируем, если фокус в поле ввода (например, ссылка ютуба)
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      seekFrame(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      seekFrame(1);
    }
  }, { capture: true }); // КРИТИЧНО: захватываем событие ДО того, как видео его обработает

  btnClearAll.onclick = (e) => {
    e.stopPropagation();
    markers = [];
    containerItem._markers = markers;
    updateMarkerInfo(markers, markersList, playInterval);
  };

  btnMarker.addEventListener('click', async (e) => {
    e.stopPropagation();
    let currentTime = 0;
    if (isYouTube) {
      currentTime = await mediaElement.getCurrentTime();
    } else {
      currentTime = mediaElement.currentTime;
    }

    // Защита от случайных двойных кликов: не ставим маркер, если рядом (ближе 0.05 сек) уже есть
    const isDuplicate = markers.some(m => Math.abs(m - currentTime) < 0.05);
    if (isDuplicate) return;

    markers.push(currentTime);
    markers.sort((a, b) => a - b); // Сортируем по времени
    containerItem._markers = markers;

    updateMarkerInfo(markers, markersList, playInterval);
  });
}

function updateMarkerInfo(markers, listElement, playIntervalCallback) {
  listElement.innerHTML = '';

  if (markers.length < 2) {
    listElement.innerHTML = `<div class="marker-empty">Ждем 2 маркера... (Установлено: ${markers.length})</div>`;
    return;
  }

  for (let i = 0; i < markers.length - 1; i++) {
    const diff = Math.abs(markers[i + 1] - markers[i]);

    const row = document.createElement('div');
    row.className = 'marker-row';

    const col1 = document.createElement('div');
    col1.className = 'marker-col';
    col1.textContent = `▶ М${i + 1}-М${i + 2}`;

    // Делаем текст кликабельным для воспроизведения отрезка
    col1.style.cursor = 'pointer';
    col1.title = 'Нажмите, чтобы воспроизвести этот отрезок';
    col1.onmouseenter = () => col1.style.color = 'white';
    col1.onmouseleave = () => col1.style.color = '';
    col1.onclick = (e) => {
      e.stopPropagation();
      if (playIntervalCallback) {
        playIntervalCallback(markers[i], markers[i + 1]);
      }
    };

    const col2 = document.createElement('div');
    col2.className = 'marker-col time-col';
    col2.textContent = `${diff.toFixed(2)} с`;

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-marker-del';
    btnDel.textContent = '✖';
    btnDel.title = `Удалить маркер М${i + 2}`;
    btnDel.onclick = (e) => {
      e.stopPropagation();
      // Удаляем конец этого интервала (маркер i+1), что приведет к объединению или сокращению
      markers.splice(i + 1, 1);
      updateMarkerInfo(markers, listElement, playIntervalCallback);
    };

    row.appendChild(col1);
    row.appendChild(col2);
    row.appendChild(btnDel);
    listElement.appendChild(row);
  }
}

// Функция логирования в файл через IPC
function flog(msg) {
  if (window.refspace) {
    refspace.log(msg);
  }
}

function addYouTubeVideo(videoId) {
  flog(`[START] addYouTubeVideo with ID: ${videoId}`);
  const playerId = 'player-' + Date.now();

  const rect = canvasContainer.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  flog(`[UI] Creating item container at ${centerX}, ${centerY}`);
  const { item, contentWrap, title } = createItemContainer(centerX, centerY, '');
  item.dataset.type = 'youtube';
  item.dataset.videoId = videoId;
  title.textContent = 'YouTube Video';

  item.style.width = '480px';
  item.style.height = '270px';

  flog('[UI] Creating video element');
  const video = document.createElement('video');
  video.id = playerId;
  video.style.width = '100%';
  video.style.height = '100%';
  video.controls = true;
  video.style.background = '#000';
  video.style.objectFit = 'contain';
  contentWrap.appendChild(video);

  const audio = document.createElement('audio');
  audio.style.display = 'none';
  contentWrap.appendChild(audio);

  // --- Логика синхронизации ---
  video.onplay = () => audio.play();
  video.onpause = () => audio.pause();
  video.onseeking = () => { audio.pause(); audio.currentTime = video.currentTime; };
  video.onseeked = () => { audio.currentTime = video.currentTime; if (!video.paused) audio.play(); };
  video.onwaiting = () => audio.pause();
  video.onplaying = () => { if (!video.paused) audio.play(); };
  video.onvolumechange = () => { audio.volume = video.volume; audio.muted = video.muted; };
  video.onratechange = () => { audio.playbackRate = video.playbackRate; };

  // Постоянная проверка на "рассинхрон" (drift)
  const driftCheck = setInterval(() => {
    if (!video.paused && Math.abs(video.currentTime - audio.currentTime) > 0.15) {
      audio.currentTime = video.currentTime;
    }
  }, 500);

  // Очистка при удалении
  item._cleanupSync = () => clearInterval(driftCheck);

  // Устанавливаем начальный размер 16:9
  item.style.width = '640px';
  item.style.height = '360px';

  const statusMsg = document.createElement('div');
  statusMsg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);color:#0f0;display:flex;align-items:center;justify-content:center;z-index:9999;font-weight:bold;font-size:16px;pointer-events:none;';
  statusMsg.textContent = 'СТАРТ ЗАГРУЗКИ...';
  contentWrap.appendChild(statusMsg);

  async function fetchStreamUrl(id) {
    flog(`[YT-DLP] Requesting direct stream for ${id}`);
    statusMsg.textContent = 'Загрузка видео';

    try {
      // Специальный запрос, который main.js перехватит и обработает через yt-dlp
      // Возвращаются токены, а не адреса: поток идёт через главный процесс,
      // с того же происхождения, что и страница, иначе снять кадр нельзя.
      const tokens = await refspace.media.resolveYouTube(id);
      if (tokens && tokens.videoToken) {
        flog(`[SUCCESS] Streams obtained via yt-dlp`);
        const at = tokens.audioToken || tokens.videoToken;
        return {
          video: `refspace://app/_stream/${tokens.videoToken}`,
          audio: `refspace://app/_stream/${at}`
        };
      }
    } catch (e) {
      flog(`[ERROR] yt-dlp failed: ${e.message}`);
    }

    return null;
  }

  flog('[STEP] Calling fetchStreamUrl...');
  fetchStreamUrl(videoId).then(streams => {
    if (streams && streams.video) {
      flog('[PLAY] Stream URLs obtained, starting playback');
      statusMsg.style.display = 'none';
      video.src = streams.video;
      audio.src = streams.audio;

      setupMarkerLogic(item, {
        seekTo: (s) => {
          video.currentTime = s;
          audio.currentTime = s;
        },
        getCurrentTime: async () => video.currentTime,
        playVideo: () => { video.play(); audio.play(); },
        pauseVideo: () => { video.pause(); audio.pause(); }
      }, true);
    } else {
      flog('[FAIL] FAILED to get stream URL');
      statusMsg.textContent = 'ОШИБКА: НЕТ ССЫЛКИ';
      statusMsg.style.color = 'red';
    }
  }).catch(err => {
    flog(`[FATAL] Error in fetchStreamUrl: ${err.message}`);
  });
}

document.getElementById('add-youtube-btn').addEventListener('click', () => {
  const urlInput = document.getElementById('youtube-url');
  const url = urlInput.value.trim();
  if (!url) return;

  const videoId = extractYouTubeID(url);
  if (videoId) {
    urlInput.value = '';
    addYouTubeVideo(videoId);
  } else {
    alert(t('yt.invalid'));
  }
});

function extractYouTubeID(url) {
  if (!url) return null;
  const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[1].length === 11) ? match[1] : null;
}

// --- Глобальное отслеживание мыши для вставки ---
let globalMouseX = window.innerWidth / 2;
let globalMouseY = window.innerHeight / 2;

// --- Режим прилипания при вставке ---
let isPastingPlacement = false;
let pastingPlacementItems = [];
let lastPlacementMouseX = 0;
let lastPlacementMouseY = 0;

function startPlacementMode(items) {
  isPastingPlacement = true;
  pastingPlacementItems = items;

  // Центрируем объекты чётко под текущим курсором
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach(el => {
    const elLeft = parseFloat(el.style.left) || 0;
    const elTop = parseFloat(el.style.top) || 0;
    const elW = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width) || 0;
    const elH = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height) || 0;
    if (elLeft < minX) minX = elLeft;
    if (elTop < minY) minY = elTop;
    if (elLeft + elW > maxX) maxX = elLeft + elW;
    if (elTop + elH > maxY) maxY = elTop + elH;
  });

  const rect = canvasContainer.getBoundingClientRect();
  const canvasMouseX = (globalMouseX - rect.left - translateX) / scale;
  const canvasMouseY = (globalMouseY - rect.top - translateY) / scale;

  const centerX = minX + (maxX - minX) / 2;
  const centerY = minY + (maxY - minY) / 2;
  const dx = canvasMouseX - centerX;
  const dy = canvasMouseY - centerY;

  items.forEach(el => {
    const elLeft = parseFloat(el.style.left) || 0;
    const elTop = parseFloat(el.style.top) || 0;
    el.style.left = `${elLeft + dx}px`;
    el.style.top = `${elTop + dy}px`;
    el.style.pointerEvents = 'none';
  });

  lastPlacementMouseX = globalMouseX;
  lastPlacementMouseY = globalMouseY;
}

function stopPlacementMode() {
  if (!isPastingPlacement) return;
  isPastingPlacement = false;
  pastingPlacementItems.forEach(el => el.style.pointerEvents = 'auto');
  pastingPlacementItems = [];
}

window.addEventListener('mousemove', (e) => {
  globalMouseX = e.clientX;
  globalMouseY = e.clientY;

  if (isPastingPlacement) {
    const dx = (globalMouseX - lastPlacementMouseX) / scale;
    const dy = (globalMouseY - lastPlacementMouseY) / scale;
    pastingPlacementItems.forEach(el => {
      const currentLeft = parseFloat(el.style.left) || 0;
      const currentTop = parseFloat(el.style.top) || 0;
      el.style.left = `${currentLeft + dx}px`;
      el.style.top = `${currentTop + dy}px`;
    });
    lastPlacementMouseX = globalMouseX;
    lastPlacementMouseY = globalMouseY;
  }
});

window.addEventListener('mousedown', (e) => {
  if (isPastingPlacement) {
    stopPlacementMode();
    // Опционально: можно остановить всплытие, но лучше пусть работает штатно (например выделение)
    return; // Выходим, чтобы клик не обрабатывался дальше (например панорамированием)
  }
}, { capture: true }); // Перехватываем на фазе погружения


// --- Вставка из буфера обмена (Ctrl+V) ---
async function doPaste(clipboardDataOverride, isMenuPaste = false) {
  if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;

  // Всё нужное из события вставки читается здесь, до первого await:
  // после него e.clipboardData опустеет.
  const overridePastedFiles = [];
  if (clipboardDataOverride && clipboardDataOverride.items) {
    for (let i = 0; i < clipboardDataOverride.items.length; i++) {
      if (clipboardDataOverride.items[i].type.indexOf('image') !== -1) {
        const f = clipboardDataOverride.items[i].getAsFile();
        if (f) overridePastedFiles.push(f);
      }
    }
  }

  // Служебные данные о скопированных элементах хранятся в памяти главного
  // процесса, а не в тексте системного буфера. Иначе при вставке в стороннюю
  // программу вместо картинки появлялся бы JSON.
  const internalJson = await refspace.clipboard.readItems();

  if (internalJson) {
    try {
      const parsed = JSON.parse(internalJson);
      if (parsed.myPureRefSignature === 'mpref1') {
        const mouseX = globalMouseX;
        const mouseY = globalMouseY;
        const newItems = [];

        document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));

        parsed.items.forEach(itemData => {
          const rect = canvasContainer.getBoundingClientRect();
          const canvasMouseX = (mouseX - rect.left - translateX) / scale;
          const canvasMouseY = (mouseY - rect.top - translateY) / scale;
          const targetCanvasX = canvasMouseX + itemData.offsetX;
          const targetCanvasY = canvasMouseY + itemData.offsetY;
          const screenX = targetCanvasX * scale + translateX + rect.left;
          const screenY = targetCanvasY * scale + translateY + rect.top;

          const { item, contentWrap, title } = createItemContainer(screenX, screenY, itemData.path || '');
          item.dataset.type = itemData.type;
          writeItemLook(item, itemData.look);
          item.style.width = itemData.width;
          item.style.height = itemData.height;
          title.textContent = itemData.title;

          if (itemData.type === 'image') {
            addPendingMedia();
            const img = document.createElement('img');
            img.draggable = false;
            img.src = itemData.src;
            if (itemData.path) img.dataset.originalPath = itemData.path;
            img.onerror = resolvePendingMedia;
            img.onload = resolvePendingMedia;
            contentWrap.appendChild(img);
          } else if (itemData.type === 'video') {
            const video = document.createElement('video');
            video.src = itemData.src;
            video.controls = true;
            contentWrap.appendChild(video);
            const fakeFile = { name: itemData.title, path: itemData.path, slice: () => new ArrayBuffer(0) };
            setupMarkerLogic(item, video, false, fakeFile);
          } else if (itemData.type === 'youtube') {
            item.dataset.videoId = itemData.videoId;
            const playerId = 'player-' + Date.now() + Math.random();
            const video = document.createElement('video');
            video.id = playerId;
            video.style.width = '100%';
            video.style.height = '100%';
            video.controls = true;
            video.style.background = '#000';
            video.style.objectFit = 'contain';
            contentWrap.appendChild(video);
            fetchYouTubeStreamForElement(itemData.videoId, video, item);
          } else if (itemData.type === 'group') {
            item.classList.add('group-box');
            item.style.background = itemData.groupColor;
            item.style.zIndex = groupZIndexCounter++;
            title.style.display = 'none';

            const titleLabel = document.createElement('span');
            titleLabel.className = 'group-box-title';
            titleLabel.textContent = itemData.groupTitle;
            titleLabel.style.cursor = 'default';
            titleLabel.style.userSelect = 'none';
            titleLabel.style.flex = '1';

            const titleInput = document.createElement('input');
            titleInput.className = 'group-box-title';
            titleInput.style.display = 'none';

            function startRenameGroup() {
              titleInput.value = titleLabel.textContent;
              titleLabel.style.display = 'none';
              titleInput.style.display = '';
              titleInput.focus();
              titleInput.select();
            }

            titleLabel.addEventListener('dblclick', (ev) => { ev.stopPropagation(); startRenameGroup(); });
            titleInput.addEventListener('mousedown', ev => ev.stopPropagation());
            const finishRename = () => { titleLabel.textContent = titleInput.value || 'Comment'; titleInput.style.display = 'none'; titleLabel.style.display = ''; };
            titleInput.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.code === 'Enter' || ev.code === 'Escape') finishRename(); });
            titleInput.addEventListener('blur', finishRename);

            const colorLabel = document.createElement('span');
            colorLabel.textContent = 'Изменить цвет';
            colorLabel.style.cssText = 'font-size: 11px; margin-right: 5px; opacity: 0.7; user-select: none;';

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.value = '#1e1e1e';
            colorPicker.title = 'Изменить цвет';
            colorPicker.style.cssText = 'width:22px;height:22px;border:none;background:none;cursor:pointer;padding:0; margin-right:5px;';
            colorPicker.addEventListener('mousedown', ev => ev.stopPropagation());
            colorPicker.addEventListener('input', () => {
              const hex = colorPicker.value;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              item.style.background = `rgba(${r}, ${g}, ${b}, 0.4)`;
            });

            item._groupTitleLabel = titleLabel;
            item._groupTitleInput = titleInput;
            item._startRename = startRenameGroup;

            const handle = item.querySelector('.drag-handle');
            handle.insertBefore(titleLabel, title);
            handle.insertBefore(titleInput, title);
            handle.insertBefore(colorLabel, item.querySelector('.btn-remove'));
            handle.insertBefore(colorPicker, item.querySelector('.btn-remove'));
          }

          item.classList.add('selected-item');
          newItems.push(item);
        });

        // Объединяем историю создания в один шаг
        for (let i = 0; i < parsed.items.length; i++) {
          history.pop();
          historyIndex--;
        }

        pushHistory({
          undo: () => newItems.forEach(it => it.remove()),
          redo: () => newItems.forEach(it => document.getElementById('canvas').appendChild(it))
        });

        if (isMenuPaste) {
          startPlacementMode(newItems);
        }

        return; // Успешно вставили наши данные
      }
    } catch (e) {
      console.error('Custom paste failed', e);
    }
  }


  // Сначала пробуем clipboardData (может содержать несколько файлов; уже считано выше, до await)
  const expectedPastedCount = overridePastedFiles.length;

  if (expectedPastedCount > 0) {
    (async () => {
      let offsetStep = 0;
      let pastedItems = [];
      for (let i = 0; i < overridePastedFiles.length; i++) {
          const blob = overridePastedFiles[i];
          const url = URL.createObjectURL(blob);
          const mouseX = globalMouseX + (offsetStep * 30 * scale);
          const mouseY = globalMouseY + (offsetStep * 30 * scale);
          offsetStep++;

          const { item, contentWrap, title } = createItemContainer(mouseX, mouseY, '');
          item.dataset.type = 'image';

          addPendingMedia();
          const img = document.createElement('img');
          img.draggable = false;
          img.onerror = resolvePendingMedia;
          img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            item.style.width = `${w}px`;
            item.style.height = `${h}px`;

            const currentLeft = parseFloat(item.style.left) || 0;
            const currentTop = parseFloat(item.style.top) || 0;
            item.style.left = `${currentLeft - w / 2}px`;
            item.style.top = `${currentTop - h / 2}px`;
            resolvePendingMedia();

            pastedItems.push(item);
            if (pastedItems.length === expectedPastedCount) {
              if (expectedPastedCount > 1) fitItemsToView(pastedItems);
              if (isMenuPaste) {
                startPlacementMode(pastedItems);
              }
            }
          };
          img.src = url;
          contentWrap.appendChild(img);

          if (offsetStep % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
    })();
    return;
  }

  // Вставка картинки из системного буфера обмена (fallback)
  const clipDataUrl = await refspace.clipboard.readImage();
  if (clipDataUrl) {
    const url = clipDataUrl;
    const mouseX = globalMouseX;
    const mouseY = globalMouseY;

    const { item, contentWrap, title } = createItemContainer(mouseX, mouseY, '');
    item.dataset.type = 'image';

    addPendingMedia();
    const img = document.createElement('img');
    img.draggable = false;
    img.onerror = resolvePendingMedia;
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      item.style.width = `${w}px`;
      item.style.height = `${h}px`;

      const currentLeft = parseFloat(item.style.left) || 0;
      const currentTop = parseFloat(item.style.top) || 0;
      item.style.left = `${currentLeft - w / 2}px`;
      item.style.top = `${currentTop - h / 2}px`;
      resolvePendingMedia();

      if (isMenuPaste) {
        startPlacementMode([item]);
      }
    };
    img.src = url;
    contentWrap.appendChild(img);
  }
}

window.addEventListener('paste', (e) => {
  doPaste(e.clipboardData);
});

// --- Горячие клавиши ---
document.addEventListener('keydown', (e) => {
  // Отмена / Повтор
  if (e.ctrlKey || e.metaKey) {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;

    if (e.code === 'KeyZ') {
      e.preventDefault();
      undo();
      return;
    } else if (e.code === 'KeyY') {
      e.preventDefault();
      redo();
      return;
    }
  }

  // Создание оболочки (группы) по клавише C
  if (!e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;
    e.preventDefault();

    const selectedItems = document.querySelectorAll('.canvas-item.selected-item:not(.group-box)');
    let bounds = null;

    if (selectedItems.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      selectedItems.forEach(el => {
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const width = parseFloat(el.style.width) || 0;
        const height = parseFloat(el.style.height) || 0;

        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (left + width > maxX) maxX = left + width;
        if (top + height > maxY) maxY = top + height;
      });

      const padding = 40;
      bounds = {
        left: minX - padding,
        top: minY - padding,
        width: (maxX - minX) + padding * 2,
        height: (maxY - minY) + padding * 2
      };
    }

    const mouseX = globalMouseX;
    const mouseY = globalMouseY;

    const { item, contentWrap, title } = createItemContainer(mouseX, mouseY, '');

    item.classList.add('group-box');
    item.dataset.type = 'group';
    item.style.zIndex = groupZIndexCounter++;

    title.style.display = 'none';

    // Вспомогательная функция переименования
    function startRenameGroup() {
      titleInput.value = titleLabel.textContent;
      titleLabel.style.display = 'none';
      titleInput.style.display = '';
      titleInput.focus();
      titleInput.select();
    }

    // Заголовок группы (текст, редактируется по F2 или двойному клику)
    const titleLabel = document.createElement('span');
    titleLabel.className = 'group-box-title';
    titleLabel.textContent = 'Comment';
    titleLabel.style.cursor = 'default';
    titleLabel.style.userSelect = 'none';
    titleLabel.style.flex = '1';
    titleLabel.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      startRenameGroup();
    });

    // Скрытый инпут для переименования по F2
    const titleInput = document.createElement('input');
    titleInput.className = 'group-box-title';
    titleInput.style.display = 'none';
    titleInput.placeholder = t('grp.title');
    titleInput.addEventListener('mousedown', ev => ev.stopPropagation());
    titleInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.code === 'Enter' || ev.code === 'Escape') {
        titleLabel.textContent = titleInput.value || 'Comment';
        titleInput.style.display = 'none';
        titleLabel.style.display = '';
      }
    });
    titleInput.addEventListener('blur', () => {
      titleLabel.textContent = titleInput.value || 'Comment';
      titleInput.style.display = 'none';
      titleLabel.style.display = '';
    });

    // Кнопка выбора цвета
    const colorLabel = document.createElement('span');
    colorLabel.textContent = 'Изменить цвет';
    colorLabel.style.cssText = 'font-size: 11px; margin-right: 5px; opacity: 0.7; user-select: none;';

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = '#1e1e1e';
    colorPicker.title = 'Изменить цвет';
    colorPicker.style.cssText = 'width:22px;height:22px;border:none;background:none;cursor:pointer;padding:0; margin-right:5px;';
    colorPicker.addEventListener('mousedown', ev => ev.stopPropagation());
    colorPicker.addEventListener('input', () => {
      const hex = colorPicker.value;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      item.style.background = `rgba(${r}, ${g}, ${b}, 0.4)`;
    });

    // Сохраняем ссылки на элементы для F2 и dblclick
    item._groupTitleLabel = titleLabel;
    item._groupTitleInput = titleInput;
    item._startRename = startRenameGroup;

    const handle = item.querySelector('.drag-handle');
    handle.insertBefore(titleLabel, title);
    handle.insertBefore(titleInput, title);
    handle.insertBefore(colorLabel, item.querySelector('.btn-remove'));
    handle.insertBefore(colorPicker, item.querySelector('.btn-remove'));

    if (bounds) {
      item.style.left = `${bounds.left}px`;
      item.style.top = `${bounds.top}px`;
      item.style.width = `${bounds.width}px`;
      item.style.height = `${bounds.height}px`;
    } else {
      item.style.width = '400px';
      item.style.height = '300px';
      const currentLeft = parseFloat(item.style.left) || 0;
      const currentTop = parseFloat(item.style.top) || 0;
      item.style.left = `${currentLeft - 200}px`;
      item.style.top = `${currentTop - 150}px`;
    }
    return;
  }

  // Переименование оболочки по F2
  if (e.code === 'F2') {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;
    const selectedItem = document.querySelector('.canvas-item.selected-item.group-box');
    if (selectedItem && selectedItem._startRename) {
      e.preventDefault();
      selectedItem._startRename();
    }
    return;
  }
  // Создание соединительной линии по клавише L
  if (!e.ctrlKey && !e.metaKey && e.code === 'KeyL') {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;
    e.preventDefault();

    if (!isConnecting) {
      // Первое нажатие — выбираем начальный элемент
      const selected = document.querySelector('.canvas-item.selected-item');
      if (selected) {
        isConnecting = true;
        connectFrom = selected;
        showConnectionHint('Выберите элемент-цель и нажмите L ещё раз (Escape — отмена)');
      } else {
        showConnectionHint('Сначала выделите начальный элемент');
        setTimeout(hideConnectionHint, 2000);
      }
    } else {
      // Второе нажатие — завершаем линию
      const selected = document.querySelector('.canvas-item.selected-item');
      if (selected && selected !== connectFrom) {
        createConnection(connectFrom, selected);
        hideConnectionHint();
      } else {
        showConnectionHint('Выберите другой элемент для завершения связи');
        setTimeout(hideConnectionHint, 2000);
      }
      isConnecting = false;
      connectFrom = null;
    }
    return;
  }

  // Escape — отмена создания линии
  if (e.code === 'Escape') {
    if (isConnecting) {
      isConnecting = false;
      connectFrom = null;
      hideConnectionHint();
      return;
    }
    // Снимаем выделение с линий
    connections.forEach(c => {
      c.pathEl.classList.remove('selected-connection');
      c.cpEl.style.display = 'none';
    });
  }

  // Удаление по Delete / Backspace (поддержка группового удаления + линий)
  if (e.code === 'Delete' || e.code === 'Backspace') {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;

    // Удаляем выделенные линии
    const selectedConns = connections.filter(c => c.pathEl.classList.contains('selected-connection'));
    if (selectedConns.length > 0) {
      selectedConns.forEach(c => deleteConnection(c));
      return;
    }

    const selectedItems = document.querySelectorAll('.canvas-item.selected-item');

    if (selectedItems.length > 0) {
      const itemsToDelete = Array.from(selectedItems).map(el => ({
        item: el,
        parent: el.parentNode,
        nextSibling: el.nextSibling,
        conns: connections.filter(c => c.from === el || c.to === el)
      }));

      const allConnsToRemove = new Set();

      itemsToDelete.forEach(obj => {
        obj.item.remove();
        obj.conns.forEach(c => {
          c.pathEl.remove();
          allConnsToRemove.add(c);
          const idx = connections.indexOf(c);
          if (idx !== -1) connections.splice(idx, 1);
        });
      });

      pushHistory({
        undo: () => {
          itemsToDelete.forEach(obj => {
            if (obj.nextSibling && obj.nextSibling.parentNode === obj.parent) {
              obj.parent.insertBefore(obj.item, obj.nextSibling);
            } else {
              obj.parent.appendChild(obj.item);
            }
          });
          const svg = document.getElementById('connections-svg');
          allConnsToRemove.forEach(c => {
            connections.push(c);
            svg.appendChild(c.pathEl);
            updateConnection(c);
          });
        },
        redo: () => {
          itemsToDelete.forEach(obj => obj.item.remove());
          allConnsToRemove.forEach(c => {
            c.pathEl.remove();
            const idx = connections.indexOf(c);
            if (idx !== -1) connections.splice(idx, 1);
          });
        }
      });
    }
    return;
  }

  // Копирование по Ctrl+C
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;
    doCopy();
  }
});

async function doCopy() {
  const selectedItems = document.querySelectorAll('.canvas-item.selected-item');
  if (selectedItems.length === 0) return;

  // Находим центр выделенных объектов, чтобы копировать относительно него
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  selectedItems.forEach(el => {
    const elLeft = parseFloat(el.style.left) || 0;
    const elTop = parseFloat(el.style.top) || 0;
    const elW = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width) || 0;
    const elH = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height) || 0;
    if (elLeft < minX) minX = elLeft;
    if (elTop < minY) minY = elTop;
    if (elLeft + elW > maxX) maxX = elLeft + elW;
    if (elTop + elH > maxY) maxY = elTop + elH;
  });

  const centerX = minX + (maxX - minX) / 2;
  const centerY = minY + (maxY - minY) / 2;

  const internalClipboard = [];

  selectedItems.forEach(el => {
    const itemData = {
      type: el.dataset.type,
      width: el.style.width,
      height: el.style.height,
      title: el.querySelector('.drag-handle span')?.textContent || '',
      path: el.getAttribute('data-path') || ''
    };

    const elLeft = parseFloat(el.style.left) || 0;
    const elTop = parseFloat(el.style.top) || 0;

    itemData.offsetX = elLeft - centerX;
    itemData.offsetY = elTop - centerY;

    if (itemData.type === 'image') {
      const img = el.querySelector('img');
      if (img) itemData.src = img.src;
    } else if (itemData.type === 'video') {
      const vid = el.querySelector('video');
      if (vid) itemData.src = vid.src;
    } else if (itemData.type === 'youtube') {
      itemData.videoId = el.dataset.videoId;
    } else if (itemData.type === 'group') {
      itemData.groupTitle = el._groupTitleLabel?.textContent || 'Comment';
      itemData.groupColor = getComputedStyle(el).backgroundColor;
    }

    itemData.look = readItemLook(el);
    internalClipboard.push(itemData);
  });

  // Найти первую картинку для вставки в системный буфер
  const firstImgItem = Array.from(selectedItems).find(el => el.dataset.type === 'image');
  let img, canvas;
  if (firstImgItem) {
    img = firstImgItem.querySelector('img');
    if (img) {
      try {
        // Холст строится всегда, а не только когда нет пути к файлу.
        // nativeImage читает с диска лишь PNG и JPEG, поэтому для webp, avif,
        // bmp и прочего картинка в буфере выходила пустой и вставлялся
        // только служебный текст. Через холст получается PNG из чего угодно,
        // что браузер сумел показать.
        canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        img.style.opacity = '0.5';
        setTimeout(() => img.style.opacity = '1', 200);
      } catch (err) {
        console.error("Copy failed", err);
      }
    }
  } else {
    // Подсвечиваем первый элемент, если это не картинка
    const el = selectedItems[0];
    el.style.opacity = '0.5';
    // Возвращаем вид элемента, а не единицу: у него может быть своя прозрачность.
    setTimeout(() => applyItemLook(el), 200);
  }

  const payload = { text: JSON.stringify({ myPureRefSignature: 'mpref1', items: internalClipboard }) };
  if (canvas) {
    try {
      payload.imageDataUrl = canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Failed to export canvas for clipboard', e);
    }
  }
  // Путь остаётся запасным вариантом: если холст не удался, пусть система
  // попробует прочитать файл сама.
  if (!payload.imageDataUrl && img?.dataset.originalPath) {
    payload.imagePath = img.dataset.originalPath;
  }
  await refspace.clipboard.writeItems(payload);
}

// --- Функции соединительных линий ---
function getItemCenter(item) {
  const l = parseFloat(item.style.left) || 0;
  const t = parseFloat(item.style.top) || 0;
  const w = parseFloat(item.style.width) || parseFloat(getComputedStyle(item).width);
  const h = parseFloat(item.style.height) || parseFloat(getComputedStyle(item).height);
  return { x: l + w / 2, y: t + h / 2 };
}

// Возвращает координату фиолетовой точки-коннектора на стороне
function getConnectorPoint(item, side) {
  const l = parseFloat(item.style.left) || 0;
  const t = parseFloat(item.style.top) || 0;
  const w = parseFloat(item.style.width) || parseFloat(getComputedStyle(item).width);
  const h = parseFloat(item.style.height) || parseFloat(getComputedStyle(item).height);
  const cx = l + w / 2, cy = t + h / 2;
  switch (side) {
    case 'top': return { x: cx, y: t };
    case 'bottom': return { x: cx, y: t + h };
    case 'left': return { x: l, y: cy };
    case 'right': return { x: l + w, y: cy };
    default: return { x: cx, y: cy };
  }
}

// Определяет ближайшую сторону элемента к точке
function getClosestSide(item, px, py) {
  const sides = ['top', 'bottom', 'left', 'right'];
  let best = 'top', bestDist = Infinity;
  sides.forEach(s => {
    const p = getConnectorPoint(item, s);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bestDist) { bestDist = d; best = s; }
  });
  return best;
}

// Определяет «противоположную» сторону для входа линии
function guessOppositeSide(fromPt, toPt) {
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'left' : 'right';
  } else {
    return dy > 0 ? 'top' : 'bottom';
  }
}

// Вычисляет контрольную точку для кубического Безье в зависимости от стороны
function calcAutoControl(pt, otherPt, side) {
  const dx = otherPt.x - pt.x;
  const dy = otherPt.y - pt.y;
  const dist = Math.hypot(dx, dy);
  const offset = Math.max(50, dist * 0.4); // Длина «руки» кривой
  switch (side) {
    case 'top': return { x: pt.x, y: pt.y - offset };
    case 'bottom': return { x: pt.x, y: pt.y + offset };
    case 'left': return { x: pt.x - offset, y: pt.y };
    case 'right': return { x: pt.x + offset, y: pt.y };
    default: return { x: pt.x, y: pt.y };
  }
}

// Ищет canvas-item под координатами (в системе координат холста)
function findItemAt(canvasX, canvasY) {
  const items = document.querySelectorAll('#canvas > .canvas-item');
  let found = null;
  let foundZ = -Infinity;
  items.forEach(el => {
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    const w = parseFloat(el.style.width) || parseFloat(getComputedStyle(el).width);
    const h = parseFloat(el.style.height) || parseFloat(getComputedStyle(el).height);
    const z = parseInt(el.style.zIndex) || 0;
    if (canvasX >= l && canvasX <= l + w && canvasY >= t && canvasY <= t + h && z >= foundZ) {
      found = el;
      foundZ = z;
    }
  });
  return found;
}

function updateConnection(conn) {
  const fromCenter = getItemCenter(conn.from);
  const toCenter = getItemCenter(conn.to);

  // Определяем стороны выхода/входа динамически
  const fromSide = getClosestSide(conn.from, toCenter.x, toCenter.y);
  const toSide = getClosestSide(conn.to, fromCenter.x, fromCenter.y);

  const fromPt = getConnectorPoint(conn.from, fromSide);
  const toPt = getConnectorPoint(conn.to, toSide);

  // Кубическая Безье S-кривая
  const cp1 = calcAutoControl(fromPt, toPt, fromSide);
  const cp2 = calcAutoControl(toPt, fromPt, toSide);

  conn.pathEl.setAttribute('d', `M ${fromPt.x} ${fromPt.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${toPt.x} ${toPt.y}`);
}

function updateAllConnections() {
  connections.forEach(updateConnection);
}

function createConnection(fromItem, toItem) {
  if (connections.find(c => (c.from === fromItem && c.to === toItem) || (c.from === toItem && c.to === fromItem))) return;

  const svg = document.getElementById('connections-svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.classList.add('connection-path');
  path.setAttribute('marker-end', 'url(#arrowhead)');
  svg.appendChild(path);

  const conn = { from: fromItem, to: toItem, pathEl: path };
  connections.push(conn);

  path.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    connections.forEach(c => c.pathEl.classList.remove('selected-connection'));
    path.classList.add('selected-connection');
    document.querySelectorAll('.canvas-item').forEach(el => el.classList.remove('selected-item'));
  });

  updateConnection(conn);

  pushHistory({
    undo: () => {
      const idx = connections.indexOf(conn);
      if (idx !== -1) connections.splice(idx, 1);
      path.remove();
    },
    redo: () => {
      connections.push(conn);
      svg.appendChild(path);
      updateConnection(conn);
    }
  });
}

function deleteConnection(conn) {
  const idx = connections.indexOf(conn);
  if (idx !== -1) connections.splice(idx, 1);
  conn.pathEl.remove();

  pushHistory({
    undo: () => {
      const svg = document.getElementById('connections-svg');
      connections.push(conn);
      svg.appendChild(conn.pathEl);
      updateConnection(conn);
    },
    redo: () => {
      const idx2 = connections.indexOf(conn);
      if (idx2 !== -1) connections.splice(idx2, 1);
      conn.pathEl.remove();
    }
  });
}

function showConnectionHint(text) {
  if (!connectionHint) {
    connectionHint = document.createElement('div');
    connectionHint.className = 'connection-hint';
    document.body.appendChild(connectionHint);
  }
  connectionHint.textContent = text;
  connectionHint.style.opacity = '1';
}

function hideConnectionHint() {
  if (connectionHint) connectionHint.style.opacity = '0';
}

window.addEventListener('mousemove', () => {
  updateAllConnections();
});

// --- Функционал сохранения и открытия проекта ---

let currentProjectPath = null;
let lastSavedProjectString = null; // Теперь хранит только структуру (без тяжелых base64 данных) для быстрых проверок

function getProjectData(skipImageData = false) {
  const projectData = {
    version: 2,
    canvas: {
      scale: scale,
      translateX: translateX,
      translateY: translateY
    },
    items: [],
    connections: []
  };

  document.querySelectorAll('.canvas-item').forEach(el => {
    const itemPath = el.getAttribute('data-path') || '';
    const itemData = {
      id: el.dataset.id,
      type: el.dataset.type,
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
      zIndex: el.style.zIndex,
      title: el.querySelector('.drag-handle span')?.textContent || '',
      path: itemPath
    };

    if (itemData.type === 'video' && !itemData.path) {
      console.warn(`Видео "${itemData.title}" не имеет пути при сохранении.`);
    }

    if (itemData.type === 'image') {
      const img = el.querySelector('img');
      if (img) {
        if (!skipImageData) {
          try {
            if (img.src.startsWith('data:')) {
              itemData.data = img.src;
            } else if (itemPath) {
              // Исходный файл на месте — пусть главный процесс вошьёт его байты
              // как есть. Перекодирование фотографии в PNG раздувает её в разы
              // и при этом ничего не добавляет: JPEG уже сжат как надо.
              itemData.embedFrom = itemPath;
            } else {
              if (!el._cachedData) {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                el._cachedData = canvas.toDataURL('image/png');
              }
              itemData.data = el._cachedData;
            }
          } catch (err) {
            console.error("Failed to embed image", err);
          }
        }
        itemData.path = itemPath;
      }
    } else if (itemData.type === 'video') {
      itemData.path = itemPath;
      itemData.markers = el._markers || [];
    } else if (itemData.type === 'youtube') {
      itemData.videoId = el.dataset.videoId;
      itemData.markers = el._markers || [];
    } else if (itemData.type === 'group') {
      itemData.groupTitle = el._groupTitleLabel?.textContent || 'Comment';
      const bg = getComputedStyle(el).backgroundColor;
      itemData.groupColor = bg;
    }

    itemData.look = readItemLook(el);
    projectData.items.push(itemData);
  });

  connections.forEach(conn => {
    projectData.connections.push({
      fromId: conn.from.dataset.id,
      toId: conn.to.dataset.id
    });
  });

  return projectData;
}

async function saveProject(forceSaveAs = false) {
  const projectData = getProjectData();

  const pathArg = forceSaveAs ? null : currentProjectPath;
  const result = await refspace.project.save(projectData, pathArg, t('modal.saveTitle'));

  if (result.success) {
    currentProjectPath = result.filePath;
    lastSavedProjectString = JSON.stringify(getProjectData(true));
    showConnectionHint(t('proj.saved'));
    setTimeout(hideConnectionHint, 2000);
  } else if (result.error) {
    alert(t('proj.saveErr') + result.error);
  }
  return result.success;
}

function hasUnsavedChanges() {
  if (lastSavedProjectString === null) {
    // Никогда не сохраняли — если есть хоть один элемент на холсте, считаем что есть несохранённые изменения
    return document.querySelectorAll('.canvas-item').length > 0;
  }
  return JSON.stringify(getProjectData(true)) !== lastSavedProjectString;
}

async function tryCloseApp() {
  if (!hasUnsavedChanges()) {
    refspace.window.close();
    return;
  }
  showCloseConfirmModal(false);
}

function closeProject() {
  document.querySelectorAll('.canvas-item').forEach(el => el.remove());
  connections.forEach(c => c.pathEl.remove());
  connections.length = 0;
  history.length = 0;
  historyIndex = -1;
  currentProjectPath = null;
  lastSavedProjectString = null;
}

function showCloseConfirmModal(isCloseProject = false) {
  // Затемнение фона
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.6); z-index: 1000000;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(4px);
  `;

  // Окно модалки
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1e1e1e; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px; padding: 24px 28px; min-width: 380px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    font-family: 'Inter', sans-serif; color: #e0e0e0;
  `;

  const title = document.createElement('div');
  title.textContent = 'Несохранённые изменения';
  title.style.cssText = 'font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #fff;';

  const msg = document.createElement('div');
  msg.textContent = 'В проекте есть изменения, которые не были сохранены. Что вы хотите сделать?';
  msg.style.cssText = 'font-size: 13px; color: #aaa; margin-bottom: 22px; line-height: 1.5;';

  const buttonsRow = document.createElement('div');
  buttonsRow.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

  const makeBtn = (text, bg, hoverBg, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      padding: 8px 16px; border: none; border-radius: 8px;
      font-size: 13px; font-family: 'Inter', sans-serif;
      cursor: pointer; color: #fff; background: ${bg};
      transition: background 0.2s;
    `;
    btn.onmouseover = () => btn.style.background = hoverBg;
    btn.onmouseout = () => btn.style.background = bg;
    btn.onclick = () => { overlay.remove(); onClick(); };
    return btn;
  };

  const btnCancel = makeBtn(t('modal.cancel'), 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0.2)', () => {
    // Ничего не делаем — просто закрываем модалку
  });

  const btnDiscard = makeBtn('Закрыть без сохранения', '#ff7675', '#ff4d4d', () => {
    if (isCloseProject) {
      closeProject();
    } else {
      refspace.window.close();
    }
  });

  const btnSave = makeBtn(t('modal.save'), '#6C5CE7', '#8072eb', async () => {
    const saved = await saveProject(false);
    if (saved) {
      if (isCloseProject) {
        closeProject();
      } else {
        refspace.window.close();
      }
    }
  });

  buttonsRow.appendChild(btnCancel);
  buttonsRow.appendChild(btnDiscard);
  buttonsRow.appendChild(btnSave);

  modal.appendChild(title);
  modal.appendChild(msg);
  modal.appendChild(buttonsRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

async function openProject(filePath = null) {
  let result;
  if (filePath && typeof filePath === 'string') {
    result = await refspace.project.openPath(filePath);
  } else {
    result = await refspace.project.open(t('panel.btnOpen'));
  }


  if (result.success && result.data) {
    currentProjectPath = result.filePath;
    const data = result.data;

    // Очистка холста
    document.querySelectorAll('.canvas-item').forEach(el => el.remove());
    connections.forEach(c => c.pathEl.remove());
    connections.length = 0;
    history.length = 0;
    historyIndex = -1;

    // Восстановление холста
    if (data.canvas) {
      scale = data.canvas.scale || 1;
      translateX = data.canvas.translateX || 0;
      translateY = data.canvas.translateY || 0;
      updateCanvasTransform();
    }

    const idToElement = new Map();
    const itemsToLoad = data.items || [];
    const connectionsToLoad = data.connections || [];

    // Восстановление элементов
    for (const itemData of itemsToLoad) {
      let newItem;
      if (itemData.type === 'image' || itemData.type === 'video') {
        // Проверяем наличие файла через основной процесс для надежности
        const hasValidPath = await refspace.project.fileExists(itemData.path);

        console.log(`[OPEN] Item: ${itemData.title}, Path: ${itemData.path}, Valid: ${hasValidPath}`);

        if (itemData.data || itemData.type === 'video') {
          const { item, contentWrap, title } = createItemContainer(0, 0, itemData.path || '');
          item.dataset.id = itemData.id;
          item.dataset.type = itemData.type;
          writeItemLook(item, itemData.look);
          item.style.left = itemData.left;
          item.style.top = itemData.top;
          item.style.width = itemData.width;
          item.style.height = itemData.height;
          item.style.zIndex = itemData.zIndex;
          title.textContent = itemData.title;

          // Локальный файл адресуется токеном: рендерер не знает путей, а
          // протокол отдаёт файл с того же происхождения, что и страница,
          // поэтому чтение пикселей из canvas остаётся возможным.
          const mediaToken = hasValidPath ? await refspace.media.registerLocal(itemData.path) : null;
          const mediaUrl = mediaToken ? `refspace://app/_media/${mediaToken}` : '';

          if (itemData.type === 'image') {
            const img = document.createElement('img');
            img.draggable = false;
            img.src = itemData.data || mediaUrl;
            if (!img.src && !itemData.data) {
              title.textContent += ' (ФАЙЛ ПОТЕРЯН)';
              item.style.background = 'rgba(255,0,0,0.2)';
            }
            contentWrap.appendChild(img);
          } else if (itemData.type === 'video') {
            if (hasValidPath) {
              const video = document.createElement('video');
              video.src = mediaUrl;
              video.controls = true;
              video.onerror = () => console.error("Error loading video:", video.src);
              contentWrap.appendChild(video);

              const fakeFile = {
                name: itemData.title,
                path: itemData.path,
                slice: () => new ArrayBuffer(0)
              };
              item._markers = itemData.markers || [];
              setupMarkerLogic(item, video, false, fakeFile);
            } else {
              title.textContent += ' (ВИДЕО НЕ НАЙДЕНО)';
              item.style.background = 'rgba(255,0,0,0.2)';
              const errorMsg = document.createElement('div');
              errorMsg.style.cssText = 'color: #ff7675; font-size: 10px; text-align: center; padding: 10px;';
              errorMsg.textContent = `Файл удален или перемещен: ${itemData.path}`;
              contentWrap.appendChild(errorMsg);
            }
          }
          newItem = item;
        }
      } else if (itemData.type === 'youtube') {
        // Воссоздаем YouTube видео
        const { item, contentWrap, title } = createItemContainer(0, 0);
        item.dataset.id = itemData.id;
        item.dataset.type = 'youtube';
        item.dataset.videoId = itemData.videoId;
        item.style.left = itemData.left;
        item.style.top = itemData.top;
        item.style.width = itemData.width;
        item.style.height = itemData.height;
        item.style.zIndex = itemData.zIndex;
        title.textContent = itemData.title;

        const playerId = 'player-' + Date.now() + Math.random();
        const video = document.createElement('video');
        video.id = playerId;
        video.style.width = '100%';
        video.style.height = '100%';
        video.controls = true;
        video.style.background = '#000';
        video.style.objectFit = 'contain';
        contentWrap.appendChild(video);

        item._markers = itemData.markers || [];
        fetchYouTubeStreamForElement(itemData.videoId, video, item);
        newItem = item;
      } else if (itemData.type === 'group') {
        // Воссоздаем группу
        // Клавиша C логика:
        const { item, contentWrap, title } = createItemContainer(0, 0);
        item.dataset.id = itemData.id;
        item.dataset.type = 'group';
        item.classList.add('group-box');
        item.style.left = itemData.left;
        item.style.top = itemData.top;
        item.style.width = itemData.width;
        item.style.height = itemData.height;
        item.style.zIndex = itemData.zIndex;
        item.style.background = itemData.groupColor;
        title.style.display = 'none';

        const titleLabel = document.createElement('span');
        titleLabel.className = 'group-box-title';
        titleLabel.textContent = itemData.groupTitle;
        titleLabel.style.cursor = 'default';
        titleLabel.style.userSelect = 'none';
        titleLabel.style.flex = '1';

        const titleInput = document.createElement('input');
        titleInput.className = 'group-box-title';
        titleInput.style.display = 'none';

        function startRenameGroup() {
          titleInput.value = titleLabel.textContent;
          titleLabel.style.display = 'none';
          titleInput.style.display = '';
          titleInput.focus();
          titleInput.select();
        }

        titleLabel.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          startRenameGroup();
        });

        titleInput.addEventListener('mousedown', ev => ev.stopPropagation());
        const finishRename = () => {
          titleLabel.textContent = titleInput.value || 'Comment';
          titleInput.style.display = 'none';
          titleLabel.style.display = '';
        };
        titleInput.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.code === 'Enter' || ev.code === 'Escape') finishRename();
        });
        titleInput.addEventListener('blur', finishRename);

        const colorLabel = document.createElement('span');
        colorLabel.textContent = 'Изменить цвет';
        colorLabel.style.cssText = 'font-size: 11px; margin-right: 5px; opacity: 0.7; user-select: none;';

        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        // Конвертируем rgba в hex для color picker если нужно, но пока оставим дефолт
        colorPicker.value = '#1e1e1e';
        colorPicker.title = 'Изменить цвет';
        colorPicker.style.cssText = 'width:22px;height:22px;border:none;background:none;cursor:pointer;padding:0; margin-right:5px;';
        colorPicker.addEventListener('mousedown', ev => ev.stopPropagation());
        colorPicker.addEventListener('input', () => {
          const hex = colorPicker.value;
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          item.style.background = `rgba(${r}, ${g}, ${b}, 0.4)`;
        });

        item._groupTitleLabel = titleLabel;
        item._groupTitleInput = titleInput;
        item._startRename = startRenameGroup;

        const handle = item.querySelector('.drag-handle');
        handle.insertBefore(titleLabel, title);
        handle.insertBefore(titleInput, title);
        handle.insertBefore(colorLabel, item.querySelector('.btn-remove'));
        handle.insertBefore(colorPicker, item.querySelector('.btn-remove'));

        newItem = item;
      }

      if (newItem) {
        idToElement.set(itemData.id, newItem);
      }
    }

    // Восстановление связей
    connectionsToLoad.forEach(cData => {
      const from = idToElement.get(cData.fromId);
      const to = idToElement.get(cData.toId);
      if (from && to) {
        createConnection(from, to);
      }
    });

    showConnectionHint(t('proj.opened'));
    setTimeout(hideConnectionHint, 2000);

    // Очищаем историю после загрузки, так как создание элементов её заполнило
    history.length = 0;
    historyIndex = -1;
    lastSavedProjectString = JSON.stringify(getProjectData(true));
  } else if (result.error) {
    alert(t('proj.openErr') + result.error);
  }
}

// Вспомогательная функция для YouTube при загрузке (чтобы не дублировать код)
async function fetchYouTubeStreamForElement(videoId, videoElement, containerItem) {
  const statusMsg = document.createElement('div');
  statusMsg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);color:#0f0;display:flex;align-items:center;justify-content:center;z-index:9999;font-weight:bold;font-size:16px;pointer-events:none;';
  statusMsg.textContent = 'ВОССТАНОВЛЕНИЕ...';
  videoElement.parentNode.appendChild(statusMsg);

  const audioElement = document.createElement('audio');
  audioElement.style.display = 'none';
  videoElement.parentNode.appendChild(audioElement);

  // Синхронизация при восстановлении
  videoElement.onplay = () => audioElement.play();
  videoElement.onpause = () => audioElement.pause();
  videoElement.onseeking = () => { audioElement.pause(); audioElement.currentTime = videoElement.currentTime; };
  videoElement.onseeked = () => { audioElement.currentTime = videoElement.currentTime; if (!videoElement.paused) audioElement.play(); };
  videoElement.onwaiting = () => audioElement.pause();
  videoElement.onplaying = () => { if (!videoElement.paused) audioElement.play(); };
  videoElement.onvolumechange = () => { audioElement.volume = videoElement.volume; audioElement.muted = videoElement.muted; };
  videoElement.onratechange = () => { audioElement.playbackRate = videoElement.playbackRate; };

  const driftCheck = setInterval(() => {
    if (!videoElement.paused && Math.abs(videoElement.currentTime - audioElement.currentTime) > 0.15) {
      audioElement.currentTime = videoElement.currentTime;
    }
  }, 500);
  containerItem._cleanupSync = () => clearInterval(driftCheck);

  try {
    const tokens = await refspace.media.resolveYouTube(videoId);
    if (tokens && tokens.videoToken) {
      statusMsg.style.display = 'none';
      videoElement.src = `refspace://app/_stream/${tokens.videoToken}`;
      audioElement.src = `refspace://app/_stream/${tokens.audioToken || tokens.videoToken}`;
      setupMarkerLogic(containerItem, {
        seekTo: (s) => {
          videoElement.currentTime = s;
          audioElement.currentTime = s;
        },
        getCurrentTime: async () => videoElement.currentTime,
        playVideo: () => { videoElement.play(); audioElement.play(); },
        pauseVideo: () => { videoElement.pause(); audioElement.pause(); }
      }, true);
    } else {
      statusMsg.textContent = 'ОШИБКА';
    }
  } catch (e) {
    statusMsg.textContent = 'ОШИБКА';
  }
}

// Привязка кнопок
document.getElementById('save-project-btn').addEventListener('click', saveProject);
document.getElementById('open-project-btn').addEventListener('click', openProject);

// Привязка горячих клавиш
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (document.activeElement && document.activeElement.tagName.toLowerCase() === 'input') return;

    if (e.code === 'KeyS') {
      e.preventDefault();
      saveProject();
    } else if (e.code === 'KeyO') {
      e.preventDefault();
      openProject();
    }
  }
});

// --- Верхнее меню (Top Menu) ---
document.querySelectorAll('.top-menu-label').forEach(label => {
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    const parent = label.parentElement;
    const isActive = parent.classList.contains('active');

    document.querySelectorAll('.top-menu-item').forEach(item => item.classList.remove('active'));

    if (!isActive) {
      parent.classList.add('active');
    }
  });
});

window.addEventListener('click', () => {
  document.querySelectorAll('.top-menu-item').forEach(item => item.classList.remove('active'));
});

document.getElementById('tm-open')?.addEventListener('click', openProject);
document.getElementById('tm-close-proj')?.addEventListener('click', () => {
  if (!hasUnsavedChanges()) {
    closeProject();
    return;
  }
  showCloseConfirmModal(true);
});
document.getElementById('tm-save')?.addEventListener('click', () => saveProject(false));
document.getElementById('tm-exit')?.addEventListener('click', () => tryCloseApp());

document.getElementById('tm-copy')?.addEventListener('click', () => {
  const kbEvent = new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true });
  document.dispatchEvent(kbEvent);
});
document.getElementById('tm-paste')?.addEventListener('click', () => {
  doPaste(null, true);
});
document.getElementById('tm-undo')?.addEventListener('click', undo);
document.getElementById('tm-redo')?.addEventListener('click', redo);

function showAboutModal() {
  // Закрываем верхнее меню, если оно было открыто
  document.querySelectorAll('.top-menu-item').forEach(item => item.classList.remove('active'));

  // Затемнение фона
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.6); z-index: 1000000;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(4px);
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Окно модалки
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1e1e1e; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px; padding: 24px 32px; width: 550px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    font-family: 'Inter', sans-serif; color: #e0e0e0;
    max-height: 85vh; overflow-y: auto;
  `;

  const title = document.createElement('div');
  title.textContent = t('about.title');
  title.style.cssText = 'font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #fff; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px;';

  const content = document.createElement('div');
  content.innerHTML = `
    <div style="font-size: 13.5px; line-height: 1.6; color: #bbb;">
      <p style="margin: 0 0 12px 0; color: #fff;"><b>${t('about.featuresTitle')}</b></p>
      <ul style="margin: 0 0 20px 20px; padding: 0;">
        <li style="margin-bottom: 4px;">${t('about.feature1')}</li>
        <li style="margin-bottom: 4px;">${t('about.feature2')}</li>
        <li style="margin-bottom: 4px;">${t('about.feature3')}</li>
        <li style="margin-bottom: 4px;">${t('about.feature4')}</li>
        <li style="margin-bottom: 4px;">${t('about.feature5')}</li>
        <li style="margin-bottom: 4px;">${t('about.feature6')}</li>
        <li style="margin-bottom: 4px;">${t('about.feature7')}</li>
      </ul>

      <p style="margin: 0 0 12px 0; color: #fff;"><b>${t('about.hotkeysTitle')}</b></p>
      <ul style="margin: 0 0 24px 20px; padding: 0;">
        <li style="margin-bottom: 4px;">${t('about.hk1')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk2')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk3')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk4')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk5')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk6')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk7')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk8')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk9')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk10')}</li>
        <li style="margin-bottom: 4px;">${t('about.hk11')}</li>
      </ul>
    </div>
  `;

  const buttonsRow = document.createElement('div');
  buttonsRow.style.cssText = 'display: flex; justify-content: center;';

  const btnClose = document.createElement('button');
  btnClose.textContent = t('about.close');
  btnClose.style.cssText = `
    padding: 10px 30px; border: none; border-radius: 8px;
    font-size: 14px; font-weight: 500; font-family: 'Inter', sans-serif;
    cursor: pointer; color: #fff; background: #6C5CE7;
    transition: background 0.2s, transform 0.1s;
  `;
  btnClose.onmouseover = () => btnClose.style.background = '#8072eb';
  btnClose.onmouseout = () => btnClose.style.background = '#6C5CE7';
  btnClose.onmousedown = () => btnClose.style.transform = 'scale(0.97)';
  btnClose.onmouseup = () => btnClose.style.transform = 'scale(1)';
  btnClose.onclick = () => overlay.remove();

  buttonsRow.appendChild(btnClose);

  modal.appendChild(title);
  modal.appendChild(content);
  modal.appendChild(buttonsRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

document.getElementById('tm-about')?.addEventListener('click', showAboutModal);

// --- Контекстное меню (ПКМ) ---
const contextMenu = document.createElement('div');
contextMenu.className = 'custom-context-menu';
contextMenu.style.position = 'fixed';
contextMenu.style.display = 'none';
contextMenu.style.zIndex = '999999';
contextMenu.style.background = '#2c2c2c';
contextMenu.style.border = '1px solid #444';
contextMenu.style.borderRadius = '6px';
contextMenu.style.padding = '5px 0';
contextMenu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
contextMenu.style.color = '#fff';
contextMenu.style.fontFamily = 'sans-serif';
contextMenu.style.fontSize = '14px';
contextMenu.style.minWidth = '150px';
document.body.appendChild(contextMenu);

// Вид элемента: обесцвечивание, инверсия, отражение и прозрачность.
// Хранится в data-атрибутах самого элемента, чтобы сохранение, копирование
// и открытие проекта работали с ним единообразно.
function applyItemLook(el) {
  if (!el) return;
  // Цель — обёртка содержимого, а не сам img: при открытии проекта картинка
  // создаётся позже, а обёртка существует с самого начала. Отражение на ней
  // переворачивает только содержимое, не задевая шапку с заголовком.
  const target = el.querySelector('.item-content') || el.querySelector('img, video');
  if (target) {
    const f = [];
    if (el.dataset.gray === '1') f.push('grayscale(1)');
    if (el.dataset.invert === '1') f.push('invert(1)');
    target.style.filter = f.join(' ');
    target.style.transform = el.dataset.flip === '1' ? 'scaleX(-1)' : '';
  }
  el.style.opacity = el.dataset.opacity || '1';
}

function readItemLook(el) {
  const look = {};
  if (el.dataset.gray === '1') look.gray = 1;
  if (el.dataset.invert === '1') look.invert = 1;
  if (el.dataset.flip === '1') look.flip = 1;
  if (el.dataset.opacity && el.dataset.opacity !== '1') look.opacity = Number(el.dataset.opacity);
  if (el.dataset.locked === '1') look.locked = 1;
  return Object.keys(look).length ? look : undefined;
}

function writeItemLook(el, look) {
  if (!look) return;
  if (look.gray) el.dataset.gray = '1';
  if (look.invert) el.dataset.invert = '1';
  if (look.flip) el.dataset.flip = '1';
  if (look.opacity) el.dataset.opacity = String(look.opacity);
  if (look.locked) { el.dataset.locked = '1'; applyLockLook(el); }
  applyItemLook(el);
  // Вызывающий код часто добавляет img или video уже после этого места,
  // поэтому повторяем применение, когда содержимое точно на месте.
  setTimeout(() => applyItemLook(el), 0);
}

function applyLockLook(el) {
  const locked = el.dataset.locked === '1';
  el.style.outline = locked ? '2px dashed rgba(255,255,255,.45)' : '';
  el.style.outlineOffset = locked ? '2px' : '';
}

function toggleLock(els) {
  // Если выделены и запертые, и свободные — запираем все: так предсказуемее.
  const lockAll = els.some(el => el.dataset.locked !== '1');
  els.forEach(el => {
    if (lockAll) el.dataset.locked = '1'; else delete el.dataset.locked;
    applyLockLook(el);
  });
}

function bringToFront(els) {
  els.forEach(el => { el.style.zIndex = zIndexCounter++; });
}

function sendToBack(els) {
  const all = Array.from(document.querySelectorAll('.canvas-item'))
    .map(el => parseInt(el.style.zIndex, 10) || 0);
  let min = all.length ? Math.min(...all) : 1;
  // Ниже единицы не опускаемся: под холстом лежит подложка с zIndex 0.
  els.forEach(el => { el.style.zIndex = String(Math.max(1, --min)); });
}

function toggleLook(els, key) {
  els.forEach(el => {
    el.dataset[key] = el.dataset[key] === '1' ? '0' : '1';
    applyItemLook(el);
  });
}

function stepOpacity(els, delta) {
  els.forEach(el => {
    const cur = Number(el.dataset.opacity || 1);
    const next = Math.min(1, Math.max(0.15, Math.round((cur + delta) * 100) / 100));
    el.dataset.opacity = String(next);
    applyItemLook(el);
  });
}

function resetLook(els) {
  els.forEach(el => {
    delete el.dataset.gray; delete el.dataset.invert;
    delete el.dataset.flip; delete el.dataset.opacity;
    applyItemLook(el);
  });
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

window.addEventListener('click', hideContextMenu);
window.addEventListener('mousedown', (e) => {
  if (e.button !== 2) {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  }
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();

  const selectedItems = document.querySelectorAll('.canvas-item.selected-item');
  contextMenu.innerHTML = '';

  const createMenuItem = (label, onClick, isDanger = false) => {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.padding = '8px 15px';
    item.style.cursor = 'pointer';
    if (isDanger) item.style.color = '#ff7675';

    item.onmouseover = () => item.style.background = isDanger ? 'rgba(255, 118, 117, 0.2)' : '#4a90e2';
    item.onmouseout = () => item.style.background = 'transparent';
    item.onclick = (ev) => {
      ev.stopPropagation();
      hideContextMenu();
      onClick();
    };
    return item;
  };

  // Копировать
  contextMenu.appendChild(createMenuItem(t('ctx.copy'), () => {
    const kbEvent = new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true });
    document.dispatchEvent(kbEvent);
  }));

  // Вставить
  contextMenu.appendChild(createMenuItem(t('ctx.paste'), () => {
    doPaste(null, false);
  }));

  // Слои и блокировка: имеют смысл для любого элемента, включая оболочки
  if (selectedItems.length > 0) {
    const all = Array.from(selectedItems);
    const anyUnlocked = all.some(el => el.dataset.locked !== '1');

    contextMenu.appendChild(createMenuItem(t('ctx.toFront'), () => bringToFront(all)));
    contextMenu.appendChild(createMenuItem(t('ctx.toBack'), () => sendToBack(all)));
    contextMenu.appendChild(createMenuItem(
      anyUnlocked ? t('ctx.lock') : t('ctx.unlock'), () => toggleLock(all)));
  }

  // Вид: работает для картинок и видео, для оболочек смысла не имеет
  const lookTargets = Array.from(selectedItems)
    .filter(el => el.dataset.type === 'image' || el.dataset.type === 'video');

  if (lookTargets.length > 0) {
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:rgba(255,255,255,.12);margin:5px 0;';
    contextMenu.appendChild(sep);

    contextMenu.appendChild(createMenuItem(t('ctx.grayscale'), () => toggleLook(lookTargets, 'gray')));
    contextMenu.appendChild(createMenuItem(t('ctx.invert'), () => toggleLook(lookTargets, 'invert')));
    contextMenu.appendChild(createMenuItem(t('ctx.flip'), () => toggleLook(lookTargets, 'flip')));
    contextMenu.appendChild(createMenuItem(t('ctx.fadeOut'), () => stepOpacity(lookTargets, -0.15)));
    contextMenu.appendChild(createMenuItem(t('ctx.fadeIn'), () => stepOpacity(lookTargets, 0.15)));
    contextMenu.appendChild(createMenuItem(t('ctx.resetLook'), () => resetLook(lookTargets)));

    const sep2 = document.createElement('div');
    sep2.style.cssText = 'height:1px;background:rgba(255,255,255,.12);margin:5px 0;';
    contextMenu.appendChild(sep2);
  }

  // Создать оболочку
  if (selectedItems.length > 0) {
    contextMenu.appendChild(createMenuItem(t('ctx.createGroup'), () => {
      const kbEvent = new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: false, metaKey: false });
      document.dispatchEvent(kbEvent);
    }));
  }

  // Разорвать связь
  if (selectedItems.length > 0) {
    const selectedArr = Array.from(selectedItems);
    let hasLines = false;

    const checkConnection = (c) => {
      return selectedArr.includes(c.from) && selectedArr.includes(c.to);
    };

    if (selectedArr.length === 1) {
      hasLines = connections.some(c => c.from === selectedArr[0] || c.to === selectedArr[0]);
    } else {
      hasLines = connections.some(checkConnection);
    }

    if (hasLines) {
      const breakLinesItem = createMenuItem(t('ctx.breakLink'), () => {
        let connsToRemove = [];
        if (selectedArr.length === 1) {
          connsToRemove = connections.filter(c => c.from === selectedArr[0] || c.to === selectedArr[0]);
        } else {
          connsToRemove = connections.filter(checkConnection);
        }
        connsToRemove.forEach(conn => deleteConnection(conn));
      }, true);
      contextMenu.appendChild(breakLinesItem);
    }
  }

  if (contextMenu.children.length > 0) {
    let left = e.clientX;
    let top = e.clientY;

    contextMenu.style.display = 'block';

    const menuRect = contextMenu.getBoundingClientRect();
    if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width;
    if (top + menuRect.height > window.innerHeight) top = window.innerHeight - menuRect.height;

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  }
});

// Обработка открытия проекта из аргументов запуска
refspace.project.startupFile().then(filePath => {
  if (filePath) {
    openProject(filePath);
  }
});

// Обработка открытия проекта при запущенном приложении (второй экземпляр)
refspace.window.onOpenProjectFile((filePath) => {
  if (filePath) {
    if (hasUnsavedChanges()) {
      if (confirm(t('alert.unsaved'))) {
        openProject(filePath);
      }
    } else {
      openProject(filePath);
    }
  }
});
