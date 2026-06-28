# Releasing Vault Commander

Vault Commander ships two ways:

1. **`npx vault-commander`** for people who have Node.js (publish to npm the
   normal way: `npm publish`).
2. **Desktop apps** for everyone else (macOS, Windows, Linux), built with
   **Electron** from `desktop/` and hosted on **GitHub Releases**. The marketing
   site's "Download" buttons point at
   `https://github.com/mdomedia/vault-commander/releases/latest`, so once a
   release exists those buttons just work.

The desktop app runs the same `server.js` inside an Electron window (Electron
ships its own Node), so the end user installs nothing. See `desktop/README.md`
for how it's wired.

## Cut a release

```bash
# bump version in package.json (and desktop/package.json) if needed
git tag v0.9.2
git push origin v0.9.2
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on each
native runner and attaches the installers to the Release:

- macOS: `Vault Commander-<ver>.dmg` (+ `.zip`) — **code-signed and notarized**
  when the Apple secrets are set
- Windows: `Vault Commander Setup <ver>.exe`
- Linux: `Vault Commander-<ver>.AppImage` (+ `.deb`)

### Required GitHub repo secrets (for signed macOS builds)

| Secret | What it is |
|---|---|
| `MAC_CSC_LINK` | base64 of your Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | password for that `.p12` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

Without those, the macOS build still succeeds but is **unsigned** (Gatekeeper
warns on first open).

## Test / build locally

```bash
cd desktop
npm install
npm start            # run the app in dev (no packaging, no signing)
npm run dist:mac     # build a dmg for your Mac (signed if the env vars are set)
```

Full signing/notarization details and the local env vars are in
`desktop/README.md`.

## Notes

- The desktop matrix currently builds the host architecture per runner (Apple
  Silicon dmg on the macOS runner). Add an Intel (`--x64`) mac build later if you
  need to cover older Macs.
- Windows installers are unsigned until a Windows code-signing cert is added.
