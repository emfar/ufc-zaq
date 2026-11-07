'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PASSWORD, insertWin, startServer } = require('./helpers');
const { applyLoginPassword } = require('../src/auth');
const { syncPlayers } = require('../src/db');
const { monthKey, shiftMonth } = require('../src/time');

const PLAYERS = ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat', 'Ali'];
const thisMonth = () => monthKey(Date.now(), 'Asia/Baku');

test('logged out: session lists the players, everything else needs the password', async (t) => {
  const s = await startServer(t);
  const c = s.client();

  const session = await c.get('/api/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.loggedIn, false);
  assert.deepEqual(
    session.data.players.map((p) => p.name),
    PLAYERS,
  );
  assert.equal(session.data.app.name, 'UFC ZAQ');
  assert.deepEqual(
    session.data.app.rules.methods.map((m) => [m.key, m.points]),
    [
      ['win', 1],
      ['ko1', 2],
    ],
  );

  for (const url of ['/api/live', '/api/board', '/api/wins']) {
    assert.equal((await c.get(url)).status, 401, url);
  }
  assert.equal((await c.post('/api/wins', { playerId: s.ids.Ali, method: 'win' })).status, 401);
});

test('one shared password logs a device in with a session cookie', async (t) => {
  const s = await startServer(t);
  const c = s.client();

  assert.equal((await c.post('/api/login', {})).status, 400);
  assert.equal((await c.post('/api/login', { password: 'nope-nope' })).status, 401);
  assert.equal((await c.post('/api/login', { name: 'Ramil', password: 'wrong' })).status, 401);
  assert.equal(c.cookie, '');

  const ok = await c.post('/api/login', { password: PASSWORD });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /ufc_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.equal((await c.get('/api/session')).data.loggedIn, true);
  assert.equal((await c.get('/api/live')).status, 200);
});

test('wrong guesses are limited per network address', async (t) => {
  const s = await startServer(t);
  const c = s.client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await c.post('/api/login', { password: `guess-${i}` })).status, 401);
  }
  const blocked = await c.post('/api/login', { password: PASSWORD });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /Try again in 15 minutes/);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('wrong guesses from many addresses trip the overall limit, logged-in devices keep working', async (t) => {
  const s = await startServer(t, { TRUST_PROXY: 'true' });
  const friend = await s.login();
  const attacker = s.client();
  for (let i = 0; i < 100; i++) {
    const res = await attacker.post('/api/login', { password: `guess-${i}` }, { 'x-forwarded-for': `203.0.113.${i}` });
    assert.equal(res.status, 401);
  }
  const fromNewAddress = await s
    .client()
    .post('/api/login', { password: PASSWORD }, { 'x-forwarded-for': '198.51.100.7' });
  assert.equal(fromNewAddress.status, 429);
  assert.equal((await friend.get('/api/live')).status, 200);
});

test('one tap registers a win (+1) or a first-round KO (+2)', async (t) => {
  const s = await startServer(t);
  const c = await s.login();

  const win = await c.post('/api/wins', { playerId: s.ids.Ramil, method: 'win' });
  assert.equal(win.status, 201);
  assert.equal(win.data.win.points, 1);
  assert.equal(win.data.win.playerName, 'Ramil');
  assert.equal(win.data.win.removedAt, null);
  assert.equal(win.data.win.createdBy, undefined); // no per-person attribution any more

  const ko = await c.post('/api/wins', { playerId: s.ids.Hikmat, method: 'ko1' });
  assert.equal(ko.status, 201);
  assert.equal(ko.data.win.points, 2);

  const { live } = ko.data;
  assert.equal(live.month, thisMonth());
  assert.ok(live.daysLeft >= 1 && live.daysLeft <= 31);
  const byName = Object.fromEntries(live.standings.map((r) => [r.name, r]));
  assert.deepEqual([byName.Hikmat.points, byName.Hikmat.kos, byName.Hikmat.wins, byName.Hikmat.rank], [2, 1, 1, 1]);
  assert.deepEqual([byName.Ramil.points, byName.Ramil.rank], [1, 2]);
  assert.equal(byName.Farrukh.points, 0);
  assert.deepEqual(
    live.recent.map((w) => w.playerName),
    ['Hikmat', 'Ramil'],
  );
});

