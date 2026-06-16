# Security

Vault Commander is local-first software. It runs entirely on your machine, reads and
writes the plain Markdown files in your own vault, and makes no network calls of its own.
This document describes exactly what that means, what we defend against, what we don't,
and how to report a problem. We'd rather you read the LICENSE and this file than take a
"trust us" claim on faith — that's the point of shipping the source.

## Security model in one paragraph

The app is a small Node/Express process that listens on `127.0.0.1:4747` (loopback only),
serves a static UI from that same origin, and exposes a REST + SSE API the UI uses to read
and edit task files. There is no account, no cloud, no telemetry, and no outbound network
traffic. Your data never leaves the machine; "your vault is the database" is literal — the
files on disk are the source of truth, and deleting the app leaves your Markdown untouched.

## Network exposure

| Property | Behavior |
|---|---|
| Bind address | `127.0.0.1` only. The server is **not** reachable from your LAN, your WiFi, or any other device. |
| Cross-origin access | No CORS allowance is emitted. Other websites you have open **cannot** read responses from the API. |
| Host-header guard | Requests whose `Host` is not loopback are rejected with `403`. This blocks DNS-rebinding attempts (a remote page that resolves its own domain to `127.0.0.1`). |
| Outbound calls | None. The process opens no sockets except the loopback listener. Works fully offline, forever. |
| Telemetry / analytics | None. No usage data is collected or transmitted. |

## How your files are handled

- Tasks and projects are plain Markdown files with YAML frontmatter, in **your** vault, in a
  format you can read and edit by hand or with any other tool (Obsidian, git, a text editor).
- "Delete" is a **soft delete**: it sets the task's status to `cancelled` and rewrites the
  frontmatter. The app does not delete files from disk.
- The app only writes inside your vault's `Projects/` tree. Filenames derived from task titles
  are sanitized (path separators and reserved characters stripped) so a title cannot write
  outside that tree.
- Rendered Markdown (task descriptions) is escaped before display, including attribute
  contexts, so content synced into your vault from elsewhere cannot inject scripts into the UI.

## Hardening log

### 2026-06-14 — Pre-launch security pass

Four issues found in internal review and fixed before any public release:

1. **Loopback bind (was: all interfaces).** The server previously bound to `0.0.0.0`, making
   the vault reachable by any device on the same network with no authentication. Now binds to
   `127.0.0.1` only.
2. **Removed wildcard CORS.** The API previously sent `Access-Control-Allow-Origin: *`, which
   allowed any website you visited to read API responses while the app was running. The header
   is gone; the UI is same-origin and never needed it.
3. **Host-header validation.** Added a loopback-only `Host` check as defense-in-depth against
   DNS rebinding.
4. **Markdown attribute-injection XSS.** The Markdown renderer escaped angle brackets but not
   quotes, allowing a crafted task body to inject an HTML attribute / event handler. Quote
   escaping was added, closing the vector.

## Threat model

**Defended against**
- Other devices on your network reaching the app (loopback bind).
- Websites in your browser reading or writing your vault via the local API (no CORS + JSON-only
  body parsing + Host guard).
- DNS-rebinding reaching the local API (Host-header validation).
- Malicious vault content executing script in the UI (output escaping in the Markdown renderer).

**Explicitly out of scope**
- **Other software or users already running on your machine.** A local process running as your
  user can reach `127.0.0.1:4747` and read your vault — but such a process can already read your
  vault files directly. The app does not, and cannot, defend the filesystem from your own account.
- **Physical access to an unlocked machine.**
- **The security of your vault's contents themselves** (e.g., secrets you store in task notes).
  Treat task files like any other file in your vault.

## Reporting a vulnerability

Please report security issues privately — do not open a public GitHub issue for a vulnerability.

- **Contact:** security@mdo.media (or hello@mdo.media)
- Include steps to reproduce and, if possible, a proof of concept.
- We aim to acknowledge within 72 hours and to ship a fix or mitigation promptly. Reporters who
  want credit will be acknowledged in the hardening log above.

## Scope

This policy covers the Vault Commander application in this repository. It does not cover
third-party dependencies (report those upstream) or your own vault contents.
