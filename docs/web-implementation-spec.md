# MangaSketcher Web 実装仕様（v1 固定）

- 対象: iPad 向け Next.js + TypeScript Web アプリ
- 本文書の地位: 実装契約。プロダクト要件は変更しない。v1 の挙動・数値・禁止事項に「あとで決める」は置かない。
- 敵対的レビュー: `docs/web-implementation-spec-review.md`（2026-08-28）のブロッカー B1–B12 と出荷バグ級 HIGH を **本文に吸収済み**。レビュー文書は削除しない。対応表は §18。
- 実装しないもの: 本文書は仕様のみ。アプリ本体の実装作業は別タスク。
- 曖昧語（適宜・必要に応じて・将来・TBD・相当）は仕様欠陥とする。

---

## 1. ゴール / 非ゴール

### 1.1 ゴール

iPadOS Safari（ホーム画面追加 PWA）上で、マンガネームを **端末内だけで作成・編集・自動保存** できる 1 画面エディタを提供する。ドメインの **ルール**（RTL ストリップ、見開き、JSON フィールドの reducer 意味、ドロップ、PDF 本文幾何、ポインタ分担の定数）を再利用し、描画・画像・PDF 表示・入力・永続化・ジェスチャ FSM の **パイプラインは Web 向けに書き直す**。

現行 `reduceDocument` の画素ループと `cloneDocument` の全ラスタコピーは **本番の正ではない**（§5・§7.7）。

### 1.2 非ゴール（v1 でやらない。議論再開もしない）

| 非ゴール | 固定理由 |
| --- | --- |
| 書き出し（PNG/PDF/ZIP/共有シート） | プロダクトが in-app create + autosave only と固定 |
| App Store / TestFlight / Capacitor / Cordova | ランタイムは Safari + PWA |
| iPhone / Android / デスクトップを QA 対象にする | iPad 専用。他環境は落ちないことだけ保証 |
| Expo Go / React Native の本番継続 | カットオーバー。二重保守しない |
| 下書きレイヤーとインクレイヤーの分離 | 下書きとインクは色の違いであり、追加レイヤではない |
| テキスト回転 | プロダクトが禁止 |
| 履歴の永続化 | セッション内 undo/redo のみ |
| 複数プロジェクト同時編集 | 同時に開くのは 1 つ |
| PDF ソースの改変、ルビの保持ドロップ | ソース PDF は不変。ドロップは本文のみ |
| ストック内での描画・テキスト編集 | ページ単位の配置のみ |
| HTML5 Drag and Drop | iPad で使わない |
| View-per-pixel 表示、48×68 本番ラスタ、WebView+base64 PDF | アーキテクチャ固定で禁止 |
| Expo AsyncStorage データの移行 | Web は空の IndexedDB から開始 |
| サーバー保存、アカウント、同期 | オンデバイスのみ。API ルート不要 |
| 本番で `strokeInk`/`stampInk`/`stampStroke`/`cloneDocument` を画素に使う | テスト専用。本番画素の正は `InkEngine`（§7.7） |

---

## 2. プロダクト要件（LOCKED — 変更禁止）

以下は合意済みプロダクト仕様の写しである。実装仕様側で縮小・緩和してはならない。

v1 はアプリ内作成と自動保存のみ。書き出しなし。iPad。横向き・縦向きとも同じ 4 ペイン。縦向きは狭い（仕様であり不具合ではない）。

起動はプロジェクト一覧（新規・開く・改名・削除）。同時に開くプロジェクトは 1 つ。保存は端末内。

新規プロジェクトは先に数値のページ数（N≥1）。白紙で開始。PDF は後から。ページ追加はストリップの読み順末尾の `+`（RTL なので視覚的には最後のページの左）。選択中ページの番号をタップするとその後ろに挿入。番号タップはページ選択。削除はワークスペースとストックの両方から可能。全ページをストックへ移し、ワークスペース 0 ページにしてよい。

ワークスペースのページ背景は `page_template.jpg`。テンプレ焼き込みの「1」は隠す。UI のページ番号はページの下。ピンチズームとパンはストリップ全体。RTL・奇数始まり。LTR で見て `[5][4] | [3][2] | [1][余白]`、`+` は左端。見開きは再計算: 1 が単独、(2,3), (4,5)…。指の長押しでページを掴んで並べ替え。それ以外の指はパン。Pencil はページを掴まない。

ページはテンプレ + ラスタインク 1 層 + ページ所属テキスト。下書きとインクは色の違いであり、レイヤを増やさない。

ツール: ペン（カラーピッカー。サイズ = 筆圧 × プロパティ。不透明度）。消しゴム（テキストは消さない。対象はページインクまたは選択中クリップの画素。サイズと不透明度）。テキスト: 縦書き。空枠可。PDF から落としたテキストも編集可。テキストは色を持つ。テキストツールは枠を移動する。枠リサイズはフォントをスケール（縦横比固定）。プロパティからもサイズ変更。テキスト回転なし。選択: 矩形で画素をカット/移動。移動/拡大縮小/回転。テキストは掴まない。Pencil が矩形を引き、指はパン。

ペーストボード: 選択したインクはどこに置いても独立クリップ。ページへドロップするとページラスタへ焼き込む。テキストもペーストボードに置ける。ページへドロップするとページ所属テキストになる。ページ並べ替え・ストック移動はペーストボードアイテムを動かさない（ワールド座標）。

PDF: `sample.pdf` は InDesign の小説見開き。ビューアは PDF ページをそのまま表示。ピンチ/パン。未選択時はファイルを選ぶ。範囲選択して 1 つのテキストオブジェクトとしてドロップ。ルビは除去し本文のみ。ソース PDF は変更しない。

ネームストック: 自由配置（パン+ピンチ）または登録順サムネイルグリッド。ページ単位のみ。ワークスペースからのドラッグは MOVE（隙間が閉じ、リナンバー）。戻すドロップはその位置へ挿入。ストック内では描画・編集しない。

履歴: セッション内 undo/redo。永続化しない。

後回しに見えていた UI も v1 に含める: ワークスペース対 PDF のスプリッタ、パレット対ストックのスプリッタ。比率は永続化し、undo 対象外。PDF の表示/非表示（最後の分割比を保持）。ページドラッグ中はサムネイルを出す。コンパクトサイドバー: ツールアイコン、サイズ/不透明度スライダー、現在色タップでパレット、undo/redo アイコン。ストックは自由配置と整列サムネを切り替え。

ポインタ: 指 = パン、ピンチ、ページ操作、PDF 範囲ドラッグ、スプリッタ。Pencil = 描画、消去、テキスト、選択矩形。

---

## 3. ランタイムと制約

### 3.1 固定ランタイム

| 項目 | 固定値 |
| --- | --- |
| フレームワーク | **Next.js 15** App Router（Pages Router 禁止） |
| UI | React 19 + TypeScript strict |
| 配信 | ホストされた Web アプリ。iPadOS Safari で開く |
| インストール | 「ホーム画面に追加」。`display: standalone` |
| ストア | v1 は App Store に出さない |
| 最低 OS | iPadOS 17.0（Safari 17）。OffscreenCanvas / OPFS / Pointer Events / visualViewport を前提にする |
| QA デバイス | iPad + Apple Pencil。実 Pencil なしではポインタ品質を「検証済み」と書いてはならない |

エディタ UI は `next/dynamic(..., { ssr: false })` でマウントする。サーバー HTML に 4 ペインを出さない。クライアントで IDB を開いてから描画する。ハイドレーション空フラッシュはローディング面 1 枚で隠す。

### 3.2 Viewport / Safari

ルート HTML（`app/layout.tsx` の metadata）:

