# Web 実装仕様 敵対的レビュー

- 対象: `docs/web-implementation-spec.md`（v1 固定と称する実装契約）
- レビュー日: 2026-08-28
- 立場: この仕様は書いていない。プロダクト要件（§2）は LOCKED。実装はしない。
- 照合した現行コード: `src/domain/**`, `src/components/InkLayer.tsx`, `PdfPane.tsx`, `Workspace.tsx`, `VerticalText.tsx`, `src/input/nativePointer.ts`, `pointerGestures.ts`, `src/domain/history.ts`, `reducer.ts`, `projects.ts`

**吸収ステータス（2026-08-28、仕様改訂後）:** 本文書は残す。B1–B12 と出荷バグ級 HIGH は `docs/web-implementation-spec.md` §18 に対応表がある。再レビューは改訂仕様に対して行え。このファイルの本文（下記 Verdict 以降）は改訂前の指摘の記録であり、削除しない。

---

## 1. Verdict

**revise before implementation**（記録。改訂後の仕様は §18 を見よ）

Ship ではない。Reject でもない。禁止リスト・数値の固定・VIEW_ONLY・「WebView PDF / View-per-pixel / 48×68 を本番に戻すな」は使える。ただしこのままコーディングすると、iPad で線が滲む・消しゴムが消えない・パンするたびに 8MB×ページ数をコピーする・PDF をパンできない・リロードで PDF が死ぬ、が先に届く。

ブロッカーを仕様パッチしてからゲート 1 に入れ。実装 PR と混ぜるな。

---

## 2. Blockers（仕様を直すまでコードを書いてはいけない）

### B1. `strokeInk` と Canvas ベイクが同時に正になっている

仕様は両方やれと書いてある。

- §5 `reducer.ts` **改修**: 「Action 意味は維持」「`strokeInk` は 1 ストローク 1 回」
- §9.2 ベイク手順 4: 「`reduceHistory(strokeInk | 相当)` を **1 回**」
- §9.2 ベイク手順 5: 「ドメイン `stampStroke` を本番ベイクに使わない」
- §14.3 / §14.17: `stampStroke` を pointermove で回すな、`applyStampFromPointer` を move 毎に dispatch するな

現行 `src/domain/reducer.ts` の `strokeInk` は `stampStroke(page.raster, …)` を呼ぶ。`reduceDocument` の先頭は毎回 `cloneDocument`（全ページ `Uint8ClampedArray` をコピー）。つまり **`strokeInk` を 1 回 dispatch した時点で 1200×1700 の JS スタンプ＋全ラスタ clone が走る**。それが「Action 意味は維持」である。

実装者の逃げ道は三つで、全部仕様違反か製品バグになる。

1. 言われた通り `strokeInk` を dispatch する → 本番で `stampStroke` が走る（§9.2 / §14.3 違反、E7 の 50ms などではない、メインスレッドが死ぬ）
2. Canvas だけ焼いて `strokeInk` を飛ばす → undo がインクを復元しない（§9.2 手順 4 と履歴契約が空文）
3. 勝手に `commitInk` を足す → §5 は Action 意味を維持しろと言っているだけで、**Canvas ベイク専用 action の意味・payload・undo 時の復元手順が無い**

**修正:** `strokeInk` をテスト専用に降格し、本番用 action を明示する。例:

```
type: 'commitInkBake'
target: InkTarget
rasterId: string
```

- 本番 reducer は `Raster.data` を触らない。`InkEngine` の OffscreenCanvas を正とする。
- undo/redo は `past[i].rasters.get(rasterId)`（ImageBitmap または PNG）を `InkEngine` に戻す。
- テストは小ラスタのまま `strokeInk` + `stampStroke` を継続。CI は Canvas 画素一致を要求しない（E3 で既に逃げている。本番パスの契約を別に書け）。

「相当」という単語を §9.2 から消せ。相当は仕様ではない。

---

### B2. 消しゴムのライブ overlay が物理的に成立しない

§9.2 ライブ:

- overlay に `beginPath` / `lineTo` / `stroke`
- 消しゴムは `globalCompositeOperation = 'destination-out'`
- 「DocumentState / IndexedDB を動かさない」
- `stampBrush` の JS ループを呼ばない

overlay が「今ストロークの線」だけなら、`destination-out` が消すのは overlay 上の空ピクセルである。**ページに既にあるインクは 1px も消えない。** pointerup で `drawImage` しても、透明 overlay を載せているだけになる。

ペンの加算はこのモデルで動く。消しゴムは動かない。§13.1 の証明は `strokeInk` + `inkPixelCount`（小ラスタ JS）なので、**テストはグリーン、本番消しゴムは死ぬ**。

現行 `Workspace.tsx` ですらページインクは `strokeInk` 一括、クリップ消しゴムは move 毎 `stampInk` である。overlay モデルに乗り換えるなら消しゴムのスナップショット契約が要る。

**修正:** 消しゴム（と、可能ならペンも）のライブ手順を次のどちらかに固定する。両方書くな。

- **A:** pointerdown で対象 OffscreenCanvas を `drawImage` して overlay をフルコピー → overlay 上で destination-out → pointerup で overlay をページ canvas に置換し、down 時点のスナップショットを past に積む
- **B:** ライブもベイクもページ OffscreenCanvas に直接描く。pointerdown で CoW スナップショットを取り、cancel なら戻す

「overlay + destination-out」をペン用に残すなら、消しゴムは A/B と明記しろ。§9.2 をペン/消しゴムで分けろ。

