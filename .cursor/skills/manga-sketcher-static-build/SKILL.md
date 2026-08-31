---
name: manga-sketcher-static-build
description: >-
  Builds MangaSketcher static export to out/, (re)starts LAN HTTPS, and guides
  iPad certificate / ホーム画面に追加 / オフライン PWA. Use when the user asks to 静的ビルド,
  build:static, rebuild for iPad, 証明書, プロファイル, 警告, ホーム画面, オフライン, Service Worker,
  start:https-lan, or LAN HTTPS.
---

# MangaSketcher 静的ビルドと iPad HTTPS

Do **not** run `npm run build`. iPad 向けは静的書き出し + LAN HTTPS。

## いつ何をやり直すか

| 状況 | エージェントがやること | ユーザーへの案内 |
| --- | --- | --- |
| UI やコードを変えた | `npm run build:static`。`out/` を配信中ならサーバー再起動は不要。Safari に再読み込みを頼む | 開いている URL を再読み込み |
| 3002 / 3443 が落ちている | `npm run start:https-lan`（既存 CA を使い、リーフだけ作り直す） | 下の URL で開き直す |
| 「証明書が無効」「この接続はプライベートではない」 | 現在の RFC1918 IPv4（`169.254` 除外）を確認。SAN に無い IP なら `start:https-lan` でリーフを再発行。**CA（`certs/ca/rootCA.pem`）は消さない・作り直さない** | アドレスが証明書の IP と一致しているか。信頼設定で **mkcert** がオンか |
| プロファイルを消した / 入れ直したい | 3002 が生きていればサーバーはそのまま | `http://<PCのIPv4>:3002/` の「プロファイルをダウンロード」 |
| ホーム画面に追加できない | trycloudflare は使わない。壊れた `public/icons`（数十バイト）は作り直す。iOS の **Safari タブ**では SW を登録しない。古いホーム画面アイコンを消してから再追加するよう案内 | Safari。警告なしの https。既存アイコン削除 → 再読み込み → 数秒待つ → ホーム画面に追加 |
| ホーム画面にあってもオフラインで使えない | SW が Safari タブでは未登録なのは正常。standalone で登録しシェルを precache する実装になっているか確認（下の「オフライン PWA」）。コードを直したら `build:static` | 下のオフライン手順。入れ直しは不要。PC 配信中に **アイコンから** 一度開く |

現在 IP は毎回 OS から取る。`192.168.0.2` は一例。Ethernet と Wi-Fi で IP が二つあるときは **どちらで開いているか** を案内し、証明書 SAN に両方入っているか確認する。

## 静的ビルド

```bash
npm run build:static
```

`scripts/build-static.mjs`: API route を退避 → `NEXT_OUTPUT=export next build`（`distDir` は `.next-export`。dev の `.next` は消さない）→ `out/.nojekyll` と `out/precache-manifest.json` → API を戻す。失敗時も退避は戻す。所要約 15–40s。終了コード 0 を待つ。

`build:static` のあと Cursor の Next overlay / `next dev` で開くと `.next` が欠けたチャンクを指し、`Cannot find module './124.js'` になる。そのときは `next-stale-webpack-cache`。overlay で静的結果を検証しない。

## LAN HTTPS の起動

```bash
npm run start:https-lan
```

`scripts/start-https-lan.mjs`:

- CA ページ HTTP **3002**（`certs/public/`。プロファイル `.mobileconfig`）
- アプリ HTTPS **3443**（`serve out` + `certs/lan.pem`）
- HTTP アプリ（PWA 不可）は `npm run start:static` の **3001**

ポートが既に Listen なら、止めてから上げ直す（古い `serve` が残っていることが多い）。

CA があるときは `mkcert -install` しない。リーフは `lanIPv4s()` の全 IP + localhost。iPad が信頼しているのは **mkcert ルート**。新しい CA を切るとプロファイル入れ直しになる。

## ユーザー案内（そのまま使う）

**プロファイル再インストール**

1. Safari で `http://<PCのIPv4>:3002/`（Chrome 不可）
2. 「プロファイルをダウンロード」
3. 設定 → プロファイルがダウンロード済み → インストール
4. 設定 → 一般 → 情報 → **証明書信頼設定** → **mkcert** で始まる項目をオン（名前は MangaSketcher ではない）
5. Safari で `https://<同じIPv4>:3443/`（警告が出ないこと）
6. 警告が消えたあと、ホーム画面アイコンを消して入れ直す

