# Vault Commander

**A Jira-grade, local-first project board for your Obsidian vault.** Plain Markdown in, a fast kanban/table/timeline/focus board out — and nothing ever leaves your machine.

> **Status: public beta (v0.x).** It's stable enough to run on a real vault, but back up your vault before heavy use, like you would with any tool that writes to your files.

## Why

I run my life in Obsidian, and the Project Manager plugin finally gave me real projects and tasks inside my vault. But I live in Jira all day — and I kept wishing my Obsidian board felt as fast and as good. So I built the board I wanted: Jira-grade, local-first, on top of the files I already had.

## Quick start

Requires Node 18+.

```bash
# from inside your vault folder:
npx vault-commander

# …or point it anywhere:
npx vault-commander --vault "/path/to/your/vault"
```

Vault Commander indexes your tasks and opens `http://localhost:4747`. No install, no account, no sign-up. Run it from inside your vault folder and no flag is needed.

## How it works

Vault Commander reads and writes plain Markdown files with YAML frontmatter in your vault's `Projects/` folder:

```
your-vault/
└── Projects/
    ├── My Project.md            ← project (pm-project frontmatter)
    └── My Project_tasks/        ← one .md per task (pm-task frontmatter)
```

It serves a local web UI over `localhost`, watches the files, and syncs both ways: edit in Vault Commander and Obsidian picks it up instantly; edit in Obsidian and the board updates live. **The files are the database** — delete Vault Commander and your Markdown is exactly where it was.

## Works with the Project Manager plugin

Vault Commander reads and writes the same `pm-task` format as Obsidian's [Project Manager plugin](https://github.com/StepanKropachev/obsidian-pm). Already use it? Point Vault Commander at your vault and your boards are just *there* — nothing to migrate. Never used it? Vault Commander works standalone with sensible defaults; the plugin is optional.

*Compatible with, but independent from, the Project Manager plugin — not affiliated with or endorsed by its author. Thanks to [StepanKropachev](https://github.com/StepanKropachev/obsidian-pm) for making real project management in Obsidian possible.*

## Free and Pro

The free core is the full board experience and stays free, forever:

- Kanban (drag-and-drop), Table (inline edit), and Focus (today / overdue / blocked) views
- Task detail panel, create/edit, full CRUD
- Real-time two-way vault sync
- Basic dashboard counts
- Sandstone theme (light + dark), single vault

**Pro** adds insight, delight, and leverage: Timeline/Gantt, the full analytics dashboard (velocity, streaks, heatmap, project health), Commander Mode, the theme pack, and agent features. One **lifetime** license is **$49** today (rising to $79 on Sept 1, 2026 and $99 on Jan 1, 2027), or $4/mo / $29/yr. No subscription required, no servers, local software priced like local software.

## Local-first & security

- **100% local.** Binds to `127.0.0.1` only — not reachable from your network. No account, no cloud, no telemetry, works offline forever.
- Your data is your Markdown — never in a proprietary format.
- Security model and disclosure: see [SECURITY.md](SECURITY.md).

## License

Source-available under the **Functional Source License (FSL-1.1-ALv2)** — see [LICENSE.md](LICENSE.md). You can read, run, fork, and modify the code for any non-competing purpose, and each release **automatically becomes Apache 2.0 two years after its publication.**

This is **source-available, not "open source"** — that distinction is intentional and we'd rather state it plainly than overclaim. Read every line that touches your vault; just don't ship a competing product with it (until it converts to Apache 2.0).

## Issues

Found a bug or have a request? Open a GitHub issue. For security reports, follow [SECURITY.md](SECURITY.md) instead of filing a public issue.
