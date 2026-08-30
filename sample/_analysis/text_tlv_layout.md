# CLIP STUDIO PAINT テキストレイヤー BLOB レイアウト (CSP 5.0.1 サンプル)

対象: `export_sample.sqlite` の `Layer.TextLayerAttributes` / `Layer.TextLayerAddAttributesV01`  
解析スクリプト: `07_text_tlv_full.py`, `08_paramscheme.py`  
詳細ダンプ: `07_output.txt`, `08_output.txt`

---

## 1. TLV 枠組み（確定）

### 1.1 共通コンテナ

| BLOB | 先頭構造 | 本体 |
|------|----------|------|
| `TextLayerAttributes` | なし（先頭から TLV） | `[param_id u32 LE][len u32 LE][payload]` × N |
| `TextLayerAddAttributesV01` | `u32 total = blob_len - 4` | 同上 TLV 列（60 項目） |

- **エンディアン**: すべて **リトルエンディアン**
- **境界検証**: 3 レイヤーとも **trailing 0 バイト**（`07_output.txt` 参照）
- **TLV id 列**: 11→26→17→12→13→…→74 の固定順（空 payload の id もプレースホルダとして存在）

### 1.2 ラン配列（full form — `TextLayerAttributes` 内）

ラン系 id: **11, 12, 13, 18, 26, 29, 30, 65**（16, 20 は L7 のみ追加）

```
[count u32]      // 通常 1（id=30 のみ L7 で 16）
[reserved u32]   // 0
[value_type u32] // UTF-16 文字数（TextLayerString と一致）
[meta u32]       // id=11: inner_len または定数 26
[payload...]
```

| id | inner 解釈 | 確度 |
|----|------------|------|
| 11 | 均一スタイル時: `meta=26` + 18B ゼロパディング。部分ラン時(L7): `meta=56` + フラグ + UTF-16 フォント名 | **高** |
| 12, 18 | `inner_len=2` → `u16`（0） | **高** |
| 13 | `inner_len=18` → `u16=0` + `f64` (2.8346457, 100) mm/pt 換算 | **高** |
| 26 | `inner_len=16` → `f64` (100, 100) 拡縮% | **高** |
| 29, 65 | `inner_len=2` → `u16`（1） | **高** |
| 30 | 単純時: `inner_len=4` → `u32=0`。L7: 可変長ラン表（後述） | **中** |

**`value_type`（vtype）**: 各ラン id で **UTF-16 単位文字数**（`\r\n` 込み）と一致。L5=5, L6=12, L7=54。

### 1.3 ラン配列（compact form — `TextLayerAddAttributesV01` 内）

同じ TLV id 番号だが payload が短縮。

| id | compact 形 | 確度 |
|----|------------|------|
| 11 | `[count=1][inner_len=14][14B パディング]`。L7 のみ pad 先頭に `0x00010300` フラグ | **高** |
| 12,13,18,26,29,65 | `[count=1][inner_len=4][u32]`（L5/6 は 0、L7 は 1） | **高** |
| 30 | 単純: `[count=1][inner_len=4][0]`。L7: `[count=16][16×(u32=4,u32=0)]` = 132B | **高** |

**スカラー TLV（id≥31）**: Add と Attr で **同一バイト列**（id=57 のみ Add 側は空）。

### 1.4 id=30 部分ラン表（L7 のみ、full form 260B）

`count=16` の後、12/16B 交互の可変エントリ:

- 12B: `[utf16_start][kind=4][u32 value]`
- 16B: `[utf16_start][kind=3][inner_len=4][u32 value]`

各行境界（`\r\n`）付近のインデックス（3, 9, 14, 20, …）にエントリが並ぶ。  
**確度: 中**（エントリ意味は「行区切り／デフォルト属性」仮説）。

---

## 2. ParamScheme からの id↔名前対応

### 結果: **内部 TLV id との対応は取得不可**

