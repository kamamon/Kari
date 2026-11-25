# 拠点設計・最新実装との差分追補（v0.26.0）

## この追補の位置づけ

本提出の原画・図・PDFは、v0.22.0時点の拠点を参照して作成した設計資料です。この追補は、その後に入った既存機能を設計・実装時に取り落とさないためのものです。原資料にある「NPC・会話は未実装」などの記述は、原資料の参照時点についての記録として読み、現在の実装状態は以下で補ってください。

| 項目 | 参照点 |
| --- | --- |
| 原資料の参照 | v0.22.0 / [`4851d57ecc24c8fd127508b084999cec5d0e975f`](https://github.com/kamamon/Kari/commit/4851d57ecc24c8fd127508b084999cec5d0e975f) |
| 今回の読取確認 | v0.26.0 / [`1e078bfce1e68f287ae577cf41d2fe5bafb94afa`](https://github.com/kamamon/Kari/commit/1e078bfce1e68f287ae577cf41d2fe5bafb94afa) |
| 確認日 | 2026-11-25 |

**五段の相対床高 -10 / -3 / 0 / +8 / +22m、全体約120×110m、総高低差32mは、引き続き今回の設計提案です。** 現行ゲームにこの地形を実装したことを示す資料ではありません。四施設を中段周辺へまとめ、工房を-3m、依頼板・商店・装備箱を0mに置く基本案は維持します。

## 1. v0.22.0以降に実装されたもの

### NPCと物語

v0.23.0で、里に立つミナギ・ロクハ・イサネ、物語「帰り道の灯」の序章・第1章、顔絵付きの会話窓、初回帰還時の報告が入りました。依頼板には物語の目的・次の狩り・帰還記録・章の一覧があります。物語の進行は `progress.questClears` から決まり、既読や選んだ返事は保存しません。

| NPC ID | 名前 | 施設との対応 | 現行の `(x, z)` |
| --- | --- | --- | --- |
| `npc.minagi` | ミナギ | `board`（依頼板・受付） | `(2.6, 11.4)` |
| `npc.rokuha` | ロクハ | `workshop`（工房） | `(-10.6, 6.4)` |
| `npc.isane` | イサネ | `shop`（商店） | `(10.6, 6.4)` |

3人はカメラへ向く静止した絵の板です。ロクハとイサネはカメラの位置に応じて正背面を切り替え、ミナギは正面の絵を使います。足元の影と半径0.35mの当たりもあります。**直接話しかける操作、巡回・歩行AI、立体NPCはまだありません。** 会話は依頼板から開きます。セナキは物語の登場人物ですが、里に立つNPCとしては登録されていません。

根拠：[`docs/spec.md` 24・25章](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/spec.md#L917)、[`hub.json`](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/hub.json#L13)。同仕様書冒頭の概況表には古い「NPC未着手」の記述が残るため、後段の仕様と実コードを優先して確認しています。

### 工房からの支給・里納品D09

v0.26.0では、依頼の星・分類・依頼人の話・目安時間に加え、以下が既存の施設画面へ入りました。

| 機能 | 既存の内容と保持するID |
| --- | --- |
| 工房からの支給 | `story.support.tier2`。`quest.basin.003`「岩場の足音」と `quest.selvark.r1`「帆角の風」の両方を達成すると、青銅晶脈3・前脚甲4・硬骨6・岩殻片14を工房で1度受け取れる。装備そのものは替わらない |
| 里納品D09 | `quest.delivery.009`「余った岩殻片を修繕に」。`quest.basin.003`の達成後、倉庫の `mat.galdros.shell_shard` を2個渡して250通貨。納品後14個以上を残すため、16個以上必要。1度限り |

D09は、**依頼板の依頼欄にある納品機能**です。現在の3D拠点に第五の施設や独立した納品台が追加されたわけではありません。「納品する」の後に渡す数・残る数・報酬等を確認し、「渡す」で確定する流れを保ってください。設計画の受付納品台を造作する場合は、この既存機能との対応を実装時に決めます。

根拠：[`docs/spec.md` 26章](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/spec.md#L955)、[`support.json`](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/support.json#L4)、[`deliveries.json`](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/deliveries.json#L4)。

## 2. 四施設の移設で保持するもの

四施設のID・種類は変わっていません。施設と担当NPCを一緒に移設し、以下の画面と機能を維持してください。

| 施設ID | `kind` | 維持する役割 |
| --- | --- | --- |
| `board` | `quest` | 依頼受注、訓練場、物語・会話・帰還記録、里納品D09 |
| `workshop` | `workshop` | 武器・防具の強化、持ち物、工房からの支給 |
| `shop` | `shop` | 道具購入、素材売却、持ち物 |
| `chest` | `chest` | 武器・防具の変更、持ち物、保存データの書き出し・取り込み・控え |

里を歩いて施設画面を開く操作、画面を開いている間の一時停止、「里へ戻る」、右上の「一覧」から歩かずに各欄を使う経路も維持します。高低差によって、頻繁な準備操作に不要な往復を増やさない設計とします。

保存の現行版は **`schemaVersion = 4`** です。支給・納品を1回に制限する `claims`、物語や依頼の達成を持つ `progress.questClears`、既存の依頼・素材・支給IDを保ってください。納品時の素材減算・通貨加算・達成回数・受領記録は同じ書き込みで確定し、書き込み内で条件を再確認する仕組みを維持します。`claims` は、古いものを捨てる `settledRuns` とは別です。

根拠：[`hub.json` 四施設](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/hub.json#L7)、[`docs/spec.md` 19章](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/docs/spec.md#L500)、[`profile.ts` 保存の版](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/save/profile.ts#L11)、[同・支給と納品の処理](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/save/profile.ts#L407)。

## 3. 高低差の採用前に必要な実装

現在も拠点は48×34m、`platforms: []` の平面です。四施設の位置はv0.22.0から変わらず、map側にはNPC3人の当たりが追加されています。`src/game/world.ts` と `src/render/camera.ts` は、今回比較した両コミットで内容が一致しました。

| 対象 | 現行の制約 | 今回の設計を採用する時の対応 |
| --- | --- | --- |
| 地面・段差 | `groundHeight(x,z)` は0を初期値に、そのXZを含むplatformの最大高を返す。platformは矩形の水平面。`stepUp`は0.35m | 負の相対床高、坂・階段、各段の連絡経路を扱う。基準を+10mずらす場合の内部床高は0 / 7 / 10 / 18 / 32mとなるが、座標の変更だけでは地形・動線の実装は済まない |
| 橋・上下の通路 | 同じXZに対して地面の高さを1つしか返さない | 橋上・橋下をともに歩く箇所は、多層の歩行面と床の選択を実装する |
| 建物・施設案内輪 | 建物は`y=0`、案内輪は`y=0.03`に固定 | 施設の床・建物基部・案内輪の高さを揃える |
| NPC本体・影 | NPC本体は`y=0`、影は`y=0.02`に固定 | 担当施設とともに移設し、NPCの接地・影・当たりを同じ床へ対応させる |
| 当たり・カメラ | 移動時の岩・建物・NPCの押し出しはXZのみ。カメラは地面高と0基準の円柱高さを参照する | 上下階の当たりを区別し、高架橋・屋根・階下の壁で移動やカメラが誤って妨げられないようにする |
| 施設の起動範囲 | `Math.hypot(f.x-p.x, f.z-p.z)`によるXZ距離だけ | 上下の別階から同じ施設を誤って開かないよう、高さまたは所属床の条件を加える |
| 配置の検査 | `validateHub`は施設前、NPC、spawn、当たりの対応と離隔を平面で検査する | 既存検査を維持し、各段の接地・到達可能性・別階の判定も確認する |

NPCの現行当たりは `maps/hub_village.json` の末尾3件です。また `hubScene.ts` は `map.rocks[hub.facilities.length]` を広場の灯として扱います。配置データを組み替える場合、この順序依存を保つか、明示的な参照へ変更する必要があります。

根拠：[`hub_village.json`](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/public/data/maps/hub_village.json#L5)、[`world.ts` 地面と移動](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/game/world.ts#L157)、[`hubScene.ts` 建物・案内輪・灯](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/render/hubScene.ts#L219)、[`npcSprites.ts` 本体と影](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/render/npcSprites.ts#L59)、[`camera.ts`](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/render/camera.ts#L68)、[`app.ts` 施設判定](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/app.ts#L633)、[`validators.ts` 拠点検査](https://github.com/kamamon/Kari/blob/1e078bfce1e68f287ae577cf41d2fe5bafb94afa/src/data/validators.ts#L502)。

## 4. 今回の確認範囲

固定コミットの仕様・JSON・TypeScriptを読み、旧版との関連差分を照合しました。ゲームの起動、画面上の見え方、歩行経路の試遊、カメラ挙動、iPhone実機の表示・操作・性能は、この追補では検証していません。NPCの生活動作、直接会話、多層の通路、五段の地形は追加実装項目です。

原画・図・PDFの寸法、施設配置、見通し、移動時間は設計の目標として扱い、地形の試作後に実測・試遊で調整してください。この追補によるゲームコード・データ・保存形式の変更はありません。
