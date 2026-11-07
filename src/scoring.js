'use strict';

// The rules of the league live here and only here.
const METHODS = {
  win: { key: 'win', label: 'Win', short: 'WIN', points: 1 },
  ko1: { key: 'ko1', label: '1st-round KO', short: 'R1 KO', points: 2 },
};

const RULES = {
  methods: Object.values(METHODS),
  tiebreak: 'Level on points? More 1st-round KOs wins the month. Still level: shared title.',
};

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * Rank players by points, then 1st-round KOs. Players level on both share a
 * rank ("1, 1, 3"). Active players always appear; inactive (removed) players
 * only appear if they scored in the period.
 *
 * @param players [{ id, name, active }]
 * @param totals  [{ playerId, wins, kos, points }]
 */
function rankStandings(players, totals) {
  const scored = new Map(totals.map((t) => [t.playerId, t]));
  const rows = players
    .filter((p) => p.active || scored.has(p.id))
    .map((p) => {
      const t = scored.get(p.id);
      return { id: p.id, name: p.name, wins: t?.wins ?? 0, kos: t?.kos ?? 0, points: t?.points ?? 0 };
    })
    .sort((a, b) => b.points - a.points || b.kos - a.kos || byName(a, b));

  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.points === row.points && prev.kos === row.kos ? prev.rank : i + 1;
  });
  return rows;
}

/** Everyone tied at the top, as long as they actually scored. */
function leadersOf(standings) {
  return standings.filter((row) => row.rank === 1 && row.points > 0);
}

function sumTotals(rows) {
  const byPlayer = new Map();
  for (const r of rows) {
    const t = byPlayer.get(r.playerId) ?? { playerId: r.playerId, wins: 0, kos: 0, points: 0 };
    t.wins += r.wins;
    t.kos += r.kos;
    t.points += r.points;
    byPlayer.set(r.playerId, t);
  }
  return [...byPlayer.values()];
}

/**
 * @param monthly rows of { month, playerId, wins, kos, points }
 * @param currentMonth 'YYYY-MM' — this month is still running, so it never
 *        produces a champion yet.
 */
function buildLeague(players, monthly, currentMonth) {
  const months = new Map();
  for (const row of monthly) {
    if (!months.has(row.month)) months.set(row.month, []);
    months.get(row.month).push(row);
  }

  const standingsFor = (month) => rankStandings(players, months.get(month) ?? []);

  const hallOfFame = [...months.keys()]
    .filter((month) => month < currentMonth)
    .sort()
    .reverse()
    .map((month) => ({
      month,
      champions: leadersOf(standingsFor(month)).map(({ id, name, points, wins, kos }) => ({
        id,
        name,
        points,
        wins,
        kos,
      })),
    }))
    .filter((entry) => entry.champions.length > 0);

  const titles = new Map();
  for (const { champions } of hallOfFame) {
    for (const c of champions) titles.set(c.id, (titles.get(c.id) ?? 0) + 1);
  }

  const allTime = rankStandings(players, sumTotals(monthly)).map((row) => ({
    ...row,
    titles: titles.get(row.id) ?? 0,
  }));

  const sortedMonths = [...months.keys()].sort();
  return {
    standingsFor,
    hallOfFame,
    titles,
    allTime,
    firstMonth: sortedMonths[0] ?? currentMonth,
    reigning: hallOfFame[0] ?? null,
  };
}

module.exports = { METHODS, RULES, rankStandings, leadersOf, buildLeague };
