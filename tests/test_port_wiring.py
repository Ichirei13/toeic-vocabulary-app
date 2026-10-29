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