- `viewport`: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`
- `apple-mobile-web-app-capable`: `yes`
- `apple-mobile-web-app-status-bar-style`: `black-translucent`
- `theme-color`: `#F4F1EA`

エディタ根要素（`/p/[id]`）:

- `position: fixed; inset: 0`
- 高さは **`visualViewport.height` + `visualViewport.offsetTop`**。リスナー: `visualViewport.resize` / `visualViewport.scroll`
- `overscroll-behavior: none`
- `-webkit-user-select: none`（IME HUD の textarea だけ `auto`）
- `-webkit-touch-callout: none`
- `window` の `scroll` で `window.scrollTo(0, 0)` を掛ける（Safari がフォーカスで `scrollTo` する既知動作の打ち消し）。これと `touch-action: none` がピンチ殺しの本命。`user-scalable=no` は補助。iOS アクセシビリティが viewport を無視したら、ゲート 6 は **アプリ内ピンチがブラウザズームになっていないこと** で判定する（meta の有無ではない）

Safe area: `env(safe-area-inset-*)` を 4 ペイン外周に適用。最低タッチサイズ **44 CSS px**。

### 3.3 `touch-action`

| 領域 | `touch-action` | 理由 |
| --- | --- | --- |
| ワークスペース（ストリップ+ペーストボード） | `none` | 指パン/ピンチをアプリが独占 |
| PDF キャンバス + 範囲オーバーレイ | `none` | 指パン/ピンチ/範囲ドラッグ |
| ストックボード | `none` | 指パン/ピンチ/ページドラッグ |
| スプリッタヒット領域 | `none` | 指ドラッグ |
| ツールボタン・スライダー・IME HUD textarea | `manipulation` | ダブルタップズーム抑制 |
| プロジェクト一覧のスクロール領域 | `pan-y` | 一覧は通常スクロール |

### 3.4 IME / キーボード（画面空間の縦書き HUD）

ページ transform（`scale` / crisp 逆スケール）の **内側** に縦書き `textarea` を置くのは **禁止**（iPad で候補窓とスクロールが壊れる）。入力面は `#editor-root` 直下の `position: fixed` HUD のみ。

1. Pencil の **tap**（down→up、移動 < 8 CSS px）で空枠作成、または既存枠 tap で選択。`pointerdown` 時点では `createText` しない
2. `selectedTextId` を立て、選択枠の画面矩形に重ねた **縦書き `textarea`**（白背景 HUD）にフォーカスする。ページ上の枠は CSS `writing-mode: vertical-rl` の **表示専用**。`verticalGlyphs()` を表示に使わない
3. HUD は `getBoundingClientRect` で枠に合わせ、`visualViewport` 内にクランプする。ページ枠はキーボードで隠れてよい。確定は **`focusout` または枠クロムの確定** のみ。`visualViewport` 復帰だけでは `editText` しない（スプリットキーボード誤 commit 防止）
4. `compositionend` まで `editText` を dispatch しない。履歴は確定 1 回
5. 編集中（textarea フォーカス中）は undo/redo アイコンを disabled。未確定文字列と履歴を混ぜない
6. `window.scroll` ロック（§3.2）を編集中も維持する
7. HUD は `tool === 'text'` かつ単一選択のときだけマウントする。ワークスペースの pointer capture は HUD を chrome と同様に除外する

### 3.5 ポインタと Pencil

| `pointerType` | アプリ上の `PointerKind` |
| --- | --- |
| `pen` | `pencil` |
| `touch` | `finger` |
| `mouse` | `finger`（インクに使わない） |

- `pointerId` は down から up/cancel まで sticky。**最初の判定を維持する。途中で Pencil に昇格させない**（現行 `nativePointer.ts` の `prev === 'pencil' \|\| detected === 'pencil'` を移植するな）
- `buttons === 0` の Pencil `pointermove`（hover）は **無視**。描画しない
- 筆圧: **接触中**（`buttons > 0` かつ pointerdown 済み）に限り `pressure === 0` を `0.5` にする。ストローク中の瞬間 0 は **直前の pressure を保持**（0.5 にリセットしない）。`>1` は 1
- down で `setPointerCapture(pointerId)`。`isPrimary` が false の touch は掌として **無視**（Pencil ストローク中の余剰 touch を pan にしない）。例外: 2 本目の finger はピンチ用にだけ取る（§8.5）
- Pencil move は `getCoalescedEvents()` があればその配列。なければ 1 件。`getPredictedEvents` は使わない
- `preventDefault()` は pen/touch のワークスペース・PDF・ストック・スプリッタ（パッシブにしない）
- HTML5 DnD 禁止
- RN `force` / RNGH 数値 / UIKit `touchType` / altitudeAngle を Web に移植しない

### 3.6 PWA / キャッシュ

- Manifest: `name: MangaSketcher`, `display: standalone`, `orientation: any`
- Service Worker は **`public/sw.js`** をクライアントで `navigator.serviceWorker.register('/sw.js')` する（`app/sw.ts` を Next の暗黙エントリだと思わない）
- シェルキャッシュ対象（これだけ）: JS/CSS、`/page_template.jpg`、**`/pdf.worker.min.mjs`**
- IndexedDB / OPFS のユーザーデータは SW が触らない
- オフライン: シェル＋worker があれば PDF 表示も再 render できる。未インストール SW では PDF worker は HTTP キャッシュ任せ
- 初回 save 成功後に `navigator.storage.persist()` を 1 回呼ぶ（失敗しても編集は続ける）

---

## 4. リポジトリ構成

### 4.1 方針

Expo を本番として残さない。**カットオーバー**。`src/domain` のルールは残し、RN 描画・入力・WebView PDF・画素 clone 経路は本番から外す。

### 4.2 残す

```
sample/page_template.jpg     # ソース・オブ・トゥルース。1518×2150
sample/sample.pdf
src/domain/**                # §5 の判定に従う
docs/web-implementation-spec.md
docs/web-implementation-spec-review.md
.github/
```

### 4.3 新規（Next.js）

```
app/layout.tsx
app/page.tsx
app/p/[id]/page.tsx          # dynamic(Editor, { ssr: false })
app/manifest.ts
public/sw.js
public/pdf.worker.min.mjs
public/page_template.jpg     # sample/ からビルド時コピー。ランタイム URL はこれだけ
public/icons/
src/web/                     # Canvas、4ペイン、InkEngine、ジェスチャ FSM
src/web/gestures/            # pointerId マップ。stepWorkspaceGesture を呼ばない
src/storage/                 # IndexedDB + OPFS
src/input/pointerEvents.ts
src/theme/tokens.ts
next.config.ts               # Next 15
vitest.config.ts
```

ランタイム URL 固定: テンプレは **`/page_template.jpg`**。SW も同じパス。`sample/page_template.jpg` を fetch しない。

ルート: `/` 一覧、`/p/[id]` エディタ（1 つ）。存在しない id は一覧へ。`/` に戻ると History 破棄。

### 4.4 Expo の運命

削除: `App.tsx`, `index.ts`, `app.json`, `metro.config.js`, `src/screens/*`, `src/components/*`, `src/storage/appStore.ts`, `src/input/pointerGestures.ts`, `src/input/nativePointer.ts` の RNGH 分岐、Expo/RN/RNGH/WebView 依存。Jest → Vitest。`scripts/dump-pdf.mjs` は残す。

ポリシー関数 `workspacePointerPolicy` / `pdfPointerPolicy` / `stockPointerPolicy` は `src/domain/pointers.ts` へ移す。

---

## 5. モジュール再利用表（本番パイプラインを引き戻すな）

