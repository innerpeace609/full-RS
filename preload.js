// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- Existing Methods ---
  start: () => ipcRenderer.invoke('start-capture'),
  selectDone: rect => ipcRenderer.send('selection-made', rect),
  stop: () => ipcRenderer.invoke('stop-capture'),
  onHideShade: callback => {
    ipcRenderer.on('hide-shade', (_event) => callback());
  },

  // --- Methods for Window Controls and Paywall ---

  // Use for one-way messages (fire and forget)
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },

  // Use for two-way messages (send a message and get a response back)
  // This is what we need for license validation.
  invoke: (channel, data) => {
    return ipcRenderer.invoke(channel, data);
  }
});
