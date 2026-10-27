#!/usr/bin/env python3
"""
scripts/merge_all_grammar.py

Merges all grammar question datasets into toeic_practice/data/grammar.js:
1. sekai (141 items, IDs 1..141 from grammar.js)
2. kin (160 items, IDs 1001..1160 from grammar.js)
3. polaris2 (334 items, IDs 2001..2334 from English_study/polaris2_grammar.json)
4. toplevel (~520 items, IDs 3001+ from English_study/toplevel_grammar_drill.json)

Preserves the exact KIN_PHASES block from grammar.js.
Applies rigorous sanitization to toplevel and polaris2 items.
"""

import json
import re
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
GRAMMAR_JS = DATA_DIR / "grammar.js"

ENGLISH_STUDY_DIR = Path("/Users/reiji/projects/English_study")
POLARIS2_JSON = ENGLISH_STUDY_DIR / "polaris2_grammar.json"
TOPLEVEL_JSON = ENGLISH_STUDY_DIR / "toplevel_grammar_drill.json"

# Explicit malformed items to discard
TOPLEVEL_DISCARD_IDS = {
    "toplevel_ch05_13",  # Cloze rewrite with instructions in choices
    "toplevel_ch16_29",  # Swapped translation/explanation
    "toplevel_ch06_23",  # Reordering question with noise
    "toplevel_ch11_11",  # Reordering question with [ ]Lthisbook...
}