**ホーム画面に追加**

- Safari の共有 →「ホーム画面に追加」。Dock に追加ではない
- `*.trycloudflare.com` では「エラーが出たためホーム画面に追加できませんでした」になる。使わない
- 追加の瞬間に SW がタブを奪うと失敗する。本番でも iOS の通常 Safari では SW を登録しない

**オフライン（ホーム画面追加済み）**

1. PC で HTTPS（3443）が動いていることを確認する
2. Safari タブではなく、**ホーム画面のアイコン**から開く
3. 一覧が出るまで数秒待つ（シェルの precache）。ステータスが「最新です」になればシェルは端末にある
4. 以後は PC 電源オフでも、Wi-Fi だけ生きてサーバーが落ちていても、起動時の短い確認のあと端末内で動く。プロジェクトデータは IndexedDB / OPFS（SW は触らない）

Safari のタブから開いたままではネットが要る。これは仕様。すでにホーム画面にあるなら入れ直しは不要。

## オフライン PWA（iPad）

ホーム画面に追加できても、SW が無いとシェル（HTML / JS / CSS / `page_template.jpg` / `pdf.worker.min.mjs`）は端末に残らない。PC やネットが切れると白いエラーになる。

| 起動経路 | SW | 理由 |
| --- | --- | --- |
| iOS Safari タブ | **登録しない** | `clients.claim` / インストール中のタブ奪取で「エラーが出たためホーム画面に追加できませんでした」になる |
| iOS ホーム画面（`display-mode: standalone` / `navigator.standalone`） | **登録する** | オフラインの唯一の経路。`precache-manifest.json` からシェルをキャッシュ |
| 開発（`next dev`） | 登録しない・既存は unregister | 古い SW が開発サーバーを壊す |
| 非 iOS の本番静的配信 | 登録する（1.5s 遅延） | デスクトップ確認用 |

実装の置き場:

- `src/web/ServiceWorkerRegistrar.tsx` — 上記の分岐。`readAppleTouchDevice() && !readStandaloneDisplay()` なら return（登録も解除もしない）
- `src/web/displayMode.ts` — standalone / iPad 判定
- `public/sw.js` — `mangasketcher-shell-v*` に precache。navigate / 静的とも cache-first。ネットワークはキャッシュミス時だけ、4s で打ち切る。`/sw.js`・`/precache-manifest.json`・`/api/` は横取りしない
- `src/web/shellUpdate.ts` — シェルが端末にあるとき、起動時だけ `/sw.js` を 2.5s でプローブ。届かなければ以降このセッションではサーバーに出ない。一覧にステータスを出す
- `scripts/build-static.mjs` が `out/precache-manifest.json` を書く。SW は install/activate でそれを読む
- `app/layout.tsx` に **全ページ unregister のインライン script を置かない**。standalone でも毎回 SW が死に、オフライン不能になる

やって失敗したパターン（戻すな）:

- iOS では **一切** SW を登録しない → 追加は成功するがオフライン不能
- `public/sw.js` が activate で `registration.unregister()` して caches を消す → 登録しても即自殺
- layout 先頭で `getRegistrations().unregister()` → standalone の SW も殺す

SW の中身を変えたらキャッシュ名 `mangasketcher-shell-v*` を上げる。コード変更後は `build:static`。配信中ならサーバー再起動は不要。iPad は **アイコンから** 開き直す（Safari 再読み込みだけでは standalone の SW が更新されないことがある）。すでにホーム画面にある端末は、**サーバー起動中にアイコンから一度開く**と新しい SW（cache-first）が入る。それが終わるまで、サーバー停止時の起動は古い network-first のまま長い待ちになる。

## やってはいけないこと

- `NEXT_OUTPUT=export` なしの `next build`
- 中断後に `app/api` が退避されたまま → もう一度 `build:static`
- trycloudflare でホーム画面追加
- `typecheck` を静的ビルドのゲートにする（`ignoreBuildErrors`）
- 既存の `certs/ca` を消して CA を新規発行する（案内なしにやらない）
- iOS 全体で SW を禁止してオフラインを捨てる。禁止なのは **Safari タブだけ**
- layout や `sw.js` で SW を常時 unregister する
- オフライン不能の案内で「ホーム画面に入れ直して」だけ言う。先に **アイコンからオンライン起動** を案内する