凡例: **再利用** = Web 本番から import してよい。**テスト専用** = Vitest のみ。本番バンドルに入れないか、画素 API を呼ばない。**改修** = 意味は同じ、型・定数・内部を変える。**破棄** = 削除。**新規** = Web 専用。

`src/domain/index.ts` が禁則関数を barrel export している現状を、本番エントリ（`src/web`）は **名前付き import の許可リスト** に制限する。`stampStroke` / `inkCells` / `pdfPageViewerHtml` / `strokePreviewPoints` / `cloneDocument` を web が import したら仕様違反。

| モジュール | 判定 | 本番 | テスト | 引き戻すな |
| --- | --- | --- | --- | --- |
| `layout.ts` | 再利用 | RTL・見開き。変更しない | 同左 | — |
| `stripGeometry.ts` | 改修 | hit / insertIndex / world 変換。`PAGE_DISPLAY_W/H = 216×306`。`pageLocalFromWorld` は CSS 対 1200×1700 | ヒット座標テストを 216 基準に更新（ゲート 2） | 108×152 のまま本番 |
| `types.ts` | 改修 | `EditorDocument`（画素なし、§7.1）。`DEFAULT_RASTER_WIDTH=1200`, `HEIGHT=1700`。**`DEFAULT_TOOL_PROPERTIES` を §6 に合わせる**（penSize 12, eraserSize 28, textFontSize 36）。`PdfDocument` から `uri` を削除し `opfsPath` + `generation` | 既存 `DocumentState`+`Raster.data` を `TestDocument` として残す | ラスタだけ 1200 にして penSize 2 を残す |
| `document.ts` | 改修+テスト専用 | `createEditorDocument`: 画素を確保しない。`rasterId` だけ。`cloneEditorDocument`: 構造の浅いコピー。**ラスタバイトを new しない** | `createDocument` / `cloneDocument`（現行の `cloneRaster`）は小ラスタテストのみ | 本番 `newPage` が `createRaster(1200,1700)` する |
| `reducer.ts` | 改修（分割） | `reduceEditorDocument`: JSON のみ。冒頭 `cloneDocument` **禁止**。画素 action は `commitInkBake` 等（§5.2）。`stampInk`/`strokeInk` を **emit しない** | 現行 `reduceDocument`+`stampStroke` を `reduceTestDocument` として残す | 本番で `reduceDocument` を呼ぶ |
| `history.ts` | 改修（分割） | `reduceEditorHistory`: VIEW_ONLY は present の JSON パッチのみ。past に画素を積まない。インク undo は `InkEngine` スナップショット（§7.8）。深さ 50 | 現行 `reduceHistory`+`cloneDocument` はテストのみ | `past: DocumentState[]` を本番に残す |
| `pointers.ts` | 再利用 | `resolvePointerIntent` / `brushRadius` / ポリシー表 | 同左 | `nativePointer.ts` を一緒に import |
| `workspaceGestures.ts` | **改修（FSM は新規）** | **再利用してよい:** `LONG_PRESS_MS`, `PAN_SLOP`, `TEXT_MOVE_SLOP`, `canGrabPage`, `preferHitForTool`, `GestureHit` 型。**本番で呼ぶな:** `stepWorkspaceGesture`（move 毎 `stampPage`/`stampClip`、単一 mode、番号 tap / `+` / clip 回転が無い、テキスト上で指が固まる） | `canGrabPage` と intent。`stampPage` を expect するテストは Web FSM 用に書き換える | 「移植せず呼ぶ」 |
| `drop.ts` | 改修 | ゾーン意味。枠サイズは `defaultTextBox(rasterWidth,rasterHeight)` のみ（§7.3） | 同左 | 10×40 を残す |
| `text.ts` | 再利用 | 幾何・リサイズ。**表示に `verticalGlyphs` を使うな** | `verticalGlyphs` 可 | VerticalText 1 グリフ 1 DOM |
| `pdfText.ts` | 再利用 | strip/join/range。非破壊 | 同左 | — |
| `pdfLayout.ts` | 改修 | 本番 media = pdf.js viewport。座標空間 = **描画 canvas の CSS ボックス**（letterbox。ペイン全面ではない）。`DEFAULT_PDF_MEDIA` はテストと sample フォールバック | 同左 | ペイン幅に線形写像 |
| `pdfExtract.ts` | 再利用 | loader に **同梱 pdf.js** を渡す | dump スクリプト | PdfPane の hidden WebView 抽出 |
| `pdfView.ts` | 破棄+抽出 | `clampPdfPage`。`pdfPageViewerKey(opfsPath, currentPage, generation)` | key のテスト | `pdfPageViewerHtml` / `pdfPageRenderCommand` / uri 引数 |
| `uiLayout.ts` | 再利用 | split clamp、PDF 非表示で比保持 | 同左 | — |
| `projects.ts` | 破棄して置換 | §7 の IDB。`serializeDocument` の `number[]` は本番禁止 | インメモリ Map の fake IDB（list/save/load/rename/delete） | JSON にラスタを埋める |
| `raster.ts` | テスト専用+削除 | 本番 **呼ばない**。`inkCells` **削除** | `createRaster` / `cutRect` / `stampBrush` / `inkPixelCount` / `compositeRaster` | 本番 marquee を `cutRect` 二重ループ |
| `stroke.ts` | 部分再利用 | `streamlineStroke` / `densifyStroke` / `prepareStroke` はペンの path 平滑化に使ってよい。**`stampStroke` 本番禁止。`strokePreviewPoints` 削除** | `stampStroke` + 小ラスタ | 96 View プレビュー |
| `InkLayer.tsx` / `PdfPane.tsx` / `VerticalText.tsx` / RN UI | 破棄 | — | — | 再実装 |
| シナリオテスト | 再利用（行動） | — | RTL、MOVE、ルビ、CRUD | `pdfPageViewerHtml('AAA')` 断言。本番 ink を `strokeInk` だけで証明した気になる |

### 5.1 VIEW_ONLY（undo に積まない。画素に触らない）

集合を固定する。追加・削除しない。

`selectPage`, `setTool`, `setToolProperties`, `setWorkspaceView`, `setStockView`, `setPdfView`, `selectClip`, `selectText`, `setUiLayout`

これらの `reduceEditorDocument` は:

```
return { ...doc, /* パッチした JSON フィールドだけ */ };
```

`pages` / `pasteboardClips` オブジェクトを新しい Raster で差し替えない。参照を共有する。`InkEngine` を呼ばない。`cloneDocument` を呼ばない。

`rename` は VIEW_ONLY ではない（エディタ内 undo 可）。一覧の改名は save API 直叩きで履歴なし。エディタに改名 UI が無ければ `rename` action は一覧専用。

### 5.2 本番 action とテスト action

**テスト専用（本番 dispatcher が emit 禁止）:** `stampInk`, `strokeInk`, `applyStampFromPointer`。`marqueeCut` / `bakeClipOntoPage` の **画素付き** 現行実装。

**本番 JSON action（画素 payload なし）:**

| type | 画素側（InkEngine、action の前または後） | reducer |
| --- | --- | --- |
| `commitInkBake` | 対象 canvas は既に描き終わっている。`rasterId` だけ渡す | `inkGeneration++`。past には **pointerdown 時点のスナップショット参照** を積む（§7.8） |
| `commitMarqueeCut` | ページ canvas から矩形を clip canvas へコピーし、ページを `clearRect` | clip メタデータ追加、選択 |
| `commitClipBake` | clip canvas を page canvas へ transform して drawImage。clip canvas dispose | clip 配列から削除 |
| 既存のページ/テキスト/PDF JSON action | 画素なし | 現行意味 |

