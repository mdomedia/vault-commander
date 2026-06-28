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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#EAE3D5',
    title: 'Vault Commander',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => win.show());
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
