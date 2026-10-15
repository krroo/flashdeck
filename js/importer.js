// 덱 가져오기: JSON(flashdeck v1) / CSV 파싱 + 검증. 답안 텍스트는 절대 가공하지 않음.
export const TYPES = ['open', 'truefalse', 'single', 'multiple'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function fnv(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// 덱 ID: 제목 기반. 같은 제목을 다시 가져오면 같은 덱으로 간주(진행 유지)
export const deckIdFor = (title) => 'd_' + fnv(title.trim().toLowerCase(), 2166136261) + fnv(title.trim().toLowerCase(), 5381);

export const normText = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');

export async function sha12(s) {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  }
  return (fnv(s, 2166136261) + fnv(s, 5381)).slice(0, 12);
}

export function validateDeck(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['최상위 값이 객체가 아닙니다.'], warnings };
  }
  if (raw.format !== 'flashdeck') errors.push('format 값이 "flashdeck"가 아닙니다.');
  if (raw.version !== undefined && raw.version !== 1) warnings.push(`version ${raw.version}은(는) 확인되지 않은 버전입니다. 1로 읽습니다.`);
  if (!isStr(raw.title)) errors.push('title(덱 제목)이 없습니다.');
  if (!Array.isArray(raw.cards) || raw.cards.length === 0) {
    errors.push('cards 배열이 없거나 비어 있습니다.');
    return { errors, warnings };
  }

  const seen = new Map();
  const cards = [];
  let missingGroup = 0;
  let missingTopic = 0;

  raw.cards.forEach((c, i) => {
    const where = `카드 ${i + 1}` + (c && isStr(c.question) ? ` (“${c.question.trim().slice(0, 30)}”)` : '');
    const err = (m) => errors.push(`${where}: ${m}`);
    if (!c || typeof c !== 'object') return err('객체가 아닙니다.');

    if (!isStr(c.id)) err('id가 없습니다.');
    else if (seen.has(c.id)) err(`id "${c.id}"가 카드 ${seen.get(c.id) + 1}과(와) 중복됩니다.`);
    else seen.set(c.id, i);

    if (!TYPES.includes(c.type)) err(`type "${c.type}"은(는) 지원하지 않습니다. (${TYPES.join(', ')})`);
    if (!isStr(c.question)) err('question이 비어 있습니다.');

    const out = {
      id: c.id,
      type: c.type,
      group: isStr(c.group) ? c.group.trim() : '기타',
      topic: isStr(c.topic) ? c.topic.trim() : '기타',
      question: c.question,
    };
    if (!isStr(c.group)) missingGroup++;
    if (!isStr(c.topic)) missingTopic++;
    if (c.questionTranslated === true) out.questionTranslated = true;
    if (isStr(c.note)) out.note = c.note;
    if (isStr(c.explanation)) out.explanation = c.explanation;

    if (c.type === 'open') {
      let ans = c.answer;
      if (typeof ans === 'string') ans = [{ text: ans, translated: false }];
      if (!Array.isArray(ans) || ans.length === 0) err('open 카드는 answer(세그먼트 배열)가 필요합니다.');
      else if (ans.some((s) => !s || typeof s.text !== 'string')) err('answer 세그먼트에 text가 없습니다.');
      else if (!ans.some((s) => s.text.trim() !== '')) err('answer가 비어 있습니다.');
      else out.answer = ans.map((s) => ({ text: s.text, translated: s.translated === true }));
    } else if (c.type === 'truefalse') {
      if (typeof c.correct !== 'boolean') err('truefalse 카드는 correct가 true/false여야 합니다.');
      else out.correct = c.correct;
    } else if (c.type === 'single' || c.type === 'multiple') {
      const opts = c.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.some((o) => !isStr(o))) {
        err('options는 비어 있지 않은 문자열 2개 이상이어야 합니다.');
      } else {
        out.options = opts;
        let corr = c.correct;
        if (typeof corr === 'number') corr = [corr];
        if (!Array.isArray(corr) || corr.length === 0 || corr.some((x) => !Number.isInteger(x))) {
          err('correct는 정답 보기 인덱스(0부터)의 배열이어야 합니다.');
        } else if (corr.some((x) => x < 0 || x >= opts.length)) {
          err(`correct 값이 보기 범위(0~${opts.length - 1})를 벗어납니다.`);
        } else if (new Set(corr).size !== corr.length) {
          err('correct에 중복된 값이 있습니다.');
        } else if (c.type === 'single' && corr.length !== 1) {
          err('single 카드의 correct는 정확히 1개여야 합니다.');
        } else out.correct = corr;
      }
    }
    cards.push(out);
  });

  if (missingGroup) warnings.push(`group이 없는 카드 ${missingGroup}장은 "기타"로 분류했습니다.`);
  if (missingTopic) warnings.push(`topic이 없는 카드 ${missingTopic}장은 "기타"로 분류했습니다.`);
  if (errors.length) return { errors, warnings };
  return {
    errors,
    warnings,
    deck: { title: raw.title.trim(), language: isStr(raw.language) ? raw.language : 'en', cards },
  };
}

