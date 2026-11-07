'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { insertWin, startServer } = require('./helpers');
const { monthKey, shiftMonth } = require('../src/time');

const PLAYERS = ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat', 'Ali'];
const thisMonth = () => monthKey(Date.now(), 'Asia/Baku');

test('logged out: session lists the five players, everything else needs a login', async (t) => {
  const s = await startServer(t);
  const c = s.client();

  const session = await c.get('/api/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.player, null);
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

test('login: wrong password, unknown name, then success with a session cookie', async (t) => {
  const s = await startServer(t);
  const c = s.client();

  assert.equal((await c.post('/api/login', {})).status, 400);
  assert.equal((await c.post('/api/login', { name: 'Ramil', password: 'nope' })).status, 401);
  assert.equal((await c.post('/api/login', { name: 'Nobody', password: 'nope' })).status, 401);
  assert.equal(c.cookie, '');

  const ok = await c.post('/api/login', { name: 'ramil', password: s.passwords.Ramil }); // any case
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.player, { id: s.ids.Ramil, name: 'Ramil' });
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /ufc_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);

  const session = await c.get('/api/session');
  assert.deepEqual(session.data.player, { id: s.ids.Ramil, name: 'Ramil' });
});

test('too many wrong passwords locks the account for a while', async (t) => {
  const s = await startServer(t);
  const c = s.client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await c.post('/api/login', { name: 'Ali', password: `guess-${i}` })).status, 401);
  }
  const blocked = await c.post('/api/login', { name: 'Ali', password: s.passwords.Ali });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /Try again in 15 minutes/);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);

  // Other accounts are unaffected.
  assert.equal((await c.post('/api/login', { name: 'Ramil', password: s.passwords.Ramil })).status, 200);
});

test('one tap registers a win (+1) or a first-round KO (+2)', async (t) => {
  const s = await startServer(t);
  const ali = await s.login('Ali');

  const win = await ali.post('/api/wins', { playerId: s.ids.Ramil, method: 'win' });
  assert.equal(win.status, 201);
  assert.equal(win.data.win.points, 1);
  assert.equal(win.data.win.playerName, 'Ramil');
  assert.deepEqual(win.data.win.createdBy, { id: s.ids.Ali, name: 'Ali' });
  assert.equal(win.data.win.removed, null);

  const ko = await ali.post('/api/wins', { playerId: s.ids.Hikmat, method: 'ko1' });
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
  ); // newest first
});

test('a retried tap (same request id) is only counted once', async (t) => {
  const s = await startServer(t);
  const c = await s.login('Farrukh');
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
  const c = await s.login('Farrukh');
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
  const c = await s.login('Farrukh');
  const body = JSON.stringify({ playerId: s.ids.Ali, method: 'win' });

  const form = await c.call('POST', '/api/wins', body, { 'content-type': 'text/plain' });
  assert.equal(form.status, 415);

  const evil = await c.call('POST', '/api/wins', body, {
    'content-type': 'application/json',
    origin: 'https://evil.example',
  });
  assert.equal(evil.status, 403);

  const same = await c.call('POST', '/api/wins', body, { 'content-type': 'application/json', origin: s.base });
  assert.equal(same.status, 201);

  assert.equal((await c.call('DELETE', '/api/wins/1')).status, 415); // DELETE without a JSON body
});

test('undo right after tapping removes the win without a trace', async (t) => {
  const s = await startServer(t);
  const c = await s.login('Hikmat');
  const { data } = await c.post('/api/wins', { playerId: s.ids.Ali, method: 'ko1' });

  const undo = await c.del(`/api/wins/${data.win.id}`);
  assert.equal(undo.status, 200);
  assert.equal(undo.data.result, 'undone');
  assert.equal(undo.data.live.standings.find((r) => r.name === 'Ali').points, 0);
  assert.equal(undo.data.live.recent.length, 0);

  const history = await c.get('/api/wins');
  assert.equal(history.data.wins.length, 0);
  assert.equal((await c.post(`/api/wins/${data.win.id}/restore`)).status, 404);
});

