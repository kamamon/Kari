# 原画案 v3（依頼 9 の追加。14〜86 の 73 枚）

受領: 2026-11-25（ChatGPT の画像生成。Pull Request #3 を main へマージした）。各 1536×1024px、1 枚に 1 種、真横から、淡い無地の背景。
ChatGPT の説明・各画像の生成指示と直した記録・台帳（art-manifest.json）・図鑑 PDF 2 冊（原画と生態 87 ページ / 第 2 版 183 ページ）・一覧の画像は `docs/source/chatgpt-009/encyclopedia/`。
ChatGPT の図鑑を作り直すスクリプト（`build_encyclopedia_v2.py`）は、記録として置くだけで、走らせていない。

**どれも採用待ちの原画案**（設定図ではない。4 方向の図・寸法は無い）。利用者の指示「#2.3.6.9.10全部取り込む」（2026-11-25）で受け取り、図鑑に出した。採用は、種ごとに別に決める。

## 照合したこと

- 73 枚とも、ChatGPT の台帳と、**番号・恒久 ID・名前・画像の大きさ・SHA256 が全部合う**（登録簿 `public/data/bestiary.json` の番号・名前とも合う）。
- 置き場: `art-source/monster/concepts/`（ファイル名は ChatGPT のまま。02〜13 は `monster_NN_*_concept_v2.png`、14〜86 は `monster_NNN_*_concept_v1.png`）。
- 登録簿: 73 種の `art` に書いた。案だけだった 65 種は「原画あり」（`state: art`）にして、`stateNote` に「原画案（採用待ち。真横 1 方向）。遊べない」。遊べる幼体 8 種（14〜21）は「実装済み」のまま、`stateNote` に「幼体自身の原画案を図鑑に出す（体はまだ親の絵から）」。
- 01 ガルドロスは、採用した設定図（`art-source/monster/galdros/galdros_left_v1.png`）を図鑑に出す（`art: galdros/galdros_left_v1.png`。`tools/concept-thumbs.py` が「/」のある名前を `art-source/monster/` から読む）。
- 図鑑に出す小さな絵: `npm run bestiary:thumbs`（幅 720px の WebP、86 枚で約 2.2MB。開いた種の絵だけを読む）。

## ChatGPT が直した所と、4 方向の図を頼む前に確かめる所（ChatGPT の README から）

- 25 ホルネバス（鐘嚢 3 本）、31 ボラゼルン・55 オルダセム（余分な脚を消した）、32 クドリマル（尾端）、33 トサムリエ（耳）、74 リムポセラ・85 ヌクバレア（余分な脚）、84 エナグリオ・86 トワルセム（短肢 2 対）は、初稿を直した版。
- 左右のある器官（22・25・32・72・78・82 など）は、絵の見かけの左右ではなく、生物自身の左右を、4 方向の図で決める。42・47・78 は奥側の脚が重なる。49 エルメジカの冠の割れの向き。
- 11 キリサーヴ（02〜12 の原画）は浮いて見える。地上の動きは、短肢の接地を別に決める（v0.21.0 で、ひれ足を動かせる骨にした）。

## まだのもの

- **幼体 8 種の体は、まだ親の原画から作った形**（v0.18.0 のまま）。幼体自身の原画から形と絵を作り直すのは、次の候補（大型と同じく、原画の px で背骨・脚・器官を測って生成器に書く）。
- 22〜86 の 65 種は、遊べない（体・技・依頼・狩場が無い）。

## 73 枚

