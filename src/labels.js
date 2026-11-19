// ラベリング機能の純粋ロジック（DOM にも localStorage にも触れない）。
// 記録の形: { labels: { ID: { name, created, u, deleted? } }, items: { 'ラベルID|項目キー': { on, u } } }
// 項目キーは文法 'g:<問題ID>'、単語 'w:<見出し語>'。削除・外したことも時刻つきで残し、統合で復活させない。
// 関数はどれも引数を書き換えず、新しい記録を返す
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_LABEL_ID = 'default';
  const DEFAULT_LABEL_NAME = 'あとで見る';
  const LABEL_NAME_MAX = 20;
  const LABEL_ID_RE = /^(default|l_[a-z0-9]{6,16})$/;

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isTime = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

  function emptyLabelStore() {
    return { labels: { [DEFAULT_LABEL_ID]: { name: DEFAULT_LABEL_NAME, created: 0, u: 0 } }, items: {} };
  }

  function isLabelItemKey(key) {
    return typeof key === 'string' && (/^g:[1-9]\d{0,8}$/.test(key) || /^w:.+$/.test(key));
  }

  // 名前の長さは見た目の文字数で数える（絵文字や結合文字も1文字。Intl.Segmenter が無い環境ではコードポイントで数える）
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
  function labelNameLength(text) {
    const t = String(text);
    return segmenter ? Array.from(segmenter.segment(t)).length : Array.from(t).length;
  }

  function isValidName(name) {
    if (typeof name !== 'string') return false;
    const n = labelNameLength(name.trim());
    return n >= 1 && n <= LABEL_NAME_MAX;
  }

  function splitItemId(id) {
    const i = id.indexOf('|');
    return i < 0 ? null : [id.slice(0, i), id.slice(i + 1)];
  }

  function sanitizeLabelStore(raw) {
    const data = { labels: {}, items: {} };
    if (!isObj(raw)) return { data, invalid: raw == null ? 0 : 1 };
    let invalid = 0;
    if (isObj(raw.labels)) {
      Object.entries(raw.labels).forEach(([id, l]) => {
        const ok = LABEL_ID_RE.test(id) && isObj(l) && isValidName(l.name) && isTime(l.created) && isTime(l.u)
          && (l.deleted === undefined || l.deleted === true);
        if (!ok) { invalid++; return; }
        data.labels[id] = { name: l.name.trim(), created: l.created, u: l.u, ...(l.deleted ? { deleted: true } : {}) };
      });
    } else if (raw.labels !== undefined) invalid++;
    if (isObj(raw.items)) {
      Object.entries(raw.items).forEach(([id, it]) => {
        const parts = splitItemId(id);
        const ok = parts && LABEL_ID_RE.test(parts[0]) && isLabelItemKey(parts[1])
          && isObj(it) && typeof it.on === 'boolean' && isTime(it.u);
        if (!ok) { invalid++; return; }
        data.items[id] = { on: it.on, u: it.u };
      });
    } else if (raw.items !== undefined) invalid++;
    return { data, invalid };
  }

  // u が新しい方。同じなら「消した・外した」方を採る
  const newer = (x, y, isTomb) => (!x ? y : !y ? x : x.u !== y.u ? (x.u > y.u ? x : y) : (isTomb(y) ? y : x));

  function mergeMap(a, b, isTomb) {
    const out = {};
    new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach(k => {
      out[k] = { ...newer((a || {})[k], (b || {})[k], isTomb) };
    });
    return out;
  }

  function mergeLabelStores(a, b) {
    return {
      labels: mergeMap(a && a.labels, b && b.labels, l => l.deleted === true),
      items: mergeMap(a && a.items, b && b.items, it => it.on === false),
    };
  }

  function activeLabels(store) {
    return Object.entries((store && store.labels) || {})
      .filter(([, l]) => !l.deleted)
      .map(([id, l]) => ({ id, name: l.name, created: l.created }))
      .sort((x, y) => x.created - y.created || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  const isActive = (store, id) => {
    const l = store && store.labels && store.labels[id];
    return !!l && !l.deleted;
  };

  function validateLabelName(store, name, exceptId) {
    const t = typeof name === 'string' ? name.trim() : '';
    if (t.length === 0) return { ok: false, reason: '名前を入れてください。' };
    if (labelNameLength(t) > LABEL_NAME_MAX) return { ok: false, reason: `名前は${LABEL_NAME_MAX}文字までです。` };
    if (activeLabels(store).some(l => l.id !== exceptId && l.name === t)) return { ok: false, reason: '同じ名前のラベルがあります。' };
    return { ok: true, name: t };
  }

  const copy = store => ({ labels: { ...((store && store.labels) || {}) }, items: { ...((store && store.items) || {}) } });

  function createLabel(store, id, name, now) {
    const s = copy(store);
    s.labels[id] = { name: String(name).trim(), created: now, u: now };
    return s;
  }

  function renameLabel(store, id, name, now) {
    const s = copy(store);
    if (s.labels[id]) s.labels[id] = { ...s.labels[id], name: String(name).trim(), u: now };
    return s;
  }

  function deleteLabel(store, id, now) {
    const s = copy(store);
    if (s.labels[id]) s.labels[id] = { ...s.labels[id], deleted: true, u: now };
    return s;
  }

  function setLabel(store, labelId, itemKey, on, now) {
    const s = copy(store);
    s.items[`${labelId}|${itemKey}`] = { on: !!on, u: now };
    return s;
  }

  function labelsOf(store, itemKey) {
    const items = (store && store.items) || {};
    return activeLabels(store).map(l => l.id).filter(id => {
      const it = items[`${id}|${itemKey}`];
      return !!it && it.on;
    });
  }

  function itemsOf(store, labelId) {
    if (!isActive(store, labelId)) return [];
    const prefix = `${labelId}|`;
    return Object.entries(store.items || {})
      .filter(([id, it]) => id.startsWith(prefix) && it.on)
      .map(([id, it]) => ({ key: id.slice(prefix.length), u: it.u }))
      .sort((x, y) => y.u - x.u);
  }

  // 読み込んだ記録の時刻（created・u）が now より先なら now にそろえる（時計の進んだ端末の記録が、あとの変更に勝ち続けないように）
  function clampLabelStoreTimes(store, now) {
    const clamp = t => Math.min(t, now);
    const labels = {};
    Object.entries((store && store.labels) || {}).forEach(([id, l]) => { labels[id] = { ...l, created: clamp(l.created), u: clamp(l.u) }; });
    const items = {};
    Object.entries((store && store.items) || {}).forEach(([id, it]) => { items[id] = { ...it, u: clamp(it.u) }; });
    return { labels, items };
  }

  // 記録の中でいちばん新しい時刻（時計のずれの検出に使う）。無ければ 0
  function latestLabelTime(store) {
    let latest = 0;
    [(store && store.labels) || {}, (store && store.items) || {}].forEach(map => {
      Object.values(map).forEach(x => { if (x && Number.isFinite(x.u) && x.u > latest) latest = x.u; });
    });
    return latest;
  }

  function resolveLastUsed(store, lastId) {
    if (typeof lastId === 'string' && isActive(store, lastId)) return lastId;
    const list = activeLabels(store);
    return list.length ? list[list.length - 1].id : null;
  }

  return {
    DEFAULT_LABEL_ID, DEFAULT_LABEL_NAME, LABEL_NAME_MAX,
    emptyLabelStore, isLabelItemKey, sanitizeLabelStore, mergeLabelStores, validateLabelName, labelNameLength,
    clampLabelStoreTimes, latestLabelTime,
    createLabel, renameLabel, deleteLabel, setLabel, activeLabels, labelsOf, itemsOf, resolveLastUsed,
  };
});
