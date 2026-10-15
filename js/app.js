import { h, icon } from './dom.js';
import * as db from './db.js';
import { importFile, deckIdFor } from './importer.js';
import { INTERVAL_DAYS, REQUEUE, nextDue, isDue, buildQueue, shuffle } from './sched.js';
import { renderer, answerNodes, trLabel } from './types.js';

const S = {
  decks: [],
  deck: null,
  cardMap: new Map(),
  progress: new Map(), // `${deckId}|${cardId}` → {rating,last,count,due}
  settings: { fs: 1, order: 'seq', scope: 'due', group: '', deckId: null },
  view: 'home',
  session: null,
  list: { kind: 'wrong', q: '', topic: '' },
  dbOk: true,
  persisted: null,
  lastBackup: null,
};
const $app = document.getElementById('app');

/* ---------- 상태 / 저장 ---------- */

async function loadAll() {
  S.decks = [];
  S.progress = new Map();
  try {
    await db.openDB();
    const st = await db.getMeta('settings', null);
    if (st) Object.assign(S.settings, st);
    S.lastBackup = await db.getMeta('lastBackup', null);
    S.decks = await db.getAll('decks');
    for (const p of await db.getAll('progress')) S.progress.set(p.key, p);
  } catch (e) {
    S.dbOk = false;
    console.error(e);
  }
  pickDeck(S.settings.deckId);
}

function pickDeck(id) {
  S.deck = S.decks.find((d) => d.id === id) || S.decks[0] || null;
  S.cardMap = new Map((S.deck?.cards || []).map((c) => [c.id, c]));
  S.settings.deckId = S.deck?.id || null;
  if (S.deck && S.settings.group && !S.deck.cards.some((c) => c.group === S.settings.group)) S.settings.group = '';
}

function saveSettings() {
  if (S.dbOk) db.setMeta('settings', S.settings).catch(() => {});
}

function applyFs() {
  document.documentElement.style.setProperty('--fs', S.settings.fs);
}

function changeFs(d) {
  S.settings.fs = Math.min(1.8, Math.max(0.8, Math.round((S.settings.fs + d) * 10) / 10));
  applyFs();
  saveSettings();
}

const prog = (cardId) => S.progress.get(S.deck.id + '|' + cardId);

function record(cardId, rating) {
  const key = S.deck.id + '|' + cardId;
  const old = S.progress.get(key) || { key, deckId: S.deck.id, cardId, rating: 0, count: 0, last: 0, due: 0 };
  const now = Date.now();
  const p = { ...old, rating, count: old.count + 1, last: now, due: nextDue(rating, now) };
  S.progress.set(key, p);
  if (S.dbOk) {
    db.put('progress', p).catch((e) => {
      S.dbOk = false;
      toast('저장 실패: ' + e.message);
    });
  }
}

function stats(cards) {
  const now = Date.now();
  const r = { total: cards.length, mem: 0, unsure: 0, bad: 0, fresh: 0, due: 0 };
  for (const c of cards) {
    const p = prog(c.id);
    const k = p?.rating || 0;
    if (k === 3) r.mem++;
    else if (k === 2) r.unsure++;
    else if (k === 1) r.bad++;
    else r.fresh++;
    if (isDue(p, now)) r.due++;
  }
  return r;
}

const groupCards = () => (S.deck ? S.deck.cards.filter((c) => !S.settings.group || c.group === S.settings.group) : []);
const uniq = (arr) => [...new Set(arr)];

/* ---------- 공용 UI ---------- */

let toastT;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

function modal(title, content, buttons = [{ label: '확인', primary: true }]) {
  const dlg = h('dialog', { class: 'dlg' },
    h('h2', {}, title),
    h('div', { class: 'dlg-body' }, content),
    h('div', { class: 'dlg-actions' }, buttons.map((b) => h('button', {
      class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
      onclick: () => { dlg.close(); b.run?.(); },
    }, b.label))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function seg(label, options, val, on) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, t]) => h('button', { class: 'segbtn', 'aria-pressed': String(v === val), onclick: () => on(v) }, t)));
}

