# CLIP 書き出し実験 (E0/E1/E2/E5)

`sample/export_sample.clip` を基に、sql.js 往復・テキスト文字列差し替え・TLV 同期パッチ・線画ラスタ差し替えの実験出力です。Clip Studio Paint 5.0.1 での手動確認用です。

## ファイル一覧

| ファイル | 実験 | 内容 |
|----------|------|------|
| `E0_roundtrip.clip` | E0 | sql.js で SQLite を開き、データ変更なしで `export()` → コンテナ再構築 |
| `E1a_samelen.clip` | E1 | MainId=5 の `TextLayerString` を「かきくけこ」(5文字・同長) に変更（TLV 未更新） |
| `E1b_shorter.clip` | E1 | MainId=5 を「あい」(2文字・短縮) に変更（TLV 未更新） |
| `E1c_longer.clip` | E1 | MainId=5 を「あいうえおかきくけこ」(10文字・拡張) に変更（TLV 未更新） |
| `E2a_len_change_synced.clip` | E2 | 文字列を「かきくけこさしすせそ」(10文字) に変更し **TLV 完全同期** + 縦書き bbox 近似更新 |
| `E2b_moved.clip` | E2 | 文字列は「あいうえお」のまま、bbox を x−300px・y+400px 平行移動 |
| `E2c_fontsize.clip` | E2 | 文字列そのまま、フォント 8pt→16pt（id=32/13）、bbox を 2 倍に伸長 |
| `E2d_no_cache.clip` | E2 | 文字列「かきくけこ」+ 浮動キャッシュ（Offscreen 31）完全削除、id=50=0 |
| `E5_lineart_replaced.clip` | E5 | 線画レイヤー(MainId=8)の level0 Offscreen(48) 画素を合成テスト画像で差し替え |
| `E5_decoded_preview.png` | E5 | E5 線画 Exta の ClipMerger デコード PNG（Pillow がある場合） |
| `E0_report.json` / `E1_report.json` / `E2_report.json` / `E5_report.json` | — | 各実験の生成メタデータ |
| `validate_report.json` | — | Python 構造交差検証の結果 |
| `validate_tlv_report.json` | — | TLV パッチ後 BLOB の機械検証結果 |
| `validate_raster_report.json` | — | E5 ラスタ交差検証の結果 |

E1 では TLV を変更していません。E2 では `src/web/export/clip/textTlv.ts` で Attributes（full）と AddAttributes（compact）を同期パッチしています。E5 では `src/web/export/clip/raster.ts` でタイル再エンコードし、線画 Offscreen の CHNKExta ボディのみ差し替えています（サムネイル Offscreen 49 は意図的に未更新）。

## E5 — CSP 5.0.1 確認観点

| 確認項目 | 期待 |
|----------|------|
| **線画レイヤー表示** | 元の線画ではなく、**対角線 2 本 + 大きな円 + 半透明グレー矩形**の合成パターンが見える |
| **透明部** | パターン外の領域が透けて下のレイヤーが見える（アルファ保持） |
| **レイヤーサムネイル** | サムネイル Offscreen(49) は古いまま残しているため、CSP が自動更新するか観察 |
| **別名保存→再オープン** | 差し替え後の線画が維持されるか |

線画レイヤー = MainId=8、ミップ level0 = Offscreen MainId=48（1518×2150、grid 6×9）。下位ミップ(Offscreen 50〜54)は外部データ無しのままです。

## E2 — CSP 5.0.1 確認観点

| ファイル | 確認すること |
|----------|----------------|
| **E2a** | 10 文字「かきくけこさしすせそ」が正しく表示・編集できるか。レイヤーパネルで文字数不整合の警告が出ないか |
| **E2b** | テキストが**左下方向**（x−300, y+400）へ移動しているか。編集時のカーソル位置は妥当か |
| **E2c** | 文字が約 2 倍の大きさで表示されるか。bbox が拡大しているか |
| **E2d** | **テキストが表示されるか**（浮動キャッシュ無しで CSP が再描画するか）。最重要探針。クラッシュ・空白・サムネ欠損に注意 |

## CSP 5.0.1 手動確認手順

1. **開く** — 各 `.clip` を Clip Studio Paint 5.0.1 で開く。警告・エラーダイアログの有無を記録する。
2. **全レイヤー表示** — レイヤーパレットで全レイヤーが表示されるか確認する。
3. **テキスト内容・編集** — MainId=5 相当のテキストレイヤー（元は「あいうえお」）の表示内容を確認し、テキストツールで編集できるか試す。
4. **別名保存** — 「ファイル → 別名保存」で `{元のファイル名}_resaved.clip` を**このフォルダ** (`sample/_experiments/`) に保存する。
5. **再オープン** — 保存した `_resaved.clip` を閉じてから再度開く。
6. **報告** — 手順 1〜5 で気づいた点（警告、表示崩れ、編集不可、保存失敗など）を報告する。

