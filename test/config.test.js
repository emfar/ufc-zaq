'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers');
const { applyLoginPassword, loginPasswordHash, verifyPasswordSync } = require('../src/auth');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');

const base = (dir) => ({ DATA_DIR: dir });

test('APP_PASSWORD is used as the shared login password', (t) => {
  const dir = tempDir(t);
  assert.equal(loadConfig({ ...base(dir), APP_PASSWORD: 'long-enough' }).password, 'long-enough');
  assert.equal(loadConfig(base(dir)).password, null);
  assert.equal(loadConfig({ ...base(dir), APP_PASSWORD: '' }).password, null);
});

test('APP_PASSWORD_FILE is read, ignoring one trailing newline', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, 'from a file\n');
  assert.equal(loadConfig({ ...base(dir), APP_PASSWORD_FILE: file }).password, 'from a file');
  fs.writeFileSync(file, 'windows line\r\n');
  assert.equal(loadConfig({ ...base(dir), APP_PASSWORD_FILE: file }).password, 'windows line');
  fs.writeFileSync(file, '  spaces kept  ');
  assert.equal(loadConfig({ ...base(dir), APP_PASSWORD_FILE: file }).password, '  spaces kept  ');
});

test('bad password settings stop the app with a clear message', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, 'abc\n');
  assert.throws(() => loadConfig({ ...base(dir), APP_PASSWORD: 'short' }), /at least 8 characters/);
  assert.throws(() => loadConfig({ ...base(dir), APP_PASSWORD_FILE: file }), /at least 8 characters/);
  assert.throws(() => loadConfig({ ...base(dir), APP_PASSWORD_FILE: path.join(dir, 'missing') }), /ENOENT/);
  assert.throws(() => loadConfig({ ...base(dir), APP_PASSWORD: 'long-enough', APP_PASSWORD_FILE: file }), /not both/);
});

test('login password: generated once, kept, then replaced by the configured one', (t) => {
  const dir = tempDir(t);
  const db = openDatabase(path.join(dir, 'ufc.db'));
  t.after(() => db.close());

  const first = applyLoginPassword(db, null);
  assert.equal(first.status, 'generated');
  assert.match(first.password, /^[a-z]{5}-[a-z]{5}$/);
  assert.ok(verifyPasswordSync(first.password, loginPasswordHash(db)));

  assert.equal(applyLoginPassword(db, null).status, 'stored'); // restart without APP_PASSWORD

  db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at) VALUES ('x', 0, 9e15, 0)").run();
  assert.equal(applyLoginPassword(db, 'chosen-by-owner').status, 'changed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0); // everyone logged out
  assert.ok(verifyPasswordSync('chosen-by-owner', loginPasswordHash(db)));
  assert.ok(!verifyPasswordSync(first.password, loginPasswordHash(db)));
  assert.equal(applyLoginPassword(db, 'chosen-by-owner').status, 'unchanged');
});

test('first start with APP_PASSWORD set just stores it', (t) => {
  const dir = tempDir(t);
  const db = openDatabase(path.join(dir, 'ufc.db'));
  t.after(() => db.close());
  assert.equal(applyLoginPassword(db, 'from-the-start').status, 'set');
  assert.ok(verifyPasswordSync('from-the-start', loginPasswordHash(db)));
});
