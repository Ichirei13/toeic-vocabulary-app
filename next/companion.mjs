export const companionVisible = (preferences, theme) => preferences.companion === 'on' || preferences.companion === 'auto' && theme === 'duolingo';
export function feedbackModel({ correct, goalReached = false, streak = 0, reviewed = 0, complete = false }) {
  if (complete) return { state: 'celebrate', message: reviewed ? `苦手を${reviewed}問復習できました。` : '今日も、一歩前へ。', detail: '' };
  const milestone = correct && (streak === 3 || streak === 5 || (streak > 0 && streak % 10 === 0));
  return { state: correct ? (goalReached || milestone ? 'celebrate' : 'encourage') : 'reflect',
    message: !correct ? 'ここで覚えよう。' : milestone && !goalReached ? `${streak}問連続正解！` : '正解！その調子。',
    detail: goalReached ? '今日の目標達成！' : milestone ? '集中できています。' : correct ? '正解で +10 XP' : '' };
}
export function companionMarkup(value = 'neutral') {
  const state = ['neutral', 'encourage', 'reflect', 'celebrate'].includes(value) ? value : 'neutral';
  const style = `<style>
    @keyframes comp-tail { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-14deg); } }
    @keyframes comp-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(${state === 'celebrate' ? '-7px' : '-3.5px'}); } }
    @keyframes comp-arm { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(${state === 'reflect' ? '-6deg' : '14deg'}); } }
    @keyframes comp-star { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
    .companion-art .c-tail { transform-origin: 48px 128px; animation: comp-tail 0.7s ease-in-out infinite; }
    .companion-art .c-head { transform-origin: 100px 86px; animation: comp-bob ${state === 'celebrate' ? '0.65s' : '1.4s'} ease-in-out infinite; }
    .companion-art .c-arm { transform-origin: 130px 112px; animation: comp-arm 0.75s ease-in-out infinite; }
    .companion-art .c-star { transform-origin: 100px 36px; animation: comp-star 0.9s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) {
      .companion-art .c-tail, .companion-art .c-head, .companion-art .c-arm, .companion-art .c-star { animation: none !important; }
    }
  </style>`;
  const confetti = state === 'celebrate'
    ? '<g class="c-star"><polygon points="32,26 36,34 45,35 38,41 40,50 32,45 24,50 26,41 19,35 28,34" fill="#FF9600"/><polygon points="168,24 172,32 181,33 174,39 176,48 168,43 160,48 162,39 155,33 164,32" fill="#FF9600"/></g>'
    : '';
  const eyes = state === 'celebrate'
    ? '<path d="M66 78 Q78 64 90 78 M110 78 Q122 64 134 78" fill="none" stroke="#3B232E" stroke-width="6" stroke-linecap="round"/>'
    : '<circle cx="78" cy="78" r="11" fill="#3B232E"/><circle cx="74" cy="74" r="4" fill="#FFFFFF"/><circle cx="122" cy="78" r="11" fill="#3B232E"/><circle cx="118" cy="74" r="4" fill="#FFFFFF"/>';
  const mouth = state === 'reflect'
    ? '<path d="M92 98 Q100 92 108 98" fill="none" stroke="#3B232E" stroke-width="5" stroke-linecap="round"/>'
    : '<path d="M88 94 Q100 112 112 94" fill="#FF6B8B" stroke="#3B232E" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
  const arm = state === 'encourage'
    ? '<path class="c-arm" d="M54 120 C34 120, 24 108, 28 96 C30 88, 36 88, 36 80 C36 72, 46 72, 46 84 C52 86, 56 96, 54 120 Z" fill="#FFFFFF" stroke="#4B4B4B" stroke-width="6" stroke-linejoin="round"/>'
    : state === 'reflect'
      ? '<path class="c-arm" d="M132 132 C148 122, 146 98, 126 98 C114 98, 114 114, 124 120" fill="#FFFFFF" stroke="#4B4B4B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path class="c-arm" d="M138 118 C156 104, 174 84, 166 68 C158 56, 142 72, 130 96 Z" fill="#FFFFFF" stroke="#4B4B4B" stroke-width="6" stroke-linejoin="round"/>';
  return `<svg class="companion-art ${state}" viewBox="0 0 200 200" fill="none" aria-hidden="true">${style}${confetti}<path class="c-tail" d="M42 138 C18 132, 14 102, 32 88 C26 78, 38 68, 52 76 C56 96, 54 122, 42 138 Z" fill="#FFFFFF" stroke="#4B4B4B" stroke-width="6" stroke-linejoin="round"/><path d="M62 126 C56 148, 58 176, 74 178 C86 178, 90 162, 92 152 L108 152 C110 162, 114 178, 126 178 C142 176, 144 148, 138 126 Z" fill="#F2F4F7" stroke="#4B4B4B" stroke-width="6" stroke-linejoin="round"/><path d="M48 112 C40 126, 48 144, 64 148 C82 156, 118 156, 136 148 C152 144, 160 126, 152 112 Z" fill="#FFFFFF" stroke="#4B4B4B" stroke-width="6" stroke-linejoin="round"/><path d="M64 114 L100 144 L136 114 Z" fill="#FF9600" stroke="#4B4B4B" stroke-width="5" stroke-linejoin="round"/><path d="M72 114 L100 136 L128 114 Z" fill="#58CC02"/><g class="c-head"><path d="M52 72 L46 32 C46 22, 60 20, 76 38 C90 32, 110 32, 124 38 C140 20, 154 22, 154 32 L148 72 C164 84, 164 108, 144 118 C126 128, 74 128, 56 118 C36 108, 36 84, 52 72 Z" fill="#FFFFFF" stroke="#4B4B4B" stroke-width="6" stroke-linejoin="round"/><path d="M55 62 L53 38 C53 34, 62 34, 70 46 Z M145 62 L147 38 C147 34, 138 34, 130 46 Z" fill="#D6DCE5"/>${eyes}<ellipse cx="100" cy="86" rx="7" ry="5" fill="#3B232E"/>${mouth}</g>${arm}</svg>`;
}
