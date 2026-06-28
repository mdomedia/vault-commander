// Copies the app's server + frontend from the repo root into this desktop/
// folder so electron-builder can bundle them. These copies are gitignored;
// the single source of truth stays at the repo root.

const fs = require('fs');
const path = require('path');

const desktopDir = path.join(__dirname, '..');
const repoRoot = path.join(desktopDir, '..');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// server.js
fs.copyFileSync(path.join(repoRoot, 'server.js'), path.join(desktopDir, 'server.js'));

// public/
const dstPublic = path.join(desktopDir, 'public');
fs.rmSync(dstPublic, { recursive: true, force: true });
copyDir(path.join(repoRoot, 'public'), dstPublic);

console.log('copy-app: copied server.js and public/ from the repo root.');