---

### B3. overlay 解像度が未定義 → 滲みか 8MB のどちらかが届く

§9.2: `lineWidth` はラスタ座標で計算し「表示スケールを掛ける」。
§9.2 ベイク: overlay をページ OffscreenCanvas へ `drawImage`。
§9.5: 表示裏バッファは `216 * dpr` × `306 * dpr`。ソースは常に 1200×1700。

overlay が 216×dpr なら、1200×1700 への `drawImage` は拡大である。インクが滲む。Pencil 品質が製品の核なのに、ベイクがディスプレイ解像度依存になる。
overlay が 1200×1700 なら、§9.5 の「表示キャンバス」とライブ overlay が別物で、仕様はそれを言っていない。

**修正:** overlay は **常に対象ラスタと同寸**（ページなら 1200×1700、クリップなら clip 寸法）。CSS で 216×306 に縮小表示する。ベイクは 1:1 `drawImage`。§9.5 の dpr バッファは「画面に出すコピー」であり、ライブの正ではない、と書け。

---

### B4. `reduceDocument` / `reduceHistory` / `cloneDocument` が 1200×1700 で爆発する

§7.1: 「React state に全ページの `Uint8ClampedArray` を置いて毎 action clone しない」
§7.7: `cloneDocument` は本番履歴に使わない
§5 `history.ts` **改修**: 「ラスタの全コピーは禁止。CoW（§7.5）」← **節番号が間違い。CoW は §7.7。§7.5 は OPFS**
§5 `reducer.ts` **改修**: 「Action 意味は維持」だけ。**冒頭 `cloneDocument(state)` をやめろと書いていない**

現行:

```113:113:src/domain/reducer.ts
  const doc = cloneDocument(state);
```

```77:94:src/domain/document.ts
export function cloneDocument(doc: DocumentState): DocumentState {
  // 全 pages[].raster と pasteboardClips[].raster を new Uint8ClampedArray
```

`setWorkspaceView` は VIEW_ONLY で past に積まない。しかし `reduceDocument` はパンのたびに全ラスタをコピーして `present` を差し替える。20 ページなら **1 パンイベントあたり約 160MB の割り当て**。指パンは pointermove の連打である。iPad は即死する。

§7.7 の「placeholder でもよい」も嘘になる。`marqueeCut` / `bakeClipOntoPage` / `strokeInk` は `page.raster.data` を読む。placeholder の空 1200×1700 を毎ページ確保するなら、それ自体が 8MB×N である。

**修正:**

1. 本番 `DocumentState.pages[*].raster` は `{ width, height, rasterId }` だけにするか、`data` をテスト専用にする。`types.ts` の「形は維持」を撤回し、**永続化 JSON 形（§7.4）とランタイム形を分けて書け**。
2. `reduceDocument` を純 JSON フィールド専用にし、画素は `InkEngine` の外に出す。
3. VIEW_ONLY はラスタに触れない浅いコピー、または immer 的 structural sharing。パンで `Uint8ClampedArray` を new してはならない。
4. `history.ts` の `past: DocumentState[]` を捨て、§7.7 の `Map<rasterId, ImageBitmap | ArrayBuffer>` を型に落とせ。今は文章だけ存在する。
5. 履歴深さ 50 を `reduceHistory` の契約として書け（現行コードに上限は無い。§6 にあるだけ）。

---

### B5. `workspaceGestures.ts` を「再利用、移植せず呼ぶ」が嘘

§5: 「`LONG_PRESS_MS=420`, `PAN_SLOP=12`, `TEXT_MOVE_SLOP=8`。ジェスチャ意味は移植せず呼ぶ」
§8 パイプライン: `stepWorkspaceGesture` → `DocumentAction[]`
§8.1 / §8.2 は、このモジュールが持っていない挙動を要求している。

現行 `src/domain/workspaceGestures.ts` の欠陥（再利用したらそのまま出荷バグ）:

| 仕様が要求 | モジュールの現実 |
| --- | --- |
| §9.2 ライブは overlay、`stampInk` 禁止 | `stampPage` / `stampClip` を **move 毎** に出す。現行 `Workspace.tsx` はページをバッファして `strokeInk`、**クリップ消しゴムは即 `stampInk`** |
| §8.2 番号 tap / 選択番号の後ろに挿入 / `+` | `GestureEffect` に tap が無い。finger up は `idle` で **effects 空**。`+` も番号帯も無反応 |
| §9.3 クリップ角スケール・上ハンドル回転 | mode は `moveClip` だけ。scale/rotate が無い |
| §13.2.1 同時に Pencil で線、指でパン | `WorkspaceGesture` は **単一 mode**。stroke 中に指が来ると潰れる |
| §8.1 指はスロップ超でストリップ全体パン | テキスト上 `fingerPending` は `onText` なら **パンしない**（effects 空で固まる） |

「定数だけ再利用、FSM は Web 用に書き直す」なら §5 の判定を **改修** に落とせ。今の「再利用」は InkLayer ほど露骨ではないが、**stamp-per-move パイプラインを再導入する最短経路**である。

**修正:**

- 判定を **改修** にする。
- `GestureEffect` に `completeStroke`（points[] 一括）、`tap`（append / selectPage / insertAfterSelected）、`scaleClip` / `rotateClip` を足すか、Web アダプタ側の別 FSM を正とし、このファイルは定数と `canGrabPage` / `preferHitForTool` だけ再利用すると書け。
- pointerId ごとに FSM を持て、と §8 に書け。単一 `gesture.current` 禁止。
- クリップ消しゴムを `stampInk` 連打するな。ページと同じ 1 ストローク 1 ベイクにしろ。

