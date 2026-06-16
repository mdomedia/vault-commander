/* ============================================================
   Vault Commander — Application (ES Module)
   ============================================================ */

// --- Helpers ---
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function today() { return new Date().toISOString().slice(0, 10); }

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(due) {
  return due && due < today();
}

function isDueToday(due) {
  return due && due === today();
}

const STATUS_ORDER = ['blocked', 'active', 'review', 'todo', 'done', 'deferred', 'cancelled'];
const STATUS_LABELS = { todo: 'To Do', active: 'Active', blocked: 'Blocked', review: 'Review', done: 'Done', deferred: 'Deferred', cancelled: 'Cancelled' };
const STATUS_COLORS = { todo: '#A8987E', active: '#5E8AA0', blocked: '#C0553A', review: '#C8862E', done: '#7E9A5C', deferred: '#C9BCA4', cancelled: '#DCD2BE' };
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const KANBAN_STATUSES = ['todo', 'active', 'review', 'blocked'];

// --- State ---
const state = {
  tasks: [],
  projects: {},
  currentView: 'dashboard',
  activeProjects: new Set(),
  hideDone: true,
  hideDeferred: true,
  hideCancelled: true,
  searchQuery: '',
  selectedTaskId: null,
  sortCol: 'project',
  sortAsc: true,
  dragTaskId: null,
  // theming: independent axes — color identity, light/dark, and the Commander UX flip
  themeName: 'sandstone',   // sandstone | slate | midnight
  mode: 'light',            // light | dark | system
  commander: false,         // master UX flip: mascot + personality + gamification
  undoStack: [],            // [{label, undoFn}] — reversible actions
  composerStatus: null,     // which kanban column has an open inline composer
  kanbanSort: {},           // per-column sort: { status: sortKey }
};

const SORT_OPTIONS = [
  { key: 'priority', label: 'Priority' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'created', label: 'Newest created' },
  { key: 'created-asc', label: 'Oldest created' },
  { key: 'due', label: 'Due date' },
  { key: 'title', label: 'Title A–Z' },
];

const THEMES = [
  { id: 'sandstone', name: 'Sandstone', desc: 'Warm paper — clay, linen & sand', swatch: ['#EAE3D5', '#B5613A', '#FEFCF8', '#C8862E'] },
  { id: 'slate',     name: 'Slate',     desc: 'Crisp & cool — maximum readability', swatch: ['#EEF1F5', '#4F46E5', '#FFFFFF', '#3B82F6'] },
  { id: 'midnight',  name: 'Midnight',  desc: 'Premium navy & aged gold', swatch: ['#0D1626', '#C9A24A', '#131F33', '#5B8AD6'] },
];

// --- Persistence ---
function savePrefs() {
  try {
    localStorage.setItem('vc-prefs', JSON.stringify({
      currentView: state.currentView,
      activeProjects: [...state.activeProjects],
      hideDone: state.hideDone,
      hideDeferred: state.hideDeferred,
      hideCancelled: state.hideCancelled,
      themeName: state.themeName,
      mode: state.mode,
      commander: state.commander,
      kanbanSort: state.kanbanSort,
    }));
  } catch {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem('vc-prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.currentView && p.currentView !== 'settings') state.currentView = p.currentView;
    if (p.hideDone !== undefined) state.hideDone = p.hideDone;
    if (p.hideDeferred !== undefined) state.hideDeferred = p.hideDeferred;
    if (p.hideCancelled !== undefined) state.hideCancelled = p.hideCancelled;
    if (['sandstone','slate','midnight'].includes(p.themeName)) state.themeName = p.themeName;
    if (['light','dark','system'].includes(p.mode)) state.mode = p.mode;
    if (typeof p.commander === 'boolean') state.commander = p.commander;
    if (p.kanbanSort && typeof p.kanbanSort === 'object') state.kanbanSort = p.kanbanSort;
    // migrate the old single "theme" pref (clean/commander day-night toggle)
    if (p.theme === 'commander' && p.commander === undefined) { state.mode = 'dark'; state.commander = true; }
    // activeProjects restored after projects load
    if (Array.isArray(p.activeProjects)) state._savedActiveProjects = p.activeProjects;
  } catch {}
}

// --- Theme ---
function resolvedMode() {
  if (state.mode === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return state.mode;
}

function applyTheme() {
  const body = document.body;
  body.setAttribute('data-theme', state.themeName);
  body.setAttribute('data-mode', resolvedMode());
  body.setAttribute('data-commander', state.commander ? 'on' : 'off');
  // header quick light/dark toggle reflects the resolved appearance
  const mt = document.getElementById('mode-toggle');
  if (mt) {
    const dark = resolvedMode() === 'dark';
    mt.querySelector('.mode-icon').textContent = dark ? '🌙' : '☀️';
    mt.title = dark ? 'Switch to light' : 'Switch to dark';
  }
}

// --- Toast ---
// toast(msg) | toast(msg, true) [legacy error] | toast(msg, { error, undo })
function toast(msg, opts = {}) {
  if (opts === true) opts = { error: true };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast' + (opts.error ? ' error' : '');
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);

  let dismiss;
  const remove = () => { el.classList.add('removing'); setTimeout(() => el.remove(), 200); };

  if (typeof opts.undo === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.textContent = 'Undo';
    btn.addEventListener('click', () => { clearTimeout(dismiss); remove(); opts.undo(); });
    el.appendChild(btn);
  }
  container.appendChild(el);
  dismiss = setTimeout(remove, opts.undo ? 6000 : 3000);
}

// --- Undo ---
// Registers a reversible action and returns a one-shot runner (safe for both
// the toast "Undo" button and the ⌘Z shortcut to call — it only fires once).
function undoable(label, undoFn) {
  let done = false;
  const run = async () => {
    if (done) return;
    done = true;
    const i = state.undoStack.findIndex(e => e.run === run);
    if (i >= 0) state.undoStack.splice(i, 1);
    try { await undoFn(); } catch {}
  };
  state.undoStack.push({ label, run });
  if (state.undoStack.length > 50) state.undoStack.shift();
  return run;
}

// ⌘Z — run the most recent undoable action
async function runUndo() {
  const entry = state.undoStack[state.undoStack.length - 1];
  if (!entry) { toast('Nothing to undo'); return; }
  await entry.run();
}

// --- API ---
async function api(path, opts = {}) {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

async function fetchProjects() {
  const list = await api('/api/projects');
  state.projects = {};
  list.forEach(p => state.projects[p.id] = p);

  // Restore saved active projects or default to all
  if (state._savedActiveProjects) {
    state.activeProjects = new Set(state._savedActiveProjects.filter(id => state.projects[id]));
    delete state._savedActiveProjects;
  }
  if (state.activeProjects.size === 0) {
    state.activeProjects = new Set(Object.keys(state.projects));
  }
}

async function fetchTasks() {
  state.tasks = await api('/api/tasks');
}

async function patchTask(id, fields) {
  return api(`/api/tasks/${id}`, { method: 'PATCH', body: fields });
}

async function createTask(data) {
  return api('/api/tasks', { method: 'POST', body: data });
}

async function createProject(data) {
  return api('/api/projects', { method: 'POST', body: data });
}

async function deleteTask(id) {
  return api(`/api/tasks/${id}`, { method: 'DELETE' });
}

// --- SSE ---
function connectSSE() {
  const es = new EventSource('/api/stream');

  es.addEventListener('init', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.vaultName) state.vaultName = data.vaultName;
      if (Array.isArray(data.tasks)) state.tasks = data.tasks;
      if (data.projects) {
        state.projects = {};
        data.projects.forEach(p => state.projects[p.id] = p);
      }
      renderAll();
    } catch {}
  });

  es.addEventListener('update', (e) => {
    try {
      // Server sends { type, id, task|project } — dispatch on type. The real
      // payload is nested (msg.task / msg.project), NOT on the top level.
      const msg = JSON.parse(e.data);

      // Task deleted in the vault
      if (msg.type === 'taskRemoved') {
        const i = state.tasks.findIndex(t => t.id === msg.id);
        if (i >= 0) { state.tasks.splice(i, 1); renderAll(); }
        if (state.selectedTaskId === msg.id) closeDetail();
        return;
      }

      // Project added or updated (incl. created via API on another client)
      if (msg.type === 'project' && msg.project) {
        state.projects[msg.project.id] = { ...state.projects[msg.project.id], ...msg.project };
        renderAll();
        return;
      }

      // Project removed in the vault
      if (msg.type === 'projectRemoved') {
        delete state.projects[msg.id];
        state.activeProjects.delete(msg.id);
        renderAll();
        return;
      }

      // Task added or updated (this is the Obsidian → board live-sync path)
      const task = msg.task;
      if (!task || !task.id) return;
      const idx = state.tasks.findIndex(t => t.id === task.id);
      if (idx >= 0) state.tasks[idx] = { ...state.tasks[idx], ...task };
      else state.tasks.push(task);
      renderAll();
      // If the detail panel shows this task, refresh it — but NEVER while the
      // user is editing it (a field is focused) or a save is pending. Rebuilding
      // the form mid-edit is what caused titles/bodies to be wiped.
      if (state.selectedTaskId === task.id) {
        const editingThisPane = document.querySelector('#detail-content :focus');
        if (!editingThisPane && !detailDebounce) populateDetail(task);
      }
    } catch {}
  });

  es.addEventListener('delete', (e) => {
    try {
      const data = JSON.parse(e.data);
      const idx = state.tasks.findIndex(t => t.id === data.id);
      if (idx >= 0) {
        state.tasks[idx].status = 'cancelled';
        renderAll();
      }
    } catch {}
  });

  // A vault was connected (possibly from another window) — refresh onboarding.
  es.addEventListener('vault', () => {
    if (state._connectingVault) return;
    if (document.getElementById('onboarding').classList.contains('open')) location.reload();
  });

  es.onerror = () => {
    // Reconnect handled automatically by EventSource
  };
}

