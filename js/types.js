// 문제 유형별 렌더러 레지스트리. 새 유형은 register()만 추가하면 됨.
//
// 렌더러 인터페이스:
//   tapToReveal : true면 카드 탭/Space로 정답 공개
//   hint        : 정답 공개 전 하단 안내 문구
//   render(card, ctl) → { reveal?(), key?(event) }
//     ctl.body            : 카드 본문 컨테이너
//     ctl.done({correct?, rating?}) : 답 확인 완료. rating을 주면 그 평가로 자동 기록
import { h, icon } from './dom.js';
import { shuffle } from './sched.js';

const registry = new Map();
export const register = (type, r) => registry.set(type, r);
export const renderer = (type) => registry.get(type) || registry.get('open');

export const trLabel = () => h('span', { class: 'trlabel' }, '번역');

export function questionBlock(card) {
  return h('div', { class: 'q' }, h('span', { class: 'q-text' }, card.question), card.questionTranslated ? trLabel() : null);
}

// 정답 표시 노드 (카드/목록 공용). 답안 텍스트는 그대로 출력, 번역 세그먼트만 주황 + 라벨
export function answerNodes(card) {
  const wrap = h('div', { class: 'answer' });
  if (card.type === 'open') {
    for (const seg of card.answer) {
      if (seg.translated) wrap.append(h('span', { class: 'tr' }, seg.text, trLabel()));
      else wrap.append(document.createTextNode(seg.text));
    }
  } else if (card.type === 'truefalse') {
    wrap.append(card.correct ? 'True' : 'False');
  } else {
    wrap.append(card.correct.map((i) => card.options[i]).join('  /  '));
  }
  if (card.explanation) wrap.append(h('div', { class: 'expl' }, card.explanation));
  if (card.note) wrap.append(h('div', { class: 'note' }, card.note));
  return wrap;
}

register('open', {
  tapToReveal: true,
  hint: '카드를 탭하면 정답이 열려요 (Space)',
  render(card, ctl) {
    const slot = h('div', { class: 'ans-slot' }, h('div', { class: 'placeholder' }, '정답은 아직 가려져 있어요'));
    ctl.body.append(questionBlock(card), slot);
    let shown = false;
    return {
      reveal() {
        if (shown) return;
        shown = true;
        slot.replaceChildren(answerNodes(card));
        ctl.done();
      },
    };
  },
});

function choiceRenderer(type) {
  return {
    tapToReveal: false,
    hint: type === 'multiple' ? '정답을 모두 고르고 “정답 확인”을 누르세요 (숫자키, Enter)' : '보기를 선택하세요 (숫자키)',
    render(card, ctl) {
      const opts = type === 'truefalse'
        ? [{ label: 'True', idx: 1 }, { label: 'False', idx: 0 }]
        : shuffle(card.options.map((label, idx) => ({ label, idx })));
      const correctSet = new Set(type === 'truefalse' ? [card.correct ? 1 : 0] : card.correct);
      const picked = new Set();
      let locked = false;
      const btns = [];
      const list = h('div', { class: 'opts', role: type === 'multiple' ? 'group' : 'radiogroup' });
      const result = h('div', { class: 'result', 'aria-live': 'polite' });
      let confirm = null;

      function grade() {
        if (locked) return;
        if (!picked.size) return;
        locked = true;
        const ok = picked.size === correctSet.size && [...picked].every((x) => correctSet.has(x));
        opts.forEach((o, i) => {
          const b = btns[i];
          b.setAttribute('aria-disabled', 'true');
          const isC = correctSet.has(o.idx);
          const isP = picked.has(o.idx);
          if (isC) { b.classList.add('is-correct'); b.querySelector('.mark').replaceChildren(icon('check', 18), '정답'); }
          else if (isP) { b.classList.add('is-wrong'); b.querySelector('.mark').replaceChildren(icon('x', 18), '오답'); }
        });
        if (confirm) confirm.remove();
        result.replaceChildren(
          h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, icon(ok ? 'check' : 'x', 20), ok ? ' 정답입니다' : ' 오답입니다'),
          card.explanation ? h('div', { class: 'expl' }, card.explanation) : null,
        );
        ctl.done({ correct: ok, rating: ok ? undefined : 1 });
      }

      function choose(i) {
        if (locked) return;
        const o = opts[i];
        const b = btns[i];
        if (type === 'multiple') {
          if (picked.has(o.idx)) picked.delete(o.idx); else picked.add(o.idx);
          b.setAttribute('aria-checked', String(picked.has(o.idx)));
          b.classList.toggle('picked', picked.has(o.idx));
          if (confirm) confirm.classList.toggle('ready', picked.size > 0);
        } else {
          picked.add(o.idx);
          b.setAttribute('aria-checked', 'true');
          b.classList.add('picked');
          grade();
        }
      }

      opts.forEach((o, i) => {
        const b = h('button', {
          class: 'opt',
          role: type === 'multiple' ? 'checkbox' : 'radio',
          'aria-checked': 'false',
          onclick: (e) => { e.stopPropagation(); choose(i); },
        }, h('span', { class: 'optnum' }, String(i + 1)), h('span', { class: 'optlabel' }, o.label), h('span', { class: 'mark' }));
        btns.push(b);
        list.append(b);
      });
      if (type === 'multiple') {
        confirm = h('button', { class: 'btn primary confirm', onclick: (e) => { e.stopPropagation(); grade(); } }, '정답 확인');
      }
      ctl.body.append(questionBlock(card), list, confirm, result);

      return {
        key(e) {
          if (locked) return false;
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= opts.length) { choose(n - 1); return true; }
          if (type === 'multiple' && e.key === 'Enter') { grade(); return true; }
          return false;
        },
      };
    },
  };
}

register('truefalse', choiceRenderer('truefalse'));
register('single', choiceRenderer('single'));
register('multiple', choiceRenderer('multiple'));
