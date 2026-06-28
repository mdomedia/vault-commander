#!/usr/bin/env node
/**
 * Vault Commander — server.js
 *
 * A localhost Express server that reads/writes Obsidian vault task files
 * with YAML frontmatter, watches for live changes via chokidar, and
 * exposes a REST + SSE API for a browser-based project management UI.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
const { globSync } = require('glob');
const crypto = require('crypto');
const os = require('os');
const license = require('./lib/license');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let flagVault = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--vault' && args[i + 1]) {
    flagVault = path.resolve(args[i + 1]);
    i++;
  }
}

// Active vault — mutable so the onboarding flow can set/switch it at runtime.
// Resolution order is decided in main(): --vault flag > saved config >
// current folder (if it's a vault) > first-run onboarding.
let vaultPath = process.cwd();
let projectsDir = path.join(vaultPath, 'Projects');
let vaultReady = false;
let watcher = null;

// ---------------------------------------------------------------------------
// In-memory indexes
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} id → project object */
const projectIndex = new Map();

/** @type {Map<string, object>} id → task object (includes body, filePath) */
const taskIndex = new Map();

/**
 * Files we just wrote ourselves — skip the next chokidar event for these
 * so we don't echo our own changes back as SSE events.
 * Maps absolute filePath → timestamp when we wrote it.
 * @type {Map<string, number>}
 */
const recentWrites = new Map();
const WRITE_LOCK_MS = 500;

// ---------------------------------------------------------------------------
// SSE clients
// ---------------------------------------------------------------------------

/** @type {Set<import('express').Response>} */
const sseClients = new Set();

/**
 * Push an SSE event to all connected clients.
 * @param {string} event - event name
 * @param {object} data  - JSON-serialisable payload
 */
function pushSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

// ---------------------------------------------------------------------------
// YAML / file helpers
// ---------------------------------------------------------------------------

/**
 * Parse a markdown file with YAML frontmatter.
 * @param {string} filePath - absolute path
 * @returns {{ frontmatter: object, body: string, raw: string } | null}
 */
function parseTaskFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  let frontmatter;
  try {
    frontmatter = yaml.load(match[1]) || {};
  } catch {
    return null;
  }

  const body = (match[2] || '').replace(/^\n+/, '');
  return { frontmatter, body, raw };
}

/**
 * Write a markdown file with YAML frontmatter.
 * @param {string} filePath   - absolute path
 * @param {object} frontmatter
 * @param {string} body
 */