// --- Filtering ---
function getFilteredTasks() {
  return state.tasks.filter(t => {
    if (!state.activeProjects.has(t.projectId)) return false;
    if (state.hideDone && t.status === 'done') return false;
    if (state.hideDeferred && t.status === 'deferred') return false;
    if (state.hideCancelled && t.status === 'cancelled') return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      if (!t.title.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function sortTasks(tasks, col, asc) {
  const dir = asc ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let av, bv;
    switch (col) {
      case 'project': av = (a.projectName || '').toLowerCase(); bv = (b.projectName || '').toLowerCase(); break;
      case 'title': av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
      case 'status': av = STATUS_ORDER.indexOf(a.status); bv = STATUS_ORDER.indexOf(b.status); return (av - bv) * dir;
      case 'priority': av = PRIORITY_ORDER[a.priority] ?? 2; bv = PRIORITY_ORDER[b.priority] ?? 2; return (av - bv) * dir;
      case 'due': av = a.due || 'z'; bv = b.due || 'z'; break;
      case 'assignees': av = (a.assignees || []).join(','); bv = (b.assignees || []).join(','); break;
      default: av = ''; bv = '';
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function kanbanSort(tasks) {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = a.due || 'z';
    const db = b.due || 'z';
    if (da !== db) return da < db ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

// Per-column sort (key chosen via the column header sort menu)
function sortColumn(tasks, key) {
  const arr = [...tasks];
  switch (key) {
    case 'updated':     return arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    case 'created':     return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    case 'created-asc': return arr.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    case 'due':         return arr.sort((a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.title.localeCompare(b.title));
    case 'title':       return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'priority':
    default:            return kanbanSort(arr);
  }
}
function sortLabel(key) { return (SORT_OPTIONS.find(o => o.key === key) || SORT_OPTIONS[0]).label; }

// --- Column sort menu (shared floating menu) ---
let sortMenuEl = null;
function ensureSortMenu() {
  if (sortMenuEl) return sortMenuEl;
  sortMenuEl = document.createElement('div');
  sortMenuEl.className = 'col-sort-menu';
  document.body.appendChild(sortMenuEl);
  sortMenuEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-sort-key]');
    if (!item) return;
    state.kanbanSort[sortMenuEl.dataset.status] = item.dataset.sortKey;
    savePrefs();
    closeSortMenu();
    renderKanban();
  });
  return sortMenuEl;
}
function openSortMenu(btn, status) {
  const m = ensureSortMenu();
  m.dataset.status = status;
  const cur = state.kanbanSort[status] || 'priority';
  m.innerHTML = `<div class="col-sort-head">Sort by</div>` + SORT_OPTIONS.map(o =>
    `<div class="col-sort-item ${o.key === cur ? 'active' : ''}" data-sort-key="${o.key}"><span>${o.label}</span>${o.key === cur ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>`).join('');
  const r = btn.getBoundingClientRect();
  m.style.display = 'block';
  let left = r.right - 188;
  if (left < 8) left = 8;
  m.style.left = left + 'px';
  m.style.top = (r.bottom + 6) + 'px';
}
function closeSortMenu() { if (sortMenuEl) sortMenuEl.style.display = 'none'; }

// --- Render ---
const $view = () => document.getElementById('view-container');
const $stats = () => document.getElementById('stat-pills');
const $chips = () => document.getElementById('project-chips');

function renderAll() {
  renderStats();
  renderProjectChips();
  renderView();
}

function renderStats() {
  const tasks = getFilteredTasks();
  const active = tasks.filter(t => t.status === 'active').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  const dueToday = tasks.filter(t => isDueToday(t.due) && t.status !== 'done' && t.status !== 'cancelled').length;

  $stats().innerHTML = `
    <div class="stat-pill"><span class="dot" style="background:${STATUS_COLORS.active}"></span>${active} active</div>
    <div class="stat-pill"><span class="dot" style="background:${STATUS_COLORS.blocked}"></span>${blocked} blocked</div>
    <div class="stat-pill"><span class="dot" style="background:${STATUS_COLORS.todo}"></span>${todo} todo</div>
    <div class="stat-pill"><span class="dot" style="background:#C8862E"></span>${dueToday} due today</div>
  `;
}

function renderProjectChips() {
  const projects = Object.values(state.projects);
  $chips().innerHTML = projects.map(p => {
    const isActive = state.activeProjects.has(p.id);
    const activeStyle = isActive ? `background:${esc(p.color)};border-color:${esc(p.color)}` : '';
    return `
    <button class="project-chip ${isActive ? 'active' : ''}" data-id="${esc(p.id)}" style="${activeStyle}">
      <span class="chip-dot" style="background:${isActive ? '#fff' : esc(p.color)}"></span>
      ${esc(p.title)}
    </button>`;
  }).join('');
}

function renderView() {
  // the filter bar is irrelevant on the settings page
  const fb = document.querySelector('.filter-bar');
  if (fb) fb.style.display = state.currentView === 'settings' ? 'none' : '';
  // reflect active nav state (settings is not a top tab)
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === state.currentView));
  const sb = document.getElementById('settings-btn');
  if (sb) sb.classList.toggle('active', state.currentView === 'settings');

  switch (state.currentView) {
    case 'dashboard': renderDashboard(); break;
    case 'kanban': renderKanban(); break;
    case 'table': renderTable(); break;
    case 'timeline': renderTimeline(); break;
    case 'focus': renderFocus(); break;
    case 'settings': renderSettings(); break;
  }
}

// --- Settings ---
function renderSettings() {
  const seg = (val, cur, label, sub) => `
    <button class="seg-btn ${val === cur ? 'active' : ''}" data-mode="${val}">
      <span class="seg-label">${label}</span>${sub ? `<span class="seg-sub">${sub}</span>` : ''}
    </button>`;

  const themeCard = (t) => `
    <button class="theme-card ${t.id === state.themeName ? 'active' : ''}" data-theme-id="${t.id}">
      <div class="theme-card-swatch">
        ${t.swatch.map(c => `<span style="background:${c}"></span>`).join('')}
      </div>
      <div class="theme-card-meta">
        <div class="theme-card-name">${t.name}${t.id === state.themeName ? '<svg class="theme-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}</div>
        <div class="theme-card-desc">${t.desc}</div>
      </div>
    </button>`;

  $view().innerHTML = `
    <div class="settings">
      <div class="settings-head">
        <h1>Settings</h1>
        <p>Personalize how Vault Commander looks and feels.</p>
      </div>

      <section class="settings-section">
        <div class="settings-section-text">
          <h2>Vault</h2>
          <p>The folder Vault Commander reads and writes. Switch to point it at a different vault.</p>
        </div>
        <div class="vault-setting">
          <div class="vault-setting-name">${esc(state.vaultName || 'No vault')}</div>
          <div class="vault-setting-path" title="${esc(state.vaultPath || '')}">${esc(state.vaultPath || '')}</div>
          <button class="btn-secondary" id="switch-vault-btn" type="button">Switch vault…</button>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-text">
          <h2>Appearance</h2>
          <p>Choose a light or dark interface, or follow your system.</p>
        </div>
        <div class="seg-control" id="seg-appearance">
          ${seg('light', state.mode, 'Light')}
          ${seg('dark', state.mode, 'Dark')}
          ${seg('system', state.mode, 'System')}
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-text">
          <h2>Theme</h2>
          <p>The color identity of the app. Each works in light and dark.</p>
        </div>
        <div class="theme-grid" id="theme-grid">
          ${THEMES.map(themeCard).join('')}
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-text">
          <h2>Commander Mode</h2>
          <p>A master UX flip — mascot, personality copy, and gamified streaks. Works across every theme and appearance.</p>
        </div>
        <label class="switch-row">
          <span class="switch-row-label">${state.commander ? 'On' : 'Off'}</span>
          <span class="switch ${state.commander ? 'on' : ''}" id="commander-switch" role="switch" aria-checked="${state.commander}"><span class="switch-knob"></span></span>
        </label>
      </section>
    </div>`;

  // Appearance segmented control
  $view().querySelectorAll('#seg-appearance .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      applyTheme(); savePrefs(); renderSettings();
    });
  });
  // Theme cards
  $view().querySelectorAll('#theme-grid .theme-card').forEach(card => {
    card.addEventListener('click', () => {
      state.themeName = card.dataset.themeId;
      applyTheme(); savePrefs(); renderSettings();
    });
  });
  // Commander switch
  const sw = document.getElementById('commander-switch');
  if (sw) sw.addEventListener('click', () => {
    state.commander = !state.commander;
    applyTheme(); savePrefs(); renderSettings();
  });
  // Switch vault
  const svb = document.getElementById('switch-vault-btn');
  if (svb) svb.addEventListener('click', openVaultSwitcher);
}