「`strokeInk` 相当」という語は使わない。本番インク履歴の単位は `commitInkBake` 1 ストローク 1 回。

---

## 6. v1 固定値一覧

| 名前 | 値 |
| --- | --- |
| 本番ラスタ | **1200×1700**（`round(1200 * 2150/1518)=1700`） |
| テンプレ URL | **`/page_template.jpg`** |
| テンプレ隠し | `TEMPLATE_PAGE_NUMBER_COVER = {x:0.42,y:0.93,width:0.16,height:0.055}` |
| ストリップ表示 | 216×306 CSS px。`+` 56、隙間 8、見開き 16、番号帯 32 |
| `DEFAULT_TOOL_PROPERTIES` | penSize **12**, eraserSize **28**, penOpacity **1**, eraserOpacity **1**, textFontSize **36**, 色 `#1A1A1A` |
| パレット | `#1A1A1A #6F675C #FFFFFF #C45C26 #3D5A80 #2A9D8F` |
| ズーム | WS/PDF/ストック 既定 1、範囲 0.25–4.0。ストック grid は zoom=1 pan=0 |
| 長押し | 420 ms（ページ掴み **および** PDF 範囲モード開始） |
| パンスロップ | 12 CSS px |
| テキスト移動スロップ | 8 CSS px |
| マーキー最小 | 4 ラスタ px 未満は no-op |
| スプリット | 0.22–0.78、既定 0.58 / 0.46 |
| サイドバー | clamp(280, 28vw, 360)、コンパクト 112 |
| 自動保存 debounce | 文書 800 ms、ビュー 1500 ms |
| hidden flush | **メモリ上の最新 PNG `ArrayBuffer` を IDB に put**。pagehide で `convertToBlob` しない（§7.6） |
| 履歴深さ | **50**（`reduceEditorHistory` の契約。oldest 削除） |
| InkEngine ホット上限 | **OffscreenCanvas 同時 8 枚**（1200×1700）。超過は LRU で PNG に落として dispose（§9.6） |
| PDF bitmap 長辺 | **≤ 2048 CSS ピクセル相当の canvas 幅高さ**。超過分は CSS 拡大 |
| 空インク PNG | 透明 1200×1700 を **モジュールロード時に 1 回** 作り、新規 N ページはその `ArrayBuffer` をコピーして IDB に put（作成待ちで 50 回エンコードしない） |
| pdf.js | 同梱 4.x。CDN 禁止 |
| IDB | `mangasketcher` version 1 |
| OPFS | `pdfs/{projectId}.pdf` |
| Next.js | 15 |
| 同時ポインタ | Pencil 1 + finger 最大 2（ピンチ）。それ以上の touch は無視 |

---

## 7. データモデルと永続化

### 7.1 ランタイム形とテスト形を分ける

**EditorDocument（本番 React state / IDB JSON）** に `Uint8ClampedArray` を置かない。

```
PageMeta = { id, texts, rasterId }
ClipMeta = { id, x, y, scale, rotation, rasterId }
PdfMeta = null | {
  pageCount, currentPage, zoom, panX, panY,
  sourceTextByPage,
  opfsPath: "pdfs/{projectId}.pdf",
  generation: number   // OPFS 置換のたび +1。uri は存在しない
}
EditorDocument = {
  projectId, name, rasterWidth, rasterHeight,
  pages: Record<PageId, PageMeta>,
  workspaceOrder, stock,
  pasteboardClips: ClipMeta[],
  pasteboardTexts,
  selectedPageId, selectedClipId, selectedTextId,
  tool, tools, pdf,
  workspaceZoom, workspacePanX, workspacePanY,
  stockZoom, stockPanX, stockPanY,
  workspacePdfSplit, paletteStockSplit,
  pdfViewerVisible, sidebarCompact, stockLayout,
  inkGeneration: number
}
```

画素の正: `InkEngine`（§7.7）。パンは `setWorkspaceView` で JSON の 3 数値だけ変える。

**TestDocument** = 現行 `DocumentState`（`Raster.data: Uint8ClampedArray`）。シナリオは小ラスタのまま `reduceTestDocument`。CI は Canvas 画素一致を要求しない。本番消しゴムは §13.1 の InkEngine テストで証明する。

### 7.2 本番ラスタ寸法

`createEditorDocument` のデフォルト 1200×1700。テストは 16×20 を明示。下書きもインクも同一 bitmap。1 ページ非圧縮 8,160,000 バイト。常駐は §9.6。

### 7.3 テキスト枠デフォルト

`defaultTextBox(rw, rh)` → `{ width: round(rw*0.08), height: round(rh*0.25) }`（1200 なら 96×425）。`createText` / `dropActions` / PDF ドロップは **この関数だけ**。`drop.ts` の 10×40 と Workspace の 8×22 は破棄。

### 7.4 IndexedDB（version 1）

- `meta` keyPath `id`: `{ id, name, updatedAt, pageCount }`
- `documents` keyPath `id`: EditorDocument JSON。画素・PDF バイト・base64・`uri` 禁止
- `rasters` keyPath `rasterId`: PNG `ArrayBuffer`。`{projectId}:page:{pageId}` / `{projectId}:clip:{clipId}`。空でも透明 PNG（共有テンプレのコピー）

### 7.5 OPFS と削除順（1 本に固定）

パス: `pdfs/{projectId}.pdf`。原子置換。`generation` を documents に保存。

**削除トランザクション（この順以外禁止）:**

1. OPFS `pdfs/{id}.pdf` を delete（無くても続行）
2. 1 つの IDB transaction: `rasters` を prefix 削除 → `documents` 削除 → `meta` 削除
3. 途中失敗は reject。**meta が残っていれば一覧に出る**（再開削除可能）
4. 「先に meta から外す」は禁止（幽霊ファイル）
5. 起動 GC: meta に無い `pdfs/*.pdf` と rasters を削除

### 7.6 自動保存と Safari hidden flush

**画素スナップショット（同期、pointerup / カット / クリップベイクの直後、debounce 前）:**

1. 対象 OffscreenCanvas から `ctx.getContext('2d')` は既にある前提で、`canvas.convertToBlob` を **待たずに** 次を行う: 直前に保持している **エンコード済み PNG `ArrayBuffer`** が無ければ、エンコードを開始する
2. エンコード完了（通常数十 ms 後、フォアグラウンド）で `InkEngine.encodedPng.set(rasterId, arrayBuffer)` を差し替え。これが **dirty ページの最新バッファ**
3. エンコード開始はベイク瞬間。pagehide まで待たない

空ページ初回: §6 の共有透明 PNG を `encodedPng` の初期値にする。

**debounce 書き込み（フォアグラウンド）:**

- 非 VIEW_ONLY → 800 ms 後、save queue が `rasters` put（`encodedPng`）+ `documents` put
- VIEW_ONLY ビュー類 → 1500 ms、`documents` のみ
- **単一 save queue + 単調 `saveGen`。** 古い documents JSON が新しい PNG の後に上書きしてはならない。順序: その gen の dirty rasters を put してから documents を put。進行中の job がある間は最新 gen だけキューに残す

**hidden / pagehide（await convertToBlob 禁止）:**

1. 新しい `convertToBlob` / `createImageBitmap` / `getDocument` を **始めない**
2. 既にメモリにある `encodedPng`（ベイク済みストローク）を、開済み IDB 接続があれば `store.put(arrayBuffer)` する（Blob 化しない）
3. 進行中の convertToBlob Promise の結果は、完了しても hidden 中は put してよいが、**pagehide ハンドラはそれを await しない**
4. ベイクからエンコード完了前にホームへ行った線: `encodedPng` は **前ストローク** のまま。未保存ドットを出し、foreground 復帰で未完了エンコードを再開する。§13.2.9 は「ベイク後にエンコードが完了した線」が残ること。エンコード未完了の最終ミリ秒は E14（製品を「消えた」と呼ばない。ドットで示す）

