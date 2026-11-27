# 大型の技の後隙に、狙える部位（後隙の反撃）

`npm run monsters:gen` の出力（手で編集しない）。決まりは docs/spec.md の 32.39、検査は tests/creature-openings.test.ts。

- 区間は、技の始めから数えた tick（60 tick = 1 秒）。その間、部位の下の端は 1.6m 以下で、ほとんど動かない。
- 大技 = その種のいちばん強い一撃の 9 割以上の技（区間は 30 tick 以上。ほかは 20 tick 以上）。
- 「−」は、隙を作らない技（退きながら当てる技・遠くの相手へ撃つ技）と、ガルドロスの横への体当たり（いまの動きでは、止まる間が短い）と、
  スパインゲイルの突進（走り抜けた後、止まるまで滑る。この種の大きな隙は、走った後の息切れ）。
- ガルドロスとスパインゲイル（体と動きを別に作った種）は、動きを変えずに、いまの動きで決まりを満たす区間だけを書いてある。

## 灰帷鳥 アシュレイア（`monster.ashreia`。15 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `ash_curtain` | 頭の冠羽（`crest`） | 78〜102 | 24 |  |
| `beak_thrust` | 頭の冠羽（`crest`） | 48〜72 | 24 |  |
| `glide` | 尾羽（`tail`） | 72〜102 | 30 | 大技 |
| `wing_sweep_l` | 左の灰粉房（`tuft_l`） | 48〜72 | 24 |  |
| `wing_sweep_r` | 右の灰粉房（`tuft_r`） | 48〜72 | 24 |  |
| `peck_combo` | 頭の冠羽（`crest`） | 84〜108 | 24 |  |
| `neck_whip_l` | 頭の冠羽（`crest`） | 54〜78 | 24 |  |
| `neck_whip_r` | 頭の冠羽（`crest`） | 54〜78 | 24 |  |
| `stomp_kick` | 頭の冠羽（`crest`） | 54〜84 | 30 | 大技 |
| `leap_dive` | 頭の冠羽（`crest`） | 72〜102 | 30 | 大技 |
| `ash_burst` | 頭の冠羽（`crest`） | 90〜132 | 42 |  |
| `tail_fan` | 尾羽（`tail`） | 60〜84 | 24 |  |
| `wing_clap` | 左の灰粉房（`tuft_l`） | 54〜78 | 24 |  |
| `ash_rain` | 頭の冠羽（`crest`） | 84〜108 | 24 |  |
| `wing_spin` | 尾羽（`tail`） | 72〜96 | 24 |  |

## 鐘嚢獣 ボルナケル（`monster.bornakel`。15 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `sound_blast` | 頭鐘（`head`） | 78〜102 | 24 |  |
| `sac_slam` | 頭鐘（`head`） | 54〜84 | 30 | 大技 |
| `sac_slam_l` | 頭鐘（`head`） | 54〜84 | 30 | 大技 |
| `bell_slam` | 頭鐘（`head`） | 60〜90 | 30 | 大技 |
| `shiver_step` | 頭鐘（`head`） | 54〜78 | 24 |  |
| `bell_swing_l` | 頭鐘（`head`） | 60〜84 | 24 |  |
| `bell_swing_r` | 頭鐘（`head`） | 60〜84 | 24 |  |
| `triple_boom` | 頭鐘（`head`） | 96〜120 | 24 |  |
| `resonant_stomp` | 胸の共鳴嚢（`sac_chest`） | 72〜96 | 24 |  |
| `rump_bump` | 尾（`tail`） | 54〜78 | 24 |  |
| `chest_ram` | 尾（`tail`） | 90〜120 | 30 | 大技 |
| `sonic_ring` | 頭鐘（`head`） | 84〜108 | 24 |  |
| `tap_line` | 頭鐘（`head`） | 72〜96 | 24 |  |
| `scoop` | 胸の共鳴嚢（`sac_chest`） | 48〜72 | 24 |  |
| `charge` | 尾（`tail`） | 132〜162 | 30 | 大技 |

