# CLAUDE.md — toeic_practice

TOEIC・英文法・単語の PWA ドリル（TOEIC Drill）。ビルド処理のない静的サイトで、GitHub Pages で公開している（公開の仕組みは下の「公開」）。
機能の説明と収録データは `README.md`、設計の経緯は `docs/superpowers/`（specs が設計、plans が実装計画。日付つき）。

## 構成

- 本体: `index.html` ＋ `home.js` / `home.css`（ホーム・復習・設定・グラフの画面）＋ `js/*.js`（ドリル、フィルター、バックアップ、Google ドライブ同期 など）＋ `css/`。
- `src/*.js`: DOM にも localStorage にも触れない純粋ロジック（ブラウザでは `StudyCore.*`、Node では `require`）。単体テストは `tests/unit/`。
- `vendor/`: d3-force 3.0.0 とその依存（UMD、無改変）。グラフを開いたときだけ読む。配置の力の定義は `src/graph-force.js` で、
  ビルド（`tools/lib/layout.mjs`）とアプリ（`js/graph-view.js`）が共有する。`GRAPH_LAYOUT` を変えると生成物 `data/grammar_graph.js` の座標が変わる
  （`tests/build_graph.test.js` がコミット済みの座標の再現を確かめる）。実行時の調整は教材軸が `GRAPH_RUNTIME`、文法軸（13 概念の円周配置）は `GRAPH_GRAMMAR` で行う。
- `data/`: `words.js` / `grammar.js`（983問。教材ごとに ID 範囲が分かれる: 1〜、1001〜、2001〜、3001〜）/ `tips.js` / `grammar_graph.js`。
- `data/grammar_graph.js` は**生成物**。手で直さない。`tools/build_grammar_graph.mjs` が Obsidian Vault（`/Users/reiji/projects/English_study`）から作る（`VAULT_DIR` か引数で Vault を指定）。
- 試用版「Study Desk」（`next/`）は、機能を現行版へ移植し終えたので 2026-11-23 に削除した（git の履歴には残る）。
  端末に残る試用版の保存キー `toeic_next_v1` は現行版が読まないので、消す処理も入れていない。試用版のキャッシュ（`toeic-next-*`）は `sw.js` の掃除で消える。
- `archive/`・`*.bak`・`_site/`・`.claude/`・`.superpowers/` は Git の対象外（手元だけ）。

## 守ること（壊れやすい約束事）

1. **JS の読み込み順に意味がある。** `js/*.js` は通常の `<script>` で、全ファイルがグローバルを共有する。並びは `index.html` が正。
   最上位で実行されるコードが使う関数は、先に読む `js/util.js` に置く。`js/boot.js` は `home.js` より前に読まれ、
   `home.js` が `closeSheet` / `closeFilterSheet` / `reloadRecordsFromStorage` を後から包んで上書きしている。この関数の名前や呼び方を変えるときは `home.js` の末尾付近も見る。
2. **ファイルを足したら 2 か所の手書き一覧に足す:** `index.html` → `sw.js` の `ASSETS`。`ASSETS` は公開するファイルの一覧も兼ねる（ほかに公開するのは `tools/collect_site.py` の `EXTRA_FILES` だけ）。
   グラフ用のファイルのように `index.html` に書かないものも `ASSETS` には入れる。食い違いは `tests/test_file_lists.py` が検出する。
3. **学習記録は `saveJSON` / `loadJSON`（`js/util.js`）経由で保存する。** 値が変わらなければ書かない作りで、書いたときだけ `onStorageSaved` の受け手（同期など）に通知が行く。
   保存に失敗しても学習は止めず、失敗は `onStorageSaveFailed` の受け手が知らせる。保存まわりを触る前後で内容が同一になることを
   `tests/storage-writes.test.js`（比較用: `tests/fixtures/storage-scenario.golden.json`）と `tests/storage-subscribe.test.js` で確かめる。
4. **バックアップの形式を変えたら版を上げる。** `js/backup-core.js` の `BACKUP_FORMAT`（今は 7。版 7 でラベル `toeic_labels_v1` が入った）を上げ、`BACKUP_MIGRATIONS` に前の版からの変換を足し、`tests/grammar-seen.test.js` などで確かめる。
   Google ドライブ同期用ファイルは `BACKUP_FORMAT_DRIVE`（5）に固定しており、`BACKUP_FORMAT` とは連動させない（更新していない端末が読めるように）。
   同期の対象は `RECORD_KEYS` だけ（ラベルも含む。端末どうしでそろえる）で、日別記録・表示設定・ポモドーロ（`EXTRA_KEYS`）は同期しない。バックアップファイルと復元の取り消しには含める。
