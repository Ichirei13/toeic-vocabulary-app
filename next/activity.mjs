import { GOALS } from './preferences.mjs';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function localDateKey(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
export function emptyActivity(now = new Date()) { return { startedOn: localDateKey(now), days: {} }; }
export function validateActivity(raw) {
  if (!object(raw) || !validDate(raw.startedOn) || !object(raw.days)) throw new Error('学習日の記録が正しくありません。');
  return { startedOn: raw.startedOn, days: Object.fromEntries(Object.entries(raw.days).map(([date, row]) => {
    if (!validDate(date) || !object(row) || !Number.isSafeInteger(row.answers) || row.answers < 0 || !GOALS.includes(row.goal)) throw new Error('日別の学習記録が正しくありません。');
    return [date, { answers: row.answers, goal: row.goal }];
  })) };
}
export function mergeActivity(current, incoming) {
  const out = structuredClone(current);
  out.startedOn = [current.startedOn,incoming.startedOn].sort()[0];
  for (const [date, day] of Object.entries(incoming.days)) {
    out.days[date] = out.days[date] ? { answers: Math.max(out.days[date].answers,day.answers), goal: out.days[date].goal } : { ...day };
  }
  return out;
}
