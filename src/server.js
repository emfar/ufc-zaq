'use strict';

const { createApp } = require('./app');
const { generatePassword, hashPasswordSync } = require('./auth');
const { loadConfig } = require('./config');
const { openDatabase, syncPlayers } = require('./db');

const log = {
  info: (msg) => console.log(`${new Date().toISOString()} ${msg}`),
  error: (err) => console.error(`${new Date().toISOString()}`, err),
};

function printInitialPasswords(created) {
  const width = Math.max(...created.map((c) => c.name.length));
  console.log('');
  console.log('==================================================');
  console.log(' New players created. Their first passwords:');
  console.log('');
  for (const { name, password } of created) console.log(`   ${name.padEnd(width)}   ${password}`);
  console.log('');
  console.log(' Share each one privately; everyone can change');
  console.log(' theirs on the "Me" tab. Lost one? Reset it with:');
  console.log('   node scripts/set-password.js <name>');
  console.log('==================================================');
  console.log('');
}

function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbFile);

  const created = syncPlayers(db, config.players, { hashPassword: hashPasswordSync, generatePassword });
  if (created.length) printInitialPasswords(created);

  const app = createApp({ config, db, log });
  app.locals.sessions.purgeExpired();
  setInterval(() => app.locals.sessions.purgeExpired(), 24 * 60 * 60 * 1000).unref();

  const server = app.listen(config.port, config.host, () => {
    log.info(`${config.appName} is up on http://${config.host}:${config.port} (months in ${config.timezone})`);
  });

  const shutdown = (signal) => {
    log.info(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