function meter(st) {
  const part = (cls, n) => (n ? h('span', { class: 'm-' + cls, style: `flex:${n}` }) : null);
  return h('div', {
    class: 'meter', role: 'img',
    'aria-label': `외움 ${st.mem}, 애매함 ${st.unsure}, 못 외움 ${st.bad}, 새 카드 ${st.fresh}`,
  }, part('mem', st.mem), part('unsure', st.unsure), part('bad', st.bad), part('fresh', st.fresh));
}

const legend = (st) => `외움 ${st.mem} · 애매 ${st.unsure} · 못 외움 ${st.bad} · 새 카드 ${st.fresh}`;

function ratingBadge(p) {
  const r = p?.rating || 0;
  const map = { 0: ['', '새 카드', 'r0'], 1: ['x', '못 외움', 'r1'], 2: ['question', '애매함', 'r2'], 3: ['check', '외움', 'r3'] };
  const [ic, t, cls] = map[r];
  return h('span', { class: 'badge ' + cls }, ic ? icon(ic, 14) : null, t);
}

/* ---------- 라우팅 ---------- */

function go(view, opts = {}) {
  S.view = view;
  if (opts.replace) history.replaceState({ view }, '');
  else history.pushState({ view }, '');
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', (e) => {
  S.view = e.state?.view || 'home';
  if (S.view === 'study' && !S.session) S.view = 'home';
  render();
});

const NAV = [['home', '홈', 'home'], ['list', '오답노트', 'notes'], ['settings', '설정', 'settings']];

function openNav(v) {
  if (v === 'list') S.list = { kind: 'wrong', q: '', topic: '' };
  S.session = null;
  go(v);
}

function navButtons(cls) {
  return NAV.map(([v, label, ic]) => h('button', {
    class: cls + (S.view === v ? ' active' : ''),
    'aria-current': S.view === v ? 'page' : null,
    onclick: () => openNav(v),
  }, icon(ic, 22), h('span', {}, label)));
}

function render() {
  const view = S.view;
  const main = view === 'study' ? studyView() : view === 'list' ? listView() : view === 'settings' ? settingsView() : homeView();
  const studying = S.view === 'study';
  $app.replaceChildren(h('div', { class: 'shell' + (studying ? ' studying' : '') },
    sideView(),
    h('main', { class: 'main' }, main),
    studying ? null : h('nav', { class: 'nav', 'aria-label': '메뉴' }, navButtons('navbtn'))));
}

function sideView() {
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, 'FlashDeck'),
    h('nav', { class: 'sidenav', 'aria-label': '메뉴' }, navButtons('sidebtn')));
  if (S.deck) {
    side.append(h('div', { class: 'side-title' }, S.deck.title));
    for (const t of topicList()) {
      side.append(h('button', { class: 'sidetopic', onclick: () => startTopic(t.topic) },
        h('span', { class: 'st-name' }, t.topic),
        h('span', { class: 'st-n' }, `${t.st.total}`),
        meter(t.st)));
    }
  }
  return side;
}

function topicList() {
  const cards = groupCards();
  return uniq(cards.map((c) => c.topic)).map((topic) => {
    const tc = cards.filter((c) => c.topic === topic);
    return { topic, cards: tc, st: stats(tc) };
  });
}

/* ---------- 학습 세션 시작 ---------- */

function startStudy(cards, label, opts = {}) {
  const mode = opts.mode || S.settings.scope;
  const order = opts.order || S.settings.order;
  let ids = buildQueue(cards, prog, { mode, order });
  if (!ids.length) {
    if (mode === 'due') {
      modal('오늘 복습할 카드가 없어요', h('p', {}, '이 범위의 카드는 모두 다음 복습일이 남아 있어요. 전체 카드로 학습할 수 있어요.'),
        [{ label: '닫기' }, { label: '전체 카드로 학습', primary: true, run: () => startStudy(cards, label, { ...opts, mode: 'all' }) }]);
    } else toast('학습할 카드가 없어요');
    return;
  }
  if (opts.startId) {
    const i = ids.indexOf(opts.startId);
    if (i > 0) ids = order === 'random' ? [opts.startId, ...shuffle(ids.filter((x) => x !== opts.startId))] : ids.slice(i).concat(ids.slice(0, i));
  }
  S.session = {
    queue: [...ids], base: [...ids], pos: 0, label,
    stats: { 1: 0, 2: 0, 3: 0 }, requeued: new Map(), cur: null, from: S.view,
  };
  go('study');
}

