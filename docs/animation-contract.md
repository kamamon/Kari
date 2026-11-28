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
見た目の体型（v0.28.0。`docs/spec.md` の 28 章）は、骨の位置・長さ・socket・身長を変えない。体の皮と防具の頂点だけを、静止姿勢で広げる・寄せる（`src/render/appearance.ts` の `deformBody`）。clip と武器の軌道は、どの体型でも同じものを使う。

大型の骨格（四足重 / 四足軽 / 二足翼 / 多脚 / 長胴）は、代表 1 体を作る時にこの文書へ追記する。

### 2.1 ガルドロスの骨（四足重の代表。v0.30.0。ChatGPT のモンスターの解剖 #12 の M1。D-111。v0.36.0 で M2 の 26 本を足して 79 本。D-118）

- 骨 79 本の **名前・番号・親** は `src/render/galdrosBones.ts` の表（`GALDROS_BONES`）だけが決める。番号は 0〜52 が v0.29.0 までと同じ（Skeleton の並び = 皮と岩板の重みの番号）、53〜78 が v0.36.0 で足した 26 本（設計の表の並び）。コードは番号を直接書かず、足し算もしない（尾・脚・岩板・まぶたは、表の並びの配列 `GALDROS_TAIL`・`GALDROS_LEGS`・`GALDROS_PLATES`・`GALDROS_LIDS`）。
- 名前は #12 の設計の 79 ノードの名前（`docs/source/chatgpt-monster-anatomy-20261125/galdros_rig_blueprint_recovered_v3.json` の「現行 N」）: `root`・`body`・`lumbar`・`pelvis`・`thorax`・`chest`・`ribs_l`・`neck_01`・`neck_02`・`head`・`jaw`・`tongue_01`・`lid_l`/`lid_r`・`tail_01`〜`tail_08`（`tail_05` が切断面）・`fore_upper`/`fore_lower`/`wrist`/`palm`（左右）・`hind_upper`/`hind_lower`/`hock`/`metatarsus`（左右）・岩板 15（`plate_back_01_l` など）。名前は変えない（表示名ではない）。
- v0.36.0（M2）で足した 26 本: `scapula_l`/`_r`（肩甲）・`ribs_r`（右の胸郭。`ribs_l` は左だけになった）・`tongue_02`（舌の先）・`eye_l`/`_r`（眼）・`fore_lower_twist_l`/`_r`・`hind_lower_twist_l`/`_r`（前腕と下腿のねじれ）・`digit_01`〜`04`（前脚の前向きの 4 趾。内 → 外）と `digit_05`（けづめ。親は `wrist`）（左右）・`toes_inner`/`middle`/`outer`（後脚の趾の 3 群。左右）。基準の位置は設計の表の値（`GALDROS_NEW_BONE_REST`）。
- 設計との違い: 前脚の上腕の設計の親は肩甲だが、肩甲は **上腕の親にしない**（上腕の付け根 = 判定の軌道データの肩の位置を変えないため）。肩甲は `chest` の子の枝の骨で、上腕の振りに付いて傾き・滑り、付け根のふくらみだけを曲げる（表の `designParent` に設計の親を控える）。ねじれの骨も、脚の関節を解く鎖に入れない枝（足のねじれの半分を、下の節の先の皮へ配る）。後脚の 3 群は皮の範囲で、爪は 4 本のまま近い群に付く（内・中・中・外）。
- 種類: `deform`（皮・岩板・爪を曲げる。78 本）と `control`（動かすだけ。`root` の 1 本）。重みと合うことを検査する。socket は、いまのガルドロスには無い（#12 でも 12 の socket の定義は復旧できていない。正式モデル化の入口で、親の骨・体の空間の位置・向き・使う技・壊れた時の扱いを決める）。
- 骨は 2 段で組む（`buildBoneTree`: 先に全部を作り、後で親へつなぐ。親が子より後ろの番号でもよい。親の基準の向きの逆で、子の基準を親の中の値へ直す）。
- 足した骨の動き（描画だけ。v0.29.0 までの 53 本の動きは変えない）: 眼はまぶたと別に狩人を追う（0.32 rad まで）。舌の先は舌を出す間に反る。胸郭は左右同じに息をし、横倒しの時は上の側が大きい。肩甲は上腕の前後の振りの 3 割で傾き、7cm/rad 滑る。趾は踏み出しの間に曲がり、着地で開き、打ち付ける脚は爪を立てる。足は接地している間、体が向きを変えても向きを保ち（0.6 rad まで）、ねじれの骨が足のねじれの半分を受ける。**ひじ・ひざの補正形状**: 皮のメッシュの形の変化（morph target）4 つ。上下の節を半分ずつ混ぜる関節の輪が、曲げると cos(曲げ / 2) 倍に細る分を、曲げの量から決めた強さで戻す（頂点の数は変えない）。
- 検査（`tests/galdros-rig.test.ts`）: 表と設計の 79 ノードの対応（足した 26 本は 53 番から設計の並び・設計の親）、体の骨と表の一致、基準の位置が設計の表（小数第 3 位）と 0.6mm 以内、deform / control と重み、2 段の組み方、番号の足し算が無いこと、**待機・全部の技（23）・尾を切られた後の尾払いの、v0.29.0 までの 53 本の姿勢が v0.29.0 と 0.1mm 以内で同じ**（記録は `tests/fixtures/galdros_pose_v029.json`。形や動きをわざと変えた時だけ `GALDROS_POSE_BAKE=1` で作り直す）。v0.36.0: 重み（合計 1・4 本まで・胸郭の左右・足した骨がどれも使われる）、ひじ・ひざの断面（全部の技・眠る・転倒・気絶・死で最も曲げた時も基準の 9 割以上。補正が無いと 8 割より細る）、眼とまぶたが別、舌の先・胸郭・肩甲、趾と足の向き。

