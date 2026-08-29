# ワークスペース書き出し仕様

- 対象: iPadOS Safari（ホーム画面追加 PWA を含む）上の MangaSketcher エディタ
- 本文書の地位: 実装契約。数値・文言・失敗時の挙動に「あとで決める」は置かない
- 既存仕様との関係: `docs/web-implementation-spec.md` §1.2 の非ゴール「書き出し（PNG/PDF/ZIP/共有シート）」を、**本機能（ワークスペース ZIP 1 ファイル）に限り**上書きする。PDF 書き出し・ページ選択書き出し・サーバ送信は依然非ゴール
- 曖昧語（適宜・必要に応じて・将来・TBD・相当）は仕様欠陥とする

---

## 1. 目的と非目標

### 1.1 目的

ワークスペースに並んでいるページを、画面と同じ層順（白地 + 原稿用紙テンプレ + 「1」隠し + インク + テキスト）の PNG と、ページ内テキストを読み順で連結した `text.txt` として、ZIP 1 ファイルにまとめ端末へ保存できるようにする。

保存の主経路は `navigator.share` の共有シートから「"ファイル"に保存」である。iPadOS Safari は File System Access API の picker（`showDirectoryPicker` / `showSaveFilePicker`）を提供しないため、フォルダ直接書き込みは行わない。フォールバックとして `<a download>` を必ず置く。

処理は端末内で完結する。サーバ API は使わない（既存の `/api/debug-log` も書き出し経路から呼ばない）。デバッグが必要なら `src/web/ipadDebugLog.ts` のみ（クライアントから `127.0.0.1` / `localhost` へ `fetch` しない）。正常系にログ必須ではない。

### 1.2 非目標（初回スコープでやらない。議論再開もしない）

| 非目標 | 固定理由 |
| --- | --- |
| ページ選択書き出し | 対象は `workspaceOrder` 全件のみ |
| ストック・ゴミ箱・ペーストボード・PDF ペインの書き出し | ワークスペース配置順のページだけが成果物 |
| File System Access API | iPadOS Safari 非対応 |
| 自動で共有シートを開く 1 段階フロー | transient activation 切れを避ける |
| JPEG / PDF / 複数 ZIP | PNG + `text.txt` を 1 ZIP |
| 透明背景のままのページ画像 | 白背景にテンプレを合成する |
| インク PNG を無加工で ZIP に入れる | 保存データは透明・テキストなし・テンプレなし。書き出し時に合成する |
| ライブペン overlay（未ベイク）の取り込み | ベイク済みインクのエンコード完了を待つ |
| 未コミットのテキスト編集バー下書き | `history.present` の確定 `PageMeta.texts` のみ |
| ZIP 内 PNG の deflate | PNG 自体が圧縮済み。store（method 0）で格納 |
| 書き出し専用サーバ・アップロード | オフライン完結 |
| `jszip` その他の ZIP ライブラリ | `fflate` のみ追加 |
| MIME を `application/octet-stream` にする | ZIP の `File` / `Blob` は `application/zip` のまま |
| `File` コンストラクタ非対応へのフォールバック | 対象は iPadOS 17+ |
| 画面ページフレーム（`.ms-pageFrame` 216×306）の固定比改修 | 書き出し画素は `doc.rasterWidth` × `doc.rasterHeight`。現行製品の既定は 1200×1700。フレーム CSS サイズや比の変更はこのスコープ外 |
| 画面 DOM（`writing-mode: vertical-rl`）とのピクセル完全一致 | テキスト焼き込みの正はサムネと同じ `drawPageTextsOnThumb`（§6.5） |

---

## 2. ユーザーフロー

書き出しは **2 段階** である。1 段階目で ZIP を生成し、2 段階目のユーザー操作でのみ共有またはダウンロードする。生成完了後に `navigator.share` を自動実行してはならない。実装は共有とダウンロードの **両方の経路を必ず置く**。`canShare` が files 非対応のときだけ共有ボタンを出さない（§9.2）。

### 2.1 状態

UI は次の 4 状態だけを取る。同時に進行中の書き出しは 1 つまで。

| 状態 | 書き出しボタン | 進捗 | 完了アクション | エラー文 |
| --- | --- | --- | --- | --- |
| idle | 有効 | 非表示 | 非表示 | 非表示 |
| generating | 無効 | 表示 | 非表示 | 非表示 |
| ready | 有効 | 非表示 | 表示 | 非表示 |
| failed | 有効 | 非表示 | 非表示 | 表示 |

`ready` 中に再度「書き出し」をタップしたら、保持中の Blob / Object URL を破棄して `generating` からやり直す（ダウンロード click に使った Object URL の revoke 規則は §9.4）。

書き出し開始時、および `ready` 表示中は配置パネルを閉じる。進捗・完了アクションは配置パネルと重ならない（§3.1、§15）。

### 2.2 段階 1: 生成