5. **統合（マージ）の規則は意図した仕様。** 苦手リストは更新時刻 `u`（なければ streak）が新しい方、問題ごとの正誤カウントと日別記録は「より進んでいる方」を残し、端末どうしの合算はしない（設定画面の説明文にもそう書いてある）。変えるときはこの説明文も直す。
6. **Google ドライブの自動同期は止めている**（`js/gdrive.js` の `GDRIVE_AUTOSYNC_AVAILABLE = false`）。手動の「今すぐ同期」と復元は使える。
   理由と経緯は `docs/performance-investigation-2026-11-08.md`。再開するときは、通信の回数と待ち時間を設計し直してから。
7. **どのタブも、メモリの記録を丸ごと書き戻す。** だから別のタブが保存したら読み込み直す（`js/boot.js` の `reloadRecordsSavedElsewhere`。`storage` イベントと、画面に戻ってきたとき）。
   対象は `CROSS_TAB_KEYS`（`RECORD_KEYS` から作るので、ラベルも入る）。設定・出題の続き・ポモドーロの設定は対象外（タブごとの画面の状態。ポモドーロは、止めているタイマーの残り時間を戻さないため）。
   保存できていないキーがあるタブ（`failedSaveKeys`）は読み込み直さない（メモリにしかない回答を捨てないため）。新しい記録のキーを足したら、ここに入れるかを決める。
8. **同期は、怪しいときは統合も保存もせずに止める**（`js/gdrive.js`）。時計のずれ（`driveClockProblem`。Google 側の時刻と 5 分以上違う、
   またはクラウドの記録にこの端末の「今」より先の時刻がある）と、取得後にほかの端末がクラウドを書き換えたとき（保存の直前に確かめ、3 回までやり直す）。
   止めても手元とクラウドの記録は変わらない。この 2 つは偽のドライブでしか確かめていない（本物の Google ドライブでは未確認）。
9. **`replaceRecords` の巻き戻しは、書けたキーだけを逆順で戻す**（`js/backup-io.js`）。同じ順で戻すと、容量不足のときに戻せなくなる。
10. **壊れて読めない記録は、上書きされる前に `元のキー.broken` に残す**（`js/word-stats.js` の `keepBrokenRecords`）。このキーはバックアップにも同期にも含めない。

11. **グラフの「近い問題を解く」は、通常の出題の続きを書き換えない。** 出題中（`state.nearDrill`）は `SESSION_KEY` と本ごとの続きに触れず、
    続きはこの端末だけのキー `toeic_near_drill_v1` に置く（バックアップ・同期・別のタブへの反映の対象外。`RECORD_KEYS` / `EXTRA_KEYS` / `CROSS_TAB_KEYS` に足さない）。
    通常の出題に戻る経路（`applyGrammarFilters`・`restoreSession`・`restoreBookSessionSnapshot`）は `clearNearDrill()` を呼ぶ。
    記録の読み込み直し（`js/backup-io.js` の `refreshPoolAfterRecordSync`）でも出題を作り直さない（出題中は先頭で戻る）。`tests/graph-drill.test.js` で確かめる。
    レーダーからの「テーマの問題を解く」も同じ仕組みで、`state.nearDrill.kind`（と保存した続きの `kind`）が `'theme'` のときは表示だけ「〈テーマ〉の N 問」になる。
12. **グラフは、力学が収まった後と移動のアニメーションが終わった後は描かない。** `requestAnimationFrame` を呼び続けるのは、
    開いたときの力学（`GRAPH_RUNTIME.ticks` 回。文法軸は `GRAPH_GRAMMAR.ticks` 回）と移動（約 0.3 秒）の間だけ。`tests/graph-view.test.js` が、その後の呼び出しが 0 回であることを確かめる。
13. **グラフの「文法軸」のモード選択と計算キャッシュは端末限定で扱う。** 選択中の配置軸は `toeic_graph_mode_v1`、計算済み座標キャッシュは
    `toeic_graph_grammar_cache_v1` に置き、どちらもバックアップ・同期・別タブ再読込の対象外（`RECORD_KEYS` / `EXTRA_KEYS` / `CROSS_TAB_KEYS` に足さない）。
    どちらも学習記録ではないので `saveJSON`（`failedSaveKeys`）に乗せず、`localStorage.setItem` を直接書いて失敗は無視する
    （`failedSaveKeys` に残ると、そのタブが別タブの保存を読み込み直さなくなるため。モードは次回教材軸で開き、キャッシュは再計算に戻るだけ）。
    キャッシュの署名（`grammarLayoutSignature`）はノードの id とエッジの中身まで含める。グラフを作り直して件数が同じでも、古い座標を出さないため。
    `tests/graph-entry.test.js` と `tests/graph-view.test.js`、`tests/unit/graph-force.test.js` で確かめる。

14. **下から出るシートの高さは端末限定で扱う。** つまみ（アプリ共通のシートは `.sheet-grab`、グラフの詳細シートは `.graph-sheet-grab` と見出し）で変えた高さを、
    シートの種類ごとに容器に対する割合で `toeic_sheet_heights_v1` に覚える（`js/settings.js` の `readSheetHeight` / `writeSheetHeight`。計算は `src/sheet-size.js`）。
    学習記録ではないので `saveJSON` に乗せず、`RECORD_KEYS` / `EXTRA_KEYS` / `CROSS_TAB_KEYS` に足さない。グラフの画面は `deps.getSheetHeight` / `setSheetHeight` 経由で、`localStorage` に直接触れない。
    `tests/sheet-resize.test.js`・`tests/graph-view.test.js`・`tests/unit/sheet-size.test.js` で確かめる。

