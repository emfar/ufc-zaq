'use strict';

const express = require('express');
const { loginPasswordHash, requireLogin, verifyPassword } = require('./auth');
const { FailureLimiter } = require('./rate-limit');
const { METHODS, RULES, buildLeague, leadersOf } = require('./scoring');
const { dayKey, daysLeftInMonth, isMonthKey, monthKey, shiftMonth } = require('./time');

// Taking a win back on the same device within this window is an "undo": it
// disappears from the history. Later removals, or removals from another
// device, stay visible there (and can be restored).
const UNDO_WINDOW_MS = 5 * 60 * 1000;
const RECENT_LIMIT = 5;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const LIMIT_WINDOW_MS = 15 * 60 * 1000;

function createApi({ config, db, sessions, log }) {
  const router = express.Router();
  const tz = config.timezone;

  // Everyone shares one password, so guessing is limited per network address
  // and in total. The total limit only blocks new logins — devices that are
  // already logged in keep working.
  const ipLimiter = new FailureLimiter({ max: 10, windowMs: LIMIT_WINDOW_MS });
  const globalLimiter = new FailureLimiter({ max: 100, windowMs: LIMIT_WINDOW_MS });

  const sql = {
    players: db.prepare('SELECT id, name, active FROM players ORDER BY sort_order, id'),
    activePlayer: db.prepare('SELECT id, name FROM players WHERE id = ? AND active = 1'),
    monthly: db.prepare(`
      SELECT month, player_id AS playerId, COUNT(*) AS wins,
             SUM(CASE WHEN method = 'ko1' THEN 1 ELSE 0 END) AS kos, SUM(points) AS points
      FROM wins WHERE deleted_at IS NULL
      GROUP BY month, player_id
    `),
    insertWin: db.prepare(`
      INSERT INTO wins (player_id, method, points, month, created_at, created_session, request_id)
      VALUES (@playerId, @method, @points, @month, @createdAt, @sessionId, @requestId)
    `),
    winById: db.prepare('SELECT * FROM wins WHERE id = ?'),
    winByRequestId: db.prepare('SELECT id FROM wins WHERE request_id = ?'),
    removeWin: db.prepare('UPDATE wins SET deleted_at = ?, deleted_reason = ? WHERE id = ?'),
    restoreWin: db.prepare('UPDATE wins SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?'),
  };

  const WIN_SELECT = `
    SELECT w.id, w.player_id, p.name AS player_name, w.method, w.points, w.created_at, w.deleted_at
    FROM wins w JOIN players p ON p.id = w.player_id
  `;
  sql.winView = db.prepare(`${WIN_SELECT} WHERE w.id = ?`);
  sql.recent = db.prepare(`${WIN_SELECT}
    WHERE w.month = ? AND w.deleted_at IS NULL
    ORDER BY w.created_at DESC, w.id DESC LIMIT ${RECENT_LIMIT}`);
  sql.history = db.prepare(`${WIN_SELECT}
    WHERE w.month = ? AND (w.deleted_reason IS NULL OR w.deleted_reason != 'undo')
    ORDER BY w.created_at DESC, w.id DESC`);

  const toWin = (row) => ({
    id: row.id,
    playerId: row.player_id,
    playerName: row.player_name,
    method: row.method,
    points: row.points,
    createdAt: row.created_at,
    day: dayKey(row.created_at, tz),
    removedAt: row.deleted_at ?? null,
  });

  const publicPlayers = () =>
    sql.players
      .all()
      .filter((p) => p.active)
      .map(({ id, name }) => ({ id, name }));

  const league = (now = Date.now()) => {
    const currentMonth = monthKey(now, tz);
    return { currentMonth, ...buildLeague(sql.players.all(), sql.monthly.all(), currentMonth) };
  };

  const brief = ({ id, name }) => ({ id, name });

  function liveState() {
    const now = Date.now();
    const lg = league(now);
    return {
      month: lg.currentMonth,
      today: dayKey(now, tz),
      daysLeft: daysLeftInMonth(now, tz),
      standings: lg.standingsFor(lg.currentMonth),
      recent: sql.recent.all(lg.currentMonth).map(toWin),
      reigning: lg.reigning && { month: lg.reigning.month, champions: lg.reigning.champions.map(brief) },
    };
  }

  /** Validates ?month=, defaulting to the current month. Returns null (and responds) when invalid. */
  function pickMonth(req, res, currentMonth) {
    const month = req.query.month ?? currentMonth;
    if (!isMonthKey(month)) {
      res.status(400).json({ error: 'Month must look like 2026-11' });
      return null;
    }
    if (month > currentMonth) {
      res.status(400).json({ error: "That month hasn't started yet" });
      return null;
    }
    return month;
  }

  const monthNav = (month, firstMonth, currentMonth) => ({
    prevMonth: month > firstMonth ? shiftMonth(month, -1) : null,
    nextMonth: month < currentMonth ? shiftMonth(month, 1) : null,
  });

  const total = (rows) => ({
    wins: rows.reduce((sum, r) => sum + r.wins, 0),
    points: rows.reduce((sum, r) => sum + r.points, 0),
  });

  // ---------------------------------------------------------------- public

  router.get('/session', (req, res) => {
    res.json({
      loggedIn: req.sessionId !== null,
      players: publicPlayers(),
      app: { name: config.appName, timezone: tz, rules: RULES },
    });
  });

  router.post('/login', async (req, res) => {
    const { password } = req.body ?? {};
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter the password' });
    }
    const wait = Math.max(ipLimiter.retryAfter(req.ip), globalLimiter.retryAfter('all'));
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60000);
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({
        error: `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      });
    }

    const hash = loginPasswordHash(db);
    const valid = Boolean(hash) && password.length <= 1024 && (await verifyPassword(password, hash));
    if (!valid) {
      ipLimiter.fail(req.ip);
      globalLimiter.fail('all');
      return res.status(401).json({ error: 'Wrong password' });
    }

    ipLimiter.reset(req.ip);
    const sessionId = sessions.create(req, res);
    log.info(`New device logged in (session ${sessionId})`);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(req, res);
    res.json({ ok: true });
  });

  // --------------------------------------------------------- logged in only

  router.use(requireLogin);

  router.get('/live', (req, res) => {
    res.json(liveState());
  });

  router.post('/wins', (req, res) => {
    const { playerId, method, requestId } = req.body ?? {};
    const rule = Object.hasOwn(METHODS, method) ? METHODS[method] : null;
    if (!rule) return res.status(400).json({ error: 'Unknown win type' });
    const player = Number.isInteger(playerId) ? sql.activePlayer.get(playerId) : undefined;
    if (!player) return res.status(400).json({ error: 'Unknown player' });
    if (requestId !== undefined && (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId))) {
      return res.status(400).json({ error: 'Invalid request id' });
    }

    // A retried request (same requestId) returns the win it already created.
    const existing = requestId && sql.winByRequestId.get(requestId);
    if (existing) return res.json({ win: toWin(sql.winView.get(existing.id)), live: liveState() });

    const now = Date.now();
    const { lastInsertRowid } = sql.insertWin.run({
      playerId: player.id,
      method: rule.key,
      points: rule.points,
      month: monthKey(now, tz),
      createdAt: now,
      sessionId: req.sessionId,
      requestId: requestId ?? null,
    });
    log.info(`Registered ${rule.short} (+${rule.points}) for ${player.name} (win ${lastInsertRowid})`);
    res.status(201).json({ win: toWin(sql.winView.get(lastInsertRowid)), live: liveState() });
  });

  function findWin(req, res) {
    const id = Number(req.params.id);
    const win = Number.isSafeInteger(id) && id > 0 ? sql.winById.get(id) : undefined;
    if (!win) res.status(404).json({ error: 'That win no longer exists' });
    return win;
  }

  router.delete('/wins/:id', (req, res) => {
    const win = findWin(req, res);
    if (!win) return;
    if (win.deleted_at) return res.json({ result: 'already-removed', live: liveState() });

    const now = Date.now();
    const undo = win.created_session === req.sessionId && now - win.created_at <= UNDO_WINDOW_MS;
    sql.removeWin.run(now, undo ? 'undo' : 'removed', win.id);
    log.info(`${undo ? 'Undid' : 'Removed'} win ${win.id}`);
    res.json({ result: undo ? 'undone' : 'removed', live: liveState() });
  });

  router.post('/wins/:id/restore', (req, res) => {
    const win = findWin(req, res);
    if (!win) return;
    if (win.deleted_reason === 'undo') return res.status(404).json({ error: 'That win no longer exists' });
    if (win.deleted_at) {
      sql.restoreWin.run(win.id);
      log.info(`Restored win ${win.id}`);
    }
    res.json({ win: toWin(sql.winView.get(win.id)), live: liveState() });
  });

  router.get('/board', (req, res) => {
    const now = Date.now();
    const lg = league(now);
    const month = pickMonth(req, res, lg.currentMonth);
    if (!month) return;

    const standings = lg.standingsFor(month);
    const isCurrent = month === lg.currentMonth;
    res.json({
      month,
      currentMonth: lg.currentMonth,
      isCurrent,
      daysLeft: isCurrent ? daysLeftInMonth(now, tz) : 0,
      ...monthNav(month, lg.firstMonth, lg.currentMonth),
      standings,
      leaders: leadersOf(standings).map(brief),
      totals: total(standings),
      hallOfFame: lg.hallOfFame,
      allTime: { standings: lg.allTime, totals: total(lg.allTime), since: lg.firstMonth },
    });
  });

  router.get('/wins', (req, res) => {
    const lg = league();
    const month = pickMonth(req, res, lg.currentMonth);
    if (!month) return;

    const wins = sql.history.all(month).map(toWin);
    const counted = wins.filter((w) => w.removedAt === null);
    res.json({
      month,
      currentMonth: lg.currentMonth,
      today: dayKey(Date.now(), tz),
      ...monthNav(month, lg.firstMonth, lg.currentMonth),
      wins,
      totals: { wins: counted.length, points: counted.reduce((sum, w) => sum + w.points, 0) },
    });
  });

  return router;
}

module.exports = { createApi, UNDO_WINDOW_MS };
