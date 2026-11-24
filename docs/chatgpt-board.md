# ChatGPT への依頼の掲示板（docs/chatgpt-board.md）

更新: 2026-11-24（v0.14.0）。**Claude が書きます。** ChatGPT は、ここを読んで、上から順に進めてください（入口は、リポジトリの先頭の `AGENTS.md`）。
利用者は、ChatGPT に「掲示板の開いている依頼を進めて」と言うだけで足ります（依頼文や添付を、手で渡さなくてよい）。

## 開いている依頼

| 番号 | 頼むこと | 依頼文 | 読むもの（添付の代わり） | 返すもの | 状態 |
| --- | --- | --- | --- | --- | --- |
| 9A | いまの大型 13 種の**生態**（8 項目）と、**幼体** 8 種以上 | `docs/chatgpt-request-9.txt` の A | `docs/bestiary-template.json`（返す形の見本）、`public/data/bestiary.json`（いまの登録簿）、`art-source/monster/concepts/`（12 種の原画）、`art-source/monster/galdros/`（ガルドロスの設定図） | `chatgpt-inbox/009/bestiary_9A.json` | 未受領 |
| 9B | **中級**から出る 20 種（亜種 8・超大型 3・原種 9） | 同じ依頼文の B | 上と同じ。9A で自分が作った種も使える | `chatgpt-inbox/009/bestiary_9B.json` | 未受領（9A の後） |
| 9C | **上級**から出る 25 種（希少種 8・亜種 5・超大型 3・原種 9。2 体で出る組を 10 以上） | 同じ依頼文の C | 上と同じ | `chatgpt-inbox/009/bestiary_9C.json` | 未受領（9B の後） |
| 9D | **極級**から出る 20 種（希少種 5・超大型 4・原種 11。複合属性を 6 以上） | 同じ依頼文の D | 上と同じ | `chatgpt-inbox/009/bestiary_9D.json` | 未受領（9C の後） |
| 6 | 大槌・双剣・太刀の**設定図** 6 枚 | `docs/chatgpt-request-6.txt` | `art-source/board/style_board_v2.png`（アート基準ボード）、`art-source/weapon/`（採用済みの武器の図）、`art-source/player/`（ハンターの設定図） | `chatgpt-inbox/006/` に PNG 6 枚 | 未受領（2026-11-23 に依頼） |

- 9A〜9D は、A → D の順に、返事を待たずに続けて作って構いません。亜種・希少種・幼体は、もとの種が先に入っていないと、検査で止まります。
- モンスターの JSON は、返す前に `npm run bestiary:import -- <ファイル> --dry` で検査できます（動かせる時）。合わない所が、全部出ます。
- 画像を、リポジトリへ置けない時は、会話で返してください（利用者が Claude へ渡します）。

## 利用者の返事を待っているもの

| こと | いまの状態 |
| --- | --- |
| 大型 12 種の原画（`art-source/monster/concepts/`）を採用するか | **採用待ち**。採用した種から、4 方向の設定図（正面・背面・左・右）を、ここへ依頼として足します |
| 2 体目に作る大型を、どれにするか | 候補: セルヴァルク（同じ狩場・風）、エンバルグ（火） |

## 受け取ったもの

| 番号 | もの | 受け取った日 | いまの置き場 | 記録 |
| --- | --- | --- | --- | --- |
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
