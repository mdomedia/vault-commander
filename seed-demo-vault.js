#!/usr/bin/env node
/**
 * seed-demo-vault.js — generate a demo vault for Vault Commander screenshots/demos.
 *
 *   node seed-demo-vault.js "/path/to/Demo Vault"
 *
 * Produces a fictional "Studio MDO world" vault that blends studio work and
 * personal life. All dates are computed RELATIVE TO TODAY at run time, so the
 * dashboard (streak, velocity, heatmap, due-today/overdue) always looks alive.
 * Re-run before a marketing shoot to refresh the dates. No real client data.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml'); // run from the repo so node_modules resolves

// --- helpers ---------------------------------------------------------------
function id() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[bytes[i] % chars.length];
  return s;
}
const DAY = 86400000;
function dateAgo(n) { return new Date(Date.now() - n * DAY).toISOString().slice(0, 10); }
function tsAgo(n, hour = 10) {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}
function sanitize(t) {
  return t.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// --- demo content (fictional) ----------------------------------------------
const projects = [
  { key: 'lighthouse', title: 'Lighthouse Coffee — Rebrand', color: '#4C8FB5', icon: '☕',
    desc: 'Brand refresh + new marketing site for a neighborhood roaster.' },
  { key: 'studio', title: 'Studio Ops', color: '#B07D06', icon: '🛠',
    desc: 'Keeping the studio running — proposals, invoices, content.' },
  { key: 'product', title: 'Product Roadmap', color: '#6B4EF0', icon: '🚀',
    desc: 'The indie app. Ship the beta, then earn the price ladder.' },
  { key: 'home', title: 'Home & Life', color: '#3F9E6C', icon: '🏡',
    desc: 'The stuff that keeps everyday life running.' },
  { key: 'health', title: 'Health & Training', color: '#F0A81E', icon: '🏃',
    desc: 'Half-marathon build and eating like an adult.' },
  { key: 'learning', title: 'Reading & Learning', color: '#9A9384', icon: '📚',
    desc: 'Books, courses, and the monthly review habit.' },
];

// status: todo | active | blocked | review | done | deferred | cancelled
// done tasks carry `done: <days ago completed>` (drives streak/velocity/heatmap)
// others may carry `due: <relative days; negative = overdue, 0 = today>`
const tasks = [
  // --- Lighthouse Coffee — Rebrand ---
  { pj: 'lighthouse', t: 'Audit current brand assets', s: 'done', p: 'medium', done: 26, who: ['me'],
    body: 'Pulled the old logo, menu boards, and bag labels into one board. Inconsistent — three different ambers in use.' },
  { pj: 'lighthouse', t: 'Moodboard v2 — "warm minimal"', s: 'done', p: 'medium', done: 19, who: ['me', 'Sam'],
    body: 'Direction locked: **warm minimal**, paper textures, one accent. Ref board linked in the shared drive.' },
  { pj: 'lighthouse', t: 'Logo concepts — 3 directions', s: 'active', p: 'high', prog: 55, who: ['me'],
    body: 'Three routes:\n\n- Lighthouse mark (literal)\n- Monogram "LC"\n- Type-only wordmark\n\nLeaning type-only.' },
  { pj: 'lighthouse', t: 'Present concepts to Lighthouse', s: 'review', p: 'high', due: 1, who: ['me'],
    deps: ['Logo concepts — 3 directions'], body: 'Deck drafted. Walk them through the type-only route last — it\'s the strongest.' },
  { pj: 'lighthouse', t: 'Build homepage in Framer', s: 'todo', p: 'medium', deps: ['Logo concepts — 3 directions'],
    body: 'Hero, beans, story, find-us map. Mobile first.' },
  { pj: 'lighthouse', t: 'Write brand voice one-pager', s: 'todo', p: 'low',
    body: 'Friendly, a little nerdy about coffee, never precious.' },
  { pj: 'lighthouse', t: 'Shoot product photos at the roastery', s: 'blocked', p: 'medium', due: 4,
    body: 'Blocked on scheduling with the owner — waiting on a morning when they\'re slow.' },

  // --- Studio Ops ---
  { pj: 'studio', t: 'Send May invoices', s: 'done', p: 'high', done: 12, who: ['me'],
    body: 'All out. Net-15.' },
  { pj: 'studio', t: 'Q3 content calendar', s: 'active', p: 'medium', prog: 40, who: ['me'],
    body: 'One build-in-public post a week + one longer piece a month.' },
  { pj: 'studio', t: 'Follow up with Riverbend lead', s: 'todo', p: 'high', due: 0,
    body: 'They went quiet after the estimate. Soft nudge, no pressure.' },
  { pj: 'studio', t: 'Update portfolio with recent work', s: 'todo', p: 'medium',
    body: 'Three new pieces to add. Kill the two oldest.' },
  { pj: 'studio', t: 'Renew domain + hosting', s: 'done', p: 'medium', done: 5,
    body: 'Auto-renew was off. Fixed.' },
  { pj: 'studio', t: 'Draft new proposal template', s: 'deferred', p: 'low',
    body: 'Current one works fine. Revisit after the Lighthouse project wraps.' },
  { pj: 'studio', t: 'Reconcile last month\'s expenses', s: 'done', p: 'medium', done: 3, who: ['me'] },

  // --- Product Roadmap ---
  { pj: 'product', t: 'Ship onboarding vault picker', s: 'done', p: 'high', done: 1, who: ['me'],
    body: 'Boot-without-vault + auto-detect + Browse. Done and dogfooding it now.' },
  { pj: 'product', t: 'Cut v0.9 beta', s: 'active', p: 'critical', type: 'milestone', prog: 70, who: ['me'],
    sub: ['Pricing page copy', 'Fix Kanban perf on big columns'],
    body: 'The beta milestone. Everything under here ships together.' },
  { pj: 'product', t: 'Pricing page copy', s: 'review', p: 'high', who: ['me'],
    body: 'Lifetime $49 with the real ladder dates printed. No fake countdowns.' },
  { pj: 'product', t: 'Fix Kanban perf on big columns', s: 'todo', p: 'high',
    body: 'A 200-card column shouldn\'t render all at once. Paginate or "show 20 more".' },
  { pj: 'product', t: 'Agent Mode (MCP) — spec', s: 'todo', p: 'medium', due: 9,
    body: 'Expose tasks/projects as MCP tools. The Sept headline feature.' },
  { pj: 'product', t: 'Write the launch thread', s: 'todo', p: 'medium',
    body: 'The "I live in Jira but my life is in Obsidian" story.' },
  { pj: 'product', t: 'Security pass + SECURITY.md', s: 'done', p: 'critical', done: 2, who: ['me'],
    body: 'Loopback bind, no wildcard CORS, Host guard, markdown XSS closed.' },

  // --- Home & Life ---
  { pj: 'home', t: 'Renew passport', s: 'todo', p: 'high', due: -6,
    body: 'Expires this fall and the wait times are wild right now. Overdue — do it.' },
  { pj: 'home', t: 'Meal plan for the week', s: 'done', p: 'low', done: 0,
    body: 'Sunday ritual. Done.' },
  { pj: 'home', t: 'Fix the leaky kitchen faucet', s: 'todo', p: 'medium',
    body: 'Probably the cartridge. Watch the 4-min video first.' },
  { pj: 'home', t: 'Plan weekend trip to Sedona', s: 'active', p: 'low', prog: 30,
    body: 'Two nights. Find a place with a view and a trailhead nearby.' },
  { pj: 'home', t: 'Schedule dentist cleaning', s: 'todo', p: 'low', due: 5 },
  { pj: 'home', t: 'Pay quarterly estimated taxes', s: 'done', p: 'high', done: 8, who: ['me'] },
  { pj: 'home', t: 'Cancel the unused streaming sub', s: 'done', p: 'low', done: 6 },

  // --- Health & Training ---
  { pj: 'health', t: 'Sign up for the half marathon', s: 'done', p: 'medium', done: 22,
    body: 'Registered. October. No going back now.' },
  { pj: 'health', t: 'Long run — 10 miles', s: 'done', p: 'medium', done: 2,
    body: 'Felt strong through mile 8. Walked the last hill, that\'s fine.' },
  { pj: 'health', t: 'Meal prep Sunday', s: 'active', p: 'medium', prog: 20,
    body: 'Overnight oats + two lunches. Keep it boring and repeatable.' },
  { pj: 'health', t: 'Book a physio session for the knee', s: 'todo', p: 'high', due: 2,
    body: 'Niggle on the right knee after long runs. Get ahead of it.' },
  { pj: 'health', t: 'New running shoes', s: 'done', p: 'low', done: 14 },
  { pj: 'health', t: 'Tuesday tempo run', s: 'done', p: 'low', done: 4 },
  { pj: 'health', t: 'Easy 4 miles', s: 'done', p: 'low', done: 7 },

  // --- Reading & Learning ---
  { pj: 'learning', t: 'Finish "Shape Up"', s: 'active', p: 'low', prog: 60,
    body: 'On the chapter about cool-down. Good frame for the beta cycle.' },
  { pj: 'learning', t: 'Watch the SvelteKit course', s: 'todo', p: 'low',
    body: 'In case the vanilla-JS strain ever wins. Module 1–3 first.' },
  { pj: 'learning', t: 'Annotate "Thinking in Systems"', s: 'deferred', p: 'low',
    body: 'Parked. Re-start after the launch.' },
  { pj: 'learning', t: 'Write the monthly review note', s: 'todo', p: 'medium', due: 3,
    body: 'Wins, slips, what to carry forward. Goes straight into the vault.' },
  { pj: 'learning', t: 'Read one paper on local-first software', s: 'done', p: 'low', done: 10,
    body: 'The Ink & Switch essay. Still the clearest articulation of why this matters.' },
  { pj: 'learning', t: 'Try the new note-linking workflow for a week', s: 'cancelled', p: 'low',
    body: 'Tried it. Didn\'t stick. Back to the old way.' },
];

// --- build & write ---------------------------------------------------------
function main() {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error('\n  Usage: node seed-demo-vault.js "/path/to/Demo Vault"\n');
    process.exit(1);
  }
  const vaultPath = path.resolve(outArg);
  const projectsDir = path.join(vaultPath, 'Projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  // assign ids
  const projById = {};
  for (const p of projects) { p.id = id(); projById[p.key] = p; }
  const idByTitle = {};
  for (const t of tasks) { t.id = id(); idByTitle[t.t] = t.id; }

  // write project files
  for (const p of projects) {
    const taskIds = tasks.filter((t) => t.pj === p.key).map((t) => t.id);
    const fm = {
      'pm-project': true,
      id: p.id,
      title: p.title,
      description: p.desc,
      color: p.color,
      icon: p.icon,
      taskIds,
      createdAt: tsAgo(75),
      updatedAt: tsAgo(0),
    };
    const body = `# ${p.title}\n\n${p.desc}\n`;
    fs.writeFileSync(path.join(projectsDir, `${sanitize(p.title)}.md`),
      `---\n${yaml.dump(fm, { lineWidth: -1, quotingType: '"' })}---\n\n${body}`);
  }

  // write task files
  let count = 0;
  for (const t of tasks) {
    const p = projById[t.pj];
    const tasksDir = path.join(projectsDir, `${sanitize(p.title)}_tasks`);
    fs.mkdirSync(tasksDir, { recursive: true });

    const status = t.s;
    const progress = status === 'done' ? 100 : (t.prog ?? (status === 'review' ? 85 : 0));
    const createdAt = tsAgo(typeof t.done === 'number' ? t.done + 7 : 60);
    const updatedAt = typeof t.done === 'number' ? tsAgo(t.done) : tsAgo(Math.floor(Math.random() * 6));

    const tags = [`project/${t.pj}`];
    if (['Send May invoices', 'Reconcile last month\'s expenses', 'Pay quarterly estimated taxes'].includes(t.t)) tags.push('type/finance');
    if (t.pj === 'lighthouse') tags.push('domain/brand');
    if (t.pj === 'product') tags.push('domain/engineering');

    const fm = {
      'pm-task': true,
      projectId: p.id,
      parentId: null,
      id: t.id,
      title: t.t,
      type: t.type || 'task',
      status,
      priority: t.p,
      start: '',
      due: typeof t.due === 'number' ? dateAgo(-t.due) : '',
      progress,
      assignees: t.who || [],
      tags,
      subtaskIds: (t.sub || []).map((title) => idByTitle[title]).filter(Boolean),
      dependencies: (t.deps || []).map((title) => idByTitle[title]).filter(Boolean),
      collapsed: false,
      createdAt,
      updatedAt,
    };
    const body = `# ${t.t}\n\n${t.body || ''}\n`;
    fs.writeFileSync(path.join(tasksDir, `${sanitize(t.t)}-${t.id}.md`),
      `---\n${yaml.dump(fm, { lineWidth: -1, quotingType: '"' })}---\n\n${body}`);
    count++;
  }

  // set parentId on any subtasks
  for (const parent of tasks.filter((t) => t.sub && t.sub.length)) {
    for (const childTitle of parent.sub) {
      const child = tasks.find((t) => t.t === childTitle);
      if (!child) continue;
      const p = projById[child.pj];
      const file = path.join(projectsDir, `${sanitize(p.title)}_tasks`, `${sanitize(child.t)}-${child.id}.md`);
      let raw = fs.readFileSync(file, 'utf-8');
      raw = raw.replace('parentId: null', `parentId: "${parent.id}"`);
      fs.writeFileSync(file, raw);
    }
  }

  console.log(`\n  ✓ Demo vault written to: ${vaultPath}`);
  console.log(`  ${projects.length} projects, ${count} tasks (dates relative to today).`);
  console.log(`\n  Point Vault Commander at it:\n    npx vault-commander --vault "${vaultPath}"\n`);
}

main();
