import re
import json
from pathlib import Path


def test_grammar_js_structure():
    js_path = Path("/Users/reiji/myapps/toeic_practice/data/grammar.js")
    content = js_path.read_text(encoding="utf-8")

    m = re.search(r"const RAW_GRAMMAR = (\[.*?\]);\s*\n\s*const KIN_PHASES", content, re.DOTALL)
    assert m is not None, "Could not match RAW_GRAMMAR in grammar.js"

    data = json.loads(m.group(1))
    assert len(data) >= 1100, f"Expected >= 1100 questions, got {len(data)}"

    books = set()
    ids = set()
    counts = {"sekai": 0, "kin": 0, "polaris2": 0, "toplevel": 0}

    for item in data:
        assert "id" in item
        assert item["id"] not in ids, f"Duplicate ID found: {item['id']}"
        ids.add(item["id"])

        assert "b" in item
        b = item["b"]
        books.add(b)
        counts[b] += 1

        assert "q" in item and len(item["q"]) > 5
        assert "c" in item and len(item["c"]) in [3, 4, 5]
        assert "a" in item and 0 <= item["a"] < len(item["c"])
        assert "ch" in item and "ch_title" in item
        assert "th_title" in item
        assert "exp" in item

        # Verify ID range by book
        if b == "sekai":
            assert 1 <= item["id"] <= 141, f"Sekai ID out of range: {item['id']}"
        elif b == "kin":
            assert 1001 <= item["id"] <= 1160, f"Kin ID out of range: {item['id']}"
        elif b == "polaris2":
            assert 2001 <= item["id"] <= 2334, f"Polaris2 ID out of range: {item['id']}"
        elif b == "toplevel":
            assert 3001 <= item["id"] <= 3600, f"Toplevel ID out of range: {item['id']}"

        # Verify choices are sanitized (no newlines with Japanese instructions or OCR noise)
        for choice in item["c"]:
            assert isinstance(choice, str)
            assert "\n" not in choice or not re.search(r"[\u3040-\u30ff\u4e00-\u9fff]|BY EAT|ERA EA|POSEN|PERS", choice), \
                f"Choice contains unclean newline or noise in item {item['id']}: {repr(choice)}"

        # Verify negative selection questions have clear tag
        if b == "toplevel" and ("不適当" in item["q"] or "不適切" in item["q"]):
            assert item["q"].startswith("【不適当なものを選択】"), \
                f"Negative prompt missing header tag: {item['q']}"

    assert books == {"sekai", "kin", "polaris2", "toplevel"}
    assert counts["sekai"] == 141
    assert counts["kin"] == 160
    assert counts["polaris2"] == 334
    assert counts["toplevel"] >= 500

    # Ensure malformed toplevel items were discarded
    toplevel_questions = [item["q"] for item in data if item["b"] == "toplevel"]
    assert not any("下線部を修正せずに日本語の意味" in q for q in toplevel_questions), "Malformed cloze rewrite leaked"
    assert not any("[ ]Lthisbook" in q for q in toplevel_questions), "Malformed reordering question leaked"

    # Check that KIN_PHASES is preserved verbatim
    m_phases = re.search(r"const KIN_PHASES = (\[.*?\]);\s*$", content, re.DOTALL)
    assert m_phases is not None, "Could not match KIN_PHASES in grammar.js"
    phases = json.loads(m_phases.group(1))
    assert len(phases) == 7, f"Expected 7 KIN_PHASES chapters, got {len(phases)}"
