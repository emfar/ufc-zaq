import { newRequestId } from '../api.js';
import { h, icon, replace } from '../dom.js';
import { dayShortLabel, monthName, timeLabel } from '../format.js';
import { avatar, confirmButton, emitChanged, errorState, methodBadge, onChanged, whileVisible } from '../ui.js';

const LABELS = { win: 'Win', ko1: '1st-round KO' };
const TAP_COOLDOWN_MS = 700; // swallows accidental double taps

export function mount(root, ctx) {
  const { session, api, toast } = ctx;
  const tz = session.app.timezone;
  const points = Object.fromEntries(session.app.rules.methods.map((m) => [m.key, m.points]));

  const monthEl = h('span', { class: 'reg-month' });
  const rowsEl = h('div', { class: 'reg-list' });
  const recentEl = h('div', { class: 'recent-list' });
  const recentSection = h(
    'section',
    { class: 'recent', hidden: true },
    h('h2', { class: 'section-title' }, 'Just registered'),
    recentEl,
  );

  root.append(
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Register a win'),
      h(
        'p',
        { class: 'page-sub' },
        'Tap the winner after each fight. ',
        h(
          'span',
          { class: 'nowrap' },
          h('b', {}, `Win +${points.win}`),
          ' · ',
          h('b', { class: 'text-ko' }, `R1 KO +${points.ko1}`),
        ),
      ),
      monthEl,
    ),
    rowsEl,
    recentSection,
  );

  // Fixed order (as configured) so muscle memory never taps the wrong name.
  const rows = new Map();
  for (const player of session.players) {
    const stats = h('span', { class: 'reg-stats' }, '—');
    const crown = icon('champion', 'reg-crown');
    crown.hidden = true;
    const tapWin = tapButton(player, 'win', 'WIN', `+${points.win}`);
    const tapKo = tapButton(player, 'ko1', 'R1 KO', `+${points.ko1}`);
    const row = h(
      'div',
      { class: 'reg-row' },
      h('div', { class: 'reg-who' }, h('div', { class: 'reg-name' }, h('span', {}, player.name), crown), stats),
      tapWin,
      tapKo,
    );
    rows.set(player.id, { row, stats, crown });
    rowsEl.append(row);
  }

  function tapButton(player, method, label, pts) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: `tap tap-${method}`,
        'aria-label': `${LABELS[method]} for ${player.name}, plus ${points[method]} points`,
      },
      icon(method === 'ko1' ? 'ko' : 'win', 'tap-icon'),
      h('span', { class: 'tap-label' }, label),
      h('span', { class: 'tap-pts' }, pts),
    );
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy');
      setTimeout(() => btn.classList.remove('is-busy'), TAP_COOLDOWN_MS);
      navigator.vibrate?.(15);
      register(player, method, newRequestId());
    });
    return btn;
  }

  async function register(player, method, requestId) {
    try {
      const { win, live } = await api.post('/wins', { playerId: player.id, method, requestId });
      apply(live);
      celebrate(player.id, method);
      toast({
        kind: method === 'ko1' ? 'ko' : 'win',
        title: `${player.name} +${win.points}`,
        text: LABELS[method],
        duration: 6000,
        action: { label: 'Undo', icon: 'undo', run: () => undo(win) },
      });
    } catch (err) {
      if (err.status === 401) return;
      toast({
        kind: 'error',
        title: `${player.name}'s ${LABELS[method].toLowerCase()} not saved`,
        text: err.message,
        duration: 10000,
        action: { label: 'Retry', run: () => register(player, method, requestId) },
      });
    }
  }

  async function undo(win) {
    try {
      const { result, live } = await api.del(`/wins/${win.id}`);
      emitChanged({ live });
      toast({
        kind: 'info',
        title: result === 'removed' ? 'Removed' : 'Undone',
        text: `${win.playerName} ${win.method === 'ko1' ? 'R1 KO' : 'win'} taken back`,
        duration: 3000,
      });
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't undo", text: err.message });
    }
  }

  async function remove(win) {
    try {
      const { result, live } = await api.del(`/wins/${win.id}`);
      apply(live);
      toast({
        kind: 'info',
        title: result === 'removed' ? 'Removed' : 'Undone',
        text:
          result === 'removed'
            ? 'Still listed in History, where it can be restored.'
            : `${win.playerName} ${win.method === 'ko1' ? 'R1 KO' : 'win'} taken back`,
        duration: 3500,
      });
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't remove", text: err.message });
    }
  }

  function celebrate(playerId, method) {
    const r = rows.get(playerId);
    if (!r) return;
    r.row.classList.remove('flash-win', 'flash-ko1');
    void r.row.offsetWidth; // restart the animation
    r.row.classList.add(`flash-${method}`);
  }

  let lastLive = null;
  function apply(live) {
    lastLive = live;
    monthEl.textContent = `${monthName(live.month)} · ${live.daysLeft === 1 ? 'final day' : `${live.daysLeft} days left`}`;
    const reigning = new Set((live.reigning?.champions ?? []).map((c) => c.id));
    const leaderPoints = live.standings[0]?.points ?? 0;

    for (const s of live.standings) {
      const r = rows.get(s.id);
      if (!r) continue;
      const leading = s.rank === 1 && s.points > 0;
      r.row.classList.toggle('is-leader', leading);
      r.crown.hidden = !reigning.has(s.id);
      r.crown.title = reigning.has(s.id) ? `Reigning champion (${monthName(live.reigning.month)})` : '';
      replace(
        r.stats,
        s.points > 0 ? h('span', { class: 'reg-rank' }, `#${s.rank}`) : null,
        h('b', { class: 'reg-pts' }, String(s.points)),
        ` ${s.points === 1 ? 'pt' : 'pts'}`,
        leading
          ? h('span', { class: 'reg-lead' }, ' · leader')
          : s.points < leaderPoints
            ? h('span', { class: 'reg-gap' }, ` · −${leaderPoints - s.points}`)
            : null,
      );
    }

    recentSection.hidden = live.recent.length === 0;
    replace(recentEl, ...live.recent.map(recentItem));
  }

  function recentItem(win) {
    const time = timeLabel(win.createdAt, tz);
    const when = win.day === lastLive?.today ? time : `${dayShortLabel(win.day)} ${time}`;
    return h(
      'div',
      { class: 'recent-item' },
      avatar({ id: win.playerId, name: win.playerName }, 'avatar-sm'),
      h(
        'div',
        { class: 'recent-main' },
        h('div', { class: 'recent-line' }, h('strong', {}, win.playerName), methodBadge(win.method, win.points)),
        h('div', { class: 'recent-meta' }, when),
      ),
      confirmButton({
        className: 'icon-btn',
        iconName: 'x',
        ariaLabel: `Remove ${win.playerName}'s ${LABELS[win.method].toLowerCase()}`,
        onConfirm: () => remove(win),
      }),
    );
  }

  let loadFailed = false;
  async function load() {
    try {
      const live = await api.get('/live');
      if (loadFailed) {
        loadFailed = false;
        root.querySelector('.load-error')?.remove();
      }
      apply(live);
    } catch (err) {
      if (err.status === 401 || lastLive) return; // keep showing what we have
      loadFailed = true;
      root.querySelector('.load-error')?.remove();
      root.append(h('div', { class: 'load-error' }, errorState(err.message, load)));
    }
  }

  load();
  const stopPolling = whileVisible(15000, load);
  const stopListening = onChanged(({ live }) => (live ? apply(live) : load()));
  return () => {
    stopPolling();
    stopListening();
  };
}