function startTopic(topic) {
  startStudy(groupCards().filter((c) => c.topic === topic), topic);
}

/* ---------- 홈 ---------- */

function banners() {
  const out = [];
  if (!S.dbOk) out.push(h('div', { class: 'banner bad' }, '이 브라우저에서는 저장소를 쓸 수 없어서 진행 상황이 저장되지 않아요. 사생활 보호 모드이거나 저장소가 차단된 상태일 수 있어요.'));
  else if (!S.lastBackup && S.progress.size >= 10) {
    out.push(h('div', { class: 'banner' }, '아직 백업한 적이 없어요. ', h('button', { class: 'link', onclick: () => openNav('settings') }, '설정에서 백업하기')));
  }
  return out;
}

function importButton(label = '덱 파일 가져오기', cls = 'btn') {
  const input = h('input', {
    type: 'file', multiple: true, accept: '.json,.csv,.tsv,application/json,text/csv', hidden: true,
    onchange: () => { const f = [...input.files]; input.value = ''; if (f.length) importFiles(f); },
  });
  return h('span', { class: 'inline' }, input, h('button', { class: cls, onclick: () => input.click() }, icon('upload', 18), label));
}

function homeView() {
  const page = h('div', { class: 'page' });
  banners().forEach((b) => page.append(b));
  if (!S.deck) {
    page.append(h('div', { class: 'empty' },
      h('h1', {}, '아직 덱이 없어요'),
      h('p', {}, '문제 덱 파일(.json 또는 .csv)을 가져오면 이 기기에만 저장돼요. 서버로 전송되지 않아요.'),
      importButton('덱 파일 가져오기', 'btn primary')));
    return page;
  }
  const cards = groupCards();
  const st = stats(cards);
  const groups = uniq(S.deck.cards.map((c) => c.group));

  page.append(h('header', { class: 'pagehead' },
    S.decks.length > 1
      ? h('select', {
        class: 'deckselect', 'aria-label': '덱 선택',
        onchange: (e) => { pickDeck(e.target.value); saveSettings(); render(); },
      }, S.decks.map((d) => h('option', { value: d.id, selected: d.id === S.deck.id }, d.title)))
      : h('h1', {}, S.deck.title),
    h('button', {
      class: 'iconbtn', 'aria-label': '문제 검색',
      onclick: () => { S.list = { kind: 'all', q: '', topic: '' }; go('list'); setTimeout(() => document.querySelector('.searchbox')?.focus(), 50); },
    }, icon('search', 22))));

  page.append(h('section', { class: 'card summary' },
    h('div', { class: 'sum-top' },
      h('div', {}, h('div', { class: 'big' }, `${st.total}장`), h('div', { class: 'sub' }, `오늘 복습 ${st.due}장`)),
      h('button', { class: 'btn primary', onclick: () => startStudy(cards, '전체') }, icon('play', 18), '학습 시작')),
    meter(st), h('div', { class: 'legend' }, legend(st))));

  page.append(h('div', { class: 'controls' },
    seg('순서', [['seq', '순서대로'], ['random', '랜덤']], S.settings.order, (v) => { S.settings.order = v; saveSettings(); render(); }),
    seg('범위', [['due', '오늘 복습'], ['all', '전체']], S.settings.scope, (v) => { S.settings.scope = v; saveSettings(); render(); })));

  if (groups.length > 1) {
    page.append(h('div', { class: 'chips', role: 'group', 'aria-label': '그룹 필터' },
      [['', '전체 그룹'], ...groups.map((g) => [g, g])].map(([v, t]) => h('button', {
        class: 'chip', 'aria-pressed': String(S.settings.group === v),
        onclick: () => { S.settings.group = v; saveSettings(); render(); },
      }, t))));
  }

  page.append(h('h2', { class: 'secthead' }, '카테고리를 눌러 학습'));
  for (const t of topicList()) {
    page.append(h('button', { class: 'cat', onclick: () => startTopic(t.topic) },
      h('div', { class: 'cat-main' },
        h('div', { class: 'cat-name' }, t.topic),
        h('div', { class: 'cat-sub' }, `${t.st.total}장 · 오늘 복습 ${t.st.due}장`),
        meter(t.st),
        h('div', { class: 'legend' }, legend(t.st))),
      icon('next', 20)));
  }
  return page;
}

