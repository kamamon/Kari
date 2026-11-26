# 2Gで確認できた構造とKari側の提案

## 外部資料で確認した点

- 2Gの「クエスト受付 下位／上位／G級」では、まず受注するクエストのレベルを選ぶ案内がある。これはゲーム内セリフを収録した資料からの確認で、画面画像の計測ではない。
  - https://mh.mtwildwood.net/ja/mhfu/text/quest-counter-low-rank/
  - https://mh.mtwildwood.net/ja/mhfu/text/quest-counter-high-rank/
  - https://mh.mtwildwood.net/ja/mhfu/text/quest-counter-g-level/
- 2Gのクエスト詳細画面の一例では、依頼名、報酬、契約金、制限時間、指定地、対象モンスター、特殊条件をまとめた紙面が表示される。画像を閲覧・参考にしたが、画像の複製・再配布はしない。
  - https://ameblo.jp/iwashi2017/entry-11875488211.html
- 2Gのクエストは受注場所／級／レベル別に区分される。資料にはキークエストを満たした後に次段階へ進む緊急依頼が開く説明がある。**Kariへの昇級条件の追加は今回の目的ではないため変更しない。**
  - https://w.atwiki.jp/mhp2g_ios/pages/102.html

## Kariへの独自提案（原作からの引用ではない）

- 左側の星縦メニュー・縦に短い依頼リスト・右側の紙面を同時に使う横画面レイアウト。
- 44px程度のタッチ領域、選択フォーカス・スクロール保持・iPhone横画面向け調整。
- 既存図鑑WebPの小アイコンと採集・採掘・里納品の識別記号。
- 階層の戻る動作、`startHunt`／`save.deliver`の分岐、Kariの既存保存形式の維持。

原作のUIそのものを忠実に画素単位で再現したと主張しない。参照できた事実と、KariのUX改善のための制作判断を区別する。
