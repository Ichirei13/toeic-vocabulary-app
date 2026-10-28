import { selectItems } from './core.mjs';
export function bookProgress(catalog, records, kind, source) {
  const config = { kind, source, mode: 'e2j', filter: 'all', chapters: [], pos: [], ranges: [], dates: [] };
  const items = selectItems(catalog,records,config);
  const seenKeys = new Set(kind === 'grammar' ? records.grammarSeen.map(String) : Object.values(records.seenWords).flat());
  const seen = items.filter(item => seenKeys.has(item.key)).length;
  return { total: items.length, seen, unseen: items.length - seen };
}
