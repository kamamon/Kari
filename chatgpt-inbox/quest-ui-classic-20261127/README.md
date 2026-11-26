# Kari クエスト受付：2G型・三段階選択 UI 案

ユーザー指示（2026-11-27）：「掲示板見にくい。2Gのようなクエスト選択にしたい。」

## 1. 対応

いまの **4か所の級別受付** はそのまま残す。受付を開いたら「★の一覧 → 依頼名の縦一覧 → 依頼書の確認 → 受注確認」の順で進む。現行の「★を横に並べ、その下に大きいカードを並べる」形式をやめる。

**狙いは2Gの情報設計・操作の再現であり、画像・文章・効果音・ロゴの複製ではない。** 木製枠、霧色の装飾、羊皮紙などはKari固有のデザインとして制作する。

## 2. 提出内容

- `integration_spec.md`: 実際のKari v0.59.0 のクラスとファイルに接続する実装仕様。
- `qa_checklist.md`: iPhone横画面・キーボード・パッド・納品・保存等の受入条件。
- `reference_notes.md`: 2Gを調べて確認できた操作の骨格と、今回の独自設計の区別。

利用者へは、同時に**単体で開いて試せるHTMLプロトタイプ**を会話で配布する。HTMLには数件の例示だけを入れており、ゲームの39件などの正本の代わりではない。モンスターのアイコンは体裁上の記号であり、正式実装ではゲーム内の図鑑画像を再利用する。

## 3. 参照した現行

- `src/ui/base.ts`: `BaseScreen.renderQuests`、`renderReceptionDetail`、`renderDeliveryDetail`、`receptionStates`、`openStoryQuest`、`setOpen`
- `src/ui/questReception.ts`: `receptionGroups()`、`questIconStrip()`、`deliveryIconStrip()`
- `src/ui/style.css`: `.reception-stars`、`.reception-row`、`.reception-detail`、`.reception-scroll`
- `public/data/hub.json`: `board` / `board.r2` / `board.r3` / `board.r4` の各 `questRankId`
- `public/data/quest_board.json`: 星・依頼人・依頼文・目標時間
- `AGENTS.md`、`docs/chatgpt-board.md`、`README.md`: v0.59.0

## 4. 制約・未確認

`AGENTS.md`に従い、書き込みは本フォルダだけ。**本体・公開版にはまだ反映されていない。** Claudeが`src/`等へ実装・テスト・公開を行う。

参照元の2Gの実機メニューについて、級別の窓口・レベル選択・受注詳細という流れはWeb文献で確認。実機の全状態遷移・画素数・効果音・タッチ操作は未観察で、以下の細部は独自の制作提案。

今回ゲーム側コードを動かしていないため、`npm ci`、`npm run check`、ブラウザ操作検査、実機試遊は未実施。**プロトタイプのJavaScript構文は`node --check`で合格**。これは本体の動作保証ではない。

## 5. 適用順

1. `integration_spec.md`の状態機械を`BaseScreen`に導入する。
2. 既存の縦カードを短い行、詳細を右側の依頼書へ置き換える。
3. 未解放・受注確認・里納品の特殊操作を正本のAPIにつなぐ。
4. `qa_checklist.md`の検査と`npm run check`、実機iPhoneを確認する。
5. 受入れ後、Claudeが公開する。

今回の3桁の掲示板依頼番号は無いので、他の依頼の番号を流用せず日付付きの提出先とした。