// --- Dashboard ---
async function renderDashboard() {
  $view().innerHTML = '<div class="loading">Loading dashboard...</div>';

  let stats;
  try {
    stats = await fetch('/api/stats').then(r => r.json());
  } catch {
    $view().innerHTML = '<div class="empty-state">Failed to load dashboard stats.</div>';
    return;
  }

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // Status message
  const activeCount = stats.statusBreakdown.active || 0;
  const projectCount = stats.projectBreakdown.length;
  let statusMsg = '';
  if (stats.dueToday > 0 || stats.overdue > 0) {
    const parts = [];
    if (stats.dueToday > 0) parts.push(`${stats.dueToday} due today`);
    if (stats.overdue > 0) parts.push(`${stats.overdue} overdue`);
    parts.push(`${activeCount} tasks active across ${projectCount} projects`);
    statusMsg = parts.join('. ') + '.';
  } else {
    statusMsg = `All clear. ${activeCount} tasks active across ${projectCount} projects.`;
  }

  // --- KPI cards ---
  const completedThisWeek = stats.completedLast7Days.reduce((s, d) => s + d.count, 0);
  const streakDisplay = stats.streak > 0
    ? `<span class="dash-streak">${state.commander ? '🔥 ' : ''}${stats.streak}</span>`
    : '<span style="color:var(--text-secondary)">—</span>';
  const overdueIcon = stats.overdue === 0
    ? '<span style="color:#7E9A5C">✓</span>'
    : `<span class="kpi-dot" style="background:#C0553A"></span>`;

  const kpiHtml = `
    <div class="dash-kpi-row">
      <div class="dash-kpi">
        <div class="dash-kpi-value"><span class="kpi-dot" style="background:#5E8AA0"></span>${activeCount}</div>
        <div class="dash-kpi-label">Active</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-value"><span class="kpi-dot" style="background:#C0553A"></span>${stats.statusBreakdown.blocked || 0}</div>
        <div class="dash-kpi-label">Blocked</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-value"><span class="kpi-dot" style="background:#C8862E"></span>${stats.dueToday}</div>
        <div class="dash-kpi-label">Due Today</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-value">${overdueIcon} ${stats.overdue}</div>
        <div class="dash-kpi-label">Overdue</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-value"><span class="kpi-dot" style="background:#7E9A5C"></span>${completedThisWeek}</div>
        <div class="dash-kpi-label">Done This Week</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-value">${streakDisplay}</div>
        <div class="dash-kpi-label">Streak</div>
      </div>
    </div>`;

  // --- Velocity chart (last 14 days) ---
  const velocityDays = [];
  const completionMap = {};
  stats.completedLast7Days.forEach(d => completionMap[d.date] = d.count);
  stats.completedLast30Days.forEach(d => { if (!completionMap[d.date]) completionMap[d.date] = d.count; });
  stats.activityHeatmap.forEach(d => { if (!completionMap[d.date]) completionMap[d.date] = d.count; });

  for (let i = 13; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const ds = dt.toISOString().slice(0, 10);
    velocityDays.push({ date: ds, count: completionMap[ds] || 0, label: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  }
  const maxVel = Math.max(1, ...velocityDays.map(d => d.count));

  let velocityBars = velocityDays.map(d => {
    const h = Math.round((d.count / maxVel) * 120);
    const cls = d.count === 0 ? 'dash-velocity-bar empty' : 'dash-velocity-bar';
    return `<div class="dash-velocity-bar-wrap">
      <div class="${cls}" style="height:${Math.max(2, h)}px" title="${d.date}: ${d.count} completed"></div>
      <div class="dash-velocity-label">${d.label}</div>
    </div>`;
  }).join('');

  // --- Status distribution ---
  const statusOrder = ['todo', 'active', 'blocked', 'review', 'done', 'deferred', 'cancelled'];
  const totalForBar = stats.totalTasks || 1;
  let statusSegments = '';
  let statusLegend = '';
  statusOrder.forEach(s => {
    const count = stats.statusBreakdown[s] || 0;
    if (count === 0) return;
    const pct = (count / totalForBar) * 100;
    const color = STATUS_COLORS[s] || '#A8987E';
    statusSegments += `<div class="dash-status-bar-seg" style="width:${pct}%;background:${color}" title="${STATUS_LABELS[s]}: ${count}"></div>`;
    statusLegend += `<div class="dash-status-legend-item"><span class="dash-status-legend-dot" style="background:${color}"></span>${STATUS_LABELS[s]} ${count}</div>`;
  });

  // --- Project health ---
  let projectHealthHtml = '';
  stats.projectBreakdown.forEach(p => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    const activeBadge = p.active > 0 ? `<span class="dash-project-active-badge">${p.active} active</span>` : `<span class="dash-project-active-badge" style="opacity:.4">0 active</span>`;
    projectHealthHtml += `
      <div class="dash-project-bar">
        <div class="dash-project-name"><span class="pdot" style="background:${esc(p.color)}"></span>${esc(p.title)}</div>
        <div class="dash-project-track"><div class="dash-project-fill" style="width:${pct}%;background:${esc(p.color)}"></div></div>
        <div class="dash-project-nums">${p.done}/${p.total} done</div>
        ${activeBadge}
      </div>`;
  });

  // --- Activity heatmap (13 weeks x 7 days) ---
  // Build date-to-count map
  const heatmapMap = {};
  stats.activityHeatmap.forEach(d => heatmapMap[d.date] = d.count);

  // Find the start: go back 90 days, then align to Monday
  const heatmapEnd = new Date();
  const heatmapStart = new Date();
  heatmapStart.setDate(heatmapStart.getDate() - 90);
  // Align to Monday (day 1)
  const startDow = heatmapStart.getDay();
  const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
  heatmapStart.setDate(heatmapStart.getDate() + mondayOffset);

  // Build columns (each column = 1 week)
  const weeks = [];
  const cur = new Date(heatmapStart);
  while (cur <= heatmapEnd) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const ds = cur.toISOString().slice(0, 10);
      const count = heatmapMap[ds] || 0;
      const lvl = count === 0 ? 0 : count <= 1 ? 1 : count <= 2 ? 2 : count <= 4 ? 3 : 4;
      week.push({ date: ds, count, lvl, future: cur > heatmapEnd });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Month labels
  let monthLabels = '';
  let lastMonth = -1;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  weeks.forEach((week, i) => {
    const firstDay = new Date(week[0].date + 'T00:00:00');
    const m = firstDay.getMonth();
    if (m !== lastMonth) {
      monthLabels += `<div class="dash-heatmap-month-label" style="grid-column:${i + 1}">${monthNames[m]}</div>`;
      lastMonth = m;
    }
  });

  // Grid cells
  let heatmapCols = weeks.map(week => {
    const cells = week.map(d => {
      if (d.future) return `<div class="dash-heatmap-cell lvl-0"></div>`;
      return `<div class="dash-heatmap-cell lvl-${d.lvl}" title="${d.date}: ${d.count} completed"></div>`;
    }).join('');
    return `<div class="dash-heatmap-col">${cells}</div>`;
  }).join('');

  const dayLabels = ['Mon','','Wed','','Fri','',''].map(l =>
    `<div class="dash-heatmap-day-label">${l}</div>`
  ).join('');

  // --- Assemble dashboard ---
  $view().innerHTML = `
    <div class="dashboard">
      <div class="dash-greeting">
        <div class="dash-date">${dateStr}</div>
        ${state.commander
          ? `<h1>${greeting}, Commander.</h1><p>${statusMsg}</p>`
          : `<h1>Overview</h1><p>${statusMsg}</p>`}
      </div>

      ${kpiHtml}

      <div class="dash-charts-grid">
        <div class="dash-chart-card">
          <div class="dash-chart-header">Velocity — Last 14 Days (${stats.velocity7d}/day avg)</div>
          <div class="dash-chart-body">
            <div class="dash-velocity-chart">${velocityBars}</div>
          </div>
        </div>

        <div class="dash-chart-card">
          <div class="dash-chart-header">Status Distribution — ${stats.totalTasks} Tasks</div>
          <div class="dash-chart-body">
            <div class="dash-status-bar-wrap">
              <div class="dash-status-bar">${statusSegments}</div>
            </div>
            <div class="dash-status-legend">${statusLegend}</div>
          </div>
        </div>

        <div class="dash-chart-card full-width">
          <div class="dash-chart-header">Project Health</div>
          <div class="dash-chart-body">${projectHealthHtml || '<div class="focus-empty">No projects found</div>'}</div>
        </div>

        <div class="dash-chart-card full-width">
          <div class="dash-chart-header">Activity</div>
          <div class="dash-chart-body">
            <div class="dash-heatmap-wrap">
              <div class="dash-heatmap-days">${dayLabels}</div>
              <div>
                <div class="dash-heatmap-months" style="display:grid;grid-template-columns:repeat(${weeks.length}, 16px)">${monthLabels}</div>
                <div class="dash-heatmap">${heatmapCols}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// --- Kanban ---
function renderKanban() {
  hideCardPreview();
  closeSortMenu();
  const tasks = getFilteredTasks();
  let cols = [...KANBAN_STATUSES];
  if (!state.hideDone) cols.push('done');

  // how many cards are revealed per column (incremental render for big columns)
  state.kanbanShown = state.kanbanShown || {};

  const html = `<div class="kanban">${cols.map(status => {
    const sortKey = state.kanbanSort[status] || 'priority';
    const colTasks = sortColumn(tasks.filter(t => t.status === status), sortKey);
    const PAGE = 25;
    const shown = state.kanbanShown[status] || PAGE;
    const visible = colTasks.slice(0, shown);
    const remaining = colTasks.length - visible.length;
    const moreBtn = remaining > 0
      ? `<button class="kanban-more" data-status="${status}">Show ${Math.min(PAGE, remaining)} more <span class="kanban-more-count">${remaining} hidden</span></button>`
      : '';
    return `
      <div class="kanban-col" data-status="${status}" style="border-top-color:${STATUS_COLORS[status]}">
        <div class="kanban-col-header">
          <span class="kanban-col-dot" style="background:${STATUS_COLORS[status]}"></span>
          ${STATUS_LABELS[status]}
          <span class="kanban-col-count">${colTasks.length}</span>
          <button class="kanban-col-sort ${sortKey !== 'priority' ? 'is-set' : ''}" data-sort-col="${status}" title="Sort: ${sortLabel(sortKey)}" aria-label="Sort column"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h12M3 12h8M3 18h5"/></svg></button>
          ${colTasks.length ? `<button class="kanban-col-copy" data-copy-col="${status}" title="Copy all ${STATUS_LABELS[status]} tasks" aria-label="Copy column"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` : ''}
        </div>
        <div class="kanban-col-cards" data-status="${status}">
          ${colTasks.length ? visible.map(t => renderKanbanCard(t)).join('') + moreBtn : `<div class="kanban-empty"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg><span>${state.commander ? 'All quiet' : 'No tasks'}</span></div>`}
          ${kanbanAddUi(status)}
        </div>
      </div>`;
  }).join('')}</div>`;

  $view().innerHTML = html;
  $view().querySelectorAll('.kanban-more').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.status;
      state.kanbanShown[s] = (state.kanbanShown[s] || 25) + 25;
      renderKanban();
    });
  });
  $view().querySelectorAll('.kanban-col-copy').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copyColumn(btn.dataset.copyCol); });
  });
  $view().querySelectorAll('.kanban-col-sort').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSortMenu(btn, btn.dataset.sortCol); });
  });
  bindKanbanComposer();
  bindKanbanDragDrop();
}

function kanbanAddUi(status) {
  if (state.composerStatus === status) {
    return `
      <div class="kanban-composer" data-status="${status}">
        <textarea class="kanban-composer-input" rows="2" placeholder="Write a task title…"></textarea>
        <div class="kanban-composer-actions">
          <button class="kanban-composer-add" data-status="${status}">Add</button>
          <button class="kanban-composer-cancel" type="button">Cancel</button>
          <span class="kanban-composer-hint">↵ add · ⇧↵ newline · esc</span>
        </div>
      </div>`;
  }
  return `<button class="kanban-add" data-status="${status}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>Add card</button>`;
}

function defaultProjectId() {
  const active = [...state.activeProjects];
  if (active.length) return active[0];
  return Object.keys(state.projects)[0] || null;
}

async function submitComposer(status) {
  const ta = $view().querySelector(`.kanban-composer[data-status="${status}"] .kanban-composer-input`);
  if (!ta) return;
  const title = ta.value.trim();
  if (!title) return;
  const projectId = defaultProjectId();
  if (!projectId) { toast('No project available to add to', true); return; }
  ta.disabled = true;
  try {
    const task = await createTask({ title, projectId, priority: 'medium', due: '', status, body: '' });
    state.tasks.push(task);
    const undo = undoable('Added task', async () => {
      await deleteTask(task.id);
      const i = state.tasks.findIndex(t => t.id === task.id);
      if (i >= 0) state.tasks[i].status = 'cancelled';
      renderAll();
    });
    toast(`Added to ${STATUS_LABELS[status]}`, { undo });
    state.composerStatus = status;   // keep open for rapid entry
    renderAll();
  } catch { ta.disabled = false; }
}

function bindKanbanComposer() {
  $view().querySelectorAll('.kanban-add').forEach(btn => {
    btn.addEventListener('click', () => { state.composerStatus = btn.dataset.status; renderKanban(); });
  });
  const composer = $view().querySelector('.kanban-composer');
  if (composer) {
    const status = composer.dataset.status;
    const ta = composer.querySelector('.kanban-composer-input');
    ta.focus();
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer(status); }
      else if (e.key === 'Escape') { e.preventDefault(); state.composerStatus = null; renderKanban(); }
    });
    composer.querySelector('.kanban-composer-add').addEventListener('click', () => submitComposer(status));
    composer.querySelector('.kanban-composer-cancel').addEventListener('click', () => { state.composerStatus = null; renderKanban(); });
  }
}