## 3. 時間

- 1 tick = 1/60 秒。区間は開始を含み、終了を含まない。`[22,30)` は 22〜29 tick の 8 tick。
- clip の長さは技データの `durationTicks / 60` 秒に合わせる。違っていたら、クリップを直すか再生速度で合わせるかを相談してから決める。攻撃窓やキャンセルを黙って変えない。
- 行動は開始した tick に 0 tick 目を処理する。
- ヒットストップ中と溜め中は行動の tick が進まず、描画も同じ時刻で止まる。
- v0.23.0（D-092）: ヒットストップの最後まで、処理済みの「当たった tick」の姿勢を描く（`hunterAnim.ts` の `playerRenderTick`）。溜めて止まっている間は、止めた時刻のまま。判定が有効な tick と、弓の発射の tick では、状態の切り替えの混ぜを終えて、正本の軌道に一致させる（`playerContactFrame`）。IK を解いた後に、骨だけを混ぜ直さない（手と武器が離れるため）。

## 4. 移動（root motion）

- clip は **その場（in-place）** で作る。前進は controller が移動曲線（[tick, 累積距離 m]。ハンターの曲線は v0.57.0 から `public/data/curves_player.json`（`tools/gen-weapons.mjs` の出力）、モンスターは `curves.json`・`curves_creatures.json`）で進める。
- 足の接地は移動曲線に合わせる。例: 縦斬り `hb_step_035m` は 14〜24 tick で 0.33m、30 tick までに 0.35m。
- v0.23.0（D-092。描画だけ）: ふだんの歩き（納刀中は 7 系統とも、抜刀中は断岳剣）は、踏んでいる足の母指球を世界座標に留める（`src/render/contactLocomotion.ts`）。足の運びは、入力の速さではなく、実際に動いた量から進める。止まった時は浮いた足を下ろし、その場で大きく向きを変える時は踏み替える。走りには短い空中の時がある。急に反対へ向きを変えた時は、脚が届かなくなる前に 80ms で留めるのをやめる（その間は、足が滑ることがある）。断岳剣の縦斬り・横薙ぎ・抜刀斬りは、脚を地面に合わせる IK と骨盤の回転・上下・前後で支える（`src/render/heavyBodyMotion.ts`。横薙ぎのひねりは、骨盤 44° と背・胸 48° に分ける）。刃の軌道・技の時刻・移動曲線は変えない。
- v0.28.1（D-108。描画だけ。利用者の指摘「歩くたびにバウンドするのは不自然」）: ふだんの歩き・走り（納刀中の 7 系統と抜刀中の断岳剣は `travelGait`、抜刀中のほか 6 系統は `gaitFeet`）で、**腰の上下を、足の運びに合わせたなめらかな 1 つの波にした**（4cm 以内。歩きは片足で立つ真ん中が高く、走りは片足の真ん中が低い）。接地の長さを脚が届く範囲（納刀 0.64〜0.74m・抜刀 0.62m。着く所は体の前 4 割まで）にし、歩幅がそれより長い時は両足が浮く間を作る。1 周の長さは速さから（`freeStride`。1.2m/s で約 1.1m・4m/s で約 2.2m・6.4m/s で約 2.9m。位相を進める側と足を置く側で同じ値）。かかとの角度は、浮いた後も歩き方のとおりに続ける（離れた瞬間に足首が下がらない）。足が届かずに腰を落とした時は、戻すのを 0.3m/s までにする（跳ね上がらない）。

