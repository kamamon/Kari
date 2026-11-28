# 大型の技の後隙に、狙える部位（後隙の反撃）

`npm run monsters:gen` の出力（手で編集しない）。決まりは docs/spec.md の 32.39、検査は tests/creature-openings.test.ts。

- 区間は、技の始めから数えた tick（60 tick = 1 秒）。その間、部位の下の端は 1.6m 以下で、ほとんど動かない。
- 大技 = その種のいちばん強い一撃の 9 割以上の技（区間は 30 tick 以上。ほかは 20 tick 以上）。
- 「−」は、ガルドロスの横への体当たり（いまの動きでは、止まる間が短い）と、
  スパインゲイルの突進（走り抜けた後、止まるまで滑る。この種の大きな隙は、走った後の息切れ）。
- ガルドロスとスパインゲイルは、動きを変えずに、いまの動きで決まりを満たす区間だけを書いてある。
- v0.75.0 で、白紙にした 11 種（生成の体の種）を外した（利用者の指示。D-175）。それまでは、ここに 11 種の 162 の区間も載っていた。

## 氷冠獣 フロストアルド（`monster.frostald`。18 / 18）

**この種の区間は、届いたまま（ChatGPT の #51。後隙のほぼ全体 = 最後の判定の 5 tick 後から、技の終わりの 3 tick 前まで）で、検査に入れていない。** 載せ直しの時（2026-11-28）に測ると、どの区間も、技を避けた狩人が間に合って斬れるが、18 のうち 9（`bite`・`double_bite`・`body_ram`・`roll_l`・`roll_r`・`head_slam`・`back_bite`・`ice_sweep_l`・`ice_sweep_r`）は、部位が区間の間に 1 tick に 2cm より速く動く（「ほとんど動かない」の決まりに合わない）。区間の端は、追従の表の刻み（6 tick）の上に無い。

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `bite` | 頭（`head`） | 43〜69 | 26 |  |
| `double_bite` | 頭（`head`） | 77〜121 | 44 |  |
| `claw_l` | 前脚（`foreleg`） | 54〜91 | 37 |  |
| `claw_r` | 前脚（`foreleg`） | 54〜91 | 37 |  |
| `body_ram` | 頭（`head`） | 81〜127 | 46 |  |
| `slide` | 頭（`head`） | 114〜161 | 47 | 大技 |
| `tail_l` | 後脚（`hindleg`） | 65〜108 | 43 |  |
| `tail_r` | 後脚（`hindleg`） | 65〜108 | 43 |  |
| `roll_l` | 前脚（`foreleg`） | 86〜135 | 49 |  |
| `roll_r` | 前脚（`foreleg`） | 86〜135 | 49 |  |
| `head_slam` | 頭（`head`） | 57〜107 | 50 |  |
| `back_bite` | 頭（`head`） | 52〜93 | 41 |  |
| `ice_breath` | 氷冠（`mane`） | 90〜147 | 57 |  |
| `ice_sweep_l` | 氷冠（`mane`） | 99〜167 | 68 |  |
| `ice_sweep_r` | 氷冠（`mane`） | 99〜167 | 68 |  |
| `ice_burst` | 氷冠（`mane`） | 77〜153 | 76 |  |
| `tail_l_short` | 後脚（`hindleg`） | 65〜108 | 43 |  |
| `tail_r_short` | 後脚（`hindleg`） | 65〜108 | 43 |  |

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

## 毒羽竜 ヴェノルカ（`monster.venolka`。15 / 15）

| 技 | 狙える部位 | 区間（tick） | 長さ | 大技 |
| --- | --- | --- | --- | --- |
| `peck` | 頭（`head`） | 72〜120 | 48 |  |
| `double_peck` | 頭（`head`） | 102〜156 | 54 |  |
| `rush` | 頭（`head`） | 114〜174 | 60 |  |
| `hop_kick` | 頭（`head`） | 90〜156 | 66 |  |
| `glide` | 頭（`head`） | 156〜240 | 84 | 大技 |
| `back_peck` | 頭（`head`） | 78〜138 | 60 |  |
| `wing_l` | 頭（`head`） | 84〜144 | 60 |  |
| `tail_l` | 頭（`head`） | 84〜138 | 54 |  |
| `poison_tail_l` | 毒嚢（`sac`） | 90〜156 | 66 |  |
| `wing_r` | 頭（`head`） | 84〜144 | 60 |  |
| `tail_r` | 頭（`head`） | 84〜138 | 54 |  |
| `poison_tail_r` | 毒嚢（`sac`） | 90〜156 | 66 |  |
| `poison_spit` | 毒嚢（`sac`） | 72〜156 | 84 |  |
| `poison_fan` | 毒嚢（`sac`） | 126〜204 | 78 |  |
| `poison_cloud` | 毒嚢（`sac`） | 84〜216 | 132 |  |