// readable text color for a solid badge background
function contrastText(hex) {
  if (!hex) return '#fff';
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // relative luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#2A1F14' : '#FBF6EC';
}

function renderKanbanCard(t) {
  const pColor = t.projectColor || '#A8987E';

  // Project label — solid colored badge with contrast-safe text
  const projectBadge = t.projectName
    ? `<span class="kc-label" style="background:${esc(pColor)};color:${contrastText(pColor)}">${esc(t.projectName)}</span>`
    : '';

  // Priority — secondary tinted pill with a dot (skip medium)
  let priBadge = '';
  if (t.priority && t.priority !== 'medium') {
    const priColors = { critical: '#BC4A2E', high: '#C8862E', low: '#B3A488' };
    const c = priColors[t.priority] || '#97876B';
    priBadge = `<span class="kc-label kc-label-pri" style="background:${c}1F;color:${c}"><span class="kc-pri-dot"></span>${t.priority.toUpperCase()}</span>`;
  }

  const labelsHtml = (projectBadge || priBadge)
    ? `<div class="kc-labels">${projectBadge}${priBadge}</div>` : '';

  // Progress bar (only when meaningful)
  const progressHtml = (typeof t.progress === 'number' && t.progress > 0 && t.progress < 100)
    ? `<div class="kc-progress"><div class="kc-progress-fill" style="width:${Math.min(100, t.progress)}%"></div></div>` : '';

  // Due date with calendar icon
  let dueHtml = '';
  if (t.due) {
    const od = isOverdue(t.due) && t.status !== 'done';
    const dt = isDueToday(t.due);
    const cls = od ? 'kc-due overdue' : dt ? 'kc-due due-today' : 'kc-due';
    dueHtml = `<span class="${cls}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> ${fmtDate(t.due)}</span>`;
  }

  // Dependency indicator
  let depsHtml = '';
  if (t.dependencies && t.dependencies.length) {
    depsHtml = `<span class="kc-deps"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg> ${t.dependencies.length}</span>`;
  }

  // Footer: metadata on the left, an always-present copy button lower-right.
  const footerHtml = `
      <div class="kc-footer">
        <div class="kc-footer-left">${dueHtml}${depsHtml}</div>
        <button class="kc-copy" data-copy-id="${esc(t.id)}" title="Copy card context" aria-label="Copy card context">
          <svg class="kc-copy-default" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <svg class="kc-copy-done" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>`;

  return `
    <div class="kanban-card" draggable="true" data-id="${esc(t.id)}" style="--card-color:${esc(pColor)}">
      <style>.kanban-card[data-id="${esc(t.id)}"]::before{background:${esc(pColor)}}</style>
      ${labelsHtml}
      <div class="kc-title">${esc(t.title)}</div>
      ${progressHtml}
      ${footerHtml}
    </div>`;
}

// --- Copy card / column context (for pasting into agents) ---
function formatTaskForCopy(t) {
  const out = [`# ${t.title || '(untitled)'}`];
  const meta = [];
  if (t.projectName) meta.push(`Project: ${t.projectName}`);
  meta.push(`Status: ${STATUS_LABELS[t.status] || t.status}`);
  if (t.priority) meta.push(`Priority: ${t.priority}`);
  if (t.due) meta.push(`Due: ${t.due}`);
  if (t.start) meta.push(`Start: ${t.start}`);
  if (typeof t.progress === 'number' && t.progress > 0) meta.push(`Progress: ${t.progress}%`);
  if ((t.assignees || []).length) meta.push(`Assignees: ${t.assignees.join(', ')}`);
  if ((t.tags || []).length) meta.push(`Tags: ${t.tags.join(', ')}`);
  if ((t.dependencies || []).length) {
    const names = t.dependencies.map(id => { const d = state.tasks.find(x => x.id === id); return d ? d.title : id; });
    meta.push(`Blocked by: ${names.join('; ')}`);
  }
  out.push(meta.join('\n'));
  if ((t.body || '').trim()) { out.push(''); out.push(t.body.trim()); }
  return out.join('\n');
}

async function copyText(text, msg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); ta.remove();
      toast(msg);
      return true;
    } catch { toast('Copy failed', true); return false; }
  }
}

function copyCard(id, btn) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  copyText(formatTaskForCopy(t), 'Card copied').then(ok => {
    if (ok && btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1100); }
  });
}

function copyColumn(status) {
  const tasks = sortColumn(getFilteredTasks().filter(t => t.status === status), state.kanbanSort[status] || 'priority');
  if (!tasks.length) return;
  const head = `## ${STATUS_LABELS[status]} — ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  const text = head + '\n\n' + tasks.map(formatTaskForCopy).join('\n\n---\n\n');
  copyText(text, `Copied ${tasks.length} ${STATUS_LABELS[status]} task${tasks.length === 1 ? '' : 's'}`);
}

// --- Card hover preview (rendered description on hover) ---
let cardHoverTimer = null, cardPreviewEl = null;
function hideCardPreview() {
  clearTimeout(cardHoverTimer);
  if (cardPreviewEl) cardPreviewEl.style.display = 'none';
}
function showCardPreview(card, task) {
  const body = (task.body || '').trim();
  if (!body) return;
  if (!cardPreviewEl) { cardPreviewEl = document.createElement('div'); cardPreviewEl.className = 'card-preview'; document.body.appendChild(cardPreviewEl); }
  const pop = cardPreviewEl;
  pop.innerHTML = `<div class="card-preview-title">${esc(task.title)}</div><div class="card-preview-body detail-body-rendered">${renderMarkdown(body)}</div>`;
  pop.style.display = 'block';
  const r = card.getBoundingClientRect();
  const w = 340;
  let left = r.right + 10;
  if (left + w > window.innerWidth - 10) left = r.left - w - 10;
  if (left < 10) left = 10;
  let top = r.top;
  const ph = pop.offsetHeight;
  if (top + ph > window.innerHeight - 10) top = Math.max(10, window.innerHeight - ph - 10);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function bindKanbanDragDrop() {
  const cards = document.querySelectorAll('.kanban-card');
  const cols = document.querySelectorAll('.kanban-col-cards');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      state.dragTaskId = card.dataset.id;
      card.classList.add('dragging');
      hideCardPreview();
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      state.dragTaskId = null;
      document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
    });
    const copyBtn = card.querySelector('.kc-copy');
    if (copyBtn) copyBtn.addEventListener('click', (e) => { e.stopPropagation(); hideCardPreview(); copyCard(copyBtn.dataset.copyId, copyBtn); });
    card.addEventListener('click', () => { hideCardPreview(); openDetail(card.dataset.id); });
    card.addEventListener('mouseenter', () => {
      clearTimeout(cardHoverTimer);
      const t = state.tasks.find(x => x.id === card.dataset.id);
      if (t) cardHoverTimer = setTimeout(() => showCardPreview(card, t), 450);
    });
    card.addEventListener('mouseleave', hideCardPreview);
  });

  cols.forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.closest('.kanban-col').classList.add('drag-over');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.closest('.kanban-col').classList.remove('drag-over');
      }
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.closest('.kanban-col').classList.remove('drag-over');
      const taskId = state.dragTaskId;
      const newStatus = col.dataset.status;
      if (!taskId || !newStatus) return;

      const task = state.tasks.find(t => t.id === taskId);
      if (!task || task.status === newStatus) return;

      const oldStatus = task.status;
      task.status = newStatus;
      renderKanban();

      try {
        await patchTask(taskId, { status: newStatus });
        const undo = undoable(`Moved to ${STATUS_LABELS[newStatus]}`, async () => {
          task.status = oldStatus;
          await patchTask(taskId, { status: oldStatus });
          renderAll();
        });
        toast(`Moved to ${STATUS_LABELS[newStatus]}`, { undo });
      } catch {
        task.status = oldStatus;
        renderKanban();
      }
    });
  });
}

// --- Table ---
function renderTable() {
  const tasks = sortTasks(getFilteredTasks(), state.sortCol, state.sortAsc);

  const arrow = (col) => {
    if (state.sortCol !== col) return '';
    return `<span class="sort-arrow">${state.sortAsc ? '▲' : '▼'}</span>`;
  };

  const html = `
    <div class="table-wrap">
      <table class="task-table">
        <thead>
          <tr>
            <th data-col="project">Project ${arrow('project')}</th>
            <th data-col="title">Title ${arrow('title')}</th>
            <th data-col="status">Status ${arrow('status')}</th>
            <th data-col="priority">Priority ${arrow('priority')}</th>
            <th data-col="due">Due ${arrow('due')}</th>
            <th data-col="assignees">Assignees ${arrow('assignees')}</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map(t => {
            const pColor = t.projectColor || '#A8987E';
            const statusBg = STATUS_COLORS[t.status] + '18';
            const statusColor = STATUS_COLORS[t.status];
            const prioColor = t.priority === 'critical' ? 'var(--priority-critical)'
              : t.priority === 'high' ? 'var(--priority-high)'
              : t.priority === 'low' ? 'var(--priority-low)'
              : 'var(--text-secondary)';
            let dueHtml = '';
            if (t.due) {
              let cls = '';
              if (isOverdue(t.due) && t.status !== 'done') cls = ' style="color:#dc2626;font-weight:600"';
              else if (isDueToday(t.due)) cls = ' style="color:#C8862E;font-weight:600"';
              dueHtml = `<span${cls}>${fmtDate(t.due)}</span>`;
            }
            return `
              <tr data-id="${esc(t.id)}" style="--row-project-color:${esc(pColor)}">
                <td><div class="table-project-cell"><span class="pdot" style="background:${esc(pColor)}"></span>${esc(t.projectName || '')}</div></td>
                <td>${esc(t.title)}</td>
                <td><span class="table-status-badge" style="background:${statusBg};color:${statusColor}"><span class="dot" style="background:${statusColor};width:6px;height:6px;border-radius:50%;display:inline-block"></span> ${STATUS_LABELS[t.status] || t.status}</span></td>
                <td><span class="table-priority-tag" style="color:${prioColor}">${t.priority || 'medium'}</span></td>
                <td>${dueHtml}</td>
                <td>${esc((t.assignees || []).join(', '))}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${tasks.length === 0 ? '<div class="empty-state">No tasks match current filters</div>' : ''}
    </div>`;

  $view().innerHTML = html;

  // Sort headers
  document.querySelectorAll('.task-table th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) state.sortAsc = !state.sortAsc;
      else { state.sortCol = col; state.sortAsc = true; }
      renderTable();
    });
  });

  // Row click
  document.querySelectorAll('.task-table tbody tr').forEach(tr => {
    tr.addEventListener('click', () => openDetail(tr.dataset.id));
  });
}

