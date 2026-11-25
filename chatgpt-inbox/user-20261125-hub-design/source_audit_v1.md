# 参照元と監査の範囲

## 二つの参照点

- 原設計・原PDF：v0.22.0、`4851d57ecc24c8fd127508b084999cec5d0e975f`。
- 提出前の現状確認：v0.26.0、`1e078bfce1e68f287ae577cf41d2fe5bafb94afa`。
- 確認日：2026-11-25 JST。

原PDFは完成時の内容を保存しています。原PDF内の「NPC等は未実装」という記述を現在の状態へ流用せず、[v0.26追補](latest_state_addendum_v026.md)で補ってください。今回のMarkdown設計は保存済みPDFから内容を再構成したものです。

## 原PDFの参照表

| 記号 | 原資料が確認したもの | 固定参照 |
| --- | --- | --- |
| S1 | 里の名称、四施設、ID | [public/data/hub.json](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/public/data/hub.json) |
| S2 | 48×34mの現行拠点、仕様19・21章 | [docs/spec.md](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/docs/spec.md) |
| S3 | 地面高さ、移動、段差、当たり | [src/game/world.ts](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/src/game/world.ts) |
| S4 | ハンター身長1.75m、半径0.38m、歩行4.0m/s | [public/data/player.json](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/public/data/player.json) |
| S5 | カメラ距離5.2m、縦FOV58°、衝突 | [src/render/camera.ts](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/src/render/camera.ts) |
| S6 | XZによる施設接近判定、メニュー | [src/app.ts](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/src/app.ts) |
| S7 | 既存の景観素材依頼 | [docs/chatgpt-request-8.txt](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/docs/chatgpt-request-8.txt) |
| S8 | 採用アート基準 | [art-source/board/style_board_v2.png](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/art-source/board/style_board_v2.png) |
| S9 | 担当、変更範囲、提出方法 | [AGENTS.md](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/AGENTS.md) |
| S10 | 建物・施設輪の描画 | [src/render/hubScene.ts](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/src/render/hubScene.ts) |
| S11 | 床と施設のデータ定義 | [src/data/schemas.ts](https://github.com/kamamon/Kari/blob/4851d57ecc24c8fd127508b084999cec5d0e975f/src/data/schemas.ts) |

## 提出前の読み合わせ

最新の[掲示板](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/chatgpt-board.md)、[AGENTS.md](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/AGENTS.md)、[提出方法](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/chatgpt-inbox/README.md)を確認しました。最新のNPC・会話・支給・納品・保存とそのコード根拠は[追補](latest_state_addendum_v026.md)へ集約しています。

`world.ts` と `camera.ts` の関連実装は原参照版と最新版で同じです。拠点の `platforms` は引き続き空で、五段構成は新しい設計提案です。追加されたNPCも床高対応に含める必要があります。

## 数値の扱い

| 数値 | 区分 |
| --- | --- |
| 48×34m、現行施設・NPC座標、現行カメラ・プレイヤー設定 | 固定参照版の既存データ |
| -10 / -3 / 0 / +8 / +22m、32m、約120×110m | 今回の提案値 |
| 経路長45〜65m・75〜100m | 試作時に目指す値。図面実測ではない |
| 約11〜16秒・19〜25秒 | 上記経路長÷4.0m/sの理論下限。操作や階段を含む実時間ではない |
| 1672×941px等、容量、ハッシュ | 収録ファイルをプログラムで計測した値 |

この監査は仕様・コード・制作資料の確認です。ゲーム起動、実機試遊、描画性能の測定結果ではありません。
