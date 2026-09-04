# LAN 作業データ転送 — 実装プラン（現行合意）

- 地位: 実装契約。曖昧語（適宜・将来・TBD）は欠陥とする
- 日付: 2026-09-05
- 関係: 画面向け書き出し（`docs/export-formats-spec.md`）は端末内完結のまま。本機能は **作品一覧からの複製転送** であり、書き出しパネルには出さない
- デバッグ: クライアントは `ipadDebugLog` のみ。`127.0.0.1` / `localhost` へ生 `fetch` しない（iPad からは届かない）
- この作業のために静的ビルド（`build:static` / `out/` 再生成）は走らせない。検証は既存 `out/` + `start:https-lan` と `dev:ipad`

---

## 1. 目的

同じ Wi-Fi 上の **PC と iPad** のあいだで、現行プロジェクトパック（`exportProjectPack` / `importProjectPack`）を **複製**して移す。クラウドも同一 id 上書きもやらない。

IndexedDB / OPFS はオリジン単位かつ端末単位なので、ポートが違うと別ストアである。転送はコピーであり、同期ではない。

## 2. 対象組み合わせ（これ以外は作らない・案内しない）

| # | PC | iPad | PC 側プロセス |
| --- | --- | --- | --- |
| 1 | 開発 `https://<host>:3000`（`dev:ipad`） | ホーム画面 PWA `https://<LAN>:3443` | **`dev:ipad` と `start:https-lan` を併走**（ハブは :3443 のみ） |
| 2 | 静的 `http://127.0.0.1:3001` | 同上 `:3443` | `start:https-lan` のみ（:3001 は `127.0.0.1` のみ） |

開発版同士の手動確認（PC と iPad の両方を `https://<LAN>:3000` で開く）は、ハブ用に `:3443` が動いていればロジック確認に使ってよい。ホーム画面 PWA と SW 経路の確認にはならない。製品案内には出さない。

## 3. 非目標

| やらない | 理由 |
| --- | --- |
| PC :3000 ↔ PC :3001 | 不要と確定 |
| iPad を :3001 で開く | :3001 はループバック専用。非セキュア LAN HTTP にしない |
| :3000 同士を製品機能として出す | 日常 iPad は :3443 PWA |
| クラウド / trycloudflare / `start:static:https` | オリジンが毎回変わる |
| WebRTC | シグナリングが結局 HTTP。既存パック資産ゼロ |
| 同一 project id 上書き・共同編集 | 現行 import は新 id。競合設計が無い |
| パック v2（参照 PDF バイト） | 現行 `stripPdfForPack` のまま。送り先で PDF を付け直す |
| undo・アプリ設定の転送 | 端末ローカル |
| Next `app/api` に転送 API | 静的 :3443 と別プロセス。ディスク共有が成立しない |
| エディタ書き出しパネル | 画面共有用形式選択と混ぜない |
| QR 生成・カメラスキャン | 6 桁手打ちで足りる |
| File System Access でフォルダ共有 | iPad Safari 非対応 |

## 4. データ契約

- 形式: 現行 `mangasketcher-project-pack`（`src/storage/projectPack.ts`）。ZIP 上限 **200MB**
- 受信: 必ず **新しい project id**（既存 `importProjectPack` / `rewriteImportedDocument`）
- 含める: ドキュメント JSON（ストック・ゴミ箱・ペーストボード含む）とページ／クリップ PNG
- 含めない: 参照 PDF（OPFS / IDB）、抽出テキスト、undo、アプリ設定
- 送信前: 既存 `requestExportCheckpoint` をスキップしない（同オリジンで開いているエディタのインク flush）
- 受信処理: 既存 `prepareImportedProjectOffThread` と import 進捗（`reading` / `unzip` / `normalize` / `saving`）

UI 注意文（一字一句）:

> 参照PDFは含まれません。送り先で付け直してください。相手の一覧には複製として追加されます。

## 5. ハブ

- 置き場: **`scripts/static-host/lan.mjs` のみ**。既存 `POST /api/debug-log` と同様、`proxyToServe` より前
- :3443 は `0.0.0.0`。:3001 は `127.0.0.1` のみ
- パック本体: リポジトリ直下 `.lan-transfer/`（**gitignore**）。`{code}.zip` とメタ。TTL 掃除（作成時・アクセス時・サーバ起動時）
- メモリに ZIP 全体を載せない。**ディスクへストリーム**。`Content-Length` が無い／200MB 超は **413**
- トークン一覧 API は作らない

### 5.1 人間が打つ号

- **数字 6 桁**（`000000`〜`999999`、先頭ゼロあり）。表示も入力も 6 桁固定
- 発行は受け側。サーバが未使用の号を割り当てる。衝突したら再抽選
- TTL **12 分**。成功 GET または期限でファイル削除。同一号の並行 PUT 禁止
- これが LAN 上の秘密である。家庭 Wi-Fi + 短 TTL 前提

### 5.2 HTTP（パスは必ず `/api/`。SW がバイパスする）

| メソッド | パス | 役割 |
| --- | --- | --- |
| `GET` または `HEAD` | `/api/lan-pack/health` | ハブ生存。CORS 付き |
| `OPTIONS` | `/api/lan-pack` および `/api/lan-pack/:code` | 許可 Origin のみ |
| `POST` | `/api/lan-pack` | 空ボディ。6 桁発行。メタをディスク |
| `PUT` | `/api/lan-pack/:code` | ZIP ストリーム。1 回。`application/zip` |
| `GET` | `/api/lan-pack/:code` | 未消費なら zip、消費して削除。無／期限切れは 404。`Cache-Control: no-store` |

