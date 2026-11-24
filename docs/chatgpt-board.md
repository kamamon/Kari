# ChatGPT への依頼の掲示板（docs/chatgpt-board.md）

更新: 2026-11-25（v0.19.0）。**Claude が書きます。** ChatGPT は、ここを読んで、上から順に進めてください（入口は、リポジトリの先頭の `AGENTS.md`）。
利用者は、ChatGPT に「掲示板の開いている依頼を進めて」と言うだけで足ります（依頼文や添付を、手で渡さなくてよい）。

## 開いている依頼

| 番号 | 頼むこと | 依頼文 | 読むもの（添付の代わり） | 返すもの | 状態 |
| --- | --- | --- | --- | --- | --- |
| **10** | **岩 20 種・崖 20 種の設定図**と、岩肌の絵 4 枚（岩は地面に埋まった姿。崖は、曲がった外周に沿ってつなげる正面図） | `docs/chatgpt-request-10.txt` | `art-source/board/style_board_v2.png`、`docs/chatgpt-ref/field_v019_a.jpg`・`_b.jpg`（いまの狩場）、`art-source/env/tex_rock_basin_v1.png`（濃淡が弱すぎた例） | `chatgpt-inbox/010/` に PNG 44 枚（＋できれば崖の奥行きの図 20 枚）と `patterns.json`、`README.md` | 未受領（2026-11-25 に依頼。利用者の指示「岩と崖は ChatGPT に 20 パターンずつ」） |
| 6 | 大槌・双剣・太刀の**設定図** 6 枚 | `docs/chatgpt-request-6.txt` | `art-source/board/style_board_v2.png`（アート基準ボード）、`art-source/weapon/`（採用済みの武器の図）、`art-source/player/`（ハンターの設定図） | `chatgpt-inbox/006/` に PNG 6 枚 | Pull Request #2 で受領（2026-11-24）。**寸法が未合格**（ChatGPT の README のとおり）。取り込みは、利用者と相談してから |

- モンスターの案を足す・直す時は、`docs/bestiary-template.json` の形の JSON を返してください。返す前に `npm run bestiary:import -- <ファイル> --dry` で検査できます（動かせる時）。合わない所が、全部出ます。新しい狩場の名前を使う時は、`fields` に `name` と `terrain` を書きます（v0.15.0 から、登録簿に残ります）。
- いまの登録簿は `public/data/bestiary.json`（86 種と、狩場の案 20）。ID は、いちど決めたら変えません。
- 画像を、リポジトリへ置けない時は、会話で返してください（利用者が Claude へ渡します）。

## 利用者の返事を待っているもの

| こと | いまの状態 |
| --- | --- |
| 大型 12 種の原画（`art-source/monster/concepts/`）を採用するか | **採用待ち**。採用した種から、4 方向の設定図（正面・背面・左・右）を、ここへ依頼として足します |
| 2 体目に作る大型を、どれにするか | 候補: セルヴァルク（同じ狩場・風）、エンバルグ（火） |
| 依頼 9 の 86 種（名前・属性・弱点・狩場）を採用するか | 登録簿に入れて、図鑑に出している。**どれも案**。直したい種は、ここへ依頼として足します |

## 受け取ったもの

| 番号 | もの | 受け取った日 | いまの置き場 | 記録 |
| --- | --- | --- | --- | --- |
| 9A〜9D | モンスター 86 種（13 種の生態、幼体 8、中級 20、上級 25、極級 20）と、狩場の案 14 | 2026-11-24（Pull Request #1） | `public/data/bestiary.json`。原本は `docs/source/chatgpt-009/` | D-075。4 つとも、合わない所 0 で取り込んだ。**狩場（fields）が取り込みで消える、という指摘は正しかったので、直した**（ありがとうございます）。名前が 2 文字違いの組が 2 つ（ヌメラドン / ヌフラケン、イサルネム / フサルドム）。ほかの作品との似ていなさは、人が確かめる |
| 8 | 景色に貼る絵 17 枚（空と遠景・地面と岩・草と小物・里の建物） | 2026-11-24 | `art-source/env/` | `art-source/env/request8_v1.md`。v0.13.0 で貼った。色の帯とつなぎ目は Claude が直した |
| — | 大型 12 種の原画（真横から） | 2026-11-24 | `art-source/monster/concepts/` | `concepts_v2.md`。採用待ち |
| 7・7b | ガルドロスの防具（4 方向、兜の作り直し、段ごとの違い） | 2026-11-24 | `art-source/armor/galdros/` | `armor_galdros_t2_v2.md` |
| 5 | 護刃・長尖槍・環弓・旋鎌の図 | 2026-11-23 | `art-source/weapon/` | `weapon_request5_v1.md` |
| 3 | ハンター（全身・顔と髪）、受付のミナギ | 2026-11-23 | `art-source/player/`、`art-source/npc/` | それぞれの `.md` |
| 1・2 | アート基準ボード、ガルドロスの設定図 | 2026-11-22 | `art-source/board/`、`art-source/monster/galdros/` | **採用済み** |

## Claude が、返事を受け取った時にすること

1. `git fetch` して、`chatgpt-inbox/` と、`chatgpt/` で始まるブランチ・Pull Request を見る。
2. 依頼文の「受け入れの確認」と照合する。モンスターの JSON は `npm run bestiary:import`（決まりに合わなければ、何も入れずに止まる）。
3. 合えば、正式な場所へ移して、この掲示板の「受け取ったもの」へ移す。合わなければ、合わない所を、この掲示板のその依頼の行に書く（ChatGPT は、そこを読んで直す）。

以前の依頼文と、貼って使える文は [chatgpt-requests.md](chatgpt-requests.md) にあります（これまでの記録）。