### E1b / E1c について

文字数を変えただけで TLV バイナリは更新していないため、CSP が内部メタデータと文字列長の不整合を検出して開けない、または表示・編集がおかしくなる可能性があります。E2a と比較して TLV 同期の効果を確認してください。

## 再生成コマンド

```bash
npm run clip:experiments
python tools/clip-experiments/validate.py
python tools/clip-experiments/validate_tlv.py
python tools/clip-experiments/validate_raster.py
```

E0 のみ: `npm run clip:experiments:e0`  
E1 のみ: `npm run clip:experiments:e1`  
E2 のみ: `npm run clip:experiments:e2`  
E5 のみ: `npm run clip:experiments:e5`

## v2 — CSP 5.0.1 グラウンドトゥルース反映後（2026-03）

ユーザ再保存ファイル `user/*.clip` との三者比較で判明した **33px/字 @ 8pt** の行送り式を反映した修正版です。

| ファイル | 内容 | CSP USER bbox 一致 |
|----------|------|-------------------|
| `E2a_v2.clip` | 10 字「かきくけこさしすせそ」+ TLV 同期 + **正 bbox** | (918,509,951,839) |
| `E2c_v2.clip` | 16pt + **正 bbox** 66×330 | (885,509,951,839) |
| `E2d_v2.clip` | 「かきくけこ」+ **Offscreen 31 維持** + 正 bbox | (918,509,951,674) |

### v2 確認観点

| ファイル | 確認すること |
|----------|----------------|
| **E2a_v2** | v1 E2a と比べ bbox が短く（330px 高）なり、10 字が切れずに表示されるか |
| **E2c_v2** | v1 と同見た目だが id=72=66 など細部が USER 保存値に近いか |
| **E2d_v2** | キャッシュ削除なしで開けるか。E2d v1 のように CSP が新 Offscreen を勝手に作らなくてよいか |

### v2 再生成・検証

```bash
npm run clip:experiments:e2v2
python tools/clip-experiments/validate_tlv.py sample/_experiments/E2*_v2.clip
python tools/clip-experiments/validate.py sample/_experiments/E2*_v2.clip
python tools/clip-experiments/batch_compare_user.py   # user_compare_report.json
python tools/clip-experiments/diff_clip.py sample/_experiments/E2a_v2.clip sample/_experiments/user/E2a_len_change_synced.clip
```

詳細式・副作用一覧: `sample/_analysis/text_tlv_layout.md` §10

## E7 — テンプレアセット・プロトタイプのドライラン（フェーズ2）

`public/clip-export-template.clip` と `src/web/export/clip/textPrototypes.gen.ts` を使い、本番と同じクローン API でテキスト 3 枚を復元した出力です。

| ファイル | 内容 |
|----------|------|
| `E7_from_template.clip` | テンプレ + L5/L6/L7 プロトタイプからクローンした 3 テキスト |
| `template_review/*.png` | テンプレ内 CHNKExta の ClipMerger デコード PNG（目視用） |
| `template_build_report.json` | ビルド・検証サマリ |
| `template_clean_report.json` | 禁止文字列スキャン・ピクセル検証結果 |

クローン内容:

| 行数 | テキスト | プロトタイプ |
|------|----------|--------------|
| 1 行 | `テンプレ検証` | L5 |
| 2 行 | `二行の\r\nテスト` | L6 |
| 3 行 | `三行\r\nある\r\nはず` | L7 |

### E7 — CSP 5.0.1 確認観点

| 確認項目 | 期待 |
|----------|------|
| **開封直後の見た目** | 真っ白な原稿用紙（`page_template`）+ **ページ番号が白矩形で隠れている** |
| **テキスト** | 上記 3 枚が重ならず表示される（キャッシュレス・CSP 再描画） |
| **線画レイヤー** | MainId=8 が**空（全透明）**で、描き足せる |
| **レイヤーパネル** | テキストフォルダ(9) に 3 枚、線画が選択状態 |
| **別名保存→再オープン** | 白隠し・透明線画・テキスト 3 枚が維持される |

### 再生成・検証

```bash
npm run clip:template:build
python tools/clip-experiments/validate.py public/clip-export-template.clip sample/_experiments/E7_from_template.clip
python tools/clip-experiments/validate_integrity.py public/clip-export-template.clip sample/_experiments/E7_from_template.clip
python tools/clip-experiments/validate_tlv.py sample/_experiments/E7_from_template.clip
python tools/clip-template/validate_clean.py public/clip-export-template.clip
```

テンプレ PNG レビュー: `sample/_experiments/template_review/`
