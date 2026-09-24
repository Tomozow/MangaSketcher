# MangaSketcher

iPad 向けのマンガネーム編集アプリ（Next.js + TypeScript）。

iPhone / Android 対応は後回しにし、**iPad の画面サイズと操作性**を優先しています。保存は端末内の IndexedDB / OPFS のみです。

## 対象環境

- iPadOS 17 以降の Safari（Apple Pencil）
- 日常利用: Safari の「ホーム画面に追加」（PWA）。App Store には出しません
- 開発: Node.js 20 以上

日常の起動はリポジトリ直下の `launcher.bat`（ログと `out` / `out-backup` の切替はアプリ内）。従来の `start-dev.bat` / `start-https-lan.bat` / `start-static.bat` / `build-static.bat` も使えます。

## 画面構成

`アプリレイアウト.jpg` のワイヤーに沿った 1 画面シェルです。

| 領域 | 役割 |
| --- | --- |
| ツールパレット & プロパティ | 編集ツールと選択中オブジェクトの設定 |
| ネームストック | ネーム／ストック一覧 |
| ワークスペース | 作業中スロット |
| PDF | 参照 PDF |

## 出張先・PC なしで使う

プロジェクトデータは iPad 上に残ります。必要なのは **一度 HTTPS（または iPad 自身の localhost）で開いてホーム画面に追加する** ことです。以後はオフラインでもシェルが Service Worker から起きます。

1. 静的ファイルを用意する（PC があるとき一度だけ）:

```bash
npm install
npm run build:static
```

2. `out/` を HTTPS で公開する。手元の LAN 配信はサイトルートに置く。GitHub Pages は `.github/workflows/pages.yml` が `out/` を載せる。プロジェクトサイト（`https://<user>.github.io/<repo>/`）ではビルド時に `NEXT_PUBLIC_BASE_PATH` が付く。`*.github.io` リポジトリはルートのまま。`out/.nojekyll` も書き出します。
3. iPad の Safari でその URL を開く → 共有 → **ホーム画面に追加**
4. 追加したアイコンから起動して作業する。Wi-Fi がなくても、一覧と開いたことのあるエディタ画面は動きます

PC がある場で HTTPS を試す（証明書のインストール不要）:

```bash
npm run build:static
npm run start:static
```

別ターミナルで:

```bash
npm run start:static:https
```

表示された `https://….trycloudflare.com` を iPad の Safari で開き、共有 → ホーム画面に追加します。PC と iPad は同じ Wi-Fi である必要はありませんが、トンネル中は PC の電源とネットが必要です。ホーム画面に入れたあとは、オフラインでもシェルは端末内に残ります。

開発中の `http://<PCのLAN IP>:3000` はセキュアコンテキストではないため、OPFS と Service Worker が使えません。

## 開発

```bash
npm install
npm run dev
```

同じ Wi-Fi の iPad Safari から `http://<PCのIPv4>:3000` を開きます。Windows ファイアウォールで 3000/tcp の受信を許可してください。

型チェックとテスト:

```bash
npm run typecheck
npm test
```

Node サーバーとして配信する場合:

```bash
npm run build
npm start
```

## GitHub

`main` を既定ブランチとして使います。Issue / PR テンプレートは `.github/` にあります。

秘密情報は `.env` に置き、リポジトリへコミットしないでください（`.env.example` を雛形にします）。
