import { api, setUnauthorizedHandler } from './api.js';
import { clear, h, icon, replace } from './dom.js';
import { avatar, emptyState, toast } from './ui.js';
import * as accountView from './views/account.js';
import * as boardView from './views/board.js';
import * as historyView from './views/history.js';
import * as loginView from './views/login.js';
import * as registerView from './views/register.js';

const ROUTES = {
  '/': { view: boardView, tab: 'board', title: 'Scoreboard' },
  '/register': { view: registerView, tab: 'register', title: 'Register' },
  '/history': { view: historyView, tab: 'history', title: 'History' },
  '/account': { view: accountView, tab: 'account', title: 'Me' },
};

const root = document.getElementById('app');
let session = null;
let shell = null;
let unmount = null;
let afterLogin = '/';

function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  render();
}

function buildShell() {
  const tabs = {};
  const tab = (key, href, iconName, label) =>
    (tabs[key] = h(
      'a',
      { href, class: `tab tab-${key}` },
      icon(iconName, 'tab-icon'),
      h('span', { class: 'tab-label' }, label),
    ));
  const me = h('a', { href: '/account', class: 'me-chip', 'aria-label': 'Your account' });
  const main = h('main', { class: 'view', id: 'view' });
  const el = h(
    'div',
    { class: 'shell' },
    h(
      'header',
      { class: 'topbar' },
      h(
        'a',
        { href: '/', class: 'brand' },
        icon('logo', 'brand-logo'),
        h('span', { class: 'brand-name' }, session.app.name),
      ),
      me,
    ),
    main,
    h(
      'nav',
      { class: 'tabbar', 'aria-label': 'Main' },
      tab('board', '/', 'podium', 'Board'),
      tab('register', '/register', 'plus', 'Register'),
      tab('history', '/history', 'clock', 'History'),
      tab('account', '/account', 'user', 'Me'),
    ),
  );
  return { el, main, tabs, me };
}

function render() {
  const path = location.pathname;
  const loggedIn = Boolean(session.player);
  if (!loggedIn && path !== '/login') {
    if (ROUTES[path]) afterLogin = path;
    return navigate('/login', { replace: true });
  }
  if (loggedIn && (path === '/login' || !ROUTES[path])) return navigate('/', { replace: true });

  unmount?.();
  unmount = null;

  if (!loggedIn) {
    shell = null;
    const screen = h('div', { class: 'login-screen' });
    clear(root).append(screen);
    document.title = session.app.name;
    unmount = loginView.mount(screen, context()) ?? null;
    return;
  }

  const route = ROUTES[path];
  if (!shell) {
    shell = buildShell();
    clear(root).append(shell.el);
  }
  replace(shell.me, avatar(session.player, 'avatar-sm'), h('span', { class: 'me-name' }, session.player.name));
  for (const [key, el] of Object.entries(shell.tabs)) {
    const active = key === route.tab;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  clear(shell.main);
  window.scrollTo(0, 0);
  document.title = `${route.title} · ${session.app.name}`;
  unmount = route.view.mount(shell.main, context()) ?? null;
}

async function refreshSession() {
  session = await api.get('/session');
}

function context() {
  return {
    session,
    api,
    toast,
    navigate,
    async onLogin() {
      await refreshSession();
      const target = afterLogin;
      afterLogin = '/';
      navigate(target, { replace: true });
    },
    async logout() {
      try {
        await api.post('/logout');
      } catch {
        // logging out locally is what matters
      }
      session.player = null;
      navigate('/login', { replace: true });
    },
  };
}

// In-app links: no full page reloads.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="/"]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(link.getAttribute('href'));
});
window.addEventListener('popstate', () => session && render());

setUnauthorizedHandler(() => {
  if (!session?.player) return;
  session.player = null;
  if (ROUTES[location.pathname]) afterLogin = location.pathname;
  toast({ kind: 'info', title: 'Logged out', text: 'Please log in again.' });
  navigate('/login', { replace: true });
});

async function boot() {
  try {
    await refreshSession();
  } catch (err) {
    clear(root).append(
      h(
        'div',
        { class: 'login-screen' },
        emptyState({
          iconName: 'alert',
          title: "Can't reach the scoreboard",
          text: err.message,
          action: h('button', { type: 'button', class: 'btn btn-primary', onclick: boot }, 'Try again'),
        }),
      ),
    );
    return;
  }
  render();
}

boot();
