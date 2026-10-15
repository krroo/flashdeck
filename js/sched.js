// 학습 일정 로직 (라이트너 스타일). 숫자만 바꿔서 쉽게 튜닝할 수 있게 상단에 모아 둠.
export const DAY = 86400000;

// 평가별 다음 복습까지 간격 (일). 못 외움=0 → 매 세션 등장
export const INTERVAL_DAYS = { 1: 0, 2: 3, 3: 14 };

// 같은 세션 안에서 틀린 카드가 다시 나오는 규칙.
// min: 최소 몇 장 뒤부터, max: 한 세션에서 최대 몇 번까지 재등장.
// 위치는 [min장 뒤 ~ 세션 맨 끝] 중 무작위라서 중간이나 마무리에 섞여 나오고,
// max를 넘으면 더 이상 되돌아오지 않아 뒤쪽 카드까지 진행할 수 있음.
export const REQUEUE = { 1: { min: 5, max: 2 }, 2: { min: 8, max: 1 } };

export const nextDue = (rating, now) => now + INTERVAL_DAYS[rating] * DAY;

// 평가한 적 없는 카드이거나 복습 기한이 지난 카드
export const isDue = (p, now = Date.now()) => !p || !p.rating || p.due <= now;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// mode: 'due' 오늘 복습 / 'all' 전체 / 'wrong' 못 외움+애매함
export function buildQueue(cards, getProgress, { mode = 'all', order = 'seq' } = {}) {
  let list = cards;
  if (mode === 'due') list = cards.filter((c) => isDue(getProgress(c.id)));
  else if (mode === 'wrong') {
    list = cards.filter((c) => {
      const r = getProgress(c.id)?.rating;
      return r === 1 || r === 2;
    });
  }
  const ids = list.map((c) => c.id);
  return order === 'random' ? shuffle(ids) : ids;
}