test("removing someone else's win is logged in history and can be restored", async (t) => {
  const s = await startServer(t);
  const ali = await s.login('Ali');
  const ramil = await s.login('Ramil');
  const { data } = await ali.post('/api/wins', { playerId: s.ids.Ali, method: 'ko1' });

  const removed = await ramil.del(`/api/wins/${data.win.id}`);
  assert.equal(removed.data.result, 'removed');
  assert.equal(removed.data.live.standings.find((r) => r.name === 'Ali').points, 0);

  const history = await ali.get('/api/wins');
  assert.equal(history.data.wins.length, 1);
  assert.deepEqual(history.data.wins[0].removed.by, { id: s.ids.Ramil, name: 'Ramil' });
  assert.deepEqual(history.data.totals, { wins: 0, points: 0 });

  assert.equal((await ramil.del(`/api/wins/${data.win.id}`)).data.result, 'already-removed');

  const restored = await ali.post(`/api/wins/${data.win.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.win.removed, null);
  assert.equal(restored.data.live.standings.find((r) => r.name === 'Ali').points, 2);
  assert.equal((await ali.del('/api/wins/424242')).status, 404);
});

test('removing your own win after the undo window is logged too', async (t) => {
  const s = await startServer(t);
  const c = await s.login('Ibrahim');
  const { data } = await c.post('/api/wins', { playerId: s.ids.Ibrahim, method: 'win' });
  s.db.prepare('UPDATE wins SET created_at = ? WHERE id = ?').run(Date.now() - 10 * 60 * 1000, data.win.id);

  assert.equal((await c.del(`/api/wins/${data.win.id}`)).data.result, 'removed');
  assert.equal((await c.get('/api/wins')).data.wins[0].removed.by.name, 'Ibrahim');
});

test('board: monthly standings, champions, hall of fame and all-time', async (t) => {
  const s = await startServer(t);
  const c = await s.login('Farrukh');
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

  const live = await c.get('/api/live');
  assert.equal(live.data.reigning.month, last);
  assert.deepEqual(
    live.data.reigning.champions.map((ch) => ch.name),
    ['Hikmat', 'Ibrahim'],
  );
});

test('history lists a month newest first with who added it', async (t) => {
  const s = await startServer(t);
  const c = await s.login('Ali');
  const now = Date.now();
  insertWin(s.db, { playerId: s.ids.Ramil, month: thisMonth(), createdAt: now - 2000, createdBy: s.ids.Hikmat });
  insertWin(s.db, { playerId: s.ids.Ali, month: thisMonth(), createdAt: now - 1000, method: 'ko1' });

  const history = await c.get('/api/wins');
  assert.deepEqual(
    history.data.wins.map((w) => [w.playerName, w.createdBy.name]),
    [
      ['Ali', 'Ali'],
      ['Ramil', 'Hikmat'],
    ],
  );
  assert.deepEqual(history.data.totals, { wins: 2, points: 3 });
  assert.match(history.data.wins[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(history.data.today, history.data.wins[0].day);
});

test('changing password needs the current one and logs out other devices', async (t) => {
  const s = await startServer(t);
  const phone = await s.login('Hikmat');
  const laptop = await s.login('Hikmat');

  assert.equal(
    (await phone.post('/api/account/password', { currentPassword: 'wrong', newPassword: 'new-secret' })).status,
    400,
  );
  const short = await phone.post('/api/account/password', { currentPassword: s.passwords.Hikmat, newPassword: '123' });
  assert.equal(short.status, 400);
  assert.match(short.data.error, /at least 6/);

  const ok = await phone.post('/api/account/password', {
    currentPassword: s.passwords.Hikmat,
    newPassword: 'new-secret',
  });
  assert.equal(ok.status, 200);
  assert.equal((await phone.get('/api/live')).status, 200);
  assert.equal((await laptop.get('/api/live')).status, 401);

  const c = s.client();
  assert.equal((await c.post('/api/login', { name: 'Hikmat', password: s.passwords.Hikmat })).status, 401);
  assert.equal((await c.post('/api/login', { name: 'Hikmat', password: 'new-secret' })).status, 200);
});

test('logout ends the session', async (t) => {
  const s = await startServer(t);
  const c = await s.login('Ramil');
  const stolenCookie = c.cookie;
  assert.equal((await c.post('/api/logout')).status, 200);
  assert.equal(c.cookie, '');
  assert.equal((await c.get('/api/live')).status, 401);
  assert.equal((await s.client().call('GET', '/api/live', undefined, { cookie: stolenCookie })).status, 401);
});

test('players removed from PLAYERS keep their history but cannot log in', async (t) => {
  const s = await startServer(t);
  const ali = await s.login('Ali');
  await ali.post('/api/wins', { playerId: s.ids.Ali, method: 'win' });

  // Simulate restarting with Ali taken off the list.
  const { syncPlayers } = require('../src/db');
  syncPlayers(s.db, ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat'], {
    hashPassword: () => 'x',
    generatePassword: () => 'x',
  });

  assert.equal((await ali.get('/api/live')).status, 401);
  assert.equal((await s.client().post('/api/login', { name: 'Ali', password: s.passwords.Ali })).status, 401);
  const ramil = await s.login('Ramil');
  assert.deepEqual(
    (await ramil.get('/api/session')).data.players.map((p) => p.name),
    ['Farrukh', 'Ramil', 'Ibrahim', 'Hikmat'],
  );
  assert.equal((await ramil.post('/api/wins', { playerId: s.ids.Ali, method: 'win' })).status, 400);
  const standings = (await ramil.get('/api/live')).data.standings;
  assert.equal(standings.find((r) => r.name === 'Ali').points, 1); // still counted this month
});

test('pages, manifest, health check and security headers', async (t) => {
  const s = await startServer(t, { APP_NAME: 'Zaq <Fight> Club' });
  const c = s.client();

  for (const page of ['/', '/login', '/register', '/history', '/account']) {
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
  assert.equal((await (await s.login('Ali')).get('/api/nope')).status, 404);
  assert.equal((await c.get('/somewhere')).status, 302);
  assert.equal((await c.get('/api/live')).headers.get('cache-control'), 'no-store');
  assert.equal((await c.call('POST', '/api/login', '{bad json', { 'content-type': 'application/json' })).status, 400);
});
