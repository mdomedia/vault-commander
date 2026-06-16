# Vault Commander — Architecture

Local-first project management UI for Obsidian vaults using the pm-task YAML schema.

## Tech Stack

- **Server:** Node.js + Express (minimal deps)
- **Frontend:** Vanilla JS + CSS (no React build step — just serve static files)
- **Data layer:** Direct fs read/write of markdown files with YAML frontmatter
- **File watching:** chokidar for live vault sync
- **YAML:** js-yaml for parsing/serializing frontmatter
- **Drag-and-drop:** native HTML5 DnD API (no library needed)

## Why vanilla JS, no React?

- Zero build step — `node server.js` and go
- The UI is one page with 4 views; React is overkill
- Hot module reload not needed when the server does file watching
- Keeps the project tiny and dependency-light

## Directory Structure

```
Vault Commander/
├── server.js              # Express server + REST API + file watcher
├── package.json
├── public/                # Static frontend served by Express
│   ├── index.html         # Single page app shell
│   ├── app.js             # Main app logic, state management, views
│   ├── style.css          # All styles
│   ├── views/
│   │   ├── kanban.js      # Kanban board renderer + DnD
│   │   ├── table.js       # Sortable table view
│   │   ├── timeline.js    # Gantt/timeline view
│   │   └── focus.js       # Focus/triage view
│   └── components/
│       ├── card.js         # Task card component
│       ├── detail-panel.js # Slide-out task detail editor
│       └── filters.js      # Project/status filter bar
└── README.md
```

## Data Flow

```
Obsidian vault (*.md files)
    ↕ fs read/write
Node server (Express)
    ↕ REST API (JSON)
Browser frontend (vanilla JS)
```

### Read path
1. Server startup: glob `Projects/*_tasks/*.md`, parse YAML frontmatter
2. Build in-memory index: `Map<taskId, Task>`
3. Also parse `Projects/*.md` for project metadata
4. Serve via `GET /api/tasks` and `GET /api/projects`
5. chokidar watches `Projects/` — on file change, re-parse affected file, push update via SSE

### Write path
1. Frontend sends `PATCH /api/tasks/:id` with changed fields
2. Server reads the file, parses YAML, merges changes, updates `updatedAt`
3. Writes file back (preserving body content below the frontmatter)
4. In-memory index updated
5. SSE event pushed to all connected clients
6. Obsidian picks up the file change automatically

### Create path
1. Frontend sends `POST /api/tasks` with task data + projectId
2. Server generates 16-char alphanumeric ID
3. Creates new `.md` file in `Projects/<ProjectName>_tasks/<sanitized-title>.md`
4. Appends task ID to parent project file's `taskIds` array
5. SSE event pushed

## API Surface

```
GET    /api/projects              — all projects with metadata
GET    /api/tasks                  — all tasks (supports ?status=todo,active&project=xxx)
GET    /api/tasks/:id              — single task with full body
PATCH  /api/tasks/:id              — update task fields (status, priority, due, etc.)
POST   /api/tasks                  — create new task
DELETE /api/tasks/:id              — mark cancelled (not file delete)
POST   /api/tasks/:id/move        — change project assignment
GET    /api/stream                 — SSE endpoint for live updates
```

## Task Object (API shape)

```json
{
  "id": "inv01hcc052926a1",
  "title": "Create May invoice for Hunter Contracting",
  "status": "todo",
  "priority": "high",
  "due": "2026-05-29",
  "start": "",
  "projectId": "fxyy5h7xmpdaxx7j",
  "projectName": "Hunter Contracting",
  "projectColor": "#c47070",
  "type": "task",
  "dependencies": [],
  "progress": 0,
  "tags": ["project/mdo-media/client/hunter-contracting", "type/invoice"],
  "assignees": ["dan"],
  "body": "Rate: $150/hr. Compile hours and send invoice.",
  "filePath": "Projects/Hunter Contracting_tasks/create-may-invoice-for-hunter-contracting.md"
}
```

## Frontend Views

### Kanban (default)
- Columns: Blocked | Active | Review | To Do | (optionally Done)
- Cards show: title, project dot, priority badge, due date
- Drag cards between columns → PATCH status
- Click card → detail panel slides in from right

### Table
- Sortable columns: Project, Title, Status, Priority, Due, Assignees
- Inline editable cells for status, priority, due
- Bulk select + bulk status change

### Timeline (Gantt)
- Horizontal bars for tasks with start/due dates
- Grouped by project
- Click bar → detail panel
- Drag bar endpoints to change dates (stretch goal)

### Focus
- Due today / overdue (urgent)
- Currently active
- Blocked items
- High-priority next-up queue
- Work streams by domain tag

### Detail Panel
- Full task editing: title, status, priority, due, start, assignees, tags
- Markdown body editor
- Dependencies picker
- Progress slider
- "Mark Done" / "Mark Active" quick actions
- Delete (→ cancelled status)

## Port

Default: `localhost:4747` (easy to remember, unlikely to conflict)

## Startup

```bash
cd "Vault Commander"
npm install
node server.js --vault ~/Documents/MdO\ Media\ Knowledgebase
```

Server auto-detects `Projects/` folder, indexes all tasks, starts watching for changes.
Opens browser to `http://localhost:4747` automatically.