/* ---------- 학습 ---------- */

function studyView() {
  const s = S.session;
  if (!s) return homeView();
  if (s.pos >= s.queue.length) return finishView();
  const id = s.queue[s.pos];
  const card = S.cardMap.get(id);
  const rd = renderer(card.type);
  const cur = { done: false, auto: null, correct: null, rd, ctrl: null, id, busy: false };
  s.cur = cur;

  const body = h('div', { class: 'cardbody' });
  const rateEl = h('div', { class: 'ratebar' });
  cur.draw = () => drawRate(rateEl, cur);
  cur.onDone = (info = {}) => {
    cur.done = true;
    cur.correct = info.correct ?? null;
    if (info.rating) {
      cur.auto = info.rating;
      record(id, info.rating);
      s.stats[info.rating]++;
    }
    cur.draw();
  };
  cur.ctrl = rd.render(card, { body, done: cur.onDone });
  cur.draw();

  const p = prog(id);
  const anim = s.anim;
  s.anim = null;
  const flash = h('div', {
    class: 'flashcard' + (anim ? ' enter-' + anim : ''),
    onclick: () => {
      if (Date.now() - (s.swipedAt || 0) < 400) return;
      if (rd.tapToReveal && !cur.done) cur.ctrl.reveal();
    },
  },
  h('div', { class: 'cardmeta' }, h('span', {}, `${card.group} · ${card.topic}`), ratingBadge(p)),
  body);
  attachSwipe(flash, s);

  return h('div', { class: 'study' },
    h('div', { class: 'studybar' },
      h('button', { class: 'iconbtn', 'aria-label': '나가기', onclick: leaveStudy }, icon('x', 22)),
      h('div', { class: 'count', 'aria-live': 'polite' }, `${s.pos + 1} / ${s.queue.length}`),
      h('div', { class: 'tools' },
        h('button', { class: 'iconbtn', 'aria-label': '이전 카드', onclick: prevCard }, icon('prev', 22)),
        h('button', { class: 'iconbtn', 'aria-label': '건너뛰기', onclick: skipCard }, icon('next', 22)),
        h('button', { class: 'iconbtn txt', 'aria-label': '글자 작게', onclick: () => changeFs(-0.1) }, 'A−'),
        h('button', { class: 'iconbtn txt', 'aria-label': '글자 크게', onclick: () => changeFs(0.1) }, 'A+'))),
    h('div', { class: 'sprogress' }, h('span', { style: `width:${Math.round((s.pos / s.queue.length) * 100)}%` })),
    flash, rateEl);
}

const RATES = [[1, '못 외움', 'x'], [2, '애매함', 'question'], [3, '외움', 'check']];

function drawRate(el, cur) {
  el.replaceChildren();
  if (!cur.done) { el.append(h('div', { class: 'hint' }, cur.rd.hint || '')); return; }
  if (cur.auto) {
    el.append(
      h('div', { class: 'autonote bad' }, icon('x', 16), '오답 · “못 외움”으로 기록했어요'),
      h('button', { class: 'btn primary wide', onclick: () => advance(cur.auto) }, '다음', icon('next', 18)));
    return;
  }
  if (cur.correct === true) el.append(h('div', { class: 'autonote ok' }, icon('check', 16), '정답! 기억 정도를 골라 주세요'));
  el.append(h('div', { class: 'rates' }, RATES.map(([r, label, ic]) => h('button', {
    class: `rate r${r}` + (cur.correct === true && r === 3 ? ' suggest' : ''),
    onclick: () => rate(r),
  }, h('span', { class: 'ic' }, icon(ic, 22)), h('span', { class: 'lb' }, label), h('kbd', {}, String(r))))));
}