test('a retried tap (same request id) is only counted once', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const body = { playerId: s.ids.Ibrahim, method: 'ko1', requestId: 'tap-0123456789abcdef' };

  const first = await c.post('/api/wins', body);
  const again = await c.post('/api/wins', body);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.data.win.id, first.data.win.id);
  assert.equal(again.data.live.standings.find((r) => r.name === 'Ibrahim').points, 2);
});

test('registering rejects bad input', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const bad = [
    { playerId: s.ids.Ali, method: 'decision' },
    { playerId: s.ids.Ali, method: 'toString' },
    { playerId: 999, method: 'win' },
    { playerId: String(s.ids.Ali), method: 'win' },
    { playerId: s.ids.Ali, method: 'win', requestId: '<script>' },
  ];
  for (const body of bad) assert.equal((await c.post('/api/wins', body)).status, 400, JSON.stringify(body));
  assert.equal((await c.get('/api/live')).data.recent.length, 0);
});

test('cross-site and non-JSON writes are refused', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const body = JSON.stringify({ playerId: s.ids.Ali, method: 'win' });

  assert.equal((await c.call('POST', '/api/wins', body, { 'content-type': 'text/plain' })).status, 415);
  const evil = await c.call('POST', '/api/wins', body, {
    'content-type': 'application/json',
    origin: 'https://evil.example',
  });
  assert.equal(evil.status, 403);
  const same = await c.call('POST', '/api/wins', body, { 'content-type': 'application/json', origin: s.base });
  assert.equal(same.status, 201);
  assert.equal((await c.call('DELETE', '/api/wins/1')).status, 415); // DELETE without a JSON body
  const loginForm = await s.client().call('POST', '/api/login', `password=${PASSWORD}`, {
    'content-type': 'application/x-www-form-urlencoded',
  });
  assert.equal(loginForm.status, 415);
});

test('undo on the same device right after tapping leaves no trace', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const { data } = await c.post('/api/wins', { playerId: s.ids.Ali, method: 'ko1' });

  const undo = await c.del(`/api/wins/${data.win.id}`);
  assert.equal(undo.status, 200);
  assert.equal(undo.data.result, 'undone');
  assert.equal(undo.data.live.standings.find((r) => r.name === 'Ali').points, 0);
  assert.equal(undo.data.live.recent.length, 0);
  assert.equal((await c.get('/api/wins')).data.wins.length, 0);
  assert.equal((await c.post(`/api/wins/${data.win.id}/restore`)).status, 404);
});

