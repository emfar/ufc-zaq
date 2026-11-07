'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { getSetting, setSetting } = require('./db');

const scrypt = promisify(crypto.scrypt);

// scrypt with N=2^15 needs 32 MiB per hash; maxmem leaves headroom.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

const SESSION_COOKIE = 'ufc_session';
const PASSWORD_SETTING = 'login_password_hash';
const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (password) => String(password).normalize('NFKC');

function encodeHash(salt, key) {
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function decodeHash(stored) {
  const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !keyB64) return null;
  return {
    salt: Buffer.from(saltB64, 'base64'),
    key: Buffer.from(keyB64, 'base64'),
    params: { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
  };
}

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  return encodeHash(salt, crypto.scryptSync(normalize(password), salt, KEY_LENGTH, SCRYPT));
}

function verifyPasswordSync(password, stored) {
  const h = decodeHash(stored);
  if (!h) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(normalize(password), h.salt, h.key.length, h.params), h.key);
}

async function verifyPassword(password, stored) {
  const h = decodeHash(stored);
  if (!h) return false;
  return crypto.timingSafeEqual(await scrypt(normalize(password), h.salt, h.key.length, h.params), h.key);
}

/** Easy to type on a phone: two blocks of 5 lowercase letters (~45 bits). */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz'; // no i, l, o
  let out = '';
  for (let i = 0; i < 10; i++) {
    if (i === 5) out += '-';
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

/**
 * Bring the stored login password in line with the configured one
 * (APP_PASSWORD / APP_PASSWORD_FILE). Called once at startup.
 *  - configured & same as stored  → 'unchanged'
 *  - configured & first time      → 'set'
 *  - configured & different       → 'changed' — every device is logged out
 *  - not configured, one stored   → 'stored' (keep using it)
 *  - not configured, none stored  → 'generated' (returned so it can be shown once)
 */
function applyLoginPassword(db, configured) {
  const stored = getSetting(db, PASSWORD_SETTING);
  if (configured !== null && configured !== undefined) {
    if (stored && verifyPasswordSync(configured, stored)) return { status: 'unchanged' };
    db.transaction(() => {
      setSetting(db, PASSWORD_SETTING, hashPasswordSync(configured));
      if (stored) db.prepare('DELETE FROM sessions').run();
    })();
    return { status: stored ? 'changed' : 'set' };
  }
  if (stored) return { status: 'stored' };
  const password = generatePassword();
  setSetting(db, PASSWORD_SETTING, hashPasswordSync(password));
  return { status: 'generated', password };
}

const loginPasswordHash = (db) => getSetting(db, PASSWORD_SETTING);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return cookies;
}

/** One session per logged-in device; the cookie holds a random token, the DB only its hash. */
function createSessionStore(db, { sessionDays }) {
  const lifetimeMs = sessionDays * DAY_MS;
  const statements = {
    insert: db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare('SELECT id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?'),
    touch: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  const cookieOptions = (req) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: lifetimeMs,
  });

  return {
    create(req, res) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      const { lastInsertRowid } = statements.insert.run(sha256(token), now, now + lifetimeMs, now);
      res.cookie(SESSION_COOKIE, token, cookieOptions(req));
      return Number(lastInsertRowid);
    },

    /** Express middleware: sets req.sessionId (a number) or null. */
    load(req, res, next) {
      req.sessionId = null;
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (!token) return next();
      const row = statements.find.get(sha256(token));
      const now = Date.now();
      if (!row || row.expires_at <= now) {
        if (row) statements.remove.run(row.id);
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return next();
      }
      // Sliding expiry: anyone who opens the app at least every few months
      // never has to log in again. Refreshed at most once an hour.
      if (now - row.last_seen_at > 60 * 60 * 1000) {
        statements.touch.run(now, now + lifetimeMs, row.id);
        res.cookie(SESSION_COOKIE, token, cookieOptions(req));
      }
      req.sessionId = row.id;
      next();
    },

    destroy(req, res) {
      if (req.sessionId) statements.remove.run(req.sessionId);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    },

    purgeExpired() {
      return statements.purge.run(Date.now()).changes;
    },
  };
}

function requireLogin(req, res, next) {
  if (!req.sessionId) return res.status(401).json({ error: 'Please log in' });
  next();
}

module.exports = {
  SESSION_COOKIE,
  applyLoginPassword,
  createSessionStore,
  generatePassword,
  hashPasswordSync,
  loginPasswordHash,
  parseCookies,
  requireLogin,
  verifyPassword,
  verifyPasswordSync,
};
