from _sources import read_app_source
import json
from pathlib import Path
import re
import subprocess
import sys

TOEIC_DIR = Path("/Users/reiji/myapps/toeic_practice")
GRAMMAR_JS = TOEIC_DIR / "data" / "grammar.js"
INDEX_HTML = TOEIC_DIR / "index.html"
ENGLISH_STUDY_DIR = Path("/Users/reiji/projects/English_study")


def test_grammar_js_node_and_python_parsing():
    # 1. Python parsing
    content = GRAMMAR_JS.read_text(encoding="utf-8")
    m_raw = re.search(r"const RAW_GRAMMAR = (\[.*?\]);\s*\n\s*const KIN_PHASES", content, re.DOTALL)
    assert m_raw is not None, "Could not match RAW_GRAMMAR in grammar.js"
    raw_data = json.loads(m_raw.group(1))
    assert len(raw_data) == 983, f"Expected exactly 983 questions, got {len(raw_data)}"

    m_phases = re.search(r"const KIN_PHASES = (\[.*?\]);\s*$", content, re.DOTALL)
    assert m_phases is not None, "Could not match KIN_PHASES in grammar.js"
    phases_data = json.loads(m_phases.group(1))
    assert len(phases_data) == 7, f"Expected 7 KIN_PHASES, got {len(phases_data)}"

    # 2. Node.js native execution
    node_script = f"""
    const fs = require('fs');
    const code = fs.readFileSync('{GRAMMAR_JS}', 'utf8');
    eval(code + "\\n; if (!Array.isArray(RAW_GRAMMAR)) process.exit(1); if (!Array.isArray(KIN_PHASES)) process.exit(2); console.log(JSON.stringify({{ count: RAW_GRAMMAR.length, phases: KIN_PHASES.length }}));");
    """
    res = subprocess.run(["node", "-e", node_script], capture_output=True, text=True, check=True)
    parsed = json.loads(res.stdout)
    assert parsed["count"] == 983
    assert parsed["phases"] == 7


def test_book_filtering_and_counts():
    content = GRAMMAR_JS.read_text(encoding="utf-8")
    m_raw = re.search(r"const RAW_GRAMMAR = (\[.*?\]);\s*\n\s*const KIN_PHASES", content, re.DOTALL)
    data = json.loads(m_raw.group(1))

    sekai = [q for q in data if q["b"] == "sekai"]
    kin = [q for q in data if q["b"] == "kin"]
    polaris2 = [q for q in data if q["b"] == "polaris2"]
    toplevel = [q for q in data if q["b"] == "toplevel"]

    assert len(sekai) == 141
    assert len(kin) == 160
    assert len(polaris2) == 334
    assert len(toplevel) == 348
    assert len(sekai) + len(kin) + len(polaris2) + len(toplevel) == 983

    # Check ID ranges
    assert [q["id"] for q in sekai] == list(range(1, 142))
    assert [q["id"] for q in kin] == list(range(1001, 1161))
    assert [q["id"] for q in polaris2] == list(range(2001, 2335))
    assert [q["id"] for q in toplevel] == list(range(3001, 3349))


def test_all_questions_valid_fields_and_choices():
    content = GRAMMAR_JS.read_text(encoding="utf-8")
    m_raw = re.search(r"const RAW_GRAMMAR = (\[.*?\]);\s*\n\s*const KIN_PHASES", content, re.DOTALL)
    data = json.loads(m_raw.group(1))

    seen_ids = set()
    for item in data:
        # ID uniqueness and type
        qid = item["id"]
        assert isinstance(qid, int) and qid not in seen_ids
        seen_ids.add(qid)

        # Book
        b = item["b"]
        assert b in {"sekai", "kin", "polaris2", "toplevel"}

        # Chapter and theme
        assert isinstance(item["ch"], int) and item["ch"] > 0
        assert isinstance(item["ch_title"], str) and len(item["ch_title"].strip()) > 0
        assert isinstance(item["th_title"], str) and len(item["th_title"].strip()) > 0

        # Question prompt
        assert isinstance(item["q"], str) and len(item["q"].strip()) > 5

        # Choices
        choices = item["c"]
        assert isinstance(choices, list)
        assert len(choices) in [3, 4, 5], f"Unexpected choice count in ID {qid}: {len(choices)}"
        for c in choices:
            assert isinstance(c, str) and len(c.strip()) > 0
            # Ensure no leaked multiline OCR noise or instructions
            assert "\n" not in c or not re.search(r"[\u3040-\u30ff\u4e00-\u9fff]|BY EAT|ERA EA|POSEN|PERS", c)
            assert not re.search(r"BY EAT|ERA EA|POSEN|PERS", c)

        # Answer index
        ans = item["a"]
        assert isinstance(ans, int)
        assert 0 <= ans < len(choices), f"Invalid answer index {ans} for ID {qid} with {len(choices)} choices"

        # Explanation
        assert isinstance(item["exp"], str)