## 岩殻獣 ガルドロス（`monster.galdros`。18 / 20）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `slam_l` | 背殻（`back`） | 60〜96 | 36 |  |
| `slam_r` | 背殻（`back`） | 60〜96 | 36 |  |
| `charge` | 尾（`tail`） | 150〜186 | 36 |  |
| `tail_sweep` | 後脚（`hindleg`） | 60〜108 | 48 |  |
| `tail_sweep_short` | 後脚（`hindleg`） | 60〜108 | 48 |  |
| `bite` | 頭（`head`） | 48〜84 | 36 |  |
| `head_swing` | 前脚（`foreleg`） | 54〜90 | 36 |  |
| `double_slam` | 前脚（`foreleg`） | 72〜114 | 42 | 大技 |
| `stomp` | 前脚（`foreleg`） | 42〜78 | 36 |  |
| `body_press` | 背殻（`back`） | 78〜114 | 36 | 大技 |
| `side_bash_l` | − | − | − |  |
| `side_bash_r` | − | − | − |  |
| `charge_short` | 背殻（`back`） | 96〜126 | 30 |  |
| `tail_slam` | 尾（`tail`） | 90〜114 | 24 |  |
| `tail_slam_short` | 尾（`tail`） | 90〜114 | 24 |  |
| `tail_sweep_rev` | 後脚（`hindleg`） | 60〜96 | 36 |  |
| `tail_sweep_rev_short` | 後脚（`hindleg`） | 60〜96 | 36 |  |
| `rockfall` | 背殻（`back`） | 60〜96 | 36 |  |
| `rock_stomp` | 背殻（`back`） | 60〜96 | 36 |  |
| `rock_fling` | 頭（`head`） | 54〜90 | 36 |  |

## 氷帆蛇 キリサーヴ（`monster.kirisave`。14 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `ice_row` | 頭の冷晶板（`head`） | 66〜90 | 24 |  |
| `slide` | 尾の冷晶管（`tail`） | 78〜102 | 24 |  |
| `body_sweep_l` | 尾の冷晶管（`tail`） | 54〜78 | 24 |  |
| `body_sweep_r` | 尾の冷晶管（`tail`） | 54〜78 | 24 |  |
| `tail_slam` | 尾の冷晶管（`tail`） | 66〜96 | 30 | 大技 |
| `bite` | 頭の冷晶板（`head`） | 42〜66 | 24 |  |
| `frost_breath` | 頭の冷晶板（`head`） | 84〜108 | 24 |  |
| `sail_slash_l` | 左列の氷帆（`sails_l`） | 60〜84 | 24 |  |
| `sail_slash_r` | 右列の氷帆（`sails_r`） | 60〜84 | 24 |  |
| `ice_ring` | 頭の冷晶板（`head`） | 84〜108 | 24 |  |
| `coil_slam` | 頭の冷晶板（`head`） | 66〜96 | 30 | 大技 |
| `tail_whip_l` | 尾の冷晶管（`tail`） | 54〜78 | 24 |  |
| `tail_whip_r` | 尾の冷晶管（`tail`） | 54〜78 | 24 |  |
| `ice_burst` | − | − | − |  |
| `slide_long` | 尾の冷晶管（`tail`） | 108〜138 | 30 | 大技 |

## 燐尾鳥 ルミスカ（`monster.lumisca`。14 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `discharge` | 頭の額板（`head`） | 72〜96 | 24 |  |
| `kick` | 頭の額板（`head`） | 42〜66 | 24 |  |
| `tail_sweep_l` | 尾先の放電板（`tail_tip`） | 60〜84 | 24 |  |
| `tail_sweep_r` | 尾先の放電板（`tail_tip`） | 60〜84 | 24 |  |
| `leap_in` | 頭の額板（`head`） | 60〜90 | 30 | 大技 |
| `kick_double` | 頭の額板（`head`） | 72〜96 | 24 |  |
| `peck` | 頭の額板（`head`） | 42〜66 | 24 |  |
| `tail_slam` | 尾先の放電板（`tail_tip`） | 66〜96 | 30 | 大技 |
| `tail_spin` | 頭の額板（`head`） | 66〜90 | 24 |  |
| `spark_ring` | 頭の額板（`head`） | 78〜120 | 42 |  |
| `chain_discharge` | − | − | − |  |
| `tail_jab` | 尾先の放電板（`tail_tip`） | 48〜72 | 24 |  |
| `leap_kick` | 頭の額板（`head`） | 60〜90 | 30 | 大技 |
| `wing_slap_l` | 頭の額板（`head`） | 48〜72 | 24 |  |
| `wing_slap_r` | 頭の額板（`head`） | 48〜72 | 24 |  |

