# モンスター設計の監査表

基準: `1d8e084d0d16fe77c376570f9542dd3c54fb5332` / v0.20.0。読み取り監査。実装用データではありません。

## ガルドロスの技定義

23件の技定義、clip名は20種類。咆哮、威嚇、退避、切断後の版を含みます。区間は開始を含み終了を含みません。

| actionId | clip | 長さ(tick) | 区間 |
| --- | --- | ---: | --- |
| `monster.galdros.roar` | `galdros_roar_01` | 80 | startup [0,80) |
| `monster.galdros.slam_l` | `galdros_slam_l_01` | 120 | startup [0,48) / active [48,54) / recovery [54,120) |
| `monster.galdros.slam_r` | `galdros_slam_r_01` | 120 | startup [0,48) / active [48,54) / recovery [54,120) |
| `monster.galdros.charge` | `galdros_charge_01` | 190 | startup [0,60) / active [60,132) / recovery [132,190) |
| `monster.galdros.tail_sweep` | `galdros_tail_sweep_01` | 110 | startup [0,40) / active [40,58) / recovery [58,110) |
| `monster.galdros.tail_sweep_short` | `galdros_tail_sweep_01` | 110 | startup [0,40) / active [40,58) / recovery [58,110) |
| `monster.galdros.bite` | `galdros_bite_01` | 96 | startup [0,40) / active [40,47) / recovery [47,96) |
| `monster.galdros.head_swing` | `galdros_head_swing_01` | 104 | startup [0,42) / active [42,54) / recovery [54,104) |
| `monster.galdros.double_slam` | `galdros_double_slam_01` | 136 | startup [0,60) / active [60,67) / recovery [67,136) |
| `monster.galdros.stomp` | `galdros_stomp_01` | 84 | startup [0,34) / active [34,40) / recovery [40,84) |
| `monster.galdros.body_press` | `galdros_body_press_01` | 156 | startup [0,66) / active [66,74) / recovery [74,156) |
| `monster.galdros.side_bash_l` | `galdros_side_bash_l_01` | 96 | startup [0,38) / active [38,46) / recovery [46,96) |
| `monster.galdros.side_bash_r` | `galdros_side_bash_r_01` | 96 | startup [0,38) / active [38,46) / recovery [46,96) |
| `monster.galdros.charge_short` | `galdros_charge_short_01` | 130 | startup [0,46) / active [46,86) / recovery [86,130) |
| `monster.galdros.tail_slam` | `galdros_tail_slam_01` | 116 | startup [0,50) / active [50,57) / recovery [57,116) |
| `monster.galdros.tail_slam_short` | `galdros_tail_slam_01` | 116 | startup [0,50) / active [50,57) / recovery [57,116) |
| `monster.galdros.tail_sweep_rev` | `galdros_tail_sweep_rev_01` | 110 | startup [0,40) / active [40,58) / recovery [58,110) |
| `monster.galdros.tail_sweep_rev_short` | `galdros_tail_sweep_rev_01` | 110 | startup [0,40) / active [40,58) / recovery [58,110) |
| `monster.galdros.rockfall` | `galdros_rockfall_01` | 160 | startup [0,52) / active [52,60) / recovery [60,160) |
| `monster.galdros.rock_stomp` | `galdros_rock_stomp_01` | 150 | startup [0,52) / active [52,59) / recovery [59,150) |
| `monster.galdros.rock_fling` | `galdros_rock_fling_01` | 120 | startup [0,44) / active [44,50) / recovery [50,120) |
| `monster.galdros.retreat` | `galdros_retreat_01` | 72 | startup [0,20) / active [20,38) / recovery [38,72) |
| `monster.galdros.threat` | `galdros_threat_01` | 64 | startup [0,14) / active [14,44) / recovery [44,64) |

## 登録簿86種の状態と骨格

implementedは遊べる状態、artは原画段階、plannedは計画。最終モデル・設定図の承認とは別です。登録の骨格群をそのまま記載し、未承認の制作リグ分類を確定していません。