1. ユーザーが「書き出し」をタップする
2. 状態を `generating` にする。配置パネルが開いていれば閉じ、以降 `ready` になるまで開かない
3. 開始時点の `history.present` を `cloneEditorDocument(present)` でスナップショットする。以降のドキュメント編集はこの ZIP に入れない
4. スナップショットの `workspaceOrder.length` が **200 を超えていれば生成を開始しない**。状態を `failed` にし「書き出しに失敗しました」を出す（ページループ・encode 待ち・ZIP 組み立てをしない）
5. 対象ページの `rasterId` について `InkEngine.flushPendingEncodes()` を 1 回呼び、各 raster の `isEncoding` が false になるまで待つ（§6.4）。完了後に **全対象の `captureRasterPng` をコピー**し、そのコピー群だけを以降の生成入力にする。生成中に後から描いた線は混入しない
6. `workspaceOrder` を先頭から順に処理する。各ページの合成が始まる直前に進捗を `N/M ページ…` に更新する（`N` は 1 始まりのページ番号、`M` は `workspaceOrder.length`）
7. ページ間は `await` で区切り、進捗 DOM が描画される隙間を空ける（同一同期ブロックで全ページを回さない）
8. ZIP バイト列と `File` を保持し、状態を `ready` にする（このときも配置パネルは閉じたまま）

`M === 0` のときは進捗を出さず、空のページ集合として ZIP を組み立ててすぐ `ready` にする（§10.1）。encode 待ちは対象 raster が 0 件なのでスキップする。

途中でタイムアウト・未登録 raster・不正 PNG・デコード失敗などが 1 件でもあれば書き出し全体を `failed` にする。欠ページを飛ばした「成功 ZIP」は出さない（§6.4、§10.2）。

### 2.3 段階 2: 完了アクション

`ready` ではボタン付近に次を出す。

- 共有可能なとき（§9.2）: 「"ファイル"に保存」と「ダウンロード」の 2 ボタン
- 共有非対応のとき: 「ダウンロード」のみ。「"ファイル"に保存」は DOM に載せない

「"ファイル"に保存」は共有シートを開く。ユーザーが「ファイル」アプリへ保存すれば、そこでフォルダを選べる。

「ダウンロード」は `<a download>` で ZIP を保存する。

### 2.4 キャンセル

| 操作 | 結果 |
| --- | --- |
| `generating` 中に画面を離れる（プロジェクト一覧へ戻る・アンマウント） | 生成を中止し、途中 Blob を捨てる。エラー文は出さない |
| 共有シートを閉じる / 共有しない（`AbortError`） | エラー文を出さない。状態は `ready` のまま。完了アクションは残す |
| `ready` のまま別操作（描画など） | ZIP は保持したまま。再タップで作り直すまで古い ZIP を使える |

生成中の「キャンセル」ボタンは置かない。

### 2.5 エラー

生成または保存準備が失敗したら状態を `failed` にし、ボタン付近に「書き出しに失敗しました」だけを出す。スタックトレース・英語の例外名・部分成功 ZIP は出さない。

共有シートの `AbortError` はエラーではない（§2.4）。

`failed` から「書き出し」を再タップしたらエラー文を消し `generating` に入る。

---

## 3. UI 配置と文言

### 3.1 配置

ワークスペースペイン（`#editor-workspace-pane`）右上。「配置」の隣に「書き出し」。同じ見た目。

現行 `WorkspaceLayoutMenu` は `.ms-workspaceLayoutMenu`（`position: absolute; top: 4px; right: 8px; z-index: 4; display: flex; flex-direction: column; align-items: flex-end`）に「配置」1 ボタンだけを置く。

実装は次で固定する。

1. 絶対配置の親を 1 つにする（クラス名は `ms-workspacePaneActions`）。位置・z-index・右揃えは現行 `.ms-workspaceLayoutMenu` と同一
2. その内側の最上段を横並び（`flex-direction: row; gap: 4px; align-items: center`）にする。パネルが開いたときに「書き出し」が縦中央へ落ちないよう、行の `align-items` は `flex-start` でもよい（ボタン同士の見た目は揃える）
3. 左が「配置」、右が「書き出し」（右端が書き出し、その左が配置）
4. 「配置」のドロップダウン（`.ms-workspaceLayoutPanel`）は従来どおりボタン行の下、右揃え
5. 進捗・完了アクション・エラーはボタン行の下、右揃え。**書き出し開始時および `ready` 表示中は配置パネルを閉じ、開かない。** 状態 UI は配置パネルと重ならない

「配置」は見た目レイアウト（`pagesPerColumn` 等）であり、書き出しの読み順ではない。読み順は `EditorDocument.workspaceOrder` のみ。

`.ms-workspaceLayoutMenu` 周辺の既存スタイル（パネル幅・スライダー・チェック）は壊さない。絶対配置だけ親へ移す。

### 3.2 ボタン見た目

「書き出し」は「配置」と同じ `styles.iconButton`（`.ms-iconButton`）。`min-width` / `min-height` 44px、`font-size: 12px`。`aria-label` は「書き出し」。

`generating` 中は `disabled`（`.ms-iconButton:disabled` の既存 opacity）。トグル用の `.ms-iconButtonActive` は書き出しには使わない。

完了アクション 2 ボタンも同じ `.ms-iconButton`。

### 3.3 文言（一字一句）

