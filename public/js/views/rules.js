import { h, icon } from '../dom.js';
import { plural } from '../format.js';

export function mount(root, ctx) {
  const { session, logout } = ctx;
  const { rules, timezone } = session.app;

  const section = (title, iconName, ...items) =>
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'section-title' }, iconName ? icon(iconName) : null, title),
      h(
        'ul',
        { class: 'rules-list' },
        items.map((item) => h('li', {}, item)),
      ),
    );

  root.append(
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Rules')),
    section(
      'Scoring',
      'trophy',
      ...rules.methods.map((m) => [h('b', {}, m.label), ` — ${plural(m.points, 'point')}`]),
      'Most points at the end of the month wins the title.',
      rules.tiebreak,
      `Months start at midnight, ${timezone.replace(/_/g, ' ')} time.`,
    ),
    section(
      'Fixing a mistake',
      'history',
      'Wrong tap? Hit Undo on the message that pops up, or × next to the win.',
      'Taking a win back right away on the same phone erases it.',
      'Wins removed later, or from another phone, stay listed in History so anyone can restore them.',
    ),
    section(
      'On your phone',
      'logo',
      'iPhone: Share → Add to Home Screen.',
      'Android: ⋮ menu → Add to Home screen.',
      'Everyone uses the same club password. Changing it logs every phone out.',
    ),
    h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: logout }, icon('logout'), 'Log out'),
  );
}
