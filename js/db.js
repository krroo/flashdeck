// IndexedDB 얇은 래퍼. 스토어: decks / progress / meta
const DB_NAME = 'flashdeck';
const VERSION = 1;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB를 사용할 수 없습니다.'));
    let req;
    try { req = indexedDB.open(DB_NAME, VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('decks', { keyPath: 'id' });
      const p = d.createObjectStore('progress', { keyPath: 'key' });
      p.createIndex('deckId', 'deckId');
      d.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('DB가 다른 탭에서 사용 중입니다.'));
  });
  return dbp;
}

const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
export async function put(store, val) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).put(val));
}
export async function del(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
export async function clear(store) {
  const db = await openDB();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}
export async function putMany(store, vals) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    vals.forEach((v) => s.put(v));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export async function deleteProgressOfDeck(deckId) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction('progress', 'readwrite');
    const c = t.objectStore('progress').index('deckId').openCursor(IDBKeyRange.only(deckId));
    c.onsuccess = () => { const cur = c.result; if (cur) { cur.delete(); cur.continue(); } };
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export async function getMeta(k, def = null) {
  const r = await get('meta', k);
  return r ? r.v : def;
}
export function setMeta(k, v) { return put('meta', { k, v }); }
