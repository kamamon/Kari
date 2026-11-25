#!/usr/bin/env python3
"""Build the human handoff from measured results, without changing PNGs."""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent


def main():
    data = json.loads((BASE / 'validation.json').read_text(encoding='utf-8'))
    rows = data['records']
    groups = {key: [x for x in rows if x['group'] == key] for key in ('rocks', 'cliffs', 'tiles')}
    rocks, cliffs, tiles = groups['rocks'], groups['cliffs'], groups['tiles']
    rock_shapes = sum(x['acceptance']['three_views_within_8_percent'] for x in rocks)
    rock_ground = sum(x['acceptance']['front_and_right_ground_within_8px_soil_after_uniform_normalization'] for x in rocks)
    cliff_edges = sum(x['acceptance']['edge_heights_within_0_3m'] for x in cliffs)
    cliff_ground = sum(x['acceptance']['body_within_ground_soil_allowance_at_alpha128'] for x in cliffs)
    tile_contrast = sum(x['acceptance']['luminance_std_20_to_35'] for x in tiles)
    contrast_min = min(x['body_luminance_std_rec709'] for x in rows)
    contrast_max = max(x['body_luminance_std_rec709'] for x in rows)
    png_mb = data['png_bytes'] / 1_000_000
    rock_sizes = sorted({(x['width_px'], x['height_px']) for x in rocks})
    tile_sizes = sorted({(x['width_px'], x['height_px']) for x in tiles})
    rock_size_text = '、'.join(f'{w}×{h}' for w, h in rock_sizes)
    tile_size_text = '、'.join(f'{w}×{h}' for w, h in tile_sizes)
    failed_ground = [x['id'] for x in cliffs if not x['acceptance']['body_within_ground_soil_allowance_at_alpha128']]
    exits = '\n'.join(
        f"- {x['id']}: 出口の空白側512px内は、alpha≥128の本体{x['exit_strip']['body_pixels_at_alpha128']}画素、非0 alpha{x['exit_strip']['nonzero_alpha_pixels']}画素、最大alpha{x['exit_strip']['maximum_alpha']}。"
        for x in cliffs if x['exit_strip'] is not None
    )
    text = f'''# 依頼10 — 岩20種・崖20種・岩肌4枚

`docs/chatgpt-request-10.txt` への返答です。基点は `main` の `b832291c24cdc7ca56445d5d87b426de21ed77bf`（v0.19.0、正式依頼10の追加時点）。`chatgpt/010-rocks-cliffs` から、`chatgpt-inbox/010/` の追加だけを提出します。

**44枚の原画を制作しました。すべての数値仕様に合格した実装素材ではありません。** 岩の三面の寸法差・地面位置、岩肌の画像寸法・継ぎ目、透明領域の低alpha残留などを下記に記録しています。`patterns.json` の寸法は指定値の転記ではなく、提出画像から測った値です。

## 返したもの

| 分類 | 原本PNG | 点数 |
| --- | --- | ---: |
| 岩 R-01〜R-20 | `rock_r01_v1.png`〜`rock_r20_v1.png`。正面・右側面・真上を1枚に収録 | 20 |
| 崖 C-01〜C-20 | `cliff_c01_v1.png`〜`cliff_c20_v1.png`。出口の左右端を含む | 20 |
| 岩肌 T-01〜T-04 | `tex_rock_t01_v2.png`〜`tex_rock_t04_v2.png` | 4 |
| **計** | **新規の原本PNG、約{png_mb:.1f}MB** | **44** |

閲覧用PDF: `VEILBOUND_HUNTERS_rocks_cliffs_44_v1.pdf`。生成の全プロンプト・参照・採用した生成元は `rocks_generation.json`、`cliffs_generation.json`、`tiles_generation.json` に保存しました。T-01の濃淡修正は `tiles_refinement.json` にも記録しています。

`manifest.json` に画像の対応・寸法・SHA256、`validation.json` に全点の実測と数値判定、`acceptance-report.md` に読みやすい比較表があります。任意の崖深度図20枚は未制作で、`patterns.json` に `depthFile` は記載していません。

## 守れなかった決まりと測り方

### R: 岩

- 指定1536×512pxに対して、生成原本は **{rock_size_text}px** です。元画像は縮小・切抜き・透明度加工をしていません。
- 三面の対応は **{rock_shapes}/20点が幅・奥行・高さすべて±8%以内**、残りは不適合です。正面と側面の地面下が8px以内に収まるのは、全体を512px高へ均等に正規化して評価した場合に **{rock_ground}/20点** です。岩ごとの差を下表に記載します。
- `patterns.json` の `width` は正面輪郭幅、`depth` は真上図の上下幅、`height` は正面輪郭の高さです。輪郭には小さな接地縁も含まれます。1セルの実際の幅を S=2m/M=4m/L=8m として換算し、各図を別々に引き伸ばして一致させる処理はしていません。
- 地面位置のずれ、土や小石のかぶり、三面での割れ目・苔の対応は、形を起こす前に確認・補正してください。低く埋まる形、平岩、立ち岩、割れ岩などの意図と、厳密な幾何対応の成否は区別しています。

### C: 崖

- 原本は全点2048×768px。alpha≥128で測った両端の高さは **{cliff_edges}/20点が指定±0.3m以内**、地面y704から土砂16px以内は **{cliff_ground}/20点** です。接地下端が超えるもの: {', '.join(failed_ground) if failed_ground else 'なし（alpha≥128での判定）'}。
- 両端8%を暗い縦の割れ目で終える意図を反映しました。柱の厳密な幅、傾斜角、段の奥行、全組合せで接続した見え方は未検証です。端の色・形が完全に一致することは保証していません。
- 主な接地輪郭（各列下端の最頻値）はy709〜714、C-12のみy722です。土砂の許容内でも、基準接地線y704への完全一致ではありません。最大下端と主な接地位置を分けて確認してください。
- C-16の塔は約8.051m（指定上限8m）、C-18の中央最高部は約4.137m（指定上限4m）です。C-20の輝度標準偏差は36.783で、目標上限35を超えます。これらも未適合として記録します。
- 中央の稜線高は、両端8%を除いた84%の範囲で実測しています。`patterns.json.height` は実測最小・最大で、依頼に記載された希望範囲とは異なる場合があります。出口用で何もない列は高さ0mとして扱います。
- **奥行きの図は作成していません。** 色の明暗を単純にグレースケール化しても物理的な深度にはならず、色図と形・位置の一致した深度資料を確定できていません。

{exits}

### T: 岩肌

- 指定1024×1024pxに対して、原本は **{tile_size_text}px** です。
- 輝度標準偏差20〜35は **{tile_contrast}/4点** で満たします。T-01は初稿の19.81から画像生成による編集で濃淡を増やしたものを採用しています。
- **4点ともシームレス反復は未合格です。** 2×2配置で継ぎ目と同じ模様の反復を確認しました。対向端の画素も一致していません。実行用の1024px化と継ぎ目処理を行い、反復表示を確認してください。
- T-02の地層は一部が斜めに流れ、指定の5〜20cm幅の厳密な縮尺を確定していません。

### 透明と濃淡

- RとCはRGBAの実alphaを持ち、背景を赤紫に置き換えていません。Tは面を埋めるRGB材質です。
- R/Cの透明領域や画像外周には、alpha=1程度の極薄い残留が含まれます。alpha≥128の本体判定が合格でも、**alphaが厳密に0である規則の合格とはしていません。** インポート前に透明境界の清掃と確認が必要です。
- 明るさは Rec.709 のRGB重み（0.2126/0.7152/0.0722）で0〜255の輝度を計算し、alpha≥128の領域の標準偏差を測っています。全44点の範囲は **{contrast_min:.2f}〜{contrast_max:.2f}**。測定は符号化RGB値上で行い、線形光・物理的な反射率を測ったものではありません。

## 迷って決めたこと

- 岩の主題・S/M/L・名前は依頼10に従い、採用済み基準ボードと現在の狩場2画像で色と雰囲気を合わせました。既存の濃淡の弱い岩肌は失敗例として参照し、その平坦さを引き継がない方針にしました。
- 晶脈・晶塊は青銅〜琥珀の鉱物として表現し、自発光として設定していません。新たなアイテムID・採掘効果・数値は作成していません。
- C-19とC-20はそれぞれ生成した別の地形です。元画像の左右反転で作成していません。
- JSON例にある `granite` は許可タグ一覧に含まれないため採用せず、指定一覧のタグだけを使用しています。
- 背景の低alpha清掃、出力ピクセル数の調整、三面の幾何補正は原本に施していません。生成出力の状態と実測をそのまま受け渡します。

## 確認したこと

- 44PNGを全点デコードし、44の異なるSHA256を確認。画像の破損・同一バイト列の重複は0件。
- 全ファイル名、R/C/Tの20/20/4件、許可タグ、実寸、alpha、輪郭、三面差、崖の端高、接地、濃淡を検査。結果は `validation.json`。
- 図の主題・向き・文字混入・輪郭・余白を目視。個別の注意は各生成記録に記載。
- Node.js v24.22.3で `npm ci --no-audit --no-fund` が成功。今回はモンスターJSONを追加せず、`bestiary:import` は対象外です。
- PDF51ページを全点描画し、44点の原本・埋込画像・名称・ID・ファイル名の対応、日本語と代表ページの収まりを確認済みです。結果は `pdf_validation.json` に記録しています。
- 3D化、衝突、外周への配置、接続の全組合せ、ゲーム画面、iPhone Safari性能、正式採用は未確認です。

## Claudeへの受入メモ

1. `patterns.json` と下表の差を先に確認し、画像を受け入れる単位を選んでください。原本をそのまま規定座標で切り出すと、岩の地面・縮尺がずれます。
2. 岩は全体の均等縮小だけでは三面の幾何差が直りません。輪郭・接地位置と三面の一致を補正し、必要なら差の大きいIDを絞って再依頼してください。
3. 透明境界を清掃し、崖の許容外の接地下端や出口空白区間を整え、接続後の輪郭と色を実機表示で確認してください。
4. 岩肌4枚は継ぎ目処理後に反復を確認し、1024pxの実行用を別途作成してください。
5. 採用した画像だけ `art-source` 等の正式置き場へ移してください。このPRではゲームコード・ゲームデータ・既存原画を変更していません。
6. 追加素材53点は別の `chatgpt-inbox/supplement-20261125/` で提出しており、この44点には含めません。

## 数値の比較表

以下は `inspect_assets.py` の実測結果です。再計測する場合は `python3 inspect_assets.py`、READMEを更新する場合は続けて `python3 build_handoff.py` を実行してください。

'''
    appendix = (BASE / 'acceptance-report.md').read_text(encoding='utf-8')
    appendix = appendix[appendix.index('## 岩：'):].replace('## ', '### ')
    (BASE / 'README.md').write_text(text + appendix, encoding='utf-8')
    print(f'Wrote README.md for {len(rows)} PNGs')


if __name__ == '__main__':
    main()