// --- Timeline ---
function renderTimeline() {
  const tasks = getFilteredTasks().filter(t => t.due || t.start);
  if (tasks.length === 0) {
    $view().innerHTML = '<div class="empty-state">No tasks with dates to display on timeline</div>';
    return;
  }

  // Compute date range
  let minDate = today();
  let maxDate = today();
  tasks.forEach(t => {
    const s = t.start || t.due;
    const e = t.due || t.start;
    if (s && s < minDate) minDate = s;
    if (e && e > maxDate) maxDate = e;
  });

  // Pad range
  const padStart = new Date(minDate + 'T00:00:00');
  padStart.setDate(padStart.getDate() - 3);
  const padEnd = new Date(maxDate + 'T00:00:00');
  padEnd.setDate(padEnd.getDate() + 7);

  const days = [];
  const cur = new Date(padStart);
  while (cur <= padEnd) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const todayStr = today();
  const dayToIdx = {};
  days.forEach((d, i) => dayToIdx[d.toISOString().slice(0, 10)] = i);

  // Group by project
  const groups = {};
  tasks.forEach(t => {
    const pid = t.projectId || 'none';
    if (!groups[pid]) groups[pid] = { project: state.projects[pid] || { title: 'Other', color: '#A8987E' }, tasks: [] };
    groups[pid].tasks.push(t);
  });

  // Render header
  const headerCells = days.map(d => {
    const ds = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    let cls = '';
    if (ds === todayStr) cls = ' today';
    else if (dow === 0 || dow === 6) cls = ' weekend';
    return `<div class="timeline-day-header${cls}">
      <span class="day-num">${d.getDate()}</span>
      <span class="day-name">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]}</span>
    </div>`;
  }).join('');

  let rows = '';
  Object.values(groups).forEach(g => {
    // Group header
    rows += `<div class="timeline-group-row" style="--group-color:${esc(g.project.color)}">
      <div class="timeline-group-label"><span class="pdot" style="background:${esc(g.project.color)}"></span>${esc(g.project.title)}</div>
      ${days.map(d => {
        const ds = d.toISOString().slice(0, 10);
        const dow = d.getDay();
        let cls = '';
        if (ds === todayStr) cls = ' today';
        else if (dow === 0 || dow === 6) cls = ' weekend';
        return `<div class="timeline-day-cell${cls}"></div>`;
      }).join('')}
    </div>`;

    g.tasks.forEach(t => {
      const start = t.start || t.due;
      const end = t.due || t.start;
      const startIdx = dayToIdx[start] ?? 0;
      const endIdx = dayToIdx[end] ?? startIdx;
      const left = startIdx * 34;
      const width = Math.max((endIdx - startIdx + 1) * 34 - 4, 6);
      const barColor = (isOverdue(t.due) && t.status !== 'done') ? '#C0553A' : (g.project.color || '#B5613A');
      const overdueCls = (isOverdue(t.due) && t.status !== 'done') ? ' overdue' : '';

      rows += `<div class="timeline-row" data-id="${esc(t.id)}">
        <div class="timeline-row-label" data-id="${esc(t.id)}"><span class="pdot" style="background:${esc(g.project.color)}"></span><span>${esc(t.title)}</span></div>
        ${days.map(d => {
          const ds = d.toISOString().slice(0, 10);
          const dow = d.getDay();
          let cls = '';
          if (ds === todayStr) cls = ' today';
          else if (dow === 0 || dow === 6) cls = ' weekend';
          return `<div class="timeline-day-cell${cls}"></div>`;
        }).join('')}
        <div class="timeline-bar${overdueCls}" style="left:${220 + left}px;width:${width}px;background:${barColor}"></div>
      </div>`;
    });
  });

  $view().innerHTML = `
    <div class="timeline-container">
      <div class="timeline-grid">
        <div class="timeline-header-row">
          <div class="timeline-label-col">Task</div>
          ${headerCells}
        </div>
        ${rows}
      </div>
    </div>`;

  // Click handlers
  document.querySelectorAll('.timeline-row-label').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

// --- Focus ---
function renderFocus() {
  const tasks = getFilteredTasks();
  const todayStr = today();

  const urgent = tasks.filter(t => t.due && t.due <= todayStr && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'deferred');
  const active = tasks.filter(t => t.status === 'active');
  const blocked = tasks.filter(t => t.status === 'blocked');
  const nextUp = tasks.filter(t => t.status === 'todo' && (t.priority === 'high' || t.priority === 'critical'));

  // Work streams - group remaining todos by domain tag
  const streamTasks = tasks.filter(t => t.status === 'todo' || t.status === 'active' || t.status === 'review');
  const streams = {};
  streamTasks.forEach(t => {
    const domainTag = (t.tags || []).find(tag => tag.startsWith('project/'));
    const domain = domainTag ? domainTag.split('/').slice(0, 3).join('/') : 'other';
    if (!streams[domain]) streams[domain] = [];
    streams[domain].push(t);
  });

  const renderList = (items, emptyMsg = 'Nothing here') => {
    if (items.length === 0) return `<div class="focus-empty">${emptyMsg}</div>`;
    return items.map(t => {
      const pColor = t.projectColor || '#A8987E';
      let meta = '';
      if (t.due) {
        let cls = 'badge-due';
        if (isOverdue(t.due) && t.status !== 'done') cls += ' overdue';
        else if (isDueToday(t.due)) cls += ' due-today';
        meta += `<span class="badge ${cls}">${fmtDate(t.due)}</span>`;
      }
      if (t.priority && t.priority !== 'medium') {
        meta += `<span class="badge badge-priority-${t.priority}">${t.priority}</span>`;
      }
      return `<div class="focus-task" data-id="${esc(t.id)}">
        <span class="pdot" style="background:${esc(pColor)}"></span>
        <span class="focus-task-title">${esc(t.title)}</span>
        <div class="focus-task-meta">${meta}</div>
      </div>`;
    }).join('');
  };

  let streamsHtml = '';
  const streamColors = ['#B5613A','#C8862E','#5E8AA0','#7E9A5C','#9C6B4F','#C0553A','#A8862E','#6E8A8F'];
  let streamIdx = 0;
  Object.entries(streams).sort((a, b) => a[0].localeCompare(b[0])).forEach(([domain, items]) => {
    const sColor = streamColors[streamIdx % streamColors.length];
    streamIdx++;
    streamsHtml += `
      <div class="focus-stream-group">
        <div class="focus-stream-header" style="--stream-color:${sColor}"><span class="focus-stream-badge" style="background:${sColor}20;color:${sColor}">${domain.charAt(0).toUpperCase()}</span>${esc(domain)} <span style="color:var(--text-secondary);font-weight:400">(${items.length})</span></div>
        ${renderList(items)}
      </div>`;
  });

  $view().innerHTML = `
    <div class="focus-grid">
      <div class="focus-section full-width">
        <div class="focus-section-header" style="color:#dc2626">
          <span class="dot" style="background:#dc2626"></span>
          Due Today / Overdue
          <span class="count">${urgent.length}</span>
        </div>
        ${renderList(urgent, state.commander ? "Nothing due. You're ahead of schedule." : "No tasks due")}
      </div>
      <div class="focus-section">
        <div class="focus-section-header" style="color:#5E8AA0">
          <span class="dot" style="background:#5E8AA0"></span>
          Active Work
          <span class="count">${active.length}</span>
        </div>
        ${renderList(active, state.commander ? 'All quiet on the front. Pick a task to activate.' : 'No active tasks')}
      </div>
      <div class="focus-section">
        <div class="focus-section-header" style="color:#C0553A">
          <span class="dot" style="background:#C0553A"></span>
          Blocked
          <span class="count">${blocked.length}</span>
        </div>
        ${renderList(blocked, state.commander ? 'No blockers. Smooth sailing.' : 'No blocked tasks')}
      </div>
      <div class="focus-section full-width">
        <div class="focus-section-header" style="color:#C8862E">
          <span class="dot" style="background:#C8862E"></span>
          Next Up — High Priority
          <span class="count">${nextUp.length}</span>
        </div>
        ${renderList(nextUp, state.commander ? 'No high-priority items queued.' : 'No high-priority items')}
      </div>
      <div class="focus-section full-width">
        <div class="focus-section-header" style="color:var(--text-secondary)">
          <span class="dot" style="background:#B5613A"></span>
          Work Streams
        </div>
        ${streamsHtml || '<div class="focus-empty">No active work streams</div>'}
      </div>
    </div>`;

  // Click handlers
  document.querySelectorAll('.focus-task').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

// --- Detail Panel ---
let detailDebounce = null;

async function openDetail(taskId) {
  state.selectedTaskId = taskId;
  let task = state.tasks.find(t => t.id === taskId);

  // Fetch full task for body
  try {
    const full = await api(`/api/tasks/${taskId}`);
    const idx = state.tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) state.tasks[idx] = { ...state.tasks[idx], ...full };
    task = state.tasks.find(t => t.id === taskId);
  } catch {}

  if (!task) return;
  populateDetail(task);

  document.getElementById('detail-backdrop').classList.add('open');
  document.getElementById('detail-panel').classList.add('open');
}

// --- Wikilink resolution (Obsidian-native navigation) ---
function slugify(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

function resolveWikilink(target) {
  const raw = (target || '').trim();
  const base = raw.split('/').pop();          // strip folder path (e.g. meetings/foo)
  const lc = base.toLowerCase();
  const slug = slugify(base);
  const task = state.tasks.find(t => {
    if (t.id === base || t.id === raw) return true;
    if ((t.title || '').toLowerCase() === lc) return true;
    const fn = (t.filePath || '').split('/').pop().replace(/\.md$/, '').toLowerCase();
    if (fn && (fn === lc || fn.replace(/-[a-z0-9]{6,}$/, '') === slug)) return true;
    if (slug && slugify(t.title) === slug) return true;
    return false;
  });
  if (task) return { type: 'task', task };
  const proj = Object.values(state.projects).find(p =>
    (p.title || '').toLowerCase() === lc || p.id === base || slugify(p.title) === slug);
  if (proj) return { type: 'project', project: proj };
  return { type: 'note', target: raw };
}

function openWikilink(target) {
  const r = resolveWikilink(target);
  if (r.type === 'task') {
    openDetail(r.task.id);
  } else if (r.type === 'project') {
    closeDetail();
    state.activeProjects = new Set([r.project.id]);
    state.currentView = 'kanban';
    syncFilterChecks(); savePrefs(); renderAll();
    toast(`Filtered to ${r.project.title}`);
  } else if (state.vaultName) {
    // Not a task or project — hand off to Obsidian.
    window.open(`obsidian://open?vault=${encodeURIComponent(state.vaultName)}&file=${encodeURIComponent(r.target)}`, '_blank');
  } else {
    toast(`"${r.target}" is a vault note — open it in Obsidian`);
  }
}

// Compact, self-contained markdown → HTML (no external deps). Escapes first.
function renderMarkdown(src) {
  if (!src || !src.trim()) return '<span class="md-empty">No description yet — click to add one.</span>';
  const escH = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // pull fenced code blocks out first
  const blocks = [];
  src = src.replace(/```[^\n]*\n?([\s\S]*?)```/g, (m, code) => { blocks.push(code.replace(/\n$/, '')); return ` C${blocks.length - 1} `; });

  const inline = (t) => {
    t = escH(t);
    t = t.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // links before wikilinks; restrict scheme to http(s)
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, tg, lb) => `<span class="md-wikilink" data-wikilink="${tg.trim()}">${lb}</span>`);
    t = t.replace(/\[\[([^\]]+)\]\]/g, (m, tg) => `<span class="md-wikilink" data-wikilink="${tg.trim()}">${tg}</span>`);
    return t;
  };

  let html = '', para = [], listType = null;
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };

  for (const raw of src.split('\n')) {
    const cm = raw.match(/^ C(\d+) $/);
    if (cm) { flushPara(); closeList(); html += `<pre><code>${escH(blocks[+cm[1]])}</code></pre>`; continue; }
    if (/^\s*$/.test(raw)) { flushPara(); closeList(); continue; }
    let m;
    if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); closeList(); const l = m[1].length; html += `<h${l}>${inline(m[2])}</h${l}>`; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) { flushPara(); closeList(); html += '<hr>'; continue; }
    if (/^\s*[-*]\s+/.test(raw)) { flushPara(); if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += `<li>${inline(raw.replace(/^\s*[-*]\s+/, ''))}</li>`; continue; }
    if (/^\s*\d+\.\s+/.test(raw)) { flushPara(); if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += `<li>${inline(raw.replace(/^\s*\d+\.\s+/, ''))}</li>`; continue; }
    if (/^\s*>\s?/.test(raw)) { flushPara(); closeList(); html += `<blockquote>${inline(raw.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
    para.push(raw.trim());
  }
  flushPara(); closeList();
  return html;
}

function populateDetail(task) {
  const projectOptions = Object.values(state.projects).map(p =>
    `<option value="${esc(p.id)}" ${p.id === task.projectId ? 'selected' : ''}>${esc(p.title)}</option>`
  ).join('');

  const statusOptions = Object.entries(STATUS_LABELS).map(([val, label]) =>
    `<option value="${val}" ${val === task.status ? 'selected' : ''}>${label}</option>`
  ).join('');

  const priorityOptions = ['critical', 'high', 'medium', 'low'].map(p =>
    `<option value="${p}" ${p === task.priority ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`
  ).join('');

  const tags = (task.tags || []).map(t => `<span class="detail-tag">${esc(t)}</span>`).join('');
  const progress = task.progress || 0;

  // Dependency navigation — "Blocked by" (forward) + "Blocking" (reverse), clickable
  const depRow = (t) => `<div class="detail-dep-item link" data-goto="${esc(t.id)}"><span class="dep-dot" style="background:${STATUS_COLORS[t.status] || '#A8987E'}"></span><span class="dep-title">${esc(t.title || '(untitled)')}</span><span class="dep-status">${STATUS_LABELS[t.status] || ''}</span></div>`;
  const blockedBy = (task.dependencies || []).map(id => {
    const dt = state.tasks.find(t => t.id === id);
    return dt ? depRow(dt) : `<div class="detail-dep-item"><span class="dep-dot" style="background:var(--text-muted)"></span><span class="dep-title">${esc(id)}</span></div>`;
  }).join('');
  const blocking = state.tasks.filter(t => (t.dependencies || []).includes(task.id)).map(depRow).join('');
  const depsSection = (blockedBy || blocking) ? `
    <div class="detail-section-divider"></div>
    ${blockedBy ? `<div class="detail-deps"><div class="detail-deps-title">Blocked by</div>${blockedBy}</div>` : ''}
    ${blocking ? `<div class="detail-deps"><div class="detail-deps-title">Blocking</div>${blocking}</div>` : ''}` : '';

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-status-stripe" style="background:${STATUS_COLORS[task.status] || '#A8987E'}"></div>
    <input class="detail-title-input" id="detail-title" value="${esc(task.title)}" placeholder="Task title">

    <div class="detail-fields">
      <div class="detail-field">
        <span class="detail-field-label">Status</span>
        <select id="detail-status">${statusOptions}</select>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Priority</span>
        <select id="detail-priority">${priorityOptions}</select>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Project</span>
        <select id="detail-project" disabled>${projectOptions}</select>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Due</span>
        <input type="date" id="detail-due" value="${task.due || ''}">
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Start</span>
        <input type="date" id="detail-start" value="${task.start || ''}">
      </div>
      <div class="detail-field">
        <span class="detail-field-label">Assignees</span>
        <input type="text" id="detail-assignees" value="${esc((task.assignees || []).join(', '))}" placeholder="e.g. dan, sarah">
      </div>
      <div class="detail-field full">
        <span class="detail-field-label">Progress</span>
        <div class="detail-progress-bar">
          <div class="detail-progress-track"><div class="detail-progress-fill" style="width:${progress}%"></div></div>
          <input type="number" id="detail-progress" value="${progress}" min="0" max="100" style="width:55px">
          <span class="detail-progress-val">%</span>
        </div>
      </div>
      ${tags ? `<div class="detail-field full"><span class="detail-field-label">Tags</span><div class="detail-tags">${tags}</div></div>` : ''}
    </div>

    <div class="detail-section-divider"></div>

    <div class="detail-body-label">Description</div>
    <div class="detail-body" id="detail-body-wrap">
      <div class="detail-body-rendered" id="detail-body-rendered">${renderMarkdown(task.body || '')}</div>
      <textarea class="detail-body-textarea" id="detail-body" placeholder="Add notes… (markdown supported)">${esc(task.body || '')}</textarea>
    </div>

    ${depsSection}

    <div class="detail-actions">
      <button class="btn-success" id="detail-mark-done"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${task.status === 'done' ? 'Already Done' : 'Mark Done'}</button>
      <button class="btn-danger" id="detail-delete">Delete</button>
    </div>
  `;

  // Bind field changes
  const fields = ['detail-title', 'detail-status', 'detail-priority', 'detail-due', 'detail-start', 'detail-assignees', 'detail-progress', 'detail-body'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => scheduleDetailSave());
    el.addEventListener('change', () => scheduleDetailSave());
  });

  // Description: rendered markdown preview <-> raw editor
  const bodyWrap = document.getElementById('detail-body-wrap');
  const bodyRendered = document.getElementById('detail-body-rendered');
  const bodyTextarea = document.getElementById('detail-body');
  if (bodyWrap && bodyRendered && bodyTextarea) {
    bodyRendered.addEventListener('click', (e) => {
      const wl = e.target.closest('.md-wikilink');
      if (wl) { e.stopPropagation(); openWikilink(wl.dataset.wikilink); return; }
      bodyWrap.classList.add('editing');
      bodyTextarea.focus();
      const v = bodyTextarea.value; bodyTextarea.value = ''; bodyTextarea.value = v; // caret to end
    });
    bodyTextarea.addEventListener('blur', () => {
      bodyRendered.innerHTML = renderMarkdown(bodyTextarea.value);
      bodyWrap.classList.remove('editing');
    });
  }

  // Progress slider sync
  const progInput = document.getElementById('detail-progress');
  if (progInput) {
    progInput.addEventListener('input', () => {
      const val = Math.min(100, Math.max(0, parseInt(progInput.value) || 0));
      document.querySelector('.detail-progress-fill').style.width = val + '%';
    });
  }

  // Mark done
  document.getElementById('detail-mark-done').addEventListener('click', async () => {
    if (task.status === 'done') return;
    const prevStatus = task.status, prevProgress = task.progress;
    try {
      await patchTask(task.id, { status: 'done', progress: 100 });
      task.status = 'done';
      task.progress = 100;
      const undo = undoable('Marked done', async () => {
        task.status = prevStatus; task.progress = prevProgress;
        await patchTask(task.id, { status: prevStatus, progress: prevProgress });
        renderAll();
      });
      toast('Task marked as done', { undo });
      renderAll();
      closeDetail();
    } catch {}
  });

  // Delete (soft — sets cancelled)
  document.getElementById('detail-delete').addEventListener('click', async () => {
    if (!confirm('Cancel this task?')) return;
    const prevStatus = task.status;
    try {
      await deleteTask(task.id);
      task.status = 'cancelled';
      const undo = undoable('Cancelled task', async () => {
        task.status = prevStatus;
        await patchTask(task.id, { status: prevStatus });
        renderAll();
      });
      toast('Task cancelled', { undo });
      renderAll();
      closeDetail();
    } catch {}
  });
}

