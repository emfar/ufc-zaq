import { h, icon, replace } from '../dom.js';
import { avatar } from '../ui.js';

const LAST_NAME_KEY = 'ufc:last-name';

function remembered() {
  try {
    return localStorage.getItem(LAST_NAME_KEY);
  } catch {
    return null;
  }
}

function remember(name) {
  try {
    localStorage.setItem(LAST_NAME_KEY, name);
  } catch {
    // private mode etc. — not important
  }
}

export function mount(root, ctx) {
  const { api, session, onLogin } = ctx;
  let selected = session.players.find((p) => p.name === remembered()) ?? null;

  const username = h('input', {
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  const password = h('input', {
    class: 'input',
    type: 'password',
    name: 'password',
    id: 'password',
    autocomplete: 'current-password',
    placeholder: 'Password',
    'aria-label': 'Password',
    maxlength: '128',
  });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block btn-lg' });
  const error = h('p', { class: 'form-msg form-msg-error', role: 'alert' });

  const picks = session.players.map((p) => {
    const btn = h(
      'button',
      { type: 'button', class: 'pick', 'aria-pressed': 'false', onclick: () => select(p, true) },
      avatar(p),
      h('span', { class: 'pick-name' }, p.name),
    );
    return { player: p, btn };
  });

  function select(player, focus) {
    selected = player;
    username.value = player.name;
    for (const { player: p, btn } of picks) {
      btn.classList.toggle('is-selected', p.id === player.id);
      btn.setAttribute('aria-pressed', String(p.id === player.id));
    }
    replace(submit, `Enter as ${player.name}`);
    error.textContent = '';
    if (focus) password.focus();
  }

  const form = h(
    'form',
    { class: 'login-form', novalidate: true },
    h('p', { class: 'login-ask' }, "Who's fighting?"),
    h(
      'div',
      { class: 'pick-grid' },
      picks.map((p) => p.btn),
    ),
    username,
    password,
    error,
    submit,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selected) {
      error.textContent = 'Tap your name first';
      return;
    }
    if (!password.value) {
      error.textContent = 'Enter your password';
      password.focus();
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    try {
      await api.post('/login', { name: selected.name, password: password.value });
      remember(selected.name);
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
    ),
  );

  if (selected) select(selected, false);
  else replace(submit, 'Enter the octagon');
}