---

### B6. PDF の 1 本指パンが消えている（プロダクト矛盾）

LOCKED §2: 「ビューアは PDF ページをそのまま表示。**ピンチ/パン**。」
LOCKED §2: 「指 = パン、ピンチ、ページ操作、**PDF 範囲ドラッグ**、スプリッタ」

§8.1 表:

- 指 | PDF | 任意 → 「範囲ドラッグ開始〜プレビュー。up で payload 保持してドロップ先待ち」
- 指 2 本 | PDF → ピンチズーム。中心は二本の中点
- **1 本指パンの行が無い。2 本指パンも無い。**

現行 `PdfPane.tsx` も 1 本指は範囲選択だけで、`onView({ panX, panY })` を指ドラッグから呼んでいない。仕様は現行の欠落をコピーして LOCKED を黙殺している。

範囲とパンは同じポインタ種・同じペインである。識別子が無い。実装者は「全部範囲」か「勝手に長押しで範囲」かを選ぶ。どちらも §2 違反になりうる。

**修正:** 識別を固定する。プロダクトを変えるな。実装契約として例えば:

- 1 本指 + 移動 < 8 CSS px で up → キャンセル（§10.3 既存）
- 1 本指 + スロップ以上 → **範囲選択**（ドロップ用）
- 2 本指 → ピンチ **と** 中点パン（`setPdfView({ zoom, panX, panY })`）
- Pencil → no-op（§8.1 既存）

「パン」を 2 本指に閉じるなら、§8.1 と §16 トレース表に **PDF パン = 2 本指** と明記しろ。1 本指パンを残すなら範囲の開始条件（長押し、専用モード、二段）を書け。黙って両方書くな。

---

### B7. プロジェクトを開き直したときの PDF 再表示手順が無い

§10.1 はファイル picker だけ。`arrayBuffer` → OPFS → `getDocument` → 全ページ抽出 → `loadPdf`。
§7.4 の `documents` には `opfsPath` と `sourceTextByPage` がある。
ゲート 3: 「リロードでページ数とテキストが残る」（PDF なし）。
ゲート 12: PDF 描画。

**`/p/{id}` マウント時に OPFS から PDF を読んで canvas に出す手順が 1 行も無い。** `getDocument` を保持するのか、毎回読むのか、抽出をスキップするのかも無い。

さらに §10.2 の React key は `pdfPageViewerKey(opfsPath, currentPage)`。OPFS パスは `{projectId}.pdf` で固定（§7.5）。**別 PDF に差し替えても key が変わらず、前ページのピクセルが残る。** ページ送り対策をファイル置換に拡張していない。`loadPdf` の `sameUri`（現行 `reducer.ts` は `doc.pdf?.uri === action.uri`）は、uri を OPFS キーにした瞬間 **常に true** になり、別原稿でも currentPage/zoom を引きずる。

**修正:**

1. エディタ起動: `documents` を読む → `pdf.opfsPath` があれば OPFS を `getFile()` → `arrayBuffer` → `getDocument({ data })` → **抽出は IDB の `sourceTextByPage` を使い再走査しない** → 表示用 `PDFDocumentProxy` をセッションに保持。
2. picker 置換: OPFS を原子置換 → generation（`updatedAt` または content hash）を key に含める → `pdfPageViewerKey(opfsPath, currentPage, generation)` → canvas を捨てて render。
3. `PdfDocument.uri` を残すな。§5 は「uri は OPFS キー」、§7.4 は「uri は使わない」。**片方を消せ。** `loadPdf` の same-file 判定を generation に切り替えろ。

---

### B8. 削除順が自己矛盾している

§7.5 原文:

> 先に OPFS、次に rasters、次に documents、最後に meta（逆順だと幽霊プロジェクトが出る）。実装順は: meta から外す → documents/rasters/OPFS。

前半と後半が逆である。「幽霊が出る」の主語がどちらの順かも不明。失敗時 reject と「一覧から消して孤立ファイルを残すな」も同時には成立しない。

**修正:** トランザクションを 1 本に固定する。

```
1. OPFS の pdfs/{id}.pdf を delete（無くても続行）
2. IDB transaction: rasters（prefix 削除）→ documents → meta
3. 途中で失敗したら reject。meta が残っていれば一覧に出る（再開削除可能）
4. 起動 GC: meta に無い pdfs/*.pdf と rasters を削除
```

「先に meta から外す」は幽霊ファイルを量産する。書くな。

---

### B9. hidden flush が await 依存で、Safari はそれを殺す

§7.6.3: 「`pagehide` / `document.hidden` / ルート離脱 → 同期的に可能な限り `await` flush。Safari は background flush を殺すので **hidden 時点の in-memory を書く**」
自動保存: dirty は 800ms 後に `canvas.convertToBlob`（async）

矛盾: ベイク直後 100ms でホームに戻ると、PNG がまだ無い。`await convertToBlob` は pagehide のあとで捨てられる。§13.2.9 は「ホームへ後に復帰して最後の線がある」を実機項目にしている。**仕様上の flush 手順ではその項目は落ちる。**

**修正:**