| 場所 | 文言 |
| --- | --- |
| 段階 1 ボタン | 書き出し |
| 進捗 | `{N}/{M} ページ…` （三点リーダは U+2026。例: `3/12 ページ…`） |
| 共有 | "ファイル"に保存 （U+0022 のストレートダブルクォート） |
| ダウンロード | ダウンロード |
| 失敗 | 書き出しに失敗しました |

進捗の `N` / `M` は半角数字。空白は `ページ` の前に 1 つだけ。

共有非対応でダウンロードのみのときは「"ファイル"に保存」を DOM に載せない。

---

## 4. 対象データと除外

開始時点の `history.present`（型 `EditorDocument`）を `cloneEditorDocument` したスナップショットが唯一のドキュメント入力である。インク画素は §6.4 の PNG コピー群が唯一の入力である。

### 4.1 含める

| 項目 | ソース |
| --- | --- |
| ページ集合と順 | スナップショットの `workspaceOrder: PageId[]` の先頭が 001 |
| ページ画像サイズ | スナップショットの `rasterWidth` / `rasterHeight`（現行製品の既定 1200×1700。ドキュメント値を使う。画面フレーム 216×306 には合わせない） |
| ページテキスト | 各 `pages[pageId].texts: PageText[]` |
| インク | そのページの `rasterId` に対する、encode 完了後にコピーした `captureRasterPng`（透明 PNG、テキストなし、テンプレなし） |
| ワークスペース名 | `present.name`（空なら表示上は「無題」。サニタイズは §5.3） |

### 4.2 含めない

- `stock` 上のページ
- `trash` 上のページ
- `pasteboardTexts`（ページ未所属）
- `pasteboardClips`
- PDF ペインの表示
- ページ番号帯（ページ下の UI 番号）
- 選択枠・削除/挿入クロム・テキストのリサイズハンドル
- 見開き仕切り・余白スロット・`+` 追加ボタン
- `textLiveTransforms` / `liveTextContent`（ドラッグ中・編集バー未確定）
- 未ベイクのペン overlay
- スナップショット後・PNG コピー後に描かれた線

`workspaceOrder` に含まれるページは、インクもテキストも無い完全な白紙でも PNG と `text.txt` 見出しの両方を出す。

`pages[pageId]` が欠ける（不変条件違反）場合は書き出し全体を `failed` にする。欠ページを飛ばして続行しない。

---

## 5. ファイル構成・命名規則

### 5.1 ZIP の外側と内側

デバイスローカル時刻でスタンプ `TS = YYYYMMDD-HHmm` を 1 回だけ取る（ZIP 名とフォルダ名で同一）。秒は付けない。

```
{stem}_{TS}.zip
└─ {stem}_{TS}/
   ├─ 001.png
   ├─ 002.png
   ├─ …
   └─ text.txt
```

- `{stem}_{TS}` はサニタイズ済みワークスペース名 + `_` + スタンプ
- PNG は配置順、1 始まり、最低 3 桁ゼロ埋め（`String(n).padStart(3, '0')`）。1000 ページ目は `1000.png`（4 桁のまま）
- `text.txt` は ZIP 内フォルダの直下に 1 つ。ページ数 0 でもこのファイルは置く
- エントリ名は UTF-8（ZIP の language encoding flag / bit 11）。日本語ワークスペース名をそのままフォルダ名に使ってよい（§5.3 で置換されない限り）

ZIP 中央ディレクトリにフォルダエントリを別途作る必要はない。エントリ名が `{stem}_{TS}/001.png` のように `/` を含めば展開時にフォルダになる。

### 5.2 時刻

`Date` のローカルゲッタのみ使う（`getUTC*` 禁止）。

```
YYYY = String(d.getFullYear())          // 4 桁以上ならそのまま
MM   = String(d.getMonth() + 1).padStart(2, '0')
DD   = String(d.getDate()).padStart(2, '0')
HH   = String(d.getHours()).padStart(2, '0')   // 0–23
mm   = String(d.getMinutes()).padStart(2, '0')
TS   = `${YYYY}${MM}${DD}-${HH}${mm}`
```

同一分内の再書き出しは同名になり得る。アプリは連番を付けない。同名時の上書き・リネームは OS / Files / 共有シート任せであり、アプリは上書きの有無を保証しない。

### 5.3 ワークスペース名のサニタイズ

入力は `present.name`。`trim` 後に長さ 0 なら `無題` を使う。

その後、次を **コードポイント単位** で `_`（U+005F）に置換する。

| 対象 | 判定 |
| --- | --- |
| パス区切り | U+002F `/` 、U+005C `\` |
| Windows / Files で問題になる記号 | U+003A `:` 、U+002A `*` 、U+003F `?` 、U+0022 `"` 、U+003C `<` 、U+003E `>` 、U+007C `\|` |
| C0 制御文字と DEL | U+0000–U+001F、U+007F |
| その他の Cc | Unicode カテゴリ Cc（上記以外に含まれていれば同様） |

置換しないもの: 空白（U+0020）、日本語、NFC 済みの結合文字、`.`（中間）、`-`、`_`。

追加規則:

1. 先頭の `.` は `_` に置換する（隠しファイル化を防ぐ）。2 文字目以降の `.` は残す
2. 末尾のスペースと `.` は削除する（Windows 展開時の破損回避）。削除後に空なら `無題`
3. 置換後に空なら `無題`
4. UTF-16 コードユニット長が 80 を超える場合は先頭 80 ユニットに切る。切った末尾が孤立サロゲートならその 1 ユニットを捨てる
5. 切り詰め後に空、または末尾 `.` / スペースになったら再び 2 を適用し、空なら `無題`

この結果が `{stem}`。ZIP ファイル名は `{stem}_{TS}.zip`。内側フォルダ名は `{stem}_{TS}`（拡張子なし）。

`#` `%` `&` `+` は置換しない。

---

## 6. ページ画像合成パイプライン

出力は不透明 PNG。画素サイズはスナップショットの `rasterWidth` × `rasterHeight`。縮小・余白・レターボックス禁止。サムネ用 `generateThumb`（144×204）は使わない。画面フレーム 216×306 にも合わせない。

画面の層（`docs/web-implementation-spec.md` §9.1 および `WorkspaceStrip.tsx` / `.ms-pageFrame`）に合わせる。UI クロムは載せない。

### 6.1 キャンバス

1. `OffscreenCanvas(rasterWidth, rasterHeight)` を使う。無ければ同じサイズの `HTMLCanvasElement`
2. `getContext('2d')` が null なら書き出し全体を `failed`
3. `imageSmoothingEnabled = true`、`imageSmoothingQuality = 'high'`（テンプレ JPEG の引き伸ばし用）
4. 合成キャンバスは **1 枚を使い回す**。全ページ分の画素バッファを同時に持たない。ページ完了後はインク用 `ImageBitmap` 等を `close()` できるなら閉じる。ZIP 入力として残すのは各ページの PNG バイトだけ
5. 最終 PNG:
   - `OffscreenCanvas` → `convertToBlob({ type: 'image/png' })`
   - `HTMLCanvasElement` → `toBlob(..., 'image/png')` を Promise 化する
   - どちらも Blob が null、reject、空（`size === 0`）なら書き出し全体 `failed`
6. `toDataURL` 禁止

### 6.2 層の順（下から）

画面 DOM（`.ms-pageFrame`）は `background-color: #fff` + `background-image: /page_template.jpg`（stretch）→ `.ms-templateCover`（z-index 自動、インクより下）→ インク（`.ms-pageInkPlane` z-index 1）→ テキスト（`.ms-pageTextWrap` z-index 2）。書き出しの塗り順は次で、この視覚順に一致させる。

| 順 | 操作 | 詳細 |
| --- | --- | --- |
| 1 | 白で全面塗り | `fillStyle = '#FFFFFF'`（`.ms-pageFrame` の `background-color: #fff` と同じ）。`clearRect` だけの透明キャンバスで始めない |
| 2 | 原稿用紙 | `/page_template.jpg` を `drawImage(img, 0, 0, rasterWidth, rasterHeight)`。ソースは 1518×2150。ランタイム URL はこれだけ（`sample/page_template.jpg` を fetch しない） |
| 3 | 焼き込み「1」隠し | `TEMPLATE_PAGE_NUMBER_COVER = { x: 0.42, y: 0.93, width: 0.16, height: 0.055 }`（`src/domain/types.ts` の定数。ページ正規化座標）。`fillStyle = '#FFFFFF'` で `fillRect(x * W, y * H, width * W, height * H)`。画面の `.ms-templateCover` と同じ |
| 4 | インク | デコードしたインクビットマップを `drawImage(..., 0, 0, W, H)`。ソースが既に W×H でも明示サイズで描く。白紙（インクバイト長 0）はこの層を省略する |
| 5 | テキスト | `drawPageTextsOnThumb(ctx, texts, rasterWidth, rasterHeight, rasterWidth, rasterHeight)`。`dest` = 原寸なので `scaleX`/`scaleY` は 1。`fontSize` はラスタ座標のまま |

枠線ガイドはテンプレ JPEG に含まれる。別途 stroke しない。ページ枠の `box-shadow` インセットは UI なので描かない。

### 6.3 テンプレ読み込み

書き出し 1 回につき画像は 1 回だけ読む。`HTMLImageElement` または `createImageBitmap`。`img.src = '/page_template.jpg'`（same-origin）。

`complete && naturalWidth > 0` になるまで待つ。エラー（`error` イベント、decode 失敗、`naturalWidth === 0`）は書き出し全体 `failed`。枠線なしで続行しない。

コントローラの `templateImageRef` に既にデコード済みがあればそれを使ってよい。未ロードなら書き出し側で待つ。

### 6.4 インク取得とエンコード待ち

対象はスナップショット各ページの `page.rasterId`。

`InkEngine.setCallbacks` は **呼ばない**。`wireInkAutosave` のコールバックを上書きしてはならない。encode 待ちは `isEncoding` の poll のみ。`onEncodingComplete` の購読も追加しない。`restartEncode` は書き出しから呼ばない。

手順（全ページ合成ループの前に一度だけ）:

1. `InkEngine.flushPendingEncodes()` を 1 回呼ぶ。ベイク済みでエンコード未開始の分を起こす
2. 対象 `rasterId`（重複は 1 回）について、`isEncoding(rasterId)` が true なら false になるまで待つ。待ち方は **50ms 間隔の poll のみ**。1 raster あたり上限 **15 000ms**。15 秒はエラー確定の上限であり、タイムアウトしたら待たずに書き出し全体を `failed` にする
3. 全対象の encode 待ちが終わってから、各 `rasterId` に `captureRasterPng(rasterId)` を呼び **戻りをコピーして保持する**（`encodedPng` を直接 zip に入れない。エンジン内部バッファへの参照を持たない）。これ以降の合成はこのコピー群だけを見る
4. 各コピーを次で判定する。1 件でも失敗条件に当たれば書き出し全体 `failed`。欠ページ・欠インクのまま成功 ZIP を出さない

| コピーの状態 | 結果 |
| --- | --- |
| `undefined`（未登録 raster） | 全体 `failed` |
| 非空かつ `isPngBuffer` が false（不正 PNG） | 全体 `failed` |
| 非空かつ PNG シグネチャは正しいがデコード失敗 | 全体 `failed` |
| `byteLength === 0`（登録済み・インク未描画） | 失敗ではない。層 4 を省略し、白 + テンプレ + カバー + テキストでそのページを出す（白紙） |
| 非空かつ `isPngBuffer` が true | デコードして層 4 に描く。デコード後は `ImageBitmap.close()` できるなら閉じる |

encode の Promise が reject されたあとは `isEncoding` が false になる。その結果コピーが未登録・不正・デコード不能なら上表どおり全体失敗する。poll 以外で reject を購読しない。

ホットキャンバスを書き出し合成のソースにしない。正はエンコード済み PNG のコピー。

ライブ overlay はベイクされていないため ZIP に入らない。pointerup 前のストロークは対象外。

### 6.5 テキスト焼き込み

`src/web/ink/drawPageTextsOnThumb.ts` を再利用する。新規の縦書き実装を書かない。サムネと同じ関数を正とする。

- 渡す配列は `page.texts` の **作成順（配列順）**。txt 用の位置ソートは画像には使わない（画面の重なり = 作成順）
- 空本文（`isTextContentEmpty`）は同関数が描かない
- クリップ・`sans-serif`・行送り 1.2 は同関数の実装に従う

**既知の差（ピクセル一致は要求しない）:** 画面上の本文は DOM の `writing-mode: vertical-rl` と CSS フォントで描く。書き出し PNG はサムネと同じくグリフ単位の `fillText`（`drawPageTextsOnThumb`）で焼く。カーニング、約物の向き、行送り、フォントメトリクス、折り返しは DOM と一致しない。固定コーパスに対して同関数が例外なく描けることをユニットテストする。キャンバスと画面 DOM のピクセル完全一致テストは書かない。

### 6.6 合成 PNG の失敗

`convertToBlob` / `toBlob` の reject、null Blob、空 Blob、コンテキスト喪失は書き出し全体 `failed`。途中まで作った PNG は捨てる。

---

## 7. テキスト連結規則

出力は UTF-8（BOM なし）、改行は LF（U+000A）のみ。CRLF 禁止。

### 7.1 ページブロック

`workspaceOrder` の各ページをブロックにする。ページ間は空行 1 つ（LF が 2 つ連続 = 空行 1 つ）。pasteboard のテキストは出さない。

```
blocks.join('\n\n') + '\n'
```

最後のブロックの後に LF を 1 つ付ける（POSIX 末尾改行）。最終ページの後に空行は付けない（`join('\n\n')` がページ間だけ空行を作る）。

見出しは常に出す。テキストが 0 件でも見出しだけのブロックにする。空ページも見出しを出す。

```
=== ${pad3(index)} ===
```

- `index` は 1 始まりの配置順
- `pad3` は PNG と同じ `padStart(3, '0')`
- `===` の前後にスペース 1 つ（`=== 001 ===`）

0 ページのときは `text.txt` を 0 バイト（空文字列、末尾 LF も無し）にする。

### 7.2 ページ内の行

1. `page.texts` を §7.3 でソートする（安定ソート）
2. 各要素について `isTextContentEmpty(content)` なら行を出さない（空枠は txt に出ない。見出しは出る）
3. 残った本文は **1 テキスト = 1 行**
4. **content 内の改行は空白化する。** 本文中の U+000D / U+000A は、CRLF を先に 1 スペースへ、残り単独 CR/LF も 1 スペースへ置換する。連続スペースは畳まない。`trim` しない（空判定の trim とは別）

例（ユーザー合意）:

```
=== 001 ===
セリフ1
セリフ2

=== 002 ===

=== 003 ===
セリフ3
```

### 7.3 位置ソート（縦書き読み順）

「ほぼ同じ」のための閾値は設けない。右端の数値をそのまま比較する。浮動小数で右端が 0.001px 違えば別カラムとして扱う。

比較キー（ページローカル `box: Rect`）:

1. **第一キー** `right = box.x + box.width` の **降順**（右端が右にあるものが先）
2. **第二キー** `box.y` の **昇順**（上が先。第一キーが厳密等価のときだけ）
3. **第三キー** 元配列 `page.texts` の添字昇順（`right` も `y` も等価のとき。安定ソート）

比較関数（戻り値が負なら `a` が先）:

