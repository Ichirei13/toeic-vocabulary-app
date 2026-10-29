from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def test_filter_count_is_wired():
    assert '<script src="src/filter-count.js"></script>' in HTML
    assert 'id="filter-apply-btn"' in HTML
    assert 'id="filter-zero-note"' in HTML
    assert "function refreshFilterApplyLabel()" in HTML
    assert "'src/filter-count.js'" in SW


def test_new_scripts_load_before_home_js():
    # src/*.js は home.js より前に読み込む（home.js の先頭で StudyCore を使うため）
    home = HTML.index('<script src="home.js"></script>')
    for name in ("filter-count",):
        assert HTML.index(f'<script src="src/{name}.js"></script>') < home


def test_activity_module_is_wired():
    assert '<script src="src/activity.js"></script>' in HTML
    assert "'src/activity.js'" in SW
    assert HTML.index('<script src="src/activity.js"></script>') < HTML.index('<script src="home.js"></script>')


def test_backup_format_6_is_wired_and_drive_is_untouched():
    assert "const BACKUP_FORMAT = 6;" in HTML
    assert "const EXTRA_KEYS = {" in HTML
    assert "const LOCAL_BACKUP_KEYS =" in HTML
    # Drive 同期の対象（RECORD_KEYS）には新しいキーを入れない
    start = HTML.index("const RECORD_KEYS = {")
    end = HTML.index("};", start)
    block = HTML[start:end]
    assert "toeic_prefs_v1" not in block
    assert "toeic_daily_activity_v1" not in block
    # Drive 同期が作るファイルは従来どおり（版 5・日別記録なし）
    assert HTML.count("buildBackup({ forDrive: true })") == 2
    assert "format: forDrive ? 5 : BACKUP_FORMAT" in HTML


def test_review_module_is_wired():
    assert '<script src="src/review.js"></script>' in HTML
    assert "'src/review.js'" in SW
    assert HTML.index('<script src="src/review.js"></script>') < HTML.index('<script src="home.js"></script>')


def test_review_page_is_wired():
    assert 'data-page="review"' in HTML
    assert 'id="review-page"' in HTML
    home = (ROOT / "home.js").read_text(encoding="utf-8")
    assert "const APP_PAGES = ['home', 'practice', 'review', 'settings'];" in home
    assert "function renderReviewPage()" in home
    # ナビは「ホーム / 演習 / 復習 / 設定」の順
    nav = HTML[HTML.index('class="top-page-tabs"'):]
    assert nav.index('data-page="practice"') < nav.index('data-page="review"') < nav.index('data-page="settings"')


def test_home_js_survives_missing_src_scripts():
    # src/*.js が読み込めなくても home.js が起動時に止まらないよう、足りない関数を補う
    home = (ROOT / "home.js").read_text(encoding="utf-8")
    assert "const STUDY_CORE_FALLBACK = {" in home
    assert "window.StudyCore = Object.assign({}, STUDY_CORE_FALLBACK, window.StudyCore || {});" in home
    # 日別記録の検証・統合は、空で上書きして記録を失わないよう例外にする
    assert "sanitizeActivity: () => { throw" in home
    assert "mergeActivity: () => { throw" in home


def test_undo_snapshot_only_keeps_extra_keys_the_restore_writes():
    # 復元が触らない日別記録・表示設定を取り消し用の記録に入れると、取り消しでその後の学習が巻き戻る
    assert "Object.hasOwn(rawByKey, k)" in HTML
    assert "before = Object.fromEntries(LOCAL_BACKUP_KEYS.map(" not in HTML


def test_pace_and_goal_settings_are_wired():
    home = (ROOT / "home.js").read_text(encoding="utf-8")
    assert '<script src="src/pace.js"></script>' in HTML
    assert "'src/pace.js'" in SW
    assert HTML.index('<script src="src/pace.js"></script>') < HTML.index('<script src="home.js"></script>')
    # 設定ページの入力欄
    for ident in ('id="setting-goal"', 'id="setting-pace-vocab"', 'id="setting-pace-grammar"'):
        assert ident in home
    # 即答・バッジの判定は目標タイムから（固定の 5 秒 / 20 秒は使わない）
    assert "StudyCore.isFastAnswer(" in home
    assert "StudyCore.paceTier(" in home
    assert "sec <= 20.0" not in home
    # バックアップの prefs は正しい項目だけ取り込み、無い項目は今のまま
    assert "StudyCore.paceTargetPatch(" in HTML
    assert "StudyCore.isGoal(" in HTML


def test_minor_fixes_are_wired():
    home = (ROOT / "home.js").read_text(encoding="utf-8")
    css = (ROOT / "home.css").read_text(encoding="utf-8")
    # 復習できた数は単語・文法で別に持ち、出題プールを作り直すときだけ戻す
    assert "window.resetReview = function" not in home
    assert "window.applyFilters = function" in home
    assert "window.applyGrammarFilters = function" in home
    assert "sessionReviewHtml('grammar')" in HTML and "sessionReviewHtml('vocab')" in HTML
    # ダイアログは枠の外（背景）をタップしたときだけ閉じる
    assert "getBoundingClientRect()" in home[home.index("function ensureGoalDialog"):home.index("function renderGoalDialog")]
    # 苦手一覧のシートを閉じたら、復習画面の件数を描き直す
    assert "window.closeSheet = function" in home
    # 目標行はメッセージ枠の直後に置く（DOM 順 = 見た目の順）。order での入れ替えはしない
    assert home.index("${goalRowHtml}") < home.index("<!-- 2. 単語 / 文法 切り替えスイッチ -->")
    assert "order: -1" not in css and "order: -2" not in css