ルート離脱はフォアグラウンドなので 800ms を待たず queue flush を await してよい。

履歴配列は IDB に書かない。

新規: N≥1、`crypto.randomUUID()`、空 PNG を N 枚 put、documents put、それから `/p/{id}`。

開く: 1 タブ想定。二重タブ last-write-wins。ロックファイルなし。

### 7.7 InkEngine — 画素の単一の正

```
InkEngine {
  hot: Map<rasterId, OffscreenCanvas>     // 最大 8
  encodedPng: Map<rasterId, ArrayBuffer>  // 最新 PNG。hidden flush の入力
  thumbs: Map<rasterId, ImageBitmap>      // 144×204。undo/ベイクで invalidate
  decode(rasterId): OffscreenCanvas       // PNG → canvas。LRU 追い出し
}
```

誰が画素を持つか:

| 操作 | 正 | EditorDocument | clone |
| --- | --- | --- | --- |
| 指パン / ピンチ / スプリット | なし | VIEW_ONLY JSON | 画素コピー 0 |
| ペン ライブ | overlay canvas（対象と同寸、§9.2） | 動かない | 0 |
| ペン pointerup | overlay を page canvas へ 1:1 drawImage → encodedPng エンコード開始 → `commitInkBake` | inkGeneration | **対象 1 枚** の down スナップショットのみ |
| 消しゴム ライブ/up | **page/clip の hot canvas に直接 destination-out** | 同上 | 同上 |
| undo | `encodedPng`/hot を past スナップショットで置換 | JSON present を戻す | 対象 rasterId のみ |

React は `inkGeneration` と JSON を購読する。`Uint8ClampedArray` を walk しない。

`cloneDocument`（全ページ `new Uint8ClampedArray`）は本番履歴・本番 reducer から呼ばない。証明: §13.1「VIEW_ONLY パンで raster バッファ参照が不変」。本番には `data` が無いので、テストは `reduceEditorDocument` に画素フィールドを混ぜたスタブで「pages[id] オブジェクト参照がパン前後で同一」を見る。

### 7.8 履歴（CoW、深さ 50）

```
EditorHistoryEntry = {
  doc: EditorDocument,  // JSON。画素なし
  inkUndo: Map<rasterId, ArrayBuffer>  // その action 直前の PNG（対象だけ）
}
EditorHistory = { present: EditorDocument, past: EditorHistoryEntry[], future: EditorHistoryEntry[] }
```

- VIEW_ONLY: `present` をパッチ。past に積まない。`inkUndo` 空
- `commitInkBake`: pointerdown で取った **1 ページ（または 1 クリップ）** の PNG（またはエンコード待ち中は down 時に複製した OffscreenCanvas を後で PNG 化してエントリに入れ、canvas は close）を `inkUndo` に載せる。全ページ分は載せない
- undo: `present = entry.doc`。`inkUndo` の各 id を InkEngine に戻す。thumb 無効化。DOM テキストは `present.pages[*].texts` から再描画
- past.length > 50 なら oldest を捨て、その ArrayBuffer を解放
- ストローク中の `setTool` は無視（up までツール固定）

### 7.9 エディタ起動時の PDF 復元

`/p/{id}` マウント（picker ではない）:

1. `documents.get(id)`。無ければ一覧へ
2. 全 `rasterId` の PNG を `encodedPng` に載せる。hot canvas は可視ページだけ decode（§9.6）
3. `pdf.opfsPath` が無ければ PDF ペインは空（picker）
4. あれば OPFS `getFile()` → `arrayBuffer` → `getDocument({ data })` → **セッションに `PDFDocumentProxy` を保持**（ページ送りで `getDocument` し直さない）
5. `sourceTextByPage` が documents にあれば **再抽出しない**
6. `getPage(currentPage).render`（§10.2）。zoom/pan を復元
7. OPFS 欠落: picker 空状態。落ちたテキスト JSON は残す

---

## 8. 入力パイプライン

```
PointerEvent
  → pointerKindFromWeb（最初の pointerType のみ sticky）
  → hover なら return
  → 余剰 touch（掌）なら return
  → setPointerCapture
  → 座標変換
  → sessions: Map<pointerId, Session>     // 単一 gesture.current 禁止
  → Web FSM（§8.5）※ stepWorkspaceGesture を呼ばない
  → EditorAction
  → reduceEditorHistory + InkEngine
```

### 8.1 マッピング

| ポインタ | 場所 | ツール | 結果 |
| --- | --- | --- | --- |
| 指 1 本、スロップ超 | ワークスペース | 任意 | ストリップ全体パン。テキスト上でもパンする（枠は動かさない） |
| 指 2 本 | WS / PDF / ストック free | 任意 | ピンチ。中点パン |
| 指 420ms、スロップ未満、hit=page 本体 | WS | 任意 | ページ掴み。サムネ追従。MOVE |
| 指 tap、番号帯 | WS | 任意 | 未選択→`selectPage`。選択済→`insertAfterSelected` |
| 指 tap、`+` | WS | 任意 | `appendPage` |
| Pencil | WS | 任意 | ページを掴まない |
| Pencil | ページ | pen | overlay に描く。up で page にベイク |
| Pencil | ページまたは選択クリップ | eraser | **その bitmap に destination-out**。テキスト残す |
| Pencil tap | ページ | text | 空枠作成 or 選択。移動はスロップ超 |
| Pencil | ハンドル | text | 縦横比固定リサイズ |
| Pencil | ページ | select | マーキー。テキスト非ヒット |
| Pencil | クリップ本体 / 角 / 上 | select | 移動 / 均一スケール / 回転 |
| 指 1 本 | PDF | 任意 | **既定はパン**。420ms 長押し後のドラッグだけ範囲選択（§8.6） |
| 指 2 本 | PDF | 任意 | ピンチ＋中点パン。範囲中なら範囲キャンセル |
| Pencil | PDF | 任意 | no-op |
| 指 | スプリッタ / ストック | 任意 | 比更新 / パンまたはページドラッグ |
| Pencil | スプリッタ / ストック | 任意 | no-op |

### 8.2 ページ番号タップ

指の tap（down→up、移動 < 12 px、時間 < 420 ms）。Pencil では発火しない。確認ダイアログなし。

### 8.3 削除

WS 選択ページの番号帯、ストック各サムネ。`deleteWorkspacePage` / `deleteStockPage`。ペーストボード非接触。InkEngine から該当 raster を dispose。

### 8.4 `pointerEvents.ts`

`pointerKindFromWeb`、sticky（非昇格）、pressure 規則（§3.5）。RNGH テストは削除。

### 8.5 ワークスペース FSM（新規。Next.js / `src/web/gestures`）

`stepWorkspaceGesture` を本番の正にしない。現行モジュールの欠陥: move 毎 stamp、finger up で effects 空（番号/`+` が死ぬ）、`moveClip` のみで scale/rotate なし、単一 mode で Pencil 中の指が潰れる、テキスト hit で指がパンしない。

**保持する規則:** `canGrabPage`、`preferHitForTool`（ペン/消しゴムはテキストを無視）、定数 420/12/8、`resolvePointerIntent`。

**セッション:** `Map<pointerId, Session>`。同時に Pencil ストローク 1 本と指パン（またはピンチ）を許可する。役割を入れ替えない。3 本目の touch は ignore。

Session.mode:

