// renderer.js
// Remove this line:
// const { ipcRenderer } = require('electron');

document.getElementById('start').addEventListener('click', () => {
  window.api.start(); // This already uses window.api, which is good
});

document.addEventListener('DOMContentLoaded', () => {
    // Get references to your buttons
    const minBtn = document.getElementById('minBtn');
    const maxBtn = document.getElementById('maxBtn');
    const closeBtn = document.getElementById('closeBtn');

    // Add event listeners
    if (minBtn) {
        minBtn.addEventListener('click', () => {
            // CHANGE: Use window.api.send instead of ipcRenderer.send
            window.api.send('minimize-window');
        });
    }

    if (maxBtn) {
        maxBtn.addEventListener('click', () => {
            // CHANGE: Use window.api.send instead of ipcRenderer.send
            window.api.send('maximize-restore-window');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            // CHANGE: Use window.api.send instead of ipcRenderer.send
            window.api.send('close-window');
        });
    }
});