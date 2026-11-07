'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PLAYERS = ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat', 'Ali'];
const MIN_PASSWORD_LENGTH = 8;

function parseTrustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // e.g. "loopback, 10.0.0.0/8" — passed straight to Express
}

function parsePlayers(value) {
  const names = (value ? value.split(',') : DEFAULT_PLAYERS).map((n) => n.trim()).filter(Boolean);
  const seen = new Set();
  for (const name of names) {
    if (name.length > 24) throw new Error(`Player name "${name}" is longer than 24 characters`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Player "${name}" is listed twice in PLAYERS`);
    seen.add(key);
  }
  if (names.length === 0) throw new Error('PLAYERS must list at least one name');
  return names;
}

function parseTimezone(value) {
  const timezone = value || 'Asia/Baku';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`TIMEZONE "${timezone}" is not a valid IANA time zone (example: Asia/Baku)`);
  }
  return timezone;
}

/**
 * The one shared login password, from APP_PASSWORD or from the file named by
 * APP_PASSWORD_FILE (Docker secrets; one trailing newline is ignored).
 * Returns null when neither is set — the app then keeps the password it
 * already has, or generates one on first start.
 */
function readPassword(env) {
  if (env.APP_PASSWORD && env.APP_PASSWORD_FILE) {
    throw new Error('Set APP_PASSWORD or APP_PASSWORD_FILE, not both');
  }
  let password = null;
  if (env.APP_PASSWORD_FILE) {
    try {
      password = fs.readFileSync(env.APP_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
    } catch (err) {
      throw new Error(`Can't read APP_PASSWORD_FILE (${env.APP_PASSWORD_FILE}): ${err.code || err.message}`);
    }
  } else if (env.APP_PASSWORD) {
    password = env.APP_PASSWORD;
  }
  if (password !== null && [...password.normalize('NFKC')].length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The login password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  return password;
}

function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, 'ufc.db'),
    appName: (env.APP_NAME || 'UFC ZAQ').trim(),
    timezone: parseTimezone(env.TIMEZONE),
    players: parsePlayers(env.PLAYERS),
    password: readPassword(env),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionDays: Number(env.SESSION_DAYS) || 180,
    production: env.NODE_ENV === 'production',
  };
}

module.exports = { loadConfig, DEFAULT_PLAYERS, MIN_PASSWORD_LENGTH };