function requeue(r) {
  const s = S.session;
  const rule = REQUEUE[r];
  if (!rule) return;
  const id = s.queue[s.pos];
  const key = id + '|' + r;
  const n = s.requeued.get(key) || 0;
  if (n >= rule.max) return;
  s.requeued.set(key, n + 1);
  const lo = Math.min(s.queue.length, s.pos + 1 + rule.min);
  const at = lo + Math.floor(Math.random() * (s.queue.length - lo + 1));
  s.queue.splice(at, 0, id);
}

function rate(r) {
  const s = S.session;
  const cur = s?.cur;
  if (!cur || !cur.done || cur.busy) return;
  cur.busy = true;
  record(cur.id, r);
  s.stats[r]++;
  requeue(r);
  s.pos++;
  s.anim = 'next';
  render();
}

function advance(r) {
  const s = S.session;
  if (!s?.cur || s.cur.busy) return;
  s.cur.busy = true;
  requeue(r);
  s.pos++;
  s.anim = 'next';
  render();
}

function prevCard() {
  const s = S.session;
  if (s && s.pos > 0) { s.pos--; s.anim = 'prev'; render(); }
}

function skipCard() {
  const s = S.session;
  if (s && s.pos < s.queue.length) { s.pos++; s.anim = 'next'; render(); }
}

// 터치로 가로 스와이프: 왼쪽으로 밀면 다음(평가 없이 건너뜀), 오른쪽으로 밀면 이전.
// 세로 스크롤(긴 답)은 touch-action: pan-y 로 그대로 두고, 버튼/보기 위에서 시작한 제스처는 무시.
function attachSwipe(el, s) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('button,a,input,select,.opt')) { start = null; return; }
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  el.addEventListener('pointercancel', () => { start = null; });
  el.addEventListener('pointerup', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    s.swipedAt = Date.now();
    if (dx < 0) skipCard(); else prevCard();
  });
}

function leaveStudy() {
  const to = S.session?.from === 'list' ? 'list' : 'home';
  S.session = null;
  go(to, { replace: true });
}

function finishView() {
  const s = S.session;
  const left = s.base.filter((id) => { const r = prog(id)?.rating; return r === 1 || r === 2; });
  const total = s.stats[1] + s.stats[2] + s.stats[3];
  return h('div', { class: 'page finish' },
    h('h1', {}, '학습 끝'),
    h('p', { class: 'sub' }, `${s.label} · ${total}번 평가`),
    h('div', { class: 'tally' },
      h('div', {}, icon('check', 20), h('b', {}, String(s.stats[3])), '외움'),
      h('div', {}, icon('question', 20), h('b', {}, String(s.stats[2])), '애매함'),
      h('div', {}, icon('x', 20), h('b', {}, String(s.stats[1])), '못 외움')),
    left.length
      ? h('button', {
        class: 'btn primary wide',
        onclick: () => startStudy(left.map((id) => S.cardMap.get(id)), '남은 오답', { mode: 'all' }),
      }, `남은 오답 ${left.length}장 다시 학습`)
      : h('p', {}, '이 범위에 남은 오답이 없어요.'),
    h('button', { class: 'btn wide', onclick: leaveStudy }, '돌아가기'));
}