## 泥冠獣 ヌメラドン（`monster.numeradon`。17 / 17）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `mud_ball` | 頭（`head`） | 60〜84 | 24 |  |
| `belly_slide` | 後脚（`hindleg`） | 72〜102 | 30 | 大技 |
| `push_l` | 頭（`head`） | 54〜78 | 24 |  |
| `push_r` | 頭（`head`） | 54〜78 | 24 |  |
| `splash` | 頭（`head`） | 48〜72 | 24 |  |
| `dish_slam` | 頭頂の泥皿（`dish`） | 60〜90 | 30 | 大技 |
| `mud_volley` | 頭（`head`） | 66〜90 | 24 |  |
| `pressure_jet` | 頭（`head`） | 72〜96 | 24 |  |
| `tail_slap` | 後脚（`hindleg`） | 54〜78 | 24 |  |
| `tail_sweep_l` | 後脚（`hindleg`） | 60〜84 | 24 |  |
| `tail_sweep_r` | 後脚（`hindleg`） | 60〜84 | 24 |  |
| `wallow_l` | 左右の水圧嚢（`sacs`） | 72〜102 | 30 | 大技 |
| `wallow_r` | 左右の水圧嚢（`sacs`） | 72〜102 | 30 | 大技 |
| `bite` | 頭（`head`） | 48〜72 | 24 |  |
| `front_slam` | 前脚の泥掻き爪（`foreclaw`） | 66〜96 | 30 | 大技 |
| `mud_rain` | 頭（`head`） | 84〜132 | 48 |  |
| `charge` | 後脚（`hindleg`） | 126〜156 | 30 | 大技 |

## 硝殻蟹 オルグラス（`monster.orglass`。15 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `pinch` | 右大鋏（`claw_r`） | 54〜84 | 30 | 大技 |
| `dash_l` | 前脚の甲（`greave`） | 60〜84 | 24 |  |
| `dash_r` | 前脚の甲（`greave`） | 60〜84 | 24 |  |
| `fan_pinch` | 頭（`head`） | 60〜84 | 24 |  |
| `shell_swing` | 背の硝殻板（`plates`） | 60〜90 | 30 |  |
| `claw_slam` | 右大鋏（`claw_r`） | 66〜96 | 30 | 大技 |
| `claw_sweep` | 頭（`head`） | 60〜84 | 24 |  |
| `jab` | 頭（`head`） | 36〜60 | 24 |  |
| `jab_combo` | 頭（`head`） | 78〜102 | 24 |  |
| `shell_drop` | 背の硝殻板（`plates`） | 60〜84 | 24 |  |
| `glass_shards` | 頭（`head`） | 72〜96 | 24 |  |
| `claw_double` | 右大鋏（`claw_r`） | 96〜126 | 30 | 大技 |
| `sand_rake` | 前脚の甲（`greave`） | 48〜72 | 24 |  |
| `rear_shove` | 背の硝殻板（`plates`） | 48〜72 | 24 |  |
| `charge` | 前脚の甲（`greave`） | 108〜132 | 24 |  |

