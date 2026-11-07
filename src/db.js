'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Each entry runs once, in order; PRAGMA user_version tracks progress.
// Never edit a migration that has shipped — append a new one instead.
const MIGRATIONS = [
  `
  CREATE TABLE players (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash       TEXT    NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    active              INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL,
    password_changed_at INTEGER
  );

  CREATE TABLE sessions (
    token_hash   TEXT    PRIMARY KEY,
    player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_by_player ON sessions(player_id);

  -- One row per registered win. Removed wins are never deleted: they get
  -- deleted_at/by and a reason — 'undo' (own entry, taken back right away,
  -- hidden from history) or 'removed' (shown in history, can be restored).
  CREATE TABLE wins (
    id             INTEGER PRIMARY KEY,
    player_id      INTEGER NOT NULL REFERENCES players(id),
    method         TEXT    NOT NULL CHECK (method IN ('win', 'ko1')),
    points         INTEGER NOT NULL CHECK (points > 0),
    month          TEXT    NOT NULL,      -- 'YYYY-MM' in the league time zone
    created_at     INTEGER NOT NULL,      -- epoch milliseconds
    created_by     INTEGER NOT NULL REFERENCES players(id),
    request_id     TEXT    UNIQUE,        -- client-generated, makes retries safe
    deleted_at     INTEGER,
    deleted_by     INTEGER REFERENCES players(id),
    deleted_reason TEXT    CHECK (deleted_reason IN ('undo', 'removed'))
  );
  CREATE INDEX wins_by_month ON wins(month, created_at);
  `,
];

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/**
 * Make the players table match the configured list: add missing players
 * (with a generated password, returned so the caller can print it), keep the
 * configured order, and deactivate players that were removed from the list.
 * Removed players keep their history; they just can't log in or be picked.
 */
function syncPlayers(db, names, { hashPassword, generatePassword, now = Date.now() }) {
  const created = [];
  const existing = db.prepare('SELECT id, name FROM players').all();
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

  const insert = db.prepare(
    'INSERT INTO players (name, password_hash, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)',
  );
  const update = db.prepare('UPDATE players SET sort_order = ?, active = ? WHERE id = ?');

  const listed = new Set(names.map((n) => n.toLowerCase()));
  db.transaction(() => {
    names.forEach((name, index) => {
      const player = byName.get(name.toLowerCase());
      if (player) {
        update.run(index, 1, player.id);
      } else {
        const password = generatePassword();
        insert.run(name, hashPassword(password), index, now);
        created.push({ name, password });
      }
    });
    for (const player of existing) {
      if (!listed.has(player.name.toLowerCase())) update.run(names.length, 0, player.id);
    }
  })();
  return created;
}

module.exports = { openDatabase, syncPlayers };
