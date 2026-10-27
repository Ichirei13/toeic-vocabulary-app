# Migrate Grammar Questions from English_study to toeic_practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use sp-subagent-driven-development (recommended) or sp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean and restructure grammar questions from `English_study` (Polaris 2 and Top Level English) and migrate them into the `toeic_practice` web app, expanding the question pool from 301 to over 1,100 questions.

**Architecture:** 
1. Re-extract and clean `English_study` datasets: Polaris 2 via left-right split OCR on two-page spreads to cleanly separate questions and answers, and Top Level English by enhancing the choice parser and filtering clean 4-choice questions.
2. Build an export script to merge all 4 books (`kin`, `sekai`, `polaris2`, `toplevel`) into `toeic_practice/data/grammar.js` using non-colliding ID ranges to preserve user progress and mistake logs.
3. Update `toeic_practice/index.html` UI to support 4-book filtering with scrollable tabs, custom badges, and dynamic chapter selectors.

**Tech Stack:** Python 3, PIL (Pillow), Tesseract OCR, pdftoppm, HTML5, Vanilla JavaScript, CSS3.

**Spec:** User request to re-clean and migrate grammar questions from `English_study` into `toeic_practice`.

## Global Constraints

- Python scripts must use `python3` (macOS environment).
- Keep existing problem IDs unchanged (`1..141` for `sekai`, `1001..1160` for `kin`) to avoid breaking existing LocalStorage progress and review status.
- For `toeic_practice`, all migrated questions MUST have valid 4-choice options and a valid 0-indexed answer (`0 <= answer < len(choices)`).
- All changes must pass automated integrity tests checking choice counts, non-empty questions, valid answer indices, and JSON/JS syntax.

## Review Focus

1. **Polaris 2 OCR separation**: Missing question or explanation text due to imperfect page boundaries or margin noise -> Validate all 334 questions have non-empty `question`, non-empty `explanation`, and `len(choices) == 4`.
2. **Top Level question types**: Non-multiple-choice items (reordering, fill-in-the-blank text) slipping into the drill pool -> Filter out any item where choices count is not between 3 and 5 or where choices are missing.
3. **ID collision & LocalStorage safety**: Duplicated IDs overwriting wrong-answer bookmarks -> Guarantee disjoint ID ranges (`1..141`, `1001..1160`, `2001..2334`, `3001..3600`).
4. **App UI layout on mobile**: Adding 2 extra books overflowing the segment selector -> Use flexbox with horizontal scrolling (`overflow-x: auto`) for book tabs.
5. **Chapter filtering consistency**: Hardcoded book branches in `index.html` breaking on new books -> Refactor chapter listing logic to dynamically group chapters by `g.b` and `g.ch`.

---

### Task 1: Polaris 2 Re-extraction with Split-Page OCR

**Files:**
- Create: `/Users/reiji/projects/English_study/scripts/extract_polaris_split.py`
- Create: `/Users/reiji/projects/English_study/tests/test_polaris_split.py`
- Output: `/Users/reiji/projects/English_study/polaris2_grammar.json`

**Interfaces:**
- Consumes: `/Users/reiji/projects/English_study/英文法ポラリス ［2応用レベル］.pdf`
- Produces: `polaris2_grammar.json` containing 334 clean question objects:
  ```json
  {
    "id": "polaris2_006",
    "book": "polaris2",
    "chapter": 1,
    "chapter_title": "時制⑴",
    "section": "UNIT 1",
    "number": 6,
    "question": "My friend is caught in a traffic jam. The game will be over by the time he ( ).",
    "choices": ["comes", "may come", "will come", "will have come"],
    "answer": 0,
    "translation": "友達が交通渋滞にはまっている。彼が来る頃には試合は終わっているだろう。",
    "explanation": "by the time 「〜するまでには」は従属接続詞なので、副詞節を作ります...",
    "rule_number": 6,
    "rule_title": "by the time の品詞は?",
    "vocabulary": []
  }
  ```

- [ ] **Step 1: Write test for Polaris 2 extraction integrity**