## 環骨蛇 ラズメル（`monster.razmer`。15 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `body_sweep_l` | 頭骨（`head`） | 60〜84 | 24 |  |
| `body_sweep_r` | 頭骨（`head`） | 60〜84 | 24 |  |
| `crawl_charge` | 尾端環（`tail_ring`） | 90〜120 | 30 | 大技 |
| `ring_slam` | 前の骨環（`ring_f`） | 60〜90 | 30 | 大技 |
| `tail_wrap_l` | 尾端環（`tail_ring`） | 60〜84 | 24 |  |
| `tail_wrap_r` | 尾端環（`tail_ring`） | 60〜84 | 24 |  |
| `bite` | 頭骨（`head`） | 42〜66 | 24 |  |
| `double_bite` | 頭骨（`head`） | 78〜102 | 24 |  |
| `tail_slam` | 尾端環（`tail_ring`） | 60〜90 | 30 | 大技 |
| `coil_spin` | 前の骨環（`ring_f`） | 78〜102 | 24 |  |
| `quake` | 頭骨（`head`） | 78〜102 | 24 |  |
| `head_slam` | 頭骨（`head`） | 60〜90 | 30 | 大技 |
| `side_roll_l` | 前の骨環（`ring_f`） | 72〜96 | 24 |  |
| `side_roll_r` | 前の骨環（`ring_f`） | 72〜96 | 24 |  |
| `lunge_sweep` | 頭骨（`head`） | 84〜108 | 24 |  |

## 帆角獣 セルヴァルク（`monster.selvark`。14 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `hop_kick_l` | 頭（`head`） | 48〜72 | 24 |  |
| `hop_kick_r` | 頭（`head`） | 48〜72 | 24 |  |
| `gust` | 頭（`head`） | 72〜96 | 24 |  |
| `lunge` | 頭（`head`） | 54〜78 | 24 |  |
| `back_flip` | − | − | − |  |
| `double_thrust` | 頭（`head`） | 78〜102 | 24 |  |
| `rear_kick` | 尾先（`tail`） | 54〜78 | 24 |  |
| `head_sweep_l` | 頭（`head`） | 60〜84 | 24 |  |
| `head_sweep_r` | 頭（`head`） | 60〜84 | 24 |  |
| `stomp` | 頭（`head`） | 60〜90 | 30 | 大技 |
| `wind_spin` | 頭（`head`） | 90〜114 | 24 |  |
| `charge` | 尾先（`tail`） | 114〜144 | 30 | 大技 |
| `leap_stomp` | 頭（`head`） | 72〜102 | 30 | 大技 |
| `tail_whip_l` | 尾先（`tail`） | 48〜72 | 24 |  |
| `tail_whip_r` | 尾先（`tail`） | 48〜72 | 24 |  |

## 疾棘竜 スパインゲイル（`monster.spinegale`。12 / 13）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `bite` | 喉袋（`dewlap`） | 36〜60 | 24 |  |
| `double_bite` | 後脚（`legs`） | 66〜102 | 36 |  |
| `dash` | − | − | − |  |
| `pounce` | 喉袋（`dewlap`） | 78〜120 | 42 | 大技 |
| `jump_kick` | 喉袋（`dewlap`） | 78〜114 | 36 | 大技 |
| `tail_sweep_l` | 後脚（`legs`） | 54〜90 | 36 |  |
| `tail_sweep_r` | 後脚（`legs`） | 54〜90 | 36 |  |
| `turn_bite` | 喉袋（`dewlap`） | 54〜78 | 24 |  |
| `side_strike_l` | 後脚（`legs`） | 54〜84 | 30 |  |
| `side_strike_r` | 後脚（`legs`） | 54〜84 | 30 |  |
| `triple_dash` | 頭の冠棘（`head`） | 204〜234 | 30 |  |
| `tail_sweep_l_short` | 後脚（`legs`） | 54〜90 | 36 |  |
| `tail_sweep_r_short` | 後脚（`legs`） | 54〜90 | 36 |  |

