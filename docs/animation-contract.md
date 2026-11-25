# アニメーション規格（docs/animation-contract.md）

モデル・骨・動作を作る側（ChatGPT の設定図 → Blender）と、ゲームへ組み込む側（Claude）の約束事。
ここに無い名前の骨・socket・clip を、似た名前で代用しない。足りない時は「欠落」として報告する。

## 1. 座標と単位

- 単位 m。Y が上、**+Z が前**。キャラクターの右手側は -X（glTF の向きと同じ）。
- 原点は足元（接地面の中央）。基準ハンターの身長は 1.75m。
- 書き出したら、素材ビューアで `assets/models/ref_cube_1m.glb`（1m 立方体と +Z の矢印）と並べて大きさと向きを確かめる。

## 2. 人型の骨と socket

```
root
└ pelvis ─ thighL ─ shinL ─ footL
   │      └ thighR ─ shinR ─ footR
   ├ socket_hip
   └ spine ─ chest ─ neck ─ head
               ├ upperArmL ─ forearmL ─ handL ─ socket_hand_l
               ├ upperArmR ─ forearmR ─ handR ─ socket_hand_r
               └ socket_back
```

| socket | 用途 | 向き |
| --- | --- | --- |
| socket_hand_r | 武器の握り原点（右手） | 武器の +Y が刃先、X が刃の厚み、Z が刃幅 |
| socket_hand_l | 盾・両手持ちの添え手 | 同上 |
| socket_back | 納刀時の武器位置 | 握りが右肩の上、刃先は左下 |
| socket_hip | 腰の道具・片手武器の鞘 | 握りが左腰の前寄り（右手が届く所）、刃先は後ろ下 |

仮リグの寸法（正式モデルを作る時の目安。合わせる必要があるのは socket と骨の名前）:
pelvis 高さ 0.92 / 肩幅 0.37（肩の関節は左右 0.185）/ 上腕 0.29・前腕 0.27 / 大腿 0.43・下腿 0.41。静止姿勢は腕を真下へ下ろした「気をつけ」（値は `src/render/hunterBody.ts` の `REST`）。

大型の骨格（四足重 / 四足軽 / 二足翼 / 多脚 / 長胴）は、代表 1 体を作る時にこの文書へ追記する。

## 3. 時間

- 1 tick = 1/60 秒。区間は開始を含み、終了を含まない。`[22,30)` は 22〜29 tick の 8 tick。
- clip の長さは技データの `durationTicks / 60` 秒に合わせる。違っていたら、クリップを直すか再生速度で合わせるかを相談してから決める。攻撃窓やキャンセルを黙って変えない。
- 行動は開始した tick に 0 tick 目を処理する。
- ヒットストップ中と溜め中は行動の tick が進まず、描画も同じ時刻で止まる。
- v0.23.0（D-092）: ヒットストップの最後まで、処理済みの「当たった tick」の姿勢を描く（`hunterAnim.ts` の `playerRenderTick`）。溜めて止まっている間は、止めた時刻のまま。判定が有効な tick と、弓の発射の tick では、状態の切り替えの混ぜを終えて、正本の軌道に一致させる（`playerContactFrame`）。IK を解いた後に、骨だけを混ぜ直さない（手と武器が離れるため）。

## 4. 移動（root motion）

- clip は **その場（in-place）** で作る。前進は controller が移動曲線（`public/data/curves.json`、[tick, 累積距離 m]）で進める。
- 足の接地は移動曲線に合わせる。例: 縦斬り `hb_step_035m` は 14〜24 tick で 0.33m、30 tick までに 0.35m。
- v0.23.0（D-092。描画だけ）: ふだんの歩き（納刀中は 7 系統とも、抜刀中は断岳剣）は、踏んでいる足の母指球を世界座標に留める（`src/render/contactLocomotion.ts`）。足の運びは、入力の速さではなく、実際に動いた量から進める。止まった時は浮いた足を下ろし、その場で大きく向きを変える時は踏み替える。走りには短い空中の時がある。急に反対へ向きを変えた時は、脚が届かなくなる前に 80ms で留めるのをやめる（その間は、足が滑ることがある）。断岳剣の縦斬り・横薙ぎ・抜刀斬りは、脚を地面に合わせる IK と骨盤の回転・上下・前後で支える（`src/render/heavyBodyMotion.ts`。横薙ぎのひねりは、骨盤 44° と背・胸 48° に分ける）。刃の軌道・技の時刻・移動曲線は変えない。

## 5. 武器の軌道と判定