Create `/Users/reiji/projects/English_study/tests/test_polaris_split.py`:
```python
import json
from pathlib import Path

def test_polaris2_json_integrity():
    json_path = Path("/Users/reiji/projects/English_study/polaris2_grammar.json")
    assert json_path.exists(), "polaris2_grammar.json does not exist"
    
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    assert len(data) >= 300, f"Expected at least 300 questions, got {len(data)}"
    
    clean_choices_count = 0
    for q in data:
        assert q["book"] == "polaris2"
        assert q["id"].startswith("polaris2_")
        assert 0 <= q["answer"] < 4
        assert q["question"] and not q["question"].startswith("Polaris Question")
        assert len(q["choices"]) == 4, f"Question {q['id']} has {len(q['choices'])} choices"
        clean_choices_count += 1
        
    assert clean_choices_count >= 300
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest /Users/reiji/projects/English_study/tests/test_polaris_split.py -v`
Expected: FAIL (current `polaris2_grammar.json` has 222 items with 0 choices and dummy questions).

- [ ] **Step 3: Implement split-page OCR extractor**

Create `/Users/reiji/projects/English_study/scripts/extract_polaris_split.py`:
- Use `pdftoppm` to render 150 DPI page images.
- Split each page horizontally at `width // 2` into `left` (questions) and `right` (answers/explanations).
- Run Tesseract OCR on left (`--psm 6`) and right (`--psm 6`), caching into `/Users/reiji/projects/English_study/scripts/.ocr_cache_polaris_split/`.
- Parse questions, choices ①〜④, and match with question numbers, answers, rules, explanations, and Japanese translations on the right.
- Write verified results to `/Users/reiji/projects/English_study/polaris2_grammar.json`.

- [ ] **Step 4: Run extractor and verify test passes**

Run: `python3 /Users/reiji/projects/English_study/scripts/extract_polaris_split.py`
Run: `python3 -m pytest /Users/reiji/projects/English_study/tests/test_polaris_split.py -v`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd /Users/reiji/projects/English_study
git add scripts/extract_polaris_split.py tests/test_polaris_split.py polaris2_grammar.json
git commit -m "feat: re-extract polaris2 grammar with split-page OCR"
```

---

### Task 2: Top Level English 4-Choice Question Cleansing

**Files:**
- Modify: `/Users/reiji/projects/English_study/scripts/toplevel_question_parser.py`
- Create: `/Users/reiji/projects/English_study/scripts/clean_toplevel_drill.py`
- Create: `/Users/reiji/projects/English_study/tests/test_toplevel_drill.py`
- Output: `/Users/reiji/projects/English_study/toplevel_grammar_drill.json`

**Interfaces:**
- Consumes: `/Users/reiji/projects/English_study/toplevel_grammar.json`
- Produces: `toplevel_grammar_drill.json` containing ~500 clean 4-choice questions:
  ```json
  {
    "id": "toplevel_ch01_01",
    "book": "toplevel",
    "chapter": 1,
    "chapter_title": "時制⑴",
    "section": "入試問題演習",
    "number": 1,
    "question": "Fire fighters always ------- quickly whenever they are called.",
    "choices": ["arrive", "are arriving", "arrives", "have arrived"],
    "answer": 0,
    "translation": "消防士は呼ばれればいつも迅速に到着するものだ。",
    "explanation": "",
    "rule_number": 1,
    "rule_title": "時制⑴ ポイント【1】",
    "vocabulary": []
  }
  ```

- [ ] **Step 1: Write test for Top Level drill dataset**

Create `/Users/reiji/projects/English_study/tests/test_toplevel_drill.py`:
```python
import json
from pathlib import Path

