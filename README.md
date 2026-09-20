
# 🎨 RefSpace
> Профессиональный бесконечный холст для работы с референсами, поддерживающий изображения, видео и интерактивные связи.

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![Electron](https://img.shields.io/badge/built%20with-Electron-47848F.svg)
![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)

**RefSpace** — это мощный инструмент для художников, дизайнеров и режиссеров монтажа, позволяющий организовать визуальное рабочее пространство без ограничений. В отличие от аналогов, RefSpace полностью поддерживает видеофайлы и YouTube-плееры, позволяя создавать живые мудборды. Поскольку приложение распространяется в виде готового `.exe` файла, вам не нужно ничего собирать — просто запустите программу и начните творить!

---
<img width="2541" height="1352" alt="scrin1" src="https://github.com/user-attachments/assets/216e5aed-0e62-4a6d-81d6-2eab85bacbb0" />

## ⚙️ Как это работает (Функции программы)

### 1. Бесконечный холст
*   **Перемещение по доске:** Зажмите пробел и левую кнопку мыши (или нажмите колесико мыши), чтобы свободно двигаться по вашему рабочему пространству.
*   **Приближение (Зум):** Крутите колесико мыши, чтобы приблизить или отдалить холст. Камера всегда фокусируется на том месте, где находится ваш курсор.
*   **Удобное выделение:** Обводите картинки рамкой, зажав левую кнопку мыши на пустом месте, чтобы выделить сразу несколько элементов.

### 2. Работа с картинками и видео
*   **Добавление файлов:** Просто перетаскивайте любые картинки и видео из папок прямо в окно программы (Drag & Drop) или вставляйте их через `Ctrl+V`.
*   **Видео с YouTube:** Скопируйте ссылку на видео и нажмите `Ctrl+V` в программе — видео появится в виде удобного плеера.
*   **Изменение размера:** Тяните за углы картинок, чтобы изменить их размер. Если выделить несколько файлов, они будут увеличиваться и уменьшаться вместе.

### 3. Оболочки (Группы)
*   **Организация:** Объединяйте референсы в специальные полупрозрачные блоки. Вы можете менять цвет этих блоков и давать им названия.
*   **Совместное перемещение:** Если переместить саму оболочку, все находящиеся внутри нее элементы переместятся вместе с ней.

### 4. Связи (Линии)
*   **Рисование связей:** Наведите курсор на края любой картинки, и появятся фиолетовые точки. Потяните за них, чтобы соединить элементы красивой линией.
*   **Умные линии:** Линии автоматически перестраиваются и не путаются, когда вы передвигаете картинки по холсту.

### 5. Полезные фишки
*   **Режим "Сквозь окно":** Нажмите `F4`, и программа станет "прозрачной" для кликов. Вы сможете кликать прямо сквозь референсы в другие программы (например, обводить картинку в Photoshop).
*   **Поверх всех окон:** Включите этот режим, и окно с референсами никогда не скроется за другими окнами.
*   **Отмена действий:** Нажмите `Ctrl+Z`, чтобы отменить любое ошибочное действие (перемещение, удаление, изменение размера и т.д.).
*   **Сохранение:** Проекты сохраняются в специальные файлы. Достаточно кликнуть по такому файлу дважды, и программа сама откроет вашу доску со всеми картинками и связями.


---

## ⌨️ Горячие клавиши

| Клавиша | Действие |
| :--- | :--- |
| **C** | Создать оболочку (Group Box) вокруг выделенных элементов |
| **L** | Режим создания связи (или вытягивайте из фиолетовых точек) |
| **F2** | Переименовать выделенную оболочку |
| **F4** | Переключить режим «Сквозь программу» (Click-Through) |
| **Del / Backspace** | Удалить выделенные элементы или связи |
| **Ctrl + Z** | Отменить действие |
| **Ctrl + Y** | Повторить действие |
| **Ctrl + C / V** | Копировать / Вставить |
| **Space + Drag** | Панорамирование холста (также на колесико мыши) |
| **Ctrl + Scroll** | Масштабирование холста (Zoom) |

---

## 🔨 Сборка из исходников

Нужны [Node.js](https://nodejs.org/) 20 или новее и Windows.

```bash
npm install
npm run build
```

Установщик появится в папке `dist/`. Запустить без сборки — `npm start`.

Опционально положите `yt-dlp.exe` в корень проекта перед сборкой. Без него
приложение работает, но видео с YouTube грузятся по резервному пути и менее
надёжно. В репозиторий файл не входит, скачать его можно на
[странице релизов yt-dlp](https://github.com/yt-dlp/yt-dlp/releases).

---

## ✍️ Подпись кода

Сборки пока **не подписаны**, поэтому при первом запуске Windows SmartScreen
покажет предупреждение о неизвестном издателе. Подпись настраивается через
[SignPath.io](https://about.signpath.io/), сертификат — от
[SignPath Foundation](https://signpath.org/). Как собираются, проверяются и
подписываются сборки — в [Code Signing Policy](CODE_SIGNING_POLICY.md).

---

## 📄 Лицензия

[GNU General Public License v3.0 или новее](LICENSE).

Программой можно свободно пользоваться, изучать и изменять её код. Но если вы
распространяете изменённую версию, её исходный код тоже обязан быть открыт под
GPL-3.0.

Сторонние компоненты: [mp4box.js](https://github.com/gpac/mp4box.js) под
BSD-3-Clause и шрифт [Inter](https://github.com/rsms/inter) под SIL OFL 1.1,
подробности в папке `vendor/`.


# 🇬🇧 English Version

# 🎨 RefSpace
> A professional infinite canvas for references, supporting images, videos, and interactive connections.

**RefSpace** is a powerful tool for artists, designers, and video editors to organize a visual workspace without limits. Unlike alternatives, RefSpace fully supports video files and YouTube players, allowing you to create live mood boards. Since this application is distributed as a ready-to-use `.exe` file, you don't need to build anything — just launch the program and start creating!
<img width="2541" height="1352" alt="scrin1" src="https://github.com/user-attachments/assets/216e5aed-0e62-4a6d-81d6-2eab85bacbb0" />
## ⚙️ How It Works (Features)

### 1. Infinite Canvas
*   **Panning:** Hold the Spacebar and left mouse button (or use the middle mouse button) to freely move around your workspace.
*   **Zooming:** Use the mouse wheel to zoom in or out. The camera always focuses on your cursor's position.
*   **Box Selection:** Draw a box by holding the left mouse button on an empty area to select multiple items at once.

### 2. Images and Videos
*   **Adding Files:** Simply drag and drop any images or videos from your folders directly into the app, or paste them using `Ctrl+V`.
*   **YouTube Videos:** Copy a YouTube video link and press `Ctrl+V` in the app — the video will appear as an interactive mini-player.
*   **Resizing:** Drag the corners of any picture to resize it. If you select multiple files, they will scale up and down together.

### 3. Group Boxes
*   **Organization:** Group references into special semi-transparent blocks. You can change their color and give them titles.
*   **Moving Together:** If you move the group box itself, all the elements inside it will move along with it.

### 4. Connections (Lines)
*   **Drawing Connections:** Hover over the edges of any picture to reveal purple dots. Drag from these dots to connect elements with a curved line.
*   **Smart Lines:** Lines automatically reroute and adjust when you move pictures around the canvas.

### 5. Useful Features
*   **Click-Through Mode:** Press `F4` to make the app "transparent" to clicks. You can click right through the references into other apps (for example, to trace a picture in Photoshop).
*   **Always on Top:** Enable this mode so the reference window never hides behind other applications.
*   **Undo Actions:** Press `Ctrl+Z` to undo any mistake (moving, deleting, resizing, etc.).
*   **Saving:** Projects are saved into special files. Just double-click the file, and the app will open your board with all images and connections.

---

## ⌨️ Hotkeys

| Key | Action |
| :--- | :--- |
| **C** | Create a Group Box around selected elements |
| **L** | Line connection mode (or drag from purple dots) |
| **F2** | Rename the selected Group Box |
| **F4** | Toggle "Click-Through" mode |
| **Del / Backspace** | Delete selected elements or connections |
| **Ctrl + Z** | Undo action |
| **Ctrl + Y** | Redo action |
| **Ctrl + C / V** | Copy / Paste |
| **Space + Drag** | Pan the canvas (also middle mouse button) |
| **Ctrl + Scroll** | Zoom the canvas |

---

## 🔨 Building from source

Requires [Node.js](https://nodejs.org/) 20 or newer, on Windows.

```bash
npm install
npm run build
```

The installer lands in `dist/`. To run without building, use `npm start`.

Optionally drop `yt-dlp.exe` into the project root before building. Without it
the app still runs, but YouTube videos load through a fallback path and less
reliably. The file is not part of the repository — grab it from the
[yt-dlp releases page](https://github.com/yt-dlp/yt-dlp/releases).

---

## ✍️ Code signing

Builds are **not signed yet**, so Windows SmartScreen warns about an unknown
publisher on first run. Code signing is being set up through
[SignPath.io](https://about.signpath.io/), with a certificate from the
[SignPath Foundation](https://signpath.org/). How builds are produced, reviewed
and signed is described in the [Code Signing Policy](CODE_SIGNING_POLICY.md).

---

## 📄 License

[GNU General Public License v3.0 or later](LICENSE).

You are free to use the program, study it and modify it. If you distribute a
modified version, its source code must be open under GPL-3.0 as well.

Third-party components: [mp4box.js](https://github.com/gpac/mp4box.js) under
BSD-3-Clause and the [Inter](https://github.com/rsms/inter) typeface under
SIL OFL 1.1 — see the `vendor/` folder.
