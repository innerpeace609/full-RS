// main.js

// --- REQUIRED MODULES ---
// Native Electron modules
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Third-party modules for paywall
const axios = require('axios'); // For making HTTP requests to your backend
const Store = require('electron-store'); // For storing the license key securely

// --- INITIALIZATION ---
// Initialize the persistent store
const store = new Store();

// !!! IMPORTANT !!!
// Replace this with your DEPLOYED backend server URL from Render, Heroku, etc.
const BACKEND_URL = 'https://rp-recorder-server.onrender.com';

// --- FFMPEG PATH LOGIC ---
// This block dynamically finds the path to the ffmpeg executable.
let ffmpegPath;
if (app.isPackaged) {
  // In a packaged app, the executable is in the resources directory.
  // We configured electron-builder in package.json to copy it there.
  ffmpegPath = path.join(process.resourcesPath, 'ffmpeg.exe');
} else {
  // In development, we use the path from the ffmpeg-static package.
  ffmpegPath = require('ffmpeg-static');
}

// --- GLOBAL VARIABLES ---
app.disableHardwareAcceleration();
let mainWin; // The main application window
let overlays = new Map(); // Stores the screen capture overlay windows
let ffmpegProc = null; // The running ffmpeg process

// ===================================================================
// == CORE APPLICATION AND OVERLAY WINDOW FUNCTIONS
// ===================================================================

/**
 * Creates the main application window (the recorder controls).
 * This is only called AFTER a successful license validation.
 */
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 400,
    height: 200,
    resizable: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWin.loadFile('index.html');
}

/**
 * Creates the paywall window shown to users without a valid license.
 */
function createPaywallWindow() {
    const paywallWin = new BrowserWindow({
        width: 500,
        height: 400,
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });
    paywallWin.loadFile('paywall.html');
}

/**
 * Shows the transparent overlay windows on all screens for selection.
 */
function showOverlays() {
  screen.getAllDisplays().forEach(display => {
    const w = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true
      }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile('overlay.html');
    w.setIgnoreMouseEvents(false);
    overlays.set(w.id, { window: w, display: display });
  });
}

/**
 * Hides and destroys all overlay windows.
 */
function hideOverlays() {
  overlays.forEach(o => o.window.close());
  overlays.clear();
}


// ===================================================================
// == APP STARTUP AND LICENSE VALIDATION
// ===================================================================

/**
 * This is the main entry point when the app starts.
 * It checks for a stored license key and validates it with the backend.
 */
async function validateAndStart() {
    const licenseKey = store.get('licenseKey');

    // If no key is stored, show the paywall immediately.
    if (!licenseKey) {
        createPaywallWindow();
        return;
    }

    // If a key exists, try to validate it.
    try {
        const response = await axios.post(`${BACKEND_URL}/validate-license`, { licenseKey });
        if (response.data.status === 'active') {
            // Success! Start the main application.
            createMainWindow();
        } else {
            // The key is invalid (e.g., subscription expired). Show the paywall.
            store.delete('licenseKey'); // Clear the invalid key
            createPaywallWindow();
        }
    } catch (error) {
        console.error('Could not connect to validation server.', error.message);
        // If the server is down, we can't validate, so we must show the paywall.
        createPaywallWindow();
    }
}

// Replace the original app startup call with our new validation function.
app.whenReady().then(validateAndStart);


// ===================================================================
// == IPC HANDLERS (Inter-Process Communication)
// ===================================================================

// --- Paywall IPC Handlers ---

// Called when the user clicks "Purchase" in the paywall window.
ipcMain.on('purchase-subscription', async () => {
    try {
        // Request a new Stripe checkout session from the backend.
        const response = await axios.post(`${BACKEND_URL}/create-checkout-session`);
        // Open the returned URL in the user's default browser.
        shell.openExternal(response.data.url);
    } catch (e) {
        console.error('Could not create Stripe checkout session:', e.message);
    }
});

