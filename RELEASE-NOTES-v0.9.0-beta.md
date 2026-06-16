# Vault Commander v0.9.0-beta

**A Jira-grade, local-first project board for your Obsidian vault.** Plain Markdown in, a fast kanban / table / timeline / focus board out, and nothing ever leaves your machine.

> **Public beta (v0.x).** Stable enough to run on a real vault. As with any tool that writes to your files, **back up your vault before heavy use.**

## Install

Requires Node 18+.

```bash
# from inside your vault folder:
npx vault-commander

# or point it anywhere:
npx vault-commander --vault "/path/to/your/vault"
```

Vault Commander indexes your tasks and opens `http://localhost:4747`. No install, no account, no sign-up.

## What's in this release (the free core)

- **Kanban:** drag-and-drop, per-column sort
- **Table:** inline editing
- **Focus:** today / overdue / blocked triage
- **Basic dashboard:** active / due-today / overdue / done-this-week counts
- **Task detail panel:** full create / edit / CRUD
- **Real-time two-way sync:** edit in the app, Obsidian picks it up instantly; edit in Obsidian, the board updates live (SSE + file watcher)
- **Sandstone theme** (light and dark), single vault

The full board experience. Not a trial, not a teaser.

## Security and privacy

This is the part we'd rather you verify than trust (full detail in [SECURITY.md](SECURITY.md)):

- **Binds to `127.0.0.1` by default,** so in a normal run it isn't exposed to your LAN, WiFi, or other devices.
- **No CORS allowance,** so other websites you have open are not granted read access to the local API's responses.
- **Host-header check** rejects non-loopback requests, intended to reduce the risk of DNS rebinding.
- **No account, no cloud, no telemetry;** the app makes no outbound network calls and is designed to work offline.
- **Your data is your Markdown.** "Delete" is a soft delete (sets status to `cancelled`); the app doesn't delete files from disk. Writes are atomic (temp-file + rename), which is intended to prevent a crash from leaving a half-written task.

No software is perfectly secure; these describe the measures we've taken, not guarantees. See [SECURITY.md](SECURITY.md).

## Compatibility

Reads and writes the same `pm-task` Markdown format as Obsidian's [Project Manager plugin](https://github.com/StepanKropachev/obsidian-pm): point Vault Commander at your vault and your boards are just *there*, nothing to migrate. Never used the plugin? Vault Commander runs standalone with sensible defaults. Compatible with, but independent from, the Project Manager plugin; not affiliated with or endorsed by its author. Hat tip to [StepanKropachev](https://github.com/StepanKropachev/obsidian-pm).

## License

**Open source under the GNU AGPL v3** (see [LICENSE.md](LICENSE.md)). Use, study, modify, and share it freely; if you distribute it or run a modified version as a network service, the AGPL asks you to make your source available under the same terms. Dual-licensed: a commercial license is available for closed-source or proprietary use (see [COMMERCIAL.md](COMMERCIAL.md)).

## Known limitations (it's a beta)

- Single vault per instance.
- Timeline/Gantt, the full analytics dashboard, Commander Mode, and themes beyond Sandstone are **Pro**; in this beta they appear as locked previews, since payments aren't live yet.
- No automated test suite yet, so back up your vault.
- The Markdown renderer is hand-rolled with output escaping (no external sanitizer dependency).

## Reporting

Bugs and requests: open a GitHub issue. **Security issues: don't file a public issue.** Follow [SECURITY.md](SECURITY.md) instead.
