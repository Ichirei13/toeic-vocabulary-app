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
