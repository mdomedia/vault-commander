// Vault Commander — Electron desktop shell.
//
// Vault Commander is a local Node/Express server. Electron's main process IS
// Node, so we start that server in-process and point a window at it. No second
// Node install, no sidecar. The server keeps writing plain Markdown to the
// user's Obsidian vault exactly as it does under `npx vault-commander`.

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 4747;
const APP_URL = `http://${HOST}:${PORT}`;

// Only one instance — otherwise a second copy would fight for port 4747.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(main);
}

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}
function loadVault() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')).vault || null; }
  catch (_) { return null; }
}
function saveVault(vault) {
  try { fs.writeFileSync(configFile(), JSON.stringify({ vault }, null, 2)); }
  catch (_) {}
}

async function pickVault() {
  const res = await dialog.showOpenDialog({
    title: 'Choose your Obsidian vault',
    message: 'Pick the folder of the Obsidian vault Vault Commander should manage.',
    buttonLabel: 'Use this vault',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  return res.filePaths[0];
}

let serverStarted = false;
function startServer(vaultPath) {
  if (serverStarted) return;
  serverStarted = true;
  process.env.VC_NO_OPEN = '1'; // don't let the server open a second browser
  // server.js reads process.argv for --vault, so set it before requiring.
  process.argv = [process.execPath, path.join(__dirname, 'server.js'), '--vault', vaultPath];
  require(path.join(__dirname, 'server.js'));
}

function waitForServer(done, tries = 0) {
  const req = http.get(APP_URL, () => { req.destroy(); done(); });
  req.on('error', () => {
    if (tries > 100) return done(new Error('Server did not come up on port 4747.'));
    setTimeout(() => waitForServer(done, tries + 1), 150);
  });
}

// The app already wears its own name and mark in the header, so a native title
// bar saying "Vault Commander" directly above a logo saying "Vault Commander"
// is pure redundancy. `hiddenInset` drops the OS title bar and floats the
// traffic lights into our header instead, the way Mail, Teams and ChatGPT do.
// The trade: an unframed window is no longer draggable, so the header has to
// opt back in via `-webkit-app-region` below.
const HEADER_H = 52;   // .header height in public/style.css
const LIGHTS_W = 52;   // width of the three traffic lights
const LIGHTS_X = 20;   // their inset from the left edge

// Desktop-only chrome. This lives here rather than in public/style.css on
// purpose: that stylesheet is shared with `npx vault-commander` in a normal
// browser tab, where there are no traffic lights to make room for.
// `!important` is load-bearing, not laziness: insertCSS lands in a lower
// cascade origin than the page's own stylesheet, so a plain `padding-left`
// here silently loses to `.header { padding: 0 20px }` and the logo ends up
// underneath the traffic lights.
const DESKTOP_CSS = `
  .header {
    padding-left: ${LIGHTS_X + LIGHTS_W + 20}px !important;
    -webkit-app-region: drag;
  }
  .header button,
  .header a,
  .header input,
  .header select,
  .header [role="tab"],
  .header [role="switch"] {
    -webkit-app-region: no-drag;
  }
`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#EAE3D5',
    title: 'Vault Commander',
    show: false,
    titleBarStyle: 'hiddenInset',
    // Centre the lights in our header rather than the vanished title bar.
    trafficLightPosition: { x: LIGHTS_X, y: Math.round((HEADER_H - 16) / 2) },
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => win.show());
  // Insert before paint so the header never flashes at the wrong offset.
  win.webContents.on('did-finish-load', () => win.webContents.insertCSS(DESKTOP_CSS));
  win.loadURL(APP_URL);
  // Open real external links (mdo.studio, GitHub, etc.) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

async function main() {
  let vault = loadVault();
  if (!vault || !fs.existsSync(vault)) {
    vault = await pickVault();
    if (!vault) { app.quit(); return; }
    saveVault(vault);
  }

  try {
    startServer(vault);
  } catch (err) {
    dialog.showErrorBox('Vault Commander', 'Could not start the local server.\n\n' + (err && err.message || err));
    app.quit();
    return;
  }

  waitForServer((err) => {
    if (err) {
      dialog.showErrorBox(
        'Vault Commander',
        'The local server did not start on port 4747. It may already be running in another window or app.'
      );
    }
    createWindow();
  });
}

// A local web app: closing the window means you're done, so quit (and stop the
// server) on every platform rather than lingering in the macOS dock.
app.on('window-all-closed', () => app.quit());