```
function comparePageTextOrder(a, b, indexA, indexB): number {
  const rightA = a.box.x + a.box.width;
  const rightB = b.box.x + b.box.width;
  if (rightA !== rightB) return rightB - rightA;
  if (a.box.y !== b.box.y) return a.box.y - b.box.y;
  return indexA - indexB;
}
```

使わない値: `box.x`（左端）、中心 x、`box.height`、`id` の辞書順。

数値例（`rasterWidth` は不要。box だけ）:

| id | x | y | width | height | right | 順 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 900 | 100 | 80 | 400 | 980 | 1 |
| B | 700 | 50 | 80 | 400 | 780 | 2 |
| C | 700 | 500 | 80 | 200 | 780 | 3 |

A が右端最大。B と C は `right` が等しいので `y` が小さい B が先。

`width` が違い右端だけ等しい場合も第二キーは `y` のみ。

---

## 8. ZIP 生成

### 8.1 ライブラリ

`fflate` を `package.json` の `dependencies` に追加する（`devDependencies` ではない。本番バンドルに入る）。実装時点の 0.8 系最新でよい。`zip` / `zipSync` と `strToU8` を使う。ストリーミング ZIP は必須ではない。`jszip` 禁止。

メインスレッドで同期 zip してよい（`zipSync`）。ページ合成の `await` の後、zip は 1 回。Worker 必須にしない。

### 8.2 エントリと圧縮

`zipSync` に渡すオブジェクトのキーは ZIP 内パス（`/` 区切り、UTF-8）。

| エントリ | バイト列 | fflate オプション |
| --- | --- | --- |
| `{stem}_{TS}/{pad3}.png` | 合成 PNG の `Uint8Array` | `{ level: 0 }`（compression method 0 store。PNG を再圧縮しない） |
| `{stem}_{TS}/text.txt` | `strToU8(text, false)` | `{ level: 6 }` または省略（deflate 可） |

`level: 0` は無圧縮格納である。コメントだけで store にしたつもりにしない。

0 ページなら PNG エントリ無し、`text.txt` だけ（中身 0 バイト）。

### 8.3 出力

`zipSync` の戻り `Uint8Array` を `new Blob([bytes], { type: 'application/zip' })` にする。その Blob から

```
new File([blob], `${stem}_${TS}.zip`, { type: 'application/zip', lastModified: Date.now() })
```

を保持する。共有とダウンロードは同じ `File` を使う。

---

## 9. 保存

### 9.1 禁止

- `showSaveFilePicker` / `showDirectoryPicker`
- クライアントから `http://127.0.0.1` / `localhost` への `fetch` / XHR（書き出しログも含む）
- 生成完了コールバック内での自動 `navigator.share`

デバッグが必要なら `ipadDebugLog`（same-origin `/api/debug-log`）のみ。書き出しの正常系にログ必須ではない。

### 9.2 共有可能条件

「"ファイル"に保存」を出す条件（すべて満たす）:

1. `typeof navigator.share === 'function'`
2. `typeof navigator.canShare === 'function'`
3. `navigator.canShare({ files: [file] }) === true`（**実際の書き出し `File`** で判定。ダミー File で先に判定しない）

この判定が false なら共有ボタンを出さない。ダウンロードボタンは出す。

デスクトップ Chrome 等は `share` があっても files 非対応が多い。その場合はダウンロードのみ。

`share` に渡す辞書は `{ files: [file] }` のみ。`title` / `text` / `url` を付けない（iOS で files 共有が失敗する経路を避ける）。

### 9.3 共有の失敗

| 例外 | 扱い |
| --- | --- |
| `name === 'AbortError'` | 何も出さない。`ready` のまま |
| `NotAllowedError`（activation 切れ等） | `failed`。「書き出しに失敗しました」。保持 Blob は破棄してよい |
| その他 | 同上 `failed` |

### 9.4 ダウンロード

ユーザーが「ダウンロード」をタップしたとき（このタップが activation）:

1. `URL.createObjectURL(file)` または Blob
2. `document.createElement('a')`、`href`、`download = file.name`、`rel = 'noopener'`
3. `document.body` に追加して `click()`、直後に要素を除去
4. **download click に使った Object URL は 60 000ms 後まで `URL.revokeObjectURL` しない。** 即 revoke すると Safari が保存前に無効化することがある
5. 未使用の Object URL（download click に使っていないもの）だけ、破棄時に即 revoke する
6. 同じ Blob で共有とダウンロードを両方使う場合、revoke は download に使った URL について 60s 後

`ready` を捨てるとき（再書き出し・アンマウント）は、未使用 URL をすぐ revoke する。download click 済みの URL は 60s タイマーを残す（即 revoke しない）。

### 9.5 ダウンロード後の UI

ダウンロード click の成功はブラウザが返さない。エラーが無ければ `ready` のまま完了アクションを残す（共有を後から押せる）。

---

## 10. エッジケース

### 10.1 0 ページ

`workspaceOrder.length === 0` は正規状態（全ページをストックへ移したあと）。失敗にしない。§5 のフォルダ + 空 `text.txt` の ZIP を `ready` にする。進捗は出さない。

### 10.2 エンコード失敗・タイムアウト・不正バイト