| ソース | 内容 |
|--------|------|
| `ParamScheme` | Layer **列名**のみ（`_PW_ID=175` → `TextLayerAttributes` 列）。1250 行中 Text 関連 9 列 |
| `ElemScheme` | テーブル要素数。TLV ラベルなし |
| `.clip` バイナリ | `LayerTextLayer*` 列名 9 個のみ。`TextLayerFontSize` 等の内部 enum 文字列なし |

**結論**: TLV `param_id` 11–74 は CSP バイナリ内 enum と推定。下表の名前は **ヒューリスティック**（`08_output.txt` 参照）。

---

## 3. 完全レイアウト表（主要 id）

| id | 推定名 | 型 | L5 | L6 | L7 | 確度 |
|----|--------|----|----|----|-----|------|
| 11 | CharRunHeader | run | vtype=5, 均一 | vtype=12 | vtype=54, 64B+font | 高 |
| 12 | RunAttr_U16_0 | u16 run | 0 | 0 | 0 | 高 |
| 13 | FontSizeMmScale | f64×2 run | (2.83465,100) | 同左 | 同左 | 高 |
| 26 | HorzVertScalePct | f64×2 | (100,100) | 同左 | 同左 | 高 |
| 29,65 | RunAttr_U16_1 | u16 | 1 | 1 | 1 | 高 |
| 30 | PerIndexRunTable | run/表 | 4B zero | 4B zero | 260B 表 | 高 |
| 31 | FontNameUtf8 | UTF-8 | `I-OTFアンチックStd B` | 同左 | 同左 | **確定** |
| 32 | FontSizeValue | u32 | 397 | 397 | 397 | 高（≈8pt） |
| 33 | LineHeight? | u32 | 16 | 16 | 16 | 低 |
| 34 | TextColorRGBA | 12B | 全ゼロ | 全ゼロ | 全ゼロ | 中（黒） |
| 37 | MmPerPt×100 | u32 | 283 | 283 | 283 | **確定** |
| 39 | Utf16CharCount | u64 | 5 | 12 | 54 | **確定** |
| 42 | CanvasBBox | u32×4 | (918,509,951,674) | (860,509,951,676) | (747,509,951,907) | **確定** |
| 44 | PxPerPt×1000 | u32 | 8333 | 8333 | 8333 | **確定** (600dpi) |
| 47 | SubstituteFontList | blob | MS Pゴシック… | 同左 | 同左 | 高 |
| 50 | FloatCacheOffscreenId | u32 | 31 | 39 | 47 | **確定** |
| 57 | FontFaceDescriptor | blob | display+PS名 | 同左 | 同左 | 高 |
| 63 | RenderPixelSize | u32×2 | (33,165) | (91,167) | (204,398) | **確定** |
| 64 | RenderRectCentiPx | i32×8 | (-3300,0,0,0,0,16500,-3300,16500) | (-9000,0,100,0,100,16700,…) | (-20300,…) | 高 |
| 72 | CacheWidthHint | u32×2 | (33,0) | (90,0) | (203,0) | 高 |
| 49,58–62,67,71… | 定数群 | u32/f64 | レイヤー間同一 | | | 高 |

空 TLV（len=0）: 14,15,17,19,21,22,27,28,40,41 — スキーマ上のプレースホルダ。

---

## 4. 座標系の確定

### id=42 / id=63 / id=64

| フィールド | 座標系 | 根拠 |
|------------|--------|------|
| **id=42** | **キャンバス絶対** (left, top, right, bottom) px | L5 offset=(0,0) で bbox≠(0,0)。L6/L7 でも bbox はテキスト描画矩形の絶対位置 |
| **id=63** | 描画サイズ (width, height) px | `right-left`, `bottom-top` と完全一致 |
| **id=64** | ローカル矩形 ×100（centi-px） | `[-width×100, 0, …, height×100, -width×100, height×100]` パターン |
| **id=72.x** | オフスクリーン幅 − 1〜2 | 浮動キャッシュ Offscreen 寸法と対応（L5: 34−1=33） |

