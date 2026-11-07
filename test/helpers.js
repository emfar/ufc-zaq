'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { openDatabase, setSetting, syncPlayers } = require('../src/db');

const PASSWORD = 'club-pass-123';

// Same format the app stores, but with a cheap cost factor so tests stay
// fast. verifyPassword reads the parameters from the stored string.
function fastHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, 32, { N: 1024, r: 8, p: 1 });
  return ['scrypt', 1024, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

const silentLog = { info() {}, error() {} };

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Starts the real app on a random port with a fresh database. */
async function startServer(t, env = {}) {
  const dir = tempDir(t);
  const config = loadConfig({ DATA_DIR: dir, TIMEZONE: 'Asia/Baku', ...env });
  const db = openDatabase(config.dbFile);
  syncPlayers(db, config.players);
  setSetting(db, 'login_password_hash', fastHash(PASSWORD));
  const ids = Object.fromEntries(
    db
      .prepare('SELECT name, id FROM players')
      .all()
      .map((p) => [p.name, p.id]),
  );

  const app = createApp({ config, db, log: silentLog });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  return {
    base,
    db,
    config,
    ids,
    client: () => createClient(base),
    /** A new logged-in device. */
    async login(password = PASSWORD) {
      const c = createClient(base);
      const res = await c.post('/api/login', { password });
      if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
      return c;
    },
  };
}

/** fetch wrapper that keeps the session cookie like a browser would. */
function createClient(base) {
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, value] = pair.split('=');
      if (name === 'ufc_session') cookie = value ? `${name}=${value}` : '';
    }
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep text
    }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (url, headers) => call('GET', url, undefined, headers),
    post: (url, body = {}, headers) => call('POST', url, body, headers),
    del: (url, headers) => call('DELETE', url, {}, headers),
    call,
    get cookie() {
      return cookie;
    },
  };
}

/** Insert a win directly (for past months / custom timestamps). */
function insertWin(db, { playerId, method = 'win', month, createdAt = Date.now(), deleted = false }) {
  const points = method === 'ko1' ? 2 : 1;
  return db
    .prepare(
      `INSERT INTO wins (player_id, method, points, month, created_at, deleted_at, deleted_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(playerId, method, points, month, createdAt, deleted ? createdAt : null, deleted ? 'removed' : null)
    .lastInsertRowid;
}

module.exports = { PASSWORD, startServer, insertWin, fastHash, tempDir };
