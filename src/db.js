'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Each entry runs once, in order; PRAGMA user_version tracks progress.
// Never edit a migration that has shipped — append a new one instead.
const MIGRATIONS = [
  `
  -- App-wide settings, e.g. the hash of the shared login password.
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- The fighters on the board (configured with PLAYERS). Nobody logs in as
  -- a player: everyone shares one login.
  CREATE TABLE players (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  -- One row per logged-in device.
  CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY,
    token_hash   TEXT    NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  -- One row per registered win. Removed wins are never deleted: they get
  -- deleted_at and a reason — 'undo' (taken back on the same device right
  -- away, hidden from history) or 'removed' (shown in history, restorable).
  CREATE TABLE wins (
    id              INTEGER PRIMARY KEY,
    player_id       INTEGER NOT NULL REFERENCES players(id),
    method          TEXT    NOT NULL CHECK (method IN ('win', 'ko1')),
    points          INTEGER NOT NULL CHECK (points > 0),
    month           TEXT    NOT NULL,     -- 'YYYY-MM' in the league time zone
    created_at      INTEGER NOT NULL,     -- epoch milliseconds
    created_session INTEGER,              -- sessions.id of the device that tapped it
    request_id      TEXT    UNIQUE,       -- client-generated, makes retries safe
    deleted_at      INTEGER,
    deleted_reason  TEXT    CHECK (deleted_reason IN ('undo', 'removed'))
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
 * Make the players table match the configured list: add missing players,
 * keep the configured order, and deactivate players removed from the list.
 * Removed players keep their history; they just can't be picked any more.
 * Returns the names that were added.
 */
function syncPlayers(db, names, now = Date.now()) {
  const added = [];
  const existing = db.prepare('SELECT id, name FROM players').all();
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
  const insert = db.prepare('INSERT INTO players (name, sort_order, active, created_at) VALUES (?, ?, 1, ?)');
  const update = db.prepare('UPDATE players SET sort_order = ?, active = ? WHERE id = ?');
  const listed = new Set(names.map((n) => n.toLowerCase()));

  db.transaction(() => {
    names.forEach((name, index) => {
      const player = byName.get(name.toLowerCase());
      if (player) {
        update.run(index, 1, player.id);
      } else {
        insert.run(name, index, now);
        added.push(name);
      }
    });
    for (const player of existing) {
      if (!listed.has(player.name.toLowerCase())) update.run(names.length, 0, player.id);
    }
  })();
  return added;
}

const getSetting = (db, key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

module.exports = { openDatabase, syncPlayers, getSetting, setSetting };
