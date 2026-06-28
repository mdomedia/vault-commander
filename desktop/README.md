# Vault Commander — Desktop (Electron)

A real desktop window around the Vault Commander local server. Electron's main
process runs `server.js` in-process (Electron ships its own Node), so the user
needs nothing installed. On first launch it asks for the Obsidian vault folder,
remembers it, starts the server on `127.0.0.1:4747`, and shows the app in a
native window. Closing the window quits the app and stops the server.

This is **distribution only** — it reuses `../server.js` and `../public`
unchanged (a build step copies them in; the single source of truth stays at the
repo root).

## Run it now (testing, no signing)

```bash
cd desktop
npm install        # downloads Electron (~real network needed)
npm start          # opens the app window
```

`npm start` runs `copy-app` (pulls in `server.js` + `public/`) then launches
Electron. Pick your Obsidian vault when prompted.

## Build an installer for your machine

```bash
npm run dist:mac     # -> dist/Vault Commander-<ver>.dmg (+ .zip)
npm run dist:win     # -> dist/Vault Commander Setup <ver>.exe
npm run dist:linux   # -> dist/Vault Commander-<ver>.AppImage (+ .deb)
```

Without signing config these build **unsigned** apps (fine for local testing;
macOS will warn on first open — right-click → Open).

## Code signing + notarization (your Apple Developer account)

electron-builder signs and notarizes automatically when these are present. Set
them as environment variables locally, or as GitHub Actions secrets for CI.

| Variable | What it is |
|---|---|
| `CSC_LINK` | base64 of your **Developer ID Application** `.p12` (cert + private key) |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | your 10-char Team ID |

To get the cert: Apple Developer portal → Certificates → **Developer ID
Application** → create (from a CSR made in Keychain Access) → download → in
Keychain, export it **with its private key** as a `.p12`. Then:

```bash
base64 -i DeveloperID.p12 | pbcopy   # this is CSC_LINK
```

Build a signed + notarized dmg locally:

```bash
export CSC_LINK="...base64..." CSC_KEY_PASSWORD="..." \
       APPLE_ID="you@example.com" APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
       APPLE_TEAM_ID="ABCDE12345"
npm run dist:mac
```

`mac.notarize: true` and `hardenedRuntime: true` are already set in
`package.json`, with the required entitlements in `build/entitlements.mac.plist`.

CI does the same on a tag push — see `.github/workflows/release.yml` at the repo
root.

## Notes

- App id: `studio.mdo.vaultcommander`. Icon: `build/icon.png`.
- Windows installers are unsigned until you add a Windows code-signing cert
  (`CSC_LINK`/`CSC_KEY_PASSWORD` are reused by electron-builder on Windows too).
- `asar` is disabled so the embedded `server.js` and its `node_modules` resolve
  as plain files.