`idle` → `fingerPending` | `pan` | `pinch` | `grabPage` | `penOverlay` | `eraseDirect` | `marquee` | `moveClip` | `scaleClip` | `rotateClip` | `pendingTextMove` | `moveText` | `resizeText`

遷移（要約）:

- finger down: `fingerPending`（hit が page なら 420ms タイマー。番号帯/`+` なら tap 候補）
- finger move ≥ 12px: 番号帯でも **パン**（insert しない）。page 本体もパン。テキスト上もパン
- 420ms かつ <12px かつ page 本体: `grabPage`
- finger up かつ pending かつ番号帯: tap 規則（§8.2）
- finger up かつ pending かつ `+`: `appendPage`
- 2nd finger: 両 id を `pinch`
- pencil + pen: `penOverlay`。move は overlay のみ。up は §9.2
- pencil + eraser: `eraseDirect`。move は page/clip canvas。up は `commitInkBake`
- pencil + select + page: `marquee`。up で最小サイズチェック→`commitMarqueeCut`
- pencil + select + clip 角/上/本体: scale/rotate/move。JSON `transformClip`
- pencil + text: tap で create/select。スロップ超で move。SE で resize
- いずれかの up/cancel: その pointerId だけ idle。他方のセッションは継続

`GestureEffect` の `stampPage` を Web アダプタが出してはならない。クリップ消しゴムも 1 ストローク 1 ベイク。

### 8.6 PDF 指: パンを残したまま範囲選択する

プロダクトは PDF のピンチ/パンと、指の範囲ドラッグの両方を要求する。1 本指を全部範囲にするとパンが消える。

アルゴリズム（PDF ペイン、finger、`pointerId` 単位）:

1. down: `pdfPending`。原点と時刻
2. move かつ経過 < 420ms かつ距離 ≥ 12px → **`pdfPan`**。`setPdfView({ panX, panY })`。範囲に入らない
3. 420ms 経過かつ距離 < 12px → **`pdfRange`**。以降の move は矩形プレビュー。up で幅高さ ≥ 8 CSS px なら payload 保持してドロップ待ち。未満はキャンセル
4. 2 本目 → ピンチ＋中点パン。range 中なら range 破棄
5. Pencil → 何もしない

ページ送りボタンは指のみ。`clampPdfPage` のあと **保持中の `PDFDocumentProxy.getPage(n).render`**。フルファイル base64 HTML の再マウントをページ送り経路にしない。

---

## 9. 描画パイプライン

### 9.1 層（1 ページ）

1. `/page_template.jpg` stretch
2. 白矩形で焼き込み「1」を隠す
3. インク: hot canvas を CSS 216×306 へ縮小表示（ソースは常に 1200×1700）
4. ページ所属テキスト DOM（`vertical-rl`、回転禁止）
5. **ペン用** ライブ overlay（キャプチャ中のみ、常設しない。§14.11 の第二レイヤ常設禁止と矛盾しない）
6. UI 番号帯

消しゴム用に空 overlay を常設しない。

### 9.2 ペン（overlay → 1:1 ベイク）

overlay の bitmap サイズ = **対象ラスタと同寸**（ページ 1200×1700、クリップはその幅高さ）。CSS で 216×306 に縮小する。§9.5 の dpr バッファは **画面コピー** でありライブの正ではない。

ライブ: overlay に source-over の stroke。`stampBrush` 禁止。Document / IDB を動かさない。`lineWidth` はラスタ座標の `2 * brushRadius(...)`。表示スケールは CSS が掛ける（overlay 内部では掛けない）。

pointerup:

1. `pageCtx.drawImage(overlay, 0, 0)`（1:1。拡大ベイク禁止）
2. overlay clear
3. PNG エンコード開始 → `encodedPng`
4. `commitInkBake` 1 回

pointercancel: overlay を捨て、page は不変。

1 ドットも 1 ベイク。

### 9.3 消しゴム（ページ画素を消す。overlay destination-out 禁止）

空 overlay への destination-out はページインクを消さない。**禁止。**

pointerdown:

1. 対象を hot に decode
2. undo 用にその canvas を 1 枚だけ複製（`new OffscreenCanvas` + `drawImage`）。これが CoW。他ページは触らない
3. `eraseDirect`

pointermove: 対象 canvas に `globalCompositeOperation = 'destination-out'` で stroke。テキスト DOM は触らない。

pointerup: 複製を history の `inkUndo` へ（のち PNG 化）。canvas はそのまま消えた状態。`commitInkBake`。`encodedPng` エンコード開始。

pointercancel: 複製を対象へ `drawImage` して戻す。

証明: pointerup 後に **page canvas** の `getImageData` で α>0 画素がストローク前より減る（overlay ではなく）。§13.1。

クリップ消しゴムも同じ（clip canvas が対象）。`stampInk` 連打禁止。

### 9.4 クリップ

本番カット/ベイクは Canvas 2D（`drawImage` / `clearRect` / transform）。`cutRect` / `compositeRaster` の JS ループはテスト専用。

選択枠: 角=均一スケール min 0.1、上=回転。指は触らない。select はテキストを掴まない。

### 9.5 表示コピー

画面に出す 2D canvas は `216*dpr × 306*dpr` に 1200×1700 を `drawImage`。`imageSmoothingQuality='medium'`。これは正ではない。

### 9.6 メモリ（全ページ canvas 常駐禁止）

同時 hot OffscreenCanvas ≤ 8。可視ストリップを優先。8 超の可視ページは thumb を拡大表示し、Pencil down で LRU 追い出し＋ decode。

非表示は `encodedPng` のみ。canvas `.width=0` または参照破棄。

undo とベイクで thumb invalidate。

### 9.7 サムネイル

144×204（コンパクト 112×158）。テンプレ+インク。**テキストは焼かない**（現行踏襲。プロダクトはサムネ品質未定義）。ドラッグ中はこの thumb。undo 後も再生成。

---

## 10. PDF パイプライン

### 10.1 picker ロード

`<input type="file" accept="application/pdf,application/x-pdf">`。File System Access API 不使用。

1. `arrayBuffer` → OPFS 原子置換（ソース無改変）
2. `generation += 1`
3. `getDocument` → セッションに Proxy を保持
4. `extractPdfSourceText`（同梱 pdf.js。WebView 抽出禁止）
5. `loadPdf`（`opfsPath`, `generation`, `pageCount`, `sourceTextByPage`）。generation が変わったら currentPage=1, zoom=1, pan=0。同じ generation の再ロードはページ/ズーム維持
6. `pdfPageViewerKey(opfsPath, currentPage, generation)` で canvas を捨てて render

`uri` フィールドは作らない。`sameUri` 判定は廃止。

開発用に `public/sample.pdf` ショートカットは任意。本番必須ではない。

### 10.2 表示・ページ送り

- **pdf.js `page.render` のみ。** WebView / iframe / embed / object / 内蔵ビューア / base64 HTML をページ送りの経路にしない
- ページ変更: `RenderTask.cancel` → clear → `proxy.getPage(n)` → viewport（長辺 ≤ 2048 に clamp）→ `render`
- Proxy はセッション保持。送りのたびに `getDocument` しない
- ピンチ **中** は wrapper に CSS `transform: scale`。`pointerup` 後に本 `render`（ピンチ毎 render 禁止）
- 配置は contain（letterbox）。**範囲座標は canvas 要素の `getBoundingClientRect`**。ペイン全面を media に写さない
- as-is。色変換しない
- リロード復元は §7.9

ページ送り UI: 指の前/次。Pencil では送らない。

### 10.3 抽出と範囲ドロップ