### LayerOffset / RenderOffscrOffset との関係

| Layer | LayerOffset | RenderOffscr | id=42 left | left − LayerOffsetX |
|-------|-------------|--------------|------------|---------------------|
| 5 | (0, 0) | (0, 0) | 918 | 918 |
| 6 | (-415, 157) | (415, -157) | 860 | 1275 |
| 7 | (27, 592) | (-27, -592) | 747 | 720 |

- **RenderOffscrOffset ≈ −LayerOffset**（キャッシュ原点補正）
- **テキストの画面上の位置は id=42 で決まる**（LayerOffset だけでは bbox は動かない）
- 新規配置: **id=42 を直接書き換え** + 必要なら LayerOffset/RenderOffscr をセット

### id=50 → Offscreen

| Layer | id=50 | Offscreen 寸法 | inExta |
|-------|-------|----------------|--------|
| 5 | 31 | 34×166 | あり |
| 6 | 39 | 92×168 | あり |
| 7 | 47 | 205×399 | あり |

寸法 ≈ id=63 + (1,1) パディング。

---

## 5. 変更シナリオ別 — 書き換えフィールド

### 5.1 文字列だけ変更（フォント・サイズ・位置不変）

| 対象 | 操作 |
|------|------|
| `Layer.TextLayerString` | UTF-8 本文 |
| `Layer.LayerName` | 表示名（任意） |
| Attr/Add **id=11** | `vtype` = 新 UTF-16 文字数 |
| Attr/Add **id=39** | u64 下位 = 新 UTF-16 文字数 |
| Attr/Add **id=12,13,18,26,29,65** | 各 `vtype` フィールド（full の 3 番目 u32） |
| Attr/Add **id=30** | 文字数依存なら再構築（L7 型は行数×エントリ） |
| **id=42,63,64,72** | レイアウトエンジン再計算が必要なら更新（単純置換では不足の可能性大） |
| **id=50** + Offscreen 行 | キャッシュ無効化・再生成 |
| AddAttributes | 上記ラン id の **compact 形**も同期。header `u32` = `len(blob)-4` 再計算 |

**定数のまま流用可**: id=31,32,33–38,43–49,51–62,66–71,73–74, 空 TLV。

### 5.2 位置だけ変更 (x, y)

| 対象 | 操作 |
|------|------|
| **id=42** | `(left+xΔ, top+yΔ, right+xΔ, bottom+yΔ)` |
| **id=64** | オフセット分の調整（または CSP 再保存値をコピー） |
| `LayerOffsetX/Y` | 任意（サンプルでは bbox と独立に設定可） |
| `LayerRenderOffscrOffsetX/Y` | 通常 `−LayerOffset` |
| Add の **id=42,64** | Attr と同一値に同期 |
| **id=50** + Offscreen | ピクセルキャッシュ再生成 |

**変更不要（位置のみ）**: 文字数系 id、フォント id、定数群。

### 5.3 サイズだけ変更 (fontSizePt)

| 対象 | 操作 |
|------|------|
| **id=32** | `≈ fontSizePt × 49.625`（397@8pt）。線形比例で仮更新 |
| **id=13** inner f64[0] | `2.8346457` は mm/pt 換算（8pt 前提で固定でも可） |
| **id=42,63,64,72** | 新しい描画矩形・サイズへ |
| Offscreen | 新寸法で行追加 |

**検証**: CSP で 8pt→12pt に変更した .clip を差分取り、id=32 の比例式を確定。

### 5.4 新規テキストレイヤー生成（MainId=5 プロトタイプ）

#### 手順

1. **Layer 行コピー**（MainId=5）→ 新 MainId を採番
2. **ツリーリンク**更新（`LayerNextIndex` / 親 `FirstChildIndex`）
3. **Mipmap / LayerThumbnail / Offscreen** 行を L5 から複製し MainId を振り直す
4. **TextLayerString** ← `content`（UTF-8）
5. **TextLayerAttributes** — 以下をパッチ（他は L5 コピー）:

| パラメータ | id | 書き換え |
|------------|-----|----------|
| UTF-16 文字数 | 11,12,13,18,26,29,39,65 | 各 `vtype`/count フィールド |
| キャンバス矩形 | 42 | `(x, y, x+width, y+height)` |
| 描画サイズ | 63 | `(width, height)` |
| centi-px 矩形 | 64 | `(-width*100, 0, 0, 0, 0, height*100, -width*100, height*100)` パターン（L5 式） |
| キャッシュ幅 | 72 | `(width - 1, 0)` 近似（要実機確認） |
| フォントサイズ | 32 | `round(fontSizePt * 49.625)` 仮 |
| 浮動キャッシュ | 50 | **新 Offscreen.MainId** |

6. **TextLayerAddAttributesV01** — Attr をパッチ後、ラン id を **compact 形**で再構築:
   - header = `len(blob) - 4`
   - id=11: 22B テンプレ（L5/L6 型）
   - id=12,13,18,26,29,30,65: 12B テンプレ（`01 00 00 00 04 00 00 00 00 00 00 00`）
   - スカラーは Attr と同一（id=57 は Add で空で可）
7. **Offscreen** — 浮動キャッシュ行を新規作成（寸法 ≈ width+1, height+1）、`BlockData` は空/chunk 参照
8. **LayerOffset** = `(0,0)`、**RenderOffscr** = `(0,0)` を推奨（bbox で位置指定する場合）

#### id=50 の NULL/0 化

| 仮説 | 検証方法 |
|------|----------|
| `id=50=0` で CSP が自動再生成 | テスト .clip で 0 にし再オープン。クラッシュしなければ Offscreen 行は省略可か確認 |
| Offscreen 行なし | id=50=0 + Mipmap 複製のみで表示可否 |
| **推奨** | 新 Offscreen 行を作り id=50 を参照（L5 と同パターン） |

---

## 6. 色（黒以外）の候補と検証

| 候補 | id | 現状 | 検証実験 |
|------|-----|------|----------|
| **最有力** | 34 (12B) | 全ゼロ＝黒 | CSP で赤テキスト保存 → id=34 の 12B を hex 比較（RGBA float/int 仮説） |
| 次点 | 13 inner u16 | 常に 0 | 色変更時に非ゼロ化するか |
| 低 | 54 (20B) | 末尾 `0xFFFFFFFF` 固定 | 縁取り／背景色なら変化するか |
| Layer 列 | `LayerPaletteRed` 等 | テキスト層は 0 | パレット色指定時のみ |

**実験手順**: 同一フォント・位置で色だけ変えた 2 レイヤー .clip → SQLite 抽出 → `07_text_tlv_full.py` で id=34/13/54 差分。

---

## 7. 未解明フィールドとリスク（優先順）

| 優先 | id/領域 | 誤設定時の症状 | 確度 |
|------|---------|----------------|------|
| 1 | **id=30** L7 型ラン表 | 行ごと書式崩れ・クラッシュ | 中 |
| 2 | **id=50** + Offscreen ピクセル | テキスト空白・サムネイル欠損 | 高 |
| 3 | **id=64** 係数 | 描画位置ズレ・クリップ異常 | 中 |
| 4 | **id=32** フォントサイズ換算 | サイズ不一致 | 中 |
| 5 | **id=34** 色 | 色が黒のまま／ゴミ色 | 低〜中 |
| 6 | **id=47,57** フォント記述 | フォント fallback・名不一致 | 低（コピー可） |
| 7 | **id=56** ThumbnailLink | レイヤーパネルサムネ異常 | 低 |
| 8 | **Add compact** と **Attr full** の不整合 | 保存時 Attr 再生成で上書き／警告 | 中 |
| 9 | 空 TLV id の欠落 | パーサ拒否の可能性 | 低 |
| 10 | **Mipmap チェーン**（テキストは外部 0B） | ズーム時の品質のみ | 低 |