- pointerup ベイクの直後に **同期スナップショット** を取れ（`OffscreenCanvas.transferToImageBitmap()` または `getImageData`）。debounce は IDB 書き込みだけ。
- `visibilitychange → hidden` では **新しい Promise チェーンを始めない**。既に開いている IDB transaction を完走させるか、`indexedDB.open` 済みの store に `put(ArrayBuffer)` を同期的に queue する。
- `canvas.toDataURL` を hidden 専用の同期フォールバックにするか、「未エンコードの ImageBitmap を IDB に載せられないので、hidden では最後に成功した PNG + 未保存ドットを残し、foreground で再エンコード」と製品に嘘をつかない形で書け。§13.2.9 を「800ms 経過済みの線」に弱めるのはプロダクト変更なので、**ベイク瞬間にエンコードを開始**するのが正しい吸収である。

---

### B10. テンプレ画像の配信パスが無い

§4.2 残す: `sample/page_template.jpg`
§4.3 `public/`: `pdf.worker.min.mjs` と `icons/` だけ。**テンプレが無い。**
§9.1: `page_template.jpg` を stretch。
ゲート 5: テンプレ + 番号隠し。

Next.js は `public/` 以外を URL で出さない。このままゲート 5 に入ると 404 で白紙ページになる。

**修正:** `public/page_template.jpg` にコピー（またはビルドでコピー）と書け。`sample/` はソース・オブ・トゥルースでもよいが、**ランタイム URL を 1 つに固定**しろ。SW のシェルキャッシュ対象に同じパスを入れろ（§3.6 は `page_template.jpg` とだけ書いている。パスが無い）。

---

### B11. IME の UI が OR のまま

§3.4: 「視覚的には縦書きオーバーレイと重ねる、**または**画面下部の編集バー」

本文書冒頭: 曖昧語は仕様欠陥。これは欠陥である。iPad Safari の `textarea` + `writing-mode: vertical-rl` は候補窓位置が壊れ、フォーカスでドキュメントがスクロールする。重ねる方式を選んだ実装は §3.4.3「Safari にドキュメント全体をスクロールさせない」と衝突する。下部バーなら枠は `visualViewport` 追従が要る。

**修正:** v1 は **下部編集バー（横書き textarea）+ ページ上は CSS `vertical-rl` の表示専用** に固定する。縦書き textarea は v1 禁止。`compositionend` まで `editText` を dispatch しない（§3.4.4 は閉鎖時 1 回。編集中の live 表示は uncontrolled textarea）。`visualViewport` 変化だけでは確定するな（スプリットキーボードで誤 commit する）。確定トリガーは `focusout` と「完了」ボタンだけ。

---

### B12. `types.ts` 改修がラスタ寸法しか見ていない

§5 `types.ts` **改修**: 「`DocumentState` 形は維持。`DEFAULT_RASTER_*` を更新。`PdfDocument.uri` は OPFS キー」
§6: ペン 12 / 消しゴム 28 / テキスト 36 ラスタ px
現行 `DEFAULT_TOOL_PROPERTIES`: `penSize: 2`, `eraserSize: 4`, `textFontSize: 14`（48×68 用）

ラスタだけ 1200×1700 にしてプロパティを再利用すると、Pencil の線がほぼ見えない。§6 と §5 が食い違う。実装者は再利用表をファイル単位の ToDo にする。

**修正:** `DEFAULT_TOOL_PROPERTIES` を §6 に合わせて更新すると `types.ts` 改修に明記。`createText` / `dropActions` の枠は §7.3 の関数 **1 本** を通せ。現行 `drop.ts` は 10×40、`Workspace.tsx` は 8×22 / 12×36。放置するとドロップ枠が点になる。

---

## 3. High-severity gaps（直さないと出荷バグ）

### Pencil

- **hover / `pressure === 0`:** §3.5 は常に 0→0.5。pointerdown 前の hover `pointermove`（`buttons === 0`）を除外していない。誤って listen すると空中で描く。ストローク中の瞬間 0 も 0.5 に化け、線が急に太る。**contact 中だけ 0→0.5、hover は無視、in-stroke の 0 は直前 pressure を保持** と書け。
- **`buttons` / `isPrimary` が無い。** iPad は Pencil と掌の touch が同時に来る。`preventDefault` だけでは足りない。掌の `pointerType: 'touch'` が単一 FSM を pan に奪う（B5）。
- **`getPredictedEvents` に触れていない**のはよい。`getCoalescedEvents` 欠落は E9。実機なしで「検証済み」と書くな、は §3.1 で正しい。
- 現行 `nativePointer.ts` の `force` / RNGH `pointerType===1` / `altitudeAngle` 判定を **Web に移植するな** は正しい。ただし `createPointerKindTracker` 現行実装は `prev === 'pencil' || detected === 'pencil'` で **途中から Pencil に昇格**する。§3.5 は「最初の判定を維持」。移植時に OR 昇格を持ってくるな、と書け。

### PDF ページ送り / 描画

