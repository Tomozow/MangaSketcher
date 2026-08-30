---
name: manga-sketcher-static-build
description: >-
  Builds MangaSketcher static export to out/, (re)starts LAN HTTPS, and guides
  iPad certificate / ホーム画面に追加. Use when the user asks to 静的ビルド, build:static,
  rebuild for iPad, 証明書, プロファイル, 警告, ホーム画面, start:https-lan, or LAN HTTPS.
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
| ホーム画面に追加できない | trycloudflare は使わない。壊れた `public/icons`（数十バイト）は作り直す。iOS では SW を登録しない。`public/sw.js` は既存 SW を unregister する。古いホーム画面アイコンを消してから再追加するよう案内 | Safari。警告なしの https。既存アイコン削除 → 再読み込み → 数秒待つ → ホーム画面に追加 |

現在 IP は毎回 OS から取る。`192.168.0.2` は一例。Ethernet と Wi-Fi で IP が二つあるときは **どちらで開いているか** を案内し、証明書 SAN に両方入っているか確認する。

## 静的ビルド

```bash
npm run build:static
```

`scripts/build-static.mjs`: API route を退避 → `NEXT_OUTPUT=export next build` → `out/.nojekyll` と `out/precache-manifest.json` → API を戻す。失敗時も退避は戻す。所要約 15–40s。終了コード 0 を待つ。

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
- 追加の瞬間に SW がタブを奪うと失敗する。本番でも iOS の通常 Safari では SW を登録しない（`ServiceWorkerRegistrar`）

## やってはいけないこと

- `NEXT_OUTPUT=export` なしの `next build`
- 中断後に `app/api` が退避されたまま → もう一度 `build:static`
- trycloudflare でホーム画面追加
- `typecheck` を静的ビルドのゲートにする（`ignoreBuildErrors`）
- 既存の `certs/ca` を消して CA を新規発行する（案内なしにやらない）
