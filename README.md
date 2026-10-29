# TOEIC Practice Web App (文法ドリル & 単語学習)

TOEICおよび大学入試・英文法学習のためのPWA対応Webドリルアプリケーション。
PCブラウザ（キーボードショートカット対応）およびモバイル環境で高速・快適に問題演習を行えます。

## 📚 収録英文法問題データ (計1,155問)

`data/grammar.js` に以下の4冊・計1,155問の文法問題を収録しています。各教材のID体系は完全に分離されており、LocalStorageに記録された学習履歴や苦手問題（Weak Data）との衝突が起きない設計になっています。

| 教材 | バッジ | 問題数 | ID範囲 | 構成 |
| :--- | :--- | :---: | :---: | :--- |
| **世界一わかりやすい英文法** | `📖 世界一` | 141問 | `1` 〜 `141` | 全14章 |
| **TOEIC L&R テスト 文法問題 でる1000問 (金の文法)** | `👑 金の文法` | 160問 | `1001` 〜 `1160` | 全7章（解き方フェーズ付き） |
| **英文法ポラリス2 [応用レベル]** | `🧭 ポラリス2` | 334問 | `2001` 〜 `2334` | 全6ユニット（見開きOCR抽出） |
| **高3 トップレベル英語** | `🎓 トップレベル` | 520問 | `3001` 〜 `3520` | 全24講（厳選4択・5択問題） |

### 総問題数: **1,155問**

---

## 🚀 主な機能

1. **4教材の絞り込み切り替え**:
   - 上部セグメントバー（横スクロール対応）で「すべて」「金の文法」「世界一」「ポラリス2」「トップレベル」をワンタップで切り替え。
   - 教材ごとの章・ユニット・講義セレクターが動的に連動。
2. **多肢選択対応 (3〜5択)**:
   - 一般的な4択（A〜D）に加え、大学入試難問や特殊設問の5択（A〜E）および3択問題にも完全対応。
   - キーボードショートカット（数字キー `1`〜`5`、アルファベット `A`〜`E`）で瞬時に解答可能。
3. **Obsidian Vault との双方向ステータス同期**:
   - `English_study`（英文法ナレッジグラフ Vault）の `scripts/sync_status.py` と連携。
   - Webアプリ側で間違えた問題（苦手データ）と、Obsidian側の `#status/review`・`#status/mastered` を双方向同期可能。
4. **学習サポート**:
   - 正解・不正解時の即時フィードバックと日本語和訳・詳細解説の折りたたみ表示。
   - 苦手問題復習モード（忘却曲線に基づく復習管理）。

---

## 🧪 テスト・検証

以下のテストスイートで、データの整合性・パース性・UI実行性・Obsidian同期互換性を検証しています。

```bash
# toeic_practice のテスト実行
python3 -m pytest tests -v

# English_study の同期互換性・Vaultテスト実行
python3 -m pytest /Users/reiji/projects/English_study/tests -v

# 純粋ロジック（src/*.js）の単体テスト（Node.js 標準のテストランナー）
node --test tests/unit/
```

ブラウザを動かすテストは Playwright が必要です（初回のみ `npm install -g playwright` と `npx playwright install chromium`）。

```bash
# バックアップの復元・取り消し、設定ページ、src/*.js の読み込み失敗時の動作
NODE_PATH=$(npm root -g) node tests/backup-extras.test.js

# 解いている間のカウントアップ（画面下のフッター）
NODE_PATH=$(npm root -g) node tests/live-timer.test.js

# 下から出るシートの行き来（バックアップ画面の「戻る」など）と、廃止した旧い設定シート
NODE_PATH=$(npm root -g) node tests/sheets.test.js

# 演習画面の構成（モード選択は絞り込みシートだけ、フッターに設定リンクなし）
NODE_PATH=$(npm root -g) node tests/practice-chrome.test.js

# 文法の出題済み記録・絞り込み・バックアップ（版6）
NODE_PATH=$(npm root -g) node tests/grammar-seen.test.js
```

### 検証項目
- `data/grammar.js` の Python / Node.js 双方での正常構文解析
- 全1,155問のID重複ゼロ、ID範囲適合、問題文・選択肢（3〜5択）・正解インデックス境界値保証
- 不適当選択問題（【不適当なものを選択】）のヘッダー表示
- OCRノイズや改行ゴミの完全除去
- `index.html` 内のバッジ・章生成・選択肢ラベル関数（Node.js環境シミュレーション）
- `English_study/scripts/sync_status.py` による全1,155問の1対1対応
