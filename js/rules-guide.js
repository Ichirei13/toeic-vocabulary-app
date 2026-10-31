// ==================== 金のルール・章ガイド ====================

// 章ごとの解説メモ。{ 1: "本文…", 2: "…" } の形で書くとガイドの各章の先頭に表示される（改行はそのまま反映）。
const KIN_CHAPTER_NOTES = {};

// 問題データから 金のルール の一覧を組み立てる（番号順、各ルールの問題idつき）
const KIN_RULES = (() => {
  const map = new Map();
  RAW_GRAMMAR.filter(g => g.b === 'kin' && g.rule && g.rule.number).forEach(g => {
    if (!map.has(g.rule.number)) {
      map.set(g.rule.number, { number: g.rule.number, title: g.rule.title, ch: g.ch, ids: [] });
    }
    map.get(g.rule.number).ids.push(g.id);
  });
  return [...map.values()].sort((a, b) => a.number - b.number);
})();

const KIN_CHAPTERS = (() => {
  const map = new Map();
  RAW_GRAMMAR.filter(g => g.b === 'kin').forEach(g => {
    if (!map.has(g.ch)) map.set(g.ch, { ch: g.ch, title: g.ch_title, sections: {} });
    // th_title は「必修問題 (Q114)」の形なので、括弧の前をセクション名として数える
    const section = (g.th_title || '').replace(/\s*\(.*$/, '');
    const sections = map.get(g.ch).sections;
    if (section) sections[section] = (sections[section] || 0) + 1;
  });
  return [...map.values()].sort((a, b) => a.ch - b.ch);
})();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 解き方フェーズの手順（章ガイドと解説欄の両方で使う）
function renderPhaseSteps(phases) {
  return `<div class="phase-steps">${phases.map(p => `
    <div class="phase-step">
      <span class="phase-step-no">${p.phase}</span>
      <div>
        <div class="phase-step-title">${escapeHtml(p.title)}</div>
        ${p.action ? `<div class="phase-step-action">${escapeHtml(p.action)}</div>` : ''}
        ${p.detail ? `<div class="phase-step-detail">${escapeHtml(p.detail)}</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

// 章ごとに持っている補足リスト（章によってキー名が違う）
const PHASE_EXTRA_LISTS = [
  ['points', '押さえる視点'],
  ['steps', '解き方のステップ'],
  ['major_patterns', '主な出題パターン'],
];

function renderPhaseGuide(pi) {
  let html = '';
  if (pi.overview) html += `<div class="phase-overview">${escapeHtml(pi.overview)}</div>`;
  if (pi.types && pi.types.length) {
    html += `<div class="guide-label">問題のタイプ</div><div class="phase-cards">${pi.types.map(t =>
      `<div class="phase-card"><strong>${escapeHtml(t.name)}</strong>${escapeHtml(t.desc || '')}</div>`).join('')}</div>`;
  }
  PHASE_EXTRA_LISTS.forEach(([key, label]) => {
    if (pi[key] && pi[key].length) {
      html += `<div class="guide-label">${label}</div><ul class="phase-list">${pi[key].map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
    }
  });
  if (pi.phases && pi.phases.length) {
    html += `<div class="guide-label">解き方フェーズ</div>${renderPhaseSteps(pi.phases)}`;
  }
  if (pi.tips && pi.tips.length) {
    html += `<div class="phase-tips"><div class="phase-tips-title">🎯 鉄則</div><ul class="phase-list">${pi.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul></div>`;
  }
  return html;
}