// Called when the user clicks "Activate" in the paywall window.
ipcMain.handle('validate-license', async (event, licenseKey) => {
    try {
        const response = await axios.post(`${BACKEND_URL}/validate-license`, { licenseKey });
        if (response.data.status === 'active') {
            store.set('licenseKey', licenseKey); // Save the valid key
            app.relaunch(); // Relaunch the app to re-run validation and open the main window
            app.exit();
        }
        return response.data; // Return the result to the paywall window
    } catch (e) {
        console.error('License validation request failed:', e.message);
        return { status: 'inactive', message: 'Could not connect to the server.' };
    }
});


// --- Main Application IPC Handlers ---

// These handlers are for the main recorder window and will only work
// if the user has a valid license.

ipcMain.on('minimize-window', () => mainWin?.minimize());
ipcMain.on('maximize-restore-window', () => {
    if (mainWin?.isMaximized()) {
        mainWin.unmaximize();
    } else {
        mainWin?.maximize();
    }
});
ipcMain.on('close-window', () => mainWin?.close());

ipcMain.handle('start-capture', () => {
  if (overlays.size === 0) {
    mainWin?.hide();
    showOverlays();
  }
});

ipcMain.handle('stop-capture', () => {
  if (!ffmpegProc) return;
  ffmpegProc.stdin.write('q');
  ffmpegProc.stdin.end();
});

ipcMain.on('selection-made', (event, rect) => {
  if (ffmpegProc) return;

  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow) {
      console.error("Could not find the source window.");
      return;
  }
  
  const overlayInfo = overlays.get(sourceWindow.id);
  if (!overlayInfo) {
      console.error("Could not find overlay info for the source window.");
      return;
  }

  const { display } = overlayInfo;
  const { scaleFactor } = display;
  const displayBounds = display.bounds;

  const displays = screen.getAllDisplays();
  const virtualBounds = {
    x: Math.min(...displays.map(d => d.bounds.x)),
    y: Math.min(...displays.map(d => d.bounds.y)),
    width: 0,
    height: 0,
  };
  virtualBounds.width = Math.max(...displays.map(d => d.bounds.x + d.bounds.width)) - virtualBounds.x;
  virtualBounds.height = Math.max(...displays.map(d => d.bounds.y + d.bounds.height)) - virtualBounds.y;

  const selectionAbsoluteX = displayBounds.x + Math.round(rect.x * scaleFactor);
  const selectionAbsoluteY = displayBounds.y + Math.round(rect.y * scaleFactor);

  const cropX = selectionAbsoluteX - virtualBounds.x;
  const cropY = selectionAbsoluteY - virtualBounds.y;

  let cropWidth = Math.round(rect.width * scaleFactor);
  let cropHeight = Math.round(rect.height * scaleFactor);
  cropWidth = cropWidth % 2 === 0 ? cropWidth : cropWidth + 1;
  cropHeight = cropHeight % 2 === 0 ? cropHeight : cropHeight + 1;

  const filterComplex =
    `[0:v]crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},` +
    `crop=iw-4:ih-4:2:2,setpts=PTS-STARTPTS[v_out];` +
    `[1:a]aresample=async=1,asetpts=PTS-STARTPTS[a_out]`;

  const outputPath = path.join(app.getPath('videos'), `capture-${Date.now()}.mov`);

  const args = [
    '-y', '-f', 'gdigrab', '-framerate', '60',
    '-offset_x', `${virtualBounds.x}`,
    '-offset_y', `${virtualBounds.y}`,
    '-video_size', `${virtualBounds.width}x${virtualBounds.height}`,
    '-i', 'desktop',
    '-f', 'dshow', '-i', 'audio=virtual-audio-capturer',
    '-filter_complex', filterComplex,
    '-map', '[v_out]', '-map', '[a_out]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', outputPath
  ];

  ffmpegProc = spawn(ffmpegPath, args, { stdio: 'pipe' });

  ffmpegProc.stderr.on('data', (data) => console.error(`ffmpeg stderr: ${data}`));

  ffmpegProc.once('close', (code) => {
    ffmpegProc = null;
    hideOverlays();
    mainWin?.show();
    console.log(`ffmpeg process exited with code ${code}`);
    console.log('Saved recording to:', outputPath);
  });
});


// ===================================================================
// == APP LIFECYCLE HOOKS
// ===================================================================

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