- RenderTask.cancel + clear + key 交換（§10.2）は方向として正しい。足りないのは **`PDFDocumentProxy` の保持**。ページ送りのたびに `getDocument` したらフラッシュして見える。
- **ピンチ毎に `page.render` し直す**（§10.2「scale はペイン CSS と pdf.zoom から計算」）は iPad でヒッチる。ピンチ中は CSS `transform: scale`、`pointerup` 後に本 render、と書け。
- zoom 4 × dpr 2 × 1032×729 は canvas が 8k 級。**iPad Safari の canvas 面積上限で真っ白**になる。max CSS ピクセル（例: 長辺 2048 または 4096）で clamp し、残りは CSS 拡大と書け。
- **contain / letterbox が無い。** `viewRectToPdf(view, viewW, viewH, media, zoom, pan)` はペイン全体を media に線形写像する。canvas を contain したら範囲選択が本文からずれる。overlay 座標系 = 描画 canvas の CSS ボックス、と固定しろ。
- 現行 `PdfPane.tsx` は WebView + cdnjs 3.11.174 + base64。§5 破棄は正しい。**抽出用 hidden WebView（`EXTRACTOR_HTML`）も同じ CDN パイプライン**である。`pdfExtract.ts` 再利用は loader に pdf.js を直接渡す前提でよい。WebView 抽出を「とりあえず」残すな。

### パフォーマンス / メモリ

- 1 ページ 8,160,000 バイト（§7.2）は計算として正しい。**常駐戦略が「全ページ OffscreenCanvas」のまま**（§7.7 `Map<rasterId, OffscreenCanvas>`）。50 ページで約 400MB + 履歴 CoW + ImageBitmap サムネ。E10 は履歴 clone だけ見ている。**非表示ページは PNG に落として canvas を dispose、表示中±1 見開きだけ decode** を書け。ページ上限を設けるな（E1）と RAM 無限は両立しない。吸収策が無い。
- `cutRect` / `compositeRaster` を §5 は「テストとベイク検証用」とし、§9.3 はクリップベイクを OffscreenCanvas としている。現行 `reducer.ts` の `marqueeCut` / `bakeClipOntoPage` は JS 二重ループ。**本番はどちらが正か書いていない。** JS のまま 1200×1700 回転ベイクはヒッチる。
- サムネ 144×204 の ImageBitmap キャッシュ（§9.4）はよい。無効化が「ベイク時」だけで、undo でインクが戻ったときを書いていない。

### 永続化

- SW がユーザーデータを触らない（§3.6 / §14.18）は正しい。**`pdf.worker.min.mjs` はシェルキャッシュ対象外**なので、オフラインでは PDF だけ死ぬ、は書いてある。ただし一度 PDF を開いたあとも SW が worker を持たないので、HTTP キャッシュ任せになる。worker をシェルに含めろ、または「PDF はオンライン必須」とプロダクトを変えるなと言いながらオフライン項を弱めろ。
- `navigator.storage.persist()` が無い。iPad Safari は圧力で IDB を捨てる。E1 はクォータ超過だけ。
- 二重タブ last-write-wins（E2）はよい。**1 タブ内の 800ms と 1500ms debounce が交差したとき、古い documents JSON が新しい PNG のあとに上書きされる**順序が無い。単一 save queue（世代番号）を書け。
- 空インクも透明 PNG（§7.4）はキー欠落を壊すな、で正しい。50 ページ新規は 50 枚の 1200×1700 PNG エンコードを作成直後に走らせる。§7.6 新規は save してから遷移。**初回 save がエンコード完了を待つのか、空 PNG を同期生成するのか無い。**

### IME / キーボード

- `position: fixed` + フォーカスで Safari が `window.scrollTo` する既知動作に対し、**scroll を 0 にロックするリスナー**が無い。「スクロールさせない」は願い。
- 編集中 undo（§11.2 アイコン）と未 dispatch の textarea 値が衝突する。IME 中は undo/redo を disable、と書け。
- 空枠作成（Pencil + text + ページヒット）が即座に `selectedTextId` + textarea focus か、tap 相当（down=up）だけか。現行ジェスチャは down で `createText`。誤 tap で枠が増え、キーボードが飛び、§3.4 の viewport 追従が走る。

### undo vs layout

- VIEW_ONLY 集合（§5.1）とスプリット非 undo は LOCKED と一致していてここは硬い。
- **欠け:** undo 時に `InkEngine` と DOM テキストとサムネをどう同期するか。`reduceHistory` が DocumentState を差し替える前提のまま Canvas が正だと、undo 後も古い canvas が見える。
- `setTool` が VIEW_ONLY なので、色を変えてから描いた線を undo しても色 UI は戻らない。それはよい。**ストローク中の tool 変更**が未定義。
- `rename` は undo 可、一覧改名は履歴なし（§5.1）。エディタ内 rename UI が無いまま action だけある。

### ラスタ vs メモリ vs 表示

- 表示 216×306、ラスタ 1200×1700、テンプレ 1518×2150（§6 / §11.3）。`stripGeometry.ts` 現行は `PAGE_DISPLAY_W/H = 108×152`。改修で 2 倍にするのは書いてある。`pageLocalFromWorld` は frame CSS と raster の比なので、**216 に変えたあとテストのヒット座標が全部ずれる**。ゲート 2 の「scenarios 相当がグリーン」は定数更新必須。明記せよ。
- E12 のアスペクト誤差 < 0.0001 は `round(1200 * 2150/1518)=1700` の自己祝賀。テンプレ stretch（§9.1）は非整数スケール。トンボ 1px ずれ許容と stretch は矛盾しないが、**番号隠し矩形 `TEMPLATE_PAGE_NUMBER_COVER` は正規化**なので stretch でも追従する。ここはよい。

### Safari / PWA / Next

