import { h, icon } from '../dom.js';

export function mount(root, ctx) {
  const { api, session, onLogin } = ctx;

  // A fixed, hidden username lets phone password managers save the password.
  const username = h('input', {
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    value: session.app.name,
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    readonly: true,
  });
  const password = h('input', {
    class: 'input input-lg',
    type: 'password',
    name: 'password',
    id: 'password',
    autocomplete: 'current-password',
    placeholder: 'Same for everyone',
    maxlength: '128',
    enterkeyhint: 'go',
  });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block btn-lg' }, 'Enter the octagon');
  const error = h('p', { class: 'form-msg form-msg-error', role: 'alert' });

  const form = h(
    'form',
    { class: 'login-form', novalidate: true },
    h('label', { class: 'login-ask', for: 'password' }, 'Club password'),
    username,
    password,
    error,
    submit,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!password.value) {
      error.textContent = 'Enter the password';
      password.focus();
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    try {
      await api.post('/login', { password: password.value });
      await onLogin();
    } catch (err) {
      error.textContent = err.message;
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  });

  root.append(
    h(
      'div',
      { class: 'login-card' },
      h('div', { class: 'login-logo' }, icon('logo')),
      h('h1', { class: 'login-title' }, session.app.name),
      h('p', { class: 'login-tag' }, 'Monthly fight league'),
      form,
      h(
        'p',
        { class: 'login-roster' },
        session.players.map((p, i) => [i ? h('span', { class: 'dot', 'aria-hidden': 'true' }, ' · ') : null, p.name]),
      ),
    ),
  );
}