export function parseCSV(text, delim = ',') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; rows.push(row); row = [];
    } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const TYPE_ALIAS = { tf: 'truefalse', 'true/false': 'truefalse', multi: 'multiple', mcq: 'single' };

export async function csvToRawDeck(text, title) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = parseCSV(text, delim);
  const errors = [];
  if (rows.length < 2) return { errors: ['CSV에 헤더와 데이터 행이 필요합니다.'], raw: null };

  const header = rows[0].map((s) => s.trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  for (const need of ['type', 'question']) {
    if (col(need) < 0) errors.push(`CSV 헤더에 "${need}" 열이 없습니다.`);
  }
  if (errors.length) return { errors, raw: null };

  const optCols = header
    .map((n, i) => ({ n, i, k: /^option(\d+)$/.exec(n) }))
    .filter((x) => x.k)
    .sort((a, b) => +a.k[1] - +b.k[1])
    .map((x) => x.i);

  const items = [];
  rows.slice(1).forEach((r, ri) => {
    const line = ri + 2;
    const g = (n) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    let type = g('type').toLowerCase();
    type = TYPE_ALIAS[type] || type;
    const card = { type, group: g('group'), topic: g('topic'), question: g('question') };
    if (g('id')) card.id = g('id');
    if (g('note')) card.note = g('note');
    if (g('explanation')) card.explanation = g('explanation');
    const ans = col('answer') >= 0 ? (r[col('answer')] ?? '') : '';
    let answerish = ans;

    if (type === 'open') card.answer = [{ text: ans, translated: false }];
    else if (type === 'truefalse') {
      const v = g('correct').toLowerCase();
      if (['true', 't', '1', 'o', '참'].includes(v)) card.correct = true;
      else if (['false', 'f', '0', 'x', '거짓'].includes(v)) card.correct = false;
      else { errors.push(`CSV ${line}행: truefalse의 correct는 true/false여야 합니다.`); card.correct = false; }
      answerish = String(card.correct);
    } else if (type === 'single' || type === 'multiple') {
      let opts = optCols.map((i) => (r[i] ?? '').trim());
      while (opts.length && opts[opts.length - 1] === '') opts.pop();
      card.options = opts;
      const nums = g('correct').split(/[;|,\s]+/).filter(Boolean).map(Number);
      if (!nums.length || nums.some((n) => !Number.isInteger(n))) {
        errors.push(`CSV ${line}행: correct는 정답 보기 번호(1부터)를 ; 로 구분해 적어야 합니다.`);
        card.correct = [0];
      } else if (nums.some((n) => n < 1 || n > opts.length)) {
        errors.push(`CSV ${line}행: correct 번호가 보기 범위(1~${opts.length})를 벗어납니다.`);
        card.correct = [0];
      } else card.correct = nums.map((n) => n - 1);
      answerish = opts.join('|') + '|' + g('correct');
    }
    items.push({ card, answerish, line });
  });

  const counts = new Map();
  items.forEach(({ card }) => {
    if (card.question) counts.set(normText(card.question), (counts.get(normText(card.question)) || 0) + 1);
  });
  for (const it of items) {
    if (it.card.id || !it.card.question) continue;
    const k = normText(it.card.question);
    it.card.id = 'c_' + (await sha12(counts.get(k) > 1 ? k + '|' + normText(it.answerish) : k));
  }
  return {
    errors,
    raw: { format: 'flashdeck', version: 1, title, language: 'en', cards: items.map((x) => x.card) },
  };
}

export async function importFile(file) {
  const base = file.name.replace(/\.[^.]+$/, '');
  let text;
  try { text = await file.text(); } catch (e) { return { errors: ['파일을 읽을 수 없습니다: ' + e.message], warnings: [] }; }
  const isJson = /\.json$/i.test(file.name) || text.trimStart().startsWith('{');
  if (isJson) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return { errors: ['JSON 형식 오류: ' + e.message], warnings: [] }; }
    return validateDeck(raw);
  }
  const { errors, raw } = await csvToRawDeck(text, base);
  if (!raw) return { errors, warnings: [] };
  const v = validateDeck(raw);
  return { errors: [...errors, ...v.errors.map((m) => 'CSV: ' + m)], warnings: v.warnings, deck: v.deck };
}