---

## 8. 数値メモ

```
mm_per_pt  = id=37 / 100 = 2.83465
px_per_pt  = id=44 / 1000 = 8.333  (600 DPI)
fontSize   ≈ id=32 / 49.625 ≈ 8 pt  (397)
id=13.f64[0] = 2.8346457 = mm_per_pt
浮動 Offscreen ≈ (id=63.w + 1, id=63.h + 1)
```

---

## 9. ファイル一覧

| ファイル | 内容 |
|----------|------|
| `07_text_tlv_full.py` | 境界検証付き完全パーサー |
| `07_output.txt` | 3 レイヤー全 TLV デコード |
| `08_paramscheme.py` | ParamScheme 精査 + TLV ヒューリスティック名 |
| `08_output.txt` | Scheme 結論（TLV id マップ不可） |
| `text_tlv_layout.md` | 本ドキュメント |
| `tools/clip-experiments/diff_clip.py` | 2 .clip 論理差分ツール |
| `tools/clip-experiments/batch_compare_user.py` | 三者比較バッチ（original / generated / user） |

---

## 10. CSP 5.0.1 検証済み（2026-03 ユーザーグラウンドトゥルース）

対象: `sample/_experiments/user/*.clip`（7 件。CSP で再編集・保存した正解データ）  
比較: `export_sample.clip` / `sample/_experiments/E*.clip` / `user/E*.clip`  
ツール: `diff_clip.py`, `batch_compare_user.py` → レポート `user_compare_report.json`

### 10.1 確定した縦書き bbox 式（L5 / I-OTFアンチック Std B / 8pt 基準）

| 量 | 式 | 根拠 |
|----|-----|------|
| **列幅 (px)** | `width = round(33 × fontSizePt / 8)` | L5=33@8pt、E2c USER=66@16pt |
| **行送り (px/字)** | `pitch = round(33 × fontSizePt / 8)` | E1a/b/c・E2a USER で一貫して 33@8pt |
| **bbox 高さ** | `height = charCount × pitch` | 5字→165、10字→330、2字→66 |
| **bbox (縦書き・右上固定)** | `(right−width, top, right, top+height)` | L5/E2a USER |
| **id=63** | `(width, height)` | 常に bbox サイズと一致 |
| **id=64** | `(-width×100, 0, 0, 0, 0, height×100, …)` | L5 パターン維持 |
| **id=72.x** | `width`（**not** width−1） | 原 L5=33、USER 再保存後も 33/66 |
| **id=32** | `round(fontSizePt × 49.625)` | 8pt→397、16pt→794（E2c 一致） |
| **id=13 inner f64[0]** | `2.8346457` (mm/pt) | フォントサイズ変更後も固定 |

**誤っていた仮定**: `pitch = fontSizePt × 1.2 × pxPerPt`（≈80px/字）。CSP 実測は **33px/字 @ 8pt** で、フォントサイズに線形比例。

```ts
// 実装（textTlv.ts）
const scale = fontSizePt / 8;
width = pitch = round(33 * scale);
height = charCount * pitch;
```

### 10.2 ファイル別 — 我々の誤りと CSP の補正