| 番号 | 恒久 ID | 名前 | 種類 | ファイル | SHA256 |
|---|---|---|---|---|---|
| 14 | `monster.kordopil` | 幼岩殻獣 コルドピル | 幼体 | `monster_014_kordopil_concept_v1.png` | `fdd631870980…` |
| 15 | `monster.palseit` | 幼帆角獣 パルセイト | 幼体 | `monster_015_palseit_concept_v1.png` | `ff9af1a38ec7…` |
| 16 | `monster.numaporon` | 幼泥冠獣 ヌマポロン | 幼体 | `monster_016_numaporon_concept_v1.png` | `d598415d2c35…` |
| 17 | `monster.chilumicana` | 幼燐尾鳥 チルミカナ | 幼体 | `monster_017_chilumicana_concept_v1.png` | `2590ad5e9d9e…` |
| 18 | `monster.kohalgis` | 幼硝殻蟹 コハルギス | 幼体 | `monster_018_kohalgis_concept_v1.png` | `07ffd5904feb…` |
| 19 | `monster.mitogaron` | 幼鉤輪蟲 ミトガロン | 幼体 | `monster_019_mitogaron_concept_v1.png` | `82ba82f4acec…` |
| 20 | `monster.yurtepica` | 幼絹霧蟲 ユルテピカ | 幼体 | `monster_020_yurtepica_concept_v1.png` | `6a67b0ea8393…` |
| 21 | `monster.hinasalv` | 幼氷帆蛇 ヒナサルヴ | 幼体 | `monster_021_hinasalv_concept_v1.png` | `cf84c7b9281a…` |
| 22 | `monster.hasdren` | 銅苔獣 ハスドレン | 大型・亜種 | `monster_022_hasdren_concept_v1.png` | `152359f5fd01…` |
| 23 | `monster.ivselam` | 霜扇獣 イヴセラム | 大型・亜種 | `monster_023_ivselam_concept_v1.png` | `f186bbbc051f…` |
| 24 | `monster.domelkano` | 熱皿獣 ドメルカノ | 大型・亜種 | `monster_024_domelkano_concept_v1.png` | `7728addad3ed…` |
| 25 | `monster.holnebas` | 風鐘獣 ホルネバス | 大型・亜種 | `monster_025_holnebas_concept_v1.png` | `d1e9a1e86a21…` |
| 26 | `monster.miltasea` | 霧珠鳥 ミルタセア | 大型・亜種 | `monster_026_miltasea_concept_v1.png` | `e3301d349356…` |
| 27 | `monster.talgrina` | 鳴鋏蟹 タルグリナ | 大型・亜種 | `monster_027_talgrina_concept_v1.png` | `3aa2bb161736…` |
| 28 | `monster.zanetolka` | 砂輪蟲 ザネトルカ | 大型・亜種 | `monster_028_zanetolka_concept_v1.png` | `103ae102123f…` |
| 29 | `monster.ulnaset` | 雨帆蛇 ウルナセト | 大型・亜種 | `monster_029_ulnaset_concept_v1.png` | `523e2963b5f6…` |
| 30 | `monster.nemboraf` | 泥層獣 ネムボラフ | 超大型 | `monster_030_nemboraf_concept_v1.png` | `56fab8505875…` |
| 31 | `monster.borazeln` | 段稜獣 ボラゼルン | 超大型 | `monster_031_borazeln_concept_v1.png` | `65310aa983dd…` |
| 32 | `monster.kudrimal` | 煙棚獣 クドリマル | 超大型 | `monster_032_kudrimal_concept_v1.png` | `6481551cafd1…` |
| 33 | `monster.tosamurie` | 枝鉤獣 トサムリエ | 大型 | `monster_033_tosamurie_concept_v1.png` | `15de2f6b67f1…` |
| 34 | `monster.pukrenoa` | 沈匙獣 プクレノア | 大型 | `monster_034_pukrenoa_concept_v1.png` | `c747bb3eaf8d…` |
| 35 | `monster.kesalpina` | 庇頬鳥 ケサルピナ | 大型 | `monster_035_kesalpina_concept_v1.png` | `b3380a1124d5…` |
| 36 | `monster.riptaum` | 氷畝蟹 リプタウム | 大型 | `monster_036_riptaum_concept_v1.png` | `8a0f7e987f9c…` |
| 37 | `monster.serinodam` | 灯櫂蟲 セリノダム | 大型 | `monster_037_serinodam_concept_v1.png` | `375fb4d98539…` |
| 38 | `monster.nufraken` | 冷壺蛇 ヌフラケン | 大型 | `monster_038_nufraken_concept_v1.png` | `3fb42974d0db…` |
| 39 | `monster.akaunel` | 灼襟鳥 アカウネル | 大型 | `monster_039_akaunel_concept_v1.png` | `f2638b902649…` |
| 40 | `monster.tsumarobek` | 脈鼓獣 ツマロベク | 大型 | `monster_040_tsumarobek_concept_v1.png` | `82711f372d40…` |
| 41 | `monster.furemsad` | 霧鰭蛇 フレムサド | 大型 | `monster_041_furemsad_concept_v1.png` | `f121af2c24f4…` |
| 42 | `monster.grasedon` | 裂扇獣 グラセドン | 大型・希少種 | `monster_042_grasedon_concept_v1.png` | `2233f14ff90d…` |
| 43 | `monster.ryuzelka` | 双帆角獣 リュゼルカ | 大型・希少種 | `monster_043_ryuzelka_concept_v1.png` | `5e53859a56ad…` |
| 44 | `monster.mordine` | 蓮冠獣 モルディネ | 大型・希少種 | `monster_044_mordine_concept_v1.png` | `8c44d204edda…` |
| 45 | `monster.doberken` | 重鐘嚢獣 ドベルケン | 大型・希少種 | `monster_045_doberken_concept_v1.png` | `06a4d70678ac…` |
| 46 | `monster.shilhatora` | 枝燐鳥 シルハトラ | 大型・希少種 | `monster_046_shilhatora_concept_v1.png` | `086cc6a7a468…` |
| 47 | `monster.kuzanerio` | 逆硝殻蟹 クザネリオ | 大型・希少種 | `monster_047_kuzanerio_concept_v1.png` | `b0882e01ee2f…` |
| 48 | `monster.fesrami` | 結絹蟲 フェスラミ | 大型・希少種 | `monster_048_fesrami_concept_v1.png` | `4333886f27ef…` |
| 49 | `monster.elmejika` | 霜灯獣 エルメジカ | 大型・希少種 | `monster_049_elmejika_concept_v1.png` | `fd30d8f03163…` |
| 50 | `monster.azelnoto` | 潮環蛇 アゼルノト | 大型・亜種 | `monster_050_azelnoto_concept_v1.png` | `b65fe92ca3a9…` |
| 51 | `monster.bezrakio` | 蒸帆蛇 ベズラキオ | 大型・亜種 | `monster_051_bezrakio_concept_v1.png` | `a84d75207eb4…` |
| 52 | `monster.murzenato` | 泥鉤蟲 ムルゼナト | 大型・亜種 | `monster_052_murzenato_concept_v1.png` | `7900ed74c392…` |
| 53 | `monster.hauremika` | 苔帷鳥 ハウレミカ | 大型・亜種 | `monster_053_hauremika_concept_v1.png` | `2fe3cf618a40…` |
| 54 | `monster.zedbanil` | 銅炉獣 ゼドバニル | 大型・亜種 | `monster_054_zedbanil_concept_v1.png` | `e5ff665067e5…` |
| 55 | `monster.oldasem` | 棚巌獣 オルダセム | 超大型 | `monster_055_oldasem_concept_v1.png` | `71cb7b76d6cb…` |
| 56 | `monster.nuolvan` | 濾沼獣 ヌオルヴァン | 超大型 | `monster_056_nuolvan_concept_v1.png` | `6b88fee7ff0b…` |
| 57 | `monster.tarhegna` | 籠晶獣 テムソギア | 超大型 | `monster_057_tarhegna_concept_v1.png` | `af99c6bfee00…` |
| 58 | `monster.porgamis` | 箒顎獣 ポルガミス | 大型 | `monster_058_porgamis_concept_v1.png` | `5eec73c403fa…` |
| 59 | `monster.yarlshena` | 鞍頬獣 ヤルシェナ | 大型 | `monster_059_yarlshena_concept_v1.png` | `4f71b1c082d7…` |
| 60 | `monster.pizelta` | 扇趾鳥 ピゼルタ | 大型 | `monster_060_pizelta_concept_v1.png` | `98710b806743…` |
| 61 | `monster.damorikus` | 縁壺蟹 ダモリクス | 大型 | `monster_061_damorikus_concept_v1.png` | `ac5bcfe58fbe…` |
| 62 | `monster.isarnem` | 節帽蟲 イサルネム | 大型 | `monster_062_isarnem_concept_v1.png` | `7fb8ea518b2f…` |
| 63 | `monster.regsanio` | 片盤蛇 レグサニオ | 大型 | `monster_063_regsanio_concept_v1.png` | `2a69e2161b0c…` |
| 64 | `monster.rupenias` | 袋肩獣 ルペニアス | 大型 | `monster_064_rupenias_concept_v1.png` | `ee376147793d…` |
| 65 | `monster.sograpin` | 刻踵獣 ソグラピン | 大型 | `monster_065_sograpin_concept_v1.png` | `814953706844…` |
| 66 | `monster.makuejira` | 梯胸鳥 マクエジラ | 大型 | `monster_066_makuejira_concept_v1.png` | `b416e3d3d62d…` |
| 67 | `monster.gumesald` | 熔継獣 グメサルド | 大型・希少種 | `monster_067_gumesald_concept_v1.png` | `3c457e4b6f2e…` |
| 68 | `monster.nericaus` | 環燐鳥 ネリカウス | 大型・希少種 | `monster_068_nericaus_concept_v1.png` | `279ee54c71ac…` |
| 69 | `monster.voltena` | 重帷蟲 ヴォルテナ | 大型・希少種 | `monster_069_voltena_concept_v1.png` | `2cb192373f86…` |
| 70 | `monster.kitolnam` | 重氷蛇 キトルナム | 大型・希少種 | `monster_070_kitolnam_concept_v1.png` | `294a1aff081f…` |
| 71 | `monster.segranio` | 双環獣 セオルミド | 大型・希少種 | `monster_071_segranio_concept_v1.png` | `48c3e1ecff9c…` |
| 72 | `monster.dekoranze` | 炉畝獣 デコランゼ | 超大型 | `monster_072_dekoranze_concept_v1.png` | `7e99222b83e2…` |
| 73 | `monster.fusaldom` | 氷礁獣 フサルドム | 超大型 | `monster_073_fusaldom_concept_v1.png` | `c491f6a48e9a…` |
| 74 | `monster.rimposera` | 汐函獣 リムポセラ | 超大型 | `monster_074_rimposera_concept_v1.png` | `84a1cf48acff…` |
| 75 | `monster.dalhoina` | 風梁獣 ダルホイナ | 超大型 | `monster_075_dalhoina_concept_v1.png` | `fbfe17eeb615…` |
| 76 | `monster.zonikebal` | 砕脈獣 ゾニケバル | 大型 | `monster_076_zonikebal_concept_v1.png` | `d0eadaf23e75…` |
| 77 | `monster.ludopanea` | 孔顎獣 ルドパネア | 大型 | `monster_077_ludopanea_concept_v1.png` | `ab76ae1acec6…` |
| 78 | `monster.salpinoc` | 帷鋏蟹 サルピノク | 大型 | `monster_078_salpinoc_concept_v1.png` | `589aaf6b1c09…` |
| 79 | `monster.hemzario` | 連額獣 ヘムザリオ | 大型 | `monster_079_hemzario_concept_v1.png` | `59112519e18c…` |
| 80 | `monster.pasnelim` | 逆穂獣 パスネリム | 大型 | `monster_080_pasnelim_concept_v1.png` | `6d42d1c5421a…` |
| 81 | `monster.zaclatom` | 炉喉鳥 ザクラトム | 大型 | `monster_081_zaclatom_concept_v1.png` | `4108a14639eb…` |
| 82 | `monster.izoflane` | 湧皿鳥 イゾフラネ | 大型 | `monster_082_izoflane_concept_v1.png` | `db33541ba6e4…` |
| 83 | `monster.queribas` | 氷櫛蟲 クェリバス | 大型 | `monster_083_queribas_concept_v1.png` | `7937ed38200e…` |
| 84 | `monster.enagrio` | 礫環蛇 エナグリオ | 大型 | `monster_084_enagrio_concept_v1.png` | `fd7991295c65…` |
| 85 | `monster.nucbarea` | 霧扁蟹 ヌクバレア | 大型 | `monster_085_nucbarea_concept_v1.png` | `9cc07876daa0…` |
| 86 | `monster.towalsem` | 冷滴蛇 トワルセム | 大型 | `monster_086_towalsem_concept_v1.png` | `071670c3f096…` |
