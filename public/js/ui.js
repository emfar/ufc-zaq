import { h, icon, initial, replace } from './dom.js';
import { monthLabel } from './format.js';

// ------------------------------------------------------------------ toast

let toastHost = null;
let dismissCurrent = null;

/**
 * Shows one toast at a time (a new one replaces the old).
 * kind: 'ok' | 'ko' | 'error' | 'info'
 * action: { label, run } — e.g. Undo / Retry
 */
export function toast({ title, text = '', kind = 'ok', action = null, duration = 5000 }) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  dismissCurrent?.();

  const iconName = { ok: 'check', win: 'win', ko: 'ko', error: 'alert', info: 'check' }[kind] ?? 'check';
  const timerBar = h('span', { class: 'toast-timer', style: { animationDuration: `${duration}ms` } });
  const actionBtn =
    action &&
    h(
      'button',
      {
        type: 'button',
        class: 'toast-action',
        onclick: () => {
          dismiss();
          action.run();
        },
      },
      action.icon ? icon(action.icon) : null,
      action.label,
    );

  const el = h(
    'div',
    { class: `toast toast-${kind}` },
    icon(iconName, 'toast-icon'),
    h(
      'div',
      { class: 'toast-body' },
      h('strong', { class: 'toast-title' }, title),
      text && h('span', { class: 'toast-text' }, text),
    ),
    actionBtn,
    timerBar,
  );

  let timer = setTimeout(dismiss, duration);
  function dismiss() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    if (dismissCurrent === dismiss) dismissCurrent = null;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  }
  dismissCurrent = dismiss;
  toastHost.append(el);
  return dismiss;
}

// ------------------------------------------------- two-tap confirm button

/** First tap arms the button ("Remove?"), a second tap within 3s confirms. */
export function confirmButton({ className = '', label, iconName, confirmLabel = 'Remove?', ariaLabel, onConfirm }) {
  let armed = false;
  let timer = null;
  const content = () => [iconName ? icon(iconName) : null, label ? h('span', {}, label) : null];
  const btn = h('button', { type: 'button', class: `confirm-btn ${className}`, 'aria-label': ariaLabel }, content());

  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    btn.classList.remove('is-armed');
    replace(btn, ...content().filter(Boolean));
  };

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    if (!armed) {
      armed = true;
      btn.classList.add('is-armed');
      replace(btn, h('span', {}, confirmLabel));
      timer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    btn.disabled = true;
    try {
      await onConfirm();
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

// ------------------------------------------------------------ month nav

export function monthNav({ month, prevMonth, nextMonth, subtitle, onChange }) {
  const arrow = (target, iconName, label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'month-arrow',
        'aria-label': label,
        disabled: !target,
        onclick: () => target && onChange(target),
      },
      icon(iconName),
    );
  return h(
    'div',
    { class: 'month-nav' },
    arrow(prevMonth, 'chevronLeft', 'Previous month'),
    h(
      'div',
      { class: 'month-nav-center' },
      h('div', { class: 'month-nav-title' }, monthLabel(month)),
      subtitle && h('div', { class: 'month-nav-sub' }, subtitle),
    ),
    arrow(nextMonth, 'chevronRight', 'Next month'),
  );
}

// -------------------------------------------------------------- bits

export function methodBadge(method, points) {
  const ko = method === 'ko1';
  return h(
    'span',
    { class: `badge ${ko ? 'badge-ko' : 'badge-win'}` },
    icon(ko ? 'ko' : 'win'),
    ko ? 'R1 KO' : 'WIN',
    h('b', {}, `+${points}`),
  );
}

/** Round initial with a stable per-player colour (golden-angle hue from the id). */
export function avatar(person, extra = '') {
  const el = h('span', { class: `avatar ${extra}`.trim(), 'aria-hidden': 'true' }, initial(person.name));
  el.style.setProperty('--h', String(Math.round((person.id * 137.508) % 360)));
  return el;
}

export function emptyState({ iconName = 'board', title, text, action }) {
  return h(
    'div',
    { class: 'empty' },
    icon(iconName, 'empty-icon'),
    h('p', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    action,
  );
}

export function errorState(message, retry) {
  return emptyState({
    iconName: 'alert',
    title: "Couldn't load",
    text: message,
    action: h('button', { type: 'button', class: 'btn btn-ghost', onclick: retry }, 'Try again'),
  });
}

// ------------------------------------------------- refresh coordination

/** Runs fn every `ms` while the page is visible, and right away when the
 *  page becomes visible again (phone unlocked, tab switched back). */
export function whileVisible(ms, fn) {
  const tick = () => {
    if (document.visibilityState === 'visible') fn();
  };
  const timer = setInterval(tick, ms);
  document.addEventListener('visibilitychange', tick);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
  };
}

const CHANGED = 'ufc:changed';
/** Tell the current view that scores changed (detail.live = fresh live state, if known). */
export const emitChanged = (detail = {}) => window.dispatchEvent(new CustomEvent(CHANGED, { detail }));
export function onChanged(fn) {
  const handler = (e) => fn(e.detail);
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}