function scheduleDetailSave() {
  clearTimeout(detailDebounce);
  detailDebounce = setTimeout(() => saveDetail(), 500);
}

async function saveDetail() {
  detailDebounce = null;   // this scheduled save is now running
  const taskId = state.selectedTaskId;
  if (!taskId) return;

  // The detail form for this task must actually be mounted. If it isn't (e.g. a
  // re-render is mid-flight), bail rather than reading blank fields and writing
  // them back — this is what previously wiped a title/body to empty.
  const titleEl = document.getElementById('detail-title');
  const bodyEl = document.getElementById('detail-body');
  if (!titleEl || !bodyEl) return;

  const title = titleEl.value.trim();
  const status = document.getElementById('detail-status')?.value;
  const priority = document.getElementById('detail-priority')?.value;
  const due = document.getElementById('detail-due')?.value || '';
  const start = document.getElementById('detail-start')?.value || '';
  const assigneesStr = document.getElementById('detail-assignees')?.value || '';
  const assignees = assigneesStr.split(',').map(s => s.trim()).filter(Boolean);
  const progress = parseInt(document.getElementById('detail-progress')?.value) || 0;
  const body = bodyEl.value;

  const fields = { status, priority, due, start, assignees, progress, body };
  // Never overwrite a title with empty — a blank title means the form was in a
  // transient state, not that the user wants no title.
  if (title) fields.title = title;

  try {
    const updated = await patchTask(taskId, fields);
    // Merge back
    const idx = state.tasks.findIndex(t => t.id === taskId);
    if (idx >= 0) state.tasks[idx] = { ...state.tasks[idx], ...updated };
    renderAll();
  } catch {}
}

function closeDetail() {
  state.selectedTaskId = null;
  clearTimeout(detailDebounce);
  document.getElementById('detail-backdrop').classList.remove('open');
  document.getElementById('detail-panel').classList.remove('open');
}

