#!/usr/bin/env node
'use strict';

// Usage: node scripts/backup.js [file]
// Writes a consistent copy of the database (safe while the app is running).
// Default location: <DATA_DIR>/backups/ufc-YYYY-MM-DD-HHMMSS.db

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');

async function main() {
  const config = loadConfig();
  const stamp = new Date().toISOString().replace('T', '-').replace(/:/g, '').slice(0, 17);
  const target = path.resolve(process.argv[2] ?? path.join(config.dataDir, 'backups', `ufc-${stamp}.db`));
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });

  const db = openDatabase(config.dbFile);
  await db.backup(target);
  db.close();
  console.log(`Backup written to ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