## 鉤輪蟲 テンガロ（`monster.tengaro`。14 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `roll_l` | 外側の大鉤（`hooks`） | 96〜132 | 36 | 大技 |
| `roll_r` | 外側の大鉤（`hooks`） | 96〜132 | 36 | 大技 |
| `hook_sweep_l` | 外側の大鉤（`hooks`） | 54〜78 | 24 |  |
| `hook_sweep_r` | 外側の大鉤（`hooks`） | 54〜78 | 24 |  |
| `arch_drop` | 頭甲（`head`） | 60〜90 | 30 | 大技 |
| `venom_strike` | 頭甲（`head`） | 54〜78 | 24 |  |
| `head_bite` | 頭甲（`head`） | 42〜66 | 24 |  |
| `rear_drop` | 外側の大鉤（`hooks`） | 60〜90 | 30 | 大技 |
| `double_drop` | 頭甲（`head`） | 96〜120 | 24 |  |
| `roll_straight` | 外側の大鉤（`hooks`） | 108〜144 | 36 | 大技 |
| `spin_hooks` | 外側の大鉤（`hooks`） | 66〜90 | 24 |  |
| `venom_spray` | 頭甲（`head`） | 66〜90 | 24 |  |
| `spring_drop` | 頭甲（`head`） | 72〜102 | 30 | 大技 |
| `hook_rake` | 外側の大鉤（`hooks`） | 54〜78 | 24 |  |
| `para_rain` | − | − | − |  |

## 霧灯獣 ヴェルガイト（`monster.velgait`。14 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `mist_ball` | 頭（`head`） | 60〜84 | 24 |  |
| `side_thrust_l` | 頭（`head`） | 48〜72 | 24 |  |
| `side_thrust_r` | 頭（`head`） | 48〜72 | 24 |  |
| `stomp` | 頭（`head`） | 54〜84 | 30 | 大技 |
| `tail_sweep_l` | 尾の導霧皮（`tail`） | 60〜84 | 24 |  |
| `tail_sweep_r` | 尾の導霧皮（`tail`） | 60〜84 | 24 |  |
| `crown_ram` | 尾の導霧皮（`tail`） | 84〜114 | 30 | 大技 |
| `crown_swing_l` | 頭（`head`） | 54〜78 | 24 |  |
| `crown_swing_r` | 頭（`head`） | 54〜78 | 24 |  |
| `rear_kick` | 尾の導霧皮（`tail`） | 48〜72 | 24 |  |
| `mist_burst` | 頭（`head`） | 84〜114 | 30 |  |
| `mist_volley` | − | − | − |  |
| `pounce` | 頭（`head`） | 60〜84 | 24 |  |
| `stomp_double` | 頭（`head`） | 90〜114 | 24 |  |
| `charge` | 尾の導霧皮（`tail`） | 108〜138 | 30 | 大技 |

## 絹霧蟲 ヴェリト（`monster.verito`。15 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `thread_spray` | 尾の紡糸管（`spinner`） | 66〜90 | 24 |  |
| `hop` | 頭（`head`） | 60〜90 | 30 | 大技 |
| `foreleg_sweep` | 頭（`head`） | 48〜72 | 24 |  |
| `drip` | 頭（`head`） | 48〜72 | 24 |  |
| `foreleg_stab` | 頭（`head`） | 48〜72 | 24 |  |
| `bite` | 頭（`head`） | 42〜66 | 24 |  |
| `thread_whip_l` | 尾の紡糸管（`spinner`） | 54〜78 | 24 |  |
| `thread_whip_r` | 尾の紡糸管（`spinner`） | 54〜78 | 24 |  |
| `web_volley` | 頭（`head`） | 66〜90 | 24 |  |
| `body_slam` | 頭（`head`） | 60〜90 | 30 | 大技 |
| `spin_threads` | 頭（`head`） | 72〜108 | 36 |  |
| `leg_rake_l` | 左の羽袋（`bag_l`） | 48〜72 | 24 |  |
| `leg_rake_r` | 右の羽袋（`bag_r`） | 48〜72 | 24 |  |
| `mist_cloud` | 頭（`head`） | 102〜138 | 36 |  |
| `pounce` | 頭（`head`） | 60〜84 | 24 |  |
