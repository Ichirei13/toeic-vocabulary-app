export const companionVisible = (preferences, theme) => preferences.companion === 'on' || preferences.companion === 'auto' && theme === 'duolingo';
export function feedbackModel({ correct, goalReached = false, streak = 0, reviewed = 0, complete = false }) {
  if (complete) return { state: 'celebrate', message: reviewed ? `苦手を${reviewed}問復習できました。` : '今日も、一歩前へ。', detail: '' };
  const milestone = correct && (streak === 3 || streak === 5 || (streak > 0 && streak % 10 === 0));
  return { state: correct ? (goalReached || milestone ? 'celebrate' : 'encourage') : 'reflect',
    message: !correct ? 'ここで覚えよう。' : milestone && !goalReached ? `${streak}問連続正解！` : '正解！その調子。',
    detail: goalReached ? '今日の目標達成！' : milestone ? '集中できています。' : correct ? '正解で +10 XP' : '' };
}
export function companionMarkup(value = 'neutral') {
  const state = ['neutral','encourage','reflect','celebrate'].includes(value) ? value : 'neutral';
  const eyes = state === 'celebrate' ? '<path d="m19 31 4-4 4 4m10 0 4-4 4 4"/>' : '<path d="M23 27v5m18-5v5"/>';
  const mouth = state === 'reflect' ? '<path d="M28 42h8"/>' : '<path d="M26 40q6 8 12 0"/>';
  return `<svg class="companion-art ${state}" viewBox="0 0 64 80" fill="none" aria-hidden="true"><path d="M14 7h36v64L32 60 14 71V7Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M14 16h36" stroke="var(--on-accent)" stroke-width="3" opacity=".3"/><g stroke="var(--on-accent)" stroke-width="3.5" stroke-linecap="round">${eyes}${mouth}</g><path d="m8 40-5 7m53-7 5 7" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>${state==='celebrate'?'<path d="m5 7 2 4 4 2-4 2-2 4-2-4-3-2 3-2ZM56 0l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="var(--gold)"/>':''}</svg>`;
}
