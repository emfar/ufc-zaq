import { h, icon, replace } from '../dom.js';
import { joinNames, monthLabel, monthName, monthShort, plural } from '../format.js';
import { emptyState, errorState, monthNav, onChanged, whileVisible } from '../ui.js';

// Remembered while the app is open, so going Board → History → Board
// returns to the same month and tab.
const memory = { mode: 'month', month: null };

export function mount(root, ctx) {
  const { api, session } = ctx;
  let data = null;
  let alive = true;

  const content = h('div', { class: 'board' });
  const segment = h('div', { class: 'segment', role: 'tablist' });
  root.append(segment, content);

  function renderSegment() {
    const opt = (mode, label) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: `segment-btn${memory.mode === mode ? ' is-active' : ''}`,
          'aria-selected': String(memory.mode === mode),
          onclick: () => {
            if (memory.mode === mode) return;
            memory.mode = mode;
            renderSegment();
            render();
          },
        },
        label,
      );
    replace(segment, opt('month', 'Monthly'), opt('all', 'All-time'));
  }

  async function load() {
    try {
      const query = memory.month ? `?month=${memory.month}` : '';
      const next = await api.get(`/board${query}`);
      if (!alive) return;
      data = next;
      render();
    } catch (err) {
      if (!alive || err.status === 401) return;
      if (err.status === 400 && memory.month) {
        memory.month = null; // e.g. remembered month is no longer valid
        return load();
      }
      if (!data) replace(content, errorState(err.message, load));
    }
  }

  function goToMonth(month) {
    memory.month = month === data?.currentMonth ? null : month;
    memory.mode = 'month';
    renderSegment();
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render() {
    if (!data) return;
    replace(content, ...(memory.mode === 'all' ? renderAllTime() : renderMonth()), rulesNote());
  }

  // ------------------------------------------------------------ monthly

  function renderMonth() {
    const { month, isCurrent, daysLeft, standings, leaders, totals } = data;
    const subtitle = isCurrent
      ? daysLeft === 1
        ? 'Final day!'
        : `${daysLeft} days left`
      : totals.wins > 0
        ? 'Final standings'
        : 'No fights';

    return [
      monthNav({ month, prevMonth: data.prevMonth, nextMonth: data.nextMonth, subtitle, onChange: goToMonth }),
      hero(),
      totals.wins > 0 ? standingsTable(standings, { titles: false }) : null,
      totals.wins > 0
        ? h('p', { class: 'board-totals' }, `${plural(totals.wins, 'fight')} · ${totals.points} pts handed out`)
        : null,
      hallOfFame(),
    ];

    function hero() {
      if (leaders.length === 0) {
        return isCurrent
          ? emptyState({
              iconName: 'crown',
              title: `${monthName(month)} is wide open`,
              text: 'No wins yet. The first tap takes the lead.',
              action: h('a', { href: '/register', class: 'btn btn-primary' }, icon('plus'), 'Register a win'),
            })
          : emptyState({ iconName: 'podium', title: `No fights in ${monthName(month)}` });
      }
      const top = standings.filter((s) => leaders.some((l) => l.id === s.id));
      const shared = top.length > 1;
      const label = isCurrent
        ? shared
          ? `Sharing the lead in ${monthName(month)}`
          : `Leading ${monthName(month)}`
        : shared
          ? `${monthLabel(month)} co-champions`
          : `${monthLabel(month)} champion`;
      const s = top[0];
      return h(
        'section',
        { class: `hero ${isCurrent ? 'hero-live' : 'hero-final'}` },
        h('div', { class: 'hero-badge' }, icon(isCurrent ? 'crown' : 'trophy')),
        h('p', { class: 'hero-label' }, label),
        h('h2', { class: 'hero-name' }, joinNames(top.map((t) => t.name))),
        h(
          'div',
          { class: 'hero-stats' },
          stat(s.points, 'pts'),
          stat(s.wins, s.wins === 1 ? 'win' : 'wins'),
          stat(s.kos, 'R1 KO'),
        ),
        isCurrent && data.hallOfFame[0] ? reigningLine(data.hallOfFame[0]) : null,
      );
    }
  }

  function reigningLine(entry) {
    return h(
      'p',
      { class: 'hero-foot' },
      icon('trophy'),
      `Reigning champ${entry.champions.length > 1 ? 's' : ''}: `,
      h('b', {}, joinNames(entry.champions.map((c) => c.name))),
      ` (${monthShort(entry.month)})`,
    );
  }

  const stat = (value, label) => h('div', { class: 'hero-stat' }, h('b', {}, String(value)), h('span', {}, label));

  // ------------------------------------------------------------ all-time

  function renderAllTime() {
    const { standings, totals, since } = data.allTime;
    if (totals.wins === 0) {
      return [
        emptyState({
          iconName: 'trophy',
          title: 'No fights yet',
          text: 'All-time stats start with the first registered win.',
        }),
      ];
    }
    const top = standings.filter((s) => s.rank === 1 && s.points > 0);
    return [
      h(
        'section',
        { class: 'hero hero-final' },
        h('div', { class: 'hero-badge' }, icon('trophy')),
        h('p', { class: 'hero-label' }, `All-time leader${top.length > 1 ? 's' : ''} · since ${monthShort(since)}`),
        h('h2', { class: 'hero-name' }, joinNames(top.map((t) => t.name))),
        h(
          'div',
          { class: 'hero-stats' },
          stat(top[0].points, 'pts'),
          stat(top[0].wins, 'wins'),
          stat(top[0].titles, top[0].titles === 1 ? 'title' : 'titles'),
        ),
      ),
      standingsTable(standings, { titles: true }),
      h('p', { class: 'board-totals' }, `${plural(totals.wins, 'fight')} since ${monthLabel(since)}`),
      hallOfFame(),
    ];
  }

  // ------------------------------------------------------------ shared

  function standingsTable(rows, { titles }) {
    const max = Math.max(1, ...rows.map((r) => r.points));
    const head = h(
      'div',
      { class: 'st-row st-head', 'aria-hidden': 'true' },
      h('span', { class: 'st-rank' }, '#'),
      h('span', { class: 'st-name' }, 'Fighter'),
      h('span', { class: 'st-num' }, 'W'),
      h('span', { class: 'st-num' }, 'KO'),
      titles ? h('span', { class: 'st-num' }, icon('trophy')) : null,
      h('span', { class: 'st-pts' }, 'Pts'),
    );
    const body = rows.map((r) =>
      h(
        'div',
        {
          class: `st-row${r.rank === 1 && r.points > 0 ? ' is-top' : ''}${r.id === session.player.id ? ' is-me' : ''}`,
        },
        h('span', { class: 'st-rank' }, r.points > 0 ? String(r.rank) : '–'),
        h(
          'span',
          { class: 'st-name' },
          h('span', { class: 'st-name-text' }, r.name),
          h(
            'span',
            { class: 'st-bar' },
            h('span', { class: 'st-bar-fill', style: { width: `${(r.points / max) * 100}%` } }),
          ),
        ),
        h('span', { class: 'st-num', 'aria-label': `${r.wins} wins` }, String(r.wins)),
        h('span', { class: 'st-num', 'aria-label': `${r.kos} first-round KOs` }, String(r.kos)),
        titles
          ? h(
              'span',
              { class: `st-num${r.titles ? ' st-titles' : ''}`, 'aria-label': `${r.titles} titles` },
              String(r.titles),
            )
          : null,
        h('span', { class: 'st-pts', 'aria-label': `${r.points} points` }, String(r.points)),
      ),
    );
    return h('section', { class: `standings${titles ? ' with-titles' : ''}` }, head, body);
  }

  function hallOfFame() {
    const entries = data.hallOfFame;
    if (entries.length === 0) return null;
    const counts = data.allTime.standings
      .filter((s) => s.titles > 0)
      .sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name));
    return h(
      'section',
      { class: 'hof' },
      h('h2', { class: 'section-title' }, icon('trophy'), 'Hall of fame'),
      h(
        'div',
        { class: 'hof-titles' },
        counts.map((c) => h('span', { class: 'hof-chip' }, h('b', {}, c.name), ` ×${c.titles}`)),
      ),
      h(
        'div',
        { class: 'hof-list' },
        entries.map((e) =>
          h(
            'button',
            { type: 'button', class: 'hof-item', onclick: () => goToMonth(e.month) },
            h('span', { class: 'hof-month' }, monthShort(e.month)),
            h('span', { class: 'hof-name' }, icon('crown'), joinNames(e.champions.map((c) => c.name))),
            h('span', { class: 'hof-pts' }, `${e.champions[0].points} pts`),
          ),
        ),
      ),
    );
  }

  function rulesNote() {
    const methods = session.app.rules.methods.map((m) => `${m.label} = ${plural(m.points, 'pt')}`).join(' · ');
    return h('p', { class: 'rules-note' }, methods, h('br'), session.app.rules.tiebreak);
  }

  renderSegment();
  content.append(h('div', { class: 'skeleton' }));
  load();
  const stopPolling = whileVisible(30000, load);
  const stopListening = onChanged(() => load());
  return () => {
    alive = false;
    stopPolling();
    stopListening();
  };
}
