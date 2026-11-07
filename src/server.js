'use strict';

const { createApp } = require('./app');
const { applyLoginPassword } = require('./auth');
const { loadConfig } = require('./config');
const { openDatabase, syncPlayers } = require('./db');

const log = {
  info: (msg) => console.log(`${new Date().toISOString()} ${msg}`),
  error: (err) => console.error(`${new Date().toISOString()}`, err),
};

function printGeneratedPassword(password) {
  console.log('');
  console.log('==================================================');
  console.log(' No APP_PASSWORD is set, so one was generated.');
  console.log(' Everyone logs in with:');
  console.log('');
  console.log(`     ${password}`);
  console.log('');
  console.log(' To choose your own, set APP_PASSWORD (or');
  console.log(' APP_PASSWORD_FILE) and restart. Changing the');
  console.log(' password logs every device out.');
  console.log('==================================================');
  console.log('');
}

function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbFile);

  const added = syncPlayers(db, config.players);
  if (added.length) log.info(`Players added: ${added.join(', ')}`);

  const login = applyLoginPassword(db, config.password);
  if (login.status === 'generated') printGeneratedPassword(login.password);
  if (login.status === 'set') log.info('Login password set');
  if (login.status === 'changed') log.info('Login password changed: every device was logged out');

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

try {
  main();
} catch (err) {
  // Configuration problems (bad TIMEZONE, short password…) — say what's wrong, no stack trace.
  console.error(`Cannot start: ${err.message}`);
  process.exit(1);
}
