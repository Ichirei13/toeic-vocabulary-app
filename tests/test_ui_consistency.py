from _sources import ROOT, read_app_source
import json
from pathlib import Path
import re
import subprocess


def test_index_html_has_all_book_badges_and_selectors():
    html = read_app_source()

    # Check segment buttons
    assert 'data-gbook="polaris2"' in html
    assert 'data-gbook="toplevel"' in html
    assert '🧭 ポラリス2' in html
    assert '🎓 トップレベル' in html

    # Check CSS classes
    assert '.badge-polaris' in html
    assert '.badge-toplevel' in html
    assert '#grammar-book-segments' in html

    # 本の定義表に 4 冊とも入っている（保存した設定の検証もこの表の id を使う）
    assert "polaris2: {" in html and "toplevel: {" in html
    assert "GRAMMAR_BOOK_IDS" in html

    # Check 5-choice support and keyboard shortcuts
    assert "'E'" in html or '"E"' in html
    assert "Digit[1-5]" in html
    assert "Numpad[1-5]" in html
    assert "a-eA-E" in html

    # Check getBookBadge and getGrammarChapters
    assert 'getBookBadge' in html
    assert 'getGrammarChapters' in html


def test_grammar_ui_functions_execution():
    html = read_app_source()
    grammar_js = (ROOT / "data" / "grammar.js").read_text(encoding="utf-8")

    func_match = re.search(r"const GRAMMAR_BOOKS = \{.*?\nconst getGrammarChapters = getGrammarChaptersList;", html, re.DOTALL)
    assert func_match is not None, "Could not find getBookBadge / getGrammarChapters in index.html"
    func_code = func_match.group(0)

    test_js = f"""
    {grammar_js}
    const state = {{ grammarBook: 'all', grammarChapter: 'all', grammarWeakData: {{}}, grammarStats: {{}} }};
    {func_code}

    const results = {{
        badgeKin: getBookBadge('kin'),
        badgePolaris: getBookBadge('polaris2'),
        badgeToplevel: getBookBadge('toplevel'),
        badgeSekai: getBookBadge('sekai'),
        choice0: grammarChoiceLabel(0),
        choice4: grammarChoiceLabel(4),
        polarisChCount: getGrammarChapters('polaris2').length,
        toplevelChCount: getGrammarChapters('toplevel').length,
        allChCount: getGrammarChapters('all').length
    }};
    console.log(JSON.stringify(results));
    """

    res = subprocess.run(["node"], input=test_js, text=True, capture_output=True)
    assert res.returncode == 0, f"Node execution failed: {res.stderr}"

    data = json.loads(res.stdout)
    assert "badge-kin" in data["badgeKin"]
    assert "badge-polaris" in data["badgePolaris"]
    assert "badge-toplevel" in data["badgeToplevel"]
    assert "badge-sekai" in data["badgeSekai"]
    assert data["choice0"] == "A"
    assert data["choice4"] == "E"
    assert data["polarisChCount"] == 7  # 'all' + 6 units
    assert data["toplevelChCount"] == 25  # 'all' + 24 lectures
    # 「すべて」は、4 冊の章を本をまたいで選べるよう並べる: 全問 + 7 + 14 + 6 + 24
    assert data["allChCount"] == 52
