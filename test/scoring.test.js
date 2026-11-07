'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { METHODS, buildLeague, leadersOf, rankStandings } = require('../src/scoring');
const { daysLeftInMonth, isMonthKey, monthKey, shiftMonth } = require('../src/time');

const players = [
  { id: 1, name: 'Farrukh', active: 1 },
  { id: 2, name: 'Ramil', active: 1 },
  { id: 3, name: 'Ibrahim', active: 1 },
  { id: 4, name: 'Hikmat', active: 1 },
  { id: 5, name: 'Ali', active: 1 },
];
const t = (playerId, wins, kos) => ({ playerId, wins, kos, points: wins + kos });

test('points: a win is 1, a first-round KO is 2', () => {
  assert.equal(METHODS.win.points, 1);
  assert.equal(METHODS.ko1.points, 2);
});

test('standings are sorted by points and list every active player', () => {
  const rows = rankStandings(players, [t(2, 3, 0), t(4, 5, 1)]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.points, r.rank]),
    [
      ['Hikmat', 6, 1],
      ['Ramil', 3, 2],
      ['Ali', 0, 3],
      ['Farrukh', 0, 3],
      ['Ibrahim', 0, 3],
    ],
  );
});

test('level on points: more first-round KOs ranks higher', () => {
  // Ramil: 4 wins (2 KOs) = 6 pts, Ali: 5 wins (1 KO) = 6 pts
  const rows = rankStandings(players, [t(5, 5, 1), t(2, 4, 2)]);
  assert.deepEqual(
    rows.slice(0, 2).map((r) => [r.name, r.rank]),
    [
      ['Ramil', 1],
      ['Ali', 2],
    ],
  );
  assert.deepEqual(
    leadersOf(rows).map((r) => r.name),
    ['Ramil'],
  );
});

test('level on points and KOs: shared rank and shared lead', () => {
  const rows = rankStandings(players, [t(1, 4, 1), t(3, 4, 1), t(2, 2, 0)]);
  assert.deepEqual(
    rows.slice(0, 3).map((r) => [r.name, r.rank]),
    [
      ['Farrukh', 1],
      ['Ibrahim', 1],
      ['Ramil', 3],
    ],
  );
  assert.deepEqual(
    leadersOf(rows).map((r) => r.name),
    ['Farrukh', 'Ibrahim'],
  );
});

test('nobody leads a month without wins', () => {
  assert.deepEqual(leadersOf(rankStandings(players, [])), []);
});

test('removed players only show up where they scored', () => {
  const roster = [...players, { id: 6, name: 'Old Timer', active: 0 }];
  assert.equal(rankStandings(roster, []).length, 5);
  assert.equal(rankStandings(roster, [t(6, 1, 0)]).length, 6);
});

test('league: champions per finished month, titles, all-time, reigning champ', () => {
  const monthly = [
    { month: '2026-09', ...t(1, 5, 2) }, // Farrukh 7
    { month: '2026-09', ...t(2, 3, 1) },
    { month: '2026-10', ...t(2, 6, 0) }, // Ramil 6, Ali 6 → same KOs → shared
    { month: '2026-10', ...t(5, 6, 0) },
    { month: '2026-11', ...t(3, 9, 9) }, // current month, not decided yet
  ];
  const league = buildLeague(players, monthly, '2026-11');

  assert.deepEqual(
    league.hallOfFame.map((e) => [e.month, e.champions.map((c) => c.name)]),
    [
      ['2026-10', ['Ali', 'Ramil']],
      ['2026-09', ['Farrukh']],
    ],
  );
  assert.deepEqual(
    league.reigning.champions.map((c) => c.name),
    ['Ali', 'Ramil'],
  );
  assert.equal(league.firstMonth, '2026-09');

  const allTime = Object.fromEntries(league.allTime.map((r) => [r.name, r]));
  assert.equal(allTime.Ibrahim.points, 18);
  assert.equal(allTime.Ibrahim.titles, 0);
  assert.equal(allTime.Ramil.points, 10);
  assert.equal(allTime.Ramil.titles, 1);
  assert.equal(allTime.Farrukh.titles, 1);
  assert.equal(league.allTime[0].name, 'Ibrahim');

  assert.deepEqual(league.standingsFor('2026-11')[0].name, 'Ibrahim');
  assert.equal(
    league.standingsFor('2025-01').every((r) => r.points === 0),
    true,
  );
});

test('league with no wins at all', () => {
  const league = buildLeague(players, [], '2026-11');
  assert.deepEqual(league.hallOfFame, []);
  assert.equal(league.reigning, null);
  assert.equal(league.firstMonth, '2026-11');
});

test('months are counted in the league time zone', () => {
  const lateOct31Utc = Date.parse('2026-10-31T21:30:00Z'); // 01:30 on Nov 1 in Baku (UTC+4)
  assert.equal(monthKey(lateOct31Utc, 'Asia/Baku'), '2026-11');
  assert.equal(monthKey(lateOct31Utc, 'UTC'), '2026-10');
});

test('month helpers', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-11', 0), '2026-11');
  assert.equal(isMonthKey('2026-11'), true);
  assert.equal(isMonthKey('2026-13'), false);
  assert.equal(isMonthKey('2026-1'), false);
  assert.equal(isMonthKey(undefined), false);
});

test('days left counts today', () => {
  assert.equal(daysLeftInMonth(Date.parse('2026-11-07T12:00:00Z'), 'Asia/Baku'), 24);
  assert.equal(daysLeftInMonth(Date.parse('2026-11-30T12:00:00Z'), 'Asia/Baku'), 1);
  assert.equal(daysLeftInMonth(Date.parse('2028-02-28T12:00:00Z'), 'UTC'), 2); // leap year
});
