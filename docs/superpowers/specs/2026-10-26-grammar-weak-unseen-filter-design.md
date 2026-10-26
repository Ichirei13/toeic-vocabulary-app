# 文法ドリルに「苦手+未」の絞り込みを追加する — 設計

## 目的
文法ドリルで、まだ解いていない問題と苦手の問題だけを出せるようにする。単語ドリルの「苦手+未」(`weak_unlearned`)と同じ意味・同じ名前にそろえる。

## 決めたこと(ユーザーと合意済み)
- 「未出題」を正しく判定するため、**文法の出題済み問題を記録する専用データを新しく作る**。通算正誤カウントからの推定はしない。
- これまでに解いた問題は、**既存の記録から初期値を作って**引き継ぐ。
- 「出題済み」は単語側と同じく、**回答した時点**で記録する(「わからない」も含む)。
- バックアップは**形式を版4に上げる**(既存の慣例どおり)。統合復元は和集合にする。

## 範囲外
- Obsidian 連携(`exportObsidianGrammarSync` / `applyObsidianSyncPayload`)。苦手リストだけを扱うので変えない。
- 文法の絞り込みの件数バッジ。
- 古いアプリが版4のファイルを読めること(今の仕組みどおり「新しいバージョン」として断られる)。

## データ
- 保存キー: `GRAMMAR_SEEN_KEY = 'toeic_seen_grammar'`。値は問題番号(正の整数)の配列。モード別にはしない。
- `state.grammarSeen`: `Set<number>`。`state` の定義で `grammarStats` と `grammarWeakData` のあとに読み込む。
- `loadGrammarSeen()`:
  - 保存値が配列なら、正の整数だけを残して返す。データに無い番号も、苦手リストと同様に残す。
  - 保存値が無い(`null`)なら、**初期値を作る**。`grammarStats` と `grammarWeakData` のキーのうち正の整数として読めるものを集めて保存し、返す。
  - 壊れた値(配列でも `null` でもない)は空として扱い、初期値は作らない。保存はしない。
- `saveGrammarSeen()`: `saveJSON` で配列にして保存する。
- 追加のタイミング: `recordWeakGrammar(ex, isCorrect)` の中で `grammarSeen.add(ex.id)` し、増えたときだけ保存する。単語側の `recordWeak` と同じ作り。

## 絞り込み
- `grammarWeakFilter` に値 `'weak_unlearned'` を足す(既存: `all` / `weak_only` / `due`)。
- UI: `#grammar-weak-segments` の「すべて」と「苦手のみ」の間に、`data-gweak="weak_unlearned"` の「苦手+未」を足す。
- `applyGrammarFilters` の条件: `weak_unlearned` のとき、**苦手リストに無く、かつ出題済みの問題は除く**(単語側 `applyFilters` と同じ意味)。
- `restoreSettings` で受け付ける値のリストに `'weak_unlearned'` を足す。初期値は `'all'` のまま。
- 既存の処理は変えない: 出題の続き(`sessionSignature`)・絞り込みの件数(`updateFilterSummary`)・ナッジの判定キーは、`grammarWeakFilter` をそのまま使っているので追加の対応は要らない。
- ルール別ドリル(`startRuleDrill`)が `grammarWeakFilter = 'all'` に戻す処理は変えない。

## バックアップ
- `BACKUP_FORMAT` を 3 → 4 に上げる。コメントの版の説明に「版4: 文法の出題済みを含む」を足す。
- `buildBackup`: `data.seenGrammar` に `[...state.grammarSeen]` を入れる。
- `BACKUP_MIGRATIONS[3]`: 版3のファイルを版4に直す。`data.seenGrammar` が無ければ、`data.grammarStats` と `data.weakGrammar` のキーから作った配列を入れる。`data` が壊れているときは `format` だけ変えて、あとの検証に任せる(`2` の変換と同じ作法)。
- `toeic_practice_backup`(独自形式)の変換: `seenGrammar` を、同じように `grammarStats` と `weakGrammar` から作って入れる。
- `parseBackup`:
  - `d.seenGrammar` は版4では必須の配列。配列でなければ「形が正しくありません」で断る。
  - `sanitizeSeenGrammar(raw)` で、正の整数だけを残し、重複を除き、除いた件数を `invalid` に足す。
  - `records.seenGrammar` として返す。
- `RECORD_KEYS` に `seenGrammar: GRAMMAR_SEEN_KEY` を足す。`RECORD_STORAGE_KEYS` はここから作られるので、取り消し用の退避にも自動で含まれる。
- `runRestore`:
  - 統合: `mergeSeenGrammar(cur, inc)` = 和集合。現在値は `[...state.grammarSeen]`。
  - 上書き: ファイルの内容をそのまま使う。
- `reloadRecordsFromStorage`: `state.grammarSeen = loadGrammarSeen()` を足す。取り消しで保存値が消えた(`null`)場合は、読み込み時に初期値が作り直される。
- 件数の表示:
  - `currentCounts` / `countsFromRaw` に `grammarSeen`(件数)を足す。
  - `compareTable` に「出題済みの文法 ○問」の行を足す。
  - 壊れた保存値や、`seenGrammar` が無い保存値の件数は 0 とする。

## エラー処理
- 保存できない環境(プライベートモードなど)では、既存の `saveJSON` の扱いに従う。
- 復元の失敗時は、既存の `replaceRecords` が元に戻す。追加のキーも同じ仕組みで戻る。

## 確認方法(Playwright)
1. 新規状態で「苦手+未」を選ぶと、全問が出る。
2. 1問解くと、その問題が次回の出題範囲から外れる。ただし苦手に入った問題は残る。
3. 通算正誤カウントと苦手リストだけがある状態(`toeic_seen_grammar` 無し)で起動すると、初回に初期値が作られて、それらが出題済みになる。2回目の起動では作り直されない。
4. 版3のファイルを復元できる(統合・上書き・取り消し)。復元後の出題済みが、ファイル内の成績と苦手から作られている。
5. 版4で書き出して、そのまま読み込める。統合は和集合になる。
6. 設定の保存と再読み込みで「苦手+未」が残る。値が不正なときは `'all'` に戻る。
7. 比較表に「出題済みの文法」の行が出る。
8. 単語側の「苦手+未」と、既存のバックアップ(版3の単語データ)が壊れていない。
9. コンソールエラーが出ない。