| ファイル | 生成物の誤り | CSP 5.0.1 の処置 |
|----------|--------------|------------------|
| **E1a** | TLV 未更新だが同長 | bbox・TLV ほぼ不変（正しい） |
| **E1b** | TLV vtype=5 のまま 2 字 | **bbox のみ** 674→575（2×33）。vtype は 5 のまま残存 |
| **E1c** | TLV vtype=5 のまま 10 字 | **bbox のみ** 674→839（10×33）。vtype/id=39 未更新 |
| **E2a** | bbox 高さ 800px（80px/字仮説） | bbox→839（10×33）。run vtype=10 は維持 |
| **E2b** | （bbox 移動自体は正しい） | MainId 5 削除→**新 Layer MainId=13** に再生成。id=42 移動値は同一。id=50→85（新 Offscreen） |
| **E2c** | id=72 が width−1 | bbox 66×330 は **生成時から正解**。CSP は id=39/(Add compact) のみ正規化 |
| **E2d** | キャッシュ削除 + 誤 bbox | **Offscreen 新規 MainId=64** + Exta 追加。bbox→165。テキスト保持 |

### 10.3 id=39 の再保存後挙動（決定不能 — 検証時は run vtype を優先）

| 状態 | id=39 u64 (lo, hi) | 備考 |
|------|---------------------|------|
| 原 L5 / 生成直後 | (5, 0) | lo = UTF-16 文字数 |
| E1b USER | (2, 0) | lo = 実文字数 |
| E1c USER | (5, 0) | **未更新**（10 字なのに 5） |
| E2a USER | (2, 0) | lo ≠ 文字数 |
| E2c/d USER | (1, 0) | lo ≠ 文字数 |
| E2b USER (L13) | (0, 5) | **hi** = 文字数 |

**設計指針**: パッチ時は id=39 下位 word = UTF-16 文字数、run vtype 同期を維持。CSP 再保存後の id=39 は一致検証から除外。

### 10.4 浮動キャッシュ (id=50 / Offscreen)

- **削除戦略は不可**: E2d で id=50=0 + Offscreen 31 削除 → CSP が **新 MainId=64** + CHNKExta を再生成。
- **推奨 (E2d_v2)**: 既存 Offscreen 31 を維持し、正しい bbox/id=63/64/72 のみ更新。
- 位置変更のみ (E2b): id=42 更新で十分。LayerOffset は 0 のまま。

### 10.5 CSP 再保存の副作用（本実装では再現不要）

- `CanvasWorkTime` 更新
- `sqlite_sequence` / `ElemScheme.MaxIndex` 増分
- `CanvasPreview` / `LayerThumbnail` / `MipmapInfo` 行の入れ替え（新 _PW_ID）
- `ExternalChunk.Offset` 再配置（VACUUM 相当）
- E2b: テキスト Layer の MainId 再採番

### 10.6 v2 実験生成物

| ファイル | 意図 | CSP USER との bbox 一致 |
|----------|------|------------------------|
| `E2a_v2.clip` | 10 字 + 正 pitch | (918,509,951,839) ✓ |
| `E2c_v2.clip` | 16pt + 正 bbox | (885,509,951,839) ✓ |
| `E2d_v2.clip` | キャッシュ維持 + 正 bbox | (918,509,951,674) ✓ |

再生成: `npm run clip:experiments:e2v2`

### 10.7 複数行テキスト bbox（E6 CSP 実機 + L6/L7 サンプル、2026-03）

縦書きで `\r\n` により複数列になる場合、**glyph 列幅 33px と列間ピッチは別**。  
E6_clone で 2 行テキストの 1 行目が欠落した原因は **bbox 幅を 1 列 (33px) のまま**にし、高さを **全 UTF-16 文字数×pitch** で計算したこと（右上アンカーで左列＝1 行目がクリップ）。

| 量 | 式 @ 8pt | 根拠 |
|----|----------|------|
| **glyph 列幅** | `round(33 × fontSizePt / 8)` | L5 単一行（§10.1） |
| **行送り (px/字)** | `round(33 × fontSizePt / 8)` | 同上（列内） |
| **列間ピッチ** | `round(57 × fontSizePt / 8)` | L7: (204−33)/3=**57**；L6: 91−33=**58**（2 列時 +1px 補正） |
| **bbox 幅** | `glyphW + (lineCount−1)×interCol + (lineCount===2 ? round(1×scale) : 0)` | L6=91、L7=204 |
| **bbox 高さ** | `max(lineUtf16Chars) × pitch + (lineCount>1 ? round(2×scale) : 0)` | L6: 5×33+2=167；L7: 12×33+2=398 |
| **id=72** | 単一行=`width`、複数行=`width−1` | L5=33、L6=90、L7=203 |
| **id=64** | 複数行は `offset` 変種（index 2,4=100） | L6/L7 |

