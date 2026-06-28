// lib/license.js — Vault Commander Pro licensing (Polar).
//
// The ONLY outbound network call Vault Commander ever makes is license
// activation/validation against Polar, and only when the user activates Pro.
// Validation needs just the license key + our PUBLIC organization id — no secret
// token, no backend of our own. After activation the grant is cached to disk and
// works offline forever (we re-validate opportunistically, never block on it, and
// never downgrade on a network error).

const fs = require('fs');
const path = require('path');
const os = require('os');

// Org id + API base are env-overridable so the same build can run against
// Polar's sandbox for a real-key test:
//   POLAR_API_BASE=https://sandbox-api.polar.sh POLAR_ORG_ID=<sandbox-org> node server.js
const ORG_ID = process.env.POLAR_ORG_ID || 'b0409f53-beba-4662-9c9e-7b21696334f7';
const CHECKOUT_URL = process.env.POLAR_CHECKOUT_URL || 'https://buy.polar.sh/polar_cl_PsfvZ7qh9eJAtIyVCYbsC5alIBTz0OZqbP8fQ2ysd3K';
const POLAR_API = process.env.POLAR_API_BASE || 'https://api.polar.sh';
const REVALIDATE_MS = 7 * 24 * 60 * 60 * 1000; // opportunistic weekly re-check

function dir() { return path.join(os.homedir(), '.vault-commander'); }
function file() { return path.join(dir(), 'license.json'); }

function read() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf-8')); } catch { return null; }
}
function write(obj) {
  try { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(obj, null, 2)); } catch { /* non-fatal */ }
}

function maskKey(k) {
  if (!k) return null;
  return k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k;
}

async function polar(endpoint, body) {
  return fetch(`${POLAR_API}/v1/customer-portal/license-keys/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Activate a key on this device. Caches the grant on success. */
async function activate(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) throw new Error('Enter your license key.');
  let res;
  try {
    res = await polar('activate', { key, organization_id: ORG_ID, label: `Vault Commander — ${os.hostname()}` });
  } catch {
    throw new Error('Could not reach the licensing server. Check your internet connection and try again.');
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) throw new Error('That license key was not recognized. Double-check it and try again.');
    if (res.status === 422) throw new Error('That key is not valid for Vault Commander Pro, or it has reached its device limit.');
    let detail = '';
    try { const e = await res.json(); detail = typeof e.detail === 'string' ? e.detail : ''; } catch { /* ignore */ }
    throw new Error(detail || `Activation failed (HTTP ${res.status}). Try again in a moment.`);
  }
  const data = await res.json().catch(() => ({}));
  const activationId = data.id || (data.activation && data.activation.id) || null;
  const now = new Date().toISOString();
  const lic = { key, activationId, status: 'granted', activatedAt: now, validatedAt: now };
  write(lic);
  return status();
}

/** Opportunistic re-validation. Never blocks startup; never downgrades on network error. */
async function revalidate() {
  const lic = read();
  if (!lic || !lic.key || lic.status !== 'granted') return status();
  if (lic.validatedAt && Date.now() - Date.parse(lic.validatedAt) < REVALIDATE_MS) return status();
  let res;
  try {
    res = await polar('validate', { key: lic.key, organization_id: ORG_ID, activation_id: lic.activationId || undefined });
  } catch { return status(); } // offline → keep the cached grant
  if (res.ok) { lic.validatedAt = new Date().toISOString(); write(lic); }
  else if (res.status === 404 || res.status === 403 || res.status === 422) { lic.status = 'revoked'; write(lic); } // key revoked/refunded
  return status();
}

function isPro() {
  const lic = read();
  return !!(lic && lic.status === 'granted');
}

function status() {
  const lic = read();
  return {
    pro: isPro(),
    keyMasked: lic ? maskKey(lic.key) : null,
    activatedAt: lic ? lic.activatedAt : null,
    checkoutUrl: CHECKOUT_URL,
  };
}

function deactivate() {
  try { fs.unlinkSync(file()); } catch { /* already gone */ }
  return status();
}

module.exports = { activate, revalidate, isPro, status, deactivate, ORG_ID, CHECKOUT_URL };