## 5. 武器の軌道と判定

- `public/data/tracks/*.json` の shapeTrack が判定の正本。アクターのローカル座標で、tick ごとに握り位置 `grip` と向き `dir` を持つ。判定カプセルは `grip + dir × from` 〜 `grip + dir × to`、太さ `radius`。
- v0.56.0 までの断岳剣は、武器をこの軌道へ置き、腕を IK で伸ばしていた（見える刃 = 判定）。この方式は保留の組 v056 に残っている（下の「動きの組」）。
- v0.57.0 から 7 系統とも（断岳剣も）、**体の動きが先**: 体の動きを解いた握りと向きを、毎 tick 書き出したものが shapeTrack（`tools/gen-weapons.mjs`）。描画も同じ動きを解くので、見える武器と判定は一致する（`tests/human-motion.test.ts` が、全 tick で 2mm 以内を確かめる）。
- 双剣は左手にも剣を持つ。左の剣の判定は `<技>_l` の shapeTrack（同じ解き方から書き出す）。
- **刃の面の向き**（v0.40.0。D-127）: 軌道の `planeNormal`（武器の +X）と、キーごとの `normal`（描画だけ。当たりの形には関わらない）で決める。武器の +Y = `dir`、+X = `normal` を `dir` に直交させたもの、+Z = X × Y で、断岳剣の刃は -Z。**刃が振る向きの前に来る**ように置く（v0.39.0 までの断岳剣は、縦斬り・薙ぎ払いで峰が前だった）。手首で刃を返す技は、キーごとに `normal` を持ち、隣り合うキーで真逆にしない（`validateTrack` が確かめる）。
- **技が替わった時**（v0.40.0。断岳剣）: 手に持った武器の位置と向きを 0.1 秒混ぜる（向きは回転の球面補間）。判定のある tick は混ぜず、正本の軌道に合わせる。
- この 7 系統の動きは、関節の曲がる範囲・手の届き・手首・重心・足の滑り・速さの検査（`src/render/humanLimits.ts`）を全 tick で通すこと。正式クリップへ替える時も、同じ検査を目安にする。
- **動きの組**（v0.57.0。D-150）: 利用者の指示で、ハンターの動きを 2G の動きを手本に作り直している。作り直す前の動きは、保留の組 `v056`（v0.56.0 までの動き）として残す: データ（技・軌道・移動曲線・武器の系統）は `public/data/motionsets/v056/`（読み込みの時に `assembleContent` の `motionSet` で入れ替わる）、描画の動きは `src/render/motionsets/v056.ts`（`src/render/motionSet.ts` の `useMotionSet` が `WEAPON_STANCES`・`WEAPON_MOTIONS` の中身を入れ替える。v0.58.0 から、`poses.ts` の共通の動き common_* と、納刀の歩き・走りの形 `LOCO_STYLE` も）。設定の「ハンターの動き」か、アドレスの `?motions=v056` で選ぶ。保留の組の断岳剣は、キー姿勢の方式（`poses.ts` の hb_*・`heavyBodyMotion.ts`）のまま描く（`WEAPON_STANCES` に断岳剣が無いので、view.ts がその方式を選ぶ）。保留の組のファイルは手で編集しない。
- 納めた武器の置き場所は、武器系統ごとに持つ（`weaponClipSpecs.ts` の sheath: 付く骨と位置と向き）。socket_back / socket_hip は断岳剣と、正式モデルの目安。
- 正式クリップへ替える時は、クリップの刃の位置と shapeTrack の誤差を検証表示で比べ、**どちらを基準に直すかを先に決める**。
- **モンスターの攻撃を受ける部位**（v0.25.0、docs/spec.md の 22.5）: 大型 11 種と幼体 8 種は、技の間と眠っている間、部位の形を、描画の動きから前もって作った表（`public/data/follow/`）のとおりに動かす。表は `npm run monsters:bake` の出力で、戦闘は表だけを読む（描画の `Bone.matrixWorld` を戦闘の正本にしない）。動きを変えたら、bake し直して、表と軌道を合わせる（`tests/creature-motion.test.ts` がずれを見つける）。