実測（export_sample.clip）:

| Layer | 行数 | max 行字数 | bbox (w×h) | id=63 | id=72 |
|-------|------|-----------|--------------|-------|-------|
| L5 | 1 | 5 | 33×165 | (33,165) | 33 |
| L6 | 2 | 5 | 91×167 | (91,167) | 90 |
| L7 | 4 | 12 | 204×398 | (204,398) | 203 |

E6_clone MainId=11（誤）: bbox 33×462（14 字×33）→ 2 列目のみ可視。  
E6_clone_resolved: TextLayer TLV は E6_clone と**バイト同一**（CSP 保存はキャッシュ/サムネ更新のみ。正しい bbox は生成側で補正）。

```ts
// textTlv.ts — estimateVerticalTextBBox()
const metrics = verticalTextMetrics(text, fontSizeValue);
// width: multi-column; height: max line length (not total char count)
```

プロトタイプ選択: 1 行→L5、2 行→L6、3 行以上→L7（id=30 ラン表構造を踏襲）。

---

## 11. E6_v2 実機検証結果（CSP 5.0.1 PC、2026-08 グラウンドトゥルース）

対象: `E6_v2.clip`（生成） vs `E6_v2_resolved.clip`（ユーザーが CSP 5.0.1 で開いて保存）  
ツール: `tools/clip-experiments/diff_e6v2.py` → `E6_v2_diff_full.json` / `E6_v2_diff_summary.json`  
ユーザー確認: 5 レイヤーすべて全行・正しい位置・サイズで表示、編集・保存も正常。

### 11.1 総括 — **導出公式の残差ゼロ（全フィールド バイト一致で維持）**

両ファイルはサイズ完全一致（885,096B）で、差分は全体で **470 バイト**のみ。
テキストレイヤー関連の列・TLV に CSP の補正は **一切なし**。

| 検証列 | 5 レイヤーでの結果 |
|--------|--------------------|
| `TextLayerString` | バイト一致 |
| `TextLayerAttributes`（TLV 全 id） | バイト一致 |
| `TextLayerAddAttributesV01`（TLV 全 id） | バイト一致 |
| `LayerOffsetX/Y`, `LayerRenderOffscrOffsetX/Y` | 一致 |

### 11.2 レイヤー別 — 生成値がそのまま維持されたフィールド

| MainId | テキスト | 行数 | pt | id=42 bbox | id=63 | id=72 | id=32 | id=39 lo | id=50 |
|--------|----------|------|----|------------|-------|-------|-------|----------|-------|
| 5 | あいうえお | 1 | 8 | (918,509,951,674) | (33,165) | 33 | 397 | 5 | 0 |
| 10 | クローン一号 | 1 | 8 | (1167,300,1200,498) | (33,198) | 33 | 397 | 6 | 0 |
| 11 | 二行目も\r\nある長文テキスト | 2 | 8 | (609,800,700,1066) | (91,266) | 90 | 397 | 14 | 0 |
| 12 | 大きい字 | 1 | 16 | (334,1400,400,1664) | (66,264) | 66 | 794 | 4 | 0 |
| 13 | 一行目\r\n二行目\r\n三行目 | 3 | 8 | (753,1100,900,1201) | (147,101) | 146 | 397 | 13 | 0 |

- §10.1（単一行）・§10.7（複数行: 列間 57px、2 列時 +1px、高さ +2px 補正）の式は **CSP 5.0.1 でそのまま採用され、丸め・再計算は発生しなかった**。
- id=64 も L5 型 / 複数行 offset 変種（index 2,4=100）とも維持。
- id=39 下位 word = UTF-16 文字数、run vtype 同期も維持（CSP 側の書き換えなし）。