function renderRuleGuide() {
  const container = document.getElementById('weak-list-content');
  let html = `<div class="filter-row" style="flex-wrap:wrap;">
    <button class="chip ${state.guideChapter === 'all' ? 'active' : ''}" data-guide-ch="all">すべて</button>
    ${KIN_CHAPTERS.map(c => `<button class="chip ${state.guideChapter === c.ch ? 'active' : ''}" data-guide-ch="${c.ch}">第${c.ch}章</button>`).join('')}
  </div>`;

  KIN_CHAPTERS.filter(c => state.guideChapter === 'all' || state.guideChapter === c.ch).forEach(c => {
    const notes = KIN_CHAPTER_NOTES[c.ch];
    const phaseInfo = typeof KIN_PHASES !== 'undefined' ? KIN_PHASES.find(p => p.chapter === c.ch) : null;
    const rules = KIN_RULES.filter(r => r.ch === c.ch);
    html += `<div class="guide-chapter">
      <h3>第${c.ch}章 ${escapeHtml(c.title)}</h3>
      ${phaseInfo
        ? renderPhaseGuide(phaseInfo)
        : notes
          ? `<div class="guide-notes">${escapeHtml(notes)}</div>`
          : `<div class="guide-notes empty">章の解説はまだ登録されていません</div>`}
      <div class="guide-themes">${Object.entries(c.sections).map(([name, n]) => `<span class="guide-theme">${escapeHtml(name)} ${n}問</span>`).join('')}</div>
      <div class="guide-label">金のルール（${rules.length}）</div>
      ${rules.map(r => {
        const weak = r.ids.filter(id => state.grammarWeakData[id] !== undefined).length;
        return `<div class="guide-rule">
          <span class="guide-rule-no">No.${r.number}</span>
          <span class="guide-rule-title">${escapeHtml(r.title)}
            <span class="guide-rule-meta">${r.ids.length}問${weak > 0 ? ` ・ <span class="guide-rule-weak">苦手 ${weak}</span>` : ''}</span>
          </span>
          <button class="guide-solve-btn" data-solve-rule="${r.number}">解く</button>
        </div>`;
      }).join('')}
    </div>`;
  });
  container.innerHTML = html;
}

function startRuleDrill(number) {
  state.grammarBook = 'kin';
  state.grammarChapter = [];
  state.grammarWeakFilter = 'all';
  state.grammarRule = number;
  syncFilterUI();
  applyGrammarFilters();
  closeSheet();
}

document.getElementById('weak-list-content').addEventListener('click', e => {
  const backupBtn = e.target.closest('[data-backup]');
  if (backupBtn) return handleBackupAction(backupBtn.dataset.backup);

  const chBtn = e.target.closest('[data-guide-ch]');
  if (chBtn) {
    const v = chBtn.dataset.guideCh;
    state.guideChapter = v === 'all' ? 'all' : Number(v);
    renderRuleGuide();
    return;
  }
  const solveBtn = e.target.closest('[data-solve-rule]');
  if (solveBtn) return startRuleDrill(Number(solveBtn.dataset.solveRule));

  const modeBtn = e.target.closest('[data-weak-mode]');
  if (modeBtn) {
    state.weakListMode = modeBtn.dataset.weakMode;
    renderWeakList();
    return;
  }
  const sortBtn = e.target.closest('[data-weak-sort]');
  if (sortBtn) {
    state.weakSort = sortBtn.dataset.weakSort;
    saveSettings();
    renderWeakList();
    return;
  }
  const delBtn = e.target.closest('[data-remove-weak]');
  if (delBtn) removeWeak(delBtn.dataset.removeWeak);
  if (e.target.closest('[data-obsidian-export]')) exportObsidianGrammarSync();
  if (e.target.closest('[data-obsidian-import]')) importObsidianGrammarSync();
});

function exportObsidianGrammarSync() {
  const payload = {
    app: 'toeic_practice',
    exportedAt: new Date().toISOString(),
    weak: state.grammarWeakData
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'obsidian_grammar_sync.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function applyObsidianSyncPayload(data) {
  const weakObj = (data && typeof data.weak === 'object' && data.weak) ? data.weak : data;
  const masteredList = (data && Array.isArray(data.mastered)) ? data.mastered : [];
  if (!weakObj || typeof weakObj !== 'object') return;
  Object.entries(weakObj).forEach(([k, v]) => {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') return;
    state.grammarWeakData[k] = {
      streak: Number(v.streak) || 0,
      added: Number(v.added) || Date.now(),
      due: Number(v.due) || Date.now(),
      u: Date.now()
    };
  });
  masteredList.forEach(id => {
    delete state.grammarWeakData[String(id)];
    markWeakDeleted(`g:${id}`);
  });
  saveGrammarWeakData();
  renderGrammarWeakList();
}

async function importObsidianGrammarSync() {
  try {
    const res = await fetch('data/obsidian_grammar_sync.json?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      applyObsidianSyncPayload(data);
      return;
    }
  } catch (e) {}
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = re => {
      try {
        applyObsidianSyncPayload(JSON.parse(re.target.result));
      } catch (err) {}
    };
    reader.readAsText(file);
  };
  inp.click();
}

