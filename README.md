# Vault Commander

A fast, local-first project board for your Obsidian vault. Plain Markdown goes in; a Jira-grade kanban, table, timeline, and focus board comes out. Nothing ever leaves your machine.

> **Status: public beta (v0.x).** It's stable enough to run on a real vault. As with any tool that writes to your files, back up your vault before heavy use.

## Why I built it

I've been a passionate Obsidian user for five years, but I live in Jira at work. Every time I opened my vault I wished my own projects felt as fast and as good to work in as the board I stare at all day. Obsidian's Project Manager plugin gave me real projects and tasks inside my notes; I wanted to give those tasks the interface they deserved. So I built it, directly on top of the Markdown files I already had.

## Quick start

Requires Node 18 or newer.

```bash
# from inside your vault folder:
npx vault-commander

# or point it anywhere:
npx vault-commander --vault "/path/to/your/vault"
```

Vault Commander indexes your tasks and opens http://localhost:4747. No install, no account, no sign-up. Run it from inside your vault and you can skip the flag.

## How it works

It reads and writes plain Markdown files with YAML frontmatter in your vault's `Projects/` folder:

```
your-vault/
└── Projects/
    ├── My Project.md            (project: pm-project frontmatter)
    └── My Project_tasks/        (one .md per task: pm-task frontmatter)
```

It serves a local web UI over localhost, watches the files, and syncs both ways. Edit in Vault Commander and Obsidian picks it up instantly; edit in Obsidian and the board updates live. **The files are the database.** Delete Vault Commander and your Markdown is exactly where it was.

## Works with the Project Manager plugin

Vault Commander reads and writes the same `pm-task` format as Obsidian's [Project Manager plugin](https://github.com/StepanKropachev/obsidian-pm). Already use it? Point Vault Commander at your vault and your boards are simply there, with nothing to migrate. Never used it? Vault Commander works standalone with sensible defaults, so the plugin is optional.

*Compatible with, but independent from, the Project Manager plugin. Not affiliated with or endorsed by its author. We use none of its code; we read and write the same file format. Thanks to [StepanKropachev](https://github.com/StepanKropachev/obsidian-pm) for making real project management in Obsidian possible.*

## Free and Pro

The free core is the full board, and it stays free forever:

- Kanban (drag and drop), Table (inline edit), and Focus (today / overdue / blocked)
- Task detail panel, full create and edit, complete CRUD
- Real-time two-way vault sync
- Basic dashboard counts
- Sandstone theme (light and dark), single vault

Pro adds three things on top of the full board: **insight** (Timeline / Gantt and the full analytics dashboard with velocity, streaks, heatmap, and project health), **delight** (Commander Mode and the theme pack), and **leverage** (Agent Mode, recurring tasks, weekly review). One lifetime license is **$49** today, rising to $79 on Sept 1, 2026 and $99 on Jan 1, 2027, or $4/mo / $29/yr. No subscription required, no servers, local software priced like local software.

> During the beta, payments aren't live yet. Pro features appear in the app as locked previews so you can see exactly what's coming, and nothing you have in Free is ever taken away.

## Local-first and private

- **100% local.** Binds to `127.0.0.1` only, so it's never reachable from your network. No account, no cloud, no telemetry. Works offline, forever.
- Your data is your Markdown, never a proprietary format.
- Security model and disclosure: see [SECURITY.md](SECURITY.md).

## Product updates

Want to hear when Pro, Agent Mode, and new features ship? Sign up at **[vaultcommander.app](https://vaultcommander.app/#waitlist)**. One short email per release, no drip, unsubscribe in a click. The app itself never collects anything; this is a plain website signup, and it's entirely optional.

## Feature requests and feedback

Vault Commander is built in the open and shaped by how people actually use it. I'd genuinely love your input:

- **Want a feature?** [Open an issue](https://github.com/mdomedia/vault-commander/issues) and tell me the workflow you're trying to reach. Real use cases are what move the roadmap.
- **Found a bug?** Open an issue with steps to reproduce.
- **Security issue?** Please don't file a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## License

Source-available under the **Functional Source License (FSL-1.1-ALv2)**. See [LICENSE.md](LICENSE.md). You can read, run, fork, and modify the code for any non-competing purpose, and each release automatically becomes Apache 2.0 two years after its publication.

This is **source-available, not "open source,"** and I'd rather say that plainly than overclaim. Read every line that touches your vault. Just don't ship a competing product with it until it converts to Apache 2.0.
