# CLIP .clip 実験ランナー (E0/E1/E2/E5)

Node + tsx で `sample/export_sample.clip` を読み、sql.js 往復・テキスト差し替え・ラスタ差し替え後に `sample/_experiments/` へ出力します。

## コマンド

| コマンド | 説明 |
|----------|------|
| `npm run clip:experiments` | E0 + E1 + E2 を実行 |
| `npm run clip:experiments:e0` | E0 のみ |
| `npm run clip:experiments:e1` | E1 のみ |
| `npm run clip:experiments:e2` | E2 のみ（TLV 同期パッチ） |
| `npm run clip:experiments:e5` | E5 のみ（線画ラスタ差し替え） |
| `npm run clip:experiments:e6` | E6 のみ（テキストレイヤー削除・クローン生成） |
| `npm run clip:experiments:e6v2` | E6_v2（複数行 bbox 修正版 + 3 行外挿検証） |
| `python tools/clip-experiments/validate.py` | 出力 `.clip` の Python 交差検証 |
| `python tools/clip-experiments/validate_tlv.py` | E2 TLV BLOB の機械検証 |
| `python tools/clip-experiments/validate_raster.py` | E5 ラスタの ClipMerger 交差検証 |
| `python tools/clip-experiments/validate_integrity.py` | 参照グラフ・採番・兄弟チェーンの整合性検証 |

## 依存

- `sql.js` — SQLite 編集・`export()`
- `tsx` — TypeScript を Node で直接実行
- `fflate` — zlib 圧縮（`raster.ts`）

## 関連コード

- `src/web/export/clip/container.ts` — CSFCHUNK パース・再構築（ブラウザ互換）
- `src/web/export/clip/textTlv.ts` — テキストレイヤー TLV parse/serialize/patch
- `src/web/export/clip/raster.ts` — Offscreen タイル encode/decode・Attribute 再構築
- `src/web/export/clip/__tests__/container.test.ts` — parse→build バイト一致テスト
- `src/web/export/clip/__tests__/textTlv.test.ts` — TLV ラウンドトリップ・パッチテスト
- `src/web/export/clip/layerOps.ts` — テキストレイヤー削除・クローン・採番
- `src/web/export/clip/__tests__/layerOps.test.ts` — 削除・クローン API 単体テスト
- `src/web/export/clip/__tests__/raster.test.ts` — ラスタ encode/decode テスト

## E6 — テキストレイヤー削除・クローン

`npm run clip:experiments:e6` → `sample/_experiments/E6_clone.clip`

### CSP 5.0.1 での確認観点

1. **開封直後の表示** — 4 枚のテキスト（あいうえお / クローン一号 / 二行目もある長文テキスト / 大きい字）が正しい内容・位置・サイズで表示されるか
2. **削除確認** — 「こんにちは さようなら」「てすと…」レイヤーが消えているか
3. **編集** — 各テキストの文字列・位置・サイズの再編集が正常か
4. **レイヤー追加** — CSP 上で新規テキスト追加が問題ないか
5. **別名保存→再オープン** — 保存後も表示が維持されるか

### 機械検証

```bash
python tools/clip-experiments/validate_integrity.py
python tools/clip-experiments/validate.py sample/_experiments/E6_clone.clip
python tools/clip-experiments/validate_tlv.py sample/_experiments/E6_clone.clip
```

## E6_v2 — 複数行 bbox 修正

`npm run clip:experiments:e6v2` → `sample/_experiments/E6_v2.clip`

E6_clone で 2 行テキストの 1 行目が欠落した問題を修正。列間ピッチ 57px（glyph 列幅 33px とは別）で bbox 幅を計算。

### CSP 5.0.1 での確認観点

1. **開封直後に 5 枚すべて全行表示** — あいうえお / クローン一号 / 二行目も＋ある長文テキスト（2 行） / 大きい字 / 一行目・二行目・三行目（3 行外挿）
2. **複数行レイヤー** — 各列（行）の文字が欠けず、位置・サイズが正しいか
3. **編集・別名保存→再オープン** — 保存後も全行維持されるか

### 機械検証

```bash
python tools/clip-experiments/validate_integrity.py sample/_experiments/E6_v2.clip
python tools/clip-experiments/validate.py sample/_experiments/E6_v2.clip
python tools/clip-experiments/validate_tlv.py sample/_experiments/E6_v2.clip
```
