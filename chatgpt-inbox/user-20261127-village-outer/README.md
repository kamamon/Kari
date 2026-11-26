# 灯継ぎの里：山岳外周の景観強化案（2026-11-27）
この提出は利用者の直接依頼「拠点の外側を、山の中にいる実感のある景観へ変更してGitHubに反映」を受けたデザイン納品です。

**状態：原画を踏まえた新規のSVG景観資料と位置案をGitHubのPRで提出。ゲーム本体の実装・採用・公開は未実施。**
[AGENTS.md](../../AGENTS.md) に従い `chatgpt-inbox/` 以外は変更していません。Claude が `src/` と `public/` の実装を担当します。

## 提出物
- `art/00_composition_preview.svg`：遠景・崖集落・手前の木立を重ねたオリジナルのベクター景観提案（視認用）。
- `art/01_mountain_far.svg`：青灰色の遠い山脈、稜線、針葉樹、谷霧、遠い見張り灯。
- `art/02_cliff_settlement_mid.svg`：水の筋、岩棚、木造の見張り小屋、吊橋、手摺、尾根。
- `art/03_valley_foreground.svg`：石・木立・灯で拠点を包む近景フレーム。
- `outer_layout_v1.json`：**32か所**の外周景観案と既存地形を保つ条件、7視点の点検表。
- `design_rules.md`：原画との整合・山里らしい暮らし・背景の密度管理。
- `implementation_handoff.md`：Claude向けのP0～P2と具体的な確認条件。
- `originals_manifest.md`：今回のリクエストで制作済みの高精細原画2点との対応。

## 最新Kariで確認した前提（v0.59.0）
- 拠点は既に標高 `-10, -3, 0, +8, +22m` の5段、生活の道と見晴らしの道を持つ（v0.35.0）。
- 世界の位置の正本は `public/data/hub.json`、生成地図は `npm run hub:gen` の出力 `public/data/maps/hub_village.json`。
- 描画の接続先は `src/render/hubScene.ts::buildHubGroup` と `src/render/villageScene.ts::buildVillage`。後者に背後の岩山（z約70〜75）・水車・煙・滝・音が存在する。
- 既存の級別受付、NPC、狩場へ向かう門、閉ざされた谷への門は変更しない。

## 守れなかったこと・迷ったこと・未検証
- AGENTS.md上、ChatGPTは描画仕様と制作資料を出し、実装はClaude担当なので、ゲームの見た目を直接変更していない。**「PR提出」と「ゲーム画面へ反映」は別**。
- 以前この会話で生成した1672×941pxの高精細原画2点はローカルで参照できたが、今回のPRへ原本PNGを転送していない。ここへ収録した4点は原本の同一画像ではなく、別途作画した自立したベクター資料。
- 2D SVGの形は3D建物・通れる橋・完成テクスチャではない。現行の固定地形や施設位置を優先して位置はラフ提案。地形干渉・カメラ・実機FPS・音・雨・夜の見え方は未検証。
