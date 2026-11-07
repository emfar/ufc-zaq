// Tiny DOM helpers. Everything dynamic goes through text nodes, so names and
// other data can never be interpreted as HTML.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style') Object.assign(el.style, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Like el.replaceChildren(), but skips null/false (the native one would print "null"). */
export function replace(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export const initial = (name) => (name ? [...name.trim()][0].toUpperCase() : '?');

// Static, hand-drawn 24×24 icons (no user data ever goes in here).
const ICONS = {
  // Themed (UFC-style) icons — the app icon set lives in public/icons/.
  logo:
    '<path d="M8.4 1.8h7.2l5.1 5.1v7.2l-5.1 5.1H8.4l-5.1-5.1V6.9z" transform="translate(0 1.5)" stroke-width="2.2"/>' +
    '<path d="M7 15.5h10l1-6.5-3.4 2.6L12 7.5l-2.6 4.1L6 9z" fill="currentColor" stroke="none"/>',
  board: '<path d="M3 21h18"/><path d="M5 21v-6h4v6"/><path d="M10 21V8h4v13"/><path d="M15 21v-9h4v9"/>',
  register: '<path d="M12 5v14M5 12h14"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  rules: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  champion: '<path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-1.8 10H4.8z" fill="currentColor" stroke-width="1.5"/>',
  trophy:
    '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v1.5A4.5 4.5 0 0 1 16 11M7 5H4v1.5A4.5 4.5 0 0 0 8 11"/>',
  ko: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor" stroke-width="1.5"/>',
  win: '<path d="M20 6L9 17l-5-5"/>',
  // Plain utility icons
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  restore: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
};

export function icon(name, className = '') {
  const span = document.createElement('span');
  span.className = `icon ${className}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}