## 6. clip の名前といま必要なもの

`<系統>_<動作>_<連番>`。技データ（`public/data/actions/*.json`）の `clip` と同じ名前にする。

| clip | 対応する技 | 長さ | 備考 |
| --- | --- | --- | --- |
| hb_attack_vertical_01 | player.heavy_blade.overhead | 72 tick | 18 tick が頭上に担いだ形（溜めの保持姿勢）。v0.57.0 から 2G を手本に: 左足を大きく踏み込んで叩き下ろし、切っ先が前の地面に届いて深く沈む（30〜46） |
| hb_attack_side_01 | player.heavy_blade.side_sweep | 66 tick | 右後ろへ引いて腰を巻き、腰の高さを右 → 左へ払って左の後ろまで振り抜く |
| hb_draw_slash_01 | player.heavy_blade.draw_slash | 64 tick | 肩越しに背から抜き上げ、16 tick で頭上に担いだ形（溜めの保持姿勢）、踏み込んで叩き下ろす |
| hb_attack_upswing_01 | player.heavy_blade.upswing | 66 tick | v0.40.0。構えから手首で刃を返して前の低い所へ下ろし（4〜14）、頭の上へ振り上げる（判定 18〜27）。下ろす前に刃を返して構えへ |
| hb_attack_upswing_low_01 | player.heavy_blade.upswing_low | 54 tick | v0.40.0。縦斬り・抜刀斬りの後（刃が前の地面）から、手首で刃を返して（0〜4）そのまま振り上げる（判定 6〜15） |
| hb_draw_01 / hb_sheathe_01 | …draw / …sheathe | 26 / 44 tick | |
| ll_high_01 | player.long_lance.high1〜3 | 42 tick | v0.59.0 から 2G を手本に: 右ひじを外へ張って槍を肩の上へ持ち上げ（〜7）、盾の上から斜め上へ突き出す（判定 12〜17）。中段の ll_thrust_01（脇に抱えて正面へ）と見分ける |
| ll_charge_01 | player.long_lance.charge | 210 tick | v0.59.0。突進。腰を落として盾を前に据え（〜14）、槍を脇に抱えて走る（左右の足で 20 tick に 2 歩、両足の浮く間がある）。途中で主・副・スタミナ切れで次の clip へ移るので、どの tick からでも次へつながる形を保つ |
| ll_charge_finish_01 / ll_charge_stop_01 | …charge_finish / …charge_stop | 44 / 34 tick | v0.59.0。突進の 57 tick の姿から始まる（走っている途中の姿）。フィニッシュ突き（判定 10〜16）/ 前の足で踏んで止まり、穂先を上げて構えへ |
| ll_backstep_01 | player.long_lance.backstep | 36 tick | v0.59.0。後ろへ入れた回避。深く沈んで両足で蹴り、1.88m 後ろへ跳ぶ（無敵 3〜13）。入力なし・前・左右は ll_hop_01（1.2m）。構え歩き（防御のまま歩く）は防御の足の形から描画が歩かせる（clip は無い） |
| rb_melee1_01 / rb_melee2_01 | player.ring_bow.melee1 / melee2 | 36 / 40 tick | v0.60.0。環弓の近接。右手で腰の後ろの矢を抜き、肩の上から右上 → 左下へ斬る（判定 12〜17）/ 手を引き戻し、右足を踏み出して胸の高さを突く（判定 12〜17。0.2m 進む）。矢は体の動きの `hold`（0.5 以上で握る）で右手に出し、前腕の向きへ向ける。判定は握った矢（手元から 0.05〜0.6m） |
| rb_coat_01 | player.ring_bow.coat | 44 tick | v0.60.0。右手を腰の袋へ（〜8）、体を正面へ向けて弓を胸の前へ寄せ、握りの上へ差す（18〜24。24 で付く・外れる）。ビンの見た目はまだ無い |
| rb_backstep_01 | player.ring_bow.backstep | 30 tick | v0.60.0。環弓の入力なしの回避。沈んで両足で蹴り、1.32m 後ろへ跳ぶ（無敵 2〜10）。散らし撃ちの rb_spread_01 は、保留の組 v056 だけ |
| lb_vertical_01 | player.long_blade.vertical | 34 tick | v0.62.0。太刀の主の 1 段目（袈裟斬り lb_kesa_01 から作り直した）。両手を額の上へ振りかぶり（〜8。刃は頭の後ろ）、右足を踏み込みながら体の真ん中を真上から真下へ斬り下ろす（判定 12〜18。刃先の左右のずれ 0.15m 未満）。lb_draw_cut_01 の斬り下ろしも同じ形（18 tick 後ろ）。lb_kesa_01・lb_round_01 は保留の組 v056 だけ |
| lb_rise_01 | player.long_blade.rise / rise_s2 | 32 tick | v0.62.0 から突きの後（突きの 30 tick の形から始まる）。突き出した刃を左下へ下ろして返し、右上へ斬り上げる（判定 9〜15） |
| wm_charge_upswing_01 | player.war_maul.charge_upswing | 60 tick | v0.62.0。溜め 2。小さく持ち上げ（〜6）、前の低い所を打ち下ろし（判定 11〜15）、深く沈んで（14〜19）、体の前を下から頭上へ振り上げる（判定 26〜36） |
| wm_spin_up_01 / wm_spin_slam_01 | player.war_maul.spin_up / spin_slam | 48 / 56 tick | v0.62.0。回転の締め。回転の 30 / 62 tick の姿から始まる。かち上げ（低く下ろして下から頭上へ。判定 13〜23）/ 頭上へ振りかぶって深く沈み、叩きつける（判定 26〜34） |
| wm_draw_upswing_01 | player.war_maul.draw_upswing | 64 tick | v0.62.0。抜刀振り上げ（抜刀叩き wm_draw_smash_01 から替えた。wm_draw_smash_01 は保留の組 v056 だけ）。肩越しに柄を取り、体の右の横で頭を後ろから前へ低く回し（21〜33。頭は体の真下を通さず、地面へ潜らない）、左手を添えて（35）、右の低い所から体の前を頭上へ振り上げる（判定 37〜46） |
| gb_jump_01 | player.guard_blade.jump | 48 tick | v0.63.0。護刃の主と副の同時押し（跳び斬り）。腰を落として剣を右肩の上へ担ぎ（〜5）、両足で蹴って前へ跳ぶ（7〜21 は両足が浮く。頂きで腰が 0.06m 上がる）、着きながら右上から左下へ斬り下ろす（判定 18〜24）。深くしゃがんで着く |
| tb_sweep_01 | player.twin_blades.sweep | 42 tick | v0.63.0。双剣の主と副の同時押し（斬り払い。突き込み tb_stab_01 から替えた。tb_stab_01 は保留の組 v056 だけ）。両方の剣を体の横の低い所へ引き（〜8。切っ先は下）、左足を踏み込みながら、右（判定 12〜17）・左（15〜20）の順に下から体の前を通して前上へ斬り上げて払い、手首を返して外へ開く |
| common_roll_01 | player.common.roll | 36 tick | 前転。v0.58.0 から 2G を手本に、予備（〜3）→ 蹴り出して両手を地面へ（6）→ 丸まって回る（10〜17）→ 足から着いてしゃがむ（22〜26）→ 立つ。抜刀中は前後左右の 4 方向が必要（いまは前転を回して代用している仮の処理） |
| common_item_drink_01 | player.item.drink | 124 tick | 回復液を飲む。58 tick で効果（それまでに口元へ）。v0.40.0 から、飲み終えた後の決め姿勢（両腕を横へ上げて力を込める。76〜106）。v0.58.0 から、腰の袋から取り出し（〜12）、左手を腰に当てて飲む |
| common_item_place_01 | player.item.set_trap | 112 tick | v0.64.0 から 2G を手本に: 腰の袋から罠を取り出し（〜10）、片ひざを突いて両手で持ち（22）、地面へ下ろして（40）、2 回押し込み（56・76）、84 tick で設置して立つ |
| common_item_whet_01 | player.item.whet | 120 tick | 片ひざを突いて、ひざの前に渡した武器を研ぐ。96 tick で研ぎ上がる。武器の位置と腕は、描画の側が動かして手を合わせる（データの軌道は持たない）。v0.40.0 から納刀して使い、背の置き場所（その系統の抜刀の軌道の始まり）から下ろして、終わったら納める。護刃が防御を構えたまま使った時だけ、構えの位置から |
| common_item_throw_01 | player.item.throw_orb | 46 tick | v0.64.0 から 2G を手本に: 腰の袋から玉を取り（〜6）、右足へ体重を乗せ左腕で狙って右腕を頭の後ろへ引き（13）、左足を踏み込みながら上から投げる（22 tick で手を離れる）。振り抜いて戻る |
| common_carve_01 | player.common.carve | 100 tick | v0.64.0 から 2G を手本に: 小刀を抜き（〜10）、片ひざを突いて左手で押さえ（20）、突き入れて手前へ引く を 2 回（30・40、50・60）、左手で素材をつかんで（70）胸の前へ持ち上げる（80 tick で素材が手に入る） |
| common_gather_01 | player.common.gather | 90 tick | 狩らない依頼（v0.27.0）の採集。片ひざで摘み、腰の袋へ。72 tick で品が入る。6〜72 tick は回避で止められる |
| common_mine_01 | player.common.mine | 150 tick | 採掘（v0.27.0）。右手に採掘道具（つるはし。見た目だけ）を持ち、3 回振り下ろし（42・76・110）、しゃがんで拾う。126 tick で品が入る。6〜126 tick は回避で止められる |
| common_deliver_01 | player.common.deliver | 48 tick | 納品（v0.27.0）。かがんで、両手で納品箱へ入れる。30 tick で納まる |
| xw_hunting_horn_*（11 本） | player.hunting_horn.* | 36〜102 tick | v0.80.0（D-180）。響笛。**ChatGPT の #39 の候補のまま**（2G を手本にした作り直しは、まだ）。swing_left・swing_right・slam・draw・sheathe は、大槌の動き（wm_swing_01・wm_smash_01・wm_pound_01・wm_draw_01・wm_sheathe_01）の時間を変えたもの。poke・recital_enter・play_note1〜3・recital_exit は、構えから腰と握りを少し動かすだけの身振り |
| xw_gunlance_*（13 本） | player.gunlance.* | 30〜174 tick | v0.80.0。銃槍。#39 の候補のまま。thrust・thrust2・thrust3・uppercut・guard_thrust・hop・backstep・draw・sheathe は、長尖槍の動き（ll_thrust_01・ll_high_01・ll_guard_thrust_01・ll_hop_01・ll_backstep_01・ll_draw_01・ll_sheathe_01）の時間を変えたもの。shell・wyvern_fire・reload・guard は身振り（撃つ tick に握りを引く） |
| xw_light_bowgun_*・xw_heavy_bowgun_*（6 本ずつ） | player.light_bowgun.* / player.heavy_bowgun.* | 38〜139 tick | v0.80.0。軽弩・重弩。#39 の候補のまま。構えは、両手で銃を胸の高さに持つ（握りへ両手が届く形を、道具が探す）。fire・rapid_fire・charge_stance・reload・backstep / dodge は身振り。sheathe は背へ納め、draw はその逆回し |
| dummy_slam_01 | monster.training_dummy.slam | 130 tick | 訓練標的専用 |