`:code` は 6 桁数字のみ。それ以外は 404。

既存 `POST /api/debug-log` の CORS は変えない（同一オリジン想定のまま）。

### 5.3 CORS

リクエスト時に許可 Origin を計算する（起動スナップショット固定は禁止。NIC 増減に追従する）。

- `https://127.0.0.1:3000`
- `https://localhost:3000`
- 各 `https://<lanIPv4>:3000`（`lanIPv4s()` と同型。リンクローカル 169.254 除外）
- `http://127.0.0.1:3001`

`Access-Control-Allow-Origin` は一致した Origin をエコー。`*` 禁止。Cookie なし（`credentials` 不要）。

iPad → `:3443` は同一オリジンなので CORS 不要。

## 6. クライアントのハブ URL

| 今開いているページ | ハブ |
| --- | --- |
| `:3443` | 同一オリジン `/api/lan-pack…`。**127.0.0.1 へ fetch しない** |
| `:3000` | `https://${location.hostname}:3443` |
| `:3001` | 常に `https://127.0.0.1:3443` |

ハブ down（health 失敗）のとき、送る／受け取るの本処理に入る前に次を出す（一字一句）:

> LAN転送には PC で start:https-lan（ポート3443）が必要です。開発版とやり取りするときは dev:ipad も同時に起動してください。

## 7. UI（`ProjectList` のみ）

ヘッダ、「インポート」の隣。

| ボタン | 一字一句 |
| --- | --- |
| 送る | `LANで送る` |
| 受け取る | `LANで受け取る` |

カードメニューの「エクスポート」はファイル用のまま。`WorkspaceExportControls` には足さない。

### 7.1 受け取る

1. health。失敗なら §6 の文
2. `POST /api/lan-pack` → 6 桁を **大きく** 表示。残り時間を出す
3. 前面で `GET` をポーリング（間隔 1.5s）。裏タブでは iOS が fetch を絞るため、画面に次を出す（一字一句）:

> この画面を前面のままにしてください。

4. 200 で zip → 既存 import Worker → 一覧 refresh。号はサーバ側で消費済み
5. キャンセルは受け UI を閉じるだけ（サーバ TTL に任せる）。専用 DELETE は MVP で置かない

### 7.2 送る

1. health。失敗なら §6 の文
2. 作品を 1 つ選ぶ
3. 6 桁入力（数字のみ、6 文字で送信可）。カメラ・QR なし
4. `exportProjectPack`（checkpoint あり）→ `PUT` ストリーム／または Blob 1 本（クライアントは既存 export が File を返すので File をそのまま PUT してよい。サーバ側がストリーム受信する）
5. 成功: `送りました。受け側の一覧に複製が追加されます。`
6. 404: `号が違うか、期限切れです。受け側で受け取り直してください。`
7. 413: `サイズが上限（200MB）を超えています。`

参照 PDF の注意文（§4）は送る確認の直前に出す。

入力中のオリジンから相手オリジンへ **ナビゲートしない**。

## 8. Service Worker

`public/sw.js`: GET のみ、同一オリジンのみ介入。`/api/` はバイパス。パック GET をシェルキャッシュ経路に載せない（本プランのパスで満たす）。

`?lanReceive=` のディープリンクは **作らない**。

`next dev` では SW 未登録。PWA 経路の確認は iPad を `:3443` アイコンから開く。

## 9. 実装段階

1. `.gitignore` に `.lan-transfer/`。`lan.mjs` に health / 発行 / PUT ストリーム / GET 消費 / CORS / TTL
2. ハブ URL 解決と fetch の純関数（テストしやすく切り出す）
3. `ProjectList` に送る／受け取る（6 桁、health、進捗、エラー文）
4. 既存 pack / Worker / checkpoint 接続
5. 手動確認（静的ビルドは実行しない）

## 10. テスト

**自動**

- 許可 Origin 判定（複数 LAN、3001、不一致は拒否）
- ハブ URL 解決（3443 / 3000 hostname / 3001）
- 号が 6 桁以外なら 404
- TTL 切れ・二重 GET で 404
- 200MB 超 413

**手動（既存サーバ。`out/` を作り直さない）**

- 組み合わせ 1: PC :3000 ↔ iPad :3443 双方向。PC を `127.0.0.1:3000` と `LAN:3000` の両方
- 組み合わせ 2: PC :3001 ↔ iPad :3443 双方向
- :3443 停止時の §6 文言
- 受け側を裏に回して失敗することと前面案内
- 開発版同士（両方 :3000 + ハブ :3443）は任意のロジック確認

## 11. 実装時に守ること

1. 転送 API は `lan.mjs` のみ
2. 対象 2 組み合わせ以外を案内しない
3. 6 桁手打ちのみ。QR なし。iPad にループバック URL を出さない
4. パックは現行関数のみ
5. UI は ProjectList のみ
6. CORS は動的列挙、`*` 禁止
7. サーバはディスクへストリーム
8. デバッグは `ipadDebugLog`
9. 静的ビルドをこの作業で走らせない
10. 組み合わせ 1 のエラー文に `start:https-lan` と `dev:ipad` を含める