def test_ui_functions_execution_for_all_books():
    html = read_app_source()
    grammar_js = GRAMMAR_JS.read_text(encoding="utf-8")

    func_match = re.search(r"function getBookBadge\(.*?\nconst getGrammarChapters = getGrammarChaptersList;", html, re.DOTALL)
    assert func_match is not None, "Could not find UI functions in index.html"
    func_code = func_match.group(0)

    test_js = f"""
    {grammar_js}
    const state = {{ grammarBook: 'all', grammarChapter: 'all', grammarWeakData: {{}}, grammarStats: {{}} }};
    {func_code}

    const books = ['sekai', 'kin', 'polaris2', 'toplevel'];
    const badgeChecks = {{}};
    const chapterCounts = {{}};

    for (const b of books) {{
        badgeChecks[b] = getBookBadge(b);
        chapterCounts[b] = getGrammarChapters(b).length;
    }}

    // Check choice labels
    const labels = [0, 1, 2, 3, 4].map(grammarChoiceLabel);

    // Simulate sample rendering for each book
    const samplesRendered = [];
    for (const b of books) {{
        const sample = RAW_GRAMMAR.find(x => x.b === b);
        const badge = getBookBadge(sample.b);
        const choiceLabels = sample.c.map((choice, i) => `${{grammarChoiceLabel(i)}}: ${{choice}}`);
        samplesRendered.push({{
            book: b,
            id: sample.id,
            badgeLength: badge.length,
            choicesFormatted: choiceLabels.length
        }});
    }}

    console.log(JSON.stringify({{
        badgeChecks,
        chapterCounts,
        labels,
        samplesRendered,
        allChapterCount: getGrammarChapters('all').length
    }}));
    """

    res = subprocess.run(["node"], input=test_js, text=True, capture_output=True, check=True)
    out = json.loads(res.stdout)

    # Badges
    assert "badge-sekai" in out["badgeChecks"]["sekai"]
    assert "badge-kin" in out["badgeChecks"]["kin"]
    assert "badge-polaris" in out["badgeChecks"]["polaris2"]
    assert "badge-toplevel" in out["badgeChecks"]["toplevel"]

    # Chapters
    assert out["chapterCounts"]["sekai"] == 15    # all + 14 chapters
    assert out["chapterCounts"]["kin"] == 8        # all + 7 phases
    assert out["chapterCounts"]["polaris2"] == 7   # all + 6 units
    assert out["chapterCounts"]["toplevel"] == 25  # all + 24 lectures
    # 「すべて」は、4 冊の章を本をまたいで選べるよう並べる: 全問 + 7 + 14 + 6 + 24
    assert out["allChapterCount"] == 52

    # Choice labels
    assert out["labels"] == ["A", "B", "C", "D", "E"]

    # Sample renderings
    assert len(out["samplesRendered"]) == 4
    for s in out["samplesRendered"]:
        assert s["badgeLength"] > 10
        assert s["choicesFormatted"] in [3, 4, 5]


def test_status_sync_id_mapping_compatibility():
    sys.path.insert(0, str(ENGLISH_STUDY_DIR))
    from scripts.sync_status import build_canonical_toeic_mapping

    qid_to_pid, pid_to_qid = build_canonical_toeic_mapping(ENGLISH_STUDY_DIR)

    content = GRAMMAR_JS.read_text(encoding="utf-8")
    m_raw = re.search(r"const RAW_GRAMMAR = (\[.*?\]);\s*\n\s*const KIN_PHASES", content, re.DOTALL)
    data = json.loads(m_raw.group(1))

    # Verify that every single question ID in grammar.js has an exact 1-to-1 match in English_study mapping
    for item in data:
        pid = item["id"]
        assert pid in pid_to_qid, f"toeic_practice ID {pid} not found in sync_status mapping"
        qid = pid_to_qid[pid]
        assert qid_to_pid.get(qid) == pid, f"QID {qid} does not round-trip to PID {pid}"