次はいずれも書き出し全体 `failed`。テンプレだけの部分 ZIP を出さない。

- `isEncoding` 待ちが 15 000ms を超える
- 未登録 raster（`captureRasterPng` が `undefined`）
- 非空コピーが PNG でない / デコードできない
- 合成 `convertToBlob` / `toBlob` の失敗

登録済みで `byteLength === 0` の白紙だけは §6.4 どおり層 4 省略で続行する。

### 10.3 テンプレ読み込み失敗

全体 `failed`。白 + インクだけの ZIP を作らない。

### 10.4 共有 AbortError

§9.3。エラー文なし。

### 10.5 メモリとページ数上限

ページは順次。合成キャンバスは 1 枚。保持するのは各ページの PNG `Uint8Array` と最終 ZIP。中間の ImageBitmap はページ完了後に閉じる。

`workspaceOrder.length > 200` のときは生成を開始しない（§2.2）。200 ちょうどは開始してよい。

最低 QA の自動テスト観点は **20 ページ**（モック合成で 20 PNG + `text.txt` まで通ること）。実機の大部数は §16。

OOM や Quota で `convertToBlob` / `zipSync` が投げたら全体 `failed`。

fflate は `zip` / `zipSync` でよい。ストリーミング必須ではない。PNG エントリは `{ level: 0 }`。

### 10.6 長いワークスペース名

§5.3 の 80 UTF-16 ユニット。ZIP 全体名が極端に長くならないようにする。

### 10.7 同一分の再書き出し

同名になり得る。アプリは連番を付けない。同名時の上書きは OS 任せであり、アプリは保証しない。

### 10.8 テキスト編集中・ドラッグ中

スナップショットは `cloneEditorDocument(present)` のみ。編集バーの未確定文字列は入らない。ドラッグ中の座標はコミット済み `box`。

### 10.9 巨大テキスト・改行だらけ

1 行に畳む（content 内 CR/LF はスペース化、§7.2）。ZIP 内 txt のサイズ上限は設けない。

### 10.10 `captureRasterPng` が未登録 raster

`rasterId` がエンジンに無いのは不変条件違反に近い。その 1 ページだけインクなしで続行せず、書き出し全体を `failed` にする。`pages[pageId]` 自体が無いときも全体失敗（§4.2）。

### 10.11 アンマウント

`generating` / `ready` の未使用 Object URL と Blob 参照を捨てる。download click 済み URL は 60s 後まで revoke しない。進行中の `await` はフラグで以降の状態更新をしない。

---

## 11. iPad 制約

| 制約 | 仕様側の固定 |
| --- | --- |
| File System Access API 無し | picker 禁止。ZIP + 共有 / download |
| 共有の transient activation | 2 段階。生成後のボタンで `share` / download |
| `canShare({ files })` | 実 File で判定。非対応なら download のみ。共有ボタンを出さない |
| ループバックに届かない | クライアントから `127.0.0.1` / `localhost` へ POST しない。必要なら `ipadDebugLog` |
| オフライン | アセットは `/page_template.jpg`（SW キャッシュ対象）とメモリ上のインク |
| `a[download]` が Safari で別タブになることがある | 主経路は共有シート。download はフォールバック |
| ZIP ファイル名の日本語 | UTF-8 エントリ名。Files 展開は §16 の QA ゲート |

QA 対象は iPad。PC ブラウザは落ちないこと（download のみ）を保証する。Android / iPhone は非 QA。

---

## 12. 依存追加

| パッケージ | 場所 | 用途 |
| --- | --- | --- |
| `fflate` | `dependencies` | `zip` / `zipSync`。PNG は `level: 0`、txt は deflate 可 |

現行 `dependencies` は `next` / `react` / `react-dom` と rollup win32 のみ。書き出し用の他ライブラリは足さない。

`next.config.ts` の `serverExternalPackages` に `fflate` を足す必要は無い（クライアントのみ）。

---

## 13. テスト観点

Vitest。ブラウザ E2E は本仕様の必須ゲートにしない。純関数を厚く、InkEngine / share はモックする。

### 13.1 必須

| 対象 | 検証 |
| --- | --- |
| `comparePageTextOrder` | §7.3 の A/B/C 数値例。右端のみ違う、`right` 同点で y 違い、全同点で添字順 |
| サニタイズ | `/` `:` `*` 空文字、先頭 `.`、末尾 `.`、80 ユニット切り詰め、`無題` |
| `text.txt` | 空ページ見出し、ページ間空行 1、末尾 LF、空 content 省略、本文中改行のスペース化（CRLF / CR / LF）、0 ページが 0 バイト |
| ZIP | エントリパスが `{stem}_{TS}/001.png` 形式。PNG の compression method が 0。txt が UTF-8 BOM 無し |
| ZIP 日本語名 | ワークスペース名に日本語を含め、エントリパスが UTF-8 でその文字を含む |
| 進捗文字列 | `3/12 ページ…` の組み立て |
| ページ数上限 | 201 ページは開始拒否（orchestrator が throw / failed）。200 は拒否しない |
| encode 失敗 | `captureRasterPng` 未登録・不正 PNG・デコード失敗・15s タイムアウトをモックし、全体 failed（成功 ZIP 無し） |
| 20 ページ | モック合成で 20 PNG + `text.txt` まで通る |
| 共有分岐 | `canShare({ files: [実File] })` が false なら share ボタンを出さない（コンポーネントまたは純関数） |
| AbortError | エラー文を出さない |
| `drawPageTextsOnThumb` | 固定コーパスを例外なく描ける。ピクセル完全一致は不要。既存サムネテストを壊さない |

