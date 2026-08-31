---
name: next-stale-webpack-cache
description: >-
  Clears MangaSketcher's stale Next.js webpack cache when the overlay or next
  dev fails with Cannot find module './124.js' (or any numbered chunk),
  webpack-runtime.js, pages/_document.js, or .next/server/app. Use after
  build:static, mixed .next vs .next-export, Fast Refresh chunk errors, or
  Runtime Error Require stack pointing at .next/server.
---

# Next の壊れた `.next` キャッシュ

`Cannot find module './124.js'` はアプリのバグではない。Cursor の Next overlay / `next dev` が **古い `.next`** を読み、欠けた webpack チャンクを require している。

静的書き出しは `distDir: '.next-export'`。overlay はデフォルトの `.next`。`build:static` のあと overlay を開くと毎回起きやすい。

## 症状

- `Cannot find module './N.js'`（番号は毎回違う）
- Require stack に `.next/server/webpack-runtime.js`、`.next/server/pages/_document.js`、`.next/server/app/.../page.js`
- このリポジトリに `pages/` は無い。`_document.js` は残骸

## エージェントがやること

1. **`.next` だけ削除する。** `.next-export`、`out/`、`node_modules`、`certs/` は消さない。

```powershell
if (Test-Path .next) { Remove-Item -Recurse -Force .next }
```

2. コードを「直して」チャンク名を追わない。`npm run build` も走らせない（iPad 向けは `build:static`）。
3. ユーザーへ: **開発プレビューを止めて開き直す。** iPad 確認なら overlay ではなく HTTPS **3443**（ホーム画面アイコン）。

## 予防

- iPad / PWA の確認に `next dev` や Cursor の Next プレビューを使わない。`manga-sketcher-static-build` に従う。
- `build:static` の直後に overlay で検証しない。必要なら先に `.next` を消す。
- 同じエラーが再発したら、また `.next` を消す。根本は overlay と export の distDir が別なこと。