### 11.3 CSP が書き換えたもの（計 470B、意味のある分類）

| 分類 | 内容 |
|------|------|
| スキーマ再作成 | トリガー `ExternalDeleteOfBlockDataOnOffscreen` / `ExternalUpdateOfBlockDataOnOffscreen` を追加（`Offscreen.BlockData` の削除/更新時に `RemovedExternal` へ記録する GC 用）。**原本 `export_sample.clip` にも無い** → CSP が開いた時に再作成する運用スキーマで、生成側は入れなくてよい |
| SQLite ヘッダ | `file_change_counter` 156→173（17 トランザクション）、`schema_cookie` 220→222、`sqlite_version_number` 3049001→3030001（CSP 同梱 SQLite 3.30.1 のスタンプ） |
| CHNKHead | 末尾 16B の ファイル UUID を再発行（先頭 u64×2・idlen は不変） |
| データテーブル | **変更ゼロ**（`CanvasWorkTime` 102185 のまま、CanvasPreview / Project / sqlite_sequence / ElemScheme も不変） |

### 11.4 キャッシュ再生成 — **ファイル上は何も再生成されなかった**

- Offscreen 66 行・Mipmap 9 行・MipmapInfo 54 行・LayerThumbnail 9 行・ExternalChunk 7 行、CHNKExta 7 チャンク: すべて左右バイト一致。
- 浮動キャッシュ行（旧 31/39/47）は不在のまま。クローン層のミップマップ連鎖 Offscreen（MainId 62–89、Exta 実体なしの externalId 参照）も CSP は補修せず受理。
- 表示はユーザー確認済み → **CSP は TLV からインメモリでレンダリングし、非ダーティなら永続化しない**。キャッシュレス生成方式の妥当性が確定。

### 11.5 「サイズ完全一致なのにハッシュが違う」理由

- CSP 5.0.1 (PC) は .clip 内の埋め込み SQLite を **ファイル内オフセットへの直接ページ書き込み（インプレース）** で更新する。
- 今回はドキュメント非ダーティのため、永続化はトリガー再作成＋ヘッダカウンタ＋UUID のみ。トリガー SQL（425B）は既存 sqlite_master ページ（p124）の空き領域に収まり、`page_count`=136 不変 → CHNKSQLi 長不変 → **ファイルサイズ完全一致**。
- 対照（v1 ダーティ保存: `E6_clone_resolved`）: 881,000→1,172,754B、page 135→205、`CanvasWorkTime` +61,412、キャッシュ Exta 追加。**「CSP 保存＝サイズ増」は編集ありの保存に限る**。

| | v2 (E6_v2_resolved) | v1 (E6_clone_resolved) |
|--|--------------------|------------------------|
| 保存経路 | 非ダーティ（インプレース 470B） | ダーティ保存（フル書き直し） |
| TLV | バイト一致維持 | バイト一致維持 |
| キャッシュ | 再生成なし | Exta 再生成 +292KB |
| CanvasWorkTime | 不変 | +61,412 |
| トリガー | +2（空き領域） | +2 |

### 11.6 本実装（プロダクション）への指針

1. `textTlv.ts` の bbox / ピッチ / id=32 換算式は**変更不要**（実機残差ゼロ）。
2. キャッシュレス方式を正式採用: id=50=0、浮動キャッシュ Offscreen 行なしで良い。ラスタキャッシュ生成コードは不要。
3. Offscreen トリガー・CHNKHead UUID・SQLite ヘッダカウンタは生成側で管理不要（原本流用/任意値で可、CSP が自己修復）。
4. TLV 維持はダーティ保存（v1）・非ダーティ（v2)の両経路で確認済み。今後の検証では id=39 の再保存後値のみ引き続き比較除外（§10.3）。