test('removing from another device is shown in history and can be restored', async (t) => {
  const s = await startServer(t);
  const phoneA = await s.login();
  const phoneB = await s.login();
  const { data } = await phoneA.post('/api/wins', { playerId: s.ids.Ali, method: 'ko1' });

  const removed = await phoneB.del(`/api/wins/${data.win.id}`);
  assert.equal(removed.data.result, 'removed');
  assert.equal(removed.data.live.standings.find((r) => r.name === 'Ali').points, 0);

  const history = await phoneA.get('/api/wins');
  assert.equal(history.data.wins.length, 1);
  assert.equal(typeof history.data.wins[0].removedAt, 'number');
  assert.deepEqual(history.data.totals, { wins: 0, points: 0 });
  assert.equal((await phoneB.del(`/api/wins/${data.win.id}`)).data.result, 'already-removed');

  const restored = await phoneA.post(`/api/wins/${data.win.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.win.removedAt, null);
  assert.equal(restored.data.live.standings.find((r) => r.name === 'Ali').points, 2);
  assert.equal((await phoneA.del('/api/wins/424242')).status, 404);
});

test('removing on the same device after the undo window is shown in history too', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const { data } = await c.post('/api/wins', { playerId: s.ids.Ibrahim, method: 'win' });
  s.db.prepare('UPDATE wins SET created_at = ? WHERE id = ?').run(Date.now() - 10 * 60 * 1000, data.win.id);

  assert.equal((await c.del(`/api/wins/${data.win.id}`)).data.result, 'removed');
  assert.notEqual((await c.get('/api/wins')).data.wins[0].removedAt, null);
});

test('board: monthly standings, champions, hall of fame and all-time', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const current = thisMonth();
  const last = shiftMonth(current, -1);
  const before = shiftMonth(current, -2);
  const { ids } = s;

  // Two months ago: Ramil and Ali level on points (3) — Ramil has the KO.
  insertWin(s.db, { playerId: ids.Ramil, month: before, method: 'ko1' });
  insertWin(s.db, { playerId: ids.Ramil, month: before });
  insertWin(s.db, { playerId: ids.Ali, month: before });
  insertWin(s.db, { playerId: ids.Ali, month: before });
  insertWin(s.db, { playerId: ids.Ali, month: before });
  // Last month: Hikmat and Ibrahim exactly level → shared title. A removed KO doesn't count.
  insertWin(s.db, { playerId: ids.Hikmat, month: last, method: 'ko1' });
  insertWin(s.db, { playerId: ids.Ibrahim, month: last, method: 'ko1' });
  insertWin(s.db, { playerId: ids.Farrukh, month: last, method: 'ko1', deleted: true });
  // This month
  await c.post('/api/wins', { playerId: ids.Farrukh, method: 'win' });

  const board = await c.get('/api/board');
  assert.equal(board.status, 200);
  assert.equal(board.data.month, current);
  assert.equal(board.data.isCurrent, true);
  assert.equal(board.data.nextMonth, null);
  assert.equal(board.data.prevMonth, last);
  assert.deepEqual(
    board.data.leaders.map((l) => l.name),
    ['Farrukh'],
  );
  assert.deepEqual(board.data.totals, { wins: 1, points: 1 });
  assert.deepEqual(
    board.data.hallOfFame.map((e) => [e.month, e.champions.map((ch) => ch.name)]),
    [
      [last, ['Hikmat', 'Ibrahim']],
      [before, ['Ramil']],
    ],
  );
  const allTime = Object.fromEntries(board.data.allTime.standings.map((r) => [r.name, r]));
  assert.equal(allTime.Ramil.titles, 1);
  assert.equal(allTime.Hikmat.titles, 1);
  assert.equal(allTime.Ali.titles, 0);
  assert.equal(allTime.Farrukh.points, 1);
  assert.equal(board.data.allTime.since, before);

  const past = await c.get(`/api/board?month=${before}`);
  assert.equal(past.data.isCurrent, false);
  assert.equal(past.data.prevMonth, null);
  assert.equal(past.data.nextMonth, last);
  assert.deepEqual(
    past.data.leaders.map((l) => l.name),
    ['Ramil'],
  );
  assert.deepEqual(
    past.data.standings.slice(0, 2).map((r) => [r.name, r.points, r.rank]),
    [
      ['Ramil', 3, 1],
      ['Ali', 3, 2],
    ],
  );

  assert.equal((await c.get(`/api/board?month=${shiftMonth(current, 1)}`)).status, 400);
  assert.equal((await c.get('/api/board?month=nope')).status, 400);
  assert.equal((await c.get('/api/board?month=2026-01&month=2026-02')).status, 400);

  const live = await c.get('/api/live');
  assert.equal(live.data.reigning.month, last);
  assert.deepEqual(
    live.data.reigning.champions.map((ch) => ch.name),
    ['Hikmat', 'Ibrahim'],
  );
});

test('history lists a month newest first', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  const now = Date.now();
  insertWin(s.db, { playerId: s.ids.Ramil, month: thisMonth(), createdAt: now - 2000 });
  insertWin(s.db, { playerId: s.ids.Ali, month: thisMonth(), createdAt: now - 1000, method: 'ko1' });

  const history = await c.get('/api/wins');
  assert.deepEqual(
    history.data.wins.map((w) => [w.playerName, w.method]),
    [
      ['Ali', 'ko1'],
      ['Ramil', 'win'],
    ],
  );
  assert.deepEqual(history.data.totals, { wins: 2, points: 3 });
  assert.match(history.data.wins[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(history.data.today, history.data.wins[0].day);
});

test('logout ends that device’s session only', async (t) => {
  const s = await startServer(t);
  const phone = await s.login();
  const tablet = await s.login();
  const stolenCookie = phone.cookie;
  assert.equal((await phone.post('/api/logout')).status, 200);
  assert.equal(phone.cookie, '');
  assert.equal((await phone.get('/api/live')).status, 401);
  assert.equal((await s.client().call('GET', '/api/live', undefined, { cookie: stolenCookie })).status, 401);
  assert.equal((await tablet.get('/api/live')).status, 200);
});

test('a new APP_PASSWORD at restart logs every device out; the old one stops working', async (t) => {
  const s = await startServer(t);
  const phone = await s.login();

  // What server.js does at startup with the configured password:
  assert.equal(applyLoginPassword(s.db, 'brand-new-pass').status, 'changed');
  assert.equal(applyLoginPassword(s.db, 'brand-new-pass').status, 'unchanged');

  assert.equal((await phone.get('/api/live')).status, 401);
  assert.equal((await s.client().post('/api/login', { password: PASSWORD })).status, 401);
  assert.equal((await s.client().post('/api/login', { password: 'brand-new-pass' })).status, 200);
});

test('players removed from PLAYERS keep their points but cannot be picked', async (t) => {
  const s = await startServer(t);
  const c = await s.login();
  await c.post('/api/wins', { playerId: s.ids.Ali, method: 'win' });

  syncPlayers(s.db, ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat']); // as on a restart without Ali

  assert.deepEqual(
    (await c.get('/api/session')).data.players.map((p) => p.name),
    ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat'],
  );
  assert.equal((await c.post('/api/wins', { playerId: s.ids.Ali, method: 'win' })).status, 400);
  const standings = (await c.get('/api/live')).data.standings;
  assert.equal(standings.find((r) => r.name === 'Ali').points, 1); // still counted this month
});

test('pages, manifest, health check and security headers', async (t) => {
  const s = await startServer(t, { APP_NAME: 'Zaq <Fight> Club' });
  const c = s.client();

  for (const page of ['/', '/login', '/register', '/history', '/rules']) {
    const res = await c.get(page);
    assert.equal(res.status, 200, page);
    assert.match(res.data, /<title>Zaq &lt;Fight&gt; Club<\/title>/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }

  const manifest = await c.get('/manifest.webmanifest');
  assert.equal(manifest.data.name, 'Zaq <Fight> Club');
  assert.equal(manifest.data.display, 'standalone');

  assert.equal((await c.get('/healthz')).data, 'ok');
  assert.equal((await c.get('/js/app.js')).status, 200);
  assert.equal((await c.get('/js/missing.js')).status, 404);
  for (const sneaky of [
    '/../package.json',
    '/js/..%2f..%2fpackage.json',
    '/js/%2e%2e/%2e%2e/src/db.js',
    '/package.json',
  ]) {
    const res = await c.get(sneaky);
    assert.notEqual(res.status, 200, sneaky);
    assert.doesNotMatch(String(res.data), /better-sqlite3|CREATE TABLE/, sneaky);
  }
  assert.equal((await c.get('/api/nope')).status, 401); // logged out: hits the login wall first
  assert.equal((await (await s.login()).get('/api/nope')).status, 404);
  assert.equal((await c.get('/somewhere')).status, 302);
  assert.equal((await c.get('/api/session')).headers.get('cache-control'), 'no-store');
  assert.equal((await c.call('POST', '/api/login', '{bad json', { 'content-type': 'application/json' })).status, 400);
});
