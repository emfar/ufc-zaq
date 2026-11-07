'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// scrypt with N=2^15 needs 32 MiB per hash; maxmem leaves headroom.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

const SESSION_COOKIE = 'ufc_session';
const DAY_MS = 24 * 60 * 60 * 1000;

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

const normalize = (password) => String(password).normalize('NFKC');

function encodeHash(salt, key) {
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  return encodeHash(salt, crypto.scryptSync(normalize(password), salt, KEY_LENGTH, SCRYPT));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return encodeHash(salt, await scrypt(normalize(password), salt, KEY_LENGTH, SCRYPT));
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(normalize(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the name doesn't exist, so failed logins take the
// same time either way.
const DUMMY_HASH = hashPasswordSync(crypto.randomBytes(16).toString('hex'));

/** Easy to type on a phone: two blocks of 5 lowercase letters, ~45 bits. */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz'; // no i, l, o
  let out = '';
  for (let i = 0; i < 10; i++) {
    if (i === 5) out += '-';
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

function validateNewPassword(password) {
  if (typeof password !== 'string') return 'Enter a new password';
  const length = [...normalize(password)].length;
  if (length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

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

function createSessionStore(db, { sessionDays }) {
  const lifetimeMs = sessionDays * DAY_MS;
  const statements = {
    insert: db.prepare(
      'INSERT INTO sessions (token_hash, player_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ),
    find: db.prepare(`
      SELECT s.token_hash, s.expires_at, s.last_seen_at, p.id, p.name
      FROM sessions s JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ? AND p.active = 1
    `),
    touch: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeOthers: db.prepare('DELETE FROM sessions WHERE player_id = ? AND token_hash != ?'),
    removeAllFor: db.prepare('DELETE FROM sessions WHERE player_id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  function cookieOptions(req) {
    return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: lifetimeMs };
  }

  return {
    create(req, res, playerId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      statements.insert.run(sha256(token), playerId, now, now + lifetimeMs, now);
      res.cookie(SESSION_COOKIE, token, cookieOptions(req));
    },

    /** Express middleware: sets req.player (or null) and req.sessionId. */
    load(req, res, next) {
      req.player = null;
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (!token) return next();
      const tokenHash = sha256(token);
      const row = statements.find.get(tokenHash);
      const now = Date.now();
      if (!row || row.expires_at <= now) {
        if (row) statements.remove.run(tokenHash);
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return next();
      }
      // Sliding expiry: anyone who opens the app at least every few months
      // never has to log in again. Refresh at most once an hour.
      if (now - row.last_seen_at > 60 * 60 * 1000) {
        statements.touch.run(now, now + lifetimeMs, tokenHash);
        res.cookie(SESSION_COOKIE, token, cookieOptions(req));
      }
      req.player = { id: row.id, name: row.name };
      req.sessionId = tokenHash;
      next();
    },

    destroy(req, res) {
      if (req.sessionId) statements.remove.run(req.sessionId);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    },

    destroyOthers(playerId, keepSessionId) {
      statements.removeOthers.run(playerId, keepSessionId);
    },

    destroyAllFor(playerId) {
      statements.removeAllFor.run(playerId);
    },

    purgeExpired() {
      return statements.purge.run(Date.now()).changes;
    },
  };
}

function requirePlayer(req, res, next) {
  if (!req.player) return res.status(401).json({ error: 'Please log in' });
  next();
}

module.exports = {
  SESSION_COOKIE,
  DUMMY_HASH,
  createSessionStore,
  generatePassword,
  hashPassword,
  hashPasswordSync,
  parseCookies,
  requirePlayer,
  validateNewPassword,
  verifyPassword,
};