// --- Create Task Modal ---
function openCreateModal() {
  // Can't create a task without a project — bootstrap one first.
  if (Object.keys(state.projects).length === 0) {
    toast('Create a project first');
    openProjectModal();
    return;
  }
  const projSelect = document.getElementById('create-project');
  projSelect.innerHTML = Object.values(state.projects).map(p =>
    `<option value="${esc(p.id)}">${esc(p.title)}</option>`
  ).join('');

  document.getElementById('create-title').value = '';
  document.getElementById('create-priority').value = 'medium';
  document.getElementById('create-due').value = '';
  document.getElementById('create-status').value = 'todo';
  document.getElementById('create-body').value = '';

  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('create-modal').classList.add('open');
  setTimeout(() => document.getElementById('create-title').focus(), 100);
}

function closeCreateModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById('create-modal').classList.remove('open');
}

async function handleCreateSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('create-title').value.trim();
  const projectId = document.getElementById('create-project').value;
  const priority = document.getElementById('create-priority').value;
  const due = document.getElementById('create-due').value || '';
  const status = document.getElementById('create-status').value;
  const body = document.getElementById('create-body').value || '';

  if (!title) { toast('Title is required', true); return; }
  if (!projectId) { toast('Select a project', true); return; }

  try {
    const task = await createTask({ title, projectId, priority, due, status, body });
    state.tasks.push(task);
    toast('Task created');
    renderAll();
    closeCreateModal();
  } catch {}
}

// --- Create Project Modal ---
function openProjectModal() {
  document.getElementById('project-title').value = '';
  document.getElementById('project-color').value = '#8b7cf7';
  document.getElementById('project-desc').value = '';
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('project-modal').classList.add('open');
  setTimeout(() => document.getElementById('project-title').focus(), 100);
}

function closeProjectModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById('project-modal').classList.remove('open');
}

async function handleProjectSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('project-title').value.trim();
  const color = document.getElementById('project-color').value || '#8b7cf7';
  const description = document.getElementById('project-desc').value || '';

  if (!title) { toast('Name is required', true); return; }

  try {
    const proj = await createProject({ title, color, description });
    state.projects[proj.id] = proj;
    state.activeProjects.add(proj.id);
    savePrefs();
    toast('Project created');
    renderAll();
    closeProjectModal();
  } catch {}
}

// --- First-run onboarding ---
async function showOnboarding() {
  const overlay = document.getElementById('onboarding');
  overlay.classList.add('open');
  const list = document.getElementById('onboarding-candidates');
  list.innerHTML = '<div class="onboarding-hint">Looking for your vaults…</div>';
  let candidates = [];
  try { const r = await api('/api/vault/candidates'); candidates = r.candidates || []; } catch {}
  if (!candidates.length) { list.innerHTML = ''; return; }
  list.innerHTML = candidates.map(c => `
    <button class="onboarding-candidate" data-path="${esc(c.path)}">
      <span class="onboarding-candidate-meta">
        <span class="onboarding-candidate-name">${esc(c.name)}</span>
        <span class="onboarding-candidate-path">${esc(c.path)}</span>
      </span>
      <span class="onboarding-badge ${c.hasProjects ? 'ready' : 'new'}">${c.hasProjects ? 'Ready' : 'New'}</span>
    </button>`).join('');
}

async function submitVault(p) {
  const folder = (p || '').trim();
  if (!folder) { toast('Enter a folder path', true); return; }
  state._connectingVault = true;
  try {
    const r = await api('/api/vault', { method: 'POST', body: { path: folder } });
    state.projects = {};
    (r.projects || []).forEach(x => state.projects[x.id] = x);
    state.activeProjects = new Set(Object.keys(state.projects));
    state.tasks = r.tasks || [];
    state.vaultName = r.vaultName || '';
    state.vaultPath = r.vaultPath || '';
    const o = document.getElementById('onboarding');
    o.classList.remove('open', 'dismissable');
    renderAll();
    mountSavedViews();
    toast('Vault connected');
  } catch {
    state._connectingVault = false;
  }
}

// Reopen the picker as a dismissable overlay (from Settings → Switch vault).
function openVaultSwitcher() {
  document.getElementById('onboarding').classList.add('dismissable');
  showOnboarding();
}

function bindOnboardingEvents() {
  const connect = document.getElementById('onboarding-connect');
  const input = document.getElementById('onboarding-path');
  const browse = document.getElementById('onboarding-browse');
  if (connect) connect.addEventListener('click', () => submitVault(input.value));
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitVault(input.value); });
  if (browse) browse.addEventListener('click', () => {
    const panel = document.getElementById('onboarding-browser');
    if (panel.classList.contains('open')) { panel.classList.remove('open'); panel.innerHTML = ''; }
    else { openBrowser(input.value && input.value.trim() ? input.value.trim() : null); }
  });
  const list = document.getElementById('onboarding-candidates');
  if (list) list.addEventListener('click', (e) => {
    const card = e.target.closest('.onboarding-candidate');
    if (card) submitVault(card.dataset.path);
  });
  const browser = document.getElementById('onboarding-browser');
  if (browser) browser.addEventListener('click', (e) => {
    if (e.target.closest('#onboarding-browser-use')) { submitVault(state._browsePath); return; }
    const nav = e.target.closest('[data-browse]');
    if (nav) openBrowser(nav.dataset.browse);
  });
  const close = document.getElementById('onboarding-close');
  if (close) close.addEventListener('click', () => {
    document.getElementById('onboarding').classList.remove('open', 'dismissable');
  });
}

// Server-side folder navigator (the browser can't return a real path).
async function openBrowser(startPath) {
  const panel = document.getElementById('onboarding-browser');
  const input = document.getElementById('onboarding-path');
  panel.classList.add('open');
  panel.innerHTML = '<div class="onboarding-hint" style="padding:12px">Loading…</div>';
  let data;
  try {
    const q = startPath ? ('?path=' + encodeURIComponent(startPath)) : '';
    data = await api('/api/browse' + q);
  } catch { panel.innerHTML = '<div class="onboarding-hint" style="padding:12px">Could not open that folder.</div>'; return; }

  state._browsePath = data.path;
  if (input) input.value = data.path;

  const folderIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const up = data.parent
    ? `<button class="onboarding-browser-up" data-browse="${esc(data.parent)}">↑ Up</button>`
    : '<span></span>';
  const rows = (data.entries || []).map((e) => `
    <button class="onboarding-browser-row" data-browse="${esc(e.path)}">
      ${folderIcon}
      <span class="obrow-name">${esc(e.name)}</span>
      ${e.hasProjects ? '<span class="onboarding-badge ready">Vault</span>' : ''}
    </button>`).join('') || '<div class="onboarding-hint" style="padding:12px">No subfolders here.</div>';

  panel.innerHTML = `
    <div class="onboarding-browser-head">
      ${up}
      <span class="onboarding-browser-path" title="${esc(data.path)}">${esc(data.path)}</span>
    </div>
    <div class="onboarding-browser-list">${rows}</div>
    <div class="onboarding-browser-foot">
      <span class="onboarding-hint">Use the folder shown above</span>
      <button class="btn-primary" id="onboarding-browser-use" type="button">Use this folder</button>
    </div>`;
}

// --- Filter checkbox sync (shared by palette / saved views) ---
function syncFilterChecks() {
  const d = document.getElementById('filter-done'); if (d) d.checked = !state.hideDone;
  const f = document.getElementById('filter-deferred'); if (f) f.checked = !state.hideDeferred;
  const c = document.getElementById('filter-cancelled'); if (c) c.checked = !state.hideCancelled;
}

// ============================================================
// COMMAND PALETTE (⌘K)
// ============================================================
function paletteCommands() {
  const cmds = [];
  [['dashboard','Dashboard'],['kanban','Kanban'],['table','Table'],['timeline','Timeline'],['focus','Focus'],['settings','Settings']]
    .forEach(([v,l]) => cmds.push({ section:'Go to', label:l, run:() => { state.currentView=v; savePrefs(); renderView(); } }));
  cmds.push({ section:'Create', label:'New task…', run:() => openCreateModal() });
  [['light','Light'],['dark','Dark'],['system','System']]
    .forEach(([m,l]) => cmds.push({ section:'Appearance', label:`${l} mode`, run:() => { state.mode=m; applyTheme(); savePrefs(); if(state.currentView==='settings') renderSettings(); } }));
  THEMES.forEach(t => cmds.push({ section:'Theme', label:`${t.name} theme`, run:() => { state.themeName=t.id; applyTheme(); savePrefs(); if(state.currentView==='settings') renderSettings(); } }));
  cmds.push({ section:'Mode', label:`${state.commander?'Disable':'Enable'} Commander mode`, run:() => { state.commander=!state.commander; applyTheme(); savePrefs(); renderAll(); } });
  cmds.push({ section:'Filter', label:`${state.hideDone?'Show':'Hide'} done tasks`, run:() => { state.hideDone=!state.hideDone; syncFilterChecks(); savePrefs(); renderAll(); } });
  cmds.push({ section:'Filter', label:`${state.hideDeferred?'Show':'Hide'} deferred tasks`, run:() => { state.hideDeferred=!state.hideDeferred; syncFilterChecks(); savePrefs(); renderAll(); } });
  cmds.push({ section:'Filter', label:`${state.hideCancelled?'Show':'Hide'} cancelled tasks`, run:() => { state.hideCancelled=!state.hideCancelled; syncFilterChecks(); savePrefs(); renderAll(); } });
  return cmds;
}

function ensurePalette() {
  if (document.getElementById('palette')) return;
  const bd = document.createElement('div');
  bd.className = 'palette-backdrop'; bd.id = 'palette-backdrop';
  bd.addEventListener('click', closePalette);
  const p = document.createElement('div');
  p.className = 'palette'; p.id = 'palette';
  p.innerHTML = `
    <input class="palette-input" id="palette-input" type="text" placeholder="Type a command or search tasks…" autocomplete="off">
    <div class="palette-results" id="palette-results"></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span></div>`;
  document.body.appendChild(bd);
  document.body.appendChild(p);
  const input = p.querySelector('#palette-input');
  input.addEventListener('input', () => renderPalette(input.value));
  input.addEventListener('keydown', paletteKeydown);
  p.querySelector('#palette-results').addEventListener('click', (e) => {
    const row = e.target.closest('.palette-row'); if (!row) return;
    runPaletteItem(parseInt(row.dataset.idx));
  });
}

function openPalette() {
  ensurePalette();
  state.paletteIndex = 0;
  document.getElementById('palette-backdrop').classList.add('open');
  document.getElementById('palette').classList.add('open');
  const input = document.getElementById('palette-input');
  input.value = '';
  renderPalette('');
  setTimeout(() => input.focus(), 20);
}

function closePalette() {
  const p = document.getElementById('palette'); if (!p) return;
  p.classList.remove('open');
  document.getElementById('palette-backdrop').classList.remove('open');
}

