# 依頼011の資料・映像時刻と証拠の扱い

## S1：PSP日本版の武器訓練（対象を探すための位置）

[完全初見：MHP2G PSP ゲームプレイ（2026年5月1日公開）](https://www.youtube.com/watch?v=gPHJlI8714o)。動画の説明欄が示す章の境界は次のとおり。**これらは技ごとの実測開始・終了時刻ではない。動画の各フレームをこちらで再生・観察した証拠にもならない。**

| 武器 | 章開始 | 次章開始 |
| --- | --- | --- |
| 片手剣 | 00:34:00 | 00:44:55 |
| 双剣 | 00:44:55 | 00:52:05 |
| 大剣 | 00:52:05 | 00:59:10 |
| 太刀 | 00:59:10 | 01:06:19 |
| ハンマー | 01:06:19 | 01:15:12 |
| ランス | 01:35:52 | 01:43:10 |
| 弓 | 02:05:01 | 02:18:50 |
| 最初の採集クエスト | 02:41:50 | 03:03:20 |

大剣の縦斬り・回避の資料候補として [KENTA／MHP2G大剣ティガ実戦](https://www.youtube.com/watch?v=sPe3CmNjhlo) も確認した。説明文は「振り向きへの縦斬り・前転回避の位置と角度」を扱うと述べるが、動画内の技時刻と各姿勢は未取得。

## S2：PSP 2Gの技構成を文字で照合

- [PSP版 MHP2G@Wiki／大剣](https://w.atwiki.jp/mhp2g/pages/146.html)：縦斬り、溜め斬り、○の薙ぎ払い、△＋○の斬り上げ、抜刀斬り、前転、武器による防御。技が存在すること、操作の区別には利用できる。**骨格のキー姿勢・秒数・足の位置は載っていない。**
- [shuraba／PSP MHP2G 大剣](https://shuraba.com/?p=game%2FMHP2G%2F%E5%A4%A7%E5%89%A3%2F)：抜刀（溜め）斬り→回避→納刀の基本動線の説明に利用。KariのMVや時刻を原作の値へ移植しない。
- [CAPCOM公式MHFUガイドPDF](https://static.capcom.com/monsterhunter/MH_LRG.pdf)：海外版は補助資料。日本PSP版と同一と確認していない点を区別する。

**用語の保留：** 依頼文の大剣 `side_sweep=横殴り` と、PSP版大剣の `○=薙ぎ払い` は、同じ動作として確定していない。横殴りを別技として追加する必要があるか、該当する映像とKariの既存アクションを照らし合わせる。

## S3：Kari現行の正本

- `public/data/actions/heavy_blade.json`：大剣7行動。縦斬り72tick（判定22〜29）、薙ぎ66tick（18〜26）、斬り上げ66tick、後段54tick、抜刀斬り64tick、抜刀26tick、納刀44tick。
- `public/data/actions/player_common.json`：前転36、回復124、研磨120、剥ぎ取り100など。
- `public/data/actions/{guard_blade,twin_blades,war_maul,long_blade,long_lance,ring_bow}.json`：各武器の抜刀・納刀のIDと現行尺。
- `public/data/weapons.json`：武器種ごとの握り位置・軸・刃先までの距離。
- `src/render/poses.ts`、`src/render/heavyBodyMotion.ts`、`src/render/hunterAnim.ts`：現在の仮動作。2Gの映像観察データではない。

**写真・映像は提出していない。** 素材を生成した資料に見せるために原作画面を画像化して同梱していない。
