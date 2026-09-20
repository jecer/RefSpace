const { ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

// contextIsolation is off (see main.js webPreferences), so preload shares the
// page's window object directly — contextBridge.exposeInMainWorld would throw
// ("contextBridge API can only be used when contextIsolation is enabled").
// A plain assignment is the correct substitute for this configuration; revisit
// this when a later task turns contextIsolation on.
window.refspace = {
  project: {
    save: (data, existingPath, dialogTitle) =>
      invoke('project:save', data, existingPath, dialogTitle),
    open: (dialogTitle) => invoke('project:open', dialogTitle),
    openPath: (filePath) => invoke('project:open-path', filePath),
    startupFile: () => invoke('project:startup-file'),
    fileExists: (filePath) => invoke('project:file-exists', filePath),
  },
  window: {
    minimize: () => send('window:minimize'),
    maximize: () => send('window:maximize'),
    close: () => send('window:close'),
    setOpacity: (value) => send('window:set-opacity', value),
    setAlwaysOnTop: (flag) => send('window:set-always-on-top', flag),
    setClickThrough: (flag) => send('window:set-click-through', flag),
    setClickThroughHotkey: (key) => send('window:set-hotkey', key),
    onClickThroughChanged: (cb) =>
      ipcRenderer.on('window:click-through-changed', (_e, value) => cb(value)),
    onOpenProjectFile: (cb) =>
      ipcRenderer.on('project:open-file', (_e, filePath) => cb(filePath)),
  },
  clipboard: {
    readText: () => invoke('clipboard:read-text'),
    readImage: () => invoke('clipboard:read-image'),
    writeImage: (dataUrl) => invoke('clipboard:write-image', dataUrl),
    writeItems: (payload) => invoke('clipboard:write-items', payload),
  },
  media: {
    pathForDroppedFile: (file) => webUtils.getPathForFile(file),
    resolveYouTube: (videoId) => invoke('media:resolve-youtube', videoId),
  },
  log: (message) => send('log', message),
};