function paletteIsOpen() {
  const p = document.getElementById('palette');
  return p && p.classList.contains('open');
}

function renderPalette(query) {
  const q = query.trim().toLowerCase();
  let items = paletteCommands().filter(c => !q || (c.label + ' ' + c.section).toLowerCase().includes(q));
  if (q) {
    const matches = state.tasks
      .filter(t => t.status !== 'cancelled' && t.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map(t => ({ section:'Task', label:t.title, hint:t.projectName || '', run:() => openDetail(t.id) }));
    items = items.concat(matches);
  }
  state.paletteItems = items;
  if (state.paletteIndex >= items.length) state.paletteIndex = Math.max(0, items.length - 1);

  const res = document.getElementById('palette-results');
  if (!items.length) { res.innerHTML = `<div class="palette-empty">No matches</div>`; return; }
  let html = '', lastSection = '';
  items.forEach((it, i) => {
    if (it.section !== lastSection) { html += `<div class="palette-section">${esc(it.section)}</div>`; lastSection = it.section; }
    html += `<div class="palette-row ${i === state.paletteIndex ? 'active' : ''}" data-idx="${i}">
      <span class="palette-row-label">${esc(it.label)}</span>${it.hint ? `<span class="palette-row-hint">${esc(it.hint)}</span>` : ''}</div>`;
  });
  res.innerHTML = html;
  const active = res.querySelector('.palette-row.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function paletteKeydown(e) {
  const n = (state.paletteItems || []).length;
  if (e.key === 'ArrowDown') { e.preventDefault(); state.paletteIndex = Math.min(n - 1, (state.paletteIndex || 0) + 1); renderPalette(e.target.value); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); state.paletteIndex = Math.max(0, (state.paletteIndex || 0) - 1); renderPalette(e.target.value); }
  else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(state.paletteIndex || 0); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
}

function runPaletteItem(idx) {
  const it = (state.paletteItems || [])[idx];
  if (!it) return;
  closePalette();
  it.run();
}

// ============================================================
// SAVED VIEWS
// ============================================================
function loadViews() {
  try { return JSON.parse(localStorage.getItem('vc-views') || '[]'); } catch { return []; }
}
function persistViews(v) { try { localStorage.setItem('vc-views', JSON.stringify(v)); } catch {} }

function captureView() {
  return {
    activeProjects: [...state.activeProjects],
    hideDone: state.hideDone, hideDeferred: state.hideDeferred, hideCancelled: state.hideCancelled,
    searchQuery: state.searchQuery, view: state.currentView,
  };
}

function applyView(snap) {
  state.activeProjects = new Set((snap.activeProjects || []).filter(id => state.projects[id]));
  if (!state.activeProjects.size) state.activeProjects = new Set(Object.keys(state.projects));
  state.hideDone = !!snap.hideDone; state.hideDeferred = !!snap.hideDeferred; state.hideCancelled = !!snap.hideCancelled;
  state.searchQuery = snap.searchQuery || '';
  const si = document.getElementById('search-input'); if (si) si.value = state.searchQuery;
  if (snap.view) state.currentView = snap.view;
  syncFilterChecks();
  savePrefs();
  renderAll();
}

function renderViewMenu() {
  const menu = document.getElementById('views-menu');
  if (!menu) return;
  const views = loadViews();
  menu.innerHTML = `
    ${views.length ? views.map((v, i) => `
      <div class="views-item" data-idx="${i}">
        <span class="views-item-name">${esc(v.name)}</span>
        <button class="views-item-del" data-del="${i}" title="Delete" aria-label="Delete view">&times;</button>
      </div>`).join('') : `<div class="views-empty">No saved views yet</div>`}
    <button class="views-save" id="views-save">+ Save current view…</button>`;
}

function toggleViewsMenu(force) {
  const menu = document.getElementById('views-menu');
  if (!menu) return;
  const open = force !== undefined ? force : !menu.classList.contains('open');
  if (open) renderViewMenu();
  menu.classList.toggle('open', open);
}

function mountSavedViews() {
  const right = document.querySelector('.filter-bar-right');
  if (!right || document.getElementById('views-control')) return;
  const wrap = document.createElement('div');
  wrap.className = 'views-control'; wrap.id = 'views-control';
  wrap.innerHTML = `
    <button class="views-btn" id="views-btn" title="Saved views">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M6 12h12M9 18h6"/></svg>
      Views
    </button>
    <div class="views-menu" id="views-menu"></div>`;
  right.insertBefore(wrap, right.firstChild);

  document.getElementById('views-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleViewsMenu(); });
  const menu = document.getElementById('views-menu');
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const del = e.target.closest('.views-item-del');
    if (del) { const v = loadViews(); v.splice(parseInt(del.dataset.del), 1); persistViews(v); renderViewMenu(); return; }
    if (e.target.closest('#views-save')) {
      const name = prompt('Name this view:');
      if (name && name.trim()) { const v = loadViews(); v.push({ name: name.trim(), snap: captureView() }); persistViews(v); renderViewMenu(); toast('View saved'); }
      return;
    }
    const item = e.target.closest('.views-item');
    if (item) { const v = loadViews()[parseInt(item.dataset.idx)]; if (v) { applyView(v.snap); toggleViewsMenu(false); } }
  });
  document.addEventListener('click', () => toggleViewsMenu(false));
}

// --- Init ---
async function init() {
  loadPrefs();
  applyTheme();

  // Set initial view tab
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === state.currentView);
  });

  // Set initial filter checkboxes
  document.getElementById('filter-done').checked = !state.hideDone;
  document.getElementById('filter-deferred').checked = !state.hideDeferred;
  document.getElementById('filter-cancelled').checked = !state.hideCancelled;

  bindGlobalEvents();
  bindOnboardingEvents();

  $view().innerHTML = '<div class="loading">Loading…</div>';

  // First run? If no vault is configured, show onboarding instead of the board.
  let vault = { configured: false };
  try { vault = await api('/api/vault'); } catch {}
  state.vaultName = vault.vaultName || '';
  state.vaultPath = vault.vaultPath || '';

  if (!vault.configured) {
    connectSSE();
    showOnboarding();
    return;
  }

  await loadBoard();
  connectSSE();
  mountSavedViews();
}

async function loadBoard() {
  try {
    await Promise.all([fetchProjects(), fetchTasks()]);
    renderAll();
  } catch {
    $view().innerHTML = '<div class="empty-state">Failed to load data. Is the server running?</div>';
  }
}

function bindGlobalEvents() {
  // Quick light/dark toggle (full control lives in Settings)
  document.getElementById('mode-toggle').addEventListener('click', () => {
    state.mode = resolvedMode() === 'dark' ? 'light' : 'dark';
    applyTheme();
    savePrefs();
    if (state.currentView === 'settings') renderSettings();
  });

  // Settings gear
  document.getElementById('settings-btn').addEventListener('click', () => {
    state.currentView = state.currentView === 'settings' ? 'kanban' : 'settings';
    savePrefs();
    renderView();
  });

  // React to OS appearance changes while in System mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.mode === 'system') { applyTheme(); if (state.currentView === 'settings') renderSettings(); }
    });
  }

  // View tabs
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.currentView = tab.dataset.view;
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      savePrefs();
      renderView();
    });
  });

  // Project chips (delegated)
  document.getElementById('project-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.project-chip');
    if (!chip) return;
    const id = chip.dataset.id;
    if (state.activeProjects.has(id)) state.activeProjects.delete(id);
    else state.activeProjects.add(id);
    savePrefs();
    renderAll();
  });

  // Filter checkboxes
  document.getElementById('filter-done').addEventListener('change', (e) => {
    state.hideDone = !e.target.checked;
    savePrefs();
    renderAll();
  });
  document.getElementById('filter-deferred').addEventListener('change', (e) => {
    state.hideDeferred = !e.target.checked;
    savePrefs();
    renderAll();
  });
  document.getElementById('filter-cancelled').addEventListener('change', (e) => {
    state.hideCancelled = !e.target.checked;
    savePrefs();
    renderAll();
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderAll();
  });

  // New task button
  document.getElementById('btn-new-task').addEventListener('click', openCreateModal);

  // New project button
  const newProjectBtn = document.getElementById('btn-new-project');
  if (newProjectBtn) newProjectBtn.addEventListener('click', openProjectModal);

  // Detail panel close
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-backdrop').addEventListener('click', closeDetail);

  // Dependency navigation (delegated once; detail-content element persists)
  document.getElementById('detail-content').addEventListener('click', (e) => {
    const dep = e.target.closest('.detail-dep-item.link[data-goto]');
    if (dep) openDetail(dep.dataset.goto);
  });

  // Hide the card hover-preview on any scroll (capture catches inner scrollers)
  document.addEventListener('scroll', (e) => { hideCardPreview(); if (!(e.target.closest && e.target.closest('.col-sort-menu'))) closeSortMenu(); }, true);

  // Close the column sort menu on any outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.col-sort-menu') && !e.target.closest('.kanban-col-sort')) closeSortMenu();
  });

  // Create-task modal close
  document.getElementById('modal-close').addEventListener('click', closeCreateModal);
  document.getElementById('create-cancel').addEventListener('click', closeCreateModal);
  document.getElementById('create-form').addEventListener('submit', handleCreateSubmit);

  // Create-project modal close
  document.getElementById('project-modal-close').addEventListener('click', closeProjectModal);
  document.getElementById('project-cancel').addEventListener('click', closeProjectModal);
  document.getElementById('project-form').addEventListener('submit', handleProjectSubmit);

  // Shared backdrop closes whichever modal is open
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    closeCreateModal();
    closeProjectModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const typing = () => {
      const a = document.activeElement;
      return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    };

    // ⌘K / Ctrl+K — command palette
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      paletteIsOpen() ? closePalette() : openPalette();
      return;
    }
    // ⌘Z / Ctrl+Z — undo (only when not editing a field)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey && !typing()) {
      e.preventDefault();
      runUndo();
      return;
    }

    if (e.key === 'Escape') {
      if (paletteIsOpen()) { closePalette(); }
      else if (document.getElementById('onboarding').classList.contains('open') && document.getElementById('onboarding').classList.contains('dismissable')) {
        document.getElementById('onboarding').classList.remove('open', 'dismissable');
      }
      else if (document.getElementById('project-modal').classList.contains('open')) { closeProjectModal(); }
      else if (document.getElementById('create-modal').classList.contains('open')) { closeCreateModal(); }
      else if (document.getElementById('detail-panel').classList.contains('open')) { closeDetail(); }
      else if (state.composerStatus) { state.composerStatus = null; renderKanban(); }
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      if (typing()) return;
      e.preventDefault();
      document.getElementById('search-input').focus();
    }
  });
}

// Boot
init();