function writeTaskFile(filePath, frontmatter, body) {
  const yamlStr = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  const content = `---\n${yamlStr}---\n\n${body ?? ''}`;

  // Mark this file as recently-written so chokidar ignores the event
  recentWrites.set(filePath, Date.now());

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Atomic write: write to a temp file in the SAME directory, then rename over
  // the target. rename(2) is atomic on POSIX, so a crash or concurrent read can
  // never observe a truncated or half-written task file in the user's vault.
  // Temp files start with "." and don't end in ".md", so the watcher ignores them.
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Generate a 16-character lowercase alphanumeric ID.
 * @returns {string}
 */
function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(16);
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

/**
 * Sanitize a string for use as a filename.
 * @param {string} title
 * @returns {string}
 */
function sanitizeFilename(title) {
  return title
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Index builders
// ---------------------------------------------------------------------------

/**
 * Build a task object suitable for the API from parsed frontmatter + body.
 * @param {object} fm   - frontmatter
 * @param {string} body - markdown body
 * @param {string} absPath - absolute file path
 * @returns {object}
 */
function buildTaskObject(fm, body, absPath) {
  const project = projectIndex.get(fm.projectId);
  return {
    id: fm.id,
    title: fm.title || '',
    status: fm.status || 'todo',
    priority: fm.priority || 'medium',
    due: fm.due || '',
    start: fm.start || '',
    projectId: fm.projectId || '',
    parentId: fm.parentId || null,
    type: fm.type || 'task',
    dependencies: fm.dependencies || [],
    subtaskIds: fm.subtaskIds || [],
    progress: fm.progress ?? 0,
    tags: fm.tags || [],
    assignees: fm.assignees || [],
    collapsed: fm.collapsed ?? false,
    body: body || '',
    projectName: project ? project.title : '',
    projectColor: project ? project.color : '#888888',
    filePath: path.relative(vaultPath, absPath),
    createdAt: fm.createdAt || '',
    updatedAt: fm.updatedAt || '',
    // Preserve the full frontmatter so we can write back unknown fields
    _fm: fm,
  };
}

/**
 * Scan all project files and populate projectIndex.
 */
function loadProjects() {
  projectIndex.clear();
  const pattern = path.join(projectsDir, '*.md');
  const files = globSync(pattern);

  for (const f of files) {
    // Skip files inside _tasks subdirectories (glob shouldn't match them, but guard)
    if (f.includes('_tasks')) continue;
    const parsed = parseTaskFile(f);
    if (!parsed || !parsed.frontmatter['pm-project']) continue;
    const fm = parsed.frontmatter;
    projectIndex.set(fm.id, {
      id: fm.id,
      title: fm.title || '',
      description: fm.description || '',
      color: fm.color || '#888888',
      icon: fm.icon || '',
      taskIds: fm.taskIds || [],
      filePath: path.relative(vaultPath, f),
      _absPath: f,
      _fm: fm,
    });
  }
}

/**
 * Scan all task files and populate taskIndex.
 */
function loadTasks() {
  taskIndex.clear();
  const pattern = path.join(projectsDir, '*_tasks', '*.md');
  const files = globSync(pattern);

  for (const f of files) {
    const parsed = parseTaskFile(f);
    if (!parsed || !parsed.frontmatter['pm-task']) continue;
    const task = buildTaskObject(parsed.frontmatter, parsed.body, f);
    taskIndex.set(task.id, { ...task, _absPath: f });
  }
}

/**
 * Re-parse a single file and update the appropriate index.
 * @param {string} absPath
 * @returns {{ type: string, data: object } | null}
 */
function reloadFile(absPath) {
  const parsed = parseTaskFile(absPath);
  if (!parsed) return null;
  const fm = parsed.frontmatter;

  if (fm['pm-project']) {
    const proj = {
      id: fm.id,
      title: fm.title || '',
      description: fm.description || '',
      color: fm.color || '#888888',
      icon: fm.icon || '',
      taskIds: fm.taskIds || [],
      filePath: path.relative(vaultPath, absPath),
      _absPath: absPath,
      _fm: fm,
    };
    projectIndex.set(fm.id, proj);
    return { type: 'project', data: proj };
  }

  if (fm['pm-task']) {
    const task = buildTaskObject(fm, parsed.body, absPath);
    taskIndex.set(task.id, { ...task, _absPath: absPath });
    return { type: 'task', data: task };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Vault config & onboarding
// ---------------------------------------------------------------------------

function expandHome(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function configDir() { return path.join(os.homedir(), '.vault-commander'); }
function configFile() { return path.join(configDir(), 'config.json'); }

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf-8')); } catch { return {}; }
}
function saveConfig(obj) {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(obj, null, 2));
  } catch { /* non-fatal */ }
}

/** Path to Obsidian's own config file that lists the user's known vaults. */
function obsidianConfigPath() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
  return path.join(home, '.config', 'obsidian', 'obsidian.json');
}

/** Auto-detect the user's Obsidian vaults (plus the current folder if it's a vault). */
function detectVaults() {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, name: path.basename(p), hasProjects: fs.existsSync(path.join(p, 'Projects')) });
  };
  try {
    const cfgPath = obsidianConfigPath();
    if (fs.existsSync(cfgPath)) {
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const vaults = data && data.vaults ? Object.values(data.vaults) : [];
      for (const v of vaults) if (v && v.path && fs.existsSync(v.path)) add(v.path);
    }
  } catch { /* ignore unreadable obsidian config */ }
  try { const cwd = process.cwd(); if (fs.existsSync(path.join(cwd, 'Projects'))) add(cwd); } catch { /* ignore */ }
  // Vaults that already have a Projects/ folder float to the top.
  out.sort((a, b) => (b.hasProjects ? 1 : 0) - (a.hasProjects ? 1 : 0));
  return out;
}