| No. | ID | 名前 | 登録骨格 | state |
| ---: | --- | --- | --- | --- |
| 1 | `monster.galdros` | ガルドロス | `frame.quad_heavy` | implemented |
| 2 | `monster.selvark` | セルヴァルク | `frame.quad_light` | implemented |
| 3 | `monster.numeradon` | ヌメラドン | `frame.quad_heavy` | implemented |
| 4 | `monster.bornakel` | ボルナケル | `frame.quad_heavy` | implemented |
| 5 | `monster.ashreia` | アシュレイア | `frame.biped_wing` | implemented |
| 6 | `monster.lumisca` | ルミスカ | `frame.biped_wing` | implemented |
| 7 | `monster.orglass` | オルグラス | `frame.crust_six` | implemented |
| 8 | `monster.tengaro` | テンガロ | `frame.crust_many` | implemented |
| 9 | `monster.verito` | ヴェリト | `frame.crust_many` | implemented |
| 10 | `monster.razmer` | ラズメル | `frame.long` | implemented |
| 11 | `monster.kirisave` | キリサーヴ | `frame.long` | implemented |
| 12 | `monster.velgait` | ヴェルガイト | `frame.quad_light` | implemented |
| 13 | `monster.embarg` | エンバルグ | `frame.quad_heavy` | art |
| 14 | `monster.kordopil` | コルドピル | `frame.quad_heavy` | implemented |
| 15 | `monster.palseit` | パルセイト | `frame.quad_light` | implemented |
| 16 | `monster.numaporon` | ヌマポロン | `frame.quad_heavy` | implemented |
| 17 | `monster.chilumicana` | チルミカナ | `frame.biped_wing` | implemented |
| 18 | `monster.kohalgis` | コハルギス | `frame.crust_six` | implemented |
| 19 | `monster.mitogaron` | ミトガロン | `frame.crust_many` | implemented |
| 20 | `monster.yurtepica` | ユルテピカ | `frame.crust_many` | implemented |
| 21 | `monster.hinasalv` | ヒナサルヴ | `frame.long` | implemented |
| 22 | `monster.hasdren` | ハスドレン | `frame.quad_heavy` | planned |
| 23 | `monster.ivselam` | イヴセラム | `frame.quad_light` | planned |
| 24 | `monster.domelkano` | ドメルカノ | `frame.quad_heavy` | planned |
| 25 | `monster.holnebas` | ホルネバス | `frame.quad_heavy` | planned |
| 26 | `monster.miltasea` | ミルタセア | `frame.biped_wing` | planned |
| 27 | `monster.talgrina` | タルグリナ | `frame.crust_six` | planned |
| 28 | `monster.zanetolka` | ザネトルカ | `frame.crust_many` | planned |
| 29 | `monster.ulnaset` | ウルナセト | `frame.long` | planned |
| 30 | `monster.nemboraf` | ネムボラフ | `frame.colossus` | planned |
| 31 | `monster.borazeln` | ボラゼルン | `frame.colossus` | planned |
| 32 | `monster.kudrimal` | クドリマル | `frame.colossus` | planned |
| 33 | `monster.tosamurie` | トサムリエ | `frame.quad_light` | planned |
| 34 | `monster.pukrenoa` | プクレノア | `frame.quad_heavy` | planned |
| 35 | `monster.kesalpina` | ケサルピナ | `frame.biped_wing` | planned |
| 36 | `monster.riptaum` | リプタウム | `frame.crust_six` | planned |
| 37 | `monster.serinodam` | セリノダム | `frame.crust_many` | planned |
| 38 | `monster.nufraken` | ヌフラケン | `frame.long` | planned |
| 39 | `monster.akaunel` | アカウネル | `frame.biped_wing` | planned |
| 40 | `monster.tsumarobek` | ツマロベク | `frame.quad_heavy` | planned |
| 41 | `monster.furemsad` | フレムサド | `frame.long` | planned |
| 42 | `monster.grasedon` | グラセドン | `frame.quad_heavy` | planned |
| 43 | `monster.ryuzelka` | リュゼルカ | `frame.quad_light` | planned |
| 44 | `monster.mordine` | モルディネ | `frame.quad_heavy` | planned |
| 45 | `monster.doberken` | ドベルケン | `frame.quad_heavy` | planned |
| 46 | `monster.shilhatora` | シルハトラ | `frame.biped_wing` | planned |
| 47 | `monster.kuzanerio` | クザネリオ | `frame.crust_six` | planned |
| 48 | `monster.fesrami` | フェスラミ | `frame.crust_many` | planned |
| 49 | `monster.elmejika` | エルメジカ | `frame.quad_light` | planned |
| 50 | `monster.azelnoto` | アゼルノト | `frame.long` | planned |
| 51 | `monster.bezrakio` | ベズラキオ | `frame.long` | planned |
| 52 | `monster.murzenato` | ムルゼナト | `frame.crust_many` | planned |
| 53 | `monster.hauremika` | ハウレミカ | `frame.biped_wing` | planned |
| 54 | `monster.zedbanil` | ゼドバニル | `frame.quad_heavy` | planned |
| 55 | `monster.oldasem` | オルダセム | `frame.colossus` | planned |
| 56 | `monster.nuolvan` | ヌオルヴァン | `frame.colossus` | planned |
| 57 | `monster.tarhegna` | テムソギア | `frame.colossus` | planned |
| 58 | `monster.porgamis` | ポルガミス | `frame.quad_heavy` | planned |
| 59 | `monster.yarlshena` | ヤルシェナ | `frame.quad_light` | planned |
| 60 | `monster.pizelta` | ピゼルタ | `frame.biped_wing` | planned |
| 61 | `monster.damorikus` | ダモリクス | `frame.crust_six` | planned |
| 62 | `monster.isarnem` | イサルネム | `frame.crust_many` | planned |
| 63 | `monster.regsanio` | レグサニオ | `frame.long` | planned |
| 64 | `monster.rupenias` | ルペニアス | `frame.quad_heavy` | planned |
| 65 | `monster.sograpin` | ソグラピン | `frame.quad_light` | planned |
| 66 | `monster.makuejira` | マクエジラ | `frame.biped_wing` | planned |
| 67 | `monster.gumesald` | グメサルド | `frame.quad_heavy` | planned |
| 68 | `monster.nericaus` | ネリカウス | `frame.biped_wing` | planned |
| 69 | `monster.voltena` | ヴォルテナ | `frame.crust_many` | planned |
| 70 | `monster.kitolnam` | キトルナム | `frame.long` | planned |
| 71 | `monster.segranio` | セオルミド | `frame.quad_light` | planned |
| 72 | `monster.dekoranze` | デコランゼ | `frame.colossus` | planned |
| 73 | `monster.fusaldom` | フサルドム | `frame.colossus` | planned |
| 74 | `monster.rimposera` | リムポセラ | `frame.colossus` | planned |
| 75 | `monster.dalhoina` | ダルホイナ | `frame.colossus` | planned |
| 76 | `monster.zonikebal` | ゾニケバル | `frame.quad_heavy` | planned |
| 77 | `monster.ludopanea` | ルドパネア | `frame.quad_light` | planned |
| 78 | `monster.salpinoc` | サルピノク | `frame.crust_six` | planned |
| 79 | `monster.hemzario` | ヘムザリオ | `frame.quad_heavy` | planned |
| 80 | `monster.pasnelim` | パスネリム | `frame.quad_light` | planned |
| 81 | `monster.zaclatom` | ザクラトム | `frame.biped_wing` | planned |
| 82 | `monster.izoflane` | イゾフラネ | `frame.biped_wing` | planned |
| 83 | `monster.queribas` | クェリバス | `frame.crust_many` | planned |
| 84 | `monster.enagrio` | エナグリオ | `frame.long` | planned |
| 85 | `monster.nucbarea` | ヌクバレア | `frame.crust_six` | planned |
| 86 | `monster.towalsem` | トワルセム | `frame.long` | planned |