- `user-scalable=no` + `maximum-scale=1` で「ブラウザピンチを殺す」（§3.2）。iOS はアクセシビリティで無視することがある。`touch-action: none` が本命。失敗条件（ジェスチャがブラウザズームになる）をゲート 6 の完了条件に書け。
- `app/sw.ts` は Next App Router の標準エントリではない。Serwist / 自前 `public/sw.js` 登録が無い。ゲート 1 が「standalone 相当」で終わる。SW が無いと §3.6 オフラインは嘘。
- `'use client'` は SSR を止めない。初回 HTML は IDB 無し。**dynamic import + マウント後ロード**を書け。ハイドレーション空フラッシュは iPad でチラつく。
- Next のバージョンが無い。pdf.js だけ 4.x。React 19 は package.json と一致。Next 未ピンは App Router の metadata viewport の書き方がバージョンで死ぬ。

---

## 4. LOCKED プロダクト仕様との矛盾

プロダクト変更を要求しない。**実装仕様が §2 を静かに削っている箇所だけ**列挙する。

1. **PDF パン欠落** — 上記 B6。§2「ピンチ/パン」対 §8.1「範囲ドラッグのみ」。
2. **指はパン** — §2「それ以外の指はパン」。再利用する `workspaceGestures.ts` はテキストヒット上でパンしない。§8.1 本文は「テキスト枠を掴んで動かさない」（パンせよ）なのに、モジュールは動かさないしパンもしない。
3. **下書きとインクは色** — §1.2 / §2 / §14.11 は第二ラスタ禁止。§9.1 のライブ overlay は一時層であり許容。ただし B2 の消しゴム用フルコピー overlay を「常設第二 canvas」にすると §14.11 違反。仕様が「常設するな」とライブ用コピーを区別していない。
4. **サイズ = 筆圧 × プロパティ** — §6 と `brushRadius` は一致。§3.5 の 0→0.5 は hover を誤るとプロダクトの筆圧意味を壊す（B の Pencil 項）。
5. **書き出しなし / オンデバイス** — 実装仕様は守っている。矛盾なし。
6. **サムネにテキストを焼かない** — §9.4 は現行踏襲と明言。§2 はサムネ品質を定義していないので、プロダクト変更要求にはならない。ストックで本文が読めないのは仕様が認めた欠落。
7. **`PdfDocument.uri` vs OPFS** — プロダクトは「ソース PDF は変更しない」。実装仕様が uri と opfsPath で分裂しているのはプロダクト矛盾ではなく実装契約の自己矛盾（B7）。

---

## 5. 反証不能・テスト不能な主張

| 主張 | なぜ反証できない |
| --- | --- |
| §9.2「`strokeInk \| 相当`」 | 相当の集合が無限。テストを書けない |
| §3.4「Safari にドキュメント全体をスクロールさせない」 | 手順が無い。`scroll` リスナーも `preventScroll` も無い |
| §3.2「ブラウザのピンチズームは殺す」 | Safari が viewport を無視したら仕様のせいにも OS のせいにもできる |
| §7.6「同期的に可能な限り `await` flush」 | 可能な限りは常に合格。§13.2.9 と同時に成立させられない |
| E5「失敗しても本文は `editText` で残す」 | 失敗の定義が無い。IME 確定前に visualViewport が戻ったらデータは textarea にしか無い |
| E3「ピクセル完全一致を CI 条件にしない」+ §13.1「表示の Canvas 画素は比較しない」 | **本番インク経路が自動テストで死んでいる。** `inkPixelCount` は JS `stampStroke` の証明にしかならない |
| ゲート 6「単体テストで `pen`/`touch`。実機 Pencil は #8 以降」 | 正しい分離。ただしゲート 8 完了条件「View が 1 画素も無い」は DOM 監査の方法が無い |
| E12「アスペクト誤差 < 0.0001」 | 計算のトートロジー。描画結果の検証が無い |
| §7.7「placeholder でもよい」 | よい、の境界が無い。空配列なのか 8MB zero なのか |
| 「1 タブ想定」（§7.6） | 想定はテストではない。E2 と合わせて「壊れても仕様」 |

§13.1 で足りない証明（足せ）:

- pointerup 後、本番 `InkEngine` の `inkPixelCount` 相当（OffscreenCanvas から `getImageData` して α>0）を **消しゴム 1 ストローク** で減ること
- VIEW_ONLY パン 100 回で `raster.data.buffer` の参照が変わらないこと（clone 禁止のテスト）
- `pdfPageViewerKey` が generation 込みで、ページ送りと **ファイル置換** の両方で変わること
- 削除 API 失敗時に meta が残ること / 成功時に OPFS も rasters も無いこと（B8）
- 2 本の `pointerId` が同時に stroke と pan になれること（または「v1 は同時入力を捨て後着を無視」と明記して §13.2.1 を直せ — 後者はプロダクトに触れるので、捨てるなら QA 文だけ実装仕様側で「同時は役割を混線させず、一方を ignore」と書け）

---

## 6. 再利用表の嘘（禁則パイプラインを引き戻す行）

凡例どおり読めば「再利用 = Web から import」。次の行は、import した瞬間に禁止物が戻る。

