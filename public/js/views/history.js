import { h, icon, replace } from '../dom.js';
import { dayLabel, monthName, plural, timeLabel } from '../format.js';
import {
  avatar,
  confirmButton,
  emitChanged,
  emptyState,
  errorState,
  methodBadge,
  monthNav,
  onChanged,
  whileVisible,
} from '../ui.js';

const memory = { month: null };

export function mount(root, ctx) {
  const { api, session, toast } = ctx;
  const tz = session.app.timezone;
  let data = null;
  let alive = true;

  const content = h('div', { class: 'history' }, h('div', { class: 'skeleton' }));
  root.append(content);

  async function load() {
    try {
      const next = await api.get(`/wins${memory.month ? `?month=${memory.month}` : ''}`);
      if (!alive) return;
      data = next;
      render();
    } catch (err) {
      if (!alive || err.status === 401) return;
      if (err.status === 400 && memory.month) {
        memory.month = null;
        return load();
      }
      if (!data) replace(content, errorState(err.message, load));
    }
  }

  function goToMonth(month) {
    memory.month = month === data?.currentMonth ? null : month;
    load();
  }

  function render() {
    const { month, wins, totals } = data;
    const removedCount = wins.filter((w) => w.removedAt !== null).length;
    const subtitle = [
      plural(totals.wins, 'win'),
      `${totals.points} pts`,
      removedCount ? `${removedCount} removed` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const nav = monthNav({
      month,
      prevMonth: data.prevMonth,
      nextMonth: data.nextMonth,
      subtitle,
      onChange: goToMonth,
    });
    if (wins.length === 0) {
      replace(content, nav, emptyState({ iconName: 'history', title: `Nothing registered in ${monthName(month)}` }));
      return;
    }

    const days = [];
    for (const win of wins) {
      const last = days[days.length - 1];
      if (last && last.day === win.day) last.wins.push(win);
      else days.push({ day: win.day, wins: [win] });
    }

    replace(
      content,
      nav,
      ...days.map(({ day, wins: dayWins }) => {
        const counted = dayWins.filter((w) => w.removedAt === null);
        return h(
          'section',
          { class: 'day' },
          h(
            'h2',
            { class: 'day-title' },
            h('span', {}, day === data.today ? 'Today' : dayLabel(day)),
            h('span', { class: 'day-count' }, plural(counted.length, 'win')),
          ),
          h('div', { class: 'day-list' }, dayWins.map(item)),
        );
      }),
    );
  }

  function item(win) {
    const removed = win.removedAt !== null;
    const action = removed
      ? h(
          'button',
          {
            type: 'button',
            class: 'pill-btn',
            onclick: () => restore(win),
            'aria-label': `Restore ${win.playerName}'s win`,
          },
          icon('restore'),
          'Restore',
        )
      : confirmButton({
          className: 'icon-btn',
          iconName: 'x',
          ariaLabel: `Remove ${win.playerName}'s win`,
          onConfirm: () => remove(win),
        });

    return h(
      'div',
      { class: `log-item${removed ? ' is-removed' : ''}` },
      h('span', { class: 'log-time' }, timeLabel(win.createdAt, tz)),
      avatar({ id: win.playerId, name: win.playerName }, 'avatar-sm'),
      h(
        'div',
        { class: 'log-main' },
        h(
          'div',
          { class: 'log-line' },
          h('strong', { class: 'log-name' }, win.playerName),
          methodBadge(win.method, win.points),
        ),
        removed ? h('div', { class: 'log-meta log-removed' }, `Removed at ${timeLabel(win.removedAt, tz)}`) : null,
      ),
      action,
    );
  }

  async function remove(win) {
    try {
      const { result } = await api.del(`/wins/${win.id}`);
      toast({
        kind: 'info',
        title: result === 'undone' ? 'Undone' : 'Removed',
        text:
          result === 'undone'
            ? `${win.playerName} ${win.method === 'ko1' ? 'R1 KO' : 'win'} taken back`
            : 'You can still restore it here.',
        duration: 3000,
      });
      emitChanged();
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't remove", text: err.message });
    }
  }

  async function restore(win) {
    try {
      await api.post(`/wins/${win.id}/restore`);
      toast({ kind: 'ok', title: 'Restored', text: `${win.playerName} +${win.points} counts again`, duration: 3000 });
      emitChanged();
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't restore", text: err.message });
    }
  }

  load();
  const stopPolling = whileVisible(30000, load);
  const stopListening = onChanged(() => load());
  return () => {
    alive = false;
    stopPolling();
    stopListening();
  };
}
