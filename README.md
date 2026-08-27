# MangaSketcher

iPad 向けのマンガ制作支援アプリ（Expo + TypeScript）。

iPhone / Android 対応は後回しにし、**iPad の画面サイズと操作性**を優先しています。

## 対象環境

- iPad（タブレット専用: `ios.isTabletOnly`）
- 開発: Node.js 20 以上、**Expo SDK 54**（App Store の Expo Go 向け）

## 画面構成

`アプリレイアウト.jpg` のワイヤーに沿った 1 画面シェルです。

| 領域 | 役割 |
| --- | --- |
| ツールパレット & プロパティ | 編集ツールと選択中オブジェクトの設定 |
| ネームストック | ネーム／ストック一覧 |
| ワークスペース | 作業中スロット |
| PDF | 参照 PDF（いまはプレースホルダ） |

## 開発

```bash
npm install
npm start
```

iPad の Expo Go では、ターミナルの QR が崩れて読めないことがあります。その場合は **Expo Go 内で URL を入力**します。

- Tunnel（`npm start`）: `exp://....exp.direct:80` のような行
- LAN（`npm run start:lan`）: `exp://192.168.x.x:8081`

同じ Wi-Fi でも **リクエストがタイムアウト** する場合は、PC と iPad の間で LAN が通っていません。`npm start` は Tunnel（インターネット経由）です。

Windows では `@expo/ngrok` の `ngrok.exe` が欠けると、次のエラーになります。

`The "file" argument must be of type string. Received null`

このリポジトリでは `ngrok.exe` を開発依存として入れるようにしてあります。欠けている場合は `npm install` 後に `node_modules/@expo/ngrok-bin-win32-x64/ngrok.exe` があるか確認してください。

同じ LAN だけで試す場合:

```bash
npm run start:lan
```

iPad シミュレータ（Mac のみ）:

```bash
npm run ios
```

型チェック:

```bash
npm run typecheck
```

## GitHub

`main` を既定ブランチとして使います。Issue / PR テンプレートは `.github/` にあります。

秘密情報は `.env` に置き、リポジトリへコミットしないでください（`.env.example` を雛形にします）。