| モジュール | 表の判定 | 実際 | 引き戻すもの |
| --- | --- | --- | --- |
| `workspaceGestures.ts` | 再利用 | move 毎 `stampPage`/`stampClip`。tap/回転/二本指分離なし | **`stampInk` 連打**（§14.17）、現行 `Workspace.tsx` クリップ消しゴムと同じ | 
| `reducer.ts` | 改修（意味維持） | 全 action で `cloneDocument` + `strokeInk`→`stampStroke` + `marqueeCut`→`cutRect` | **1200×1700 JS スタンプと全コピー**。48×68 のときだけ生きていた経路 |
| `history.ts` | 改修 | `past: DocumentState[]` + `cloneDocument` | 全ラスタ履歴。CoW は文章だけ |
| `document.ts` | 改修 | `createRaster(DEFAULT_RASTER_*)` を `newPage` が呼ぶ | デフォルトを 1200×1700 にした瞬間、appendPage が 8MB clone 連鎖 |
| `raster.ts` | 改修、`inkCells` 削除 | 削除は正しい。残す `stampBrush` が reducer 本番から呼ばれ続ける限り **View-per-pixel の前段** | `InkLayer.tsx` は `inkCells(raster).map → View`。関数を消しても、画素配列を React に載せる設計が残れば再実装される |
| `stroke.ts` | 改修、`strokePreviewPoints` 削除 | 削除は正しい（max 96 View）。現行 `Workspace.tsx` 547 行付近がこれでプレビュー View を積んでいる | 削除せず再利用すると **96 個のドット View** |
| `projects.ts` | 破棄して置換 | `serializeDocument` が `number[]` ラスタを JSON に埋める | §14.5 の親戚。テスト用と書いてあるが `domain/index.ts` が export している |
| `pdfView.ts` | 破棄+抽出 | `pdfPageViewerHtml` は **cdnjs 3.11.174 + atob(base64) + canvas**。`pdfPageRenderCommand` は `{b64}` | 残すな。`pdfPageViewerKey` の第一引数が `uri` のままなのも B7 |
| `pdfExtract.ts` | 再利用 | 関数自体は WebView を知らない。**loader に渡す実装が `PdfPane` の hidden WebView** | 「再利用」だけ見て `PdfPane` 抽出を残すと CDN WebView が戻る |
| `pdfLayout.ts` | 改修 | `DEFAULT_PDF_MEDIA={1032,729}` ハードコード。view 矩形線形写像 | 本番 media を pdf.js にせよは書いてある。letterbox 未定義のまま reuse すると範囲選択がずれる |
| `pointers.ts` | 再利用 | `resolvePointerIntent` / `brushRadius` は Web で正しい | ここは嘘ではない。`nativePointer.ts` を一緒に import するな |
| `layout.ts` | 再利用 | RTL スロットのみ。寸法を持たない | 嘘ではない |
| `text.ts` | 再利用、`verticalGlyphs` はテスト用 | `VerticalText.tsx` が **1 グリフ 1 Text** で本番表示 | 表示パス禁止（§3.4）は書いてある。モジュールを再利用した UI が同じ関数を本番に繋ぐのが現行。**「表示に使うな」を再利用表の固定内容に再掲せよ** |
| `drop.ts` | 改修 | ゾーン意味は正しい。10×40 は §7.3 で破棄と書いてある | 改修を忘れると枠が点。パイプライン禁止というより製品見た目バグ |
| シナリオテスト | 再利用 | `scenarios.test.ts` が `pdfPageViewerHtml('AAA', 2)` を assert | §5 最下行は置き換えよと言っている。**HTML 断言を残したままグリーンにすると WebView HTML を削除できない** |

`InkLayer.tsx` / `PdfPane.tsx` / `VerticalText.tsx` の **破棄** 判定自体は正しい。嘘は「domain を再利用すればパイプラインは自動的に死ぬ」という含意である。**描画パイプラインは domain に埋め込まれている。** `src/domain/index.ts` は禁則関数をまとめて export している。

現行の禁則の証拠（再利用したら戻るもの）:

```12:31:src/components/InkLayer.tsx
export function InkLayer({ raster, width, height }: InkLayerProps) {
  // inkCells(raster).map → <View style={{ width, height, backgroundColor }} />
}
```

```209:216:src/components/PdfPane.tsx
              <WebView
                source={{ html: pdfPageViewerHtml(pdfBytes, current) }}
```

```19:33:src/domain/pdfView.ts
export function pdfPageViewerHtml(base64: string, page: number): string {
  // cdnjs/ajax/libs/pdf.js/3.11.174/pdf.min.js  + atob(b64)
```

```77:93:src/domain/stroke.ts
export function strokePreviewPoints(..., maxDots = 96): StrokePoint[] {
  // 「RN Views stay light」
}
```

```156:158:src/domain/types.ts
export const DEFAULT_RASTER_WIDTH = 48;
export const DEFAULT_RASTER_HEIGHT = 68;
```

---

## 7. 実際に硬いところ（短い）

- 禁止パターン §14 の項目そのもの（View-per-pixel、48×68、WebView+CDN、HTML5 DnD、force 判定、第二ラスタ常設、履歴の永続化、スプリット undo）。これは実装者を殴れる。
- VIEW_ONLY 集合と「スプリットは永続・非 undo」（§5.1）。プロダクトと一致。
- ポインタ役割の表の骨格: 指=パン/ピンチ/ページ/範囲/スプリッタ、Pencil=描画/消去/テキスト/矩形。PDF 上 Pencil no-op。マウスは ink しない。
- RTL ストリップ、見開き再計算、0 ページ WS、MOVE でペーストボード不動、ルビ除去はソース非破壊。`layout.ts` / `pdfText.ts` / シナリオの **行動** は再利用してよい。
- 本番ラスタ 1200×1700 の式、テンプレ隠し矩形、800/1500ms debounce の数字、長押し 420 / スロップ 12、スプリット 0.22–0.78。曖昧語で逃げていない。
- PDF 表示は `page.render` のみ、CDN 禁止、worker 同梱、ソースバイトを JSON に載せない。方向は正しい（手順が足りないだけ）。
- カットオーバー（Expo エントリ削除、二重保守しない、AsyncStorage 移行しない）は明確。
- ゲート順 0–14 で「実機 Pencil をシミュレータ合格と呼ばない」は正しい。

