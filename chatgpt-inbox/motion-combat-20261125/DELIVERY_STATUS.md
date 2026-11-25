# 提出先と収録範囲

設計・差し替えコード・攻撃力データ・検証は完成している。GitHubにはテキストの設計書、全技表、差し替えソースと統合パッチ、検証結果、図とPDFを作るコードを収録した。

GitHubへのPDFのバイナリ登録が完了しなかったため、**34ページの完成PDFは同じ依頼のChatGPT返答から受け取る**。PDFには3枚のCPU形状比較図も収録済み。GitHub側にはPDFとPNGそのものを含めていない。HTMLから画像を表示する場合やPDFを再生成する場合は、下記で図も作る。

コードとデータの適用は、README記載の21ファイルの統合パッチで完結する。PDFやPNGを取得しなくても適用と検証を行える。設計内容は `analysis/rig-design.md`、`analysis/balance-design.md`、全技表、READMEからすべて確認できる。

## 図とPDFの再生成

基点の本体にこのinboxを加えたリポジトリを作業場所とする。READMEの手順で `../Kari-motion-review` に差分を適用し、双方で `npm ci` を済ませる。PythonにはWeasyPrint、markdown-it-py、Pillow、NumPy、システムにはNoto Sans CJK JPが必要。

```sh
node chatgpt-inbox/motion-combat-20261125/qa/export-geometry.mjs . ../kari-geometry-before
node chatgpt-inbox/motion-combat-20261125/qa/export-geometry.mjs ../Kari-motion-review ../kari-geometry-after
python3 chatgpt-inbox/motion-combat-20261125/qa/render_geometry.py ../kari-geometry-before/geometry.json ../kari-geometry-before/images
mkdir -p chatgpt-inbox/motion-combat-20261125/figures
cp ../kari-geometry-before/images/seven-weapons.png chatgpt-inbox/motion-combat-20261125/figures/seven-weapons.png
python3 chatgpt-inbox/motion-combat-20261125/qa/compose-comparisons.py ../kari-geometry-before/geometry.json ../kari-geometry-after/geometry.json chatgpt-inbox/motion-combat-20261125/figures
python3 chatgpt-inbox/motion-combat-20261125/build-report.py
```

図は実際の骨行列・IK・スキニング後の頂点をCPUで計算する。WebGLの画面撮影ではない。再生成したPDFは、ページ数・改ページ・表の幅・文字と図を確認してから使う。`qa/document-verification.json` は会話で提出したPDFの検証記録で、以後再生成した別バイト列の検証を代用するものではない。
