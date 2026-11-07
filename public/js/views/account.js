import { h, icon } from '../dom.js';
import { plural } from '../format.js';
import { avatar } from '../ui.js';

export function mount(root, ctx) {
  const { api, session, toast, logout } = ctx;
  const me = session.player;

  const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  const pw = (name, autocomplete) =>
    h('input', { class: 'input', type: 'password', name, autocomplete, required: true, maxlength: '128' });

  const current = pw('current-password', 'current-password');
  const next = pw('new-password', 'new-password');
  const confirm = pw('confirm-password', 'new-password');
  const username = h('input', {
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    value: me.name,
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    readonly: true,
  });
  const message = h('p', { class: 'form-msg', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('lock'), 'Change password');

  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    h('h2', { class: 'section-title' }, 'Change password'),
    username,
    field('Current password', current),
    field('New password (6+ characters)', next),
    field('New password again', confirm),
    message,
    save,
  );

  const say = (text, kind = 'error') => {
    message.textContent = text;
    message.className = `form-msg form-msg-${kind}`;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (text, input) => {
      say(text);
      input.focus();
    };
    if (!current.value) return fail('Enter your current password', current);
    if ([...next.value].length < 6) return fail('Use at least 6 characters for the new password', next);
    if (next.value !== confirm.value) return fail("The new passwords don't match", confirm);
    save.disabled = true;
    say('');
    try {
      await api.post('/account/password', { currentPassword: current.value, newPassword: next.value });
      form.reset();
      say('Password changed. Other devices were logged out.', 'ok');
      toast({ kind: 'ok', title: 'Password changed' });
    } catch (err) {
      say(err.message);
    } finally {
      save.disabled = false;
    }
  });

  const rules = session.app.rules;
  root.append(
    h(
      'section',
      { class: 'card profile' },
      avatar(me, 'avatar-lg'),
      h(
        'div',
        {},
        h('h1', { class: 'profile-name' }, me.name),
        h('p', { class: 'profile-sub' }, `Logged in to ${session.app.name}`),
      ),
    ),
    form,
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'section-title' }, 'Rules'),
      h(
        'ul',
        { class: 'rules-list' },
        rules.methods.map((m) => h('li', {}, h('b', {}, m.label), ` — ${plural(m.points, 'point')}`)),
        h('li', {}, rules.tiebreak),
        h('li', {}, `Months run on ${session.app.timezone.replace(/_/g, ' ')} time.`),
        h('li', {}, 'Anyone can register or remove a win; History shows who did what.'),
      ),
    ),
    h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: logout }, icon('logout'), 'Log out'),
  );
}
