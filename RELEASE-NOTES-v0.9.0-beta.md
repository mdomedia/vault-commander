# Vault Commander v0.9.0-beta

**A Jira-grade, local-first project board for your Obsidian vault.** Plain Markdown in, a fast kanban / table / timeline / focus board out — and nothing ever leaves your machine.

> **Public beta (v0.x).** Stable enough to run on a real vault. As with any tool that writes to your files, **back up your vault before heavy use.**

## Install

Requires Node 18+.

```bash
# from inside your vault folder:
npx vault-commander

# …or point it anywhere:
npx vault-commander --vault "/path/to/your/vault"
```

Vault Commander indexes your tasks and opens `http://localhost:4747`. No install, no account, no sign-up.

## What's in this release (the free core)

- **Kanban** — drag-and-drop, per-column sort
- **Table** — inline editing
- **Focus** — today / overdue / blocked triage
- **Basic dashboard** — active / due-today / overdue / done-this-week counts
- **Task detail panel** — full create / edit / CRUD
- **Real-time two-way sync** — edit in the app, Obsidian picks it up instantly; edit in Obsidian, the board updates live (SSE + file watcher)
- **Sandstone theme** (light + dark), single vault

The full board experience — not a trial, not a teaser.

## Security & privacy

This is the part we'd rather you verify than trust:

- **Binds to `127.0.0.1` only.** Not reachable from your LAN, your WiFi, or any other device.
- **No CORS allowance** — other websites you have open cannot read the local API's responses.
- **Host-header guard** rejects non-loopback requests (defense-in-depth against DNS rebinding).
- **No account, no cloud, no telemetry, no outbound network calls.** Works fully offline, forever.
- **Your data is your Markdown.** "Delete" is a soft delete (sets status to `cancelled`); the app never deletes files from disk. Writes are atomic (temp-file + rename) so a crash can't leave a half-written task.

Full threat model and disclosure policy: [SECURITY.md](SECURITY.md).

## Compatibility

Reads and writes the same `pm-task` Markdown format as Obsidian's [Project Manager plugin](https://github.com/StepanKropachev/obsidian-pm) — point Vault Commander at your vault and your boards are just *there*, nothing to migrate. Never used the plugin? Vault Commander runs standalone with sensible defaults. Compatible with, but independent from, the Project Manager plugin — not affiliated with or endorsed by its author. Hat tip to [StepanKropachev](https://github.com/StepanKropachev/obsidian-pm).

## License

Source-available under the **Functional Source License (FSL-1.1-ALv2)**. Read, run, fork, and modify for any non-competing purpose; **each release automatically becomes Apache 2.0 two years after publication.** This is source-available, not "open source" — stated plainly on purpose. See [LICENSE.md](LICENSE.md).

## Known limitations (it's a beta)

- Single vault per instance.
- Timeline/Gantt, full analytics, Commander Mode, and themes beyond Sandstone are **Pro** and not in this build.
- No automated test suite yet — back up your vault.
- Markdown renderer is a hand-rolled, output-escaping renderer (no external sanitizer dependency).

## Reporting

Bugs and requests: open a GitHub issue. **Security issues: do not file a public issue** — follow [SECURITY.md](SECURITY.md).
