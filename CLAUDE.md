# CLAUDE.md — toeic_practice

TOEIC・英文法・単語の PWA ドリル（TOEIC Drill）。ビルド処理のない静的サイトで、GitHub Pages で公開している。
機能の説明と収録データは `README.md`、設計の経緯は `docs/superpowers/`（specs が設計、plans が実装計画。日付つき）。

## 構成

- 本体: `index.html` ＋ `home.js` / `home.css`（ホーム・復習・設定・グラフの画面）＋ `js/*.js`（ドリル、フィルター、バックアップ、Google ドライブ同期 など）＋ `css/`。
- `src/*.js`: DOM にも localStorage にも触れない純粋ロジック（ブラウザでは `StudyCore.*`、Node では `require`）。単体テストは `tests/unit/`。
- `vendor/`: d3-force 3.0.0 とその依存（UMD、無改変）。グラフを開いたときだけ読む。配置の力の定義は `src/graph-force.js` で、
  ビルド（`tools/lib/layout.mjs`）とアプリ（`js/graph-view.js`）が共有する。`GRAPH_LAYOUT` を変えると生成物 `data/grammar_graph.js` の座標が変わる
  （`tests/build_graph.test.js` がコミット済みの座標の再現を確かめる）。実行時の調整は教材軸が `GRAPH_RUNTIME`、文法軸（13 概念の円周配置）は `GRAPH_GRAMMAR` で行う。
- `data/`: `words.js` / `grammar.js`（983問。教材ごとに ID 範囲が分かれる: 1〜、1001〜、2001〜、3001〜）/ `tips.js` / `grammar_graph.js`。
- `data/grammar_graph.js` は**生成物**。手で直さない。`tools/build_grammar_graph.mjs` が Obsidian Vault（`/Users/reiji/projects/English_study`）から作る（`VAULT_DIR` か引数で Vault を指定）。
- `next/`: 「Study Desk」の試用版。**公開対象ではない**（`upload.py` の `FILES` にも `sw.js` にも入っていない）。保存キーは別（`toeic_next_v1`）。
  現行版へ機能を移植する設計書（`docs/superpowers/specs/2026-10-29-port-study-desk-features-design.md`）では、`next/` は読み取り専用の参照元とされている。基本は触らない。
- `archive/`・`*.bak`・`.upload_state.json`・`.claude/`・`.superpowers/` は Git の対象外（手元だけ）。

## 守ること（壊れやすい約束事）

1. **JS の読み込み順に意味がある。** `js/*.js` は通常の `<script>` で、全ファイルがグローバルを共有する。並びは `index.html` が正。
   最上位で実行されるコードが使う関数は、先に読む `js/util.js` に置く。`js/boot.js` は `home.js` より前に読まれ、
   `home.js` が `closeSheet` / `closeFilterSheet` / `reloadRecordsFromStorage` を後から包んで上書きしている。この関数の名前や呼び方を変えるときは `home.js` の末尾付近も見る。
2. **ファイルを足したら 3 か所の手書き一覧に足す:** `index.html` → `sw.js` の `ASSETS` → `upload.py` の `FILES`。食い違いは `tests/test_file_lists.py` が検出する。
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
12. **グラフは、力学が収まった後と移動のアニメーションが終わった後は描かない。** `requestAnimationFrame` を呼び続けるのは、
    開いたときの力学（`GRAPH_RUNTIME.ticks` 回。文法軸は `GRAPH_GRAMMAR.ticks` 回）と移動（約 0.3 秒）の間だけ。`tests/graph-view.test.js` が、その後の呼び出しが 0 回であることを確かめる。
13. **グラフの「文法軸」のモード選択と計算キャッシュは端末限定で扱う。** 選択中の配置軸は `toeic_graph_mode_v1`、計算済み座標キャッシュは
    `toeic_graph_grammar_cache_v1` に置き、どちらもバックアップ・同期・別タブ再読込の対象外（`RECORD_KEYS` / `EXTRA_KEYS` / `CROSS_TAB_KEYS` に足さない）。
    特に座標キャッシュは揮発データのため `saveJSON`（`failedSaveKeys`）に乗せず、保存失敗時はエラーを出さず再計算へ戻す。
    `tests/graph-entry.test.js` と `tests/graph-view.test.js` で確かめる。

7〜10 と保存まわりの消失・巻き戻りは `tests/data-safety.test.js` で確かめる（経緯: 2026-11-10 の調査。番号 1〜5 のシナリオ）。

## 方針（利用者と合意済み）

- 機能を減らす軽量化はしない。構造を整えて軽くする。保存・同期の設計はデータが消えないことを最優先にする。
- 進め方は「精査 → 案 → 承認 → テストを書いて実装 → コミット」。コードを書き換える前に案を出して承認を取る。
- 性能は実機（iPhone）では未計測。計測値はデスクトップ Chromium のもので、結論に使うときはそう断る。

## テストの実行

`python3` が Python 3.15 で pytest を持っていないため、README の `python3 -m pytest` は動かない。Homebrew の `pytest` コマンドを使う。

```bash
pytest tests -q                  # Python（ファイル一覧の整合、grammar.js の検証など）
node --test tests/unit/          # src/*.js の単体テスト
node --test tests/next-*.test.mjs
NODE_PATH=$(npm root -g) node tests/<名前>.test.js   # ブラウザを動かすテスト（Playwright はグローバルに導入済み）
```

- ブラウザのテストは `tests/*.test.js` の単位で実行する。`shell.test.js` は約 90 秒かかる。
- 既知の失敗: `tests/next-browser.cjs`（ホームの教材カードを 4 枚と期待するが 6 枚出る。`next/` 側のテストが古い可能性が高く、原因は未特定）。
- Obsidian との同期の互換テストは `English_study` 側（`/Users/reiji/projects/English_study/tests`）にある。

## 公開（outward-facing）

`python3 upload.py -m "…"` は GitHub の `Ichirei13/toeic-vocabulary-app` の `main` に push し、Pages で**公開される**。
実行前に必ず `python3 upload.py -n`（送らず内容だけ表示）で確認し、利用者の許可を取る。GitHub 側が手元の記録から変わっていると push は止まる（先に `python3 upload.py pull`）。`--force` は使わない。

## 開発サーバー

`.claude/launch.json`（Git の対象外）に 2 つある: `toeic-static`（8765）と、キャッシュを無効にする `toeic-nocache`（8766）。
`toeic-static` はキャッシュ用のヘッダーを付けないので、変更が反映されない・古い版が見えるときは `toeic-nocache` を使う。

## 書き方

コードのコメントとドキュメントは日本語。コミットメッセージは英語で `feat:` / `fix:` / `docs:` / `perf:` の形。
