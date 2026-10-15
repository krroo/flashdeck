const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  notes: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
};

export function icon(name, size = 20) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'icon');
  s.innerHTML = PATHS[name] || '';
  return s;
}

function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

// h('div', {class:'x', onclick: fn}, child, child...) — 항상 textContent 계열만 사용 (innerHTML 금지)
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role') el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