## 集計

状態: art=1、implemented=20、planned=65。

骨格: frame.biped_wing=13、frame.colossus=10、frame.crust_many=11、frame.crust_six=8、frame.long=12、frame.quad_heavy=20、frame.quad_light=12。

## 独立器官の再現確認

生成器のmain()を呼ばず、作業コピーの定義を評価した結果:

- `chilumicana` の `nodes`: 0件
- `yurtepica` の `spinner`: 0件

独立形状の生成数であり、貼られた原画に模様があるかどうかを意味しません。原因候補と修正方針は設計書の第1章に記載しています。

```python
import runpy
m = runpy.run_path('tools/gen-monsters.py')
for key, part in [('chilumicana', 'nodes'), ('yurtepica', 'spinner')]:
    j = next(s['J'] for s in m['JUVENILES'] if s['J'].key == key)
    print(key, part, sum(e.get('part') == part for e in j.plan['extras']))
```

## 出典

- [public/data/bestiary.json](https://github.com/kamamon/Kari/blob/1d8e084d0d16fe77c376570f9542dd3c54fb5332/public/data/bestiary.json)
- [public/data/actions/galdros.json](https://github.com/kamamon/Kari/blob/1d8e084d0d16fe77c376570f9542dd3c54fb5332/public/data/actions/galdros.json)
- [public/data/actions/galdros_ext.json](https://github.com/kamamon/Kari/blob/1d8e084d0d16fe77c376570f9542dd3c54fb5332/public/data/actions/galdros_ext.json)
- [tools/gen-monsters.py](https://github.com/kamamon/Kari/blob/1d8e084d0d16fe77c376570f9542dd3c54fb5332/tools/gen-monsters.py)