/** Point the server at a vault: (re)load indexes, (re)start the watcher, persist the choice. */
async function setVault(newVaultPath) {
  vaultPath = path.resolve(expandHome(newVaultPath));
  projectsDir = path.join(vaultPath, 'Projects');
  if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
  loadProjects();
  loadTasks();
  if (watcher) { try { await watcher.close(); } catch { /* ignore */ } watcher = null; }
  startWatcher();
  vaultReady = true;
  saveConfig({ vaultPath });
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Loopback-only Host-header guard (defense-in-depth against DNS rebinding).
// The UI is served from this same origin, so no CORS is needed — and NOT
// emitting Access-Control-Allow-Origin means other web origins cannot read
// our responses. We additionally reject any request whose Host header is not
// loopback, which blocks a remote page that rebinds its own domain to 127.0.0.1.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!ALLOWED_HOSTS.has(host)) {
    return res.status(403).send('Forbidden: Vault Commander only serves loopback requests.');
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// SSE endpoint
// ---------------------------------------------------------------------------

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send init payload
  const initData = {
    configured: vaultReady,
    tasks: stripInternal(Array.from(taskIndex.values())),
    projects: stripInternal(Array.from(projectIndex.values())),
    vaultName: vaultReady ? path.basename(vaultPath) : '',
  };
  res.write(`event: init\ndata: ${JSON.stringify(initData)}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ---------------------------------------------------------------------------
// Project endpoints
// ---------------------------------------------------------------------------

app.get('/api/projects', (_req, res) => {
  const projects = stripInternal(Array.from(projectIndex.values()));
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const id = generateId();
  const now = new Date().toISOString();
  const safeName = sanitizeFilename(title) || 'project';

  // Don't clobber an existing project file — suffix with the id if the name is taken.
  let filePath = path.join(projectsDir, `${safeName}.md`);
  if (fs.existsSync(filePath)) filePath = path.join(projectsDir, `${safeName}-${id}.md`);

  const fm = {
    'pm-project': true,
    id,
    title,
    description: req.body.description || '',
    color: (typeof req.body.color === 'string' && req.body.color) || '#8b7cf7',
    icon: req.body.icon || '',
    taskIds: [],
    createdAt: now,
    updatedAt: now,
  };

  writeTaskFile(filePath, fm, '');

  // Pre-create the task folder so the first task lands in the conventional place.
  const tasksFolder = path.join(projectsDir, `${safeName}_tasks`);
  if (!fs.existsSync(tasksFolder)) fs.mkdirSync(tasksFolder, { recursive: true });

  const proj = {
    id,
    title: fm.title,
    description: fm.description,
    color: fm.color,
    icon: fm.icon,
    taskIds: [],
    filePath: path.relative(vaultPath, filePath),
    _absPath: filePath,
    _fm: fm,
  };
  projectIndex.set(id, proj);

  pushSSE('update', { type: 'project', id, project: stripInternalSingle(proj) });
  res.status(201).json(stripInternalSingle(proj));
});

// ---------------------------------------------------------------------------
// Vault / onboarding endpoints
// ---------------------------------------------------------------------------

app.get('/api/vault', (_req, res) => {
  res.json({
    configured: vaultReady,
    vaultPath: vaultReady ? vaultPath : '',
    vaultName: vaultReady ? path.basename(vaultPath) : '',
  });
});

app.get('/api/vault/candidates', (_req, res) => {
  res.json({ candidates: detectVaults() });
});

app.post('/api/vault', async (req, res) => {
  const raw = (req.body && typeof req.body.path === 'string') ? req.body.path.trim() : '';
  if (!raw) return res.status(400).json({ error: 'path is required' });
  const resolved = path.resolve(expandHome(raw));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: 'That folder does not exist.' });
  }
  await setVault(resolved);
  pushSSE('vault', { configured: true, vaultName: path.basename(vaultPath) });
  res.json({
    configured: true,
    vaultPath,
    vaultName: path.basename(vaultPath),
    projects: stripInternal(Array.from(projectIndex.values())),
    tasks: stripInternal(Array.from(taskIndex.values())),
  });
});

// Server-side folder browser for onboarding — a browser page can't hand us a
// real filesystem path, so the local server lists directories on request.
app.get('/api/browse', (req, res) => {
  let target = (req.query.path && String(req.query.path)) || os.homedir();
  target = path.resolve(expandHome(target));

  let stat;
  try { stat = fs.statSync(target); } catch { return res.status(400).json({ error: 'Folder not found' }); }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a folder' });

  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => {
        const p = path.join(target, d.name);
        let hasProjects = false;
        try { hasProjects = fs.existsSync(path.join(p, 'Projects')); } catch { /* ignore */ }
        return { name: d.name, path: p, hasProjects };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* permission denied etc. → empty listing */ }

  const parent = path.dirname(target);
  res.json({ path: target, parent: parent === target ? null : parent, entries });
});

// ---------------------------------------------------------------------------
// License / Pro endpoints (Polar). License activation is the only outbound
// network call the app ever makes, and only when the user activates Pro.
// ---------------------------------------------------------------------------

app.get('/api/license', (_req, res) => res.json(license.status()));

app.post('/api/license/activate', async (req, res) => {
  try {
    const result = await license.activate(req.body && req.body.key);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/license/deactivate', (_req, res) => res.json({ ok: true, ...license.deactivate() }));

// ---------------------------------------------------------------------------
// Task endpoints
// ---------------------------------------------------------------------------

app.get('/api/tasks', (req, res) => {
  let tasks = Array.from(taskIndex.values());

  // Filter by status
  if (req.query.status) {
    const statuses = req.query.status.split(',').map((s) => s.trim());
    tasks = tasks.filter((t) => statuses.includes(t.status));
  }

  // Filter by projectId
  if (req.query.projectId) {
    tasks = tasks.filter((t) => t.projectId === req.query.projectId);
  }

  res.json(stripInternal(tasks));
});

app.get('/api/tasks/:id', (req, res) => {
  const task = taskIndex.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(stripInternalSingle(task));
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = taskIndex.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const absPath = task._absPath;
  const parsed = parseTaskFile(absPath);
  if (!parsed) return res.status(500).json({ error: 'Failed to read task file' });

  const fm = parsed.frontmatter;
  let body = parsed.body;

  // Merge allowed fields into frontmatter
  const updatable = [
    'title', 'status', 'priority', 'due', 'start',
    'progress', 'assignees', 'tags', 'dependencies',
    'type', 'parentId', 'subtaskIds', 'collapsed',
  ];

  for (const key of updatable) {
    if (req.body[key] !== undefined) {
      // Backstop: never let a task's title be wiped to empty/whitespace.
      // (Guards against client-side races writing a blank title.)
      if (key === 'title' && (typeof req.body.title !== 'string' || req.body.title.trim() === '')) {
        continue;
      }
      fm[key] = req.body[key];
    }
  }

  // Update body if provided
  if (req.body.body !== undefined) {
    body = req.body.body;
  }

  // If status changed to done, set progress to 100
  if (req.body.status === 'done') {
    fm.progress = 100;
  }

  // Always update updatedAt
  fm.updatedAt = new Date().toISOString();

  writeTaskFile(absPath, fm, body);

  // Update in-memory index
  const updated = buildTaskObject(fm, body, absPath);
  taskIndex.set(updated.id, { ...updated, _absPath: absPath });

  // Push SSE
  pushSSE('update', { type: 'task', id: updated.id, task: stripInternalSingle(updated) });

  res.json(stripInternalSingle(updated));
});

app.post('/api/tasks', (req, res) => {
  const { title, projectId } = req.body;
  if (!title || !projectId) {
    return res.status(400).json({ error: 'title and projectId are required' });
  }

  const project = projectIndex.get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Find the _tasks folder for this project
  const tasksFolderPattern = path.join(projectsDir, '*_tasks');
  const tasksFolders = globSync(tasksFolderPattern);
  let targetFolder = null;

  // Strategy: find a _tasks folder whose tasks reference this projectId,
  // or derive from project title
  for (const folder of tasksFolders) {
    const folderFiles = globSync(path.join(folder, '*.md'));
    for (const f of folderFiles) {
      const p = parseTaskFile(f);
      if (p && p.frontmatter.projectId === projectId) {
        targetFolder = folder;
        break;
      }
    }
    if (targetFolder) break;
  }

  // Fallback: create folder from project title (matches the `<Title>_tasks`
  // convention used everywhere else in the vault — keep the spaces).
  if (!targetFolder) {
    const folderBase = sanitizeFilename(project.title) || 'project';
    targetFolder = path.join(projectsDir, `${folderBase}_tasks`);
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
  }

  const newId = generateId();
  const now = new Date().toISOString();
  // Filename embeds the unique task ID so two tasks with the same title never
  // collide on disk and silently overwrite each other. The title part is purely
  // cosmetic; the ID guarantees uniqueness.
  const safeName = sanitizeFilename(title) || 'task';
  const filePath = path.join(targetFolder, `${safeName}-${newId}.md`);

  const fm = {
    'pm-task': true,
    projectId,
    parentId: req.body.parentId || null,
    id: newId,
    title,
    type: req.body.type || 'task',
    status: req.body.status || 'todo',
    priority: req.body.priority || 'medium',
    start: req.body.start || '',
    due: req.body.due || '',
    progress: 0,
    assignees: req.body.assignees || [],
    tags: req.body.tags || [],
    subtaskIds: [],
    dependencies: req.body.dependencies || [],
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };

  const body = req.body.body || '';

  writeTaskFile(filePath, fm, body);

  // Add task ID to project's taskIds
  const projParsed = parseTaskFile(project._absPath);
  if (projParsed) {
    const projFm = projParsed.frontmatter;
    if (!Array.isArray(projFm.taskIds)) projFm.taskIds = [];
    projFm.taskIds.push(newId);
    writeTaskFile(project._absPath, projFm, projParsed.body);

    // Update project in memory
    project.taskIds = projFm.taskIds;
    project._fm = projFm;
  }

  // Add to in-memory index
  const task = buildTaskObject(fm, body, filePath);
  taskIndex.set(newId, { ...task, _absPath: filePath });

  // Push SSE
  pushSSE('update', { type: 'task', id: newId, task: stripInternalSingle(task) });

  res.status(201).json(stripInternalSingle(task));
});

// ---------------------------------------------------------------------------
// Stats endpoint (Dashboard)
// ---------------------------------------------------------------------------

app.get('/api/stats', (_req, res) => {
  const tasks = Array.from(taskIndex.values());
  const todayStr = new Date().toISOString().slice(0, 10);

  // Total
  const totalTasks = tasks.length;

  // Status breakdown
  const statusBreakdown = {};
  for (const t of tasks) {
    const s = t.status || 'todo';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // Priority breakdown
  const priorityBreakdown = {};
  for (const t of tasks) {
    const p = t.priority || 'medium';
    priorityBreakdown[p] = (priorityBreakdown[p] || 0) + 1;
  }

  // Project breakdown
  const projMap = {};
  for (const t of tasks) {
    const pid = t.projectId;
    if (!pid) continue;
    if (!projMap[pid]) {
      const proj = projectIndex.get(pid);
      projMap[pid] = {
        id: pid,
        title: proj ? proj.title : pid,
        color: proj ? proj.color : '#888888',
        total: 0,
        done: 0,
        active: 0,
      };
    }
    projMap[pid].total++;
    if (t.status === 'done') projMap[pid].done++;
    if (t.status === 'active') projMap[pid].active++;
  }
  const projectBreakdown = Object.values(projMap).sort((a, b) => b.total - a.total);

  // Due today & overdue
  let dueToday = 0;
  let overdue = 0;
  for (const t of tasks) {
    if (!t.due || t.status === 'done' || t.status === 'cancelled') continue;
    if (t.due === todayStr) dueToday++;
    else if (t.due < todayStr) overdue++;
  }

  // Completion dates from updatedAt for done tasks
  const completionDates = {};
  for (const t of tasks) {
    if (t.status !== 'done' || !t.updatedAt) continue;
    const ua = String(t.updatedAt);
    const d = ua.slice(0, 10);
    completionDates[d] = (completionDates[d] || 0) + 1;
  }

  // Completed last 7 days
  const completedLast7Days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const ds = dt.toISOString().slice(0, 10);
    if (completionDates[ds]) {
      completedLast7Days.push({ date: ds, count: completionDates[ds] });
    }
  }

  // Completed last 30 days
  const completedLast30Days = [];
  for (let i = 0; i < 30; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const ds = dt.toISOString().slice(0, 10);
    if (completionDates[ds]) {
      completedLast30Days.push({ date: ds, count: completionDates[ds] });
    }
  }

  // Streak: consecutive days backwards from today with at least 1 completion
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const ds = dt.toISOString().slice(0, 10);
    if (completionDates[ds]) streak++;
    else break;
  }

  // Velocity
  const sum7 = completedLast7Days.reduce((s, d) => s + d.count, 0);
  const sum30 = completedLast30Days.reduce((s, d) => s + d.count, 0);
  const velocity7d = Math.round((sum7 / 7) * 10) / 10;
  const velocity30d = Math.round((sum30 / 30) * 10) / 10;

  // Activity heatmap (last 91 days = 13 weeks)
  const activityHeatmap = [];
  for (let i = 0; i < 91; i++) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const ds = dt.toISOString().slice(0, 10);
    if (completionDates[ds]) {
      activityHeatmap.push({ date: ds, count: completionDates[ds] });
    }
  }

  res.json({
    totalTasks,
    statusBreakdown,
    priorityBreakdown,
    projectBreakdown,
    dueToday,
    overdue,
    completedLast7Days,
    completedLast30Days,
    streak,
    velocity7d,
    velocity30d,
    activityHeatmap,
  });
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = taskIndex.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const absPath = task._absPath;
  const parsed = parseTaskFile(absPath);
  if (!parsed) return res.status(500).json({ error: 'Failed to read task file' });

  const fm = parsed.frontmatter;
  fm.status = 'cancelled';
  fm.updatedAt = new Date().toISOString();

  writeTaskFile(absPath, fm, parsed.body);

  // Update in-memory index
  const updated = buildTaskObject(fm, parsed.body, absPath);
  taskIndex.set(updated.id, { ...updated, _absPath: absPath });

  // Push SSE
  pushSSE('update', { type: 'task', id: updated.id, task: stripInternalSingle(updated) });

  res.json(stripInternalSingle(updated));
});

// ---------------------------------------------------------------------------
// Helpers — strip internal fields from API responses
// ---------------------------------------------------------------------------

/**
 * Remove internal fields (_fm, _absPath) from an array of objects.
 * @param {object[]} arr
 * @returns {object[]}
 */
function stripInternal(arr) {
  return arr.map(stripInternalSingle);
}

/**
 * Remove internal fields from a single object.
 * @param {object} obj
 * @returns {object}
 */
function stripInternalSingle(obj) {
  const { _fm, _absPath, ...clean } = obj;
  return clean;
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

function startWatcher() {
  watcher = chokidar.watch(projectsDir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('change', (absPath) => handleFileEvent(absPath));
  watcher.on('add', (absPath) => handleFileEvent(absPath));
  watcher.on('unlink', (absPath) => {
    // If a file is deleted, remove from index
    for (const [id, task] of taskIndex) {
      if (task._absPath === absPath) {
        taskIndex.delete(id);
        pushSSE('update', { type: 'taskRemoved', id });
        return;
      }
    }
    for (const [id, proj] of projectIndex) {
      if (proj._absPath === absPath) {
        projectIndex.delete(id);
        pushSSE('update', { type: 'projectRemoved', id });
        return;
      }
    }
  });

  console.log('  File watcher active on Projects/');
}

/**
 * Handle a file change/add event from chokidar.
 * @param {string} absPath
 */
function handleFileEvent(absPath) {
  // Only handle .md files
  if (!absPath.endsWith('.md')) return;

  // Check if this was a write we just made ourselves
  const writeTime = recentWrites.get(absPath);
  if (writeTime && Date.now() - writeTime < WRITE_LOCK_MS) {
    recentWrites.delete(absPath);
    return;
  }
  recentWrites.delete(absPath);

  const result = reloadFile(absPath);
  if (!result) return;

  if (result.type === 'task') {
    pushSSE('update', {
      type: 'task',
      id: result.data.id,
      task: stripInternalSingle(result.data),
    });
  } else if (result.type === 'project') {
    pushSSE('update', {
      type: 'project',
      id: result.data.id,
      project: stripInternalSingle(result.data),
    });
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n  ⚡ Vault Commander\n');

  // Opportunistic, non-blocking Pro license re-check (offline-safe; never downgrades on error).
  license.revalidate().catch(() => {});

  // Resolve which vault to open: explicit --vault flag > saved config >
  // current folder (if it's a vault) > first-run onboarding in the browser.
  let initial = null;
  if (flagVault) {
    initial = flagVault;
  } else {
    const cfg = loadConfig();
    if (cfg.vaultPath && fs.existsSync(path.join(cfg.vaultPath, 'Projects'))) initial = cfg.vaultPath;
    else if (fs.existsSync(path.join(process.cwd(), 'Projects'))) initial = process.cwd();
  }

  if (initial) {
    await setVault(initial);
    console.log(`  Vault: ${vaultPath}`);
    console.log(`  Projects: ${projectIndex.size}`);
    console.log(`  Tasks: ${taskIndex.size}`);
  } else {
    console.log('  No vault configured yet — opening first-run setup in your browser…');
  }

  // Start server
  const PORT = 4747;
  // Bind to loopback only — never expose the vault on the LAN.
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`  Server: http://localhost:${PORT}\n`);

    // Auto-open browser, unless we are embedded. The desktop app (Electron)
    // sets VC_NO_OPEN and loads the UI in its own window. The 'open' package is
    // ESM-only and may be unavailable in a packaged binary, so fall back to the
    // platform's native opener if the dynamic import fails.
    if (!process.env.VC_NO_OPEN) {
      const url = `http://localhost:${PORT}`;
      import('open').then((mod) => {
        const openFn = mod.default || mod;
        openFn(url);
      }).catch(() => {
        try {
          const { exec } = require('child_process');
          const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32' ? `start "" "${url}"`
            : `xdg-open "${url}"`;
          exec(cmd, () => {});
        } catch (_) {
          console.log(`  Open ${url} in your browser.`);
        }
      });
    }
  });

  // The common failure is the port already being taken, usually because Vault
  // Commander is already running in another tab or terminal. Exit cleanly with
  // guidance instead of dumping a raw EADDRINUSE stack trace at the user.
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use.`);
      console.error(`  Vault Commander may already be running. Open http://localhost:${PORT}`);
      console.error(`  in your browser, or close the other instance and run this again.\n`);
    } else {
      console.error('\n  Could not start the server:', (err && err.message) || err, '\n');
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