いま手続き生成で代用していて、正式素材では clip が必要なもの（台帳の `clipsPlanned`）:
待機・歩く・走る・疾走（納刀）、構え待機・構え歩行（断岳剣）、防御・防御の反動、怯み・転倒・起き上がり・力尽き（v0.64.0 から 2G を手本にした手付けの形: 怯みは押された向き `p.hurt.dirYaw - yaw` へ上体が持っていかれて足を踏み直す 30 tick、転倒は 4〜10 tick に浮いて 17 tick に背から落ち、54 tick に片ひじ・64 tick に片ひざを突いて 84 tick で立つ、弾かれは腕を頭上へ跳ね上げる 26 tick、力尽きは 12〜20 tick に片ひざを突いて 34 tick で背から倒れる。poses.ts の hurtPose・deadPose。正式な clip を作る時の段の目安。保留の組 v056 は前の形）、
登攀（v0.44.0。#19 の H07。simulation の登攀の段階 `mount`（14 tick）・`down`（30 tick。上の段から向きを変えて取り付く）・`climb`（高さで手足を入れ替える。0.65m で 1 回）・`exit`（36 tick。縁に手を掛けて引き上げ、立つ）。いまは src/render/poses.ts の climbPose の手付けの姿勢。位置は simulation の登攀が持つので、clip は root motion を持たない）、
低い岩棚の乗り越え（v0.49.0。状態 `vault`。全体 24 tick: 縁へ寄って手を掛ける 6 tick → 押し上げて右膝を縁へ → 段の上でしゃがむ → 立つ。いまは poses.ts の vaultPose の手付けの姿勢。位置は simulation が持つ）。
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