これらは残して、B1–B12 だけパッチしろ。仕様全体の書き直しは不要である。実装も不要である。

---

## 再レビュー（2026-08-28）

- 対象改訂: `docs/web-implementation-spec.md`（§18 自称「B1–B12 吸収済み」）
- 作業: 両ファイル全文再読。実装なし。プロダクト §2 は触らない。
- **Verdict: blockers closed**

6 件ともマーケティングではなく、禁止・手順・テストの三点で反証できる。ゲート 1 を止める穴ではない。改訂が足した小さい穴は下の「新規」だけ。残ブロッカーなし。

### 依頼 6 件の判定

| # | 要求 | 判定 | 契約（引用） |
| --- | --- | --- | --- |
| 1 | 画素の正は一つ。ライブで `strokeInk`+Canvas 二重ベイク禁止 | **閉じた** | §5.2「本番 dispatcher が emit 禁止: `stampInk`, `strokeInk`」「『`strokeInk` 相当』という語は使わない。本番インク履歴の単位は `commitInkBake`」。§7.7「画素の正: `InkEngine`」。§1.2 / §14.3 / §14.19。証明: §13.1「`commitInkBake` が `Raster.data` を持たない」 |
| 2 | 消しゴムが PAGE インクを消す（空 overlay ではない） | **閉じた** | §9.3「空 overlay への destination-out はページインクを消さない。**禁止。**」「pointermove: 対象 canvas に `destination-out`」。§14.20。証明: §13.1「**page** `getImageData` の α>0 が減る。overlay だけ見て合格にしない」、§13.2.11 |
| 3 | VIEW_ONLY が全ラスタ clone しない | **閉じた** | §5.1「`pages` / `pasteboardClips` オブジェクトを新しい Raster で差し替えない」「`cloneDocument` を呼ばない」。§7.1 EditorDocument に `Uint8ClampedArray` なし。証明: §13.1「100 回 `setWorkspaceView` のあと `pages` 各参照が同一。`Uint8ClampedArray` を new するスパイが 0」。§14.19 |
| 4 | `workspaceGestures` を as-is で呼ぶな | **閉じた** | §5「**本番で呼ぶな:** `stepWorkspaceGesture`」。§8「Web FSM ※ `stepWorkspaceGesture` を呼ばない」。§8.5 `Map<pointerId, Session>`。§14.22。証明: §13.1 番号 tap / テキスト上パン / 2 pointerId は **新 FSM** の unit |
| 5 | PDF 1 本指パン + ページ送り/リロード | **閉じた** | パン: §8.1「既定はパン」。§8.6「move かつ経過 < 420ms かつ距離 ≥ 12px → **`pdfPan`**」。送り: §10.2「Proxy はセッション保持。送りのたびに `getDocument` しない」「`RenderTask.cancel` → `proxy.getPage(n)` → `render`」。リロード: §7.9 手順 1–7。差し替え: §10.1 `generation += 1`、`uri` 削除、`pdfPageViewerKey(..., generation)`。証明: §13.1 PDF key と「12px 超 100ms → pan」、ゲート 12 |
| 6 | pagehide で `await convertToBlob` するな | **閉じた** | §7.6「新しい `convertToBlob` / `createImageBitmap` / `getDocument` を **始めない**」「**pagehide ハンドラはそれを await しない**」。§14.23。§13.2.9 は「ベイク後にエンコードが完了した線」。未完了は E14 + 未保存ドット |

元 B3（overlay 同寸 1:1）、B8（削除順 §7.5）、B10（`/page_template.jpg`）、B11（下部バー固定）、B12（pen 12 / 枠関数 1 本）も同じ改訂で閉じている。§18 の対応表は嘘ではない。

### 新規の穴（ブロッカーではない。短い）

改訂が足した手続きの隙間。実装前に一文足す価値はあるが、6 件を再び開けはしない。

1. **ペンの undo スナップショットが §9.2 に無い。** §7.8 / §5.2 は「pointerdown 時点」。§9.3 消しゴムだけ down で canvas 複製を書く。§9.2 ペンは up で `drawImage` してから `commitInkBake`。up 後にスナップすると undo が no-op になる。**ペンも down で `encodedPng` を `inkUndo` に固定する**と §9.2 に 1 行書け。
2. **消しゴム CoW 複製が hot LRU（≤8）に入るか未定義。** 入るとストローク中に undo 用 canvas が dispose される。複製は `hot` に入れないと書け。
3. **pagehide の put は「開済み IDB 接続があれば」。** 無ければ沈黙。セッション中は `IDBDatabase` を閉じるな、と書け。`put` 自体は await しない契約で B9 は閉じたまま。
4. **1 本指 PDF パンが毎 move `setPdfView`。** ピンチ中は CSS（§10.2）なのにパン中は JSON。key は generation+page なので再マウントはしないはずだが、「pan で canvas を捨てない」が §10.2 に無い。

以上。残ブロッカーなし。実装するな。仕様の全面書き直しをするな。