def clean_choice_token(c: str) -> str:
    c = c.strip()
    if "\n" not in c:
        return c
    lines = [line.strip() for line in c.split("\n") if line.strip()]
    if not lines:
        return ""
    first_line = lines[0]
    rest = " ".join(lines[1:])
    has_jp = bool(re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", rest))
    is_garbage = bool(re.search(r"BY EAT|ERA EA|POSEN|PERS|US peom|\[RS\]|画 入 試|ポイ ント", rest))
    if has_jp or is_garbage:
        return first_line
    else:
        return " ".join(c.split())


def clean_toplevel_choices(raw_choices: list[str]) -> list[str]:
    cleaned = []
    for c in raw_choices:
        c = c.strip()
        # Handle cases where multiple choices got joined like 'which 4.who'
        parts = re.split(r"\s+[1-5]\.\s*", c)
        for part in parts:
            token = clean_choice_token(part)
            if token:
                cleaned.append(token)
    return cleaned


def clean_toplevel_question(q: str) -> str:
    # Check for negative selection questions
    q_norm = re.sub(r"\s+", "", q)
    if "不適当" in q_norm or "不適切" in q_norm:
        cleaned_q = re.sub(r"^.*?不\s*適\s*[当切].*?(選\s*び?\s*な?\s*さい|選\s*べ)[。.\s]*", "", q, flags=re.DOTALL)
        q = f"【不適当なものを選択】\n{cleaned_q.strip()}"
    else:
        # Strip leading boilerplate instruction
        q = re.sub(r"^空\s*[欄栓]\s*に\s*入\s*る.*?選び\s*な\s*さい[。.\s]*", "", q, flags=re.DOTALL)

    return q.strip()


def load_existing_grammar_js(js_path: Path):
    content = js_path.read_text(encoding="utf-8")

    m_raw = re.search(r"const RAW_GRAMMAR = (\[.*?\]);\s*\n\s*const KIN_PHASES", content, re.DOTALL)
    if not m_raw:
        raise ValueError(f"Could not parse RAW_GRAMMAR from {js_path}")

    raw_data = json.loads(m_raw.group(1))

    sekai_items = [x for x in raw_data if x.get("b") == "sekai"]
    kin_items = [x for x in raw_data if x.get("b") == "kin"]

    m_phases = re.search(r"(const KIN_PHASES\s*=.*)", content, re.DOTALL)
    if not m_phases:
        raise ValueError(f"Could not parse KIN_PHASES from {js_path}")
    kin_phases_block = m_phases.group(1).strip()

    return sekai_items, kin_items, kin_phases_block


def load_polaris2_items(json_path: Path, start_id: int = 2001):
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    polaris_items = []
    for idx, item in enumerate(data):
        current_id = start_id + idx
        q = re.sub(r"\(\s*\)", "-------", item["question"]).strip()
        choices = [c.strip() for c in item["choices"]]
        ans = item["answer"]
        trans = item.get("translation", "").strip()
        exp = item.get("explanation", "").strip()
        if trans and trans not in exp:
            exp = f"{exp}\n\n和訳: {trans}".strip()

        obj = {
            "id": current_id,
            "b": "polaris2",
            "ch": item["chapter"],
            "ch_title": item["chapter_title"],
            "th_title": item.get("rule_title") or f"{item.get('section', '')} Q{item.get('number', '')}".strip(),
            "q": q,
            "c": choices,
            "a": ans,
            "exp": exp,
            "v": item.get("vocabulary", []),
        }
        if item.get("rule_title"):
            obj["rule"] = {
                "number": item.get("rule_number", 0),
                "title": item["rule_title"],
                "category": item.get("chapter_title", ""),
            }
        polaris_items.append(obj)

    return polaris_items


def load_toplevel_items(json_path: Path, start_id: int = 3001):
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    toplevel_items = []
    current_id = start_id

    for item in data:
        raw_id = item.get("id", "")
        if raw_id in TOPLEVEL_DISCARD_IDS:
            continue

        q = clean_toplevel_question(item["question"])
        choices = clean_toplevel_choices(item["choices"])
        ans = item["answer"]

        # Validation
        if len(q) <= 5:
            continue
        if len(choices) not in [3, 4, 5]:
            continue
        if not (0 <= ans < len(choices)):
            continue

        trans = item.get("translation", "").strip()
        exp = item.get("explanation", "").strip()
        if trans and trans not in exp:
            exp = f"{exp}\n\n和訳: {trans}".strip()

        obj = {
            "id": current_id,
            "b": "toplevel",
            "ch": item["chapter"],
            "ch_title": item["chapter_title"],
            "th_title": item.get("rule_title") or f"第{item.get('chapter', 1)}章 Q{item.get('number', 1)}",
            "q": q,
            "c": choices,
            "a": ans,
            "exp": exp,
            "v": item.get("vocabulary", []),
        }
        if item.get("rule_title"):
            obj["rule"] = {
                "number": item.get("rule_number", 0),
                "title": item["rule_title"],
                "category": item.get("chapter_title", ""),
            }
        toplevel_items.append(obj)
        current_id += 1

    return toplevel_items


def merge_and_export():
    print(f"Reading existing grammar.js: {GRAMMAR_JS}")
    sekai_items, kin_items, kin_phases_block = load_existing_grammar_js(GRAMMAR_JS)
    print(f"  Existing sekai questions: {len(sekai_items)} (IDs {sekai_items[0]['id']}..{sekai_items[-1]['id']})")
    print(f"  Existing kin questions: {len(kin_items)} (IDs {kin_items[0]['id']}..{kin_items[-1]['id']})")

    print(f"Reading polaris2 questions: {POLARIS2_JSON}")
    polaris2_items = load_polaris2_items(POLARIS2_JSON, start_id=2001)
    print(f"  Loaded polaris2 questions: {len(polaris2_items)} (IDs {polaris2_items[0]['id']}..{polaris2_items[-1]['id']})")

    print(f"Reading toplevel questions: {TOPLEVEL_JSON}")
    toplevel_items = load_toplevel_items(TOPLEVEL_JSON, start_id=3001)
    print(f"  Loaded toplevel questions: {len(toplevel_items)} (IDs {toplevel_items[0]['id']}..{toplevel_items[-1]['id']})")

    all_questions = sekai_items + kin_items + polaris2_items + toplevel_items
    total_count = len(all_questions)
    print(f"Total merged questions: {total_count}")

    # Integrity verification
    assert total_count >= 1100, f"Expected >= 1100 questions, got {total_count}"

    ids = set()
    for item in all_questions:
        assert item["id"] not in ids, f"Duplicate ID: {item['id']}"
        ids.add(item["id"])
        assert len(item["q"]) > 5, f"Question too short in {item['id']}"
        assert len(item["c"]) in [3, 4, 5], f"Invalid choices in {item['id']}"
        assert 0 <= item["a"] < len(item["c"]), f"Invalid answer index in {item['id']}"
        assert item["b"] in {"sekai", "kin", "polaris2", "toplevel"}

    # Write out to grammar.js
    header_comment = "// 文法ドリルの問題データ（RAW_GRAMMAR）と 金の文法 の章ごとの解き方（KIN_PHASES）\n"
    json_data_str = json.dumps(all_questions, ensure_ascii=False)
    new_content = f"{header_comment}const RAW_GRAMMAR = {json_data_str};\n\n{kin_phases_block}\n"

    GRAMMAR_JS.write_text(new_content, encoding="utf-8")
    print(f"Successfully wrote {total_count} questions to {GRAMMAR_JS}")


if __name__ == "__main__":
    merge_and_export()