### 13.2 合成（可能なら）

書き出し用に dest=原寸で scale=1 になること。白 fill → カバー矩形がカバー定数どおり。テンプレ失敗で orchestrator が reject すること（画像 I/O はモック）。

### 13.3 やらない（本タスクの自動テスト）

実 iPad の Files 保存先 UI。実 `navigator.share` のシート操作。実 iPad での ZIP 展開。これらは §16 の QA ゲートであり、本実装タスクでは未検証のまま残す。

---

## 14. 実装ファイルの推奨配置

既存は機能ごとに `src/web/<feature>/`（`ink/`、`pdf/`、`clip/`、`stock/`、`gestures/`）と、ペイン直下の `WorkspaceLayoutMenu.tsx`。テストは隣の `__tests__/`。

ロジック（ソート、txt 連結、ファイル名、合成の純関数部分）は UI から分離し、Vitest で試す。

### 14.1 新規（推奨）

| パス | 責務 |
| --- | --- |
| `src/web/export/sanitizeExportName.ts` | `{stem}` とタイムスタンプ、ZIP / フォルダ名 |
| `src/web/export/sortPageTexts.ts` | `comparePageTextOrder` と安定ソート |
| `src/web/export/buildExportText.ts` | `text.txt` 文字列 |
| `src/web/export/composePagePng.ts` | 白 + テンプレ + カバー + インク + `drawPageTextsOnThumb`。キャンバス使い回し、`convertToBlob` / `toBlob` |
| `src/web/export/waitForInkEncode.ts` | `isEncoding` poll + 15s。`setCallbacks` 禁止。`flushPendingEncodes` はオーケストレータ側 |
| `src/web/export/buildWorkspaceZip.ts` | fflate `zipSync`、PNG `{ level: 0 }`、UTF-8 パス |
| `src/web/export/saveExportZip.ts` | `canShare`（実 File）、`share`、`<a download>`、revoke |
| `src/web/export/exportWorkspace.ts` | clone → encode 待ち → 全 PNG コピー → 順次合成 → File。UI 非依存 |
| `src/web/export/__tests__/*.test.ts` | 上記純関数 |
| `src/web/WorkspaceExportControls.tsx` | ボタン・進捗・完了アクション・エラー。`'use client'` |

`src/web/export/index.ts` で公開 API をまとめてよい。

### 14.2 既存の改修箇所

| パス | 内容 |
| --- | --- |
| `src/web/editorStyles.ts` / `src/web/editor.css` | `.ms-workspacePaneActions` とボタン行。`.ms-workspaceLayoutMenu` から absolute を親へ移す。既存パネル CSS は残す |
| `src/web/WorkspaceLayoutMenu.tsx` | 絶対配置を親に渡し、自身は「配置」+ パネルだけにする。書き出し開始 / ready 中はパネルを閉じる |
| `src/web/EditorLayout.tsx` | ペイン右上で `WorkspaceLayoutMenu` と `WorkspaceExportControls` を並べる。`inkEngine` を書き出しへ渡す |
| `src/web/useEditorController.ts` | 書き出しロジックはコントローラに直書きしない。`setCallbacks` を触らない |
| `package.json` | `fflate` |

`InkEngine.ts` に ZIP やテンプレ合成を足さない。`captureRasterPng` / `isEncoding` / `flushPendingEncodes` の公開面で足りる。公開面を壊さない。

`drawPageTextsOnThumb` のシグネチャ変更は禁止（サムネと共有）。

---

## 15. 実装時の非機能メモ（契約の一部）

- 書き出し開始時および `ready` 表示中は配置パネルを閉じる。配置ボタンは残るがパネルは開かない。状態 UI は配置と重ならない
- `generating` 中は書き出しボタンだけ disabled
- 生成は async。React の state 更新で進捗を出す。ページ間で `await`（必要なら微小 yield）し、UI が固まらないようにする
- `File.name` はサニタイズ済み `{stem}_{TS}.zip`。共有シートの保存名の正
- ページ画像の色空間はブラウザ既定の sRGB PNG。ICC を足さない

---

## 16. 実 iPad QA ゲート（本実装タスクでは未検証）

自動テストでは代替できない。リリース前に実 iPad（Safari / ホーム画面 PWA）で次を確認する。

1. 生成後の実 ZIP `File` に対し `navigator.canShare({ files: [file] })` が true であること
2. 「"ファイル"に保存」から共有シートが開き、「ファイル」アプリへ保存できること
3. 保存した ZIP を Files で展開できること
4. 展開後のフォルダ名・ファイル名が日本語ワークスペース名を含めて壊れていないこと（UTF-8）
5. `001.png` 以降と `text.txt` が揃っていること

本タスクの実装完了報告では上記を **未検証** と明記する。