`getTextContent` → `pdfJsItemsToDomain`。`stripRuby` 非破壊。`pdfRange` セッションのビュー矩形（canvas 座標）→ `viewRectToPdf` → `rangeSelectBody` → `joinVerticalBody` → テキスト 1 個。ドロップは `dropActions`。ソース PDF 不変。最小 8 CSS px。

### 10.4 ワーカー

`workerSrc = '/pdf.worker.min.mjs'`。CDN 禁止。SW シェルに含める。

---

## 11. レイアウトクロム

### 11.1 4 ペイン

横も縦も同一ツリー。縦は狭い（仕様）。タブ化しない。

サイドバー幅: 通常 clamp(280px, 28vw, 360px)、コンパクト 112。スプリットは指のみ、`nextSplitFromDrag`。

PDF 非表示: flex `{workspace:1,pdf:0}`。`workspacePdfSplit` 数値は残す。

### 11.2 コンパクトサイドバー

ツール 4 アイコン、サイズ/不透明度（テキスト選択時はフォントサイズ）、色タップでパレット、undo/redo（IME 中 disabled）、一覧、展開、PDF トグル。ストックは free/grid と MOVE。描画不可。

### 11.3 ストリップ

LTR `[+][5][4]|[3][2]|[1][余白]`。0 ページは `[+][余白]`。ピンチ/パンはストリップ全体。掴み中は order 未確定。ドロップは `hitStripFrame`。ストックへ入ったら MOVE。

### 11.4 ストック

free: x,y パン+ピンチ。grid: 配列順、zoom=1。グリッド内並べ替えなし。描画・テキスト編集なし。

---

## 12. 実装順（ゲート）

| # | 作業 | 完了条件 |
| --- | --- | --- |
| 0 | 本文書 | 実装 PR が反したら仕様が先 |
| 1 | Next 15 + `public/page_template.jpg` + `public/sw.js` 登録 + `dynamic ssr:false` | テンプレ 404 しない。Expo エントリ削除 |
| 2 | domain 分割 + Vitest | シナリオ行動グリーン。`pdfPageViewerHtml` 断言削除。`PAGE_DISPLAY` 216 で hit テスト更新 |
| 3 | IDB/OPFS。削除順 §7.5 | CRUD。PDF なしリロードでページ数とテキスト残る |
| 4 | 4 ペイン + スプリット永続 | undo で比が戻らない |
| 5 | ストリップ RTL + `/page_template.jpg` + 番号隠し | 「1」が見えない |
| 6 | Pointer FSM + 指パン/ピンチ/長押し。`touch-action:none` | ブラウザズームにならない。単体 `pen`/`touch`。実機 Pencil は #8 |
| 7 | コンパクトサイドバー | |
| 8 | ペン overlay ベイク + 消しゴム **page canvas** + encodedPng + 800ms | View-per-pixel 無し。消しゴム後に page `getImageData` の α が減る。パン 100 回で画素 new 無し |
| 9 | 画面空間の縦書き IME HUD + ページは表示専用 | ページ内 textarea 無し。scrollTo ロック |
| 10 | マーキー/クリップ Canvas ベイク | JS `cutRect` 本番無し |
| 11 | ストック MOVE、0 ページ WS | PB 座標不変 |
| 12 | pdf.js Proxy 保持、送り render、長押し範囲、1 本指パン、OPFS リロード | generation で key 変化。CDN/WebView 無し |
| 13 | 履歴 50 + hidden は encodedPng put | リロードで undo 空 |
| 14 | iPad + Pencil QA | §13.2。シミュレータを Pencil 合格と呼ばない |

---

## 13. テスト計画

### 13.1 自動

既存シナリオの **行動** は TestDocument + `reduceTestDocument` で維持（小ラスタ `strokeInk` 可）。加えて本番契約:

| 要件 | 証明 |
| --- | --- |
| RTL / 挿入 / MOVE / 0 ページ / 削除 / ルビ / CRUD / スプリット非 undo | 現行 scenarios 行動 |
| 本番インクの正 | `commitInkBake` が `Raster.data` を持たない。fake InkEngine の canvas が変わる |
| 消しゴムがページインクを消す | 画素を page canvas に置き、`eraseDirect`（§9.3）を当て、**page** `getImageData` の α>0 が減る。overlay だけ見て合格にしない |
| VIEW_ONLY が clone しない | 100 回 `setWorkspaceView` のあと `pages` 各参照が同一。`Uint8ClampedArray` を new するスパイが 0 |
| `canGrabPage('pencil')===false` | 既存 |
| 番号 tap / `+` | Web FSM の unit: pending up → select/insert/append。`stepWorkspaceGesture` に tap が無いことを前提に **新テスト** |
| 指がテキスト上でパン | FSM: fingerPending + 移動 40px on pageText → `pan` |
| 2 つの pointerId | pencil `penOverlay` 中に finger `pan` が並立。掌の 3rd touch は ignore |
| PDF key | `pdfPageViewerKey` が page **と generation** で変わる |
| PDF パン vs 範囲 | 12px 未満 420ms → range。12px 未満 100ms で up → キャンセル。12px 超 100ms → pan |
| 削除失敗 | meta 残る。成功時 OPFS も rasters も無い |
| drop 枠 | 96×425 |
| `DEFAULT_TOOL_PROPERTIES` | penSize 12 |
| 表示 Canvas 一致 | CI で要求しない（E3） |

### 13.2 実機

1. Pencil で線、**同時に** 指でパン。混線しない（一方が他方の mode を奪わない）
2. Pencil 長押しでページが動かない
3. 指 420ms でページサムネ追従、ストック MOVE
4. ピンチがブラウザズームでない
5. 縦向き 4 ペイン（狭い）
6. HUD で確定後に本文が残る。ページ transform 内の textarea がフォーカスされない
7. PDF 1→2 で絵が入れ替わる。リロードで currentPage+zoom+pan が戻る
8. 範囲ドロップ後 PDF 原文が残る。1 本指で PDF をパンできる
9. ベイク＋ PNG エンコード完了後にホーム→復帰でその線がある。未エンコードは未保存ドット
10. コンパクトで色・サイズ・undo。IME 中 undo 無効
11. 消しゴムで **既に焼けた線** が消える（空キャンバスに消すだけの試験は不合格）

---

## 14. 禁止パターン

1. View-per-pixel / `inkCells` / InkLayer
2. 本番ラスタ 48×68（短辺 < 800 のデフォルト）
3. `stampBrush` / `stampStroke` をライブまたは本番ベイクに使う
4. WebView / iframe に PDF バイトや CDN pdf.js（抽出用 hidden WebView も含む）
5. PDF を JSON/base64 に埋める。ページ送りをフルファイル HTML 再マウントだけで行う
6. HTML5 DnD
7. RN force / RNGH 数値 / UIKit touchType / sticky の途中昇格
8. App Store v1
9. 書き出し UI
10. テキスト回転
11. 下書き第二ラスタの **常設**。ペン overlay はキャプチャ中のみ可
12. 履歴を IDB に書く
13. スプリットを undo に積む
14. ストック内描画・テキスト編集
15. ページ MOVE で pasteboard 座標を動かす
16. 縦向きだけペイン構成を変える
17. `stampInk` / `applyStampFromPointer` / `stampPage` effect を move 毎
18. SW がユーザー OPFS/IDB を cache.add
19. 本番 `cloneDocument` / `reduceDocument` 冒頭の全ラスタ copy
20. 消しゴムを空 overlay の destination-out で実装する
21. overlay を 216×dpr で持ち 1200×1700 へ拡大ベイクする
22. `stepWorkspaceGesture` を本番 FSM として呼ぶ
23. pagehide で `await convertToBlob` する
24. 縦書き textarea をページ transform の内側に置いてフォーカスする
25. `PdfDocument.uri` を残す / `sameUri` で OPFS キーを比較する

