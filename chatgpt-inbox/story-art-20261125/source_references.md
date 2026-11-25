# 参照と来歴

- 採用済みの画風：[style_board_v2.png](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/art-source/board/style_board_v2.png)。参照画像のGit blob SHAはb45bce28850427d46ab1bc8e1d51462348e57b79で一致。
- 人物と物語：[PR #7『帰り道の灯』](https://github.com/kamamon/Kari/pull/7)。再提出基準のmain（v0.27.0）に取り込み済みで、序章と第1章（S0）が実装済み。
- 既存ミナギ：[採用設定文](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/art-source/npc/minagi_v1.md)。同梱2枚は元生成画像。外見は設定文と一致、repo PNGとはバイト差があり同一画素は未確認。
- 職人と商い手：[PR #5](https://github.com/kamamon/Kari/pull/5)、head 005eb849e66aaf142ccab9ec7d7d3624553dbda0。同梱4枚のGit blob SHAが一致。制作時にはロクハ・イサネへの名前対応を提案。再提出基準のmainではPR #5・PR #7が取り込まれ、この対応を使用しています。人物名は仮です。

## PR #5の参照照合

| 元画像 | Git blob SHA |
| --- | --- |
| ref_npc_smith_front_v1.png | 0c62afa3920edab90abbe41c7f260ccf52c5fa80 |
| ref_npc_smith_back_v1.png | 234c7fc786f9f62cbecbd1e4f29bd6df54f2c36d |
| ref_npc_merchant_front_v1.png | 856a5f728bbd7e7190b5c35f30a892a4edca7fb0 |
| ref_npc_merchant_back_v1.png | 295c1ffa8925975b91be32441cd75988c41d743e |

生成画像はimagegenによるオリジナル原画。新規24点の生成指示と参照の依存関係はgeneration_manifest.jsonに記録しています。PNGは切抜き、色変更、リサイズ、画像合成をせず原本のまま収録しました。初回配布PDFは内部画像をJPEG品質90で圧縮し、透過マスクと文字を保持しています。リポジトリ用の軽量閲覧版は、このPDFの画像ストリームだけを追加で再圧縮したものです。詳細はvalidation_reportを参照してください。
