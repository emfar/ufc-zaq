#!/usr/bin/env node
'use strict';

// Usage:
//   node scripts/set-password.js <name>              → sets a new random password and prints it
//   node scripts/set-password.js <name> <password>   → sets that password
// Logs the player out everywhere. Safe to run while the app is running.

const { generatePassword, hashPasswordSync, validateNewPassword } = require('../src/auth');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');

const [name, chosen] = process.argv.slice(2);
if (!name) {
  console.error('Usage: node scripts/set-password.js <name> [new-password]');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.dbFile);
const player = db.prepare('SELECT id, name FROM players WHERE name = ?').get(name);
if (!player) {
  const names = db.prepare('SELECT name FROM players WHERE active = 1 ORDER BY sort_order').pluck().all();
  console.error(`No player called "${name}". Players: ${names.join(', ') || '(none yet — start the app once)'}`);
  process.exit(1);
}

const password = chosen ?? generatePassword();
const problem = validateNewPassword(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}

db.transaction(() => {
  db.prepare('UPDATE players SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(
    hashPasswordSync(password),
    Date.now(),
    player.id,
  );
  db.prepare('DELETE FROM sessions WHERE player_id = ?').run(player.id);
})();
db.close();

console.log(chosen ? `Password updated for ${player.name}.` : `New password for ${player.name}: ${password}`);
