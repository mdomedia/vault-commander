# Security

Vault Commander is local-first software. It's designed to run on your own machine, read and write the plain Markdown files in your vault, and make no network calls of its own, with a single exception: if you choose to buy and activate Pro, the app contacts our payment provider once to validate your license key. The free core makes no network calls at all. This document describes what the app is designed to do, the measures we've taken, and the limits of those measures. No software is perfectly secure, so we'd rather show you the source and describe our approach honestly than ask you to take a "trust us" claim on faith.

## Security model in one paragraph

The app is a small Node/Express process that listens on `127.0.0.1:4747` (loopback) by default, serves a static UI from that same origin, and exposes a REST + SSE API the UI uses to read and edit task files. There's no account, no cloud, and no telemetry. The free core makes no outbound network calls; the only one the app ever makes is validating your Pro license with our payment provider (Polar), and only when you activate Pro. The design goal is simple: your vault stays on your machine, the files on disk are the source of truth, and removing the app leaves your Markdown untouched.

## No warranty

Vault Commander is provided "as is," without warranty of any kind (see [LICENSE.md](LICENSE.md)). The measures described here are steps we've taken to reduce risk; they are not guarantees. You're responsible for your own backups and for deciding what's appropriate to store in your vault. Please back up your vault before heavy use, as you would with any tool that writes to your files.

## Network exposure

| Property | Behavior |
|---|---|
| Bind address | Binds to `127.0.0.1` by default, so in a normal run it isn't exposed to your LAN, WiFi, or other devices. |
| Cross-origin access | No CORS allowance is emitted, so other websites you have open are not granted read access to the API's responses. |
| Host-header check | Requests whose `Host` header isn't loopback are rejected with `403`, which is intended to reduce the risk of DNS rebinding. |
| Outbound calls | The free core makes none and works fully offline. The only outbound call is one-time Pro license activation/validation with our payment provider (Polar), and only if you activate Pro. After activation it's cached locally and keeps working offline. |
| Telemetry / analytics | We don't collect or transmit usage data. |

## How your files are handled

- Tasks and projects are plain Markdown files with YAML frontmatter, in your vault, in a format you can read and edit by hand or with any other tool (Obsidian, git, a text editor).
- "Delete" is a soft delete: it sets the task's status to `cancelled` and rewrites the frontmatter rather than removing the file from disk.
- The app writes inside your vault's `Projects/` tree. Filenames derived from task titles are sanitized (path separators and reserved characters stripped) to help keep writes within that tree.
- Rendered Markdown (task descriptions) is escaped before display, including attribute contexts, which is intended to prevent content synced into your vault from injecting scripts into the UI.

## Hardening log

### 2026-06-14: Pre-launch security pass

Four issues found in internal review and addressed before release:

1. **Loopback bind (was: all interfaces).** The server previously bound to `0.0.0.0`, which could make the vault reachable by other devices on the same network. It now binds to `127.0.0.1`.
2. **Removed wildcard CORS.** The API previously sent `Access-Control-Allow-Origin: *`. That header has been removed; the UI is same-origin and didn't need it.
3. **Host-header check.** Added a loopback-only `Host` check as defense-in-depth against DNS rebinding.
4. **Markdown attribute-injection XSS.** The Markdown renderer escaped angle brackets but not quotes, which could allow a crafted task body to inject an HTML attribute or event handler. Quote escaping was added.

## What this design is intended to mitigate

These are areas we've taken steps to address. They describe intent and effort, not guarantees:

- Other devices on your network reaching the app (loopback bind).
- Websites in your browser reading or writing your vault through the local API (no CORS, JSON-only body parsing, Host check).
- DNS rebinding against the local API (Host-header check).
- Malicious vault content executing script in the UI (output escaping in the Markdown renderer).

## Out of scope

- **Other software or users already running on your machine.** A local process running as your user could reach `127.0.0.1:4747`, but such a process can typically read your vault files directly already. The app doesn't attempt to protect the filesystem from your own account.
- **Physical access to an unlocked machine.**
- **The contents of your vault themselves** (for example, secrets you choose to store in task notes). Treat task files like any other file in your vault.

## Reporting a vulnerability

Please report security issues privately. Don't open a public GitHub issue for a vulnerability.

- **Contact:** security@mdo.studio
- Include steps to reproduce and, if possible, a proof of concept.
- We aim to acknowledge within 72 hours and to work toward a fix or mitigation. Reporters who'd like credit can be acknowledged in the hardening log above.

## Scope

This policy covers the Vault Commander application in this repository. It doesn't cover third-party dependencies (report those upstream) or the contents of your own vault.