def test_toplevel_drill_integrity():
    json_path = Path("/Users/reiji/projects/English_study/toplevel_grammar_drill.json")
    assert json_path.exists(), "toplevel_grammar_drill.json does not exist"
    
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    assert len(data) >= 480, f"Expected at least 480 clean 4-choice questions, got {len(data)}"
    
    for q in data:
        assert q["book"] == "toplevel"
        assert len(q["choices"]) in [3, 4, 5]
        assert 0 <= q["answer"] < len(q["choices"])
        assert q["question"] and "-------" in q["question"] or len(q["question"]) > 10
        # Ensure no reorder brackets exist in multiple-choice questions
        assert not ("[" in q["question"] and "/" in q["question"] and "]" in q["question"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest /Users/reiji/projects/English_study/tests/test_toplevel_drill.py -v`
Expected: FAIL (file does not exist yet).

- [ ] **Step 3: Implement choice parser improvements & filter drill script**

Modify `/Users/reiji/projects/English_study/scripts/toplevel_question_parser.py`:
- Support letter-based choices `A ... B ... C ... D ...`.
- Support unspaced numeric choices `1.word 2. word`.
- Filter out Japanese instruction-only questions and reorder questions `[...]`.

Create `/Users/reiji/projects/English_study/scripts/clean_toplevel_drill.py`:
- Filter and clean `toplevel_grammar.json`.
- Output verified multiple-choice problems to `toplevel_grammar_drill.json`.

- [ ] **Step 4: Run script and verify test passes**

Run: `python3 /Users/reiji/projects/English_study/scripts/clean_toplevel_drill.py`
Run: `python3 -m pytest /Users/reiji/projects/English_study/tests/test_toplevel_drill.py -v`
Expected: PASS with >= 480 clean questions.

- [ ] **Step 5: Commit changes**

```bash
cd /Users/reiji/projects/English_study
git add scripts/toplevel_question_parser.py scripts/clean_toplevel_drill.py tests/test_toplevel_drill.py toplevel_grammar_drill.json
git commit -m "feat: clean and filter top level english 4-choice questions"
```

---

### Task 3: Build Exporter to `toeic_practice/data/grammar.js`

**Files:**
- Create: `/Users/reiji/myapps/toeic_practice/scripts/merge_all_grammar.py`
- Create: `/Users/reiji/myapps/toeic_practice/tests/test_grammar_js.py`
- Modify: `/Users/reiji/myapps/toeic_practice/data/grammar.js`

**Interfaces:**
- Consumes:
  - Existing `kin` items in `grammar.js` (160 items, IDs 1001..1160)
  - Existing `sekai` items in `grammar.js` (141 items, IDs 1..141)
  - `/Users/reiji/projects/English_study/polaris2_grammar.json` (334 items)
  - `/Users/reiji/projects/English_study/toplevel_grammar_drill.json` (~500 items)
- Produces:
  - Updated `/Users/reiji/myapps/toeic_practice/data/grammar.js` containing `const RAW_GRAMMAR = [...]` with > 1,100 questions.
  - Assigned ID ranges:
    - `sekai`: `1` - `141`
    - `kin`: `1001` - `1160`
    - `polaris2`: `2001` - `2334`
    - `toplevel`: `3001` - `3550`

- [ ] **Step 1: Write integrity test for `grammar.js`**

Create `/Users/reiji/myapps/toeic_practice/tests/test_grammar_js.py`:
```python
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
    for item in data:
        assert "id" in item
        assert item["id"] not in ids, f"Duplicate ID found: {item['id']}"
        ids.add(item["id"])
        
        assert "b" in item
        books.add(item["b"])
        
        assert "q" in item and len(item["q"]) > 5
        assert "c" in item and len(item["c"]) in [3, 4, 5]
        assert "a" in item and 0 <= item["a"] < len(item["c"])
        assert "ch" in item and "ch_title" in item
        
    assert books == {"sekai", "kin", "polaris2", "toplevel"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest /Users/reiji/myapps/toeic_practice/tests/test_grammar_js.py -v`
Expected: FAIL (currently only 301 items and 2 books).

- [ ] **Step 3: Implement merge script**

Create `/Users/reiji/myapps/toeic_practice/scripts/merge_all_grammar.py`:
- Reads existing `grammar.js` to extract `kin` and `sekai` along with `const KIN_PHASES = [...]`.
- Reads `polaris2_grammar.json`, maps fields to `RAW_GRAMMAR` format (`id`: 2001+, `b`: "polaris2").
- Reads `toplevel_grammar_drill.json`, maps fields to `RAW_GRAMMAR` format (`id`: 3001+, `b`: "toplevel").
- Preserves `KIN_PHASES` block verbatim.
- Writes formatted `grammar.js`.

- [ ] **Step 4: Execute merge and verify test passes**

Run: `python3 /Users/reiji/myapps/toeic_practice/scripts/merge_all_grammar.py`
Run: `python3 -m pytest /Users/reiji/myapps/toeic_practice/tests/test_grammar_js.py -v`
Expected: PASS with 1,100+ items and zero ID collisions.

- [ ] **Step 5: Commit changes**

```bash
cd /Users/reiji/myapps/toeic_practice
git add scripts/merge_all_grammar.py tests/test_grammar_js.py data/grammar.js
git commit -m "feat: merge polaris2 and toplevel into grammar.js (>1100 questions)"
```

---

### Task 4: UI Updates in `toeic_practice/index.html`

**Files:**
- Modify: `/Users/reiji/myapps/toeic_practice/index.html`

**Interfaces:**
- Consumes: `RAW_GRAMMAR` containing books: `all`, `kin`, `sekai`, `polaris2`, `toplevel`.
- Produces:
  - Scrollable segment button container for selecting any of the 4 books.
  - Distinct badge styles for `polaris2` (`.badge-polaris`) and `toplevel` (`.badge-toplevel`).
  - Dynamic `getGrammarChapters(book)` supporting all books and generating chapter lists.
  - Correct book name display in review sheets and wrong answer lists.

- [ ] **Step 1: Write HTML / UI regression test**

Create `/Users/reiji/myapps/toeic_practice/tests/test_ui_consistency.py`:
```python
from pathlib import Path

def test_index_html_has_all_book_badges_and_selectors():
    html = Path("/Users/reiji/myapps/toeic_practice/index.html").read_text(encoding="utf-8")
    
    # Check segment buttons
    assert 'data-gbook="polaris2"' in html
    assert 'data-gbook="toplevel"' in html
    
    # Check CSS classes
    assert '.badge-polaris' in html
    assert '.badge-toplevel' in html
    
    # Check state validation
    assert "'polaris2'" in html and "'toplevel'" in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest /Users/reiji/myapps/toeic_practice/tests/test_ui_consistency.py -v`
Expected: FAIL (`data-gbook="polaris2"` not in HTML).

- [ ] **Step 3: Modify `index.html`**

1. In CSS `<style>`:
   - Add `.badge-polaris` (e.g., purple theme `#7c3aed`) and `.badge-toplevel` (e.g., emerald green `#059669`).
   - Style `.segment-group` or `#grammarBookSegments` to allow smooth horizontal scrolling (`overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch;`).
2. In Grammar Settings markup:
   - Add `<div class="segment" data-gbook="polaris2">🧭 ポラリス2 <span style="font-size:10px;opacity:0.8;">(334)</span></div>`
   - Add `<div class="segment" data-gbook="toplevel">🎓 トップレベル <span style="font-size:10px;opacity:0.8;">(...)</span></div>`
3. In JavaScript logic:
   - Update `state.grammarBook` valid list: `['all', 'kin', 'sekai', 'polaris2', 'toplevel']`.
   - Generalize chapter generator function to dynamically build chapters for `polaris2` and `toplevel`:
     ```javascript
     const count = RAW_GRAMMAR.filter(x => x.b === book && x.ch === g.ch).length;
     ```
   - Update book badge renderer:
     ```javascript
     function getBookBadge(b) {
       if (b === 'kin') return '<span class="grammar-book-badge badge-kin">👑 金の文法</span>';
       if (b === 'polaris2') return '<span class="grammar-book-badge badge-polaris">🧭 ポラリス2</span>';
       if (b === 'toplevel') return '<span class="grammar-book-badge badge-toplevel">🎓 トップレベル</span>';
       return '<span class="grammar-book-badge badge-sekai">📖 世界一</span>';
     }
     ```

- [ ] **Step 4: Verify UI test and manual smoke check**

Run: `python3 -m pytest /Users/reiji/myapps/toeic_practice/tests/test_ui_consistency.py -v`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
cd /Users/reiji/myapps/toeic_practice
git add index.html tests/test_ui_consistency.py
git commit -m "feat: add polaris2 and toplevel support to grammar drill UI"
```

---

### Task 5: End-to-End Verification and Status Sync Compatibility

**Files:**
- Create: `/Users/reiji/myapps/toeic_practice/tests/test_e2e_integration.py`
- Modify: `/Users/reiji/projects/English_study/scripts/sync_status.py` (if necessary to recognize new IDs)

- [ ] **Step 1: Write E2E integration test**

Verify that:
1. `grammar.js` parses cleanly in Node.js / Python.
2. Filter by each book returns non-empty questions with valid choices.
3. Every question has a valid title, choices, and answer.
4. Total question count exceeds 1,100.

- [ ] **Step 2: Run all tests in both repositories**

Run: `pytest /Users/reiji/projects/English_study/tests -v`
Run: `pytest /Users/reiji/myapps/toeic_practice/tests -v`
Expected: ALL PASS

- [ ] **Step 3: Final Commit and Documentation Update**

Update `README.md` and commit final state:
```bash
git commit -m "docs: document expanded grammar question pool (>1100 questions)"
```