---

## 15. オープンリスク（プロダクト未決ではない）

| ID | リスク | 吸収 |
| --- | --- | --- |
| E1 | IDB 容量 | dirty PNG のみ。失敗表示。ページ上限なし |
| E2 | 二重タブ | last-write-wins |
| E3 | Canvas と stampStroke の不一致 | 本番 Canvas。CI は一致要求しない。消しゴムは InkEngine テスト |
| E4 | pressure 0 | hover 無視、接触中 0→0.5、in-stroke は直前値 |
| E5 | IME | 画面空間の縦書き HUD + focusout/確定のみ |
| E6 | 巨大 PDF 抽出 | 表示は成功、ドロップ空 |
| E7 | Worker 化 | v1 メイン。手段変更可 |
| E8 | SW 更新 | シェルのみ |
| E9 | coalesced 欠落 | 1 イベント |
| E10 | 履歴メモリ | 対象 1 raster の PNG のみ。hot ≤ 8 |
| E11 | mouse | finger。インクしない |
| E12 | テンプレ stretch | 番号隠しは正規化で追従。トンボ 1px ずれ許容 |
| E13 | Safari が IDB を捨てる | `storage.persist()`。失敗時は通常どおり |
| E14 | エンコード前 hidden | 前ストローク PNG + 未保存ドット。製品を「消えた」と言わない |

---

## 16. プロダクト文トレース

| プロダクト句 | 仕様節 |
| --- | --- |
| create + autosave, no export | §1.2, §14.9 |
| 4-pane 縦横 | §11.1 |
| 一覧 CRUD、1 つ、オンデバイス | §4.3, §7 |
| N≥1 白紙、PDF 後から | §7.6, §10.1 |
| `+` 読み順末尾、番号 tap | §8.2, §8.5 |
| 削除両方、0 WS | §8.3, §11.3 |
| テンプレ、隠し 1、下の番号 | §9.1, `/page_template.jpg` |
| ストリップ全体ピンチ/パン | §8.1, §8.5（テキスト上もパン） |
| RTL 見開き | `layout.ts` |
| 長押し掴み、それ以外パン、Pencil 非掴み | §8.5, `canGrabPage` |
| 1 ラスタ、色が下書き | §7.1, §9 |
| ペン筆圧、消しゴムはインク | §9.2, §9.3 |
| テキスト縦書き・空・PDF 編集・色・枠・非回転 | §3.4, §7.3 |
| select 矩形、変形、非テキスト、Pencil 矩形指パン | §8.5, §9.4 |
| ペーストボード、ベイク、MOVE で PB 不動 | §7.1, §9.4 |
| PDF as-is、**ピンチ/パン**、範囲、ルビ、ソース不変 | §8.6, §10, §7.9 |
| ストック free/grid、MOVE | §11.4 |
| セッション undo、非永続 | §7.8 |
| スプリット永続非 undo、PDF トグル、thumb、コンパクト | §5.1, §11 |
| 指=パン等、Pencil=描画等 | §8.1 |

---

## 17. 変更管理

- §2 を変える PR は実装と混ぜない
- §6 の数値変更は本文書が先
- 「暫定 48×68」「一旦 WebView」「一旦 `stepWorkspaceGesture`」はマージ禁止

---

## 18. Review response（ブロッカー → 本仕様）

対象レビュー: `docs/web-implementation-spec-review.md`。プロダクト §2 は変更していない。

| ID | 指摘 | 吸収先 | 実装契約の芯 |
| --- | --- | --- | --- |
| B1 | `strokeInk` と Canvas が二重の正 | §5.2, §7.7, §9.2 | 本番画素は InkEngine。履歴単位は `commitInkBake`。「相当」削除。`strokeInk` はテスト専用 |
| B2 | 空 overlay の destination-out | §9.3, §14.20, §13.1 | 消しゴムは page/clip canvas に直接描く。テストは page 画素 |
| B3 | overlay 解像度 | §9.2, §14.21 | overlay = ラスタ同寸。1:1 ベイク。dpr バッファは表示コピー |
| B4 | パン毎 8MB×N clone | §5.1, §7.1, §7.7, §14.19 | VIEW_ONLY は JSON パッチ。EditorDocument に `Uint8ClampedArray` 無し。`cloneDocument` 本番禁止 |
| B5 | `workspaceGestures` を as-is | §5 表, §8.5, §14.22 | 定数/`canGrabPage`/`preferHitForTool` のみ再利用。FSM は `Map<pointerId>` 新規。stamp 連打禁止 |
| B6 | PDF 1 本指パン欠落 | §8.6, §16 | 既定 1 本指はパン。420ms 後だけ範囲。2 本指ピンチ＋中点パン |
| B7 | リロード PDF 手順 / uri | §7.9, §10.1–10.2 | OPFS→Proxy 保持→render。key に generation。`uri` 削除 |
| B8 | 削除順の自己矛盾 | §7.5 | OPFS → IDB rasters→documents→meta。先に meta を外すな |
| B9 | pagehide の await blob | §7.6, §14.23 | ベイク直後にエンコード開始。hidden は既存 `encodedPng` を put。await しない |
| B10 | テンプレ URL | §4.3, §6 | `/page_template.jpg` + SW |
| B11 | IME の OR | §3.4, §14.24 | 画面空間 HUD。ページ内縦書き textarea 禁止 |
| B12 | ツール既定が 48px のまま | §5 `types.ts`, §6, §7.3 | pen 12 / eraser 28 / font 36。枠関数 1 本 |
| H 筆圧 hover | 空中描画 | §3.5, E4 | hover 無視。in-stroke 0 は直前値。非昇格 sticky |
| H 掌 | 単一 FSM 奪取 | §3.5, §8.5 | 3rd touch ignore。Pencil+指パン並立 |
| H PDF render | 毎ピンチ render、面積上限、letterbox | §10.2 | CSS ピンチ、up 後 render、長辺 2048、座標=canvas ボックス |
| H 常駐 400MB | 全ページ canvas | §6, §9.6 | hot ≤ 8 |
| H カット JS ループ | 1200 でヒッチ | §9.4 | 本番 Canvas。`cutRect` はテスト |
| H thumb undo | 無効化漏れ | §9.7, §7.8 | undo で thumb 破棄 |
| H save 交差 | 古い JSON | §7.6 | 単一 queue、rasters してから documents |
| H 空 PNG×N | 作成時エンコード | §6 | 透明 PNG 1 枚をコピー |
| H persist | Safari 削除 | E13 | `storage.persist()` |
| H 誤 createText | down で枠+キーボード | §3.4, §8.5 | tap（up）のみ |
| H ストローク中ツール | 未定義 | §7.8 | up まで無視 |
| H Next/SW | エントリ曖昧 | §3.1, §3.6 | Next 15、`public/sw.js`、`ssr:false` |
| H strip 定数 | テスト座標ずれ | §5 stripGeometry | 216×306 に更新がゲート 2 |

**レビューを採用しなかった点（プロダクトを削らないため）:**

- B6 の例「1 本指は常に範囲、パンは 2 本指だけ」は **採らない**。§2 は PDF のパンをロックしており、本文書への指示も「MUST allow pan」。1 本指パン + 長押し範囲にする。2 本指ピンチ＋中点パンも残す。
- §13.2.9 を「800ms 経過済みの線」に弱めない。代わりにベイク瞬間エンコード + `encodedPng` flush で吸収する（レビュー自身の推奨吸収）。エンコード未完了の hidden だけ E14。
)