7〜10 と保存まわりの消失・巻き戻りは `tests/data-safety.test.js` で確かめる（経緯: 2026-11-10 の調査。番号 1〜5 のシナリオ）。

## 方針（利用者と合意済み）

- 機能を減らす軽量化はしない。構造を整えて軽くする。保存・同期の設計はデータが消えないことを最優先にする。
- 進め方は「精査 → 案 → 承認 → テストを書いて実装 → コミット」。コードを書き換える前に案を出して承認を取る。
- 性能は実機（iPhone）では未計測。計測値はデスクトップ Chromium のもので、結論に使うときはそう断る。

## テストの実行

`tools/run_tests.mjs` で全部まとめて流す。ファイルごとの成否と所要時間を表示し、失敗したものはログの末尾を出す（全文は `_test-logs/`）。

```bash
node tools/run_tests.mjs                 # 全部。ブラウザのテストは 4 本ずつ並列で約 2 分（shell.test.js だけで約 2 分）
node tools/run_tests.mjs --fast          # ブラウザを使わないもの（pytest・tests/unit/・build_*）。数秒
node tools/run_tests.mjs graph labels    # 名前に graph か labels を含むものだけ
node tools/run_tests.mjs --list          # 流すテストの一覧
```

- テストは自動で探す（`tests/*.test.{js,mjs,cjs}`・`tests/unit/`・`tests/test_*.py`）。新しいテストは一覧に足さなくてよい。
  Playwright か `tests/labels-harness.cjs` を読み込むファイルがブラウザのテスト。成否は終了コードで決める（`node:test` のファイルも、独自の小さなランナーで PASS/FAIL を出すファイルも、失敗すれば 0 以外で終わる）。
- 1 本だけ直接流すときは `NODE_PATH=$(npm root -g) node tests/<名前>.test.js`（Playwright はグローバルに導入済み。スクリプトは `NODE_PATH` を自分で補う）。
- `python3` が Python 3.15 で pytest を持っていないので、スクリプトは Homebrew の `pytest` コマンドを使う（無ければ `python3 -m pytest`）。
- 並列で落ちたブラウザのテストは最後に 1 本ずつ流し直し、通れば「不安定」と表示する（全体は成功扱い。並列のときのログは `*.parallel.log`）。
  待ち時間に頼るテストが、CPU が混むと落ちることがあるため。「不安定」が続くテストは直す。流し直さないときは `--no-retry`、並列にしないときは `-j 1`。
- 既知の失敗は `tools/run_tests.mjs` の `KNOWN_FAILURES` に理由と一緒に書く（全体の成否に数えない）。今は無い。
- **CI**: `main` に push すると、Actions（`.github/workflows/pages.yml`）が配信の前に `--fast` を流し、落ちたら配信しない。ブラウザのテストは CI では流さないので、push の前に手元で全部流す。
  CI には Obsidian の Vault が無いので、`tests/test_e2e_integration.py` の同期の対応表のテストは飛ばされる。Python のテストに `/Users/reiji/...` の絶対パスを書かない。
- Obsidian との同期の互換テストは `English_study` 側（`/Users/reiji/projects/English_study/tests`）にある。

## 公開（outward-facing）

**`git push` で `main` を GitHub（`Ichirei13/toeic-vocabulary-app`。公開リポジトリ）に上げると、そのまま Pages で公開される。**
GitHub Actions（`.github/workflows/pages.yml`）が `tools/collect_site.py` で公開するファイルだけを `_site/` に集めて配信する。リポジトリには開発用のファイル（テスト・設計書・この CLAUDE.md）も上がるが、Pages には出ない。

- push する前に利用者の許可を取る。途中の作業は手元のコミットかブランチに置き、push しない。
- 公開される中身は `python3 tools/collect_site.py --list` で確かめられる。
- `--force` は使わない。
- 2026-11-22 までは `upload.py` が GitHub の API で公開ファイルだけを直接コミットしていて、手元の履歴と GitHub の履歴が二重になっていた。いまの方式に一本化した（`upload.py` は削除済み。履歴には残っている）。

## 開発サーバー

`.claude/launch.json`（Git の対象外）に 2 つある: `toeic-static`（8765）と、キャッシュを無効にする `toeic-nocache`（8766）。
`toeic-static` はキャッシュ用のヘッダーを付けないので、変更が反映されない・古い版が見えるときは `toeic-nocache` を使う。

## 書き方

コードのコメントとドキュメントは日本語。コミットメッセージは英語で `feat:` / `fix:` / `docs:` / `perf:` の形。