document.addEventListener('keydown', (e) => {
  if (S.view !== 'study' || !S.session || document.querySelector('dialog[open]')) return;
  if (e.target.matches?.('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = S.session;
  const cur = s.cur;
  if (!cur || s.pos >= s.queue.length) return;
  if (!cur.done && cur.ctrl?.key?.(e)) { e.preventDefault(); return; }
  if (e.key === ' ' || e.key === 'Enter') {
    if (e.target.matches?.('button') && e.key === 'Enter') return;
    e.preventDefault();
    if (!cur.done) { if (cur.rd.tapToReveal) cur.ctrl.reveal(); } else if (cur.auto) advance(cur.auto);
  } else if (['1', '2', '3'].includes(e.key)) {
    if (cur.done && !cur.auto) rate(+e.key);
  } else if (e.key === 'ArrowRight') skipCard();
  else if (e.key === 'ArrowLeft') prevCard();
  else if (e.key === 'Escape') leaveStudy();
});

/* ---------- 오답노트 / 검색 목록 ---------- */

function answerPlain(card) {
  return answerNodes(card);
}

function listView() {
  const L = S.list;
  const page = h('div', { class: 'page' });
  if (!S.deck) {
    page.append(h('div', { class: 'empty' }, h('h1', {}, '아직 덱이 없어요'), importButton('덱 파일 가져오기', 'btn primary')));
    return page;
  }
  const isWrong = () => L.kind === 'wrong';
  const topics = uniq(S.deck.cards.map((c) => c.topic));

  const countEl = h('div', { class: 'sub' });
  const startWrap = h('div', { class: 'startwrap' });
  const itemsEl = h('div', { class: 'items' });

  function filtered() {
    const q = L.q.trim().toLowerCase();
    return S.deck.cards.filter((c) => {
      if (isWrong()) { const r = prog(c.id)?.rating; if (r !== 1 && r !== 2) return false; }
      if (L.topic && c.topic !== L.topic) return false;
      if (q && !c.question.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function draw() {
    const cards = filtered();
    const st = stats(S.deck.cards);
    countEl.textContent = isWrong()
      ? `못 외움 ${st.bad} · 애매함 ${st.unsure} — 표시 ${cards.length}장`
      : `표시 ${cards.length}장 / 전체 ${S.deck.cards.length}장`;
    startWrap.replaceChildren(h('button', {
      class: 'btn primary wide',
      onclick: () => startStudy(cards, isWrong() ? '오답노트' : '검색 결과', { mode: 'all' }),
    }, icon('play', 18), `${isWrong() ? '오답 ' : ''}${cards.length}장 연속 학습`));
    if (!cards.length) {
      startWrap.replaceChildren();
      itemsEl.replaceChildren(h('div', { class: 'empty small' }, isWrong() && !L.q && !L.topic
        ? '오답으로 표시된 카드가 없어요. 학습하며 “못 외움”이나 “애매함”을 고르면 여기에 모여요.'
        : '조건에 맞는 카드가 없어요.'));
      return;
    }
    itemsEl.replaceChildren(...cards.map((c) => {
      const open = () => startStudy(cards, isWrong() ? '오답노트' : '검색 결과', { mode: 'all', startId: c.id });
      return h('div', {
        class: 'item', role: 'button', tabindex: 0, onclick: open,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
      },
      h('div', { class: 'item-top' }, ratingBadge(prog(c.id)), h('span', { class: 'item-topic' }, c.topic)),
      h('div', { class: 'item-q' }, c.question, c.questionTranslated ? trLabel() : null),
      h('div', { class: 'item-a' }, answerPlain(c)));
    }));
  }

  page.append(
    h('header', { class: 'pagehead' }, h('h1', {}, isWrong() ? '오답노트' : '문제 검색')),
    seg('보기', [['wrong', '오답만'], ['all', '전체']], L.kind, (v) => { L.kind = v; render(); }),
    countEl,
    h('div', { class: 'filters' },
      h('input', {
        class: 'searchbox', type: 'search', placeholder: '질문 검색', value: L.q, 'aria-label': '질문 검색',
        oninput: (e) => { L.q = e.target.value; draw(); },
      }),
      h('select', { 'aria-label': '주제 필터', onchange: (e) => { L.topic = e.target.value; draw(); } },
        h('option', { value: '' }, '모든 주제'),
        topics.map((t) => h('option', { value: t, selected: t === L.topic }, t)))),
    startWrap, itemsEl);
  draw();
  return page;
}

/* ---------- 가져오기 ---------- */

async function importFiles(files) {
  const results = [];
  let last = null;
  for (const f of files) {
    const r = await importFile(f);
    if (!r.errors.length) {
      const id = deckIdFor(r.deck.title);
      const existing = S.decks.find((d) => d.id === id);
      const deck = { id, title: r.deck.title, language: r.deck.language, cards: r.deck.cards, importedAt: Date.now() };
      try {
        if (S.dbOk) await db.put('decks', deck);
        if (existing) S.decks[S.decks.indexOf(existing)] = deck; else S.decks.push(deck);
        r.updated = !!existing;
        r.count = deck.cards.length;
        r.title = deck.title;
        last = id;
      } catch (e) {
        r.errors.push('저장 실패: ' + e.message);
      }
    }
    results.push({ name: f.name, ...r });
  }
  if (last) {
    pickDeck(last);
    saveSettings();
  }
  render();
  modal('가져오기 결과', results.map((r) => h('div', { class: 'imp' },
    h('div', { class: 'imp-title ' + (r.errors.length ? 'bad' : 'ok') },
      icon(r.errors.length ? 'x' : 'check', 18),
      r.errors.length ? `${r.name} — 가져오지 못했어요` : `${r.title} — ${r.count}장 ${r.updated ? '(기존 덱 갱신, 진행 유지)' : '추가'}`),
    r.errors.length ? h('ul', {}, r.errors.slice(0, 30).map((m) => h('li', {}, m)), r.errors.length > 30 ? h('li', {}, `… 외 ${r.errors.length - 30}건`) : null) : null,
    r.warnings?.length ? h('ul', { class: 'warn' }, r.warnings.map((m) => h('li', {}, m))) : null)));
}

/* ---------- 백업 / 복원 ---------- */

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function exportBackup() {
  const data = {
    format: 'flashdeck-backup', version: 1, exportedAt: new Date().toISOString(),
    settings: S.settings, decks: S.decks, progress: [...S.progress.values()],
  };
  const name = `flashdeck-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  let ok = true;
  const file = new File([blob], name, { type: 'application/json' });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch { ok = false; }
  } else {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  if (ok) {
    S.lastBackup = Date.now();
    if (S.dbOk) await db.setMeta('lastBackup', S.lastBackup).catch(() => {});
    toast('백업 파일을 만들었어요');
    render();
  }
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('백업 파일을 읽을 수 없어요'); return; }
  if (data?.format !== 'flashdeck-backup' || !Array.isArray(data.decks) || !Array.isArray(data.progress)) {
    toast('FlashDeck 백업 파일이 아니에요');
    return;
  }
  modal('백업에서 복원할까요?',
    h('p', {}, `덱 ${data.decks.length}개, 진행 기록 ${data.progress.length}건을 불러와요. 지금 이 기기의 덱과 진행 기록은 모두 교체돼요.`),
    [{ label: '취소' }, {
      label: '복원', primary: true, run: async () => {
        try {
          await db.clear('decks'); await db.clear('progress');
          await db.putMany('decks', data.decks);
          await db.putMany('progress', data.progress.filter((p) => p?.key && p.deckId));
          await db.setMeta('settings', { ...S.settings, ...(data.settings || {}) });
          await loadAll();
          applyFs();
          S.session = null;
          go('home', { replace: true });
          toast('복원했어요');
        } catch (e) { toast('복원 실패: ' + e.message); }
      },
    }]);
}

async function requestPersist() {
  if (navigator.storage?.persist) {
    S.persisted = await navigator.storage.persist().catch(() => false);
    render();
    toast(S.persisted ? '영구 저장이 허용됐어요' : '브라우저가 영구 저장을 허용하지 않았어요');
  }
}

/* ---------- 설정 ---------- */

const fmt = (ts) => new Date(ts).toLocaleString('ko-KR');

function settingsView() {
  const page = h('div', { class: 'page' });
  banners().forEach((b) => page.append(b));
  page.append(h('header', { class: 'pagehead' }, h('h1', {}, '설정')));

  page.append(h('section', { class: 'card' },
    h('h2', {}, '글자 크기'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { changeFs(-0.1); render(); } }, 'A−'),
      h('span', { class: 'sub' }, `${Math.round(S.settings.fs * 100)}%`),
      h('button', { class: 'btn', onclick: () => { changeFs(0.1); render(); } }, 'A+'))));

  const fileInput = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) restoreBackup(f); },
  });
  page.append(h('section', { class: 'card' },
    h('h2', {}, '덱'),
    h('p', { class: 'sub' }, 'JSON(flashdeck) 또는 CSV 파일을 이 기기로 가져와요. 같은 제목의 덱을 다시 가져오면 진행 기록은 그대로 유지돼요.'),
    importButton(),
    S.decks.map((d) => h('div', { class: 'deckrow' },
      h('div', {}, h('div', { class: 'cat-name' }, d.title), h('div', { class: 'sub' }, `${d.cards.length}장`)),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn small', onclick: () => modal(`“${d.title}” 진행 기록을 지울까요?`, h('p', {}, '카드는 남고 평가 기록만 초기화돼요.'), [{ label: '취소' }, {
            label: '진행 초기화', danger: true, run: async () => {
              await db.deleteProgressOfDeck(d.id).catch(() => {});
              for (const k of [...S.progress.keys()]) if (k.startsWith(d.id + '|')) S.progress.delete(k);
              render(); toast('진행 기록을 초기화했어요');
            },
          }]),
        }, '진행 초기화'),
        h('button', {
          class: 'btn small danger', 'aria-label': `${d.title} 삭제`,
          onclick: () => modal(`“${d.title}” 덱을 삭제할까요?`, h('p', {}, '카드와 진행 기록이 이 기기에서 삭제돼요. 백업이 없으면 되돌릴 수 없어요.'), [{ label: '취소' }, {
            label: '삭제', danger: true, run: async () => {
              await db.del('decks', d.id).catch(() => {});
              await db.deleteProgressOfDeck(d.id).catch(() => {});
              S.decks = S.decks.filter((x) => x.id !== d.id);
              for (const k of [...S.progress.keys()]) if (k.startsWith(d.id + '|')) S.progress.delete(k);
              pickDeck(S.settings.deckId); saveSettings(); render(); toast('삭제했어요');
            },
          }]),
        }, icon('trash', 16)))))));

  page.append(h('section', { class: 'card' },
    h('h2', {}, '백업 / 복원'),
    h('p', { class: 'sub' }, S.lastBackup ? `마지막 백업: ${fmt(S.lastBackup)}` : '아직 백업한 적이 없어요.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: exportBackup }, icon('download', 18), '백업 내보내기'),
      fileInput, h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('upload', 18), '백업에서 복원')),
    h('p', { class: 'sub' }, '백업 파일에는 덱과 진행 기록이 모두 들어 있어요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 받아 두세요.')));

  page.append(h('section', { class: 'card' },
    h('h2', {}, '저장소 상태'),
    h('p', {}, S.dbOk ? '저장소: 사용 가능' : '저장소: 사용할 수 없음 (진행이 저장되지 않아요)'),
    h('p', {}, S.persisted === true ? '영구 저장: 허용됨' : S.persisted === false ? '영구 저장: 허용되지 않음 (브라우저가 공간이 부족할 때 데이터를 지울 수 있어요)' : '영구 저장: 확인할 수 없음'),
    navigator.storage?.persist && S.persisted !== true ? h('button', { class: 'btn', onclick: requestPersist }, '영구 저장 요청') : null));

  page.append(h('section', { class: 'card' },
    h('h2', {}, '복습 주기'),
    h('p', { class: 'sub' }, `못 외움: 매 세션 · 애매함: ${INTERVAL_DAYS[2]}일 뒤 · 외움: ${INTERVAL_DAYS[3]}일 뒤에 다시 등장해요. (js/sched.js에서 조정)`),
    h('p', { class: 'sub' }, '키보드: Space 정답 공개 · 1/2/3 평가 · ← → 이전/건너뛰기 · Esc 나가기')));
  return page;
}

/* ---------- 시작 ---------- */

async function init() {
  await loadAll();
  applyFs();
  if (navigator.storage?.persisted) S.persisted = await navigator.storage.persisted().catch(() => null);
  if (S.persisted === false && navigator.storage?.persist) S.persisted = await navigator.storage.persist().catch(() => false);
  history.replaceState({ view: 'home' }, '');
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