- `public/data/tracks/*.json` の shapeTrack が判定の正本。アクターのローカル座標で、tick ごとに握り位置 `grip` と向き `dir` を持つ。判定カプセルは `grip + dir × from` 〜 `grip + dir × to`、太さ `radius`。
- 仮アニメーションは武器をこの軌道へ置き、腕を IK で伸ばしている（見える刃 = 判定）。断岳剣はこの方式。
- 護刃・長尖槍・環弓・大槌・双剣・太刀は逆で、**体の動きが先**: 体の動きを解いた握りと向きを、毎 tick 書き出したものが shapeTrack（`tools/gen-weapons.mjs`）。描画も同じ動きを解くので、見える武器と判定は一致する（`tests/human-motion.test.ts` が、全 tick で 2mm 以内を確かめる）。
- 双剣は左手にも剣を持つ。左の剣の判定は `<技>_l` の shapeTrack（同じ解き方から書き出す）。
- この 6 系統の動きは、関節の曲がる範囲・手の届き・手首・重心・足の滑り・速さの検査（`src/render/humanLimits.ts`）を全 tick で通すこと。正式クリップへ替える時も、同じ検査を目安にする。
- 納めた武器の置き場所は、武器系統ごとに持つ（`weaponClipSpecs.ts` の sheath: 付く骨と位置と向き）。socket_back / socket_hip は断岳剣と、正式モデルの目安。
- 正式クリップへ替える時は、クリップの刃の位置と shapeTrack の誤差を検証表示で比べ、**どちらを基準に直すかを先に決める**。

## 6. clip の名前といま必要なもの

`<系統>_<動作>_<連番>`。技データ（`public/data/actions/*.json`）の `clip` と同じ名前にする。

| clip | 対応する技 | 長さ | 備考 |
| --- | --- | --- | --- |
| hb_attack_vertical_01 | player.heavy_blade.overhead | 72 tick | 18 tick が最大振り上げ（溜めの保持姿勢） |
| hb_attack_side_01 | player.heavy_blade.side_sweep | 66 tick | 右後ろ → 左前へ水平に払う |
| hb_draw_slash_01 | player.heavy_blade.draw_slash | 64 tick | 背中から抜いてそのまま振り下ろす |
| hb_draw_01 / hb_sheathe_01 | …draw / …sheathe | 26 / 44 tick | |
| common_roll_01 | player.common.roll | 36 tick | 前転。抜刀中は前後左右の 4 方向が必要（いまは前転を回して代用している仮の処理） |
| common_item_drink_01 | player.item.drink | 92 tick | 回復液を飲む。58 tick で効果（それまでに口元へ） |
| common_item_place_01 | player.item.set_trap | 112 tick | しゃがんで罠を据える。84 tick で設置 |
| common_item_whet_01 | player.item.whet | 120 tick | 片ひざを突いて、ひざの前に渡した武器を研ぐ。96 tick で研ぎ上がる。武器の位置と腕は、描画の側が構えから渡した位置へ動かして手を合わせる（データの軌道は持たない） |
| common_item_throw_01 | player.item.throw_orb | 46 tick | 右手で前へ投げる。22 tick で手を離れる |
| common_carve_01 | player.common.carve | 100 tick | 片ひざを突いて剥ぎ取る。80 tick で素材が手に入る |
| dummy_slam_01 | monster.training_dummy.slam | 130 tick | 訓練標的専用 |

いま手続き生成で代用していて、正式素材では clip が必要なもの（台帳の `clipsPlanned`）:
待機・歩く・走る・疾走（納刀）、構え待機・構え歩行（断岳剣）、防御・防御の反動、怯み・転倒・起き上がり・力尽き。
人型の共通クリップは最終的に 20〜30 本、武器 1 系統で 10〜20 本を見込む（設計書 p.22）。

## 7. イベント

技データの `events`（`tick`、`type`: sound / trail_on / trail_off / vfx、`id`）で発火する。
空振りは振り音だけ。命中音と火花は実際に命中した時に、部位の材質（rock / shell / hide）で切り替える。

## 8. 受け入れ

1. `public/assets/models/` へ GLB を置き、`docs/asset-manifest.json` に id・path・clips を登録する。
2. `npm run assets:validate`（ファイルの実在、clip の対応、id の重複）。
3. 素材ビューアで、大きさ・向き・骨・socket・clip 名と長さ・必須 clip の欠落を確認する。
4. 正面 / 側面 / 背面 / 斜め後ろ、0.25 倍速と 1 tick 送りで、関節の潰れ・貫通・足滑り・握りを確認する。
5. ゲーム内の代表戦闘で同期を確認して、はじめて status を integrated にする。

**未実装**: ゲーム本体はまだ GLB のモデルを使っていない（仮リグのみ）。GLB を読む経路は素材ビューアにあり、基準 GLB で確認済み。正式モデルを受け取った時に、骨名の対応とクリップ再生（GLTFLoader + AnimationMixer）をゲーム側へ入れる（設計書 COPY 07）。
