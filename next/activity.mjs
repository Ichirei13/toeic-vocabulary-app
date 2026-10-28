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
export function addDailyAnswer(activity, goal, now = new Date()) {
  const out = structuredClone(activity), date = localDateKey(now);
  const previous = out.days[date]?.answers || 0;
  out.days[date] = { answers: Math.min(Number.MAX_SAFE_INTEGER, previous + 1), goal };
  return out;
}
export function setDailyGoal(data, goal, now = new Date()) {
  if (!GOALS.includes(goal)) throw new Error('目標を選び直してください。');
  const out = structuredClone(data), date = localDateKey(now);
  out.preferences.dailyGoal = goal;
  if (out.activity.days[date]) out.activity.days[date].goal = goal;
  return out;
}
function previousDay(date) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0,10);
}
export function activitySummary(activity, goal, now = new Date()) {
  const date = localDateKey(now), answers = activity.days[date]?.answers || 0;
  let cursor = answers > 0 ? date : previousDay(date), streak = 0;
  while (activity.days[cursor]?.answers > 0) { streak++; cursor = previousDay(cursor); }
  return { date, answers, goal, achieved: goal > 0 && answers >= goal,
    activeDays: Object.entries(activity.days).filter(([key,row]) => key <= date && row.answers > 0).length, streak };
}
export function monthModel(activity, month, now = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01')) throw new Error('月が正しくありません。');
  const today = localDateKey(now), [year, m] = month.split('-').map(Number);
  const start = new Date(year,m-1,1,12), end = new Date(year,m,0,12);
  const previous = new Date(year,m-2,1,12), next = new Date(year,m,1,12);
  const days = Array(start.getDay()).fill(null);
  for (let d = 1; d <= end.getDate(); d++) {
    const date = `${month}-${String(d).padStart(2,'0')}`, row = activity.days[date] || { answers: 0, goal: 0 };
    days.push({ date, ...row, active: row.answers > 0, achieved: row.goal > 0 && row.answers >= row.goal,
      today: date === today, future: date > today });
  }
  return { month, previousMonth: localDateKey(previous).slice(0,7), nextMonth: localDateKey(next).slice(0,7), canGoNext: month < today.slice(0,7), days };
}
